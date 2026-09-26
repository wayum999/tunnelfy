import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogComponent } from '../../utils/logger';
import { CloudflareApiService } from '../cloudflareApi';
import { ProfileManager } from '../profileManager';
import { TunnelLogger } from './TunnelLogger';
import { TunnelConfig } from './TunnelConfig';
import {
  TunnelProcessRegistry,
  RegistryEvent,
  StopResult,
  OwnedTunnelRecord,
  TunnelKind,
  DEFAULT_STOP_TIMEOUT_MS,
} from './TunnelProcessRegistry';
import * as util from 'util';
import { Messages } from '../../utils/messages';
import { CloudflareTunnel as ApiTunnel } from '../cloudflareApi/types';

/**
 * Custom error class for when cloudflared is not found
 */
export class CloudflaredNotFoundError extends Error {
  constructor(
    message: string = "cloudflared not found. Please install it first.",
  ) {
    super(message);
    this.name = "CloudflaredNotFoundError";
  }
}

/**
 * Interface representing a Cloudflare tunnel's data structure
 */
export interface CloudflareTunnel {
    /** Unique identifier for the tunnel */
    id: string;
    /** User-defined name for the tunnel */
    name: string;
    /** Timestamp when the tunnel was created */
    created_at: string;
    /** Timestamp when the tunnel was deleted (if applicable) */
    deleted_at?: string;
    /** Account identifier tag */
    account_tag: string;
    /** Array of active connections for this tunnel */
    connections?: Array<{
        id: string;
        connected_at: string;
        disconnected_at?: string;
        status: string;
        colo_name: string;
        uuid: string;
        is_pending_reconnect: boolean;
        origin_ip: string;
        opened_at: string;
        client_id: string;
        client_version: string;
    }>;
    /** Timestamp of last active connection */
    conns_active_at: string | null;
    /** Timestamp of last inactive connection */
    conns_inactive_at: string | null;
    /** Type of tunnel */
    tun_type: string;
    /** Additional metadata */
    metadata: Record<string, any>;
    /** Current tunnel status */
    status: string;
    /** Whether the tunnel is managed remotely */
    remote_config: boolean;
}

/**
 * Builds the cloudflared argv and environment for running a named tunnel.
 * The token is passed as TUNNEL_TOKEN in the environment, never on the command
 * line, where any local user could read it from the process list.
 */
export function buildTunnelRunInvocation(
  targetUrl: string,
  token: string,
): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: ["tunnel", "--url", targetUrl, "run"],
    env: { ...process.env, TUNNEL_TOKEN: token },
  };
}

const QUICK_TUNNEL_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

/** Types of events that can be emitted by the tunnel manager */
export type TunnelEventType = "start" | "stop" | "error" | "status";

/** Structure of tunnel events */
export interface TunnelEvent {
  type: TunnelEventType;
  tunnelId: string;
  message?: string;
  data?: any;
}

/**
 * TunnelManager - Core service for managing Cloudflare tunnels
 *
 * This service is responsible for:
 * 1. Starting and stopping named and quick tunnels
 * 2. Handling tunnel lifecycle (create, run, stop, delete)
 * 3. Managing tunnel configurations
 * 4. Emitting tunnel events for UI updates
 *
 * Every cloudflared child is owned by the TunnelProcessRegistry: it spawns,
 * records, persists, reconciles and stops them. TunnelManager keeps the API,
 * config and quick-tunnel URL handling and delegates process work to it.
 */
export class TunnelManager {
  private readonly _onTunnelEvent = new vscode.EventEmitter<TunnelEvent>();
  readonly onTunnelEvent = this._onTunnelEvent.event;
  private readonly tunnelLogger: TunnelLogger;
  private readonly tunnelConfig: TunnelConfig;
  private readonly registry: TunnelProcessRegistry;
  private readonly quickTunnelUrlTimeoutMs: number;
  /** Quick tunnels announced as running in this session: tunnel id -> URL and name */
  private readonly announcedQuickTunnels = new Map<string, { tunnelUrl: string; name?: string }>();
  /** Last millisecond used in a quick tunnel id, so two attempts never share an id */
  private lastQuickTunnelMs = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private apiService: CloudflareApiService,
    private profileManager: ProfileManager,
    registry?: TunnelProcessRegistry,
    options: { quickTunnelUrlTimeoutMs?: number } = {},
  ) {
    this.tunnelLogger = new TunnelLogger(logger, context.globalStoragePath);
    this.tunnelConfig = new TunnelConfig(
      context,
      logger,
      context.globalStoragePath,
    );
    this.registry =
      registry ??
      new TunnelProcessRegistry({ memento: context.globalState, logger });
    this.quickTunnelUrlTimeoutMs = options.quickTunnelUrlTimeoutMs ?? 15000;
    this.registry.onDidChange((event) => this.onRegistryEvent(event));
  }

  private onRegistryEvent(event: RegistryEvent): void {
    const { tunnelId } = event;
    switch (event.type) {
      case "start":
        // A quick tunnel is announced only once its URL is known (createQuickTunnel)
        if (event.kind === "quick" && !event.adopted) {
          return;
        }
        this._onTunnelEvent.fire({ type: "start", tunnelId, message: event.message });
        return;
      case "stop":
        this.announcedQuickTunnels.delete(tunnelId);
        void this.tunnelLogger
          .logTunnelEvent(tunnelId, "stopped", { preserveFocus: true })
          .then(() => this.tunnelLogger.closeStream(tunnelId));
        this._onTunnelEvent.fire({ type: "stop", tunnelId, message: event.message });
        return;
      case "error":
        this._onTunnelEvent.fire({ type: "error", tunnelId, message: event.message });
        return;
    }
  }

    /**
     * Creates a new tunnel with the given name
     * @param name Name for the new tunnel
     * @param managementType How the tunnel will be managed ('local' or 'remote')
     * @returns Created tunnel information
     * @throws Error if creation fails
     */
    async createTunnel(name: string, managementType: 'local' | 'remote' = 'local'): Promise<ApiTunnel> {
        try {
            const tunnel = await this.apiService.createTunnel(name, managementType);
            this.logger.info(LogComponent.TUNNEL, `Created tunnel: ${name} (${tunnel.id})`);

      // Save the initial configuration (the token is never written to disk)
      const activeProfile = await this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error("No active profile found");
      }
      const accountId =
        await this.profileManager.getProfileAccountId(activeProfile);
      if (!accountId) {
        throw new Error("No account ID found in active profile");
      }

      const config = {
        accountId,
        tunnelId: tunnel.id,
        tunnelName: name,
        credentials: {
          accountTag: tunnel.account_tag,
        },
        ingress: [
          {
            service: "http_status:404",
          },
        ],
      };

      await this.tunnelConfig.saveTunnelConfig(tunnel.id, config);
      return tunnel;
    } catch (error) {
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to create tunnel: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Deletes a tunnel and its associated resources
   * @param tunnelId ID of the tunnel to delete
   * @throws Error if deletion fails
   */
  async deleteTunnel(tunnelId: string): Promise<void> {
    try {
      const stopped = await this.stopTunnel(tunnelId);
      // identity-mismatch means the recorded process is already gone, so nothing is left running
      if (stopped.outcome === "failed" && stopped.reason !== "identity-mismatch") {
        throw new Error(`Could not stop tunnel before deleting it: ${stopped.reason}`);
      }
      await this.apiService.deleteTunnel(tunnelId);
      await this.tunnelConfig.deleteTunnelConfig(tunnelId);
      this.logger.info(LogComponent.TUNNEL, `Deleted tunnel: ${tunnelId}`);
    } catch (error) {
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to delete tunnel: ${error}`,
      );
      throw error;
    }
  }

    /**
     * Lists all available tunnels
     * @returns Array of tunnel information
     * @throws Error if listing fails
     */
    async listTunnels(): Promise<Array<ApiTunnel & { is_running_locally?: boolean }>> {
        try {
            const tunnels = await this.apiService.listTunnels();
            
            // Running locally means a cloudflared child this extension owns
            return tunnels.map(tunnel => ({
                ...tunnel,
                is_running_locally: this.registry.isOwned(tunnel.id)
            }));
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, `Failed to list tunnels: ${error}`);
            // Return empty array instead of throwing
            return [];
        }
    }

  /**
   * Checks if cloudflared is installed and available
   * @returns Path to cloudflared executable
   * @throws Error if cloudflared is not found
   */
  async checkCloudflared(): Promise<string> {
    return this.findCloudflaredPath();
  }

  /**
   * Locates the cloudflared executable
   * @returns Path to the cloudflared executable
   * @throws Error if cloudflared is not found
   * @private
   */
  private async findCloudflaredPath(): Promise<string> {
    const platform = process.platform;
    const isWindows = platform === "win32";
    const cloudflaredName = isWindows ? "cloudflared.exe" : "cloudflared";

    // Check in extension's global storage first
    const storagePath = path.join(
      this.context.globalStoragePath,
      "bin",
      cloudflaredName,
    );
    if (fs.existsSync(storagePath)) {
      return storagePath;
    }

    // Check in PATH
    const which = require("which");
    try {
      return await which(cloudflaredName);
    } catch {
      // On Linux, check common installation paths
      if (platform === "linux") {
        const commonPaths = [
          '/usr/local/bin/cloudflared',
          '/usr/bin/cloudflared',
          '/opt/cloudflared/bin/cloudflared',
          `${process.env.HOME}/.local/bin/cloudflared`,
          '/snap/bin/cloudflared'
        ];
        
        for (const checkPath of commonPaths) {
          if (fs.existsSync(checkPath)) {
            return checkPath;
          }
        }
      }
      
      throw new CloudflaredNotFoundError();
    }
  }

  /**
   * Starts a tunnel with specified configuration
   * @param tunnelId ID of the tunnel to run
   * @param portOrUrl Local port number or full URL to tunnel (e.g., "http://localhost:8080" or "http://127.0.0.1:3000")
   * @returns Child process running the tunnel
   * @throws Error if tunnel start fails, or the tunnel is already running or starting
   */
  async runTunnel(tunnelId: string, portOrUrl: number | string): Promise<cp.ChildProcess> {
    // Reserved before any await, so a second start for this id spawns nothing
    const release = this.registry.reserve(tunnelId);

    try {
      // Parse port or URL
      let port: number;
      let targetUrl: string;
      
      if (typeof portOrUrl === 'number') {
        // For backward compatibility - if a number is passed, assume it's localhost
        port = portOrUrl;
        targetUrl = `http://localhost:${port}`;
      } else {
        // Parse the URL to validate it and extract information
        try {
          const url = new URL(portOrUrl);
          // Extract port from URL or use default for protocol
          port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
          targetUrl = portOrUrl;
        } catch (error) {
          // If it's not a valid URL, check if it's just a port number as string
          const numericPort = parseInt(portOrUrl, 10);
          if (!isNaN(numericPort) && numericPort > 0 && numericPort < 65536) {
            port = numericPort;
            targetUrl = `http://localhost:${port}`;
          } else {
            throw new Error(`Invalid URL or port: ${portOrUrl}`);
          }
        }
      }

      // Get tunnel info first to include name in logs
      const tunnelInfo = await this.apiService.getTunnelInfo(tunnelId);
      if (!tunnelInfo || !tunnelInfo.name) {
        throw new Error("Failed to get tunnel information");
      }

      // Get the token
      this.logger.debug(LogComponent.TUNNEL, "Getting tunnel token...", {
        preserveFocus: true,
      });
      const token = await this.apiService.getTunnelToken(tunnelId);
      if (!token) {
        throw new Error("Failed to get tunnel token");
      }

      // Get account ID from active profile
      const activeProfile = await this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error("No active profile found");
      }
      const accountId =
        await this.profileManager.getProfileAccountId(activeProfile);
      if (!accountId) {
        throw new Error("No account ID found in active profile");
      }

      // Create initial configuration if it doesn't exist
      const config = {
        accountId,
        tunnelId: tunnelId,
        tunnelName: tunnelInfo.name,
        credentials: {
          accountTag: tunnelInfo.account_tag,
        },
        ingress: [
          {
            service: targetUrl,
          },
          {
            service: "http_status:404",
          },
        ],
      };

      // Save the configuration
      await this.tunnelConfig.saveTunnelConfig(tunnelId, config);

      const cloudflaredPath = await this.findCloudflaredPath();

      // The token goes through the environment, never argv (argv is visible in `ps`)
      const { args, env } = buildTunnelRunInvocation(targetUrl, token);

      const owned = await this.registry.start({
        tunnelId,
        kind: "named",
        target: targetUrl,
        command: cloudflaredPath,
        args,
        env,
        onOutput: (chunk) => this.tunnelLogger.appendOutput(tunnelId, chunk),
      });

      await this.tunnelLogger.logTunnelEvent(tunnelId, "started", {
        targetUrl,
        port
      });

      return owned.child;
    } catch (error) {
      this.logger.error(LogComponent.TUNNEL, `Failed to run tunnel: ${error}`);
      throw error;
    } finally {
      // Once started, the registry's ownership blocks a second start instead
      release();
    }
  }

  /**
   * Stops a tunnel this extension owns, by its recorded pid
   * @param tunnelId ID of the tunnel to stop
   * @returns stopped, not-owned (nothing was signalled) or failed with a reason
   */
  async stopTunnel(tunnelId: string): Promise<StopResult> {
    this.logger.info(LogComponent.TUNNEL, `Stopping TUNNEL: ${tunnelId}`, {
      preserveFocus: true,
    });
    return this.registry.stop(tunnelId);
  }

  /**
   * Stops every owned tunnel concurrently within one bounded wait
   * Called during extension deactivation
   */
  async stopAllOwned(timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS): Promise<StopResult[]> {
    return this.registry.stopAll(timeoutMs);
  }

  /**
   * Checks tunnels recorded by an earlier session against live processes, adopting the
   * ones that are still the children that were recorded. Never throws.
   */
  async reconcileOwned(): Promise<void> {
    await this.registry.reconcile();
  }

  /**
   * Lists the tunnels this extension owns
   * @param kind Optional filter, "named" or "quick"
   */
  listOwnedTunnels(kind?: TunnelKind): OwnedTunnelRecord[] {
    return this.registry.list(kind);
  }

  /**
   * Updates a tunnel's configuration
   * @param tunnelId ID of the tunnel to update
   * @param updates Configuration updates to apply
   * @throws Error if update fails
   */
  async updateTunnelConfig(tunnelId: string, updates: any): Promise<void> {
    try {
      // First try to load existing config
      let config = await this.tunnelConfig.loadTunnelConfig(tunnelId);

      if (!config) {
        // If no config exists, we need to create a new one
        const tunnelInfo = await this.apiService.getTunnelInfo(tunnelId);
        if (!tunnelInfo) {
          throw new Error(`Failed to get tunnel info for ${tunnelId}`);
        }

        const activeProfile = await this.profileManager.getActiveProfile();
        if (!activeProfile) {
          throw new Error("No active profile found");
        }
        const accountId =
          await this.profileManager.getProfileAccountId(activeProfile);
        if (!accountId) {
          throw new Error("No account ID found in active profile");
        }

        // Create base configuration
        config = {
          accountId,
          tunnelId: tunnelId,
          tunnelName: tunnelInfo.name,
          credentials: {
            accountTag: tunnelInfo.account_tag,
          },
          ingress: [
            {
              service: "http_status:404",
            },
          ],
        };
      }

      // Merge the updates with existing or new config
      const updatedConfig = {
        ...config,
        ...updates,
        // Preserve nested objects that might be partially updated
        ingress: updates.ingress || config.ingress,
        credentials: updates.credentials || config.credentials,
      };

      await this.tunnelConfig.saveTunnelConfig(tunnelId, updatedConfig);
      this.logger.info(
        LogComponent.TUNNEL,
        `Updated configuration for tunnel ${tunnelId}`,
      );
    } catch (error) {
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to update tunnel configuration: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Gets the running quick tunnels this extension owns and has a URL for
   * @returns Array of quick tunnel information
   */
  async getQuickTunnels(): Promise<
    Array<{ tunnelId: string; port: number; url: string; tunnelUrl: string; name?: string }>
  > {
    const quickTunnels: Array<{
      tunnelId: string;
      port: number;
      url: string;
      tunnelUrl: string;
      name?: string;
    }> = [];

    for (const record of this.registry.list("quick")) {
      const portMatch = record.tunnelId.match(/^quick-(\d+)-/);
      if (!portMatch) {
        continue;
      }
      const port = parseInt(portMatch[1], 10);
      const announced = this.announcedQuickTunnels.get(record.tunnelId);
      if (announced) {
        quickTunnels.push({ tunnelId: record.tunnelId, port, url: record.target, ...announced });
        continue;
      }
      // An attempt still waiting for its URL (or one that failed) is not listed
      if (!this.registry.isAdopted(record.tunnelId)) {
        continue;
      }
      // Adopted from an earlier session: the URL is in that session's log
      const tunnelUrl = this.readQuickTunnelUrlFromLog(record.tunnelId);
      if (tunnelUrl) {
        quickTunnels.push({ tunnelId: record.tunnelId, port, url: record.target, tunnelUrl });
      }
    }

    return quickTunnels;
  }

  private readQuickTunnelUrlFromLog(tunnelId: string): string | undefined {
    const logDir = path.join(this.context.globalStoragePath, "logs", "tunnels");
    const candidates = [`${tunnelId}.log`, ...[1, 2, 3, 4, 5].map((i) => `${tunnelId}.${i}.log`)];
    for (const file of candidates) {
      const logFile = path.join(logDir, file);
      try {
        if (!fs.existsSync(logFile)) {
          continue;
        }
        const urlMatch = fs.readFileSync(logFile, "utf8").match(QUICK_TUNNEL_URL);
        if (urlMatch) {
          return urlMatch[0];
        }
      } catch (error) {
        this.logger.error(
          LogComponent.TUNNEL,
          `Error reading quick tunnel log: ${error}`,
        );
      }
    }
    return undefined;
  }

  /**
   * Creates a quick tunnel for temporary use
   * @param portOrUrl Local port number or full URL to tunnel (e.g., "http://localhost:8080" or "http://127.0.0.1:3000")
   * @param name Optional name for the tunnel
   * @returns Object containing local and tunnel URLs and the tunnel id
   * @throws Error if quick tunnel creation fails; the attempt's own child is stopped first
   */
  async createQuickTunnel(
    portOrUrl: number | string,
    name?: string,
  ): Promise<{ tunnelId: string; url: string; tunnelUrl: string; name?: string } | null> {
    // This attempt's id; failure cleanup targets it and nothing else
    let attemptId: string | undefined;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let interval: NodeJS.Timeout | undefined;
    let failureMessage: { message: string; detail?: string } | string | undefined;
    const settle = (): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      clearTimeout(timeout);
      clearInterval(interval);
      return true;
    };

    try {
      // Parse port or URL
      let port: number;
      let targetUrl: string;
      
      if (typeof portOrUrl === 'number') {
        // For backward compatibility - if a number is passed, assume it's localhost
        // Validate port number
        if (portOrUrl < 1 || portOrUrl > 65535) {
          throw new Error(`Invalid port number: ${portOrUrl}. Must be between 1 and 65535.`);
        }
        port = portOrUrl;
        targetUrl = `http://localhost:${port}`;
      } else {
        // Parse the URL to validate it and extract information
        try {
          const url = new URL(portOrUrl);
          // Extract port from URL or use default for protocol
          port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
          targetUrl = portOrUrl;
        } catch (error) {
          // If it's not a valid URL, check if it's just a port number as string
          const numericPort = parseInt(portOrUrl, 10);
          if (!isNaN(numericPort) && numericPort > 0 && numericPort < 65536) {
            port = numericPort;
            targetUrl = `http://localhost:${port}`;
          } else {
            throw new Error(`Invalid URL or port: ${portOrUrl}`);
          }
        }
      }

      Messages.showInfo(Messages.QUICK_TUNNEL_STARTING(name, port));
      this.logger.info(
        LogComponent.TUNNEL,
        `Starting quick tunnel${name ? ` "${name}"` : ""} for ${targetUrl}`,
      );

      // Find cloudflared
      this.logger.debug(
        LogComponent.TUNNEL,
        "Looking for cloudflared executable...",
      );
      const cloudflaredPath = await this.findCloudflaredPath();
      this.logger.debug(
        LogComponent.TUNNEL,
        `Found cloudflared at: ${cloudflaredPath}`,
      );

      // Test cloudflared version
      try {
        const { stdout } = await util.promisify(cp.exec)(
          `${JSON.stringify(cloudflaredPath)} --version`,
        );
        this.logger.debug(
          LogComponent.TUNNEL,
          `Cloudflared version: ${stdout}`,
        );
      } catch (error) {
        this.logger.error(
          LogComponent.TUNNEL,
          `Failed to get cloudflared version: ${error}`,
        );
        throw new Error("Failed to verify cloudflared installation");
      }

      // Build the command arguments
      const args = ["tunnel", "--url", targetUrl];
      const cmdString = `${JSON.stringify(cloudflaredPath)} ${args.join(" ")}`;
      this.logger.info(LogComponent.TUNNEL, `Running command: ${cmdString}`);

      const idMs = Math.max(Date.now(), this.lastQuickTunnelMs + 1);
      this.lastQuickTunnelMs = idMs;
      const quickTunnelId = `quick-${port}-${idMs}`;

      let outputBuffer = "";
      let errorBuffer = "";
      let resolveUrl!: (url: string) => void;
      let rejectUrl!: (error: Error) => void;
      const urlPromise = new Promise<string>((resolve, reject) => {
        resolveUrl = resolve;
        rejectUrl = reject;
      });
      // Handled through `await urlPromise` below; this keeps an early rejection from being unhandled
      urlPromise.catch(() => undefined);

      const fail = (error: Error, message?: { message: string; detail?: string } | string) => {
        if (settle()) {
          failureMessage = message;
          rejectUrl(error);
        }
      };

      const checkBufferForUrl = () => {
        if (settled) {
          return;
        }
        const match = outputBuffer.match(QUICK_TUNNEL_URL);
        if (match && settle()) {
          resolveUrl(match[0]);
        }
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }
        this.logger.info(
          LogComponent.TUNNEL,
          `Quick tunnel process exited with code ${code}, signal ${signal} before reporting a URL`,
        );
        if (errorBuffer) {
          this.logger.error(
            LogComponent.TUNNEL,
            `Error output from cloudflared:\n${errorBuffer}`,
          );
          if (errorBuffer.includes("429 Too Many Requests")) {
            fail(new Error("Rate limit exceeded for quick tunnels"), Messages.QUICK_TUNNEL_RATE_LIMIT);
            return;
          }
          if (errorBuffer.includes("bind: address already in use")) {
            fail(new Error(`Port ${port} is already in use`), Messages.QUICK_TUNNEL_PORT_IN_USE(port));
            return;
          }
          if (
            errorBuffer.includes("connection refused") ||
            errorBuffer.includes("cannot connect to")
          ) {
            fail(new Error("Failed to connect to Cloudflare"), Messages.QUICK_TUNNEL_CONNECTION_ERROR);
            return;
          }
        }
        const errorMessage = errorBuffer
          ? errorBuffer.trim()
          : "Unknown error occurred";
        fail(
          new Error(
            `Quick tunnel process exited with code ${code}${errorBuffer ? `: ${errorBuffer.trim()}` : ""}`,
          ),
          Messages.ERROR_GENERIC(errorMessage),
        );
      };

      const owned = await this.registry.start({
        tunnelId: quickTunnelId,
        kind: "quick",
        target: targetUrl,
        command: cloudflaredPath,
        args,
        onOutput: (chunk, source) => {
          this.tunnelLogger.appendOutput(quickTunnelId, chunk);
          // After the attempt settles, output is only logged: a late URL announces nothing
          if (settled) {
            return;
          }
          outputBuffer += chunk;
          if (source === "stderr") {
            errorBuffer += chunk;
          }
          checkBufferForUrl();
        },
        onExit,
      });
      // Only now is there a child of this attempt's own to clean up on failure
      attemptId = quickTunnelId;

      this.logger.info(
        LogComponent.TUNNEL,
        `Started cloudflared process with PID: ${owned.record.pid}`,
      );

      if (!settled) {
        timeout = setTimeout(() => {
          this.logger.error(
            LogComponent.TUNNEL,
            "Timed out waiting for tunnel URL. Full output buffer:",
            outputBuffer,
          );
          fail(new Error("Timed out waiting for quick tunnel URL"));
        }, this.quickTunnelUrlTimeoutMs);
        // Safety net in case a chunk boundary split the URL across events
        interval = setInterval(checkBufferForUrl, 100);
      }

      const tunnelUrl = await urlPromise;
      if (!this.registry.isOwned(quickTunnelId)) {
        throw new Error("Quick tunnel exited right after reporting its URL");
      }

      this.logger.info(
        LogComponent.TUNNEL,
        `Found quick tunnel URL: ${tunnelUrl}`,
      );
      this.announcedQuickTunnels.set(quickTunnelId, { tunnelUrl, name });
      this._onTunnelEvent.fire({
        type: "start",
        tunnelId: quickTunnelId,
        message: `Quick tunnel${name ? ` "${name}"` : ""} started for ${targetUrl}`,
      });
      Messages.showInfo(Messages.QUICK_TUNNEL_RUNNING(tunnelUrl, name));

      return {
        tunnelId: quickTunnelId,
        url: targetUrl,
        tunnelUrl,
        name
      };
    } catch (error) {
      settle();
      // Stop this attempt's own child before the error reaches the user, so the port is not left public
      if (attemptId) {
        const stopped = await this.registry.stop(attemptId);
        if (stopped.outcome === "failed") {
          this.logger.error(
            LogComponent.TUNNEL,
            `Failed to stop quick tunnel ${attemptId} after error: ${stopped.reason}`,
          );
        }
      }
      if (failureMessage) {
        Messages.showError(failureMessage);
      }
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to create quick tunnel: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Stops a quick tunnel by its tunnel id (never by port, so two quick tunnels on one
   * port are stopped independently)
   * @param tunnelId ID of the quick tunnel to stop
   */
  async stopQuickTunnel(tunnelId: string): Promise<StopResult> {
    if (!this.registry.list("quick").some((record) => record.tunnelId === tunnelId)) {
      return { tunnelId, outcome: "not-owned" };
    }
    return this.registry.stop(tunnelId);
  }

  /**
   * Gets the configuration for a specific tunnel
   * @param tunnelId ID of the tunnel to get configuration for
   * @returns The tunnel configuration if found
   */
  async getTunnelConfig(tunnelId: string): Promise<any> {
    try {
      return await this.tunnelConfig.loadTunnelConfig(tunnelId);
    } catch (error) {
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to get tunnel config: ${error}`,
      );
      throw error;
    }
  }
}

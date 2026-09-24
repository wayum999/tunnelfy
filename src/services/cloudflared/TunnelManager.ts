import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogComponent } from '../../utils/logger';
import { CloudflareApiService } from '../cloudflareApi';
import { ProfileManager } from '../profileManager';
import { TunnelLogger } from './TunnelLogger';
import { TunnelConfig } from './TunnelConfig';
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
 * 1. Creating and managing tunnel processes
 * 2. Handling tunnel lifecycle (start, stop, delete)
 * 3. Managing tunnel configurations
 * 4. Monitoring tunnel status and health
 * 5. Emitting tunnel events for UI updates
 *
 * Features:
 * - Process management for both persistent and quick tunnels
 * - Automatic cleanup of orphaned processes
 * - Event-based status updates
 * - Cross-platform support (Windows, macOS, Linux)
 * - Graceful shutdown handling
 */
export class TunnelManager {
  private readonly runningTunnels: Map<
    string,
    {
      process: cp.ChildProcess;
      pid: number;
      logStreams: fs.WriteStream[];
      name?: string;
    }
  > = new Map();

  private readonly _onTunnelEvent = new vscode.EventEmitter<TunnelEvent>();
  readonly onTunnelEvent = this._onTunnelEvent.event;
  private readonly tunnelLogger: TunnelLogger;
  private readonly tunnelConfig: TunnelConfig;

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private apiService: CloudflareApiService,
    private profileManager: ProfileManager,
  ) {
    this.tunnelLogger = new TunnelLogger(logger, context.globalStoragePath);
    this.tunnelConfig = new TunnelConfig(
      context,
      logger,
      context.globalStoragePath,
    );
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
      await this.stopTunnel(tunnelId);
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
            
            // Update is_running_locally based on our runningTunnels Map
            return tunnels.map(tunnel => ({
                ...tunnel,
                is_running_locally: this.runningTunnels.has(tunnel.id)
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
   * @throws Error if tunnel start fails
   */
  async runTunnel(tunnelId: string, portOrUrl: number | string): Promise<cp.ChildProcess> {
    if (this.runningTunnels.has(tunnelId)) {
      throw new Error(`Tunnel ${tunnelId} is already running`);
    }

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

      const process = cp.spawn(cloudflaredPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      const logStream = this.tunnelLogger.createLogStream(tunnelId);
      process.stdout.pipe(logStream);
      process.stderr.pipe(logStream);

      this.runningTunnels.set(tunnelId, {
        process,
        pid: process.pid!,
        logStreams: [logStream],
        name: tunnelInfo.name,
      });

      // Handle process events
      process.on("error", (error) => {
        this.logger.error(
          LogComponent.TUNNEL,
          `Tunnel process error: ${error}`,
        );
        this._onTunnelEvent.fire({
          type: "error",
          tunnelId,
          message: error.message,
        });
      });

      process.on("exit", (code, signal) => {
        this.logger.info(
          LogComponent.TUNNEL,
          `Tunnel process exited with code ${code}, signal ${signal}`,
        );
        this.cleanupTunnelProcess(tunnelId);
      });

      // Log and emit start event
      await this.tunnelLogger.logTunnelEvent(tunnelId, "started", { 
        targetUrl,
        port
      });
      this._onTunnelEvent.fire({
        type: "start",
        tunnelId,
        message: `Tunnel started for ${targetUrl}`,
      });

      return process;
    } catch (error) {
      this.logger.error(LogComponent.TUNNEL, `Failed to run tunnel: ${error}`);
      throw error;
    }
  }

  /**
   * Cleans up resources for a stopped tunnel
   * @param tunnelId ID of the tunnel to clean up
   * @private
   */
  private async cleanupTunnelProcess(tunnelId: string): Promise<void> {
    const runningTunnel = this.runningTunnels.get(tunnelId);
    if (!runningTunnel) {
      return;
    }

    // Close log streams
    for (const stream of runningTunnel.logStreams) {
      stream.end();
    }

    this.runningTunnels.delete(tunnelId);
    await this.tunnelLogger.logTunnelEvent(tunnelId, "stopped", {
      preserveFocus: true,
    });
    this._onTunnelEvent.fire({
      type: "stop",
      tunnelId,
      message: "Tunnel stopped",
    });
  }

  /**
   * Stops a running tunnel
   * @param tunnelId ID of the tunnel to stop
   * @throws Error if stop operation fails
   */
  async stopTunnel(tunnelId: string): Promise<void> {
    try {
      const runningTunnel = this.runningTunnels.get(tunnelId);
      if (!runningTunnel) {
        this.logger.warn(
          LogComponent.TUNNEL,
          `No running tunnel found for ID: ${tunnelId}`,
          { preserveFocus: true },
        );
        return;
      }

      this.logger.info(LogComponent.TUNNEL, `Stopping TUNNEL: ${tunnelId}`, {
        preserveFocus: true,
      });

      // Kill the process
      if (process.platform === "win32") {
        try {
          process.kill(runningTunnel.pid);
        } catch (error) {
          this.logger.warn(
            LogComponent.TUNNEL,
            `Failed to kill process: ${error}`,
            { preserveFocus: true },
          );
        }
      } else {
        try {
          process.kill(runningTunnel.pid, "SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            process.kill(runningTunnel.pid, 0);
            // Process still running, try SIGKILL
            process.kill(runningTunnel.pid, "SIGKILL");
          } catch (error) {
            // Process is already dead
          }
        } catch (error) {
          this.logger.warn(
            LogComponent.TUNNEL,
            `Failed to kill process: ${error}`,
            { preserveFocus: true },
          );
        }
      }

      // Clean up resources
      await this.cleanupTunnelProcess(tunnelId);

      this.logger.info(LogComponent.TUNNEL, `TUNNEL: ${tunnelId} stopped`, {
        preserveFocus: true,
      });
    } catch (error) {
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to stop tunnel: ${error}`,
        { preserveFocus: true },
      );
      throw error;
    }
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
   * Gets all currently running quick tunnels
   * @returns Array of quick tunnel information
   */
  async getQuickTunnels(): Promise<
    Array<{ port: number; url: string; tunnelUrl: string; name?: string }>
  > {
    const quickTunnels: Array<{
      port: number;
      url: string;
      tunnelUrl: string;
      name?: string;
    }> = [];

    for (const [tunnelId, tunnel] of this.runningTunnels.entries()) {
      if (tunnelId.startsWith("quick-")) {
        const portMatch = tunnelId.match(/quick-(\d+)-/);
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          const url = `http://localhost:${port}`;
          // Get the tunnel URL from the process output
          const logFile = path.join(
            this.context.globalStoragePath,
            "logs",
            "tunnels",
            `${tunnelId}.log`,
          );
          try {
            if (fs.existsSync(logFile)) {
              const logContent = fs.readFileSync(logFile, "utf8");
              const urlMatch = logContent.match(
                /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/,
              );
              if (urlMatch) {
                quickTunnels.push({
                  port,
                  url,
                  tunnelUrl: urlMatch[0],
                  name: tunnel.name,
                });
              }
            }
          } catch (error) {
            this.logger.error(
              LogComponent.TUNNEL,
              `Error reading quick tunnel log: ${error}`,
            );
          }
        }
      }
    }

    return quickTunnels;
  }

  /**
   * Cleans up all running tunnels
   * Called during extension deactivation
   */
  async cleanup(): Promise<void> {
    // Stop all running tunnels
    for (const [tunnelId] of this.runningTunnels) {
      await this.stopTunnel(tunnelId);
    }
  }

  /**
   * Creates a quick tunnel for temporary use
   * @param portOrUrl Local port number or full URL to tunnel (e.g., "http://localhost:8080" or "http://127.0.0.1:3000")
   * @param name Optional name for the tunnel
   * @returns Object containing local and tunnel URLs
   * @throws Error if quick tunnel creation fails
   */
  async createQuickTunnel(
    portOrUrl: number | string,
    name?: string,
  ): Promise<{ url: string; tunnelUrl: string; name?: string } | null> {
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

      // Create process with full stdio
      const process = cp.spawn(cloudflaredPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      if (!process.pid) {
        throw new Error("Failed to start cloudflared process");
      }

      this.logger.info(
        LogComponent.TUNNEL,
        `Started cloudflared process with PID: ${process.pid}`,
      );

      // Create a unique ID for the quick tunnel
      const quickTunnelId = `quick-${port}-${Date.now()}`;
      const logStream = this.tunnelLogger.createLogStream(quickTunnelId);

      // Create a promise that resolves when we find the URL
      const urlPromise = new Promise<string>((resolve, reject) => {
        let outputBuffer = "";
        let errorBuffer = "";

        // Function to check the entire buffer for a URL
        const checkBufferForUrl = () => {
          const match = outputBuffer.match(
            /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/,
          );
          if (match) {
            const tunnelUrl = match[0];
            this.logger.info(
              LogComponent.TUNNEL,
              `Found quick tunnel URL: ${tunnelUrl}`,
            );

            // Store the tunnel info immediately when we find the URL
            if (!process.pid) {
              reject(new Error("Process PID is undefined"));
              return;
            }

            // Store the running tunnel first
            this.runningTunnels.set(quickTunnelId, {
              process,
              pid: process.pid,
              logStreams: [logStream],
              name,
            });

            // Then fire events and resolve
            this._onTunnelEvent.fire({
              type: "start",
              tunnelId: quickTunnelId,
              message: `Quick tunnel${name ? ` "${name}"` : ""} started for ${targetUrl}`,
            });
            Messages.showInfo(Messages.QUICK_TUNNEL_RUNNING(tunnelUrl, name));
            resolve(tunnelUrl);
            return true;
          }
          return false;
        };

        // Process stdout to find the tunnel URL
        process.stdout.on("data", (data: Buffer) => {
          const output = data.toString();
          outputBuffer += output;
          logStream.write(output);

          this.logger.debug(
            LogComponent.TUNNEL,
            `Quick tunnel stdout received ${data.length} bytes`,
          );
          checkBufferForUrl();
        });

        // Process stderr for error messages and logging
        process.stderr.on("data", (data: Buffer) => {
          const output = data.toString();
          errorBuffer += output; // Store error messages
          outputBuffer += output;
          logStream.write(output);
          this.logger.debug(
            LogComponent.TUNNEL,
            `Quick tunnel stderr: ${output}`,
          );
        });

        // Handle process events
        process.on("error", (error) => {
          this.logger.error(
            LogComponent.TUNNEL,
            `Quick tunnel process error: ${error}`,
          );
          reject(error);
        });

        process.on("exit", (code, signal) => {
          this.logger.info(
            LogComponent.TUNNEL,
            `Quick tunnel process exited with code ${code}, signal ${signal}`,
          );
          if (code !== 0) {
            // Log the error buffer if we have one
            if (errorBuffer) {
              this.logger.error(
                LogComponent.TUNNEL,
                `Error output from cloudflared:\n${errorBuffer}`,
              );

              // Check for specific error types
              if (errorBuffer.includes("429 Too Many Requests")) {
                Messages.showError(Messages.QUICK_TUNNEL_RATE_LIMIT);
                reject(new Error("Rate limit exceeded for quick tunnels"));
                return;
              }

              // Check for port already in use
              if (errorBuffer.includes("bind: address already in use")) {
                Messages.showError(Messages.QUICK_TUNNEL_PORT_IN_USE(port));
                reject(new Error(`Port ${port} is already in use`));
                return;
              }

              // Check for connection errors
              if (
                errorBuffer.includes("connection refused") ||
                errorBuffer.includes("cannot connect to")
              ) {
                Messages.showError(Messages.QUICK_TUNNEL_CONNECTION_ERROR);
                reject(new Error("Failed to connect to Cloudflare"));
                return;
              }
            }

            // Generic error with the full error message
            const errorMessage = errorBuffer
              ? errorBuffer.trim()
              : "Unknown error occurred";
            Messages.showError(Messages.ERROR_GENERIC(errorMessage));
            reject(
              new Error(
                `Quick tunnel process exited with code ${code}${errorBuffer ? `: ${errorBuffer.trim()}` : ""}`,
              ),
            );
          }
        });

        // Set a timeout for URL detection
        const timeout = setTimeout(() => {
          this.logger.error(
            LogComponent.TUNNEL,
            "Timed out waiting for tunnel URL. Full output buffer:",
            outputBuffer,
          );
          if (errorBuffer) {
            this.logger.error(
              LogComponent.TUNNEL,
              "Error output:",
              errorBuffer,
            );
          }
          reject(new Error("Timed out waiting for quick tunnel URL"));
        }, 15000); // 15 seconds timeout

        // Check the buffer periodically in case we missed the URL in the event handlers
        const interval = setInterval(() => {
          if (checkBufferForUrl()) {
            clearInterval(interval);
            clearTimeout(timeout);
          }
        }, 100); // Check every 100ms

        // Clean up interval on reject/resolve
        process.on("exit", () => {
          clearInterval(interval);
          clearTimeout(timeout);
        });
      });

      // Wait for the URL
      const tunnelUrl = await urlPromise;

      return {
        url: targetUrl,
        tunnelUrl,
        name
      };
    } catch (error) {
      // Clean up on error
      if (typeof portOrUrl === 'number') {
        await this.stopQuickTunnel(portOrUrl);
      } else {
        try {
          const url = new URL(portOrUrl);
          const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
          await this.stopQuickTunnel(port);
        } catch (e) {
          // If we can't parse the URL, try to extract port from error message or just log the error
          this.logger.error(
            LogComponent.TUNNEL,
            `Failed to stop quick tunnel after error: ${e}`,
          );
        }
      }
      this.logger.error(
        LogComponent.TUNNEL,
        `Failed to create quick tunnel: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Stops a quick tunnel
   * @param port Port number of the quick tunnel to stop
   */
  async stopQuickTunnel(port: number): Promise<void> {
    // Find the quick tunnel process for this port
    const quickTunnelId = Array.from(this.runningTunnels.entries()).find(
      ([id, _]) => id.startsWith(`quick-${port}-`),
    )?.[0];

    if (quickTunnelId) {
      await this.stopTunnel(quickTunnelId);
    }
    // No need to log anything if tunnel not found - it's already stopped
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

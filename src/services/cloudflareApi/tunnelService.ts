import { BaseCloudflareService } from "./baseService";
import { CloudflareTunnel } from "./types";
import { LogComponent } from "../../utils/logger";

/**
 * Service for managing Cloudflare tunnels
 * Handles tunnel-specific API operations
 */
export class TunnelService extends BaseCloudflareService {
  /**
   * Lists all tunnels for the account
   * Filters out deleted tunnels and sorts by name
   * @returns Array of active tunnels
   * @throws Error if listing fails
   */
  async listTunnels(): Promise<CloudflareTunnel[]> {
    try {
      // Check if there's an active profile first
      const activeProfile = await this.profileManager.getActiveProfile();
      if (!activeProfile) {
        this.logger.debug(
          LogComponent.API,
          'No active profile found, returning empty tunnel list'
        );
        return [];
      }

      const accountId = await this.getAccountId();
      const tunnels = await this.makeRequest<CloudflareTunnel[]>(
        `/accounts/${accountId}/tunnels`,
      );

      // Filter out deleted tunnels and sort by name
      const activeTunnels = tunnels
        .filter((tunnel: CloudflareTunnel) => !tunnel.deleted_at)
        .sort((a: CloudflareTunnel, b: CloudflareTunnel) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );

      this.logger.debug(
        LogComponent.API,
        `Found ${activeTunnels.length} active tunnels`,
      );

      // Map additional status information
      return activeTunnels.map((tunnel: CloudflareTunnel) => ({
        ...tunnel,
        // Ensure connections is always an array
        connections: tunnel.connections || [],
        // Normalize status based on various fields
        status: this.normalizeTunnelStatus(tunnel),
        // Set management type based on remote_config
        management_type: tunnel.remote_config ? "remote" : "local",
        // is_running_locally will be set by TunnelManager
        is_running_locally: false,
      }));
    } catch (error) {
      this.logger.error(LogComponent.API, "Failed to list tunnels:", error);
      throw error;
    }
  }

  /**
   * Gets detailed information about a specific tunnel
   * @param tunnelId ID of the tunnel to get info for
   * @returns Tunnel information
   * @throws Error if tunnel info cannot be retrieved
   */
  async getTunnelInfo(tunnelId: string): Promise<CloudflareTunnel> {
    try {
      const accountId = await this.getAccountId();
      const tunnel = await this.makeRequest<CloudflareTunnel>(
        `/accounts/${accountId}/tunnels/${tunnelId}`,
      );
      this.logger.debug(
        LogComponent.API,
        `Retrieved info for tunnel: ${tunnel.name}`,
      );
      return tunnel;
    } catch (error) {
      this.logger.error(
        LogComponent.API,
        `Failed to get tunnel info for ${tunnelId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Creates a new tunnel
   * @param name Name for the new tunnel
   * @param managementType How the tunnel will be managed ('local' or 'remote')
   * @returns Created tunnel information
   * @throws Error if tunnel creation fails
   */
  async createTunnel(
    name: string,
    managementType: "local" | "remote" = "local",
  ): Promise<CloudflareTunnel> {
    try {
      const accountId = await this.getAccountId();
      const config_src =
        managementType === "remote"
          ? ("cloudflare" as const)
          : ("local" as const);

      const tunnel = await this.makeRequest<CloudflareTunnel>(
        `/accounts/${accountId}/tunnels`,
        "POST",
        { name, config_src },
      );
      this.logger.info(
        LogComponent.API,
        `Created tunnel: ${name} (${tunnel.id})`,
      );
      return {
        ...tunnel,
        connections: [],
        status: "inactive",
      };
    } catch (error) {
      this.logger.error(
        LogComponent.API,
        `Failed to create tunnel ${name}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Deletes a tunnel
   * @param tunnelId ID of the tunnel to delete
   * @throws Error if deletion fails
   */
  async deleteTunnel(tunnelId: string): Promise<void> {
    try {
      const accountId = await this.getAccountId();
      await this.makeRequest(
        `/accounts/${accountId}/cfd_tunnel/${tunnelId}`,
        "DELETE",
      );
      this.logger.info(LogComponent.API, `Deleted tunnel: ${tunnelId}`);
    } catch (error) {
      this.logger.error(
        LogComponent.API,
        `Failed to delete tunnel ${tunnelId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Gets the token for a tunnel
   * @param tunnelId ID of the tunnel
   * @returns Tunnel token
   * @throws Error if token cannot be retrieved
   */
  async getTunnelToken(tunnelId: string): Promise<string> {
    try {
      const accountId = await this.getAccountId();
      const response = await this.makeRequest<string>(
        `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
      );
      return response.toString();
    } catch (error) {
      this.logger.error(
        LogComponent.API,
        `Failed to get token for tunnel ${tunnelId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Gets the configurations for a tunnel
   * @param tunnelId ID of the tunnel
   * @returns Tunnel configurations
   * @throws Error if configurations cannot be retrieved
   */
  async getTunnelConfigs(tunnelId: string): Promise<any> {
    try {
      const accountId = await this.getAccountId();
      const configs = await this.makeRequest<any>(
        `/accounts/${accountId}/tunnels/${tunnelId}/configurations`,
      );
      return configs;
    } catch (error) {
      this.logger.error(
        LogComponent.API,
        `Failed to get configs for tunnel ${tunnelId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Normalizes tunnel status based on various fields
   * @param tunnel The tunnel to check status for
   * @returns Normalized status string
   * @private
   */
  private normalizeTunnelStatus(tunnel: CloudflareTunnel): string {
    // If tunnel has an explicit status, use it
    if (tunnel.status === "healthy") {
      return "healthy";
    }

    // If tunnel has active connections, it's running
    if (tunnel.connections && tunnel.connections.length > 0) {
      return "running";
    }

    // If tunnel has active_at time and no inactive_at time, it's running
    if (tunnel.conns_active_at && !tunnel.conns_inactive_at) {
      return "running";
    }

    // If tunnel is marked as down, return down
    if (tunnel.status === "down") {
      return "down";
    }

    // Default to inactive
    return "inactive";
  }
}

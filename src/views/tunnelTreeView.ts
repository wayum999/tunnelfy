import * as vscode from "vscode";
import { TunnelManager, TunnelEvent } from "../services/cloudflared";
import { ProfileManager } from "../services/profileManager";
import { Logger, LogComponent } from "../utils/logger";
import { Messages } from "../utils/messages";
import { CloudflareTunnel } from "../services/cloudflareApi/types";

/**
 * TunnelTreeItem - Represents a single tunnel entry in the VS Code tree view
 *
 * This class extends VS Code's TreeItem, encapsulating tunnel details such as label, tunnel ID,
 * connection URL, and status. It sets up tooltips, descriptions, and icons based on the tunnel's
 * current state (active/inactive) and type (quick tunnel vs. persistent tunnel).
 */
export class TunnelTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tunnelId: string,
    public readonly status: "running" | "stopped",
    public readonly management_type: "remote" | "local",
    public readonly is_running_locally: boolean,
    public readonly port?: number,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);

    // Context value: tunnel-<status>[-remote][-owned]. "-owned" marks a tunnel this
    // extension started, the only kind the Stop menu is offered for.
    this.contextValue = `tunnel-${status}${management_type === "remote" ? "-remote" : ""}${is_running_locally ? "-owned" : ""}`;

    // Create description that includes management type and port info
    const managementInfo =
      management_type === "remote" ? "[Remote]" : "[Local]";
    const portInfo = port && status === "running" ? `(Port ${port})` : "";
    const runningInfo = is_running_locally ? "[Running Locally]" : "";
    this.description =
      `${managementInfo} ${tunnelId} ${portInfo} ${runningInfo}`.trim();

    // Create detailed tooltip
    this.tooltip = new vscode.MarkdownString();
    this.tooltip.appendMarkdown(`**${label}** (${tunnelId})\n\n`);
    this.tooltip.appendMarkdown(
      `**Management**: ${management_type === "remote" ? "Remote" : "Local"}\n\n`,
    );
    if (port && status === "running") {
      this.tooltip.appendMarkdown(`**Port**: ${port}\n\n`);
    }
    this.tooltip.appendMarkdown(`**Status**: ${status}`);
    if (is_running_locally) {
      this.tooltip.appendMarkdown(`\n\n**Running Locally**: Yes`);
    }

    // Set icon based on status
    if (status === "running") {
      this.iconPath = new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    } else {
      this.iconPath = new vscode.ThemeIcon(
        "circle-outline",
        new vscode.ThemeColor("descriptionForeground"),
      );
    }
  }
}

/**
 * Shown in a group when the tunnel list could not be loaded, so a failure is
 * never mistaken for an account with no tunnels. It offers no tunnel actions.
 */
export class TunnelListErrorItem extends TunnelTreeItem {
  constructor(error: unknown, management_type: "remote" | "local") {
    const message = Messages.TUNNEL_LIST_FAILED(error);
    super(message, "list-error", "stopped", management_type, false);
    this.contextValue = "tunnel-list-error";
    this.description = undefined;
    this.tooltip = message;
    this.iconPath = new vscode.ThemeIcon(
      "error",
      new vscode.ThemeColor("errorForeground"),
    );
  }
}

/**
 * Group item for organizing tunnels by management type
 */
export class TunnelGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly management_type: "remote" | "local",
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `tunnel-group-${management_type}`;
    this.iconPath = new vscode.ThemeIcon(
      management_type === "remote" ? "cloud" : "home",
    );
  }
}

/**
 * TunnelTreeDataProvider - Manages the VS Code tree view for Cloudflare tunnels
 *
 * This class implements VS Code's TreeDataProvider interface to display and manage
 * Cloudflare tunnels in a tree view. It handles:
 * 1. Displaying tunnel status and information
 * 2. Refreshing the view when tunnels change
 * 3. Managing tunnel lifecycle events
 * 4. Providing context menu actions
 */
export class TunnelTreeDataProvider
  implements vscode.TreeDataProvider<TunnelTreeItem | TunnelGroupItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    TunnelTreeItem | TunnelGroupItem | undefined | null | void
  > = new vscode.EventEmitter<
    TunnelTreeItem | TunnelGroupItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    TunnelTreeItem | TunnelGroupItem | undefined | null | void
  > = this._onDidChangeTreeData.event;
  private readonly logger = Logger.getInstance();
  private treeView: vscode.TreeView<TunnelTreeItem | TunnelGroupItem>;
  private currentItems: TunnelTreeItem[] = [];

  /**
   * Creates a new instance of TunnelTreeDataProvider
   * @param tunnelManager Service for managing tunnel operations
   * @param profileManager Service for managing Cloudflare profiles
   */
  constructor(
    private readonly tunnelManager: TunnelManager,
    private readonly profileManager: ProfileManager,
  ) {
    // Create the tree view
    this.treeView = vscode.window.createTreeView("tunnelfy-tunnels", {
      treeDataProvider: this,
      showCollapseAll: true,
      canSelectMany: false,
    });

    // Subscribe to tunnel events for automatic updates
    this.tunnelManager.onTunnelEvent((event: TunnelEvent) => {
      this.logger.debug(
        LogComponent.EXTENSION,
        `Tunnel event received: ${event.type} - ${event.tunnelId}`,
      );
      this.refresh();
    });
  }

  /**
   * Gets a tree item for display in the view
   * @param element The tunnel tree item to display
   * @returns The tree item with display properties set
   */
  getTreeItem(element: TunnelTreeItem | TunnelGroupItem): vscode.TreeItem {
    return element;
  }

  /**
   * Gets the parent of a tree item (not used in flat list)
   * @param element The tree item to get parent for
   * @returns The parent group item or null
   */
  getParent(
    element: TunnelTreeItem | TunnelGroupItem,
  ): vscode.ProviderResult<TunnelGroupItem> {
    if (element instanceof TunnelTreeItem) {
      return new TunnelGroupItem(
        element.management_type === "remote"
          ? "Remote-Managed Tunnels"
          : "Locally-Managed Tunnels",
        element.management_type,
      );
    }
    return null;
  }

  /**
   * Gets the child items to display in the tree
   * @param element The parent element (unused in flat list)
   * @returns Array of tunnel tree items or groups
   */
  async getChildren(
    element?: TunnelTreeItem | TunnelGroupItem,
  ): Promise<Array<TunnelTreeItem | TunnelGroupItem>> {
    if (!element) {
      // Root level - return groups
      return [
        new TunnelGroupItem("Remote-Managed Tunnels", "remote"),
        new TunnelGroupItem("Locally-Managed Tunnels", "local"),
      ];
    }

    if (element instanceof TunnelGroupItem) {
      try {
        // Check if there's an active profile
        const activeProfile = await this.profileManager.getActiveProfile();
        if (!activeProfile) {
          // Return a special tree item that prompts the user to create a profile
          const item = new TunnelTreeItem(
            "No Profile Set Up - Click 'Create Profile' in the Profiles view to get started",
            "no-profile",
            "stopped",
            element.management_type,
            false
          );
          // Override the icon to show an info icon
          item.iconPath = new vscode.ThemeIcon("info");
          return [item];
        }

        // Get tunnels from Cloudflare
        const tunnels = await this.tunnelManager.listTunnels();

        this.logger.debug(
          LogComponent.EXTENSION,
          `[TREE DEBUG] Processing tunnels for ${element.management_type} group. Total tunnels: ${tunnels.length}`,
        );

        // Filter tunnels based on group type
        const groupTunnels = (
          tunnels as Array<CloudflareTunnel & { is_running_locally?: boolean }>
        ).filter((tunnel) => {
          // Use remote_config to determine management type
          const tunnelManagementType = tunnel.remote_config
            ? ("remote" as const)
            : ("local" as const);
          this.logger.debug(
            LogComponent.EXTENSION,
            `[TREE DEBUG] Filtering tunnel ${tunnel.name} (${tunnel.id}):
            - remote_config: ${tunnel.remote_config}
            - calculated management type: ${tunnelManagementType}
            - group type: ${element.management_type}
            - matches group: ${tunnelManagementType === element.management_type}`,
          );
          return tunnelManagementType === element.management_type;
        });

        this.logger.debug(
          LogComponent.EXTENSION,
          `[TREE DEBUG] Group results for ${element.management_type}:
          - Total tunnels before filtering: ${tunnels.length}
          - Tunnels matching group: ${groupTunnels.length}
          - Matching tunnel names: ${groupTunnels.map((t) => t.name).join(", ")}`,
        );

        // Create tree items for each tunnel
        const groupItems = await Promise.all(
          groupTunnels.map(async (tunnel) => {
            let port: number | undefined;

            // If tunnel is running, try to get its port from the config
            if (tunnel.connections && tunnel.connections.length > 0) {
              try {
                const config = await this.tunnelManager.getTunnelConfig(
                  tunnel.id,
                );
                if (
                  config &&
                  config.ingress &&
                  config.ingress[0] &&
                  config.ingress[0].service
                ) {
                  const match =
                    config.ingress[0].service.match(/localhost:(\d+)/);
                  if (match) {
                    port = parseInt(match[1], 10);
                  }
                }
              } catch (error) {
                this.logger.debug(
                  LogComponent.EXTENSION,
                  `Could not get port for tunnel ${tunnel.id}: ${error}`,
                );
              }
            }

            // Use remote_config to determine management type
            const management_type = tunnel.remote_config
              ? ("remote" as const)
              : ("local" as const);

            return new TunnelTreeItem(
              tunnel.name,
              tunnel.id,
              tunnel.connections && tunnel.connections.length > 0
                ? "running"
                : "stopped",
              management_type,
              tunnel.is_running_locally || false,
              port,
            );
          }),
        );

        // Update currentItems with the new items from this group
        // Remove existing items of this management type and add new ones
        this.currentItems = [
          ...this.currentItems.filter(
            (item) => item.management_type !== element.management_type,
          ),
          ...groupItems,
        ];

        return groupItems;
      } catch (error) {
        this.logger.error(
          LogComponent.EXTENSION,
          `Failed to get tunnels: ${error}`,
        );
        // Drop this group's stale items so no action targets a tunnel we could not confirm
        this.currentItems = this.currentItems.filter(
          (item) => item.management_type !== element.management_type,
        );
        return [new TunnelListErrorItem(error, element.management_type)];
      }
    }

    return [];
  }

  /**
   * Refreshes the tree view to reflect current tunnel states
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Finds a tunnel tree item by its ID
   * @param tunnelId The ID of the tunnel to find
   * @returns The found tree item or undefined
   */
  findTunnelById(tunnelId: string): TunnelTreeItem | undefined {
    return this.currentItems.find((item) => item.tunnelId === tunnelId);
  }

  /**
   * Disposes of the tree view and its resources
   */
  dispose(): void {
    this.treeView.dispose();
  }

  private getTunnelTooltip(tunnel: TunnelTreeItem): string {
    return `${tunnel.label} (${tunnel.tunnelId}) - ${tunnel.status === "running" ? "Active" : "Inactive"}`;
  }
}

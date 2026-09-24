import * as vscode from "vscode";
import { TunnelManager } from "../services/cloudflared";
import { CloudflareApiService } from "../services/cloudflareApi";
import { TokenAuditService } from "../services/tokenAuditService";
import { copyTokenToClipboard } from "../utils/clipboard";
import { TunnelTreeItem } from "../views/tunnelTreeView";
import { ProfileManager } from "../services/profileManager";
import { TunnelTreeDataProvider } from "../views/tunnelTreeView";
import { Messages } from "../utils/messages";
import { DockerComposeGenerator } from "../services/dockerComposeGenerator";
import { SystemServiceGenerator } from "../services/systemServiceGenerator";
import { Logger, LogComponent } from "../utils/logger";
import { checkAndPromptCloudflared } from "../utils/cloudflaredUtils";
import { ServiceGenerator, ServiceType } from "../services/serviceGenerator";
import { tunnelNameError } from "../services/serviceFiles";

// Type for DNS record QuickPick items
type DnsRecordQuickPickItem = {
  label: string;
  description: string;
  isNew: boolean;
  record?: {
    id: string;
    name: string;
    type: string;
    content: string;
  };
};

/**
 * Arguments for `tunnelfy.generateService` when invoked from a tunnel tree item:
 * the item's id and name, so the command skips the tunnel picker. Without an item
 * both are undefined and the command falls back to the picker.
 */
export function serviceCommandArgs(
  item: TunnelTreeItem | undefined,
  serviceType: ServiceType,
): [string | undefined, string | undefined, ServiceType] {
  return [item?.tunnelId, item?.label, serviceType];
}

export function registerTunnelCommands(
  context: vscode.ExtensionContext,
  tunnelManager: TunnelManager,
  apiService: CloudflareApiService,
  tokenAuditService: TokenAuditService,
  profileManager: ProfileManager,
  tunnelProvider: TunnelTreeDataProvider,
  serviceGenerator: ServiceGenerator,
  logger: Logger,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  
  // Create Docker Compose generator for backward compatibility
  const dockerComposeGenerator = new DockerComposeGenerator(tunnelManager, apiService);

  // Copy Token Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.copyToken",
      async (item?: TunnelTreeItem) => {
        try {
          // If called from tree view, use the selected item
          if (item?.tunnelId) {
            const token = await apiService.getTunnelToken(item.tunnelId);
            if (token) {
              const disposable = await copyTokenToClipboard(token, tokenAuditService);
              context.subscriptions.push(disposable);
              await Messages.showInfo(Messages.TOKEN_COPIED);
            }
            return;
          }

          // If called from command palette, show QuickPick
          const allTunnels = await apiService.listTunnels();
          if (!allTunnels || allTunnels.length === 0) {
            await Messages.showInfo("No tunnels available.");
            return;
          }

          const selected = await vscode.window.showQuickPick(
            allTunnels.map((tunnel) => ({
              label: tunnel.name,
              description: `ID: ${tunnel.id}`,
              detail:
                tunnel.connections && tunnel.connections.length > 0
                  ? "Running"
                  : "Stopped",
              tunnelId: tunnel.id,
            })),
            {
              placeHolder: "Select a tunnel to copy its token",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            const token = await apiService.getTunnelToken(selected.tunnelId);
            if (token) {
              const disposable = await copyTokenToClipboard(token, tokenAuditService);
              context.subscriptions.push(disposable);
              await Messages.showInfo(Messages.TOKEN_COPIED);
            }
          }
        } catch (error) {
          await Messages.showError(Messages.ERROR_COPY_TOKEN(error));
        }
      },
    ),
  );

  // Create Tunnel Command
  disposables.push(
    vscode.commands.registerCommand("tunnelfy.createTunnel", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Enter a name for the new tunnel",
        placeHolder: "my-tunnel",
        validateInput: (value) => tunnelNameError(value),
      });

            if (name) {
                try {
                    // Let user select management type
                    const managementType = await vscode.window.showQuickPick(
                        [
                            {
                                label: 'Local Management',
                                description: 'Manage tunnel configuration locally',
                                value: 'local' as const
                            },
                            {
                                label: 'Remote Management',
                                description: 'Manage tunnel configuration through Cloudflare dashboard',
                                value: 'remote' as const
                            }
                        ],
                        {
                            placeHolder: 'Select how you want to manage this tunnel',
                            ignoreFocusOut: true
                        }
                    );

                    if (!managementType) {
                        return;
                    }

                    const tunnel = await tunnelManager.createTunnel(name, managementType.value);
                    await tunnelProvider.refresh();
                    await Messages.showInfo(Messages.TUNNEL_CREATED(tunnel.name));
                } catch (error) {
                    await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));
                }
            }
        })
    );

  // Delete Tunnel Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.deleteTunnel",
      async (item?: TunnelTreeItem) => {
        try {
          // If called from tree view, use the selected item
          if (item?.tunnelId) {
            const confirm = await Messages.showModal(
              `Are you sure you want to delete tunnel '${item.label}'?`,
              "Delete",
            );

            if (confirm === "Delete") {
              await tunnelManager.deleteTunnel(item.tunnelId);
              await tunnelProvider.refresh();
              await Messages.showInfo(Messages.TUNNEL_DELETED(item.label));
            }
            return;
          }

          // If called from command palette, show QuickPick
          const allTunnels = await apiService.listTunnels();
          if (!allTunnels || allTunnels.length === 0) {
            await Messages.showInfo("No tunnels available to delete.");
            return;
          }

          // Filter out running tunnels as they can't be deleted
          const deletableTunnels = allTunnels.filter(
            (tunnel) => !tunnel.connections || tunnel.connections.length === 0,
          );

          if (deletableTunnels.length === 0) {
            await Messages.showInfo(
              "No stopped tunnels available to delete. Please stop any running tunnels first.",
            );
            return;
          }

          const selected = await vscode.window.showQuickPick(
            deletableTunnels.map((tunnel) => ({
              label: tunnel.name,
              description: `ID: ${tunnel.id}`,
              detail: "Stopped",
              tunnelId: tunnel.id,
            })),
            {
              placeHolder: "Select a tunnel to delete",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            // Show confirmation dialog
            const confirm = await Messages.showModal(
              `Are you sure you want to delete tunnel '${selected.label}'?`,
              "Delete",
            );

            if (confirm === "Delete") {
              await tunnelManager.deleteTunnel(selected.tunnelId);
              await tunnelProvider.refresh();
              await Messages.showInfo(Messages.TUNNEL_DELETED(selected.label));
            }
          }
        } catch (error) {
          await Messages.showError(Messages.ERROR_DELETE_TUNNEL(error));
        }
      },
    ),
  );

  // Start Tunnel Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.startTunnel",
      async (item?: TunnelTreeItem) => {
        try {
          // Check for cloudflared first
          if (!await checkAndPromptCloudflared(logger)) {
            return;
          }

          // Get all tunnels and filter for stopped ones
          const allTunnels = await apiService.listTunnels();
          const stoppedTunnels = allTunnels.filter((tunnel) => {
            // A tunnel is considered stopped if it has no active connections
            return !tunnel.connections || tunnel.connections.length === 0;
          });
          logger.debug(
            LogComponent.COMMAND,
            `startTunnel: ${stoppedTunnels.length} of ${allTunnels.length} tunnels stopped`,
          );

          if (stoppedTunnels.length === 0) {
            await Messages.showInfo("No stopped tunnels available to start.");
            return;
          }

          // If called from tree view, use the selected item
          const tunnelToStart = item
            ? {
                tunnelId: item.tunnelId,
                label: item.label,
              }
            : await vscode.window.showQuickPick(
                stoppedTunnels.map((tunnel) => ({
                  label: tunnel.name,
                  description: `ID: ${tunnel.id}`,
                  tunnelId: tunnel.id,
                })),
                {
                  placeHolder: "Select a tunnel to start",
                  ignoreFocusOut: true,
                },
              );

          if (!tunnelToStart) {
            return;
          }

          // Get port number
          const addressInput = await vscode.window.showInputBox({
            prompt: Messages.ADDRESS_INPUT_PROMPT,
            placeHolder: "http://localhost:8080",
            ignoreFocusOut: true,
            validateInput: (value) => {
              // First try to parse as URL
              try {
                new URL(value);
                return null; // Valid URL
              } catch (error) {
                // If not a valid URL, check if it's a valid port number
                const port = parseInt(value, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                  return Messages.ADDRESS_INPUT_VALIDATION_ERROR;
                }
                return null; // Valid port number
              }
            },
          });

          if (!addressInput) {
            return;
          }

          // Parse address input
          let portNumber: number;
          let targetUrl: string;
          
          try {
            // Try to parse as URL
            new URL(addressInput);
            targetUrl = addressInput;
            // Extract port from URL if present, or use default port
            const url = new URL(addressInput);
            portNumber = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
          } catch (error) {
            // Not a valid URL, treat as port
            portNumber = parseInt(addressInput, 10);
            targetUrl = `http://localhost:${portNumber}`;
          }

          // Get zones (domains) from Cloudflare
          const zones = await apiService.listZones();
          if (!zones || zones.length === 0) {
            throw new Error("No domains found in your Cloudflare account");
          }

          // Let user select a zone
          const selectedZone = await vscode.window.showQuickPick(
            zones.map((zone) => ({
              label: zone.name,
              description: `Zone ID: ${zone.id}`,
              zone,
            })),
            {
              placeHolder: "Select a domain for your tunnel",
              ignoreFocusOut: true,
            },
          );

          if (!selectedZone) {
            return;
          }

          // Get DNS records for the selected zone
          const records = await apiService.listDnsRecords(selectedZone.zone.id);

          // Add option to create a new subdomain and filter out TXT records
          const quickPickItems: DnsRecordQuickPickItem[] = [
            {
              label: "$(add) Create new subdomain",
              description: `Will create a new DNS record in ${selectedZone.zone.name}`,
              isNew: true,
            },
            ...records
              .filter((record) => record.type !== "TXT") // Filter out TXT records
              .map((record) => ({
                label: record.name,
                description: `Type: ${record.type}, Content: ${record.content}`,
                record,
                isNew: false,
              })),
          ];

          // Let user select a record or create new
          const selectedRecord = await vscode.window.showQuickPick(
            quickPickItems,
            {
              placeHolder: "Select existing record or create new",
              ignoreFocusOut: true,
            },
          );

          if (!selectedRecord) {
            return;
          }

          let hostname: string;

          if (selectedRecord.isNew) {
            // Get subdomain from user
            const subdomain = await vscode.window.showInputBox({
              prompt: `Enter subdomain (will be created as [subdomain].${selectedZone.zone.name})`,
              placeHolder: "myapp",
              validateInput: (value) => {
                if (!value.match(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/)) {
                  return "Subdomain must contain only letters, numbers, and hyphens, and cannot start or end with a hyphen";
                }
                return null;
              },
            });

            if (!subdomain) {
              return;
            }

            // Create the full hostname
            hostname = `${subdomain}.${selectedZone.zone.name}`;

            // Create the DNS record
            await apiService.createCnameRecord(
              selectedZone.zone.id,
              subdomain,
              tunnelToStart.tunnelId,
            );
          } else {
            // Using existing CNAME record
            hostname = selectedRecord.record!.name;

            // Check if the CNAME needs to be updated
            const tunnelDomain = `${tunnelToStart.tunnelId}.cfargotunnel.com`;
            if (selectedRecord.record!.content !== tunnelDomain) {
              const confirm = await Messages.showModal(
                `The CNAME record "${hostname}" currently points to "${selectedRecord.record!.content}". Would you like to update it?`,
                "Update",
                "Cancel",
              );

              if (confirm === "Update") {
                await apiService.updateCnameRecord(
                  selectedZone.zone.id,
                  selectedRecord.record!.id,
                  tunnelToStart.tunnelId,
                );
              } else {
                return;
              }
            }
          }

          // Get account ID from active profile
          const activeProfile = await profileManager.getActiveProfile();
          if (!activeProfile) {
            throw new Error("No active profile found");
          }
          const accountId =
            await profileManager.getProfileAccountId(activeProfile);
          if (!accountId) {
            throw new Error("No account ID found in active profile");
          }

          // Update tunnel configuration. Credentials are left as stored; the token is never part of it.
          const config = {
            accountId,
            tunnelId: tunnelToStart.tunnelId,
            tunnelName: tunnelToStart.label,
            ingress: [
              {
                hostname,
                service: targetUrl,
              },
              {
                service: "http_status:404",
              },
            ],
          };
          await tunnelManager.updateTunnelConfig(
            tunnelToStart.tunnelId,
            config,
          );

          // Start the tunnel
          await tunnelManager.runTunnel(
            tunnelToStart.tunnelId,
            targetUrl as any, // Type cast to avoid TypeScript error
          );
          logger.debug(
            LogComponent.COMMAND,
            `startTunnel: started tunnel ${tunnelToStart.tunnelId}`,
          );
          await tunnelProvider.refresh();

          await Messages.showInfo(
            Messages.TUNNEL_STARTED(
              tunnelToStart.label,
              hostname,
              targetUrl,
            ),
          );
        } catch (error) {
          logger.error(
            LogComponent.COMMAND,
            `startTunnel failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          await Messages.showError(Messages.ERROR_START_TUNNEL(error));
        }
      },
    ),
  );

  // Stop Tunnel Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.stopTunnel",
      async (item?: TunnelTreeItem) => {
        try {
          // If called from tree view, use the selected item
          if (item?.tunnelId) {
            // Add confirmation dialog
            const confirm = await Messages.showModal(
              `Are you sure you want to stop tunnel '${item.label}'?`,
              "Stop",
              "Cancel",
            );

            if (confirm !== "Stop") {
              return;
            }

            await tunnelManager.stopTunnel(item.tunnelId);
            await tunnelProvider.refresh();
            await Messages.showInfo(Messages.TUNNEL_STOPPED(item.label));
            return;
          }

          // If called from command palette, show QuickPick
          const allTunnels = await apiService.listTunnels();
          const runningTunnels = allTunnels.filter(
            (tunnel) => tunnel.connections && tunnel.connections.length > 0,
          );

          if (!runningTunnels || runningTunnels.length === 0) {
            await Messages.showInfo("No running tunnels available to stop.");
            return;
          }

          const selected = await vscode.window.showQuickPick(
            runningTunnels.map((tunnel) => ({
              label: tunnel.name,
              description: `ID: ${tunnel.id}`,
              detail: `${tunnel.connections?.length || 0} active connection(s)`,
              tunnelId: tunnel.id,
            })),
            {
              placeHolder: "Select a tunnel to stop",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            // Add confirmation dialog
            const confirm = await Messages.showModal(
              `Are you sure you want to stop tunnel '${selected.label}'?`,
              "Stop",
              "Cancel",
            );

            if (confirm !== "Stop") {
              return;
            }

            await tunnelManager.stopTunnel(selected.tunnelId);
            await tunnelProvider.refresh();
            await Messages.showInfo(Messages.TUNNEL_STOPPED(selected.label));
          }
        } catch (error) {
          await Messages.showError(Messages.ERROR_STOP_TUNNEL(error));
        }
      },
    ),
  );

  // Refresh Tunnels Command
  disposables.push(
    vscode.commands.registerCommand("tunnelfy.refreshTunnels", async () => {
      try {
        await tunnelProvider.refresh();
        await Messages.showInfo(Messages.TUNNELS_REFRESHED);
      } catch (error) {
        await Messages.showError(Messages.ERROR_REFRESH_TUNNELS(error));
      }
    }),
  );

  // Generate Service Command (unified)
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.generateService",
      async (tunnelId?: string, tunnelName?: string, serviceType?: ServiceType) => {
        try {
          // If called with specific tunnel ID and name (from another command or test)
          if (tunnelId && tunnelName) {
            // Get port from user if not running
            const port = await vscode.window.showInputBox({
              prompt: "Enter the port number for the tunnel",
              placeHolder: "8080",
              validateInput: (value) => {
                const port = parseInt(value);
                if (isNaN(port) || port < 1 || port > 65535) {
                  return "Please enter a valid port number (1-65535)";
                }
                return null;
              },
            });

            if (!port) {
              return;
            }

            // If service type is not provided, show quick pick to select type
            if (!serviceType) {
              const options = [
                {
                  label: "Docker Compose",
                  description: "Generate Docker Compose configuration files",
                  value: "docker" as ServiceType,
                },
                {
                  label: "System Service",
                  description: "Generate systemd service configuration files",
                  value: "system" as ServiceType,
                },
              ];

              const selection = await vscode.window.showQuickPick(options, {
                placeHolder: "Select service configuration type to generate",
                title: "Generate Service Configuration",
              });

              if (!selection) {
                return;
              }

              serviceType = selection.value;
            }

            const result = await serviceGenerator.generateServiceFile(
              tunnelId,
              tunnelName,
              parseInt(port),
              serviceType
            );
            await Messages.showInfo(Messages.SERVICE_GENERATED(result));
            return;
          }

          // If called from command palette or title bar, show QuickPick to select tunnel
          const allTunnels = await apiService.listTunnels();
          if (!allTunnels || allTunnels.length === 0) {
            await Messages.showInfo("No tunnels available.");
            return;
          }

          const selected = await vscode.window.showQuickPick(
            allTunnels.map((tunnel) => ({
              label: tunnel.name,
              description: `ID: ${tunnel.id}`,
              detail:
                tunnel.connections && tunnel.connections.length > 0
                  ? "Running"
                  : "Stopped",
              tunnelId: tunnel.id,
            })),
            {
              placeHolder:
                "Select a tunnel to generate service files for",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            // Get port from user
            const port = await vscode.window.showInputBox({
              prompt: "Enter the port number for the tunnel",
              placeHolder: "8080",
              validateInput: (value) => {
                const port = parseInt(value);
                if (isNaN(port) || port < 1 || port > 65535) {
                  return "Please enter a valid port number (1-65535)";
                }
                return null;
              },
            });

            if (port) {
              // If service type is not provided, show quick pick to select type
              if (!serviceType) {
                const options = [
                  {
                    label: "Docker Compose",
                    description: "Generate Docker Compose configuration files",
                    value: "docker" as ServiceType,
                  },
                  {
                    label: "System Service",
                    description: "Generate systemd service configuration files",
                    value: "system" as ServiceType,
                  },
                ];

                const selection = await vscode.window.showQuickPick(options, {
                  placeHolder: "Select service configuration type to generate",
                  title: "Generate Service Configuration",
                });

                if (!selection) {
                  return;
                }

                serviceType = selection.value;
              }

              const result = await serviceGenerator.generateServiceFile(
                selected.tunnelId,
                selected.label,
                parseInt(port),
                serviceType
              );
              await Messages.showInfo(Messages.SERVICE_GENERATED(result));
            }
          }
        } catch (error) {
          await Messages.showError(Messages.ERROR_GENERATE_SERVICE(error));
        }
      },
    ),
  );

  // Keep the old commands for backward compatibility but make them use the new service generator
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.generateDockerCompose",
      async (item?: TunnelTreeItem) => {
        return vscode.commands.executeCommand(
          "tunnelfy.generateService",
          ...serviceCommandArgs(item, "docker"),
        );
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.generateSystemService",
      async (item?: TunnelTreeItem) => {
        return vscode.commands.executeCommand(
          "tunnelfy.generateService",
          ...serviceCommandArgs(item, "system"),
        );
      }
    )
  );

  // Add all disposables to the extension context
  disposables.forEach((d) => context.subscriptions.push(d));

  return disposables;
}

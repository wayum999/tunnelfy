import * as vscode from "vscode";
import {
  QuickTunnelTreeDataProvider,
  QuickTunnelTreeItem,
} from "../views/quickTunnelTreeView";
import { Messages } from "../utils/messages";
import { Logger, LogComponent } from "../utils/logger";
import { checkAndPromptCloudflared } from '../utils/cloudflaredUtils';
import { StopResult } from "../services/cloudflared";

/**
 * Tells the user what a quick-tunnel stop actually did; the "stopped" message
 * appears only for a stopped outcome.
 */
export async function reportQuickTunnelStop(
  result: StopResult,
  name: string | undefined,
  port: number,
): Promise<void> {
  switch (result.outcome) {
    case "stopped":
      await Messages.showInfo(Messages.QUICK_TUNNEL_STOPPED(name, port));
      return;
    case "not-owned":
      await Messages.showWarning(Messages.QUICK_TUNNEL_NOT_OWNED(port));
      return;
    case "failed":
      await Messages.showError(
        Messages.TUNNEL_STOP_FAILED(name ?? `quick tunnel on port ${port}`, result.reason),
      );
      return;
  }
}

export function registerQuickTunnelCommands(
  context: vscode.ExtensionContext,
  quickTunnelProvider: QuickTunnelTreeDataProvider,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  const logger = Logger.getInstance();

  // Create Quick Tunnel Command
  disposables.push(
    vscode.commands.registerCommand("tunnelfy.createQuickTunnel", async () => {
      try {
        // Check for cloudflared first
        if (!await checkAndPromptCloudflared(logger)) {
          return;
        }

        // Get tunnel name (optional)
        const name = await vscode.window.showInputBox({
          prompt: "Enter a name for the quick tunnel (optional)",
          placeHolder: "my-quick-tunnel",
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (value && value.trim().length === 0) {
              return "Name cannot be empty if provided";
            }
            return null;
          },
        });

        // If user cancelled the name input, exit immediately
        if (name === undefined) {
          return;
        }

        // Get port number
        const portInput = await vscode.window.showInputBox({
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

        // If user cancelled the port input, exit immediately
        if (portInput === undefined) {
          return;
        }

        // Check if input is a port number or a full URL
        let portNumber: number | undefined;

        try {
          // Try to parse as URL first
          new URL(portInput);
          // If it's a valid URL, pass it directly to the quick tunnel provider
          logger.info(
            LogComponent.COMMAND,
            `Creating quick tunnel${name ? ` "${name}"` : ""} with URL ${portInput}`,
          );
          await quickTunnelProvider.addQuickTunnel(portInput as any, name);
          return;
        } catch (error) {
          // Not a valid URL, try to parse as port number
          portNumber = parseInt(portInput, 10);
          if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
            return;
          }
        }

        // Only proceed with tunnel creation if we have both inputs
        // Only pass the name if it's not empty
        const tunnelName = name?.trim() || undefined;
        logger.info(
          LogComponent.COMMAND,
          `Creating quick tunnel${tunnelName ? ` "${tunnelName}"` : ""} on port ${portNumber}`,
        );
        await quickTunnelProvider.addQuickTunnel(portNumber, tunnelName);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("cloudflared not found")) {
          logger.error(
            LogComponent.COMMAND,
            "Failed to create quick tunnel: cloudflared not found",
            error,
          );
          const platform = process.platform;
          let installInstructions = "";

          switch (platform) {
            case "darwin":
              installInstructions = Messages.CLOUDFLARED_INSTALL_DARWIN;
              break;
            case "win32":
              installInstructions = Messages.CLOUDFLARED_INSTALL_WIN32;
              break;
            case "linux":
              installInstructions = Messages.CLOUDFLARED_INSTALL_LINUX;
              break;
            default:
              installInstructions = Messages.CLOUDFLARED_INSTALL_DEFAULT;
          }

          const CLOUDFLARED_INSTALL_URL = Messages.CLOUDFLARED_INSTALL_DOCS;

          const response = await vscode.window.showErrorMessage(
            Messages.CLOUDFLARED_NOT_FOUND.message,
            {
              modal: true,
              detail: Messages.CLOUDFLARED_NOT_FOUND.detail,
            },
            Messages.CLOUDFLARED_INSTALL_ACTION,
          );

          if (response === Messages.CLOUDFLARED_INSTALL_ACTION) {
            await vscode.env.openExternal(
              vscode.Uri.parse(CLOUDFLARED_INSTALL_URL),
            );
          }
        } else {
          logger.error(
            LogComponent.COMMAND,
            `Failed to create quick tunnel: ${errorMessage}`,
            error,
          );
          Messages.showError(Messages.ERROR_GENERIC(errorMessage));
        }
      }
    }),
  );

  // Stop Quick Tunnel Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.stopQuickTunnel",
      async (item?: QuickTunnelTreeItem) => {
        try {
          // If called from tree view, use the selected item
          if (item?.tunnelId) {
            // Show confirmation dialog
            const confirm = await Messages.showModal(
              `Are you sure you want to stop the quick tunnel${item.name ? ` "${item.name}"` : ""} on port ${item.port}?`,
              "Stop",
            );

            if (confirm === "Stop") {
              const result = await quickTunnelProvider.removeQuickTunnel(item.tunnelId);
              await reportQuickTunnelStop(result, item.name, item.port);
            }
            return;
          }

          // If called from command palette, show QuickPick
          const quickTunnels = await quickTunnelProvider.getChildren();
          if (!quickTunnels || quickTunnels.length === 0) {
            await Messages.showInfo("No quick tunnels available to stop.");
            return;
          }

          const selected = await vscode.window.showQuickPick(
            quickTunnels.map((tunnel) => ({
              label: tunnel.name || `Quick Tunnel on port ${tunnel.port}`,
              description: `Port: ${tunnel.port}`,
              detail: tunnel.tunnelUrl || "URL not available",
              port: tunnel.port,
              name: tunnel.name,
              tunnelId: tunnel.tunnelId,
            })),
            {
              placeHolder: "Select a quick tunnel to stop",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            // Show confirmation dialog
            const confirm = await Messages.showModal(
              `Are you sure you want to stop the quick tunnel${selected.name ? ` "${selected.name}"` : ""} on port ${selected.port}?`,
              "Stop",
            );

            if (confirm === "Stop") {
              const result = await quickTunnelProvider.removeQuickTunnel(selected.tunnelId);
              await reportQuickTunnelStop(result, selected.name, selected.port);
            }
          }
        } catch (error) {
          logger.error(
            LogComponent.COMMAND,
            "Failed to stop quick tunnel",
            error,
          );
          await Messages.showError(Messages.ERROR_STOP_TUNNEL(error));
        }
      },
    ),
  );

  // Copy Quick Tunnel URL Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.copyQuickTunnelUrl",
      async (item: QuickTunnelTreeItem) => {
        if (item.tunnelUrl) {
          try {
            await vscode.env.clipboard.writeText(item.tunnelUrl);
            logger.info(
              LogComponent.COMMAND,
              `Copied tunnel URL: ${item.tunnelUrl}`,
            );
            await Messages.showInfo(Messages.TUNNEL_URL_COPIED);
          } catch (error) {
            logger.error(
              LogComponent.COMMAND,
              "Failed to copy tunnel URL",
              error,
            );
            await Messages.showError(Messages.ERROR_COPY_URL(error));
          }
        } else {
          logger.warn(
            LogComponent.COMMAND,
            "Attempted to copy tunnel URL but none was available",
          );
          await Messages.showError(Messages.NO_TUNNEL_URL);
        }
      },
    ),
  );

  // Refresh Quick Tunnels Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.refreshQuickTunnels",
      async () => {
        try {
          quickTunnelProvider.refresh();
          await Messages.showInfo("Quick tunnel list has been refreshed.");
        } catch (error) {
          await Messages.showError(Messages.ERROR_GENERIC(error));
        }
      },
    ),
  );

  // Add all disposables to the extension context
  disposables.forEach((d) => context.subscriptions.push(d));

  return disposables;
}

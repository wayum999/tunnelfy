import * as vscode from 'vscode';
import { QuickTunnelTreeDataProvider, QuickTunnelTreeItem } from '../views/quickTunnelTreeView';
import { Messages } from '../utils/messages';
import { CloudflaredNotFoundError } from '../services/cloudflared';

export function registerQuickTunnelCommands(
    context: vscode.ExtensionContext,
    quickTunnelProvider: QuickTunnelTreeDataProvider
) {
    // Create Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.createQuickTunnel', async () => {
            try {
                // Check for cloudflared first
                await quickTunnelProvider.tunnelManager.findCloudflaredPath();
            } catch (error: any) {
                if (error instanceof CloudflaredNotFoundError) {
                    const response = await Messages.showModal(
                        Messages.CLOUDFLARED_NOT_FOUND,
                        Messages.CLOUDFLARED_INSTALL_ACTION
                    );

                    if (response === Messages.CLOUDFLARED_INSTALL_ACTION) {
                        await vscode.env.openExternal(vscode.Uri.parse(Messages.CLOUDFLARED_INSTALL_DOCS));
                    }
                    return; // Exit early if cloudflared is not found
                }
                // If it's some other error, show it to the user
                await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));
                return;
            }

            // Get tunnel name (optional)
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the quick tunnel (optional)',
                placeHolder: 'my-quick-tunnel'
            });

            // Get port number
            const port = await vscode.window.showInputBox({
                prompt: 'Enter the local port to create a quick tunnel',
                placeHolder: '8080',
                validateInput: (value) => {
                    const port = parseInt(value, 10);
                    if (isNaN(port) || port < 1 || port > 65535) {
                        return 'Please enter a valid port number (1-65535)';
                    }
                    return null;
                }
            });

            if (port) {
                try {
                    await quickTunnelProvider.addQuickTunnel(parseInt(port, 10), name);
                    await Messages.showInfo(Messages.QUICK_TUNNEL_CREATED(name, port));
                } catch (error) {
                    await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));
                }
            }
        })
    );

    // Stop Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.stopQuickTunnel', async (item?: QuickTunnelTreeItem) => {
            try {
                // If called from tree view, use the selected item
                if (item?.port) {
                    await quickTunnelProvider.removeQuickTunnel(item.port);
                    await Messages.showInfo(Messages.QUICK_TUNNEL_STOPPED(item.name, item.port));
                    return;
                }

                // If called from command palette, show QuickPick
                const quickTunnels = await quickTunnelProvider.getChildren();
                if (!quickTunnels || quickTunnels.length === 0) {
                    await Messages.showInfo('No quick tunnels available to stop.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    quickTunnels.map(tunnel => ({
                        label: tunnel.name || `Quick Tunnel on port ${tunnel.port}`,
                        description: `Port: ${tunnel.port}`,
                        detail: tunnel.tunnelUrl || 'URL not available',
                        port: tunnel.port,
                        name: tunnel.name
                    })),
                    {
                        placeHolder: 'Select a quick tunnel to stop',
                        ignoreFocusOut: true
                    }
                );

                if (selected) {
                    await quickTunnelProvider.removeQuickTunnel(selected.port);
                    await Messages.showInfo(Messages.QUICK_TUNNEL_STOPPED(selected.name, selected.port));
                }
            } catch (error) {
                await Messages.showError(Messages.ERROR_STOP_TUNNEL(error));
            }
        })
    );

    // Copy Quick Tunnel URL Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.copyQuickTunnelUrl', async (item: QuickTunnelTreeItem) => {
            if (item.tunnelUrl) {
                try {
                    await vscode.env.clipboard.writeText(item.tunnelUrl);
                    await Messages.showInfo(Messages.TUNNEL_URL_COPIED);
                } catch (error) {
                    await Messages.showError(Messages.ERROR_COPY_URL(error));
                }
            } else {
                await Messages.showError(Messages.NO_TUNNEL_URL);
            }
        })
    );
} 
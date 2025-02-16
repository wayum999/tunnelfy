import * as vscode from 'vscode';
import { QuickTunnelTreeDataProvider, QuickTunnelTreeItem } from '../views/quickTunnelTreeView';
import { Messages } from '../utils/messages';

export function registerQuickTunnelCommands(
    context: vscode.ExtensionContext,
    quickTunnelProvider: QuickTunnelTreeDataProvider
) {
    // Create Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.createQuickTunnel', async () => {
            try {
                // Get tunnel name (optional)
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter a name for the quick tunnel (optional)',
                    placeHolder: 'my-quick-tunnel',
                    validateInput: (value) => {
                        if (value && value.trim().length === 0) {
                            return 'Name cannot be empty if provided';
                        }
                        return null;
                    }
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
                        // Only pass the name if it's not empty
                        const tunnelName = name?.trim() || undefined;
                        await quickTunnelProvider.addQuickTunnel(parseInt(port, 10), tunnelName);
                    } catch (error: any) {
                        if (error.message?.includes('cloudflared not found')) {
                            const platform = process.platform;
                            let installInstructions = '';
                            
                            switch (platform) {
                                case 'darwin':
                                    installInstructions = Messages.CLOUDFLARED_INSTALL_DARWIN;
                                    break;
                                case 'win32':
                                    installInstructions = Messages.CLOUDFLARED_INSTALL_WIN32;
                                    break;
                                case 'linux':
                                    installInstructions = Messages.CLOUDFLARED_INSTALL_LINUX;
                                    break;
                                default:
                                    installInstructions = Messages.CLOUDFLARED_INSTALL_DEFAULT;
                            }

                            const CLOUDFLARED_INSTALL_URL = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/';
                            
                            const response = await vscode.window.showErrorMessage(
                                Messages.CLOUDFLARED_NOT_FOUND,
                                { 
                                    modal: true, 
                                    detail: installInstructions 
                                },
                                Messages.CLOUDFLARED_INSTALL_ACTION
                            );

                            if (response === Messages.CLOUDFLARED_INSTALL_ACTION) {
                                await vscode.env.openExternal(vscode.Uri.parse(CLOUDFLARED_INSTALL_URL));
                            }
                            return;
                        }
                        await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));
                    }
                }
            } catch (error) {
                await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));
            }
        })
    );

    // Stop Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.stopQuickTunnel', async (item?: QuickTunnelTreeItem) => {
            try {
                // If called from tree view, use the selected item
                if (item?.port) {
                    // Show confirmation dialog
                    const confirm = await Messages.showModal(
                        `Are you sure you want to stop the quick tunnel${item.name ? ` "${item.name}"` : ''} on port ${item.port}?`,
                        'Stop'
                    );

                    if (confirm === 'Stop') {
                        await quickTunnelProvider.removeQuickTunnel(item.port);
                        await Messages.showInfo(Messages.QUICK_TUNNEL_STOPPED(item.name, item.port));
                    }
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
                    // Show confirmation dialog
                    const confirm = await Messages.showModal(
                        `Are you sure you want to stop the quick tunnel${selected.name ? ` "${selected.name}"` : ''} on port ${selected.port}?`,
                        'Stop'
                    );

                    if (confirm === 'Stop') {
                        await quickTunnelProvider.removeQuickTunnel(selected.port);
                        await Messages.showInfo(Messages.QUICK_TUNNEL_STOPPED(selected.name, selected.port));
                    }
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
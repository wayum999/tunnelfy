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
        vscode.commands.registerCommand('tunnelfy.stopQuickTunnel', async (item: QuickTunnelTreeItem) => {
            try {
                await quickTunnelProvider.removeQuickTunnel(item.port);
                await Messages.showInfo(Messages.QUICK_TUNNEL_STOPPED(item.name, item.port));
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
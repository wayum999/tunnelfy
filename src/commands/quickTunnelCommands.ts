import * as vscode from 'vscode';
import { QuickTunnelTreeDataProvider, QuickTunnelTreeItem } from '../views/quickTunnelTreeView';

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
                    vscode.window.showInformationMessage(
                        `Created quick tunnel${name ? ` "${name}"` : ''} on port ${port}`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create quick tunnel: ${error}`);
                }
            }
        })
    );

    // Stop Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.stopQuickTunnel', async (item: QuickTunnelTreeItem) => {
            try {
                await quickTunnelProvider.removeQuickTunnel(item.port);
                vscode.window.showInformationMessage(
                    `Stopped quick tunnel${item.name ? ` "${item.name}"` : ''} on port ${item.port}`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop quick tunnel: ${error}`);
            }
        })
    );

    // Copy Quick Tunnel URL Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.copyQuickTunnelUrl', async (item: QuickTunnelTreeItem) => {
            if (item.tunnelUrl) {
                try {
                    await vscode.env.clipboard.writeText(item.tunnelUrl);
                    vscode.window.showInformationMessage('Tunnel URL copied to clipboard');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to copy tunnel URL: ${error}`);
                }
            } else {
                vscode.window.showErrorMessage('No tunnel URL available');
            }
        })
    );
} 
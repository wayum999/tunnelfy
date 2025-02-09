import * as vscode from 'vscode';
import { QuickTunnelTreeDataProvider } from '../views/quickTunnelTreeView';

export function registerQuickTunnelCommands(
    context: vscode.ExtensionContext,
    quickTunnelProvider: QuickTunnelTreeDataProvider
) {
    // Create Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.createQuickTunnel', async () => {
            const port = await vscode.window.showInputBox({
                prompt: 'Enter the local port to create a quick tunnel',
                placeHolder: '8080'
            });

            if (port) {
                try {
                    await quickTunnelProvider.addQuickTunnel(parseInt(port, 10));
                    vscode.window.showInformationMessage(`Created quick tunnel on port ${port}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create quick tunnel: ${error}`);
                }
            }
        })
    );

    // Stop Quick Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.stopQuickTunnel', async (item: { port: number }) => {
            try {
                await quickTunnelProvider.removeQuickTunnel(item.port);
                vscode.window.showInformationMessage(`Stopped quick tunnel on port ${item.port}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop quick tunnel: ${error}`);
            }
        })
    );
} 
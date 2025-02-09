import * as vscode from 'vscode';
import { TunnelManager } from '../services/cloudflared';
import { CloudflareApiService } from '../services/cloudflareApiService';
import { TokenService } from '../services/tokenService';
import { TunnelTreeItem } from '../views/tunnelTreeView';
import { ProfileManager } from '../services/profileManager';
import { TunnelTreeDataProvider } from '../views/tunnelTreeView';

export function registerTunnelCommands(
    context: vscode.ExtensionContext,
    tunnelManager: TunnelManager,
    apiService: CloudflareApiService,
    tokenService: TokenService,
    profileManager: ProfileManager,
    tunnelProvider: TunnelTreeDataProvider
) {
    // Copy Token Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.copyToken', async (item: TunnelTreeItem) => {
            try {
                if (!item || !item.tunnelId) {
                    throw new Error('No tunnel selected');
                }
                const token = await apiService.getTunnelToken(item.tunnelId);
                if (token) {
                    const disposable = await tokenService.copyTokenToClipboard(token);
                    context.subscriptions.push(disposable);
                    vscode.window.showInformationMessage('Token copied to clipboard (will be cleared in 30 seconds)');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to copy token: ${error}`);
            }
        })
    );

    // Create Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.createTunnel', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new tunnel',
                placeHolder: 'my-tunnel'
            });

            if (name) {
                try {
                    const tunnel = await tunnelManager.createTunnel(name);
                    await tunnelProvider.refresh();
                    vscode.window.showInformationMessage(`Created tunnel: ${tunnel.name}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create tunnel: ${error}`);
                }
            }
        })
    );

    // Delete Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.deleteTunnel', async (item: TunnelTreeItem) => {
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete tunnel '${item.label}'?`,
                { modal: true },
                'Delete'
            );

            if (confirm === 'Delete') {
                try {
                    await tunnelManager.deleteTunnel(item.tunnelId);
                    await tunnelProvider.refresh();
                    vscode.window.showInformationMessage(`Deleted tunnel: ${item.label}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete tunnel: ${error}`);
                }
            }
        })
    );

    // Start Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.startTunnel', async (item: TunnelTreeItem) => {
            const port = await vscode.window.showInputBox({
                prompt: 'Enter the local port to tunnel',
                placeHolder: '8080',
                validateInput: (value) => {
                    const port = parseInt(value, 10);
                    if (isNaN(port) || port < 1 || port > 65535) {
                        return 'Please enter a valid port number (1-65535)';
                    }
                    return null;
                }
            });

            if (!port) {
                return;
            }

            try {
                // Get zones (domains) from Cloudflare
                const zones = await apiService.listZones();
                if (!zones.length) {
                    throw new Error('No domains found in your Cloudflare account');
                }

                // Let user select a zone
                const selectedZone = await vscode.window.showQuickPick(
                    zones.map(zone => ({
                        label: zone.name,
                        description: 'Domain',
                        zone
                    })),
                    {
                        placeHolder: 'Select a domain for your tunnel',
                        title: 'Select Domain'
                    }
                );

                if (!selectedZone) {
                    return;
                }

                // Get existing DNS records for the selected zone
                const records = await apiService.listDnsRecords(selectedZone.zone.id);
                const cnameRecords = records.filter(r => r.type === 'CNAME');

                // Create QuickPick items for existing CNAMEs and new record option
                type CnameQuickPickItem = {
                    label: string;
                    description: string;
                    isNew: boolean;
                    record?: {
                        id: string;
                        name: string;
                        content: string;
                    };
                };

                const quickPickItems: CnameQuickPickItem[] = [
                    {
                        label: '$(add) Create new CNAME record',
                        description: 'Create a new subdomain',
                        isNew: true
                    },
                    ...cnameRecords.map(record => ({
                        label: record.name.replace(`.${selectedZone.zone.name}`, ''),
                        description: `Points to: ${record.content}`,
                        isNew: false,
                        record: {
                            id: record.id,
                            name: record.name,
                            content: record.content
                        }
                    }))
                ];

                const selectedRecord = await vscode.window.showQuickPick(
                    quickPickItems,
                    {
                        placeHolder: 'Select existing CNAME record or create new one',
                        title: 'Configure Hostname'
                    }
                );

                if (!selectedRecord) {
                    return;
                }

                let hostname: string;

                if (selectedRecord.isNew) {
                    // Get subdomain from user for new CNAME record
                    const subdomain = await vscode.window.showInputBox({
                        prompt: `Enter subdomain for ${selectedZone.zone.name}`,
                        placeHolder: 'myapp',
                        validateInput: (value) => {
                            if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9-_.]+[a-zA-Z0-9]$/.test(value)) {
                                return 'Please enter a valid subdomain';
                            }
                            return null;
                        }
                    });

                    if (!subdomain) {
                        return;
                    }

                    hostname = `${subdomain}.${selectedZone.zone.name}`;

                    // Create new CNAME record
                    await apiService.createCnameRecord(
                        selectedZone.zone.id,
                        subdomain,
                        item.tunnelId
                    );
                } else {
                    // Using existing CNAME record
                    hostname = selectedRecord.record!.name;

                    // Check if the CNAME needs to be updated
                    const tunnelDomain = `${item.tunnelId}.cfargotunnel.com`;
                    if (selectedRecord.record!.content !== tunnelDomain) {
                        const confirm = await vscode.window.showWarningMessage(
                            `The CNAME record "${hostname}" currently points to "${selectedRecord.record!.content}". Would you like to update it?`,
                            { modal: true },
                            'Update', 'Cancel'
                        );

                        if (confirm === 'Update') {
                            await apiService.updateCnameRecord(
                                selectedZone.zone.id,
                                selectedRecord.record!.id,
                                item.tunnelId
                            );
                        } else {
                            return;
                        }
                    }
                }

                // Get account ID from active profile
                const activeProfile = await profileManager.getActiveProfile();
                if (!activeProfile) {
                    throw new Error('No active profile found');
                }
                const accountId = await profileManager.getProfileAccountId(activeProfile);
                if (!accountId) {
                    throw new Error('No account ID found in active profile');
                }

                // Update tunnel configuration
                const config = {
                    accountId,
                    tunnelId: item.tunnelId,
                    tunnelName: item.label,
                    credentials: {
                        accountTag: '', // Will be populated from token
                        tunnelSecret: await apiService.getTunnelToken(item.tunnelId)
                    },
                    ingress: [{
                        hostname,
                        service: `http://localhost:${port}`
                    }, {
                        service: 'http_status:404'
                    }]
                };

                await tunnelManager.updateTunnelConfig(item.tunnelId, config);

                // Start the tunnel
                await tunnelManager.runTunnel(item.tunnelId, parseInt(port, 10));
                await tunnelProvider.refresh();
                
                vscode.window.showInformationMessage(
                    `Started TUNNEL: ${item.label} with HOSTNAME: ${hostname} for PORT: ${port}`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start tunnel: ${error}`);
            }
        })
    );

    // Stop Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.stopTunnel', async (item: TunnelTreeItem) => {
            try {
                await tunnelManager.stopTunnel(item.tunnelId);
                await tunnelProvider.refresh();
                vscode.window.showInformationMessage(`TUNNEL: ${item.label} stopped.`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop tunnel: ${error}`);
            }
        })
    );
} 
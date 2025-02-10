import * as vscode from 'vscode';
import { TunnelManager } from '../services/cloudflared';
import { CloudflareApiService } from '../services/cloudflareApiService';
import { TokenService } from '../services/tokenService';
import { TunnelTreeItem } from '../views/tunnelTreeView';
import { ProfileManager } from '../services/profileManager';
import { TunnelTreeDataProvider } from '../views/tunnelTreeView';
import { Messages } from '../utils/messages';

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
                    await Messages.showInfo(Messages.TOKEN_COPIED);
                }
            } catch (error) {
                await Messages.showError(Messages.ERROR_COPY_TOKEN(error));
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
                    await Messages.showInfo(Messages.TUNNEL_CREATED(tunnel.name));
                } catch (error) {
                    await Messages.showError(Messages.ERROR_CREATE_TUNNEL(error));
                }
            }
        })
    );

    // Delete Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.deleteTunnel', async (item: TunnelTreeItem) => {
            const confirm = await Messages.showModal(
                `Are you sure you want to delete tunnel '${item.label}'?`,
                'Delete'
            );

            if (confirm === 'Delete') {
                try {
                    await tunnelManager.deleteTunnel(item.tunnelId);
                    await tunnelProvider.refresh();
                    await Messages.showInfo(Messages.TUNNEL_DELETED(item.label));
                } catch (error) {
                    await Messages.showError(Messages.ERROR_DELETE_TUNNEL(error));
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
                if (!zones || zones.length === 0) {
                    throw new Error('No domains found in your Cloudflare account');
                }

                // Let user select a zone
                const selectedZone = await vscode.window.showQuickPick(
                    zones.map(zone => ({
                        label: zone.name,
                        description: `Zone ID: ${zone.id}`,
                        zone
                    })),
                    {
                        placeHolder: 'Select a domain for your tunnel',
                        ignoreFocusOut: true
                    }
                );

                if (!selectedZone) {
                    return;
                }

                // Get DNS records for the selected zone
                const records = await apiService.listDnsRecords(selectedZone.zone.id);
                
                // Add option to create a new subdomain
                const quickPickItems: DnsRecordQuickPickItem[] = [
                    {
                        label: '$(add) Create new subdomain',
                        description: `Will create a new DNS record in ${selectedZone.zone.name}`,
                        isNew: true
                    },
                    ...records.map(record => ({
                        label: record.name,
                        description: `Type: ${record.type}, Content: ${record.content}`,
                        record,
                        isNew: false
                    }))
                ];

                // Let user select a record or create new
                const selectedRecord = await vscode.window.showQuickPick(
                    quickPickItems,
                    {
                        placeHolder: 'Select existing record or create new',
                        ignoreFocusOut: true
                    }
                );

                if (!selectedRecord) {
                    return;
                }

                let hostname: string;

                if (selectedRecord.isNew) {
                    // Get subdomain from user
                    const subdomain = await vscode.window.showInputBox({
                        prompt: `Enter subdomain (will be created as [subdomain].${selectedZone.zone.name})`,
                        placeHolder: 'myapp',
                        validateInput: (value) => {
                            if (!value.match(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/)) {
                                return 'Subdomain must contain only letters, numbers, and hyphens, and cannot start or end with a hyphen';
                            }
                            return null;
                        }
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
                        item.tunnelId
                    );
                } else {
                    // Using existing CNAME record
                    hostname = selectedRecord.record!.name;

                    // Check if the CNAME needs to be updated
                    const tunnelDomain = `${item.tunnelId}.cfargotunnel.com`;
                    if (selectedRecord.record!.content !== tunnelDomain) {
                        const confirm = await Messages.showModal(
                            `The CNAME record "${hostname}" currently points to "${selectedRecord.record!.content}". Would you like to update it?`,
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
                
                await Messages.showInfo(Messages.TUNNEL_STARTED(item.label, hostname, port));
            } catch (error) {
                await Messages.showError(Messages.ERROR_START_TUNNEL(error));
            }
        })
    );

    // Stop Tunnel Command
    context.subscriptions.push(
        vscode.commands.registerCommand('tunnelfy.stopTunnel', async (item: TunnelTreeItem) => {
            try {
                await tunnelManager.stopTunnel(item.tunnelId);
                await tunnelProvider.refresh();
                await Messages.showInfo(Messages.TUNNEL_STOPPED(item.label));
            } catch (error) {
                await Messages.showError(Messages.ERROR_STOP_TUNNEL(error));
            }
        })
    );
} 
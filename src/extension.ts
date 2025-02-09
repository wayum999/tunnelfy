/**
 * Tunnelfy - VS Code Extension for Managing Cloudflare Tunnels
 * 
 * This extension provides a user interface for managing Cloudflare tunnels directly within VS Code.
 * It supports both persistent tunnels (with custom domains) and quick tunnels (with auto-generated domains).
 * 
 * Core Components:
 * - TunnelManager: Handles tunnel lifecycle and process management
 * - TunnelLogger: Manages tunnel-specific logging and rotation
 * - TunnelConfig: Handles tunnel configuration storage and validation
 * - ProfileManager: Manages different Cloudflare profiles (e.g., development, production)
 * - TokenService: Securely stores and manages tunnel tokens
 * - Logger: Provides persistent logging with rotation
 */

import * as vscode from 'vscode';
import { CloudflareApiService } from './services/cloudflareApiService';
import { TokenService } from './services/tokenService';
import { ProfileManager } from './services/profileManager';
import { ProfilesProvider } from './views/profilesView';
import { TunnelTreeDataProvider, TunnelTreeItem } from './views/tunnelTreeView';
import { QuickTunnelTreeDataProvider } from './views/quickTunnelTreeView';
import { Logger, LogComponent } from './utils/logger';
import { TunnelManager, TunnelLogger, TunnelConfig } from './services/cloudflared';

/**
 * Extension Activation Event
 * This is the entry point of the extension, called when:
 * 1. VS Code starts up (due to 'onStartupFinished' in package.json)
 * 2. User activates a command from this extension
 * 
 * The function:
 * 1. Initializes core services (logging, cloudflared, profiles)
 * 2. Sets up the UI components (tree views)
 * 3. Registers all command handlers
 */
export async function activate(context: vscode.ExtensionContext) {
    // Initialize logging first to capture all subsequent operations
    const logger = Logger.initialize(context);
    logger.info(LogComponent.EXTENSION, 'Activating Tunnelfy extension', { preserveFocus: true });

    try {
        // Initialize core services
        const profileManager = new ProfileManager(context);
        const apiService = new CloudflareApiService(context, profileManager);
        const tokenService = new TokenService(context);
        const tunnelManager = new TunnelManager(context, logger, apiService, profileManager);

        // Initialize UI providers
        const profilesProvider = new ProfilesProvider(profileManager);
        const tunnelProvider = new TunnelTreeDataProvider(tunnelManager, profileManager);
        const quickTunnelProvider = new QuickTunnelTreeDataProvider(tunnelManager);

        // Register tree data providers
        vscode.window.registerTreeDataProvider('tunnelfy-profiles', profilesProvider);
        vscode.window.registerTreeDataProvider('tunnelfy-tunnels', tunnelProvider);
        vscode.window.registerTreeDataProvider('tunnelfy-quick-tunnels', quickTunnelProvider);

        // Register tree views in the Tunnelfy sidebar
        const profilesView = vscode.window.createTreeView('tunnelfy-profiles', {
            treeDataProvider: profilesProvider,
            showCollapseAll: true
        });

        const tunnelsView = vscode.window.createTreeView('tunnelfy-tunnels', {
            treeDataProvider: tunnelProvider,
            showCollapseAll: true
        });

        const quickTunnelsView = vscode.window.createTreeView('tunnelfy-quick-tunnels', {
            treeDataProvider: quickTunnelProvider,
            showCollapseAll: true
        });

        // Register views to extension subscriptions
        context.subscriptions.push(profilesView);
        context.subscriptions.push(tunnelsView);
        context.subscriptions.push(quickTunnelsView);

        // Register refresh commands
        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.refreshProfiles', () => {
                profilesProvider.refresh();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.refreshTunnels', () => {
                tunnelProvider.refresh();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.refreshQuickTunnels', () => {
                quickTunnelProvider.refresh();
            })
        );

        // Register profile management commands
        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.createProfile', async () => {
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter a name for the new profile',
                    placeHolder: 'my-profile',
                    ignoreFocusOut: true
                });

                if (!name) {
                    return;
                }

                const apiKey = await vscode.window.showInputBox({
                    prompt: 'Enter your Cloudflare API key',
                    placeHolder: 'your-api-key',
                    password: true,
                    ignoreFocusOut: true
                });

                if (!apiKey) {
                    return;
                }

                try {
                    // Create a temporary API service instance
                    const tempApiService = new CloudflareApiService(context, profileManager);
                    await tempApiService.setApiKey(apiKey);

                    // Fetch available accounts
                    const accounts = await tempApiService.listAccounts();
                    if (!accounts || accounts.length === 0) {
                        throw new Error('No Cloudflare accounts found for this API key');
                    }

                    // Let user select an account
                    const selectedAccount = await vscode.window.showQuickPick(
                        accounts.map(account => ({
                            label: account.name,
                            description: `Account ID: ${account.id}`,
                            account
                        })),
                        {
                            placeHolder: 'Select a Cloudflare account',
                            ignoreFocusOut: true
                        }
                    );

                    if (!selectedAccount) {
                        return;
                    }

                    // Create the profile with the selected account
                    await profileManager.createProfile(name, apiKey, selectedAccount.account.id);
                    profilesProvider.refresh();

                    // If this was the first profile created, refresh the tunnel list
                    const profiles = await profileManager.listProfiles();
                    if (profiles.length === 1) {
                        tunnelProvider.refresh();
                    }

                    vscode.window.showInformationMessage(`Created profile: ${name}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create profile: ${error}`);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.changeApiKey', async (item: { label: string }) => {
                try {
                    if (!item || !item.label) {
                        throw new Error('No profile selected');
                    }

                    const apiKey = await vscode.window.showInputBox({
                        prompt: `Enter new API key for profile "${item.label}"`,
                        placeHolder: 'your-api-key',
                        password: true,
                        ignoreFocusOut: true
                    });

                    if (!apiKey) {
                        return;
                    }

                    await profileManager.updateProfileApiKey(item.label, apiKey);
                    vscode.window.showInformationMessage(`Updated API key for profile: ${item.label}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to update API key: ${error}`);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.deleteProfile', async (item: { label: string }) => {
                try {
                    if (!item || !item.label) {
                        throw new Error('No profile selected');
                    }

                    const confirm = await vscode.window.showWarningMessage(
                        `Are you sure you want to delete profile "${item.label}"?`,
                        { modal: true },
                        'Delete'
                    );

                    if (confirm === 'Delete') {
                        const isActiveProfile = await profileManager.isActiveProfile(item.label);
                        const allProfiles = await profileManager.listProfiles();
                        
                        // Delete the profile
                        await profileManager.deleteProfile(item.label);
                        profilesProvider.refresh();

                        // If we deleted the active profile
                        if (isActiveProfile) {
                            // If there are other profiles, switch to one of them
                            const remainingProfiles = allProfiles.filter(p => p !== item.label);
                            if (remainingProfiles.length > 0) {
                                await profileManager.setActiveProfile(remainingProfiles[0]);
                                vscode.window.showInformationMessage(`Switched to profile: ${remainingProfiles[0]}`);
                            }
                            // Always refresh tunnel list when active profile is deleted
                            tunnelProvider.refresh();
                        }

                        vscode.window.showInformationMessage(`Profile "${item.label}" deleted successfully`);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to delete profile: ${error}`);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.setActiveProfile', async (item: { label: string }) => {
                try {
                    if (!item || !item.label) {
                        throw new Error('No profile selected');
                    }
                    await profileManager.setActiveProfile(item.label);
                    profilesProvider.refresh();
                    tunnelProvider.refresh();
                    vscode.window.showInformationMessage('Active profile updated');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to set active profile: ${error}`);
                }
            })
        );

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

        // Register tunnel management commands
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

        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.stopTunnel', async (item: TunnelTreeItem) => {
                try {
                    await tunnelManager.stopTunnel(item.tunnelId);
                    await tunnelProvider.refresh();
                    vscode.window.showInformationMessage(`Stopped tunnel: ${item.label}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to stop tunnel: ${error}`);
                }
            })
        );

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

        // Register cleanup on extension deactivation
        context.subscriptions.push({
            dispose: async () => {
                await tunnelManager.cleanup();
            }
        });

        logger.info(LogComponent.EXTENSION, 'Tunnelfy extension activated successfully', { preserveFocus: true });
    } catch (error) {
        logger.error(LogComponent.EXTENSION, 'Failed to activate Tunnelfy extension', error);
        throw error;
    }
}

export function deactivate() {
    // Cleanup is handled by the disposable registered in activate()
}

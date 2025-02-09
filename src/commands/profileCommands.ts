import * as vscode from 'vscode';
import { CloudflareApiService } from '../services/cloudflareApiService';
import { ProfileManager } from '../services/profileManager';
import { ProfilesProvider } from '../views/profilesView';
import { TunnelTreeDataProvider } from '../views/tunnelTreeView';

export function registerProfileCommands(
    context: vscode.ExtensionContext,
    profileManager: ProfileManager,
    profilesProvider: ProfilesProvider,
    tunnelProvider: TunnelTreeDataProvider
) {
    // Create Profile Command
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

    // Change API Key Command
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

    // Delete Profile Command
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

    // Set Active Profile Command
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
} 
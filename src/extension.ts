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
import { TunnelTreeDataProvider } from './views/tunnelTreeView';
import { QuickTunnelTreeDataProvider } from './views/quickTunnelTreeView';
import { Logger, LogComponent } from './utils/logger';
import { TunnelManager } from './services/cloudflared';
import { registerProfileCommands, registerTunnelCommands, registerQuickTunnelCommands } from './commands';

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

        // Register all command handlers
        registerProfileCommands(context, profileManager, profilesProvider, tunnelProvider);
        registerTunnelCommands(context, tunnelManager, apiService, tokenService, profileManager, tunnelProvider);
        registerQuickTunnelCommands(context, quickTunnelProvider);

        // Register refresh commands
        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.refreshProfiles', () => {
                profilesProvider.refresh();
            }),
            vscode.commands.registerCommand('tunnelfy.refreshTunnels', () => {
                tunnelProvider.refresh();
            }),
            vscode.commands.registerCommand('tunnelfy.refreshQuickTunnels', () => {
                quickTunnelProvider.refresh();
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

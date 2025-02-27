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
import { CloudflareApiService } from './services/cloudflareApi';
import { TokenService } from './services/tokenService';
import { ProfileManager } from './services/profileManager';
import { ProfilesProvider } from './views/profilesView';
import { TunnelTreeDataProvider } from './views/tunnelTreeView';
import { QuickTunnelTreeDataProvider } from './views/quickTunnelTreeView';
import { Logger, LogComponent } from './utils/logger';
import { TunnelManager } from './services/cloudflared';
import { registerProfileCommands } from './commands/profileCommands';
import { registerTunnelCommands } from './commands/tunnelCommands';
import { registerQuickTunnelCommands } from './commands/quickTunnelCommands';
import { Messages } from './utils/messages';
import { SystemServiceGenerator } from './services/systemServiceGenerator';
import { ServiceGenerator } from './services/serviceGenerator';
import { checkAndPromptCloudflared, setCloudflaredStatusBarItem } from './utils/cloudflaredUtils';

let cloudflaredStatusBarItem: vscode.StatusBarItem;

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

    // Create status bar item
    cloudflaredStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    context.subscriptions.push(cloudflaredStatusBarItem);
    setCloudflaredStatusBarItem(cloudflaredStatusBarItem);

    try {
        // Initialize core services
        const profileManager = new ProfileManager(context);
        const apiService = new CloudflareApiService(context, profileManager);
        const tokenService = new TokenService(context);
        const tunnelManager = new TunnelManager(context, logger, apiService, profileManager);
        const serviceGenerator = new ServiceGenerator(tunnelManager, apiService);

        // Initialize UI providers
        const profilesProvider = new ProfilesProvider(profileManager);
        const tunnelProvider = new TunnelTreeDataProvider(tunnelManager, profileManager);
        const quickTunnelProvider = new QuickTunnelTreeDataProvider(tunnelManager);

        // Register views
        vscode.window.registerTreeDataProvider('tunnelfy-profiles', profilesProvider);
        vscode.window.registerTreeDataProvider('tunnelfy-tunnels', tunnelProvider);
        vscode.window.registerTreeDataProvider('tunnelfy-quick-tunnels', quickTunnelProvider);

        // Register all command handlers
        const tunnelCommandDisposables = registerTunnelCommands(
            context,
            tunnelManager,
            apiService,
            tokenService,
            profileManager,
            tunnelProvider,
            serviceGenerator,
            logger
        );
        context.subscriptions.push(...tunnelCommandDisposables);

        const profileCommandDisposables = registerProfileCommands(
            context,
            profileManager,
            profilesProvider,
            tunnelProvider
        );
        context.subscriptions.push(...profileCommandDisposables);

        const quickTunnelCommandDisposables = registerQuickTunnelCommands(
            context,
            quickTunnelProvider
        );
        context.subscriptions.push(...quickTunnelCommandDisposables);

        // Register the cloudflared installation instructions command
        context.subscriptions.push(
            vscode.commands.registerCommand('tunnelfy.showCloudflaredInstallInstructions', async () => {
                await checkAndPromptCloudflared(logger);
            })
        );

        // Check for cloudflared installation
        await checkAndPromptCloudflared(logger);

        // Show the status bar item
        cloudflaredStatusBarItem.show();

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
    if (cloudflaredStatusBarItem) {
        cloudflaredStatusBarItem.dispose();
    }
}

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
import * as cp from 'child_process';
import { promisify } from 'util';
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
        const systemServiceGenerator = new SystemServiceGenerator(tunnelManager, apiService);

        // Check for cloudflared installation
        try {
            const execAsync = promisify(cp.exec);
            const { stdout } = await execAsync('cloudflared --version');
            logger.debug(LogComponent.EXTENSION, `Cloudflared version: ${stdout.trim()}`);
        } catch (error: unknown) {
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

            const CLOUDFLARED_INSTALL_URL = Messages.CLOUDFLARED_INSTALL_DOCS;
            
            const response = await vscode.window.showErrorMessage(
                Messages.CLOUDFLARED_NOT_FOUND.message,
                { 
                    modal: true, 
                    detail: installInstructions 
                },
                Messages.CLOUDFLARED_INSTALL_ACTION
            );

            if (response === Messages.CLOUDFLARED_INSTALL_ACTION) {
                await vscode.env.openExternal(vscode.Uri.parse(CLOUDFLARED_INSTALL_URL));
            }
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(
                LogComponent.EXTENSION, 
                `Cloudflared not found during activation: ${errorMessage}`, 
                { preserveFocus: true }
            );
        }

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
        const tunnelCommandDisposables = registerTunnelCommands(
            context,
            tunnelManager,
            apiService,
            tokenService,
            profileManager,
            tunnelProvider,
            systemServiceGenerator
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

        // Register the service generation commands
        context.subscriptions.push(
            vscode.commands.registerCommand('cloudflare-tunnel.generateService', async (tunnelId: string, tunnelName: string) => {
                try {
                    await tunnelProvider.generateServiceFiles(tunnelId, tunnelName);
                } catch (error) {
                    logger.error(LogComponent.EXTENSION, `Failed to generate service files: ${error}`);
                    vscode.window.showErrorMessage('Failed to generate service files. Check the logs for details.');
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('cloudflare-tunnel.generateSystemService', async (tunnelId: string, tunnelName: string) => {
                try {
                    const systemServiceGenerator = new SystemServiceGenerator(tunnelManager, apiService);
                    await systemServiceGenerator.generateServiceFile(tunnelId, tunnelName, 8080); // Default port, can be made configurable
                } catch (error) {
                    logger.error(LogComponent.EXTENSION, `Failed to generate system service files: ${error}`);
                    vscode.window.showErrorMessage('Failed to generate system service files. Check the logs for details.');
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

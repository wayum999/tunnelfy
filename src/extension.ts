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
 * - TokenAuditService: Records token copy events
 * - Logger: Provides persistent logging with rotation
 */

import * as vscode from 'vscode';
import { CloudflareApiService } from './services/cloudflareApi';
import { TokenAuditService } from './services/tokenAuditService';
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
let tunnelManager: TunnelManager | undefined;

/** Upper bound on how long deactivation waits for owned tunnels to stop */
export const DEACTIVATE_STOP_TIMEOUT_MS = 3000;

/**
 * Extension Activation Event
 * This is the entry point of the extension, called when:
 * 1. One of the extension's views is opened ('onView:' in package.json)
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
        const tokenAuditService = new TokenAuditService(context);
        const manager = new TunnelManager(context, logger, apiService, profileManager);
        tunnelManager = manager;
        const serviceGenerator = new ServiceGenerator(manager, apiService);

        // Initialize UI providers
        const profilesProvider = new ProfilesProvider(profileManager);
        const tunnelProvider = new TunnelTreeDataProvider(manager, profileManager);
        const quickTunnelProvider = new QuickTunnelTreeDataProvider(manager);

        // Register views, each exactly once: the tunnel and quick tunnel providers
        // create their own tree views, so only the profiles view is registered here.
        // Every provider is disposed with the extension, taking its timers and listeners.
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('tunnelfy-profiles', profilesProvider),
            profilesProvider,
            tunnelProvider,
            quickTunnelProvider
        );

        // Register all command handlers
        const tunnelCommandDisposables = registerTunnelCommands(
            context,
            manager,
            apiService,
            tokenAuditService,
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
                await checkAndPromptCloudflared(logger, { force: true });
            })
        );

        // Recognise tunnels an earlier session started; runs in the background
        startReconcile(manager, logger);

        // cloudflared is not probed here: the actions that run it check for it
        // when they need it, so activation never spawns it or fails for its absence
        cloudflaredStatusBarItem.text = `$(cloud)`;
        cloudflaredStatusBarItem.tooltip = 'Tunnelfy: cloudflared is checked when a tunnel starts';
        cloudflaredStatusBarItem.show();

        logger.info(LogComponent.EXTENSION, 'Tunnelfy extension activated successfully', { preserveFocus: true });
    } catch (error) {
        logger.error(LogComponent.EXTENSION, 'Failed to activate Tunnelfy extension', error);
        throw error;
    }
}

/**
 * Starts reconciling persisted tunnel records without awaiting it: activation must not
 * wait on process probing. Failures are logged, never thrown.
 */
export function startReconcile(manager: Pick<TunnelManager, 'reconcileOwned'>, logger: Logger): void {
    manager.reconcileOwned().catch((error: unknown) => {
        logger.warn(
            LogComponent.EXTENSION,
            `Reconciling owned tunnels failed: ${error instanceof Error ? error.message : String(error)}`
        );
    });
}

/**
 * Stops every owned tunnel, resolving once they have all been asked to stop and either
 * exited or the bounded wait elapsed. Never rejects and never waits much past the bound.
 */
export async function stopOwnedTunnels(
    manager: Pick<TunnelManager, 'stopAllOwned'> | undefined,
    timeoutMs: number = DEACTIVATE_STOP_TIMEOUT_MS,
    logger: Pick<Logger, 'warn'> = Logger.getInstance()
): Promise<void> {
    if (!manager) {
        return;
    }
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<'backstop'>((resolve) => {
        timer = setTimeout(() => resolve('backstop'), timeoutMs + 250);
    });
    try {
        const winner = await Promise.race([
            manager.stopAllOwned(timeoutMs).then(
                (results) => {
                    const unconfirmed = results.filter((result) => result.outcome === 'failed');
                    if (unconfirmed.length > 0) {
                        logger.warn(
                            LogComponent.EXTENSION,
                            `${unconfirmed.length} owned tunnel(s) not confirmed stopped on deactivate: ` +
                                unconfirmed.map((result) => `${result.tunnelId} (${result.reason})`).join(', ')
                        );
                    }
                },
                (error: unknown) => {
                    logger.warn(
                        LogComponent.EXTENSION,
                        `Stopping owned tunnels on deactivate failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            ),
            bound,
        ]);
        if (winner === 'backstop') {
            logger.warn(
                LogComponent.EXTENSION,
                `Stopping owned tunnels on deactivate did not settle within ${timeoutMs + 250} ms; ` +
                    'continuing shutdown, and any tunnel not confirmed stopped stays recorded for the next reconcile'
            );
        }
    } finally {
        clearTimeout(timer);
    }
}

export function deactivate(): Promise<void> {
    if (cloudflaredStatusBarItem) {
        cloudflaredStatusBarItem.dispose();
    }
    const manager = tunnelManager;
    tunnelManager = undefined;
    // Disposed only once its tunnels are stopped: the stop path still reports through its listener
    return stopOwnedTunnels(manager).finally(() => manager?.dispose());
}

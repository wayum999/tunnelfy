"use strict";
/**
 * Tunnelfy - VS Code Extension for Managing Cloudflare Tunnels
 *
 * This extension provides a user interface for managing Cloudflare tunnels directly within VS Code.
 * It supports both persistent tunnels (with custom domains) and quick tunnels (with auto-generated domains).
 *
 * Core Components:
 * - CloudflaredService: Handles all interactions with the cloudflared CLI
 * - ProfileManager: Manages different Cloudflare profiles (e.g., development, production)
 * - TokenService: Securely stores and manages tunnel tokens
 * - Logger: Provides persistent logging with rotation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const cloudflaredService_1 = require("./services/cloudflaredService");
const tokenService_1 = require("./services/tokenService");
const profileManager_1 = require("./services/profileManager");
const profilesView_1 = require("./views/profilesView");
const tunnelTreeView_1 = require("./views/tunnelTreeView");
const quickTunnelTreeView_1 = require("./views/quickTunnelTreeView");
const logger_1 = require("./utils/logger");
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
async function activate(context) {
    // Initialize logging first to capture all subsequent operations
    const logger = logger_1.Logger.initialize(context);
    logger.info(logger_1.LogComponent.EXTENSION, 'Activating Tunnelfy extension');
    try {
        // Initialize core services
        const cloudflaredService = new cloudflaredService_1.CloudflaredService(context);
        const tokenService = new tokenService_1.TokenService(context);
        const profileManager = new profileManager_1.ProfileManager();
        // Check for cloudflared installation once at startup if enabled
        const checkOnStartup = vscode.workspace.getConfiguration('tunnelfy').get('checkCloudflaredOnStartup', true);
        let isCloudflaredInstalled = true;
        if (checkOnStartup) {
            logger.info(logger_1.LogComponent.EXTENSION, 'Checking for existing cloudflared installation');
            isCloudflaredInstalled = await profileManager.isCloudflaredInstalled();
            if (!isCloudflaredInstalled) {
                await showCloudflaredInstallPrompt();
            }
        }
        // Initialize UI providers with installation status
        const profilesProvider = new profilesView_1.ProfilesProvider(profileManager);
        const tunnelProvider = new tunnelTreeView_1.TunnelTreeDataProvider(cloudflaredService, profileManager, isCloudflaredInstalled);
        const quickTunnelProvider = new quickTunnelTreeView_1.QuickTunnelTreeDataProvider(cloudflaredService, isCloudflaredInstalled);
        // Register tree views in the Tunnelfy sidebar
        vscode.window.registerTreeDataProvider('tunnelfy-tunnels', tunnelProvider);
        vscode.window.registerTreeDataProvider('tunnelfy-profiles', profilesProvider);
        vscode.window.registerTreeDataProvider('tunnelfy-quick-tunnels', quickTunnelProvider);
        // Helper function that uses the cached installation status
        const withCloudflaredCheck = async (action) => {
            // Only recheck if initial check was skipped or failed
            if (!isCloudflaredInstalled) {
                isCloudflaredInstalled = await profileManager.isCloudflaredInstalled();
                if (!isCloudflaredInstalled) {
                    await showCloudflaredInstallPrompt();
                    return;
                }
            }
            return action();
        };
        // Register all command handlers
        context.subscriptions.push(
        // Refresh command - Updates the tunnel list
        vscode.commands.registerCommand('tunnelfy.refreshTunnels', () => {
            logger.info(logger_1.LogComponent.COMMAND, 'Refreshing tunnels');
            tunnelProvider.refresh();
        }), 
        // Profile Management Commands
        vscode.commands.registerCommand('tunnelfy.createProfile', async () => {
            logger.info(logger_1.LogComponent.COMMAND, 'Creating new profile');
            await withCloudflaredCheck(async () => {
                try {
                    const name = await vscode.window.showInputBox({
                        prompt: 'Enter profile name',
                        placeHolder: 'e.g. development, production'
                    });
                    if (name) {
                        await profileManager.createProfile(name);
                        profilesProvider.refresh();
                        tunnelProvider.refresh();
                        vscode.window.showInformationMessage(`Profile "${name}" created and activated successfully`);
                    }
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to create profile', error);
                    vscode.window.showErrorMessage('Failed to create profile');
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.switchProfile', async () => {
            logger.info(logger_1.LogComponent.COMMAND, 'Switching profile');
            await withCloudflaredCheck(async () => {
                try {
                    const profiles = await profileManager.listProfiles();
                    const activeProfile = await profileManager.getActiveProfile();
                    const items = profiles.map(profile => ({
                        label: profile,
                        description: profile === activeProfile ? '(current)' : ''
                    }));
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select profile to switch to'
                    });
                    if (selected) {
                        await profileManager.switchProfile(selected.label);
                        profilesProvider.refresh();
                        tunnelProvider.refresh();
                        vscode.window.showInformationMessage(`Switched to profile "${selected.label}"`);
                    }
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to switch profile', error);
                    vscode.window.showErrorMessage('Failed to switch profile');
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.deleteProfile', async () => {
            logger.info(logger_1.LogComponent.COMMAND, 'Deleting profile');
            await withCloudflaredCheck(async () => {
                try {
                    const profiles = await profileManager.listProfiles();
                    const activeProfile = await profileManager.getActiveProfile();
                    const items = profiles.map(profile => ({
                        label: profile,
                        description: profile === activeProfile ? '(current)' : ''
                    }));
                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select profile to delete'
                    });
                    if (selected) {
                        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete profile "${selected.label}"?`, { modal: true }, 'Delete');
                        if (confirm === 'Delete') {
                            await profileManager.deleteProfile(selected.label);
                            profilesProvider.refresh();
                            tunnelProvider.refresh();
                            vscode.window.showInformationMessage(`Deleted profile "${selected.label}"`);
                        }
                    }
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to delete profile', error);
                    vscode.window.showErrorMessage('Failed to delete profile');
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.renameProfile', async (item) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Renaming profile');
            await withCloudflaredCheck(async () => {
                try {
                    // If no item provided (command palette), let user pick a profile
                    let oldName = item?.label;
                    if (!oldName) {
                        const profiles = await profileManager.listProfiles();
                        const selected = await vscode.window.showQuickPick(profiles, {
                            placeHolder: 'Select profile to rename'
                        });
                        if (!selected) {
                            return; // User cancelled
                        }
                        oldName = selected;
                    }
                    const newName = await vscode.window.showInputBox({
                        prompt: 'Enter new profile name',
                        placeHolder: 'e.g. development, production',
                        value: oldName
                    });
                    if (newName && newName !== oldName) {
                        await profileManager.renameProfile(oldName, newName);
                        profilesProvider.refresh();
                        tunnelProvider.refresh();
                        vscode.window.showInformationMessage(`Profile "${oldName}" renamed to "${newName}"`);
                    }
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to rename profile', error);
                    vscode.window.showErrorMessage('Failed to rename profile');
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.tunnelInfo', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Getting tunnel info');
            try {
                let tunnelId;
                let tunnelName;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const tunnels = await cloudflaredService.listTunnels();
                    if (tunnels.length === 0) {
                        throw new Error('No tunnels found.');
                    }
                    const quickPickItems = tunnels.map(t => ({
                        label: t.name,
                        description: t.id,
                        detail: t.connections && t.connections.length > 0 ? 'Running' : 'Stopped'
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a tunnel to view info',
                        title: 'View Tunnel Info'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelId = selected.description;
                    tunnelName = selected.label;
                }
                else {
                    tunnelId = tunnel.tunnelId;
                    tunnelName = tunnel.name;
                }
                const info = await cloudflaredService.getTunnelInfo(tunnelId);
                if (info) {
                    const content = `# Tunnel Information\n\n` +
                        `## Basic Details\n` +
                        `- **Name:** ${info.name}\n` +
                        `- **ID:** ${info.id}\n` +
                        `- **Created:** ${new Date(info.created_at).toLocaleString()}\n` +
                        `- **Status:** ${info.status || 'Unknown'}\n\n` +
                        `## Connections\n` +
                        `${info.conns?.map((conn) => `- ${conn.id}: ${conn.status}`).join('\n') || 'No active connections'}\n\n` +
                        `## Configuration\n` +
                        `\`\`\`json\n${JSON.stringify(info.config || {}, null, 2)}\n\`\`\`\n\n` +
                        `## Setup Instructions\n\n` +
                        `### 1. Configuration File\n` +
                        `Create a \`config.yml\` file with your tunnel configuration:\n\n` +
                        `\`\`\`yaml\n` +
                        `tunnel: ${info.id}\n` +
                        `credentials-file: /root/.cloudflared/${info.id}.json\n\n` +
                        `ingress:\n` +
                        `  # Example for a web service\n` +
                        `  - hostname: your-app.yourdomain.com\n` +
                        `    service: http://localhost:8000\n\n` +
                        `  # Example for SSH service\n` +
                        `  - hostname: ssh.yourdomain.com\n` +
                        `    service: ssh://localhost:22\n\n` +
                        `  # Catch-all rule\n` +
                        `  - service: http_status:404\n` +
                        `\`\`\`\n\n` +
                        `### 2. Running with Docker\n` +
                        `\`\`\`bash\n` +
                        `# Run as a standalone container\n` +
                        `docker run -d \\\n` +
                        `  --name cloudflared \\\n` +
                        `  -v /path/to/config.yml:/etc/cloudflared/config.yml \\\n` +
                        `  -v ~/.cloudflared:/root/.cloudflared \\\n` +
                        `  cloudflare/cloudflared:latest tunnel run\n\n` +
                        `# Or using Docker Compose\n` +
                        `version: "3.8"\n` +
                        `services:\n` +
                        `  cloudflared:\n` +
                        `    image: cloudflare/cloudflared:latest\n` +
                        `    command: tunnel run\n` +
                        `    volumes:\n` +
                        `      - /path/to/config.yml:/etc/cloudflared/config.yml\n` +
                        `      - ~/.cloudflared:/root/.cloudflared\n` +
                        `    restart: unless-stopped\n` +
                        `\`\`\`\n\n` +
                        `### 3. Running as a Service\n` +
                        `\`\`\`bash\n` +
                        `# Install cloudflared as a service\n` +
                        `cloudflared service install\n\n` +
                        `# Start the service\n` +
                        `systemctl start cloudflared\n\n` +
                        `# Enable auto-start\n` +
                        `systemctl enable cloudflared\n` +
                        `\`\`\`\n\n` +
                        `### 4. DNS Configuration\n` +
                        `\`\`\`bash\n` +
                        `# Configure DNS routing\n` +
                        `cloudflared tunnel route dns ${info.id} your-app.yourdomain.com\n` +
                        `\`\`\`\n\n` +
                        `### 5. Monitoring\n` +
                        `- View logs: \`cloudflared tunnel info ${info.id}\`\n` +
                        `- Check status: \`cloudflared tunnel list\`\n` +
                        `- View metrics: Access \`localhost:40829/metrics\` when running locally\n\n` +
                        `### 6. Troubleshooting\n` +
                        `- Ensure your origin service is running and accessible\n` +
                        `- Check firewall rules and port accessibility\n` +
                        `- Verify DNS propagation for your domain\n` +
                        `- Review logs for connection issues\n` +
                        `- Ensure credentials file is properly mounted in Docker\n`;
                    const doc = await vscode.workspace.openTextDocument({
                        content: content,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc);
                }
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to get tunnel info', error);
                vscode.window.showErrorMessage(`Failed to get tunnel info: ${error instanceof Error ? error.message : String(error)}`);
            }
        }), vscode.commands.registerCommand('tunnelfy.copyToken', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Copying tunnel token');
            try {
                let tunnelId;
                let tunnelName;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const tunnels = await cloudflaredService.listTunnels();
                    if (tunnels.length === 0) {
                        throw new Error('No tunnels found. Create a tunnel first.');
                    }
                    const quickPickItems = tunnels.map(t => ({
                        label: t.name,
                        description: t.id,
                        detail: `Tunnel ID: ${t.id}`
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a tunnel to copy token',
                        title: 'Copy Tunnel Token'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelId = selected.description;
                    tunnelName = selected.label;
                }
                else {
                    tunnelId = tunnel.tunnelId;
                    tunnelName = tunnel.label;
                }
                // Show security warning and confirmation
                const confirm = await vscode.window.showWarningMessage(`Are you sure you want to copy the token for tunnel "${tunnelName}"? The token will be cleared from your clipboard after 30 seconds.`, { modal: true }, 'Copy');
                if (confirm !== 'Copy') {
                    return;
                }
                const token = await cloudflaredService.getTunnelToken(tunnelId);
                if (!token) {
                    throw new Error('Failed to get tunnel token');
                }
                // Copy token to clipboard
                await vscode.env.clipboard.writeText(token);
                vscode.window.showInformationMessage(`Token for tunnel "${tunnelName}" copied to clipboard. It will be cleared in 30 seconds.`);
                // Clear clipboard after 30 seconds
                setTimeout(async () => {
                    try {
                        const currentClipboard = await vscode.env.clipboard.readText();
                        // Only clear if the token is still in the clipboard
                        if (currentClipboard === token) {
                            await vscode.env.clipboard.writeText('');
                            vscode.window.showInformationMessage('Tunnel token cleared from clipboard for security.');
                        }
                    }
                    catch (error) {
                        logger.error(logger_1.LogComponent.COMMAND, 'Failed to clear clipboard', error);
                    }
                }, 30000);
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to copy tunnel token', error);
                vscode.window.showErrorMessage(`Failed to copy tunnel token: ${error instanceof Error ? error.message : String(error)}`);
            }
        }), vscode.commands.registerCommand('tunnelfy.deleteTunnel', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Deleting tunnel');
            try {
                let tunnelId;
                let tunnelName;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const tunnels = await cloudflaredService.listTunnels();
                    if (tunnels.length === 0) {
                        throw new Error('No tunnels found.');
                    }
                    // For safety, don't show running tunnels in delete list
                    const stoppedTunnels = tunnels.filter(t => !t.connections || t.connections.length === 0);
                    if (stoppedTunnels.length === 0) {
                        throw new Error('All tunnels are currently running. Stop a tunnel before deleting it.');
                    }
                    const quickPickItems = stoppedTunnels.map(t => ({
                        label: t.name,
                        description: t.id,
                        detail: 'Stopped'
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a tunnel to delete',
                        title: 'Delete Tunnel'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelId = selected.description;
                    tunnelName = selected.label;
                }
                else {
                    tunnelId = tunnel.tunnelId;
                    tunnelName = tunnel.name;
                }
                const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete the tunnel "${tunnelName}"? This action cannot be undone.`, { modal: true }, 'Yes', 'No');
                if (confirm !== 'Yes') {
                    return;
                }
                await cloudflaredService.deleteTunnel(tunnelId);
                vscode.window.showInformationMessage(`Tunnel "${tunnelName}" deleted successfully`);
                tunnelProvider.refresh();
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to delete tunnel', error);
                vscode.window.showErrorMessage(`Failed to delete tunnel: ${error instanceof Error ? error.message : String(error)}`);
            }
        }), vscode.commands.registerCommand('tunnelfy.createTunnel', async () => {
            logger.info(logger_1.LogComponent.COMMAND, 'Creating new tunnel');
            await withCloudflaredCheck(async () => {
                try {
                    const name = await vscode.window.showInputBox({
                        prompt: 'Enter tunnel name',
                        placeHolder: 'e.g. my-app-tunnel'
                    });
                    if (name) {
                        await cloudflaredService.createTunnel(name);
                        tunnelProvider.refresh();
                        vscode.window.showInformationMessage(`Tunnel "${name}" created successfully`);
                    }
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to create tunnel', error);
                    vscode.window.showErrorMessage(`Failed to create tunnel: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.createQuickTunnel', async () => {
            logger.info(logger_1.LogComponent.COMMAND, 'Creating quick tunnel');
            await withCloudflaredCheck(async () => {
                try {
                    const portInput = await vscode.window.showInputBox({
                        prompt: 'Enter the port number for the quick tunnel',
                        placeHolder: 'e.g., 3000',
                        validateInput: (value) => {
                            const port = parseInt(value);
                            if (isNaN(port) || port < 1 || port > 65535) {
                                return 'Please enter a valid port number (1-65535)';
                            }
                            return null;
                        }
                    });
                    if (!portInput) {
                        return; // User cancelled
                    }
                    const port = parseInt(portInput);
                    // Add the quick tunnel using the provider
                    await quickTunnelProvider.addQuickTunnel(port);
                    vscode.window.showInformationMessage(`Created quick tunnel on port ${port}`);
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to create quick tunnel', error);
                    vscode.window.showErrorMessage('Failed to create quick tunnel');
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.stopQuickTunnel', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Stopping quick tunnel');
            try {
                let tunnelPort;
                let tunnelName;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const quickTunnels = await quickTunnelProvider.getQuickTunnels();
                    if (quickTunnels.length === 0) {
                        throw new Error('No quick tunnels found.');
                    }
                    const quickPickItems = quickTunnels.map(t => ({
                        label: `Port ${t.port}`,
                        description: t.url || '',
                        detail: t.tunnelUrl || '',
                        port: t.port
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a quick tunnel to stop',
                        title: 'Stop Quick Tunnel'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelPort = selected.port;
                    tunnelName = selected.label;
                }
                else {
                    if (!tunnel.port) {
                        throw new Error('Quick tunnel port not found');
                    }
                    tunnelPort = tunnel.port;
                    tunnelName = tunnel.name || `Port ${tunnel.port}`;
                }
                const confirm = await vscode.window.showWarningMessage(`Are you sure you want to stop the quick tunnel "${tunnelName}"?`, { modal: true }, 'Yes', 'No');
                if (confirm !== 'Yes') {
                    return;
                }
                await cloudflaredService.stopQuickTunnel(tunnelPort);
                await quickTunnelProvider.removeQuickTunnel(tunnelPort);
                vscode.window.showInformationMessage(`Quick tunnel "${tunnelName}" stopped successfully`);
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to stop quick tunnel', error);
                vscode.window.showErrorMessage(`Failed to stop quick tunnel: ${error instanceof Error ? error.message : String(error)}`);
            }
        }), vscode.commands.registerCommand('tunnelfy.copyQuickTunnelUrl', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Copying quick tunnel URL');
            try {
                let tunnelUrl;
                let tunnelName;
                let port;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const quickTunnels = await quickTunnelProvider.getQuickTunnels();
                    if (quickTunnels.length === 0) {
                        throw new Error('No quick tunnels found. Start a quick tunnel first.');
                    }
                    const quickPickItems = quickTunnels.map(t => ({
                        label: `Port ${t.port}`,
                        description: t.url || '',
                        detail: t.tunnelUrl || '',
                        port: t.port
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a quick tunnel to copy URL',
                        title: 'Copy Quick Tunnel URL'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelUrl = selected.detail;
                    tunnelName = selected.label;
                    port = selected.port;
                }
                else {
                    if (!tunnel.url) {
                        throw new Error('Quick tunnel URL not found');
                    }
                    tunnelUrl = tunnel.url;
                    tunnelName = tunnel.name || `Port ${tunnel.port}`;
                    port = tunnel.port || 0;
                }
                await vscode.env.clipboard.writeText(tunnelUrl);
                vscode.window.showInformationMessage(`Quick tunnel URL for "${tunnelName}" copied to clipboard`);
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to copy quick tunnel URL', error);
                vscode.window.showErrorMessage(`Failed to copy quick tunnel URL: ${error instanceof Error ? error.message : String(error)}`);
            }
        }), vscode.commands.registerCommand('tunnelfy.playTunnel', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Playing tunnel');
            await withCloudflaredCheck(async () => {
                try {
                    let tunnelId;
                    let tunnelName;
                    // If no tunnel provided (command palette), show quick pick
                    if (!tunnel) {
                        const tunnels = await cloudflaredService.listTunnels();
                        if (tunnels.length === 0) {
                            throw new Error('No tunnels found. Create a tunnel first.');
                        }
                        const quickPickItems = tunnels.map(t => ({
                            label: t.name,
                            description: t.id,
                            detail: t.connections && t.connections.length > 0 ? 'Running' : 'Stopped'
                        }));
                        const selected = await vscode.window.showQuickPick(quickPickItems, {
                            placeHolder: 'Select a tunnel to start',
                            title: 'Start Tunnel'
                        });
                        if (!selected) {
                            return; // User cancelled
                        }
                        tunnelId = selected.description;
                        tunnelName = selected.label;
                    }
                    else {
                        tunnelId = tunnel.tunnelId;
                        tunnelName = tunnel.name;
                    }
                    const portInput = await vscode.window.showInputBox({
                        prompt: 'Enter the port number',
                        placeHolder: 'e.g., 3000',
                        validateInput: (value) => {
                            const port = parseInt(value);
                            if (isNaN(port) || port < 1 || port > 65535) {
                                return 'Please enter a valid port number (1-65535)';
                            }
                            return null;
                        }
                    });
                    if (!portInput) {
                        return; // User cancelled
                    }
                    const port = parseInt(portInput);
                    const hostname = await vscode.window.showInputBox({
                        prompt: 'Enter the hostname [Optional]',
                        placeHolder: 'e.g., myapp.example.com'
                    });
                    logger.info(logger_1.LogComponent.TUNNEL, `Starting tunnel ${tunnelName} (${tunnelId}) on port ${port}`);
                    await cloudflaredService.runTunnel(tunnelId, port, hostname);
                    vscode.window.showInformationMessage(`Started tunnel ${tunnelName} on port ${port}`);
                    tunnelProvider.refresh();
                }
                catch (error) {
                    logger.error(logger_1.LogComponent.COMMAND, 'Failed to start tunnel', error);
                    vscode.window.showErrorMessage(`Failed to start tunnel: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
        }), vscode.commands.registerCommand('tunnelfy.stopTunnel', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Stopping tunnel');
            try {
                let tunnelId;
                let tunnelName;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const tunnels = await cloudflaredService.listTunnels();
                    if (tunnels.length === 0) {
                        throw new Error('No tunnels found.');
                    }
                    // Filter to show only running tunnels
                    const runningTunnels = tunnels.filter(t => t.connections && t.connections.length > 0);
                    if (runningTunnels.length === 0) {
                        throw new Error('No running tunnels found.');
                    }
                    const quickPickItems = runningTunnels.map(t => ({
                        label: t.name,
                        description: t.id,
                        detail: `Running with ${t.connections?.length} connection(s)`
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a tunnel to stop',
                        title: 'Stop Tunnel'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelId = selected.description;
                    tunnelName = selected.label;
                }
                else {
                    tunnelId = tunnel.tunnelId;
                    tunnelName = tunnel.name;
                }
                const confirm = await vscode.window.showWarningMessage(`Are you sure you want to stop tunnel "${tunnelName}"?`, { modal: true }, 'Yes', 'No');
                if (confirm !== 'Yes') {
                    return;
                }
                logger.info(logger_1.LogComponent.TUNNEL, `Stopping tunnel ${tunnelName} (${tunnelId})`);
                await cloudflaredService.stopTunnel(tunnelId);
                vscode.window.showInformationMessage(`Stopped tunnel ${tunnelName}`);
                tunnelProvider.refresh();
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to stop tunnel', error);
                vscode.window.showErrorMessage(`Failed to stop tunnel: ${error instanceof Error ? error.message : String(error)}`);
            }
        }), vscode.commands.registerCommand('tunnelfy.copyTunnelToken', async (tunnel) => {
            logger.info(logger_1.LogComponent.COMMAND, 'Copying tunnel token');
            try {
                let tunnelId;
                let tunnelName;
                // If no tunnel provided (command palette), show quick pick
                if (!tunnel) {
                    const tunnels = await cloudflaredService.listTunnels();
                    if (tunnels.length === 0) {
                        throw new Error('No tunnels found.');
                    }
                    const quickPickItems = tunnels.map(t => ({
                        label: t.name,
                        description: t.id,
                        detail: t.connections && t.connections.length > 0 ? 'Running' : 'Stopped'
                    }));
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select a tunnel to copy token',
                        title: 'Copy Tunnel Token'
                    });
                    if (!selected) {
                        return; // User cancelled
                    }
                    tunnelId = selected.description;
                    tunnelName = selected.label;
                }
                else {
                    tunnelId = tunnel.tunnelId;
                    tunnelName = tunnel.name;
                }
                const token = await cloudflaredService.getTunnelToken(tunnelId);
                if (token) {
                    const disposable = await tokenService.copyTokenToClipboard(token);
                    context.subscriptions.push(disposable);
                    vscode.window.showInformationMessage(`Token for tunnel "${tunnelName}" copied to clipboard (will be cleared in 30 seconds)`);
                }
                else {
                    throw new Error('Could not retrieve tunnel token');
                }
            }
            catch (error) {
                logger.error(logger_1.LogComponent.COMMAND, 'Failed to copy tunnel token', error);
                vscode.window.showErrorMessage(`Failed to copy tunnel token: ${error instanceof Error ? error.message : String(error)}`);
            }
        }));
        // Do an initial refresh of the views
        tunnelProvider.refresh();
        quickTunnelProvider.refresh();
        // Setup auto-refresh for the providers
        tunnelProvider.setupAutoRefresh();
        quickTunnelProvider.setupAutoRefresh();
        logger.info(logger_1.LogComponent.EXTENSION, 'Extension activated successfully');
    }
    catch (error) {
        logger.error(logger_1.LogComponent.EXTENSION, 'Failed to activate extension', error);
        throw error;
    }
}
// This method is called when your extension is deactivated
function deactivate() {
    const logger = logger_1.Logger.getInstance();
    logger.info(logger_1.LogComponent.EXTENSION, 'Deactivating extension');
    logger.dispose();
}
// Helper function to show cloudflared installation prompt
async function showCloudflaredInstallPrompt() {
    const installMac = 'Mac';
    const installWin = 'Windows';
    const installLinux = 'Linux';
    const viewInstallGuide = 'Guide';
    const result = await vscode.window.showWarningMessage('Tunnelfy uses Cloudflare CLI installed:', installMac, installWin, installLinux, viewInstallGuide);
    if (result === viewInstallGuide) {
        vscode.env.openExternal(vscode.Uri.parse('https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation'));
    }
    else if (result === installMac) {
        vscode.env.clipboard.writeText('brew install cloudflared');
        const selection = await vscode.window.showInformationMessage('Install command copied to clipboard. Run in Terminal and Default Profile will be created.');
        if (selection === 'Open Terminal') {
            await vscode.commands.executeCommand('workbench.action.terminal.new');
        }
    }
    else if (result === installWin) {
        const winResult = await vscode.window.showQuickPick([
            {
                label: 'Install with Chocolatey',
                description: 'choco install cloudflared',
            },
            {
                label: 'Install with Winget',
                description: 'winget install Cloudflare.cloudflared',
            },
            {
                label: 'Download MSI Installer',
                description: 'Download and run the installer manually',
            }
        ], { placeHolder: 'Choose installation method' });
        if (winResult) {
            if (winResult.label === 'Download MSI Installer') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/cloudflare/cloudflared/releases/latest'));
            }
            else {
                vscode.env.clipboard.writeText(winResult.description);
                vscode.window.showInformationMessage('Install command copied to clipboard. Run it in PowerShell,  and Default Profile will be created.', 'Open PowerShell').then(selection => {
                    if (selection === 'Open PowerShell') {
                        vscode.env.openExternal(vscode.Uri.parse('terminal://'));
                    }
                });
            }
        }
    }
    else if (result === installLinux) {
        const linuxResult = await vscode.window.showQuickPick([
            {
                label: 'Debian/Ubuntu',
                description: 'Using apt and curl',
            },
            {
                label: 'RHEL/Fedora',
                description: 'Using dnf',
            },
            {
                label: 'Arch Linux',
                description: 'Using yay',
            }
        ], { placeHolder: 'Choose your Linux distribution' });
        if (linuxResult) {
            let command = '';
            switch (linuxResult.label) {
                case 'Debian/Ubuntu':
                    command = 'curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared && sudo mv cloudflared /usr/local/bin';
                    break;
                case 'RHEL/Fedora':
                    command = 'dnf install cloudflared';
                    break;
                case 'Arch Linux':
                    command = 'yay -S cloudflared-bin';
                    break;
            }
            vscode.env.clipboard.writeText(command);
            vscode.window.showInformationMessage('Install command copied to clipboard. Run it in Terminal and Default Profile will be created.', 'Open Terminal').then(selection => {
                if (selection === 'Open Terminal') {
                    vscode.env.openExternal(vscode.Uri.parse('terminal://'));
                }
            });
        }
    }
}
//# sourceMappingURL=extension.js.map
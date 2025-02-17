import * as vscode from 'vscode';
import { TunnelManager, TunnelEvent } from '../services/cloudflared';
import { Logger, LogComponent } from '../utils/logger';
import { Messages } from '../utils/messages';

/**
 * Represents a quick tunnel item in the tree view
 * Displays tunnel information and provides context menu actions
 */
export class QuickTunnelTreeItem extends vscode.TreeItem {
    constructor(
        public readonly port: number,
        public readonly status: string,
        public readonly url?: string,
        public readonly tunnelUrl?: string,
        public readonly name?: string
    ) {
        // Use name as label if provided, otherwise use port
        const label = name && name.trim() ? name.trim() : `Port ${port}`;
        super(label);

        // Create a detailed tooltip with markdown formatting
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${label}**\n\n`);
        if (url) {
            this.tooltip.appendMarkdown(`**Local URL**: [${url}](${url})\n\n`);
        }
        if (tunnelUrl) {
            this.tooltip.appendMarkdown(`**Tunnel URL**: [${tunnelUrl}](${tunnelUrl})\n\n`);
        }
        this.tooltip.appendMarkdown(`**Status**: ${status}`);
        
        // Extract hostname from tunnelUrl for the description
        let hostname = '';
        if (tunnelUrl) {
            try {
                hostname = new URL(tunnelUrl).hostname;
            } catch (e) {
                hostname = tunnelUrl;
            }
        }
        
        // Show hostname and port in description
        this.description = hostname ? `${hostname} (Port ${port})` : `(Port ${port})`;
        
        // Set icon based on status
        if (status === 'active' || status === 'running') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
        }

        // Set context value for command enablement
        this.contextValue = 'quickTunnel';

        // Add command for copying tunnel URL on click
        this.command = {
            command: 'tunnelfy.copyQuickTunnelUrl',
            title: 'Copy Tunnel URL',
            arguments: [this]
        };
    }
}

interface QuickTunnel {
    port: number;
    url: string;
    tunnelUrl: string;
    name?: string;
}

/**
 * Provides the tree view for quick tunnels
 * Manages the display and state of temporary tunnels
 */
export class QuickTunnelTreeDataProvider implements vscode.TreeDataProvider<QuickTunnelTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickTunnelTreeItem | undefined | null | void> = new vscode.EventEmitter<QuickTunnelTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickTunnelTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private readonly logger = Logger.getInstance();
    private refreshInterval: NodeJS.Timeout | null = null;
    private treeView: vscode.TreeView<QuickTunnelTreeItem>;

    constructor(
        public readonly tunnelManager: TunnelManager
    ) {
        // Create the tree view
        this.treeView = vscode.window.createTreeView('tunnelfy-quick-tunnels', {
            treeDataProvider: this,
            showCollapseAll: false,
            canSelectMany: false
        });

        this.setupAutoRefresh();

        // Subscribe to tunnel events
        this.tunnelManager.onTunnelEvent((event: TunnelEvent) => {
            this.logger.debug(LogComponent.EXTENSION, `Quick tunnel event received: ${event.type} - ${event.tunnelId}`);
            if (event.type === 'start' || event.type === 'stop') {
                this.refresh();
            }
        });
    }

    private setupAutoRefresh(): void {
        // Clear existing interval if any
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }

        // Check if auto-refresh is enabled
        const config = vscode.workspace.getConfiguration('tunnelfy');
        const autoRefreshEnabled = config.get<boolean>('autoRefreshEnabled', true);
        if (!autoRefreshEnabled) {
            this.logger.debug(LogComponent.TUNNEL, 'Auto-refresh disabled by configuration');
            return;
        }

        // Get refresh interval
        const intervalSeconds = Math.max(5, Math.min(300, config.get<number>('autoRefreshInterval', 30)));
        
        // Set up new interval
        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, intervalSeconds * 1000);

        this.logger.debug(LogComponent.TUNNEL, `Auto-refresh set up with interval: ${intervalSeconds}s`);
    }

    getTreeItem(element: QuickTunnelTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<QuickTunnelTreeItem[]> {
        try {
            const quickTunnels = await this.tunnelManager.getQuickTunnels();
            return quickTunnels.map(tunnel => {
                // Ensure name is properly trimmed and not empty
                const tunnelName = tunnel.name?.trim() || undefined;
                return new QuickTunnelTreeItem(
                    tunnel.port,
                    'running',
                    tunnel.url,
                    tunnel.tunnelUrl,
                    tunnelName
                );
            });
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to get quick tunnels: ${error}`);
            return [];
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Creates a new quick tunnel
     * @param port Port number to tunnel
     * @param name Optional name for the tunnel
     */
    async addQuickTunnel(port: number, name?: string): Promise<void> {
        try {
            // Check for cloudflared installation first
            try {
                await this.tunnelManager.checkCloudflared();
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
                this.logger.warn(
                    LogComponent.EXTENSION, 
                    `Cloudflared not found during quick tunnel creation: ${errorMessage}`, 
                    { preserveFocus: true }
                );
                return;
            }

            // Create the tunnel if cloudflared is installed
            await this.tunnelManager.createQuickTunnel(port, name);
            this.refresh();
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to add quick tunnel: ${error}`);
            throw error;
        }
    }

    /**
     * Stops and removes a quick tunnel
     * @param port Port number of the tunnel to remove
     */
    async removeQuickTunnel(port: number): Promise<void> {
        try {
            await this.tunnelManager.stopQuickTunnel(port);
            this.refresh();
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to remove quick tunnel: ${error}`);
            throw error;
        }
    }

    /**
     * Gets all active quick tunnels
     * @returns Array of quick tunnel information
     */
    getQuickTunnels(): Promise<QuickTunnel[]> {
        return this.tunnelManager.getQuickTunnels();
    }

    dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.treeView.dispose();
    }
}

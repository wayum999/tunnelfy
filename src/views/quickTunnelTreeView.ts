import * as vscode from 'vscode';
import { TunnelManager, TunnelEvent } from '../services/cloudflared';
import { Logger, LogComponent } from '../utils/logger';

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
        super(name || `Port ${port}`);

        // Create a detailed tooltip with markdown formatting
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${name || `Port ${port}`}**\n\n`);
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
        
        // Show port in description along with hostname
        this.description = `${hostname} (Port ${port})`;
        
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
        private readonly tunnelManager: TunnelManager
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
            return quickTunnels.map((tunnel: { port: number; url: string; tunnelUrl: string; name?: string }) => new QuickTunnelTreeItem(
                tunnel.port,
                'running',
                tunnel.url,
                tunnel.tunnelUrl,
                tunnel.name
            ));
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
            await this.tunnelManager.createQuickTunnel(port);
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

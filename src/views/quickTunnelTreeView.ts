import * as vscode from 'vscode';
import { TunnelManager, TunnelEvent } from '../services/cloudflared';
import { Logger, LogComponent } from '../utils/logger';

export class QuickTunnelTreeItem extends vscode.TreeItem {
    constructor(
        public readonly port: number,
        public readonly status: string,
        public readonly url?: string,
        public readonly tunnelUrl?: string
    ) {
        super(`Port ${port}`);
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**Port ${port}**\n\n`);
        if (url) {
            this.tooltip.appendMarkdown(`**Local URL**: [${url}](${url})\n\n`);
        }
        if (tunnelUrl) {
            this.tooltip.appendMarkdown(`**Tunnel URL**: [${tunnelUrl}](${tunnelUrl})\n\n`);
        }
        this.tooltip.appendMarkdown(`**Status**: ${status}`);
        
        // Extract hostname from tunnelUrl
        let hostname = '';
        if (tunnelUrl) {
            try {
                hostname = new URL(tunnelUrl).hostname;
            } catch (e) {
                // If URL parsing fails, just use the tunnelUrl
                hostname = tunnelUrl;
            }
        }
        
        this.description = hostname;
        
        // Set icon based on status
        if (status === 'active' || status === 'running') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
        }

        this.contextValue = 'quickTunnel';
    }
}

interface QuickTunnel {
    port: number;
    url: string;
    tunnelUrl: string;
}

export class QuickTunnelTreeDataProvider implements vscode.TreeDataProvider<QuickTunnelTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickTunnelTreeItem | undefined | null | void> = new vscode.EventEmitter<QuickTunnelTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickTunnelTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private quickTunnels: Map<number, QuickTunnel> = new Map();
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
            const items: QuickTunnelTreeItem[] = [];
            for (const [port, tunnel] of this.quickTunnels) {
                items.push(new QuickTunnelTreeItem(
                    port,
                    'running',
                    tunnel.url,
                    tunnel.tunnelUrl
                ));
            }
            return items;
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to get quick tunnels: ${error}`);
            return [];
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async addQuickTunnel(port: number): Promise<void> {
        try {
            const result = await this.tunnelManager.createQuickTunnel(port);
            if (result) {
                this.quickTunnels.set(port, {
                    port,
                    url: `http://localhost:${port}`,
                    tunnelUrl: result.tunnelUrl
                });
                this.refresh();
            }
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to add quick tunnel: ${error}`);
            throw error;
        }
    }

    async removeQuickTunnel(port: number): Promise<void> {
        try {
            await this.tunnelManager.stopQuickTunnel(port);
            this.quickTunnels.delete(port);
            this.refresh();
        } catch (error) {
            this.logger.error(LogComponent.EXTENSION, `Failed to remove quick tunnel: ${error}`);
            throw error;
        }
    }

    getQuickTunnels(): QuickTunnel[] {
        return Array.from(this.quickTunnels.values());
    }

    dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.treeView.dispose();
    }
}

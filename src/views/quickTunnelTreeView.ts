import * as vscode from 'vscode';
import { CloudflaredService } from '../services/cloudflaredService';
import { Logger, LogComponent } from '../utils/logger';
import { ProfileManager } from '../services/profileManager';

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
        
        // Add command to handle clicking on the item
        this.command = {
            command: 'tunnelfy.tunnelInfo',
            title: 'Show Tunnel Info',
            arguments: [this]
        };
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

    constructor(
        private readonly cloudflaredService: CloudflaredService
    ) {
        this.logger.debug(LogComponent.TUNNEL, 'QuickTunnelTreeDataProvider initialized');
        this.setupAutoRefresh();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('tunnelfy.autoRefreshEnabled') || 
                e.affectsConfiguration('tunnelfy.autoRefreshInterval')) {
                this.setupAutoRefresh();
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
        return Array.from(this.quickTunnels.values()).map(tunnel => 
            new QuickTunnelTreeItem(
                tunnel.port,
                tunnel.url,
                tunnel.tunnelUrl
            )
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    async addQuickTunnel(port: number): Promise<void> {
        try {
            const result = await this.cloudflaredService.createQuickTunnel(port);
            if (result) {
                this.quickTunnels.set(port, {
                    port,
                    url: result.url,
                    tunnelUrl: result.tunnelUrl
                });
                this.refresh();
            }
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to add quick tunnel:', error);
            throw error;
        }
    }

    async removeQuickTunnel(port: number): Promise<void> {
        this.quickTunnels.delete(port);
        this.refresh();
    }

    getQuickTunnels(): QuickTunnel[] {
        return Array.from(this.quickTunnels.values());
    }

    dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }
}

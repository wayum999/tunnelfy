import * as vscode from 'vscode';
import { CloudflaredService } from '../services/cloudflaredService';
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
        
        // Add command to handle clicking on the item
        this.command = {
            command: 'tunnelfy.tunnelInfo',
            title: 'Show Tunnel Info',
            arguments: [this]
        };
    }
}

export class QuickTunnelTreeDataProvider implements vscode.TreeDataProvider<QuickTunnelTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickTunnelTreeItem | undefined | null | void> = new vscode.EventEmitter<QuickTunnelTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickTunnelTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private readonly logger: Logger;
    private currentItems: QuickTunnelTreeItem[] = [];
    private activeQuickTunnels: Map<number, { url: string; tunnelUrl: string }> = new Map();
    private cloudflaredInstalled: boolean | null = null;
    private refreshInterval: NodeJS.Timeout | null = null;

    constructor(
        private cloudflaredService: CloudflaredService,
        initialCloudflaredStatus: boolean = true
    ) {
        this.logger = Logger.getInstance();
        this.logger.debug(LogComponent.TUNNEL, 'QuickTunnelTreeDataProvider initialized');
        
        // Set initial cloudflared status
        this.cloudflaredInstalled = initialCloudflaredStatus;

        // Start refresh cycle if enabled
        this.setupAutoRefresh();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('tunnelfy.autoRefreshEnabled') || 
                e.affectsConfiguration('tunnelfy.autoRefreshInterval')) {
                this.setupAutoRefresh();
            }
        });
    }

    /**
     * Sets up or updates the auto-refresh cycle based on current settings
     */
    public setupAutoRefresh(): void {
        const config = vscode.workspace.getConfiguration('tunnelfy');
        const autoRefreshEnabled = config.get('autoRefreshEnabled', true);
        const intervalSeconds = config.get('autoRefreshInterval', 30);

        // Clear existing interval if any
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }

        // Set up new interval if enabled
        if (autoRefreshEnabled) {
            this.refreshInterval = setInterval(() => {
                this.refresh();
            }, intervalSeconds * 1000) as unknown as NodeJS.Timeout;
            this.logger.debug(LogComponent.TUNNEL, `Auto-refresh enabled with ${intervalSeconds}s interval`);
        } else {
            this.logger.debug(LogComponent.TUNNEL, 'Auto-refresh disabled');
        }
    }

    /**
     * Check if cloudflared is installed and cache the result
     */
    private async checkCloudflaredInstallation(): Promise<void> {
        this.cloudflaredInstalled = await this.cloudflaredService.checkInstallation();
    }

    async refresh(): Promise<void> {
        try {
            // Only check installation status if we haven't checked before and checks are enabled
            const checkOnStartup = vscode.workspace.getConfiguration('tunnelfy').get('checkCloudflaredOnStartup', true);
            if (this.cloudflaredInstalled === null && checkOnStartup) {
                await this.checkCloudflaredInstallation();
            }

            // Clear view if cloudflared is not installed
            if (this.cloudflaredInstalled === false) {
                this.currentItems = [];
                this._onDidChangeTreeData.fire();
                return;
            }

            // Convert active quick tunnels to tree items
            this.currentItems = Array.from(this.activeQuickTunnels.entries()).map(([port, tunnel]) => 
                new QuickTunnelTreeItem(
                    port,
                    'active',
                    tunnel.url,
                    tunnel.tunnelUrl
                )
            );
            this._onDidChangeTreeData.fire();
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to refresh quick tunnels', error as Error);
            vscode.window.showErrorMessage('Failed to refresh quick tunnels');
        }
    }

    startRefreshCycle(): void {
        // Set up auto-refresh every 30 seconds
        setInterval(() => {
            this.refresh();
        }, 30000);

        // Start initial refresh
        this.refresh().catch(error => {
            this.logger.error(LogComponent.TUNNEL, 'Failed to load initial quick tunnels:', error);
        });
    }

    async addQuickTunnel(port: number): Promise<void> {
        const result = await this.cloudflaredService.createQuickTunnel(port);
        if (result) {
            this.activeQuickTunnels.set(port, result);
            await this.refresh();
        }
    }

    async removeQuickTunnel(port: number): Promise<void> {
        await this.cloudflaredService.stopQuickTunnel(port);
        this.activeQuickTunnels.delete(port);
        await this.refresh();
    }

    getTreeItem(element: QuickTunnelTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QuickTunnelTreeItem): Thenable<QuickTunnelTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }
        return Promise.resolve(this.currentItems);
    }

    getParent(_element: QuickTunnelTreeItem): vscode.ProviderResult<QuickTunnelTreeItem> {
        return null;
    }

    async getQuickTunnels(): Promise<QuickTunnelTreeItem[]> {
        return this.currentItems;
    }
}

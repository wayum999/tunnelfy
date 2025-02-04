import * as vscode from 'vscode';
import { CloudflaredService } from '../services/cloudflaredService';
import { Logger } from '../utils/logger';
import { ProfileManager } from '../services/profileManager';

/**
 * TunnelTreeItem - Represents a single tunnel entry in the VS Code tree view
 * 
 * This class extends VS Code's TreeItem, encapsulating tunnel details such as label, tunnel ID,
 * connection URL, and status. It sets up tooltips, descriptions, and icons based on the tunnel's
 * current state (active/inactive) and type (quick tunnel vs. persistent tunnel).
 */
export class TunnelTreeItem extends vscode.TreeItem {
    public readonly name: string;

    constructor(
        public readonly label: string,
        public readonly tunnelId: string,
        public readonly status: string,
        public readonly connectionUrl?: string,
        public readonly isQuickTunnel: boolean = false,
        public readonly port?: number
    ) {
        super(label);
        // Set name property to match label
        this.name = label;
        
        // Initialize tooltip with formatted markdown to show tunnel details
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${label}**\n\n`);
        if (tunnelId) {
            this.tooltip.appendMarkdown(`**ID**: ${tunnelId}\n\n`);
        }
        if (connectionUrl) {
            this.tooltip.appendMarkdown(`**URL**: [${connectionUrl}](${connectionUrl})\n\n`);
        }
        if (port) {
            this.tooltip.appendMarkdown(`**Port**: ${port}\n\n`);
        }
        this.tooltip.appendMarkdown(`**Status**: ${status}`);
        
        // Set description for display in the tree view
        this.description = isQuickTunnel ? `Port ${port}` : tunnelId;
        
        // Set icon and context value based on tunnel status to control appearance and available commands
        if (status === 'active') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
            this.contextValue = 'tunnel-running';
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
            this.contextValue = 'tunnel-stopped';
        }
    }
}

/**
 * TunnelTreeDataProvider - Provides tunnel data for the VS Code tree view
 * 
 * This class implements VS Code's TreeDataProvider interface and is responsible for:
 * 1. Fetching tunnel data from the CloudflaredService
 * 2. Transforming tunnel data into TunnelTreeItems
 * 3. Managing a periodic refresh cycle to keep the view up to date
 * 4. Handling updates triggered by tunnel events (e.g., status changes)
 */
export class TunnelTreeDataProvider implements vscode.TreeDataProvider<TunnelTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TunnelTreeItem | undefined | null | void> = new vscode.EventEmitter<TunnelTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TunnelTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private readonly logger: Logger;
    private treeView: vscode.TreeView<TunnelTreeItem>;
    private currentItems: TunnelTreeItem[] = [];
    private cloudflaredInstalled: boolean | null = null;
    private refreshInterval: NodeJS.Timeout | null = null;
    private _refreshing: boolean = false;

    /**
     * Constructor sets up the tree view and event listeners
     * 
     * @param cloudflaredService - Service providing tunnel operations
     * @param profileManager - Manager for cloudflared profiles
     * @param initialCloudflaredStatus - Initial cloudflared status
     */
    constructor(
        private cloudflaredService: CloudflaredService,
        private profileManager: ProfileManager,
        initialCloudflaredStatus: boolean = true
    ) {
        this.logger = Logger.getInstance();
        this.logger.debug('TunnelTreeDataProvider', 'initialized');
        
        // Set initial cloudflared status
        this.cloudflaredInstalled = initialCloudflaredStatus;

        // Create the tree view in the VS Code sidebar under the 'tunnelfy-tunnels' view
        this.treeView = vscode.window.createTreeView('tunnelfy-tunnels', {
            treeDataProvider: this,
            showCollapseAll: false,
            canSelectMany: false
        });

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('tunnelfy.autoRefreshEnabled') || 
                e.affectsConfiguration('tunnelfy.autoRefreshInterval')) {
                this.setupAutoRefresh();
            }
        });

        // Listen to tunnel events from CloudflaredService; refresh view on status changes
        this.cloudflaredService.onTunnelEvent(event => {
            if (event.type === 'status') {
                this.refresh();
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
            // Do an initial refresh before setting up the interval
            this.refresh().then(() => {
                this.refreshInterval = setInterval(async () => {
                    this.logger.info('TunnelTreeDataProvider', `Auto-refreshing tunnels (${intervalSeconds}s interval)`);
                    await this.refresh();
                }, intervalSeconds * 1000) as unknown as NodeJS.Timeout;
                this.logger.info('TunnelTreeDataProvider', `Auto-refresh enabled with ${intervalSeconds}s interval`);
            }).catch(error => {
                this.logger.error('TunnelTreeDataProvider', `Failed to do initial refresh: ${String(error)}`);
            });
        } else {
            this.logger.info('TunnelTreeDataProvider', 'Auto-refresh disabled');
        }
    }

    /**
     * Check if cloudflared is installed and cache the result
     */
    private async checkCloudflaredInstallation(): Promise<void> {
        this.cloudflaredInstalled = await this.profileManager.isCloudflaredInstalled();
    }

    /**
     * Public refresh method to update tunnel data
     * 
     * Fetches tunnel information, transforms it into TunnelTreeItems, and refreshes the view
     */
    async refresh(): Promise<void> {
        // Use a lock to prevent concurrent refreshes
        if (this._refreshing) {
            this.logger.debug('TunnelTreeDataProvider', 'Refresh already in progress, skipping');
            return;
        }

        this._refreshing = true;
        this.logger.info('TunnelTreeDataProvider', 'Refreshing tunnels...');
        
        try {
            // Only check installation status if we haven't checked before
            // Note: We respect the initial status passed from extension.ts
            if (this.cloudflaredInstalled === null) {
                await this.checkCloudflaredInstallation();
            }

            // Clear view if cloudflared is not installed
            if (this.cloudflaredInstalled === false) {
                this.currentItems = [];
                this._onDidChangeTreeData.fire();
                return;
            }

            // Get the list of tunnels
            const tunnels = await this.cloudflaredService.listTunnels();
            
            // Map tunnel data into TunnelTreeItems
            this.currentItems = tunnels.map((tunnel) => {
                // Determine status based on active connections
                const status = tunnel.connections && tunnel.connections.length > 0 ? 'active' : 'inactive';
                this.logger.debug('TunnelTreeDataProvider', `Tunnel ${tunnel.name} status: ${status} (${tunnel.connections?.length || 0} connections)`);

                return new TunnelTreeItem(
                    tunnel.name,
                    tunnel.id,
                    status,
                    tunnel.url,
                    false,
                    undefined
                );
            });

            // Trigger a refresh of the view
            this._onDidChangeTreeData.fire();
            this.logger.info('TunnelTreeDataProvider', `Refresh complete. Found ${tunnels.length} tunnels.`);
        } catch (error) {
            this.logger.error('TunnelTreeDataProvider', `Failed to refresh tunnels: ${String(error)}`);
            throw error;
        } finally {
            this._refreshing = false;
        }
    }

    /**
     * Returns the TreeItem representation of an element
     * 
     * @param element - A TunnelTreeItem instance
     * @returns The corresponding vscode.TreeItem
     */
    getTreeItem(element: TunnelTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * For a flat tree, there is no parent. Return null.
     */
    getParent(_element: TunnelTreeItem): vscode.ProviderResult<TunnelTreeItem> {
        return null;
    }

    /**
     * Provides children for the tree view. For a flat list, returns all tunnels if no element is specified.
     * 
     * @param element - Optional TunnelTreeItem (not used here as the tree is flat)
     * @returns Promise resolving to an array of TunnelTreeItems
     */
    async getChildren(element?: TunnelTreeItem): Promise<TunnelTreeItem[]> {
        if (element) {
            return [];
        }
        return this.currentItems;
    }
}
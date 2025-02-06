"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TunnelTreeDataProvider = exports.TunnelTreeItem = void 0;
const vscode = require("vscode");
const logger_1 = require("../utils/logger");
/**
 * TunnelTreeItem - Represents a single tunnel entry in the VS Code tree view
 *
 * This class extends VS Code's TreeItem, encapsulating tunnel details such as label, tunnel ID,
 * connection URL, and status. It sets up tooltips, descriptions, and icons based on the tunnel's
 * current state (active/inactive) and type (quick tunnel vs. persistent tunnel).
 */
class TunnelTreeItem extends vscode.TreeItem {
    constructor(label, tunnelId, status, connectionUrl, isQuickTunnel = false, port) {
        super(label);
        this.label = label;
        this.tunnelId = tunnelId;
        this.status = status;
        this.connectionUrl = connectionUrl;
        this.isQuickTunnel = isQuickTunnel;
        this.port = port;
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
        }
        else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
            this.contextValue = 'tunnel-stopped';
        }
    }
}
exports.TunnelTreeItem = TunnelTreeItem;
/**
 * TunnelTreeDataProvider - Provides tunnel data for the VS Code tree view
 *
 * This class implements VS Code's TreeDataProvider interface and is responsible for:
 * 1. Fetching tunnel data from the CloudflaredService
 * 2. Transforming tunnel data into TunnelTreeItems
 * 3. Managing a periodic refresh cycle to keep the view up to date
 * 4. Handling updates triggered by tunnel events (e.g., status changes)
 */
class TunnelTreeDataProvider {
    /**
     * Constructor sets up the tree view and event listeners
     *
     * @param cloudflaredService - Service providing tunnel operations
     * @param profileManager - Manager for cloudflared profiles
     * @param initialCloudflaredStatus - Initial cloudflared status
     */
    constructor(cloudflaredService, profileManager, initialCloudflaredStatus = true) {
        this.cloudflaredService = cloudflaredService;
        this.profileManager = profileManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.currentItems = [];
        this.cloudflaredInstalled = null;
        this.refreshInterval = null;
        this._refreshing = false;
        this.logger = logger_1.Logger.getInstance();
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
    setupAutoRefresh() {
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
                }, intervalSeconds * 1000);
                this.logger.info('TunnelTreeDataProvider', `Auto-refresh enabled with ${intervalSeconds}s interval`);
            }).catch(error => {
                this.logger.error('TunnelTreeDataProvider', `Failed to do initial refresh: ${String(error)}`);
            });
        }
        else {
            this.logger.info('TunnelTreeDataProvider', 'Auto-refresh disabled');
        }
    }
    /**
     * Check if cloudflared is installed and cache the result
     */
    async checkCloudflaredInstallation() {
        this.cloudflaredInstalled = await this.profileManager.isCloudflaredInstalled();
    }
    /**
     * Public refresh method to update tunnel data
     *
     * Fetches tunnel information, transforms it into TunnelTreeItems, and refreshes the view
     */
    async refresh() {
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
                return new TunnelTreeItem(tunnel.name, tunnel.id, status, tunnel.url, false, undefined);
            });
            // Trigger a refresh of the view
            this._onDidChangeTreeData.fire();
            this.logger.info('TunnelTreeDataProvider', `Refresh complete. Found ${tunnels.length} tunnels.`);
        }
        catch (error) {
            this.logger.error('TunnelTreeDataProvider', `Failed to refresh tunnels: ${String(error)}`);
            throw error;
        }
        finally {
            this._refreshing = false;
        }
    }
    /**
     * Returns the TreeItem representation of an element
     *
     * @param element - A TunnelTreeItem instance
     * @returns The corresponding vscode.TreeItem
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * For a flat tree, there is no parent. Return null.
     */
    getParent(_element) {
        return null;
    }
    /**
     * Provides children for the tree view. For a flat list, returns all tunnels if no element is specified.
     *
     * @param element - Optional TunnelTreeItem (not used here as the tree is flat)
     * @returns Promise resolving to an array of TunnelTreeItems
     */
    async getChildren(element) {
        if (element) {
            return [];
        }
        return this.currentItems;
    }
}
exports.TunnelTreeDataProvider = TunnelTreeDataProvider;
//# sourceMappingURL=tunnelTreeView.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickTunnelTreeDataProvider = exports.QuickTunnelTreeItem = void 0;
const vscode = require("vscode");
const logger_1 = require("../utils/logger");
class QuickTunnelTreeItem extends vscode.TreeItem {
    constructor(port, status, url, tunnelUrl) {
        super(`Port ${port}`);
        this.port = port;
        this.status = status;
        this.url = url;
        this.tunnelUrl = tunnelUrl;
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
            }
            catch (e) {
                // If URL parsing fails, just use the tunnelUrl
                hostname = tunnelUrl;
            }
        }
        this.description = hostname;
        // Set icon based on status
        if (status === 'active' || status === 'running') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        }
        else {
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
exports.QuickTunnelTreeItem = QuickTunnelTreeItem;
class QuickTunnelTreeDataProvider {
    constructor(cloudflaredService, initialCloudflaredStatus = true) {
        this.cloudflaredService = cloudflaredService;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.currentItems = [];
        this.activeQuickTunnels = new Map();
        this.cloudflaredInstalled = null;
        this.refreshInterval = null;
        this.logger = logger_1.Logger.getInstance();
        this.logger.debug(logger_1.LogComponent.TUNNEL, 'QuickTunnelTreeDataProvider initialized');
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
            this.refreshInterval = setInterval(() => {
                this.refresh();
            }, intervalSeconds * 1000);
            this.logger.debug(logger_1.LogComponent.TUNNEL, `Auto-refresh enabled with ${intervalSeconds}s interval`);
        }
        else {
            this.logger.debug(logger_1.LogComponent.TUNNEL, 'Auto-refresh disabled');
        }
    }
    /**
     * Check if cloudflared is installed and cache the result
     */
    async checkCloudflaredInstallation() {
        this.cloudflaredInstalled = await this.cloudflaredService.checkInstallation();
    }
    async refresh() {
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
            this.currentItems = Array.from(this.activeQuickTunnels.entries()).map(([port, tunnel]) => new QuickTunnelTreeItem(port, 'active', tunnel.url, tunnel.tunnelUrl));
            this._onDidChangeTreeData.fire();
        }
        catch (error) {
            this.logger.error(logger_1.LogComponent.TUNNEL, 'Failed to refresh quick tunnels', error);
            vscode.window.showErrorMessage('Failed to refresh quick tunnels');
        }
    }
    startRefreshCycle() {
        // Set up auto-refresh every 30 seconds
        setInterval(() => {
            this.refresh();
        }, 30000);
        // Start initial refresh
        this.refresh().catch(error => {
            this.logger.error(logger_1.LogComponent.TUNNEL, 'Failed to load initial quick tunnels:', error);
        });
    }
    async addQuickTunnel(port) {
        const result = await this.cloudflaredService.createQuickTunnel(port);
        if (result) {
            this.activeQuickTunnels.set(port, result);
            await this.refresh();
        }
    }
    async removeQuickTunnel(port) {
        await this.cloudflaredService.stopQuickTunnel(port);
        this.activeQuickTunnels.delete(port);
        await this.refresh();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        return Promise.resolve(this.currentItems);
    }
    getParent(_element) {
        return null;
    }
    async getQuickTunnels() {
        return this.currentItems;
    }
}
exports.QuickTunnelTreeDataProvider = QuickTunnelTreeDataProvider;
//# sourceMappingURL=quickTunnelTreeView.js.map
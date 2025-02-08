import * as vscode from 'vscode';
import { CloudflaredService } from '../services/cloudflaredService';
import { ProfileManager } from '../services/profileManager';
import { Logger, LogComponent } from '../utils/logger';

/**
 * TunnelTreeItem - Represents a single tunnel entry in the VS Code tree view
 * 
 * This class extends VS Code's TreeItem, encapsulating tunnel details such as label, tunnel ID,
 * connection URL, and status. It sets up tooltips, descriptions, and icons based on the tunnel's
 * current state (active/inactive) and type (quick tunnel vs. persistent tunnel).
 */
export class TunnelTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tunnelId: string,
        public readonly status: 'running' | 'stopped'
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.contextValue = `tunnel-${status}`;
        this.description = tunnelId;
        this.tooltip = `${label} (${tunnelId})`;

        // Set icon based on status
        if (status === 'running') {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
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
    private refreshInterval: NodeJS.Timeout | null = null;
    private treeView: vscode.TreeView<TunnelTreeItem>;

    constructor(
        private readonly cloudflaredService: CloudflaredService,
        private readonly profileManager: ProfileManager
    ) {
        this.logger = Logger.getInstance();
        this.logger.debug(LogComponent.TUNNEL, 'TunnelTreeDataProvider initialized');

        // Create the tree view
        this.treeView = vscode.window.createTreeView('tunnelfy-tunnels', {
            treeDataProvider: this,
            showCollapseAll: false,
            canSelectMany: false
        });

        // Set up auto-refresh
        this.setupAutoRefresh();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('tunnelfy.autoRefreshEnabled') || 
                e.affectsConfiguration('tunnelfy.autoRefreshInterval')) {
                this.setupAutoRefresh();
            }
        });

        // Listen to tunnel events from CloudflaredService
        this.cloudflaredService.onTunnelEvent(event => {
            if (event.type === 'status') {
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

    getTreeItem(element: TunnelTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<TunnelTreeItem[]> {
        try {
            const activeProfile = await this.profileManager.getActiveProfile();
            if (!activeProfile) {
                return [];
            }

            const tunnels = await this.cloudflaredService.listTunnels();
            return Promise.all(
                tunnels.map(async tunnel => {
                    const isRunning = tunnel.connections && tunnel.connections.length > 0;
                    return new TunnelTreeItem(
                        tunnel.name,
                        tunnel.id,
                        isRunning ? 'running' : 'stopped'
                    );
                })
            );
        } catch (error) {
            this.logger.error(LogComponent.TUNNEL, 'Failed to get tunnels:', error);
            throw error;
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.treeView.dispose();
    }
}
import * as vscode from 'vscode';
import { TunnelManager } from '../services/cloudflared';

export declare class QuickTunnelTreeItem extends vscode.TreeItem {
    readonly label: string;
    readonly port: number;
    readonly status: string;
    readonly url?: string | undefined;
    readonly tunnelUrl?: string | undefined;
    constructor(label: string, port: number, status: string, url?: string | undefined, tunnelUrl?: string | undefined);
}

export declare class QuickTunnelTreeDataProvider implements vscode.TreeDataProvider<QuickTunnelTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<QuickTunnelTreeItem | undefined | null | void>;
    private readonly logger;
    private treeView;
    private currentItems;
    tunnelManager: TunnelManager;

    constructor(tunnelManager: TunnelManager);
    refresh(): void;
    getTreeItem(element: QuickTunnelTreeItem): vscode.TreeItem;
    getParent(_element: QuickTunnelTreeItem): vscode.ProviderResult<QuickTunnelTreeItem>;
    getChildren(element?: QuickTunnelTreeItem): Promise<QuickTunnelTreeItem[]>;
    addQuickTunnel(port: number, name?: string): Promise<void>;
    removeQuickTunnel(port: number): Promise<void>;
    hasPort(port: number): boolean;
}

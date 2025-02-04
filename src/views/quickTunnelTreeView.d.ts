import * as vscode from 'vscode';
import { CloudflaredService } from '../services/cloudflaredService';
export declare class QuickTunnelTreeItem extends vscode.TreeItem {
    readonly label: string;
    readonly port: number;
    readonly status: string;
    readonly url?: string | undefined;
    readonly tunnelUrl?: string | undefined;
    constructor(label: string, port: number, status: string, url?: string | undefined, tunnelUrl?: string | undefined);
}
export declare class QuickTunnelTreeDataProvider implements vscode.TreeDataProvider<QuickTunnelTreeItem> {
    private cloudflaredService;
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<QuickTunnelTreeItem | undefined | null | void>;
    private readonly logger;
    private treeView;
    private currentItems;
    constructor(cloudflaredService: CloudflaredService);
    refresh(): void;
    getTreeItem(element: QuickTunnelTreeItem): vscode.TreeItem;
    getParent(_element: QuickTunnelTreeItem): vscode.ProviderResult<QuickTunnelTreeItem>;
    getChildren(element?: QuickTunnelTreeItem): Promise<QuickTunnelTreeItem[]>;
    addQuickTunnel(port: number, url: string, tunnelUrl: string): void;
    removeQuickTunnel(port: number): void;
    hasPort(port: number): boolean;
}

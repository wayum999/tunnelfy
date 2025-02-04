import * as vscode from 'vscode';
import { CloudflaredService } from '../services/cloudflaredService';
export declare class TunnelTreeItem extends vscode.TreeItem {
    readonly label: string;
    readonly tunnelId: string;
    readonly status: string;
    readonly connectionUrl?: string | undefined;
    readonly isQuickTunnel: boolean;
    readonly port?: number | undefined;
    constructor(label: string, tunnelId: string, status: string, connectionUrl?: string | undefined, isQuickTunnel?: boolean, port?: number | undefined);
}
export declare class TunnelTreeDataProvider implements vscode.TreeDataProvider<TunnelTreeItem> {
    private cloudflaredService;
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<TunnelTreeItem | undefined | null | void>;
    private readonly logger;
    private treeView;
    private currentItems;
    constructor(cloudflaredService: CloudflaredService);
    updateService(service: CloudflaredService): void;
    refresh(): void;
    getTreeItem(element: TunnelTreeItem): vscode.TreeItem;
    getParent(_element: TunnelTreeItem): vscode.ProviderResult<TunnelTreeItem>;
    getChildren(element?: TunnelTreeItem): Promise<TunnelTreeItem[]>;
}

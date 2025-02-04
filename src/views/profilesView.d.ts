import * as vscode from 'vscode';
import { ProfileManager } from '../services/profileManager';
export declare class ProfilesProvider implements vscode.TreeDataProvider<ProfileItem>, vscode.Disposable {
    private profileManager;
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<ProfileItem | undefined | null | void>;
    constructor(profileManager: ProfileManager);
    dispose(): void;
    refresh(): void;
    getTreeItem(element: ProfileItem): vscode.TreeItem;
    getChildren(element?: ProfileItem): Promise<ProfileItem[]>;
}
declare class ProfileItem extends vscode.TreeItem {
    readonly label: string;
    readonly isActive: boolean;
    readonly collapsibleState: vscode.TreeItemCollapsibleState;
    constructor(label: string, isActive: boolean, collapsibleState: vscode.TreeItemCollapsibleState);
}
export {};

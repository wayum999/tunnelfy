import * as vscode from 'vscode';
import { ProfileManager } from '../services/profileManager';

export class ProfilesProvider implements vscode.TreeDataProvider<ProfileItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<ProfileItem | undefined | null | void> = new vscode.EventEmitter<ProfileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProfileItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private profileManager: ProfileManager) {}

    dispose() {
        this._onDidChangeTreeData.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ProfileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProfileItem): Promise<ProfileItem[]> {
        if (element) {
            return [];
        }

        const profiles = await this.profileManager.listProfiles();
        const activeProfile = await this.profileManager.getActiveProfile();

        return profiles.map(profile => new ProfileItem(
            profile,
            profile === activeProfile,
            vscode.TreeItemCollapsibleState.None
        ));
    }
}

class ProfileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly isActive: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.contextValue = isActive ? 'profile-active' : 'profile-inactive';
        this.description = isActive ? '(active)' : '';
        this.iconPath = new vscode.ThemeIcon(isActive ? 'verified' : 'person');
    }
}

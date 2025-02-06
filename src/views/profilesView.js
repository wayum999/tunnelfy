"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfilesProvider = void 0;
const vscode = require("vscode");
class ProfilesProvider {
    constructor(profileManager) {
        this.profileManager = profileManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    dispose() {
        this._onDidChangeTreeData.dispose();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element) {
            return [];
        }
        const profiles = await this.profileManager.listProfiles();
        const activeProfile = await this.profileManager.getActiveProfile();
        return profiles.map(profile => new ProfileItem(profile, profile === activeProfile, vscode.TreeItemCollapsibleState.None));
    }
}
exports.ProfilesProvider = ProfilesProvider;
class ProfileItem extends vscode.TreeItem {
    constructor(label, isActive, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.isActive = isActive;
        this.collapsibleState = collapsibleState;
        this.contextValue = isActive ? 'profile-active' : 'profile-inactive';
        this.description = isActive ? '(active)' : '';
        this.iconPath = new vscode.ThemeIcon(isActive ? 'verified' : 'person');
    }
}
//# sourceMappingURL=profilesView.js.map
import * as vscode from "vscode";
import { ProfileManager } from "../services/profileManager";

/**
 * ProfilesProvider - Tree View Provider for Cloudflare Profiles
 *
 * This class manages the VS Code TreeView that displays Cloudflare profiles in the sidebar.
 * It provides functionality to:
 * 1. Display all configured Cloudflare profiles
 * 2. Highlight the currently active profile
 * 3. Support profile-specific context menu actions
 * 4. Refresh the view when profiles are modified
 *
 * Each profile is displayed with:
 * - A distinct icon indicating active/inactive status
 * - The profile name
 * - An (active) indicator for the current profile
 * - Context menu options for profile management
 */
export class ProfilesProvider
  implements vscode.TreeDataProvider<ProfileItem>, vscode.Disposable
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ProfileItem | undefined | null | void
  > = new vscode.EventEmitter<ProfileItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ProfileItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(private profileManager: ProfileManager) {}

  dispose() {
    this._onDidChangeTreeData.dispose();
  }

  /**
   * Triggers a refresh of the profiles view
   * Called when profiles are added, removed, or modified
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Returns the tree item for a given profile
   * @param element The profile item to display
   * @returns A VS Code TreeItem configured for the profile
   */
  getTreeItem(element: ProfileItem): vscode.TreeItem {
    return element;
  }

  /**
   * Retrieves all profiles to display in the tree view
   * @param element Parent element (unused as this is a flat list)
   * @returns Array of ProfileItems representing each Cloudflare profile
   */
  async getChildren(element?: ProfileItem): Promise<ProfileItem[]> {
    if (element) {
      return [];
    }

    const profiles = await this.profileManager.listProfiles();
    const activeProfile = await this.profileManager.getActiveProfile();

    return profiles.map(
      (profile) =>
        new ProfileItem(
          profile,
          profile === activeProfile,
          vscode.TreeItemCollapsibleState.None,
        ),
    );
  }
}

/**
 * ProfileItem - Represents a single Cloudflare profile in the tree view
 *
 * Properties:
 * - label: The profile name
 * - isActive: Whether this is the currently active profile
 * - contextValue: Determines available context menu actions
 * - description: Shows (active) for the current profile
 * - iconPath: Visual indicator of profile status
 */
class ProfileItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly isActive: boolean,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.contextValue = isActive ? "profile-active" : "profile-inactive";
    this.description = isActive ? "(active)" : "";
    this.iconPath = new vscode.ThemeIcon(isActive ? "verified" : "person");
  }
}

import * as vscode from "vscode";
import { ProfileManager } from "../services/profileManager";
import { CloudflareApiService } from "../services/cloudflareApi";
import { ProfilesProvider } from "../views/profilesView";
import { TunnelTreeDataProvider } from "../views/tunnelTreeView";
import { Messages } from "../utils/messages";

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profilesProvider: ProfilesProvider,
  tunnelProvider: TunnelTreeDataProvider,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Create Profile Command
  disposables.push(
    vscode.commands.registerCommand("tunnelfy.createProfile", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Enter a name for the new profile",
        placeHolder: "my-profile",
        ignoreFocusOut: true,
      });

      if (!name) {
        return;
      }

      const apiKey = await vscode.window.showInputBox({
        prompt: "Enter your Cloudflare API key",
        placeHolder: "your-api-key",
        password: true,
        ignoreFocusOut: true,
      });

      if (!apiKey) {
        return;
      }

      try {
        // Create a temporary API service instance
        const tempApiService = new CloudflareApiService(
          context,
          profileManager,
        );
        await tempApiService.setApiKey(apiKey);

        // Fetch available accounts
        const accounts = await tempApiService.listAccounts();
        if (!accounts || accounts.length === 0) {
          throw new Error(Messages.NO_PROFILES_FOUND);
        }

        // Let user select an account
        const selectedAccount = await vscode.window.showQuickPick(
          accounts.map((account) => ({
            label: account.name,
            description: `Account ID: ${account.id}`,
            account,
          })),
          {
            placeHolder: "Select a Cloudflare account",
            ignoreFocusOut: true,
          },
        );

        if (!selectedAccount) {
          return;
        }

        // Create the profile with the selected account
        await profileManager.createProfile(
          name,
          apiKey,
          selectedAccount.account.id,
        );
        profilesProvider.refresh();

        // If this was the first profile created, refresh the tunnel list
        const profiles = await profileManager.listProfiles();
        if (profiles.length === 1) {
          tunnelProvider.refresh();
        }

        await Messages.showInfo(Messages.PROFILE_CREATED(name));
      } catch (error) {
        await Messages.showError(Messages.ERROR_CREATE_PROFILE(error));
      }
    }),
  );

  // Change API Key Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.changeApiKey",
      async (item: { label: string }) => {
        try {
          if (!item || !item.label) {
            throw new Error("No profile selected");
          }

          const apiKey = await vscode.window.showInputBox({
            prompt: `Enter new API key for profile "${item.label}"`,
            placeHolder: "your-api-key",
            password: true,
            ignoreFocusOut: true, // Keep the input box open when focus is lost
          });

          if (!apiKey) {
            return;
          }

          await profileManager.updateProfileApiKey(item.label, apiKey);
          await Messages.showInfo(Messages.PROFILE_API_KEY_UPDATED(item.label));
        } catch (error) {
          await Messages.showError(Messages.ERROR_UPDATE_API_KEY(error));
        }
      },
    ),
  );

  // Delete Profile Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.deleteProfile",
      async (item?: { label: string }) => {
        try {
          // If called from tree view, use the selected item
          if (item?.label) {
            const confirm = await Messages.showModal(
              `Are you sure you want to delete profile "${item.label}"?`,
              "Delete",
            );

            if (confirm === "Delete") {
              const isActiveProfile = await profileManager.isActiveProfile(
                item.label,
              );
              const allProfiles = await profileManager.listProfiles();

              // Delete the profile
              await profileManager.deleteProfile(item.label);
              profilesProvider.refresh();

              // If we deleted the active profile
              if (isActiveProfile) {
                // If there are other profiles, switch to one of them
                const remainingProfiles = allProfiles.filter(
                  (p) => p !== item.label,
                );
                if (remainingProfiles.length > 0) {
                  await profileManager.setActiveProfile(remainingProfiles[0]);
                  await Messages.showInfo(
                    Messages.PROFILE_SWITCHED(remainingProfiles[0]),
                  );
                }
                // Always refresh tunnel list when active profile is deleted
                tunnelProvider.refresh();
              }

              await Messages.showInfo(Messages.PROFILE_DELETED(item.label));
            }
            return;
          }

          // If called from command palette, show QuickPick
          const profiles = await profileManager.listProfiles();
          if (!profiles || profiles.length === 0) {
            await Messages.showInfo("No profiles available to delete.");
            return;
          }

          const activeProfile = await profileManager.getActiveProfile();
          const selected = await vscode.window.showQuickPick(
            profiles.map((profile) => ({
              label: profile,
              description: profile === activeProfile ? "(Active)" : "",
              profile,
            })),
            {
              placeHolder: "Select a profile to delete",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            const confirm = await Messages.showModal(
              `Are you sure you want to delete profile "${selected.profile}"?`,
              "Delete",
            );

            if (confirm === "Delete") {
              const isActiveProfile = await profileManager.isActiveProfile(
                selected.profile,
              );
              const allProfiles = await profileManager.listProfiles();

              // Delete the profile
              await profileManager.deleteProfile(selected.profile);
              profilesProvider.refresh();

              // If we deleted the active profile
              if (isActiveProfile) {
                // If there are other profiles, switch to one of them
                const remainingProfiles = allProfiles.filter(
                  (p) => p !== selected.profile,
                );
                if (remainingProfiles.length > 0) {
                  await profileManager.setActiveProfile(remainingProfiles[0]);
                  await Messages.showInfo(
                    Messages.PROFILE_SWITCHED(remainingProfiles[0]),
                  );
                }
                // Always refresh tunnel list when active profile is deleted
                tunnelProvider.refresh();
              }

              await Messages.showInfo(
                Messages.PROFILE_DELETED(selected.profile),
              );
            }
          }
        } catch (error) {
          await Messages.showError(Messages.ERROR_DELETE_PROFILE(error));
        }
      },
    ),
  );

  // Set Active Profile Command
  disposables.push(
    vscode.commands.registerCommand(
      "tunnelfy.setActiveProfile",
      async (item?: { label: string }) => {
        try {
          // If called from tree view, use the selected item
          if (item?.label) {
            await profileManager.setActiveProfile(item.label);
            profilesProvider.refresh();
            tunnelProvider.refresh();
            await Messages.showInfo(Messages.PROFILE_ACTIVE_UPDATED);
            return;
          }

          // If called from command palette, show QuickPick
          const profiles = await profileManager.listProfiles();
          if (!profiles || profiles.length === 0) {
            await Messages.showInfo(
              "No profiles available. Please create a profile first.",
            );
            return;
          }

          const activeProfile = await profileManager.getActiveProfile();
          const selected = await vscode.window.showQuickPick(
            profiles.map((profile) => ({
              label: profile,
              description: profile === activeProfile ? "(Active)" : "",
              profile,
            })),
            {
              placeHolder: "Select a profile to set as active",
              ignoreFocusOut: true,
            },
          );

          if (selected) {
            await profileManager.setActiveProfile(selected.profile);
            profilesProvider.refresh();
            tunnelProvider.refresh();
            await Messages.showInfo(Messages.PROFILE_ACTIVE_UPDATED);
          }
        } catch (error) {
          await Messages.showError(Messages.ERROR_SET_ACTIVE_PROFILE(error));
        }
      },
    ),
  );

  // Refresh Profiles Command
  disposables.push(
    vscode.commands.registerCommand("tunnelfy.refreshProfiles", async () => {
      try {
        profilesProvider.refresh();
        await Messages.showInfo("Profile list has been refreshed.");
      } catch (error) {
        await Messages.showError(Messages.ERROR_GENERIC(error));
      }
    }),
  );

  // Add all disposables to the extension context
  disposables.forEach((d) => context.subscriptions.push(d));

  return disposables;
}

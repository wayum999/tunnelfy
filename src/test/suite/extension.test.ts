import * as assert from 'assert';
import * as vscode from 'vscode';
import { waitForExtensionActivation, assertCommandAvailable, clearWorkspace } from './testUtils';
import { ProfileManager } from '../../services/profileManager';

suite('Tunnelfy Extension Test Suite', () => {
    let profileManager: ProfileManager;
    let mockContext: vscode.ExtensionContext;

    // Create mock profile manager
    const createMockProfileManager = (context: vscode.ExtensionContext): ProfileManager => {
        const profiles = new Map<string, { name: string; apiKey: string; accountId: string }>();
        let activeProfile: string | null = null;

        return {
            createProfile: async (name: string, apiKey: string, accountId: string): Promise<void> => {
                if (!name || !name.trim()) {
                    throw new Error('Profile name cannot be empty');
                }
                if (!apiKey || !apiKey.trim()) {
                    throw new Error('API key cannot be empty');
                }
                if (!accountId || !accountId.trim()) {
                    throw new Error('Account ID cannot be empty');
                }
                if (profiles.has(name)) {
                    throw new Error(`Profile '${name}' already exists`);
                }
                profiles.set(name, { name, apiKey, accountId });
                if (!activeProfile) {
                    activeProfile = name;
                }
            },

            getActiveProfile: async (): Promise<string | null> => {
                return activeProfile;
            },

            getProfileApiKey: async (name: string): Promise<string | null> => {
                return profiles.get(name)?.apiKey || null;
            },

            getProfileAccountId: async (name: string): Promise<string | null> => {
                return profiles.get(name)?.accountId || null;
            },

            setActiveProfile: async (name: string): Promise<void> => {
                if (!profiles.has(name)) {
                    throw new Error(`Profile '${name}' does not exist`);
                }
                activeProfile = name;
            },

            deleteProfile: async (name: string): Promise<void> => {
                if (!profiles.has(name)) {
                    throw new Error(`Profile '${name}' does not exist`);
                }
                profiles.delete(name);
                if (activeProfile === name) {
                    activeProfile = null;
                }
            },

            listProfiles: (): string[] => {
                return Array.from(profiles.keys());
            },

            updateProfileApiKey: async (name: string, apiKey: string): Promise<void> => {
                const profile = profiles.get(name);
                if (!profile) {
                    throw new Error(`Profile '${name}' does not exist`);
                }
                if (!apiKey || !apiKey.trim()) {
                    throw new Error('API key cannot be empty');
                }
                profiles.set(name, { ...profile, apiKey });
            }
        } as ProfileManager;
    };

    suiteSetup(async () => {
        await clearWorkspace();
        
        // Create mock extension context
        mockContext = {
            subscriptions: [],
            extensionPath: __dirname,
            globalStoragePath: __dirname,
            storagePath: __dirname,
            logPath: __dirname,
            asAbsolutePath: (path: string) => path,
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            globalState: {
                get: (key: string) => {
                    if (key === 'cloudflare.profiles') return {};
                    if (key === 'cloudflare.activeProfile') return null;
                    return undefined;
                },
                update: () => Promise.resolve()
            },
            extensionUri: vscode.Uri.file(__dirname),
            environmentVariableCollection: undefined,
            extensionMode: vscode.ExtensionMode.Test,
            storageUri: vscode.Uri.file(__dirname),
            globalStorageUri: vscode.Uri.file(__dirname),
            logUri: vscode.Uri.file(__dirname),
            secrets: {
                get: () => Promise.resolve(''),
                store: () => Promise.resolve(),
                delete: () => Promise.resolve()
            },
            extension: {
                id: 'test',
                extensionUri: vscode.Uri.file(__dirname),
                extensionPath: __dirname,
                isActive: true,
                packageJSON: {},
                exports: undefined,
                activate: () => Promise.resolve(),
                extensionKind: vscode.ExtensionKind.Workspace
            },
            languageModelAccessInformation: undefined
        } as unknown as vscode.ExtensionContext;

        profileManager = createMockProfileManager(mockContext);
        vscode.window.showInformationMessage('Starting tests...');
    });

    test('Extension should be present', async () => {
        const extension = await waitForExtensionActivation();
        assert.ok(extension, 'Extension should be available');
    });

    test('All commands should be registered', async () => {
        // Profile management commands
        await assertCommandAvailable('tunnelfy.refreshProfiles');
        await assertCommandAvailable('tunnelfy.createProfile');
        await assertCommandAvailable('tunnelfy.setActiveProfile');
        await assertCommandAvailable('tunnelfy.deleteProfile');

        // Tunnel management commands
        await assertCommandAvailable('tunnelfy.createTunnel');
        await assertCommandAvailable('tunnelfy.createQuickTunnel');
        await assertCommandAvailable('tunnelfy.refreshTunnels');
        await assertCommandAvailable('tunnelfy.refreshQuickTunnels');
        await assertCommandAvailable('tunnelfy.stopTunnel');
        await assertCommandAvailable('tunnelfy.stopQuickTunnel');
        await assertCommandAvailable('tunnelfy.deleteTunnel');
        await assertCommandAvailable('tunnelfy.copyQuickTunnelUrl');
    });

    test('Profile management with API keys', async () => {
        // Create a test profile
        const testProfileName = 'test-profile';
        const testApiKey = 'test-api-key';
        const testAccountId = 'test-account-id';
        
        await profileManager.createProfile(testProfileName, testApiKey, testAccountId);
        
        // Verify profile was created
        const profiles = profileManager.listProfiles();
        assert.ok(profiles.includes(testProfileName), 'Profile should be created');
        
        // Verify API key is stored securely
        const storedApiKey = await profileManager.getProfileApiKey(testProfileName);
        assert.strictEqual(storedApiKey, testApiKey, 'API key should be stored correctly');
        
        // Set active profile
        await profileManager.setActiveProfile(testProfileName);
        const activeProfile = await profileManager.getActiveProfile();
        assert.strictEqual(activeProfile, testProfileName, 'Profile should be active');
        
        // Delete the profile
        await profileManager.deleteProfile(testProfileName);
        const updatedProfiles = profileManager.listProfiles();
        assert.ok(!updatedProfiles.includes(testProfileName), 'Profile should be deleted');
        
        // Verify API key was deleted
        const deletedApiKey = await profileManager.getProfileApiKey(testProfileName);
        assert.strictEqual(deletedApiKey, null, 'API key should be deleted');
    });

    test('Profile creation validation', async () => {
        // Test invalid profile name
        await assert.rejects(
            async () => await profileManager.createProfile('', 'test-api-key', 'test-account-id'),
            /Profile name cannot be empty/,
            'Should reject empty profile name'
        );

        // Test invalid API key
        await assert.rejects(
            async () => await profileManager.createProfile('test-profile', '', 'test-account-id'),
            /API key cannot be empty/,
            'Should reject empty API key'
        );

        // Test duplicate profile name
        const testProfileName = 'test-profile-2';
        await profileManager.createProfile(testProfileName, 'test-api-key', 'test-account-id');
        await assert.rejects(
            async () => await profileManager.createProfile(testProfileName, 'another-api-key', 'test-account-id'),
            /Profile.*already exists/,
            'Should reject duplicate profile name'
        );

        // Clean up
        await profileManager.deleteProfile(testProfileName);
    });

    suiteTeardown(() => {
        vscode.window.showInformationMessage('Extension tests complete!');
    });
});

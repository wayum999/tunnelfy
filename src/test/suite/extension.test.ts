import * as assert from 'assert';
import * as vscode from 'vscode';
import { waitForExtensionActivation, assertCommandAvailable, clearWorkspace } from './testUtils';
import { ProfileManager } from '../../services/profileManager';

suite('Tunnelfy Extension Test Suite', () => {
    let profileManager: ProfileManager;

    suiteSetup(async () => {
        await clearWorkspace();
        const extension = vscode.extensions.getExtension('tunnelfy');
        profileManager = new ProfileManager(extension!.exports.context);
        vscode.window.showInformationMessage('Starting tests...');
    });

    test('Extension should be present', async () => {
        const extension = await waitForExtensionActivation();
        assert.ok(extension, 'Extension should be available');
    });

    test('Extension should activate', async () => {
        const extension = await waitForExtensionActivation();
        assert.ok(extension, 'Extension should be available');
        assert.strictEqual(extension?.isActive, true, 'Extension should be activated');
    });

    test('All commands should be registered', async () => {
        // Profile management commands
        await assertCommandAvailable('tunnelfy.createProfile');
        await assertCommandAvailable('tunnelfy.switchProfile');
        await assertCommandAvailable('tunnelfy.deleteProfile');

        // Tunnel management commands
        await assertCommandAvailable('tunnelfy.createTunnel');
        await assertCommandAvailable('tunnelfy.createQuickTunnel');
        await assertCommandAvailable('tunnelfy.refreshTunnels');
        await assertCommandAvailable('tunnelfy.stopQuickTunnel');
    });

    test('Profile management with API keys', async () => {
        // Create a test profile
        const testProfileName = 'test-profile';
        const testApiKey = 'test-api-key';
        
        await profileManager.createProfile(testProfileName, testApiKey);
        
        // Verify profile was created
        const profiles = await profileManager.listProfiles();
        assert.ok(profiles.includes(testProfileName), 'Profile should be created');
        
        // Verify API key is stored securely
        const storedApiKey = await profileManager.getProfileApiKey(testProfileName);
        assert.strictEqual(storedApiKey, testApiKey, 'API key should be stored correctly');
        
        // Switch to the profile
        await profileManager.switchProfile(testProfileName);
        const activeProfile = await profileManager.getActiveProfile();
        assert.strictEqual(activeProfile, testProfileName, 'Profile should be active');
        
        // Delete the profile
        await profileManager.deleteProfile(testProfileName);
        const updatedProfiles = await profileManager.listProfiles();
        assert.ok(!updatedProfiles.includes(testProfileName), 'Profile should be deleted');
        
        // Verify API key was deleted
        const deletedApiKey = await profileManager.getProfileApiKey(testProfileName);
        assert.strictEqual(deletedApiKey, undefined, 'API key should be deleted');
    });

    test('Profile creation validation', async () => {
        // Test invalid profile name
        await assert.rejects(
            async () => await profileManager.createProfile('', 'test-api-key'),
            /Profile name cannot be empty/,
            'Should reject empty profile name'
        );

        // Test invalid API key
        await assert.rejects(
            async () => await profileManager.createProfile('test-profile', ''),
            /API key cannot be empty/,
            'Should reject empty API key'
        );

        // Test duplicate profile name
        const testProfileName = 'test-profile-2';
        await profileManager.createProfile(testProfileName, 'test-api-key');
        await assert.rejects(
            async () => await profileManager.createProfile(testProfileName, 'another-api-key'),
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

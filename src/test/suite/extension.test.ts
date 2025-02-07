import * as assert from 'assert';
import * as vscode from 'vscode';
import { waitForExtensionActivation, assertCommandAvailable, clearWorkspace } from './testUtils';

suite('Tunnelfy Extension Test Suite', () => {
    suiteSetup(async () => {
        await clearWorkspace();
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
        await assertCommandAvailable('tunnelfy.renameProfile');

        // Tunnel management commands
        await assertCommandAvailable('tunnelfy.createTunnel');
        await assertCommandAvailable('tunnelfy.createQuickTunnel');
        await assertCommandAvailable('tunnelfy.refreshTunnels');
        await assertCommandAvailable('tunnelfy.stopQuickTunnel');
    });

    suiteTeardown(() => {
        vscode.window.showInformationMessage('Extension tests complete!');
    });
});

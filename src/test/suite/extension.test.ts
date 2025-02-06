import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Tunnelfy Extension Test Suite', () => {
    suiteSetup(async () => {
        // Wait for extension to activate
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        vscode.window.showInformationMessage('Starting tests...');
    });

    test('Extension should be present', async () => {
        const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
        assert.ok(extension, 'Extension should be available');
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
        assert.ok(extension, 'Extension should be available');
        
        if (!extension?.isActive) {
            await extension?.activate();
        }
        assert.strictEqual(extension?.isActive, true, 'Extension should be activated');
    });

    test('Extension should have required settings', async () => {
        const config = vscode.workspace.getConfiguration('tunnelfy');
        
        // Test that required configuration settings exist
        const settings = [
            'cloudflareToken',
            'defaultTunnelName',
            'defaultTunnelConfig'
        ];

        for (const setting of settings) {
            const value = config.inspect(setting);
            assert.ok(value !== undefined, `Setting '${setting}' should exist`);
        }
    });

    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests complete!');
    });
});

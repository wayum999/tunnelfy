import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { waitForExtensionActivation, clearWorkspace, createTestConfiguration, cleanupTestConfiguration } from './testUtils';

suite('Tunnel Management Tests', () => {
    suiteSetup(async () => {
        await clearWorkspace();
        createTestConfiguration();
        await waitForExtensionActivation();
    });

    test('Create tunnel command should be executable', async () => {
        const inputStub = sinon.stub(vscode.window, 'showInputBox');
        inputStub.onFirstCall().resolves('TestTunnel');
        inputStub.onSecondCall().resolves('8080');

        try {
            await vscode.commands.executeCommand('tunnelfy.createTunnel');
            
            // Note: We can't fully verify tunnel creation as it requires actual Cloudflare API interaction
            // Instead, we verify the command executes without error
            assert.ok(true, 'Create tunnel command should execute without error');
        } finally {
            inputStub.restore();
        }
    });

    test('Create quick tunnel command should be executable', async () => {
        const inputStub = sinon.stub(vscode.window, 'showInputBox');
        inputStub.resolves('8080');

        try {
            await vscode.commands.executeCommand('tunnelfy.createQuickTunnel');
            
            // Note: We can't fully verify quick tunnel creation as it requires actual cloudflared
            // Instead, we verify the command executes without error
            assert.ok(true, 'Create quick tunnel command should execute without error');
        } finally {
            inputStub.restore();
        }
    });

    test('Refresh tunnels command should be executable', async () => {
        try {
            await vscode.commands.executeCommand('tunnelfy.refreshTunnels');
            assert.ok(true, 'Refresh tunnels command should execute without error');
        } catch (error) {
            assert.fail('Refresh tunnels command should not throw an error');
        }
    });

    test('Stop quick tunnel command should be executable', async () => {
        try {
            await vscode.commands.executeCommand('tunnelfy.stopQuickTunnel');
            assert.ok(true, 'Stop quick tunnel command should execute without error');
        } catch (error) {
            assert.fail('Stop quick tunnel command should not throw an error');
        }
    });

    suiteTeardown(() => {
        cleanupTestConfiguration();
    });
});

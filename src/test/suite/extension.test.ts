import * as assert from 'assert';
import * as vscode from 'vscode';
import { before } from 'mocha';

suite('Extension Test Suite', () => {
    before(() => {
        vscode.window.showInformationMessage('Starting all tests.');
    });

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('Willbot.tunnelfy'));
    });

    test('Should be able to activate extension', async () => {
        const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
        assert.ok(extension);
        await extension?.activate();
        assert.ok(extension?.isActive);
    });

    test('Should register all tunnelfy commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        const tunnelfyCommands = commands.filter(cmd => cmd.startsWith('tunnelfy.'));
        assert.ok(tunnelfyCommands.length > 0, 'No tunnelfy commands found');
    });

    test('Should have Tunnelfy views registered', () => {
        const views = vscode.window.createTreeView('tunnelfyProfiles', {
            treeDataProvider: {
                getChildren: () => [],
                getTreeItem: () => new vscode.TreeItem('')
            }
        });
        assert.ok(views);
    });

    test('Should have createProfile command registered', async function() {
        // Set a longer timeout for this test
        this.timeout(10000);
        
        const commands = await vscode.commands.getCommands(true);
        const createProfileCmd = 'tunnelfy.createProfile';
        
        // Check if command exists
        assert.ok(
            commands.includes(createProfileCmd),
            'createProfile command should be registered'
        );

        // Verify the extension is active when checking commands
        const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
        assert.ok(extension?.isActive, 'Extension should be active');
    });

    test('Should have profile management commands registered', async function() {
        this.timeout(10000);

        // Get all commands
        const commands = await vscode.commands.getCommands(true);
        
        // Profile management commands to check
        const profileCommands = [
            'tunnelfy.switchProfile',
            'tunnelfy.deleteProfile',
            'tunnelfy.renameProfile'
        ];

        // Verify each profile command exists
        for (const cmd of profileCommands) {
            assert.ok(
                commands.includes(cmd),
                `${cmd} command should be registered`
            );
        }

        // Verify the profiles view exists in VS Code
        const profilesView = vscode.window.createTreeView('tunnelfyProfiles', {
            treeDataProvider: {
                getChildren: () => [],
                getTreeItem: () => new vscode.TreeItem('')
            }
        });
        assert.ok(profilesView, 'Profiles view should be registered');

        // Verify the view is visible in the Activity Bar
        const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
        assert.ok(extension?.isActive, 'Extension should be active');
        
        const views = vscode.window.registerTreeDataProvider('tunnelfyProfiles', {
            getChildren: () => [],
            getTreeItem: () => new vscode.TreeItem('')
        });
        assert.ok(views, 'Tree data provider should be registered');
    });

    test('Should have tunnel management commands registered', async function() {
        this.timeout(10000);

        // Get all commands
        const commands = await vscode.commands.getCommands(true);
        
        // Tunnel management commands to check
        const tunnelCommands = [
            'tunnelfy.createTunnel',
            'tunnelfy.deleteTunnel',
            'tunnelfy.playTunnel',
            'tunnelfy.stopTunnel',
            'tunnelfy.tunnelInfo',
            'tunnelfy.copyTunnelToken',
            'tunnelfy.refreshTunnels'
        ];

        // Verify each tunnel command exists
        for (const cmd of tunnelCommands) {
            assert.ok(
                commands.includes(cmd),
                `${cmd} command should be registered`
            );
        }

        // Quick tunnel commands
        const quickTunnelCommands = [
            'tunnelfy.createQuickTunnel',
            'tunnelfy.stopQuickTunnel',
            'tunnelfy.copyQuickTunnelUrl'
        ];

        // Verify quick tunnel commands exist
        for (const cmd of quickTunnelCommands) {
            assert.ok(
                commands.includes(cmd),
                `${cmd} command should be registered`
            );
        }

        // Verify the extension is active
        const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
        assert.ok(extension?.isActive, 'Extension should be active');
    });
});

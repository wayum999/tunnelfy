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
});

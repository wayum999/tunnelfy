import * as vscode from 'vscode';
import * as assert from 'assert';
import { ProfileManager } from '../../services/profileManager';

export async function waitForExtensionActivation(): Promise<vscode.Extension<any> | undefined> {
    const extension = vscode.extensions.getExtension('Willbot.tunnelfy');
    if (!extension) {
        throw new Error('Extension not found');
    }
    
    if (!extension.isActive) {
        await extension.activate();
    }
    
    return extension;
}

export async function assertCommandAvailable(commandId: string): Promise<void> {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes(commandId), `Command ${commandId} should be available`);
}

export async function clearWorkspace(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export function createTestConfiguration(): void {
    const config = vscode.workspace.getConfiguration('tunnelfy');
    
    // Set up test configuration
    config.update('profiles', [], vscode.ConfigurationTarget.Global);
    config.update('activeProfile', null, vscode.ConfigurationTarget.Global);
}

export function cleanupTestConfiguration(): void {
    const config = vscode.workspace.getConfiguration('tunnelfy');
    
    // Clean up test configuration
    config.update('profiles', undefined, vscode.ConfigurationTarget.Global);
    config.update('activeProfile', undefined, vscode.ConfigurationTarget.Global);
}

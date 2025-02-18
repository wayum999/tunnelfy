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

export class TestExtensionContext implements vscode.ExtensionContext {
    subscriptions: { dispose(): any }[] = [];
    workspaceState: vscode.Memento = new TestMemento();
    globalState: vscode.Memento & { setKeysForSync(keys: string[]): void } = new TestMemento() as any;
    secrets = new TestSecrets();
    extensionUri: vscode.Uri = vscode.Uri.file('');
    extensionPath: string = '';
    environmentVariableCollection: vscode.GlobalEnvironmentVariableCollection = {
        persistent: true,
        append(variable: string, value: string): void {},
        prepend(variable: string, value: string): void {},
        replace(variable: string, value: string): void {},
        get(variable: string): vscode.EnvironmentVariableMutator | undefined { return undefined; },
        forEach(callback: (variable: string, mutator: vscode.EnvironmentVariableMutator, collection: vscode.EnvironmentVariableCollection) => any, thisArg?: any): void {},
        delete(variable: string): void {},
        clear(): void {},
        getScoped(): vscode.EnvironmentVariableCollection { return this; },
        description: undefined,
        [Symbol.iterator](): Iterator<[string, vscode.EnvironmentVariableMutator]> {
            return [][Symbol.iterator]();
        }
    };
    storageUri: vscode.Uri | undefined;
    globalStorageUri: vscode.Uri = vscode.Uri.file('');
    logUri: vscode.Uri = vscode.Uri.file('');
    extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Test;
    globalStoragePath: string = '';
    logPath: string = '';
    storagePath: string | undefined;
    extension: vscode.Extension<any> = {
        id: 'test-extension',
        extensionUri: vscode.Uri.file(''),
        extensionPath: '',
        isActive: true,
        packageJSON: {},
        exports: undefined,
        activate: () => Promise.resolve(undefined),
        extensionKind: vscode.ExtensionKind.Workspace
    };
    languageModelAccessInformation: vscode.LanguageModelAccessInformation = {
        onDidChange: new vscode.EventEmitter<void>().event,
        canSendRequest: () => true
    };

    asAbsolutePath(relativePath: string): string {
        return relativePath;
    }
}

class TestMemento implements vscode.Memento {
    private storage = new Map<string, any>();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get(key: string, defaultValue?: any) {
        return this.storage.get(key) ?? defaultValue;
    }

    update(key: string, value: any): Thenable<void> {
        this.storage.set(key, value);
        return Promise.resolve();
    }

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }
}

class TestSecrets implements vscode.SecretStorage {
    private storage = new Map<string, string>();

    get(key: string): Thenable<string | undefined> {
        return Promise.resolve(this.storage.get(key));
    }

    store(key: string, value: string): Thenable<void> {
        this.storage.set(key, value);
        return Promise.resolve();
    }

    delete(key: string): Thenable<void> {
        this.storage.delete(key);
        return Promise.resolve();
    }

    onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event;
}

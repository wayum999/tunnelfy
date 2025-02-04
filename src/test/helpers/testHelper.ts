import * as path from 'path';
import * as vscode from '../mocks/vscode';

/**
 * Helper function to get workspace folder path for tests
 */
export function getTestWorkspacePath(): string {
    return path.join(__dirname, '..', '..', '..', 'src', 'test', 'workspace');
}

/**
 * Helper function to create a mock VSCode extension context
 */
export function createMockExtensionContext(): vscode.ExtensionContext {
    const workspacePath = getTestWorkspacePath();
    const mockContext = {
        subscriptions: [],
        extension: {
            id: 'test-extension',
            extensionUri: vscode.Uri.file(workspacePath),
            extensionPath: workspacePath,
            isActive: true,
            packageJSON: {},
            exports: undefined,
            activate: () => Promise.resolve(),
        },
        globalState: new MockMemento(),
        workspaceState: new MockMemento(),
        secrets: new MockSecretStorage(),
        extensionPath: workspacePath,
        storagePath: path.join(workspacePath, 'storage'),
        globalStoragePath: path.join(workspacePath, 'globalStorage'),
        logPath: path.join(workspacePath, 'logs'),
        extensionUri: vscode.Uri.file(workspacePath),
        environmentVariableCollection: {
            replace: () => {},
            append: () => {},
            get: (_: string) => undefined,
            forEach: () => {},
            delete: () => {},
            clear: () => {},
            persistent: false
        },
        extensionMode: vscode.ExtensionMode.Test,
        storageUri: vscode.Uri.file(path.join(workspacePath, 'storage')),
        globalStorageUri: vscode.Uri.file(path.join(workspacePath, 'globalStorage')),
        logUri: vscode.Uri.file(path.join(workspacePath, 'logs')),
        asAbsolutePath: (relativePath: string) => path.join(workspacePath, relativePath),
        languageModelAccessInformation: {
            endpoint: 'https://api.example.com',
            authHeader: 'Bearer test-token'
        }
    };

    return mockContext as unknown as vscode.ExtensionContext;
}

class MockMemento implements vscode.Memento {
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

    setKeysForSync(keys: readonly string[]): void {
        // stub: no-op for test environment
    }
}

class MockSecretStorage implements vscode.SecretStorage {
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

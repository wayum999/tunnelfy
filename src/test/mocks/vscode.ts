export interface ExtensionContext {
    subscriptions: { dispose(): any }[];
    extension: {
        id: string;
        extensionUri: any;
        extensionPath: string;
        isActive: boolean;
        packageJSON: any;
        exports: any;
        activate: () => Promise<void>;
    };
    globalState: Memento;
    workspaceState: Memento;
    secrets: SecretStorage;
    extensionPath: string;
    storagePath?: string;
    globalStoragePath: string;
    logPath: string;
    extensionUri: any;
    environmentVariableCollection?: any;
    extensionMode: ExtensionMode;
    storageUri: any;
    globalStorageUri: any;
    logUri: any;
    asAbsolutePath: (relativePath: string) => string;
    languageModelAccessInformation: {
        endpoint: string;
        authHeader: string;
    };
}

export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: any): Thenable<void>;
    keys(): readonly string[];
    setKeysForSync(keys: readonly string[]): void;
}

export interface SecretStorage {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
    onDidChange: any;
}

export interface SecretStorageChangeEvent {
    key: string;
}

export const Uri = {
    file: (path: string) => ({ 
        scheme: 'file',
        path,
        fsPath: path,
        with: () => this
    })
};

export class EventEmitter<T = any> {
    event = () => {};
}

export enum ExtensionMode {
    Production = 1,
    Development = 2,
    Test = 3
}

export const window = {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    createOutputChannel: () => ({
        appendLine: () => {},
        append: () => {},
        show: () => {},
        dispose: () => {}
    })
};

export const workspace = {
    getConfiguration: () => ({
        get: () => undefined,
        update: () => Promise.resolve(),
        has: () => false
    })
};

export const commands = {
    registerCommand: () => ({ dispose: () => {} })
};

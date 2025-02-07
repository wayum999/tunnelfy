import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import proxyquire from 'proxyquire';
import { waitForExtensionActivation, clearWorkspace, createTestConfiguration, cleanupTestConfiguration } from './testUtils';

// Mock fs module with state management
interface MockFsState {
    certExists: boolean;
    certContent: string;
    files: { [key: string]: string };
}

let mockFsState: MockFsState = {
    certExists: false,
    certContent: '',
    files: {}
};

const mockFs = {
    existsSync: (filePath: string) => {
        if (filePath.endsWith('cert.pem')) {
            return mockFsState.certExists;
        }
        return filePath in mockFsState.files;
    },
    readFileSync: (filePath: string) => {
        if (filePath.endsWith('cert.pem')) {
            if (!mockFsState.certExists) {
                throw new Error('ENOENT: no such file or directory');
            }
            if (!mockFsState.certContent) {
                throw new Error('Certificate file is empty');
            }
            return mockFsState.certContent;
        }
        if (filePath in mockFsState.files) {
            return mockFsState.files[filePath];
        }
        throw new Error('ENOENT: no such file or directory');
    },
    writeFileSync: (filePath: string, data: string) => {
        mockFsState.files[filePath] = data;
        if (filePath.endsWith('cert.pem')) {
            mockFsState.certExists = true;
            mockFsState.certContent = data;
        }
    },
    unlinkSync: (filePath: string) => {
        if (filePath.endsWith('cert.pem')) {
            mockFsState.certExists = false;
            mockFsState.certContent = '';
        }
        delete mockFsState.files[filePath];
    },
    accessSync: (filePath: string, mode: number) => {
        if (!mockFs.existsSync(filePath)) {
            throw new Error('ENOENT: no such file or directory');
        }
        if (filePath.endsWith('cert.pem') && !mockFsState.certContent) {
            throw new Error('Certificate file is empty');
        }
    },
    statSync: (filePath: string) => {
        if (!mockFs.existsSync(filePath)) {
            throw new Error('ENOENT: no such file or directory');
        }
        if (filePath.endsWith('cert.pem') && !mockFsState.certContent) {
            throw new Error('Certificate file is empty');
        }
        return {
            isFile: () => true,
            isDirectory: () => false
        };
    },
    constants: {
        R_OK: fs.constants.R_OK
    },
    '@noCallThru': true
};

// Mock child_process module
const mockChildProcess = {
    exec: (command: string, options: any, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        // Handle version check first - no need to check certificate for version check
        if (command.toLowerCase() === 'cloudflared --version') {
            callback(null, 'cloudflared version', '');
            return;
        }

        // For all other commands, check certificate
        if (!mockFsState.certExists || !mockFsState.certContent) {
            callback(new Error('Cannot find a valid certificate'), '', 'Error: Cannot find a valid certificate');
            return;
        }

        // Handle other commands
        if (command.toLowerCase() === 'cloudflared tunnel list --output json') {
            callback(null, '[]', '');
            return;
        }
        if (command.toLowerCase().startsWith('cloudflared tunnel create')) {
            const tunnelName = command.split(' ').pop() || '';
            callback(null, `Created tunnel ${tunnelName} with id mock-id-${tunnelName}`, '');
            return;
        }
        callback(new Error('Command not mocked'), '', 'Error: Command not mocked');
    },
    '@noCallThru': true
};

const { CloudflaredService } = proxyquire('../../../services/cloudflaredService', {
    'fs': mockFs,
    'child_process': mockChildProcess
});

suite('CloudflaredService Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let cloudflaredService: any;
    let certPath: string;

    suiteSetup(async function() {
        this.timeout(20000);
        await clearWorkspace();
        await waitForExtensionActivation();
        certPath = path.join(os.homedir(), '.cloudflared', 'cert.pem');
    });

    setup(async function() {
        this.timeout(20000);
        sandbox = sinon.createSandbox();
        
        // Reset mock state
        mockFsState = {
            certExists: false,
            certContent: '',
            files: {}
        };

        // Create new service instance with mocked context
        const context = {
            subscriptions: [],
            extensionPath: '/mock/path'
        };
        cloudflaredService = new CloudflaredService(context);
        
        await createTestConfiguration();
    });

    teardown(async function() {
        this.timeout(20000);
        sandbox.restore();
        await cleanupTestConfiguration();
    });

    test('verifyCertFile should handle missing cert.pem', async function() {
        mockFsState.certExists = false;
        mockFsState.certContent = '';
        
        try {
            await cloudflaredService.verifyCertFile();
            assert.fail('Should throw error when cert.pem is missing');
        } catch (error: any) {
            assert.ok(error instanceof Error);
            assert.strictEqual(error.message, 'No certificate file found. Please login or switch to a valid profile.');
        }
    });

    test('verifyCertFile should verify existing cert.pem', async function() {
        // Test valid cert file
        mockFsState.certExists = true;
        mockFsState.certContent = 'valid-cert-content';
        
        try {
            await cloudflaredService.verifyCertFile();
        } catch (error) {
            assert.fail(`Should not throw error when cert.pem exists: ${error}`);
        }

        // Test empty cert file
        mockFsState.certContent = '';
        try {
            await cloudflaredService.verifyCertFile();
            assert.fail('Should throw error when cert.pem is empty');
        } catch (error: any) {
            assert.ok(error instanceof Error);
            assert.ok(error.message === 'Certificate file is empty' || error.message.includes('Certificate file exists but is not accessible'));
        }
    });

    test('runCloudflaredCommand should handle command errors', async function() {
        mockFsState.certExists = true;
        mockFsState.certContent = 'valid-cert-content';

        try {
            await cloudflaredService.runCloudflaredCommand('cloudflared invalid-command');
            assert.fail('Should throw error for invalid command');
        } catch (error: any) {
            assert.ok(error instanceof Error);
            assert.strictEqual(error.message, 'Command not mocked');
        }
    });

    test('listTunnels should handle missing cert.pem', async function() {
        mockFsState.certExists = false;
        mockFsState.certContent = '';
        
        const tunnels = await cloudflaredService.listTunnels();
        assert.deepStrictEqual(tunnels, [], 'Should return empty array when cert.pem is missing');
    });

    test('listTunnels should list tunnels when cert.pem exists', async function() {
        mockFsState.certExists = true;
        mockFsState.certContent = 'valid-cert-content';
        
        const tunnels = await cloudflaredService.listTunnels();
        assert.ok(Array.isArray(tunnels), 'Should return array of tunnels');
        assert.deepStrictEqual(tunnels, [], 'Should return empty array when no tunnels exist');
    });
});

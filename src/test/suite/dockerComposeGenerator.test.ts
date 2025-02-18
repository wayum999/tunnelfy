import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DockerComposeGenerator } from '../../services/dockerComposeGenerator';
import { CloudflareApiService } from '../../services/cloudflareApi';
import { TunnelManager } from '../../services/cloudflared';
import { Logger, LogComponent } from '../../utils/logger';

suite('DockerComposeGenerator Test Suite', () => {
    let dockerComposeGenerator: DockerComposeGenerator;
    let mockTunnelManager: TunnelManager;
    let mockApiService: CloudflareApiService;
    let testWorkspaceFolder: string;

    const testTunnelId = 'test-tunnel-id';
    const testTunnelName = 'test-tunnel';
    const testPort = 8080;
    const testToken = 'test-token';

    setup(async () => {
        // Create a mock workspace folder
        testWorkspaceFolder = path.join(__dirname, '..', '..', '..', 'test-workspace');
        if (!fs.existsSync(testWorkspaceFolder)) {
            fs.mkdirSync(testWorkspaceFolder, { recursive: true });
        }

        // Mock the workspace folders
        const mockWorkspaceFolder = {
            uri: vscode.Uri.file(testWorkspaceFolder),
            name: 'test-workspace',
            index: 0
        };
        const mockWorkspaceFolders = [mockWorkspaceFolder];
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: mockWorkspaceFolders,
            writable: true,
            configurable: true
        });

        // Mock the API service
        mockApiService = {
            getTunnelToken: async () => testToken
        } as any;

        // Mock the tunnel manager
        mockTunnelManager = {
            runningTunnels: new Map(),
            _onTunnelEvent: new vscode.EventEmitter(),
            onTunnelEvent: new vscode.EventEmitter().event,
            tunnelLogger: {} as any
        } as any;

        dockerComposeGenerator = new DockerComposeGenerator(mockTunnelManager, mockApiService);
    });

    teardown(() => {
        // Clean up test workspace folder
        if (fs.existsSync(testWorkspaceFolder)) {
            fs.rmSync(testWorkspaceFolder, { recursive: true, force: true });
        }
    });

    test('should generate Docker Compose file with correct content', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        try {
            const filePath = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            
            // Verify file exists
            assert.strictEqual(fs.existsSync(filePath), true);

            // Read and verify file content
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Verify essential Docker Compose elements
            assert.strictEqual(content.includes('services:'), true);
            assert.strictEqual(content.includes(`${testTunnelName}:`), true);
            assert.strictEqual(content.includes('image: cloudflare/cloudflared:latest'), true);
            assert.strictEqual(content.includes(`- cloudflare.${testTunnelName}.env`), true);
            assert.strictEqual(content.includes('restart: unless-stopped'), true);

            // Verify command configuration
            const commandLine = `command: tunnel --no-autoupdate --url http://host.docker.internal:${testPort} run`;
            assert.strictEqual(content.includes(commandLine), true);

            // Verify documentation sections
            assert.strictEqual(content.includes('# Cloudflare Tunnel Docker Compose Configuration'), true);
            assert.strictEqual(content.includes('# Important:'), true);
            assert.strictEqual(content.includes('# Default Configuration:'), true);
            assert.strictEqual(content.includes('# Connecting to Other Services:'), true);
            assert.strictEqual(content.includes('# Adding Docker Networks:'), true);

            // Verify startup instructions
            assert.strictEqual(content.includes('docker compose up -d'), true);
            assert.strictEqual(content.includes('docker compose down'), true);
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
        }
    });

    test('should generate environment file with correct content', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        try {
            const composePath = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            const envPath = path.join(path.dirname(composePath), `cloudflare.${testTunnelName}.env`);
            
            // Verify env file exists
            assert.strictEqual(fs.existsSync(envPath), true);

            // Read and verify env file content
            const envContent = fs.readFileSync(envPath, 'utf8');
            assert.strictEqual(envContent.trim(), `TUNNEL_TOKEN=${testToken}`);
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
        }
    });

    test('should handle network configuration documentation', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        try {
            const filePath = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            const content = fs.readFileSync(filePath, 'utf8');

            // Verify network configuration examples
            assert.strictEqual(content.includes('networks:'), true);
            assert.strictEqual(content.includes('driver: bridge'), true);
            assert.strictEqual(content.includes('http://service-name:'), true);
            assert.strictEqual(content.includes('http://host.docker.internal:'), true);
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
        }
    });

    test('should handle errors gracefully', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        try {
            // Mock API service to simulate token retrieval failure
            mockApiService.getTunnelToken = async () => { throw new Error('Could not get tunnel token'); };

            await assert.rejects(
                () => dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort),
                /Could not get tunnel token/
            );
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
        }
    });

    test('should show confirmation dialog and generate files when confirmed', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        try {
            const filePath = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            
            // Verify files were generated
            assert.strictEqual(fs.existsSync(filePath), true);
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
        }
    });

    test('should not generate files when confirmation is cancelled', async () => {
        // Mock the showInformationMessage to simulate user clicking "Cancel"
        const mockShowInfo = async () => ({ title: 'Cancel' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        try {
            const result = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            assert.strictEqual(result, '');
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
        }
    });

    test('should show overwrite confirmation when files exist', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        // Mock the showWarningMessage for overwrite confirmation
        const mockShowWarning = async () => ({ title: 'Overwrite' });
        const originalShowWarning = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = mockShowWarning as any;

        try {
            // Create files first
            await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            
            // Try to generate again
            const filePath = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            
            // Verify files were generated
            assert.strictEqual(fs.existsSync(filePath), true);
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
            vscode.window.showWarningMessage = originalShowWarning;
        }
    });

    test('should not overwrite files when overwrite is cancelled', async () => {
        // Mock the showInformationMessage to simulate user clicking "Generate"
        const mockShowInfo = async () => ({ title: 'Generate' });
        const originalShowInfo = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = mockShowInfo as any;

        // Mock the showWarningMessage to simulate user clicking "Cancel"
        const mockShowWarning = async () => ({ title: 'Cancel' });
        const originalShowWarning = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = mockShowWarning as any;

        try {
            // Create files first
            await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            
            // Try to generate again
            const result = await dockerComposeGenerator.generateComposeFile(testTunnelId, testTunnelName, testPort);
            
            // Verify no new files were generated
            assert.strictEqual(result, '');
        } finally {
            vscode.window.showInformationMessage = originalShowInfo;
            vscode.window.showWarningMessage = originalShowWarning;
        }
    });
}); 
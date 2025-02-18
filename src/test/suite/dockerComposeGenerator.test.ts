import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DockerComposeGenerator } from '../../services/dockerComposeGenerator';
import { TunnelManager } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApi';

suite('DockerComposeGenerator Test Suite', () => {
    let dockerComposeGenerator: DockerComposeGenerator;
    let mockTunnelManager: TunnelManager;
    let mockApiService: CloudflareApiService;
    let testWorkspaceFolder: string;

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
        const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        const mockWorkspaceFolders = [mockWorkspaceFolder];
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            get: () => mockWorkspaceFolders
        });

        // Create mock services
        mockApiService = {
            getTunnelToken: async () => 'test-token'
        } as unknown as CloudflareApiService;

        mockTunnelManager = {} as TunnelManager;

        dockerComposeGenerator = new DockerComposeGenerator(mockTunnelManager, mockApiService);
    });

    teardown(() => {
        // Clean up test files
        if (fs.existsSync(testWorkspaceFolder)) {
            fs.rmSync(testWorkspaceFolder, { recursive: true, force: true });
        }
    });

    test('should generate Docker Compose file with correct content', async () => {
        const tunnelId = 'test-tunnel-id';
        const tunnelName = 'test-tunnel';
        const port = 8080;

        const filePath = await dockerComposeGenerator.generateComposeFile(tunnelId, tunnelName, port);
        
        // Verify file exists
        assert.strictEqual(fs.existsSync(filePath), true);

        // Read and verify file content
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Verify essential Docker Compose elements
        assert.strictEqual(content.includes('services:'), true);
        assert.strictEqual(content.includes(`${tunnelName}:`), true);
        assert.strictEqual(content.includes('image: cloudflare/cloudflared:latest'), true);
        assert.strictEqual(content.includes(`- cloudflare.${tunnelName}.env`), true);
        assert.strictEqual(content.includes('restart: unless-stopped'), true);

        // Verify command configuration
        const commandLine = `command: tunnel --no-autoupdate --url http://host.docker.internal:${port} run`;
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
    });

    test('should generate environment file with correct content', async () => {
        const tunnelId = 'test-tunnel-id';
        const tunnelName = 'test-tunnel';
        const port = 8080;

        const composePath = await dockerComposeGenerator.generateComposeFile(tunnelId, tunnelName, port);
        const envPath = path.join(path.dirname(composePath), `cloudflare.${tunnelName}.env`);
        
        // Verify env file exists
        assert.strictEqual(fs.existsSync(envPath), true);

        // Read and verify env file content
        const envContent = fs.readFileSync(envPath, 'utf8');
        assert.strictEqual(envContent.trim(), 'TUNNEL_TOKEN=test-token');
    });

    test('should create untitled files when no workspace is available', async () => {
        // Mock workspace folders to be undefined
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            get: () => undefined
        });

        const tunnelId = 'test-tunnel-id';
        const tunnelName = 'test-tunnel';
        const port = 8080;

        const result = await dockerComposeGenerator.generateComposeFile(tunnelId, tunnelName, port);
        assert.strictEqual(result, 'New untitled files');
    });

    test('should handle network configuration documentation', async () => {
        const tunnelId = 'test-tunnel-id';
        const tunnelName = 'test-tunnel';
        const port = 8080;

        const filePath = await dockerComposeGenerator.generateComposeFile(tunnelId, tunnelName, port);
        const content = fs.readFileSync(filePath, 'utf8');

        // Verify network configuration examples
        assert.strictEqual(content.includes('networks:'), true);
        assert.strictEqual(content.includes('driver: bridge'), true);
        assert.strictEqual(content.includes('http://service-name:'), true);
        assert.strictEqual(content.includes('http://host.docker.internal:'), true);
    });

    test('should handle errors gracefully', async () => {
        // Mock API service to simulate token retrieval failure
        const errorApiService = {
            getTunnelToken: async () => null
        } as unknown as CloudflareApiService;

        const generator = new DockerComposeGenerator(mockTunnelManager, errorApiService);

        await assert.rejects(
            generator.generateComposeFile('test-id', 'test-name', 8080),
            /Could not get tunnel token/
        );
    });
}); 
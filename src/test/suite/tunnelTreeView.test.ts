import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { TunnelTreeItem, TunnelTreeDataProvider } from '../../views/tunnelTreeView';
import { TunnelManager } from '../../services/cloudflared';
import { ProfileManager } from '../../services/profileManager';
import { Logger } from '../../utils/logger';

suite('TunnelTreeView Test Suite', () => {
    let tunnelTreeDataProvider: TunnelTreeDataProvider;
    let mockTunnelManager: TunnelManager;
    let mockProfileManager: sinon.SinonStubbedInstance<ProfileManager>;
    let mockEventEmitter: vscode.EventEmitter<any>;

    setup(() => {
        // Create mock event emitter
        mockEventEmitter = new vscode.EventEmitter();

        // Create mock TunnelManager with event emitter
        mockTunnelManager = {
            listTunnels: sinon.stub().resolves([
                { id: 'tunnel1', name: 'Tunnel 1', connections: [] },
                { id: 'tunnel2', name: 'Tunnel 2', connections: [{}] }
            ]),
            onTunnelEvent: mockEventEmitter.event
        } as any;

        // Create mock ProfileManager
        mockProfileManager = sinon.createStubInstance(ProfileManager);
        mockProfileManager.getActiveProfile.resolves('test-profile');

        // Create the provider
        tunnelTreeDataProvider = new TunnelTreeDataProvider(
            mockTunnelManager,
            mockProfileManager as any
        );
    });

    teardown(() => {
        sinon.restore();
        mockEventEmitter.dispose();
    });

    test('TunnelTreeItem should be created with correct properties', () => {
        const item = new TunnelTreeItem('Test Tunnel', 'test-id', 'running', 8080);

        assert.strictEqual(item.label, 'Test Tunnel');
        assert.strictEqual(item.tunnelId, 'test-id');
        assert.strictEqual(item.status, 'running');
        assert.strictEqual(item.port, 8080);
        assert.strictEqual(item.contextValue, 'tunnel-running');
        assert.strictEqual(item.description, 'test-id (Port 8080)');
    });

    test('TunnelTreeItem should show correct icon for running status', () => {
        const item = new TunnelTreeItem('Test Tunnel', 'test-id', 'running');
        
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        const icon = item.iconPath as vscode.ThemeIcon;
        assert.strictEqual(icon.id, 'circle-filled');
    });

    test('TunnelTreeItem should show correct icon for stopped status', () => {
        const item = new TunnelTreeItem('Test Tunnel', 'test-id', 'stopped');
        
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        const icon = item.iconPath as vscode.ThemeIcon;
        assert.strictEqual(icon.id, 'circle-outline');
    });

    test('getChildren should return empty array when no active profile', async () => {
        mockProfileManager.getActiveProfile.resolves(undefined);
        const children = await tunnelTreeDataProvider.getChildren();
        assert.strictEqual(children.length, 0);
    });

    test('getChildren should return tunnel items for active profile', async () => {
        const children = await tunnelTreeDataProvider.getChildren();
        
        assert.strictEqual(children.length, 2);
        assert.strictEqual(children[0].status, 'stopped');
        assert.strictEqual(children[1].status, 'running');
    });

    test('findTunnelById should return correct tunnel', async () => {
        await tunnelTreeDataProvider.getChildren(); // Populate items
        const tunnel = tunnelTreeDataProvider.findTunnelById('tunnel1');
        
        assert.ok(tunnel);
        assert.strictEqual(tunnel.tunnelId, 'tunnel1');
        assert.strictEqual(tunnel.label, 'Tunnel 1');
    });

    test('refresh should trigger tree data change event', () => {
        let eventFired = false;
        tunnelTreeDataProvider.onDidChangeTreeData(() => {
            eventFired = true;
        });

        tunnelTreeDataProvider.refresh();
        assert.ok(eventFired);
    });

    test('generateServiceFiles should handle Docker Compose selection', async () => {
        // Mock the QuickPick selection
        const mockShowQuickPick = sinon.stub(vscode.window, 'showQuickPick');
        mockShowQuickPick.resolves({ 
            label: 'Docker Compose', 
            description: 'Generate Docker Compose configuration files' 
        });

        // Mock the command execution
        const mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand');
        mockExecuteCommand.resolves();

        await tunnelTreeDataProvider.generateServiceFiles('test-tunnel', 'Test Tunnel');

        assert.ok(mockExecuteCommand.calledWith(
            'cloudflare-tunnel.generateDockerCompose',
            'test-tunnel',
            'Test Tunnel'
        ));
    });

    test('generateServiceFiles should handle System Service selection', async () => {
        // Mock the QuickPick selection
        const mockShowQuickPick = sinon.stub(vscode.window, 'showQuickPick');
        mockShowQuickPick.resolves({ 
            label: 'System Service', 
            description: 'Generate systemd service configuration files' 
        });

        // Mock the command execution
        const mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand');
        mockExecuteCommand.resolves();

        await tunnelTreeDataProvider.generateServiceFiles('test-tunnel', 'Test Tunnel');

        assert.ok(mockExecuteCommand.calledWith(
            'cloudflare-tunnel.generateSystemService',
            'test-tunnel',
            'Test Tunnel'
        ));
    });

    test('generateServiceFiles should handle QuickPick cancellation', async () => {
        // Mock the QuickPick selection to simulate cancellation
        const mockShowQuickPick = sinon.stub(vscode.window, 'showQuickPick');
        mockShowQuickPick.resolves(undefined);

        // Mock the command execution
        const mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand');
        
        await tunnelTreeDataProvider.generateServiceFiles('test-tunnel', 'Test Tunnel');

        assert.ok(!mockExecuteCommand.called, 'No command should be executed when QuickPick is cancelled');
    });

    test('generateServiceFiles should handle errors', async () => {
        // Mock the QuickPick selection
        const mockShowQuickPick = sinon.stub(vscode.window, 'showQuickPick');
        mockShowQuickPick.resolves({ 
            label: 'Docker Compose', 
            description: 'Generate Docker Compose configuration files' 
        });

        // Mock the command execution to throw an error
        const mockExecuteCommand = sinon.stub(vscode.commands, 'executeCommand');
        mockExecuteCommand.rejects(new Error('Test error'));

        await assert.rejects(
            tunnelTreeDataProvider.generateServiceFiles('test-tunnel', 'Test Tunnel'),
            /Test error/
        );
    });
}); 
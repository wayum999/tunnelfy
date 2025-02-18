import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { TunnelManager } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApi';
import { TokenService } from '../../services/tokenService';
import { ProfileManager } from '../../services/profileManager';
import { TunnelTreeDataProvider, TunnelTreeItem } from '../../views/tunnelTreeView';
import { Messages } from '../../utils/messages';
import { registerTunnelCommands } from '../../commands/tunnelCommands';

// Define the QuickPickItem interface with tunnelId
interface TunnelQuickPickItem extends vscode.QuickPickItem {
    tunnelId: string;
}

suite('Tunnel Commands Test Suite', () => {
    let mockContext: vscode.ExtensionContext;
    let mockTunnelManager: TunnelManager;
    let mockApiService: CloudflareApiService;
    let mockTokenService: TokenService;
    let mockProfileManager: ProfileManager;
    let mockTunnelProvider: TunnelTreeDataProvider;
    let disposables: vscode.Disposable[];

    setup(() => {
        // Create mock context
        mockContext = {
            subscriptions: [],
        } as any;

        // Create mock services
        mockTunnelManager = {
            stopTunnel: sinon.stub().resolves(),
            listTunnels: sinon.stub().resolves([
                { id: 'tunnel1', name: 'Tunnel 1', connections: [{}] },
                { id: 'tunnel2', name: 'Tunnel 2', connections: [] }
            ])
        } as any;

        mockApiService = {
            listTunnels: sinon.stub().resolves([
                { id: 'tunnel1', name: 'Tunnel 1', connections: [{}] },
                { id: 'tunnel2', name: 'Tunnel 2', connections: [] }
            ])
        } as any;

        mockTokenService = {} as any;
        mockProfileManager = {} as any;
        mockTunnelProvider = {
            refresh: sinon.stub().resolves()
        } as any;

        // Register commands
        disposables = registerTunnelCommands(
            mockContext,
            mockTunnelManager,
            mockApiService,
            mockTokenService,
            mockProfileManager,
            mockTunnelProvider,
            {} as any
        );
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach(d => d.dispose());
    });

    test('stopTunnel should show confirmation dialog and stop tunnel when confirmed', async () => {
        // Create a mock tunnel item
        const tunnelItem = new TunnelTreeItem('Test Tunnel', 'test-id', 'running', 8080);

        // Mock the confirmation dialog
        const mockShowModal = sinon.stub(Messages, 'showModal').resolves('Stop');
        const mockShowInfo = sinon.stub(Messages, 'showInfo').resolves();

        // Execute the stop tunnel command
        await vscode.commands.executeCommand('tunnelfy.stopTunnel', tunnelItem);

        // Verify the confirmation dialog was shown
        assert.ok(mockShowModal.calledWith(
            `Are you sure you want to stop tunnel 'Test Tunnel'?`,
            'Stop',
            'Cancel'
        ));

        // Verify the tunnel was stopped
        assert.ok((mockTunnelManager.stopTunnel as sinon.SinonStub).calledWith('test-id'));
        
        // Verify the view was refreshed
        assert.ok((mockTunnelProvider.refresh as sinon.SinonStub).called);

        // Verify success message was shown
        assert.ok(mockShowInfo.calledWith(Messages.TUNNEL_STOPPED('Test Tunnel')));
    });

    test('stopTunnel should not stop tunnel when confirmation is cancelled', async () => {
        // Create a mock tunnel item
        const tunnelItem = new TunnelTreeItem('Test Tunnel', 'test-id', 'running', 8080);

        // Mock the confirmation dialog to return Cancel
        const mockShowModal = sinon.stub(Messages, 'showModal').resolves('Cancel');

        // Execute the stop tunnel command
        await vscode.commands.executeCommand('tunnelfy.stopTunnel', tunnelItem);

        // Verify the confirmation dialog was shown
        assert.ok(mockShowModal.calledWith(
            `Are you sure you want to stop tunnel 'Test Tunnel'?`,
            'Stop',
            'Cancel'
        ));

        // Verify the tunnel was not stopped
        assert.ok(!(mockTunnelManager.stopTunnel as sinon.SinonStub).called);
        
        // Verify the view was not refreshed
        assert.ok(!(mockTunnelProvider.refresh as sinon.SinonStub).called);
    });

    test('stopTunnel should handle command palette selection with confirmation', async () => {
        // Mock the QuickPick selection with proper type
        const mockQuickPick = sinon.stub(vscode.window, 'showQuickPick').resolves({
            label: 'Tunnel 1',
            description: 'ID: tunnel1',
            tunnelId: 'tunnel1'
        } as TunnelQuickPickItem);

        // Mock the confirmation dialog
        const mockShowModal = sinon.stub(Messages, 'showModal').resolves('Stop');
        const mockShowInfo = sinon.stub(Messages, 'showInfo').resolves();

        // Execute the stop tunnel command without a tunnel item (simulating command palette)
        await vscode.commands.executeCommand('tunnelfy.stopTunnel');

        // Verify QuickPick was shown
        assert.ok(mockQuickPick.called);

        // Verify the confirmation dialog was shown
        assert.ok(mockShowModal.calledWith(
            `Are you sure you want to stop tunnel 'Tunnel 1'?`,
            'Stop',
            'Cancel'
        ));

        // Verify the tunnel was stopped
        assert.ok((mockTunnelManager.stopTunnel as sinon.SinonStub).calledWith('tunnel1'));
        
        // Verify the view was refreshed
        assert.ok((mockTunnelProvider.refresh as sinon.SinonStub).called);

        // Verify success message was shown
        assert.ok(mockShowInfo.calledWith(Messages.TUNNEL_STOPPED('Tunnel 1')));
    });
}); 
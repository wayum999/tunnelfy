import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TunnelManager } from '../../services/cloudflared/TunnelManager';
import { CloudflareApiService } from '../../services/cloudflareApiService';
import { ProfileManager } from '../../services/profileManager';
import { Logger, LogComponent } from '../../utils/logger';

suite('TunnelManager Test Suite', () => {
    let tunnelManager: TunnelManager;
    let eventEmitted: { type: string; tunnelId: string; message?: string } | null = null;

    const mockContext = {
        extensionPath: __dirname,
        subscriptions: [],
        workspaceState: {
            get: () => undefined,
            update: () => Promise.resolve()
        },
        globalState: {
            get: () => undefined,
            update: () => Promise.resolve()
        },
        extensionUri: vscode.Uri.file(__dirname),
        asAbsolutePath: (relativePath: string) => path.join(__dirname, relativePath),
        storagePath: path.join(__dirname, 'storage'),
        globalStoragePath: path.join(__dirname, 'globalStorage'),
        logPath: path.join(__dirname, 'logs')
    } as unknown as vscode.ExtensionContext;

    const mockLogger: Logger = {
        info: (component: LogComponent, message: string) => {},
        error: (component: LogComponent, message: string) => {},
        debug: (component: LogComponent, message: string) => {},
        warn: (component: LogComponent, message: string) => {}
    } as unknown as Logger;

    const mockApiService: CloudflareApiService = {
        createTunnel: async (name: string) => ({
            id: 'test-tunnel-id',
            name,
            created_at: new Date().toISOString(),
            account_tag: 'test-account',
            status: 'active',
            remote_config: false,
            metadata: {}
        }),
        deleteTunnel: async () => {},
        listTunnels: async () => [{
            id: 'test-tunnel-id',
            name: 'test-tunnel',
            connections: []
        }],
        getTunnelToken: async () => 'test-token',
        getTunnelInfo: async () => ({
            id: 'test-tunnel-id',
            status: 'active'
        })
    } as unknown as CloudflareApiService;

    const mockProfileManager: ProfileManager = {
        getCurrentProfile: () => ({
            id: 'test-profile',
            name: 'Test Profile',
            accountId: 'test-account'
        })
    } as unknown as ProfileManager;

    setup(() => {
        eventEmitted = null;
        tunnelManager = new TunnelManager(
            mockContext,
            mockLogger,
            mockApiService,
            mockProfileManager
        );

        tunnelManager.onTunnelEvent(event => {
            eventEmitted = event;
        });
    });

    test('should create tunnel', async () => {
        const tunnel = await tunnelManager.createTunnel('test-tunnel');
        assert.strictEqual(tunnel.name, 'test-tunnel');
        assert.strictEqual(tunnel.id, 'test-tunnel-id');
    });

    test('should delete tunnel', async () => {
        let deleteCalled = false;
        const customApiService = {
            ...mockApiService,
            deleteTunnel: async () => {
                deleteCalled = true;
            }
        };

        const manager = new TunnelManager(
            mockContext,
            mockLogger,
            customApiService as unknown as CloudflareApiService,
            mockProfileManager
        );

        await manager.deleteTunnel('test-tunnel-id');
        assert.strictEqual(deleteCalled, true);
    });

    test('should list tunnels', async () => {
        const tunnels = await tunnelManager.listTunnels();
        assert.strictEqual(tunnels.length, 1);
        assert.strictEqual(tunnels[0].id, 'test-tunnel-id');
        assert.strictEqual(tunnels[0].name, 'test-tunnel');
    });

    test('should prevent running duplicate tunnels', async () => {
        const tunnelId = 'test-tunnel-id';
        
        // First run should succeed
        await tunnelManager.runTunnel(tunnelId, 8080);

        // Second run should throw
        await assert.rejects(
            tunnelManager.runTunnel(tunnelId, 8080),
            /Tunnel .* is already running/
        );
    });

    test('should stop running tunnel', async () => {
        const tunnelId = 'test-tunnel-id';
        
        // Start the tunnel
        await tunnelManager.runTunnel(tunnelId, 8080);
        
        // Stop the tunnel
        await tunnelManager.stopTunnel(tunnelId);
        
        // Verify event was emitted
        assert.strictEqual(eventEmitted?.type, 'stop');
        assert.strictEqual(eventEmitted?.tunnelId, tunnelId);
    });

    test('should check tunnel status', async () => {
        const tunnelId = 'test-tunnel-id';
        const status = await tunnelManager.checkTunnelStatus(tunnelId);
        assert.strictEqual(status, true);
    });

    test('should handle tunnel errors', async () => {
        const errorApiService = {
            ...mockApiService,
            getTunnelInfo: async () => {
                throw new Error('API Error');
            }
        };

        const manager = new TunnelManager(
            mockContext,
            mockLogger,
            errorApiService as unknown as CloudflareApiService,
            mockProfileManager
        );

        const status = await manager.checkTunnelStatus('test-tunnel-id');
        assert.strictEqual(status, false);
    });
}); 
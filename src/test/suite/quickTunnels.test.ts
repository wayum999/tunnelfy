import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TunnelManager, TunnelEvent, TunnelEventType } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApiService';
import { ProfileManager } from '../../services/profileManager';
import { Logger, LogComponent } from '../../utils/logger';

suite('Quick Tunnels Test Suite', () => {
    let tunnelManager: TunnelManager;
    let eventEmitted: TunnelEvent | null = null;

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
        createTunnel: async () => {
            throw new Error('Should not be called for quick tunnels');
        },
        deleteTunnel: async () => {
            throw new Error('Should not be called for quick tunnels');
        },
        listTunnels: async () => [],
        getTunnelToken: async () => {
            throw new Error('Should not be called for quick tunnels');
        },
        getTunnelInfo: async () => {
            throw new Error('Should not be called for quick tunnels');
        }
    } as unknown as CloudflareApiService;

    const mockProfileManager: ProfileManager = {
        getActiveProfile: async () => 'test-profile',
        getProfileAccountId: async () => 'test-account'
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

    test('should create quick tunnel', async () => {
        const port = 8080;
        const result = await tunnelManager.createQuickTunnel(port);

        assert.ok(result);
        assert.strictEqual(typeof result.url, 'string');
        assert.strictEqual(result.url, `http://localhost:${port}`);
        assert.ok(result.tunnelUrl.startsWith('https://'));
        assert.ok(result.tunnelUrl.endsWith('.trycloudflare.com'));

        // Verify event was emitted
        assert.ok(eventEmitted);
        assert.strictEqual(eventEmitted.type, 'start');
        assert.ok(eventEmitted.tunnelId.startsWith(`quick-${port}-`));
    });

    test('should stop quick tunnel', async () => {
        const port = 8081;
        
        // Start a quick tunnel
        await tunnelManager.createQuickTunnel(port);
        
        // Reset event emitted flag
        eventEmitted = null;
        
        // Stop the tunnel
        await tunnelManager.stopQuickTunnel(port);
        
        // Verify event was emitted
        assert.ok(eventEmitted);
        assert.strictEqual((eventEmitted as TunnelEvent).type, 'stop');
        assert.ok((eventEmitted as TunnelEvent).tunnelId.startsWith(`quick-${port}-`));
    });

    test('should handle multiple quick tunnels', async () => {
        const ports = [8082, 8083, 8084];
        const results = await Promise.all(
            ports.map(port => tunnelManager.createQuickTunnel(port))
        );

        // Verify all tunnels were created
        for (let i = 0; i < ports.length; i++) {
            assert.ok(results[i]);
            assert.strictEqual(results[i]!.url, `http://localhost:${ports[i]}`);
            assert.ok(results[i]!.tunnelUrl.startsWith('https://'));
        }

        // Stop all tunnels
        await Promise.all(ports.map(port => tunnelManager.stopQuickTunnel(port)));
    });

    test('should handle quick tunnel errors', async () => {
        // Try to create a tunnel on a port that's already in use
        const port = 8085;
        await tunnelManager.createQuickTunnel(port);

        await assert.rejects(
            tunnelManager.createQuickTunnel(port),
            /port.*in use/i
        );

        // Clean up
        await tunnelManager.stopQuickTunnel(port);
    });

    test('should cleanup quick tunnels on dispose', async () => {
        const port = 8086;
        await tunnelManager.createQuickTunnel(port);

        // Reset event emitted flag
        eventEmitted = null;

        // Cleanup
        await tunnelManager.cleanup();

        // Verify stop event was emitted
        assert.ok(eventEmitted);
        assert.strictEqual((eventEmitted as TunnelEvent).type, 'stop');
        assert.ok((eventEmitted as TunnelEvent).tunnelId.startsWith(`quick-${port}-`));
    });
}); 
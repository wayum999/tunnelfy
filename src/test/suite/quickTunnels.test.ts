import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TunnelManager, TunnelEvent, TunnelEventType } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApiService';
import { ProfileManager } from '../../services/profileManager';
import { Logger, LogComponent } from '../../utils/logger';

// Helper function to wait between operations
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to retry on rate limit
async function retryOnRateLimit<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000
): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            if (error instanceof Error && 
                (error.message.includes('rate limit') || error.message.includes('too many requests'))) {
                await wait(delayMs * Math.pow(2, i)); // Exponential backoff
                continue;
            }
            throw error;
        }
    }
    throw new Error('Max retries reached');
}

suite('Quick Tunnels Test Suite', () => {
    let tunnelManager: TunnelManager;
    let eventEmitted: TunnelEvent | null = null;
    let sharedTunnel: { port: number; url?: string; tunnelUrl?: string } | null = null;

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

    setup(async function() {
        this.timeout(10000); // Increase timeout for setup
        
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

        // Ensure cleanup of any existing tunnels
        if (sharedTunnel) {
            try {
                await tunnelManager.stopQuickTunnel(sharedTunnel.port);
                await wait(1000); // Wait for cleanup
            } catch (error) {
                // Ignore cleanup errors
            }
            sharedTunnel = null;
        }
        await tunnelManager.cleanup();
        await wait(1000); // Wait for cleanup to complete

        // Create a shared tunnel for tests that need it
        if (!sharedTunnel) {
            try {
                const port = 8080;
                const result = await retryOnRateLimit(async () => {
                    const tunnel = await tunnelManager.createQuickTunnel(port);
                    await wait(500); // Wait for tunnel to be fully established
                    return tunnel;
                });
                sharedTunnel = { port, ...result };
            } catch (error) {
                console.error('Failed to create shared tunnel:', error);
            }
        }
    });

    // Group validation tests that don't need actual tunnel creation
    suite('Validation Tests', () => {
        test('should validate port numbers', async function() {
            this.timeout(5000); // Increase timeout
            // These tests don't create actual tunnels
            await assert.rejects(
                () => tunnelManager.createQuickTunnel(-1),
                /invalid port/i,
                'Should reject negative port numbers'
            );

            await assert.rejects(
                () => tunnelManager.createQuickTunnel(0),
                /invalid port/i,
                'Should reject port 0'
            );

            await assert.rejects(
                () => tunnelManager.createQuickTunnel(65536),
                /invalid port/i,
                'Should reject ports above 65535'
            );
        });
    });

    // Group tunnel operation tests
    suite('Tunnel Operations', () => {
        setup(async function() {
            this.timeout(10000); // Increase timeout
            // Ensure we have a shared tunnel
            if (!sharedTunnel) {
                const port = 8080;
                const result = await retryOnRateLimit(async () => {
                    const tunnel = await tunnelManager.createQuickTunnel(port);
                    await wait(500); // Wait for tunnel to be fully established
                    return tunnel;
                });
                sharedTunnel = { port, ...result };
            }
        });

        test('should create and verify quick tunnel', async function() {
            this.timeout(10000); // Increase timeout
            assert.ok(sharedTunnel, 'Shared tunnel should be created');
            assert.strictEqual(typeof sharedTunnel.url, 'string');
            assert.strictEqual(sharedTunnel.url, `http://localhost:${sharedTunnel.port}`);
            assert.ok(sharedTunnel.tunnelUrl?.startsWith('https://'));
            assert.ok(sharedTunnel.tunnelUrl?.endsWith('.trycloudflare.com'));

            // Verify event was emitted
            assert.ok(eventEmitted);
            assert.strictEqual(eventEmitted.type, 'start');
            assert.ok(eventEmitted.tunnelId.startsWith(`quick-${sharedTunnel.port}-`));
        });

        test('should handle concurrent operations on same port', async function() {
            this.timeout(10000); // Increase timeout
            assert.ok(sharedTunnel, 'Shared tunnel should be created');
            const port = sharedTunnel.port;
            
            // Try to create tunnels on the same port
            const operations = [
                tunnelManager.createQuickTunnel(port),
                tunnelManager.createQuickTunnel(port)
            ];

            const results = await Promise.allSettled(operations);
            
            // All operations should fail because the port is already in use
            const rejectedCount = results.filter(r => r.status === 'rejected').length;
            assert.strictEqual(rejectedCount, operations.length, 'All operations on existing port should be rejected');
            
            // Verify the error messages
            results.forEach(result => {
                if (result.status === 'rejected') {
                    assert.ok(
                        result.reason.message.includes('already in use') || 
                        result.reason.message.includes('already running'),
                        'Should fail with port in use error'
                    );
                }
            });
        });

        test('should maintain event order during lifecycle', async function() {
            this.timeout(10000); // Increase timeout
            const events: TunnelEvent[] = [];
            const disposable = tunnelManager.onTunnelEvent(event => {
                events.push(event);
            });

            try {
                // Use a new port for this test
                const port = 8081;
                await retryOnRateLimit(async () => {
                    await tunnelManager.createQuickTunnel(port);
                    await wait(500); // Wait before stopping
                    await tunnelManager.stopQuickTunnel(port);
                });

                assert.strictEqual(events.length, 2, 'Should emit exactly 2 events');
                assert.strictEqual(events[0].type, 'start', 'First event should be start');
                assert.strictEqual(events[1].type, 'stop', 'Second event should be stop');
                assert.strictEqual(events[0].tunnelId, events[1].tunnelId, 'Events should reference same tunnel');
            } finally {
                disposable.dispose();
            }
        });
    });

    // Cleanup tests
    suite('Cleanup', () => {
        test('should cleanup all tunnels on dispose', async function() {
            this.timeout(10000); // Increase timeout
            eventEmitted = null;
            await tunnelManager.cleanup();
            
            assert.ok(eventEmitted, 'Should emit event during cleanup');
            assert.strictEqual((eventEmitted as TunnelEvent).type, 'stop', 'Should emit stop event');
            sharedTunnel = null; // Reset shared tunnel state
        });
    });

    suiteTeardown(async () => {
        // Ensure cleanup
        if (sharedTunnel) {
            await tunnelManager.stopQuickTunnel(sharedTunnel.port);
            sharedTunnel = null;
        }
        await tunnelManager.cleanup();
    });
}); 
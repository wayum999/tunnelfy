import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { TunnelManager, TunnelEvent, TunnelEventType } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApiService';
import { ProfileManager } from '../../services/profileManager';
import { Logger, LogComponent } from '../../utils/logger';
import { EventEmitter } from 'events';

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

// Helper function to type check tunnel events
function isTunnelEvent(event: any): event is TunnelEvent {
    return event && 
           typeof event === 'object' &&
           'type' in event &&
           'tunnelId' in event &&
           typeof event.type === 'string' &&
           typeof event.tunnelId === 'string';
}

suite('Quick Tunnels Test Suite', () => {
    let tunnelManager: TunnelManager;
    let eventEmitted: TunnelEvent | null = null;
    let sharedTunnel: { port: number; url?: string; tunnelUrl?: string } | null = null;
    // Track running tunnels at suite level
    const runningPorts = new Set<number>();
    let originalSpawn: any;

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

    const mockProfileManager: ProfileManager = {
        getActiveProfile: async () => 'test-profile',
        getProfileAccountId: async () => 'test-account',
        isActiveProfile: async (name: string) => name === 'test-profile',
        listProfiles: () => ['test-profile'],
        getProfileApiKey: async () => 'test-api-key',
        createProfile: async () => {},
        updateProfileApiKey: async () => {},
        setActiveProfile: async (name: string) => {},
        deleteProfile: async () => {}
    } as unknown as ProfileManager;

    setup(async function() {
        this.timeout(60000);
        
        eventEmitted = null;

        // Set up mock API service with proper profile handling
        const mockApiService = {
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
            },
            setApiKey: async () => {},
            listAccounts: async () => [{
                id: 'test-account',
                name: 'Test Account'
            }]
        } as unknown as CloudflareApiService;

        tunnelManager = new TunnelManager(
            mockContext,
            mockLogger,
            mockApiService,
            mockProfileManager
        );

        // Mock the child_process.spawn to avoid actual cloudflared calls
        const mockSpawn = (command: string, args: string[]) => {
            const mockProcess = new EventEmitter() as any;
            mockProcess.stdout = new EventEmitter();
            mockProcess.stderr = new EventEmitter();
            mockProcess.pid = 12345;

            // Extract port from args
            const portArg = args.find(arg => arg.includes('localhost:'));
            const port = portArg ? parseInt(portArg.split(':')[1]) : null;

            console.log(`Mock spawn called for port ${port}, running ports:`, Array.from(runningPorts)); // Debug log

            // Check if port is already in use
            if (port && runningPorts.has(port)) {
                console.log(`Port ${port} is already in use`); // Debug log
                process.nextTick(() => {
                    mockProcess.stderr.emit('data', Buffer.from('Error: Port already in use'));
                    mockProcess.emit('exit', 1, null);
                });
                return mockProcess;
            }

            if (port) {
                console.log(`Adding port ${port} to running ports`); // Debug log
                runningPorts.add(port);
            }

            mockProcess.kill = () => {
                if (port) {
                    console.log(`Removing port ${port} from running ports`); // Debug log
                    runningPorts.delete(port);
                }
                mockProcess.emit('exit', 0, null);
            };

            // Simulate cloudflared output with proper timing
            process.nextTick(() => {
                mockProcess.stdout.emit('data', Buffer.from('Starting tunnel...'));
                setTimeout(() => {
                    if (port && !runningPorts.has(port)) {
                        console.log(`Port ${port} is no longer running during startup`); // Debug log
                        mockProcess.stderr.emit('data', Buffer.from('Error: Port already in use'));
                        mockProcess.emit('exit', 1, null);
                        return;
                    }
                    mockProcess.stdout.emit('data', Buffer.from('Registered tunnel connection'));
                    mockProcess.stdout.emit('data', Buffer.from('https://mock-tunnel.trycloudflare.com'));
                    mockProcess.emit('spawn');
                }, 100);
            });

            return mockProcess;
        };

        // Store original spawn and replace with mock
        const cp = require('child_process');
        originalSpawn = cp.spawn;
        cp.spawn = mockSpawn;

        // Reset event tracking
        eventEmitted = null;
        tunnelManager.onTunnelEvent(event => {
            console.log('Event received:', event); // Debug logging
            eventEmitted = event;
        });

        // Ensure cleanup of any existing tunnels
        runningPorts.clear(); // Clear running ports at start of each test
        if (sharedTunnel) {
            try {
                await tunnelManager.stopQuickTunnel(sharedTunnel.port);
                await wait(2000);
            } catch (error) {
                // Ignore cleanup errors
            }
            sharedTunnel = null;
        }
        await tunnelManager.cleanup();
        await wait(2000);
    });

    teardown(async function() {
        this.timeout(10000); // Increase timeout for cleanup

        // Restore original spawn function
        const cp = require('child_process');
        cp.spawn = originalSpawn;
        
        // Clear running ports
        runningPorts.clear();
        
        // Cleanup any remaining tunnels
        try {
            await tunnelManager.cleanup();
            await wait(2000);
        } catch (error) {
            console.error('Error during teardown cleanup:', error);
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
            this.timeout(60000); // Increase timeout
            // Ensure cleanup before each test
            await tunnelManager.cleanup();
            await wait(5000); // Wait longer for cleanup

            // Create a shared tunnel for tests that need it
            if (!sharedTunnel) {
                const port = 8080;
                let attempts = 0;
                const maxAttempts = 3;

                while (attempts < maxAttempts) {
                    try {
                        const result = await retryOnRateLimit(async () => {
                            const tunnel = await tunnelManager.createQuickTunnel(port);
                            await wait(2000); // Wait longer for tunnel to be fully established
                            return tunnel;
                        }, 5, 10000); // More retries, longer delay
                        sharedTunnel = { port, ...result };
                        await wait(5000); // Additional wait after creation
                        break;
                    } catch (error: unknown) {
                        attempts++;
                        console.error(`Failed to create shared tunnel (attempt ${attempts}/${maxAttempts}):`, error);
                        if (attempts === maxAttempts) {
                            if (error instanceof Error && error.message.includes('rate limit')) {
                                this.skip(); // Skip test if we hit rate limit after all retries
                            } else {
                                throw error;
                            }
                        }
                        await wait(20000); // Wait longer between attempts
                    }
                }
            }
        });

        test('should create and verify quick tunnel', async function() {
            this.timeout(60000); // Increase timeout
            if (!sharedTunnel) {
                this.skip(); // Skip if we couldn't create the shared tunnel
            }

            // Reset event tracking
            eventEmitted = null;

            // Create a new tunnel for this test
            const port = 8083;
            const tunnel = await tunnelManager.createQuickTunnel(port);

            // Wait for event with timeout
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout waiting for tunnel event'));
                }, 5000);

                const checkEvent = setInterval(() => {
                    if (!eventEmitted) return;
                    const event = eventEmitted as TunnelEvent;
                    if (event.type === 'start' && event.tunnelId.startsWith(`quick-${port}-`)) {
                        clearTimeout(timeout);
                        clearInterval(checkEvent);
                        resolve();
                    }
                }, 100);
            });

            // Verify tunnel properties
            assert.ok(tunnel, 'Tunnel should be created');
            assert.strictEqual(typeof tunnel.url, 'string');
            assert.strictEqual(tunnel.url, `http://localhost:${port}`);
            assert.ok(tunnel.tunnelUrl?.startsWith('https://'));
            assert.ok(tunnel.tunnelUrl?.endsWith('.trycloudflare.com'));

            // Verify event was emitted
            assert.ok(eventEmitted, 'Event should be emitted');
            const event = eventEmitted as TunnelEvent;
            assert.strictEqual(event.type, 'start', 'Event should be start');
            assert.ok(event.tunnelId.startsWith(`quick-${port}-`), 'Event should reference correct tunnel');

            // Cleanup
            await tunnelManager.stopQuickTunnel(port);
            await wait(2000);
        });

        test('should handle concurrent operations on same port', async function() {
            this.timeout(60000);

            // Use a new port for this test
            const port = 8084;
            console.log('Starting concurrent operations test with port:', port);

            // Verify port is not in use
            assert.ok(!runningPorts.has(port), 'Port should not be in use at start');

            // Create first tunnel
            console.log('Creating first tunnel...');
            const firstTunnel = await tunnelManager.createQuickTunnel(port);
            assert.ok(firstTunnel, 'First tunnel should be created');
            assert.ok(runningPorts.has(port), 'Port should be marked as in use');
            console.log('First tunnel created successfully');

            // Wait for tunnel to be fully established
            await wait(2000);

            // Try to create second tunnel on same port
            console.log('Attempting to create second tunnel on same port...');
            let secondTunnelError: Error | null = null;
            try {
                await tunnelManager.createQuickTunnel(port);
                assert.fail('Second tunnel creation should fail');
            } catch (error: any) {
                console.log('Second tunnel creation failed as expected:', error.message);
                secondTunnelError = error;
            }

            // Verify error
            assert.ok(secondTunnelError, 'Should have caught an error');
            assert.ok(
                secondTunnelError.message.toLowerCase().includes('already in use') || 
                secondTunnelError.message.toLowerCase().includes('already running') ||
                secondTunnelError.message.toLowerCase().includes('port is busy') ||
                secondTunnelError.message.toLowerCase().includes('address already in use'),
                `Expected port in use error, got: ${secondTunnelError.message}`
            );

            // Verify first tunnel is still running
            assert.ok(runningPorts.has(port), 'First tunnel should still be running');

            // Cleanup
            console.log('Cleaning up test...');
            await tunnelManager.stopQuickTunnel(port);
            await wait(2000);
            assert.ok(!runningPorts.has(port), 'Port should be freed after cleanup');
        });

        test('should maintain event order during lifecycle', async function() {
            this.timeout(60000); // Increase timeout
            const events: TunnelEvent[] = [];
            const disposable = tunnelManager.onTunnelEvent(event => {
                events.push(event);
            });

            try {
                // Use a new port for this test
                const port = 8081;
                await retryOnRateLimit(async () => {
                    await tunnelManager.createQuickTunnel(port);
                    await wait(5000); // Wait longer before stopping
                    await tunnelManager.stopQuickTunnel(port);
                    await wait(5000); // Wait after stopping
                }, 5, 10000);

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
            this.timeout(60000); // Increase timeout
            
            // Create a tunnel to ensure there's something to clean up
            const port = 8082;
            try {
                const tunnel = await retryOnRateLimit(async () => {
                    const result = await tunnelManager.createQuickTunnel(port);
                    await wait(5000); // Wait longer for tunnel to be fully established
                    return result;
                }, 5, 10000);

                if (!tunnel) {
                    this.skip(); // Skip if we couldn't create the tunnel
                    return;
                }

                assert.ok(tunnel, 'Test tunnel should be created');
                
                // Reset event tracking
                eventEmitted = null;
                
                // Perform cleanup
                await tunnelManager.cleanup();
                await wait(5000); // Wait longer for cleanup to complete
                
                // Verify cleanup event
                assert.ok(eventEmitted, 'Should emit event during cleanup');
                assert.strictEqual((eventEmitted as TunnelEvent).type, 'stop', 'Should emit stop event');
                
                // Verify tunnel is actually stopped
                const tunnels = await tunnelManager.getQuickTunnels();
                assert.strictEqual(tunnels.length, 0, 'All tunnels should be cleaned up');
                
                sharedTunnel = null; // Reset shared tunnel state
            } catch (error: unknown) {
                if (error instanceof Error && error.message.includes('rate limit')) {
                    this.skip(); // Skip test if we hit rate limit
                } else {
                    throw error;
                }
            }
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
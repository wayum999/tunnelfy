import * as assert from 'assert';
import * as vscode from 'vscode';
import { TunnelTreeDataProvider, TunnelTreeItem } from '../../views/tunnelTreeView';
import { QuickTunnelTreeDataProvider, QuickTunnelTreeItem } from '../../views/quickTunnelTreeView';
import { TunnelManager } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApiService';
import { ProfileManager } from '../../services/profileManager';
import { Logger, LogComponent } from '../../utils/logger';

// Helper function to wait between operations
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

suite('TreeView Components Test Suite', () => {
    let tunnelManager: TunnelManager;
    let tunnelTreeProvider: TunnelTreeDataProvider;
    let quickTunnelTreeProvider: QuickTunnelTreeDataProvider;
    let mockLogger: Logger;
    let mockProfileManager: ProfileManager;

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
        asAbsolutePath: (relativePath: string) => relativePath,
        storagePath: __dirname,
        globalStoragePath: __dirname,
        logPath: __dirname,
        secrets: {
            get: () => Promise.resolve(''),
            store: () => Promise.resolve(),
            delete: () => Promise.resolve()
        }
    } as unknown as vscode.ExtensionContext;

    setup(async () => {
        // Create a real logger instance
        mockLogger = Logger.getInstance();

        // Create minimal mock profile manager
        mockProfileManager = new ProfileManager(mockContext);
        Object.defineProperties(mockProfileManager, {
            getActiveProfile: {
                value: async () => 'test-profile'
            },
            getProfileAccountId: {
                value: async () => 'test-account'
            },
            listProfiles: {
                value: () => ['test-profile']
            },
            getProfileApiKey: {
                value: async () => 'test-key'
            }
        });

        // Create minimal mock API service with only required methods
        const mockApiService = new CloudflareApiService(mockContext, mockProfileManager);
        
        // Track quick tunnel creation times for rate limiting
        let lastQuickTunnelTime = 0;
        const RATE_LIMIT_WINDOW = 60000; // 1 minute
        const MAX_QUICK_TUNNELS = 2; // Max 2 quick tunnels per minute
        let quickTunnelCount = 0;
        
        // Use mutable arrays to track tunnels and quick tunnels
        const tunnels: Array<{
            id: string;
            name: string;
            created_at: string;
            deleted_at: string | null;
            connections: any[];
        }> = [];
        
        const quickTunnels: Array<{
            port: number;
            url: string;
            tunnelUrl: string;
        }> = [];

        // Create a function to update quick tunnels that can be called from multiple places
        const updateQuickTunnels = () => {
            Object.defineProperty(tunnelManager, 'getQuickTunnels', {
                value: async () => [...quickTunnels],
                configurable: true,
                enumerable: true,
                writable: true
            });
        };
        
        Object.defineProperties(mockApiService, {
            listTunnels: {
                value: async () => [...tunnels]  // Return a copy of the tunnels array
            },
            createTunnel: {
                value: async (name: string) => {
                    const tunnel = { 
                        id: 'test-id', 
                        name, 
                        created_at: new Date().toISOString(),
                        deleted_at: null,
                        connections: []
                    };
                    tunnels.push(tunnel);
                    return tunnel;
                }
            },
            deleteTunnel: {
                value: async () => {
                    tunnels.length = 0;  // Clear all tunnels
                }
            },
            getTunnelToken: {
                value: async () => 'test-token'
            },
            getTunnelInfo: {
                value: async (tunnelId: string) => ({
                    id: tunnelId,
                    name: 'test-tunnel',
                    created_at: new Date().toISOString(),
                    deleted_at: null,
                    connections: []
                })
            }
        });

        tunnelManager = new TunnelManager(mockContext, mockLogger, mockApiService, mockProfileManager);
        
        // Override createQuickTunnel to simulate rate limiting and track quick tunnels
        const originalCreateQuickTunnel = tunnelManager.createQuickTunnel.bind(tunnelManager);
        tunnelManager.createQuickTunnel = async (port: number) => {
            const now = Date.now();
            
            // Reset count if outside rate limit window
            if (now - lastQuickTunnelTime > RATE_LIMIT_WINDOW) {
                quickTunnelCount = 0;
            }
            
            // Check rate limit
            if (quickTunnelCount >= MAX_QUICK_TUNNELS) {
                throw new Error('Rate limit exceeded for quick tunnels');
            }
            
            // Update tracking
            lastQuickTunnelTime = now;
            quickTunnelCount++;
            
            // Add delay to simulate network latency
            await wait(500);
            
            // Create and track quick tunnel
            const quickTunnel = {
                port,
                url: `http://localhost:${port}`,
                tunnelUrl: `https://test-${port}.trycloudflare.com`
            };
            quickTunnels.push(quickTunnel);
            
            // Update getQuickTunnels
            updateQuickTunnels();
            
            return quickTunnel;
        };
        
        // Override stopQuickTunnel to handle cleanup
        const originalStopQuickTunnel = tunnelManager.stopQuickTunnel.bind(tunnelManager);
        tunnelManager.stopQuickTunnel = async (port: number) => {
            const index = quickTunnels.findIndex(t => t.port === port);
            if (index !== -1) {
                quickTunnels.splice(index, 1);
            }
            
            // Update getQuickTunnels
            updateQuickTunnels();
        };

        // Override cleanup to handle quick tunnels
        const originalCleanup = tunnelManager.cleanup.bind(tunnelManager);
        tunnelManager.cleanup = async () => {
            quickTunnels.length = 0;
            updateQuickTunnels();
            await originalCleanup();
        };

        tunnelTreeProvider = new TunnelTreeDataProvider(tunnelManager, mockProfileManager);
        quickTunnelTreeProvider = new QuickTunnelTreeDataProvider(tunnelManager);
        
        // Wait for providers to initialize and ensure clean state
        await tunnelManager.cleanup();
        await wait(500);
    });

    test('TunnelTreeView should initialize empty', async function() {
        this.timeout(5000);
        const elements = await tunnelTreeProvider.getChildren();
        assert.strictEqual(elements?.length || 0, 0, 'TreeView should start empty');
    });

    test('QuickTunnelTreeView should initialize empty', async function() {
        this.timeout(5000);
        const elements = await quickTunnelTreeProvider.getChildren();
        assert.strictEqual(elements?.length || 0, 0, 'TreeView should start empty');
    });

    test('TunnelTreeView should update when tunnel is created', async function() {
        this.timeout(5000);
        
        // Create a tunnel
        await tunnelManager.createTunnel('test-tunnel');
        
        // Wait for update
        await wait(1000);
        
        // Get root elements
        const elements = await tunnelTreeProvider.getChildren();
        assert.strictEqual(elements?.length || 0, 1, 'TreeView should have one tunnel');
    });

    test('QuickTunnelTreeView should update when quick tunnel is created', async function() {
        this.timeout(15000); // Increase timeout further
        
        // Reset any existing tunnels
        await tunnelManager.cleanup();
        await wait(1000);
        
        // Create a quick tunnel
        const port = 8080;
        const quickTunnel = await tunnelManager.createQuickTunnel(port);
        assert.ok(quickTunnel, 'Quick tunnel should be created');
        
        // Wait for update and provider refresh with retries
        let elements: QuickTunnelTreeItem[] | undefined;
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            await wait(1000); // Wait longer between checks
            await quickTunnelTreeProvider.refresh();
            elements = await quickTunnelTreeProvider.getChildren();
            
            if (elements && elements.length === 1) {
                break;
            }
            
            attempts++;
        }
        
        // Verify the tree view state
        assert.ok(elements && elements.length === 1, 'TreeView should have one quick tunnel');
        if (elements && elements.length > 0) {
            assert.strictEqual(elements[0].port, port, 'Quick tunnel should have correct port');
        }
    });

    test('TreeViews should handle refresh command', async function() {
        this.timeout(20000); // Increase timeout further
        
        // Reset any existing tunnels
        await tunnelManager.cleanup();
        await wait(1000);
        
        // Create tunnels with delay between them
        const tunnel = await tunnelManager.createTunnel('test-tunnel');
        assert.ok(tunnel, 'Regular tunnel should be created');
        await wait(1000);
        
        // Create quick tunnel with retry on rate limit
        let quickTunnelCreated = false;
        let attempts = 0;
        const maxAttempts = 5;
        
        while (attempts < maxAttempts && !quickTunnelCreated) {
            try {
                const quickTunnel = await tunnelManager.createQuickTunnel(8080);
                assert.ok(quickTunnel, 'Quick tunnel should be created');
                quickTunnelCreated = true;
                await wait(1000); // Wait after successful creation
            } catch (error) {
                if (error instanceof Error && error.message.includes('Rate limit')) {
                    await wait(2000); // Wait longer between retries
                    attempts++;
                    continue;
                }
                throw error;
            }
        }
        
        assert.ok(quickTunnelCreated, 'Quick tunnel should be created successfully');
        
        // Wait for updates with retries
        let regularElements: TunnelTreeItem[] | undefined;
        let quickElements: QuickTunnelTreeItem[] | undefined;
        attempts = 0;
        
        while (attempts < maxAttempts) {
            await wait(1000);
            
            // Refresh both providers
            await Promise.all([
                tunnelTreeProvider.refresh(),
                quickTunnelTreeProvider.refresh()
            ]);
            
            // Get elements from both providers
            [regularElements, quickElements] = await Promise.all([
                tunnelTreeProvider.getChildren(),
                quickTunnelTreeProvider.getChildren()
            ]);
            
            // Log current state for debugging
            console.log(`Attempt ${attempts + 1}: Regular tunnels: ${regularElements?.length}, Quick tunnels: ${quickElements?.length}`);
            
            if (regularElements?.length === 1 && quickElements?.length === 1) {
                break;
            }
            
            attempts++;
        }
        
        // Verify final state with detailed messages
        assert.ok(regularElements?.length === 1, `Regular tunnel count should be 1, got ${regularElements?.length}`);
        assert.ok(quickElements?.length === 1, `Quick tunnel count should be 1, got ${quickElements?.length}`);
        
        // Verify tunnel details
        if (regularElements && regularElements.length > 0) {
            assert.strictEqual(regularElements[0].label, 'test-tunnel', 'Regular tunnel should have correct name');
        }
        if (quickElements && quickElements.length > 0) {
            assert.strictEqual(quickElements[0].port, 8080, 'Quick tunnel should have correct port');
        }
    });

    test('TreeViews should handle error states', async () => {
        // Create a new API service that throws errors
        const errorApiService = new CloudflareApiService(mockContext, mockProfileManager);
        Object.defineProperties(errorApiService, {
            listTunnels: {
                value: async () => { throw new Error('API Error'); }
            }
        });

        const errorTunnelManager = new TunnelManager(
            mockContext,
            mockLogger,
            errorApiService,
            mockProfileManager
        );

        const errorTreeProvider = new TunnelTreeDataProvider(
            errorTunnelManager,
            mockProfileManager
        );

        // Should handle error gracefully
        const children = await errorTreeProvider.getChildren();
        assert.strictEqual(children.length, 0, 'Should handle errors gracefully');
    });

    suiteTeardown(async () => {
        // Cleanup any remaining tunnels
        await tunnelManager.cleanup();
    });
}); 
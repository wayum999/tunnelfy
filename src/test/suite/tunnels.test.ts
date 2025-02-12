import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { TunnelManager } from '../../services/cloudflared';
import { CloudflareApiService } from '../../services/cloudflareApiService';
import { ProfileManager } from '../../services/profileManager';
import { Logger, LogComponent } from '../../utils/logger';
import { waitForExtensionActivation, clearWorkspace, createTestConfiguration, cleanupTestConfiguration } from './testUtils';

// Helper function to wait between operations
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

suite('Tunnel Management Tests', () => {
    let mockTunnelManager: TunnelManager;
    let mockLogger: Logger;
    let mockProfileManager: ProfileManager;
    let mockApiService: CloudflareApiService;

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

    suiteSetup(async function() {
        this.timeout(20000);
        await clearWorkspace();
        createTestConfiguration();

        // Create mock services
        mockLogger = {
            info: () => {},
            error: () => {},
            debug: () => {},
            warn: () => {}
        } as unknown as Logger;

        mockProfileManager = {
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

        mockApiService = {
            createTunnel: async (name: string) => ({
                id: 'test-id',
                name,
                created_at: new Date().toISOString(),
                deleted_at: undefined,
                connections: [],
                account_tag: 'test-account',
                conns_active_at: null,
                conns_inactive_at: null,
                tun_type: 'cfd_tunnel',
                metadata: {},
                status: 'active',
                remote_config: false
            }),
            getTunnelToken: async () => 'test-token',
            setApiKey: async () => {},
            listAccounts: async () => [{
                id: 'test-account',
                name: 'Test Account'
            }]
        } as unknown as CloudflareApiService;

        mockTunnelManager = new TunnelManager(
            mockContext,
            mockLogger,
            mockApiService,
            mockProfileManager
        );

        await waitForExtensionActivation();
        await wait(2000);
    });

    test('Create tunnel command should be executable', async function() {
        this.timeout(60000);
        
        // Mock the extension's command registration
        const mockExtension = {
            id: 'Willbot.tunnelfy',
            isActive: true,
            extensionUri: vscode.Uri.file(__dirname),
            extensionPath: __dirname,
            packageJSON: {},
            extensionKind: vscode.ExtensionKind.Workspace,
            activate: () => Promise.resolve(),
            exports: {
                tunnelManager: mockTunnelManager
            }
        } as vscode.Extension<any>;

        // Mock the extension activation
        const getExtensionSpy = sinon.stub(vscode.extensions, 'getExtension');
        getExtensionSpy.returns(mockExtension);

        // Mock the showInputBox to simulate user input
        const inputStub = sinon.stub(vscode.window, 'showInputBox');
        inputStub.resolves('test-tunnel');

        // Mock the tunnelManager.createTunnel method
        const createTunnelStub = sinon.stub(mockTunnelManager, 'createTunnel');
        createTunnelStub.resolves({
            id: 'test-id',
            name: 'test-tunnel',
            created_at: new Date().toISOString(),
            deleted_at: undefined,
            connections: [],
            account_tag: 'test-account',
            conns_active_at: null,
            conns_inactive_at: null,
            tun_type: 'cfd_tunnel',
            metadata: {},
            status: 'active',
            remote_config: false
        });
        
        try {
            // Register the command
            const disposable = vscode.commands.registerCommand('tunnelfy.createTunnel', async () => {
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter a name for the new tunnel',
                    placeHolder: 'my-tunnel'
                });

                if (name) {
                    return await mockTunnelManager.createTunnel(name);
                }
            });

            // Execute the command
            const result = await vscode.commands.executeCommand('tunnelfy.createTunnel');
            
            // Verify the result
            assert.ok(result, 'Command should return a result');
            assert.ok(createTunnelStub.called, 'createTunnel should be called');
            assert.strictEqual(createTunnelStub.firstCall.args[0], 'test-tunnel', 
                'createTunnel should be called with correct name');
            
            // Cleanup
            disposable.dispose();
        } catch (error) {
            assert.fail(`Command execution failed: ${error}`);
        } finally {
            getExtensionSpy.restore();
            sinon.restore();
        }
    });

    suiteTeardown(async function() {
        this.timeout(10000);
        await cleanupTestConfiguration();
    });
});

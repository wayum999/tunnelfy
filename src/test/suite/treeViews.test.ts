import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
  TunnelTreeDataProvider,
  TunnelTreeItem,
  TunnelGroupItem,
} from "../../views/tunnelTreeView";
import {
  QuickTunnelTreeDataProvider,
  QuickTunnelTreeItem,
} from "../../views/quickTunnelTreeView";
import { TunnelManager } from "../../services/cloudflared";
import { CloudflareApiService } from "../../services/cloudflareApi";
import { ProfileManager } from "../../services/profileManager";
import { Logger, LogComponent } from "../../utils/logger";

// Helper function to wait between operations
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite("TreeView Components Test Suite", () => {
  let tunnelManager: TunnelManager;
  let tunnelTreeProvider: TunnelTreeDataProvider;
  let quickTunnelTreeProvider: QuickTunnelTreeDataProvider;
  let mockLogger: Logger;
  let mockProfileManager: ProfileManager;
  let mockEventEmitter: vscode.EventEmitter<any>;

  // Track tunnels and quick tunnels
  const tunnels: Array<{
    id: string;
    name: string;
    created_at: string;
    deleted_at: string | null;
    connections: any[];
    management_type: string;
    is_running_locally: boolean;
  }> = [];

  const quickTunnels: Array<{
    port: number;
    url: string;
    tunnelUrl: string;
    name?: string;
  }> = [];

  const mockContext = {
    extensionPath: __dirname,
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: () => Promise.resolve(),
    },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve(),
    },
    extensionUri: vscode.Uri.file(__dirname),
    asAbsolutePath: (relativePath: string) => relativePath,
    storagePath: __dirname,
    globalStoragePath: __dirname,
    logPath: __dirname,
    secrets: {
      get: () => Promise.resolve(""),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  } as unknown as vscode.ExtensionContext;

  setup(async () => {
    // Create a real logger instance
    mockLogger = Logger.getInstance();

    // Create minimal mock profile manager
    mockProfileManager = new ProfileManager(mockContext);
    Object.defineProperties(mockProfileManager, {
      getActiveProfile: {
        value: async () => "test-profile",
      },
      getProfileAccountId: {
        value: async () => "test-account",
      },
      listProfiles: {
        value: () => ["test-profile"],
      },
      getProfileApiKey: {
        value: async () => "test-key",
      },
    });

    // Create minimal mock API service with only required methods
    const mockApiService = new CloudflareApiService(
      mockContext,
      mockProfileManager,
    );

    // Track quick tunnel creation times for rate limiting
    let lastQuickTunnelTime = 0;
    const RATE_LIMIT_WINDOW = 60000; // 1 minute
    const MAX_QUICK_TUNNELS = 2; // Max 2 quick tunnels per minute
    let quickTunnelCount = 0;

    // Create a function to update quick tunnels that can be called from multiple places
    const updateQuickTunnels = () => {
      Object.defineProperty(tunnelManager, "getQuickTunnels", {
        value: async () => [...quickTunnels],
        configurable: true,
        enumerable: true,
        writable: true,
      });
    };

    Object.defineProperties(mockApiService, {
      listTunnels: {
        value: async () => [...tunnels], // Return a copy of the tunnels array
      },
      createTunnel: {
        value: async (name: string) => {
          const tunnel = {
            id: "test-id",
            name,
            created_at: new Date().toISOString(),
            deleted_at: null,
            connections: [],
            management_type: "local",
            is_running_locally: false,
          };
          tunnels.push(tunnel);
          return tunnel;
        },
      },
      deleteTunnel: {
        value: async () => {
          tunnels.length = 0; // Clear all tunnels
        },
      },
      getTunnelToken: {
        value: async () => "test-token",
      },
      getTunnelInfo: {
        value: async (tunnelId: string) => ({
          id: tunnelId,
          name: "test-tunnel",
          created_at: new Date().toISOString(),
          deleted_at: null,
          connections: [],
        }),
      },
    });

    tunnelManager = new TunnelManager(
      mockContext,
      mockLogger,
      mockApiService,
      mockProfileManager,
    );

    // Override createQuickTunnel to simulate rate limiting and track quick tunnels
    const originalCreateQuickTunnel =
      tunnelManager.createQuickTunnel.bind(tunnelManager);
    tunnelManager.createQuickTunnel = async (port: number, name?: string) => {
      const now = Date.now();

      // Reset count if outside rate limit window
      if (now - lastQuickTunnelTime > RATE_LIMIT_WINDOW) {
        quickTunnelCount = 0;
      }

      // Check rate limit
      if (quickTunnelCount >= MAX_QUICK_TUNNELS) {
        throw new Error("Rate limit exceeded for quick tunnels");
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
        tunnelUrl: `https://test-${port}.trycloudflare.com`,
        name,
      };
      quickTunnels.push(quickTunnel);

      // Update getQuickTunnels
      updateQuickTunnels();

      return quickTunnel;
    };

    // Override stopQuickTunnel to handle cleanup
    const originalStopQuickTunnel =
      tunnelManager.stopQuickTunnel.bind(tunnelManager);
    tunnelManager.stopQuickTunnel = async (port: number) => {
      const index = quickTunnels.findIndex((t) => t.port === port);
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

    // Wait for providers to initialize and ensure clean state
    await tunnelManager.cleanup();
    await wait(500);

    // Set up event emitter for tunnel events
    mockEventEmitter = new vscode.EventEmitter();

    // Add event emitter to existing tunnelManager instead of overwriting it
    Object.defineProperty(tunnelManager, "onTunnelEvent", {
      get: () => mockEventEmitter.event,
      configurable: true,
    });

    // Create tree providers
    tunnelTreeProvider = new TunnelTreeDataProvider(
      tunnelManager,
      mockProfileManager,
    );
    quickTunnelTreeProvider = new QuickTunnelTreeDataProvider(tunnelManager);
  });

  test("TunnelTreeView should initialize empty", async () => {
    // Get root level items (groups)
    const rootItems = await tunnelTreeProvider.getChildren();
    assert.ok(rootItems instanceof Array, "Root items should be an array");

    // Get items in each group
    const allTunnels = await Promise.all(
      rootItems.map((group) => tunnelTreeProvider.getChildren(group)),
    );

    // Check that all groups are empty
    allTunnels.forEach((tunnels) => {
      assert.strictEqual(
        tunnels.length,
        0,
        "Each group should be empty on initialization",
      );
    });
  });

  test("QuickTunnelTreeView should initialize empty", async function () {
    this.timeout(5000);
    const elements = await quickTunnelTreeProvider.getChildren();
    assert.strictEqual(elements?.length || 0, 0, "TreeView should start empty");
  });

  test("TunnelTreeView should update when tunnel is created", async () => {
    // Get initial root items (groups)
    const initialRootItems = await tunnelTreeProvider.getChildren();

    // Simulate tunnel creation event
    const newTunnel = {
      id: "test-tunnel",
      name: "Test Tunnel",
      management_type: "local",
      is_running_locally: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
      connections: [],
    };
    tunnels.push(newTunnel);
    mockEventEmitter.fire({ type: "created", tunnel: newTunnel });

    // Wait for the tree view to update
    await wait(500);

    // Get items in each group after update
    const allTunnels = await Promise.all(
      initialRootItems.map((group) => tunnelTreeProvider.getChildren(group)),
    );

    // Find the group containing the new tunnel
    const localTunnels = allTunnels.find((tunnels) =>
      tunnels.some(
        (tunnel) =>
          tunnel instanceof TunnelTreeItem && tunnel.tunnelId === "test-tunnel",
      ),
    );

    assert.ok(localTunnels, "Should find group containing the new tunnel");
    assert.strictEqual(
      localTunnels.length,
      1,
      "Group should contain exactly one tunnel",
    );

    const newTunnelItem = localTunnels[0];
    assert.ok(
      newTunnelItem instanceof TunnelTreeItem,
      "New tunnel should be a TunnelTreeItem",
    );
    assert.strictEqual(
      newTunnelItem.tunnelId,
      "test-tunnel",
      "Tunnel ID should match",
    );
    assert.strictEqual(
      newTunnelItem.label,
      "Test Tunnel",
      "Tunnel name should match",
    );
  });

  /**
   * Note: Quick tunnel creation and update tests have been moved to quickTunnels.test.ts
   * This includes comprehensive testing of:
   * - Quick tunnel creation
   * - Name validation
   * - Port validation
   * - View updates
   */

  test("TreeViews should handle refresh command", async function () {
    this.timeout(20000); // Increase timeout further

    // Reset any existing tunnels
    await tunnelManager.cleanup();
    await wait(1000);

    // Clear the tunnels array
    tunnels.length = 0;

    // Create tunnels with delay between them
    const tunnel = await tunnelManager.createTunnel("test-tunnel");
    assert.ok(tunnel, "Regular tunnel should be created");
    await wait(1000);

    // Create quick tunnel with retry on rate limit
    let quickTunnelCreated = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts && !quickTunnelCreated) {
      try {
        const quickTunnel = await tunnelManager.createQuickTunnel(8080);
        assert.ok(quickTunnel, "Quick tunnel should be created");
        quickTunnelCreated = true;
        await wait(1000); // Wait after successful creation
      } catch (error) {
        if (error instanceof Error && error.message.includes("Rate limit")) {
          await wait(2000); // Wait longer between retries
          attempts++;
          continue;
        }
        throw error;
      }
    }

    assert.ok(
      quickTunnelCreated,
      "Quick tunnel should be created successfully",
    );

    // Wait for updates with retries
    let regularElements: Array<TunnelTreeItem | TunnelGroupItem> = [];
    let quickElements: QuickTunnelTreeItem[] = [];
    attempts = 0;

    while (attempts < maxAttempts) {
      await wait(1000);

      // Refresh both providers
      await Promise.all([
        tunnelTreeProvider.refresh(),
        quickTunnelTreeProvider.refresh(),
      ]);

      // Get elements from both providers
      [regularElements, quickElements] = await Promise.all([
        tunnelTreeProvider.getChildren(),
        quickTunnelTreeProvider.getChildren(),
      ]);

      // Log current state for debugging
      console.log(
        `Attempt ${attempts + 1}: Regular tunnels: ${regularElements?.length}, Quick tunnels: ${quickElements?.length}`,
      );

      // Get items in each group for regular tunnels
      if (regularElements?.length === 2) {
        // 2 because we have two groups
        const allTunnels = await Promise.all(
          regularElements.map((group) => tunnelTreeProvider.getChildren(group)),
        );

        // Count total tunnels across all groups
        const totalTunnels = allTunnels.reduce(
          (sum, groupTunnels) => sum + groupTunnels.length,
          0,
        );

        if (totalTunnels === 1 && quickElements?.length === 1) {
          regularElements = allTunnels.flat();
          break;
        }
      }

      attempts++;
    }

    // Verify final state with detailed messages
    assert.ok(
      regularElements?.length === 1,
      `Regular tunnel count should be 1, got ${regularElements?.length}`,
    );
    assert.ok(
      quickElements?.length === 1,
      `Quick tunnel count should be 1, got ${quickElements?.length}`,
    );

    // Verify tunnel details
    if (regularElements && regularElements.length > 0) {
      assert.strictEqual(
        regularElements[0].label,
        "test-tunnel",
        "Regular tunnel should have correct name",
      );
    }
    if (quickElements && quickElements.length > 0) {
      assert.strictEqual(
        quickElements[0].port,
        8080,
        "Quick tunnel should have correct port",
      );
    }
  });

  /**
   * Note: Error handling tests have been moved to cloudflared.test.ts
   * This includes testing of:
   * - API errors
   * - Error recovery
   * - Graceful error handling
   */

  suiteTeardown(async () => {
    // Cleanup any remaining tunnels
    await tunnelManager.cleanup();
  });
});

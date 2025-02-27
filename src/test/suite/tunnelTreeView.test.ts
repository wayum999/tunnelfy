import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
  TunnelTreeItem,
  TunnelGroupItem,
  TunnelTreeDataProvider,
} from "../../views/tunnelTreeView";
import { TunnelManager } from "../../services/cloudflared";
import { ProfileManager } from "../../services/profileManager";
import { Logger } from "../../utils/logger";

suite("TunnelTreeView Test Suite", () => {
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
        {
          id: "tunnel1",
          name: "Tunnel 1",
          connections: [],
          remote_config: false,
          management_type: "local",
          is_running_locally: false,
          created_at: new Date().toISOString(),
          deleted_at: null,
        },
        {
          id: "tunnel2",
          name: "Tunnel 2",
          connections: [{}],
          remote_config: true,
          management_type: "remote",
          is_running_locally: true,
          created_at: new Date().toISOString(),
          deleted_at: null,
        },
      ]),
      onTunnelEvent: mockEventEmitter.event,
      getTunnelConfig: sinon.stub().resolves({
        ingress: [{ service: "http://localhost:8080" }],
      }),
    } as any;

    // Create mock ProfileManager
    mockProfileManager = sinon.createStubInstance(ProfileManager);
    mockProfileManager.getActiveProfile.resolves("test-profile");

    // Create the provider
    tunnelTreeDataProvider = new TunnelTreeDataProvider(
      mockTunnelManager,
      mockProfileManager as any,
    );
  });

  teardown(() => {
    sinon.restore();
    mockEventEmitter.dispose();
  });

  test("TunnelTreeItem should be created with correct properties", () => {
    const item = new TunnelTreeItem(
      "Test Tunnel",
      "test-id",
      "running",
      "local",
      false,
      8080,
    );

    assert.strictEqual(item.label, "Test Tunnel");
    assert.strictEqual(item.tunnelId, "test-id");
    assert.strictEqual(item.status, "running");
    assert.strictEqual(item.port, 8080);
    assert.strictEqual(item.contextValue, "tunnel-running");
    assert.strictEqual(item.management_type, "local");
    assert.strictEqual(item.is_running_locally, false);
    // Description format: [Local] test-id (Port 8080)
    const expectedDescription = "[Local] test-id (Port 8080)";
    assert.ok(item.description, "Description should exist");
    assert.strictEqual(item.description, expectedDescription);
  });

  test("TunnelTreeItem should show correct icon for running status", () => {
    const item = new TunnelTreeItem(
      "Test Tunnel",
      "test-id",
      "running",
      "local",
      false,
    );

    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    const icon = item.iconPath as vscode.ThemeIcon;
    assert.strictEqual(icon.id, "circle-filled");
  });

  test("TunnelTreeItem should show correct icon for stopped status", () => {
    const item = new TunnelTreeItem(
      "Test Tunnel",
      "test-id",
      "stopped",
      "local",
      false,
    );

    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    const icon = item.iconPath as vscode.ThemeIcon;
    assert.strictEqual(icon.id, "circle-outline");
  });

  test("getChildren should return special item when no active profile", async () => {
    mockProfileManager.getActiveProfile.resolves(undefined);

    // Get root level items (groups)
    const rootItems = await tunnelTreeDataProvider.getChildren();
    assert.ok(rootItems instanceof Array, "Root items should be an array");

    // Get items in each group
    const allTunnels = await Promise.all(
      rootItems.map((group) => tunnelTreeDataProvider.getChildren(group)),
    );

    // Check that each group has one "No Profile Set Up" item
    allTunnels.forEach((tunnels) => {
      assert.strictEqual(
        tunnels.length,
        1,
        "Each group should have one 'No Profile Set Up' item",
      );
      const item = tunnels[0] as TunnelTreeItem;
      assert.ok(item instanceof TunnelTreeItem, "Item should be a TunnelTreeItem");
      assert.strictEqual(item.tunnelId, "no-profile", "Item should have no-profile ID");
      assert.strictEqual(item.status, "stopped", "Item should have stopped status");
      assert.ok(item.iconPath instanceof vscode.ThemeIcon, "Item should have a ThemeIcon");
      assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "info", "Item should have info icon");
      assert.ok(
        item.label.includes("No Profile Set Up"),
        "Item should indicate no profile is set up",
      );
    });
  });

  test("getChildren should return tunnel items for active profile", async () => {
    // Get root level items (should be groups)
    const rootItems = await tunnelTreeDataProvider.getChildren();
    assert.strictEqual(rootItems.length, 2, "Should have two groups");
    assert.ok(
      rootItems[0] instanceof TunnelGroupItem,
      "First item should be a group",
    );
    assert.ok(
      rootItems[1] instanceof TunnelGroupItem,
      "Second item should be a group",
    );

    // Verify group labels
    assert.strictEqual(
      rootItems[0].label,
      "Remote-Managed Tunnels",
      "First group should be remote tunnels",
    );
    assert.strictEqual(
      rootItems[1].label,
      "Locally-Managed Tunnels",
      "Second group should be local tunnels",
    );

    // Get items in each group
    const remoteTunnels = await tunnelTreeDataProvider.getChildren(
      rootItems[0],
    );
    const localTunnels = await tunnelTreeDataProvider.getChildren(rootItems[1]);

    // Verify remote tunnels
    assert.strictEqual(
      remoteTunnels.length,
      1,
      "Should have one remote tunnel",
    );
    assert.ok(
      remoteTunnels[0] instanceof TunnelTreeItem,
      "Remote tunnel should be a TunnelTreeItem",
    );
    const remoteTunnel = remoteTunnels[0] as TunnelTreeItem;
    assert.strictEqual(
      remoteTunnel.status,
      "running",
      "Remote tunnel should be running",
    );
    assert.strictEqual(
      remoteTunnel.management_type,
      "remote",
      "Remote tunnel should have remote management type",
    );
    assert.strictEqual(
      remoteTunnel.is_running_locally,
      true,
      "Remote tunnel should be running locally",
    );

    // Verify local tunnels
    assert.strictEqual(localTunnels.length, 1, "Should have one local tunnel");
    assert.ok(
      localTunnels[0] instanceof TunnelTreeItem,
      "Local tunnel should be a TunnelTreeItem",
    );
    const localTunnel = localTunnels[0] as TunnelTreeItem;
    assert.strictEqual(
      localTunnel.status,
      "stopped",
      "Local tunnel should be stopped",
    );
    assert.strictEqual(
      localTunnel.management_type,
      "local",
      "Local tunnel should have local management type",
    );
    assert.strictEqual(
      localTunnel.is_running_locally,
      false,
      "Local tunnel should not be running locally",
    );
  });

  test("findTunnelById should return correct tunnel", async () => {
    // Get root level items (groups)
    const rootItems = await tunnelTreeDataProvider.getChildren();

    // Get items in each group to populate the provider's internal state
    await Promise.all(
      rootItems.map((group) => tunnelTreeDataProvider.getChildren(group)),
    );

    // Find the tunnel
    const tunnel = tunnelTreeDataProvider.findTunnelById("tunnel1");

    assert.ok(tunnel, "Tunnel should be found");
    assert.strictEqual(tunnel.tunnelId, "tunnel1", "Tunnel ID should match");
    assert.strictEqual(tunnel.label, "Tunnel 1", "Tunnel name should match");
    assert.strictEqual(
      tunnel.management_type,
      "local",
      "Management type should be local",
    );
    assert.strictEqual(
      tunnel.is_running_locally,
      false,
      "Should not be running locally",
    );
  });

  test("refresh should trigger tree data change event", () => {
    let eventFired = false;
    tunnelTreeDataProvider.onDidChangeTreeData(() => {
      eventFired = true;
    });

    tunnelTreeDataProvider.refresh();
    assert.ok(eventFired);
  });
});

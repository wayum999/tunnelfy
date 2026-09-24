import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
// The raw module object (not an import-star copy) so sinon can wrap spawn where TunnelManager calls it
import childProcess = require("child_process");
import * as sinon from "sinon";
import { TunnelManager } from "../../services/cloudflared";
import { buildTunnelRunInvocation } from "../../services/cloudflared/TunnelManager";
import { CloudflareApiService } from "../../services/cloudflareApi";
import { ProfileManager } from "../../services/profileManager";
import { Logger, LogComponent } from "../../utils/logger";

suite("TunnelManager Test Suite", () => {
  let tunnelManager: TunnelManager;
  let eventEmitted: {
    type: string;
    tunnelId: string;
    message?: string;
  } | null = null;

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
    asAbsolutePath: (relativePath: string) =>
      path.join(__dirname, relativePath),
    storagePath: path.join(__dirname, "storage"),
    globalStoragePath: path.join(__dirname, "globalStorage"),
    logPath: path.join(__dirname, "logs"),
  } as unknown as vscode.ExtensionContext;

  const mockLogger: Logger = {
    info: (component: LogComponent, message: string) => {},
    error: (component: LogComponent, message: string) => {},
    debug: (component: LogComponent, message: string) => {},
    warn: (component: LogComponent, message: string) => {},
  } as unknown as Logger;

  const mockProfileManager = {
    getActiveProfile: async () => ({
      name: "test-profile",
      accountId: "test-account-id",
      apiKey: "test-api-key",
    }),
    getProfileAccountId: async () => "test-account-id",
    getProfileApiKey: async () => "test-api-key",
  } as unknown as ProfileManager;

  const mockApiService: CloudflareApiService = {
    createTunnel: async (name: string) => ({
      id: "test-tunnel-id",
      name,
      created_at: new Date().toISOString(),
      account_tag: "test-account",
      status: "active",
      remote_config: false,
      metadata: {},
    }),
    deleteTunnel: async () => {},
    listTunnels: async () => [
      {
        id: "test-tunnel-id",
        name: "test-tunnel",
        created_at: new Date().toISOString(),
        account_tag: "test-account",
        status: "active",
        remote_config: false,
        metadata: {},
      },
    ],
    getTunnelInfo: async (tunnelId: string) => ({
      id: tunnelId,
      name: "test-tunnel",
      created_at: new Date().toISOString(),
      account_tag: "test-account",
      status: "active",
      remote_config: false,
      metadata: {},
    }),
    getTunnelToken: async () => "test-token",
    getDnsRecords: async () => [],
    createDnsRecord: async () => {},
    deleteDnsRecord: async () => {},
    cleanupDnsRecords: async () => {},
  } as unknown as CloudflareApiService;

  setup(() => {
    eventEmitted = null;
    tunnelManager = new TunnelManager(
      mockContext,
      mockLogger,
      mockApiService,
      mockProfileManager,
    );
    tunnelManager.onTunnelEvent((event) => {
      eventEmitted = event;
    });
  });

  test("should create tunnel", async () => {
    const tunnel = await tunnelManager.createTunnel("test-tunnel");
    assert.strictEqual(tunnel.name, "test-tunnel");
    assert.strictEqual(tunnel.id, "test-tunnel-id");
  });

  test("should delete tunnel", async () => {
    let deleteCalled = false;
    const customApiService = {
      ...mockApiService,
      deleteTunnel: async () => {
        deleteCalled = true;
      },
    };

    const manager = new TunnelManager(
      mockContext,
      mockLogger,
      customApiService as unknown as CloudflareApiService,
      mockProfileManager,
    );

    await manager.deleteTunnel("test-tunnel-id");
    assert.strictEqual(deleteCalled, true);
  });

  test("should list tunnels", async () => {
    const tunnels = await tunnelManager.listTunnels();
    assert.strictEqual(tunnels.length, 1);
    assert.strictEqual(tunnels[0].id, "test-tunnel-id");
    assert.strictEqual(tunnels[0].name, "test-tunnel");
  });

  test("should prevent running duplicate tunnels", async () => {
    const tunnelId = "test-tunnel-id";

    // First run should succeed
    await tunnelManager.runTunnel(tunnelId, 8080);

    // Second run should throw
    await assert.rejects(
      tunnelManager.runTunnel(tunnelId, 8080),
      /Tunnel .* is already running/,
    );
  });

  test("should stop running tunnel", async () => {
    const tunnelId = "test-tunnel-id";

    // Start the tunnel
    await tunnelManager.runTunnel(tunnelId, 8080);

    // Stop the tunnel
    await tunnelManager.stopTunnel(tunnelId);

    // Verify event was emitted
    assert.strictEqual(eventEmitted?.type, "stop");
    assert.strictEqual(eventEmitted?.tunnelId, tunnelId);
  });

  test("runTunnel passes the token via TUNNEL_TOKEN, never argv, and never writes it to disk", async () => {
    // Stand node in for cloudflared: it exits at once, but spawnargs records the argv we built.
    const pathStub = sinon
      .stub(TunnelManager.prototype as any, "findCloudflaredPath")
      .resolves(process.execPath);
    const spawnSpy = sinon.spy(childProcess, "spawn");
    try {
      const child = await tunnelManager.runTunnel("argv-check-tunnel", 8080);
      assert.strictEqual(spawnSpy.callCount, 1, "spawn not observed");
      const spawnOptions = spawnSpy.firstCall.args[2] as childProcess.SpawnOptions;
      assert.strictEqual(spawnOptions.env?.TUNNEL_TOKEN, "test-token", "token not passed via env");
      const argv = child.spawnargs.join(" ");
      assert.ok(!argv.includes("test-token"), `token found on argv: ${argv}`);
      assert.ok(!child.spawnargs.includes("--token"), "--token flag found on argv");
      assert.ok(child.spawnargs.includes("run"), "run subcommand missing");

      const configPath = path.join(
        mockContext.globalStoragePath,
        ".tunnelfy",
        "configs",
        "argv-check-tunnel.json",
      );
      const raw = fs.readFileSync(configPath, "utf8");
      assert.ok(!raw.includes("tunnelSecret"), "tunnelSecret written to config");
      assert.ok(!raw.includes("test-token"), "token written to config");
      await tunnelManager.stopTunnel("argv-check-tunnel");
    } finally {
      spawnSpy.restore();
      pathStub.restore();
    }
  });

  test("buildTunnelRunInvocation keeps the token out of args and in env", () => {
    const { args, env } = buildTunnelRunInvocation(
      "http://localhost:8080",
      "fake-token-value",
    );
    assert.deepStrictEqual(args, ["tunnel", "--url", "http://localhost:8080", "run"]);
    assert.ok(!args.some((arg) => arg.includes("fake-token-value")));
    assert.strictEqual(env.TUNNEL_TOKEN, "fake-token-value");
    assert.strictEqual(env.PATH, process.env.PATH, "parent environment not inherited");
  });
});

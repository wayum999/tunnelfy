import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  TunnelManager,
  TunnelEvent,
  TunnelEventType,
} from "../../services/cloudflared";
import { CloudflareApiService } from "../../services/cloudflareApi";
import { ProfileManager } from "../../services/profileManager";
import { Logger, LogComponent } from "../../utils/logger";
import * as sinon from "sinon";
import { TunnelProcessRegistry } from "../../services/cloudflared/TunnelProcessRegistry";
import { Messages } from "../../utils/messages";
import { TestMemento } from "./testUtils";
import {
  createFakeKill,
  createFakeSpawn,
  FakeChild,
  FakeKill,
  FakeSpawn,
} from "./fakeProcess";

// Helper function to wait between operations
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to retry on rate limit
async function retryOnRateLimit<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      if (
        error instanceof Error &&
        (error.message.includes("rate limit") ||
          error.message.includes("too many requests"))
      ) {
        await wait(delayMs * Math.pow(2, i)); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
}

// Helper function to type check tunnel events
function isTunnelEvent(event: any): event is TunnelEvent {
  return (
    event &&
    typeof event === "object" &&
    "type" in event &&
    "tunnelId" in event &&
    typeof event.type === "string" &&
    typeof event.tunnelId === "string"
  );
}

suite("Quick Tunnels Test Suite", () => {
  let tunnelManager: TunnelManager;
  let eventEmitted: TunnelEvent | null = null;
  let sharedTunnel: { tunnelId: string; port: number; url?: string; tunnelUrl?: string } | null =
    null;

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

  const mockProfileManager: ProfileManager = {
    getActiveProfile: async () => "test-profile",
    getProfileAccountId: async () => "test-account",
    isActiveProfile: async (name: string) => name === "test-profile",
    listProfiles: () => ["test-profile"],
    getProfileApiKey: async () => "test-api-key",
    createProfile: async () => {},
    updateProfileApiKey: async () => {},
    setActiveProfile: async (name: string) => {},
    deleteProfile: async () => {},
  } as unknown as ProfileManager;

  // Set up mock API service with proper profile handling
  const mockApiService = {
    createTunnel: async () => {
      throw new Error("Should not be called for quick tunnels");
    },
    deleteTunnel: async () => {
      throw new Error("Should not be called for quick tunnels");
    },
    listTunnels: async () => [],
    getTunnelToken: async () => {
      throw new Error("Should not be called for quick tunnels");
    },
    getTunnelInfo: async () => {
      throw new Error("Should not be called for quick tunnels");
    },
    setApiKey: async () => {},
    listAccounts: async () => [
      {
        id: "test-account",
        name: "Test Account",
      },
    ],
  } as unknown as CloudflareApiService;

  setup(async function () {
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

  teardown(async function () {
    this.timeout(10000);
    await tunnelManager.stopAllOwned();
  });

  // Group validation tests that don't need actual tunnel creation
  suite("Validation Tests", () => {
    test("should validate port numbers", async function () {
      this.timeout(3000); // Increase timeout
      // These tests don't create actual tunnels
      await assert.rejects(
        () => tunnelManager.createQuickTunnel(-1),
        /invalid port/i,
        "Should reject negative port numbers",
      );

      await assert.rejects(
        () => tunnelManager.createQuickTunnel(0),
        /invalid port/i,
        "Should reject port 0",
      );

      await assert.rejects(
        () => tunnelManager.createQuickTunnel(65536),
        /invalid port/i,
        "Should reject ports above 65535",
      );
    });
  });

  // Every behaviour of a quick-tunnel attempt, against a fake cloudflared: no real
  // process starts and nothing contacts Cloudflare (12.1, 12.2).
  suite("Attempt lifecycle with a fake cloudflared", () => {
    const URL_A = "https://alpha-bravo.trycloudflare.com";
    const URL_LATE = "https://late-arrival.trycloudflare.com";
    let spawn: FakeSpawn;
    let kill: FakeKill;
    let registry: TunnelProcessRegistry;
    let manager: TunnelManager;
    let events: TunnelEvent[];
    let infos: string[];
    let errors: unknown[];

    async function nextChild(index: number): Promise<FakeChild> {
      for (let i = 0; i < 500 && spawn.children.length <= index; i++) {
        await wait(10);
      }
      assert.ok(spawn.children[index], `child ${index} never spawned`);
      // Let the registry see the spawn event and record the child
      await wait(5);
      return spawn.children[index];
    }

    async function startHealthy(port: number): Promise<{ tunnelId: string; child: FakeChild }> {
      const index = spawn.children.length;
      const pending = manager.createQuickTunnel(port);
      const child = await nextChild(index);
      child.write(`INF |  ${URL_A}  |`, "stderr");
      const result = await pending;
      assert.ok(result);
      return { tunnelId: result.tunnelId, child };
    }

    setup(() => {
      spawn = createFakeSpawn();
      kill = createFakeKill(() => spawn.children);
      registry = new TunnelProcessRegistry({
        memento: new TestMemento(),
        logger: mockLogger,
        spawn: spawn.spawn,
        kill: kill.kill,
        probe: async () => ({ state: "dead" }),
      });
      // node stands in for cloudflared only for the `--version` check; spawn is faked
      sinon.stub(TunnelManager.prototype as any, "findCloudflaredPath").resolves(process.execPath);
      infos = [];
      errors = [];
      sinon.stub(Messages, "showInfo").callsFake(async (message: string) => {
        infos.push(message);
      });
      sinon.stub(Messages, "showError").callsFake(async (message: unknown) => {
        errors.push(message);
        return undefined;
      });
      manager = new TunnelManager(
        mockContext,
        mockLogger,
        mockApiService,
        mockProfileManager,
        registry,
        { quickTunnelUrlTimeoutMs: 200 },
      );
      events = [];
      manager.onTunnelEvent((event) => events.push(event));
    });

    teardown(async function () {
      this.timeout(10000);
      kill.ignore.clear();
      await manager.stopAllOwned(500);
      sinon.restore();
      registry.dispose();
    });

    test("a found URL announces the tunnel once and lists it", async () => {
      const { tunnelId } = await startHealthy(8080);
      assert.ok(tunnelId.startsWith("quick-8080-"));
      assert.deepStrictEqual(events.map((e) => e.type), ["start"]);
      assert.ok(infos.includes(Messages.QUICK_TUNNEL_RUNNING(URL_A)));
      const listed = await manager.getQuickTunnels();
      assert.deepStrictEqual(listed.map((t) => [t.tunnelId, t.port, t.tunnelUrl]), [[tunnelId, 8080, URL_A]]);
    });

    test("a URL timeout stops the attempt's own child before the error reaches the caller (4.1)", async function () {
      this.timeout(10000);
      const pending = manager.createQuickTunnel(8080);
      const child = await nextChild(0);
      await assert.rejects(pending, /Timed out waiting for quick tunnel URL/);
      assert.deepStrictEqual(kill.calls, [{ pid: child.pid, signal: "SIGTERM" }]);
      assert.notStrictEqual(child.signalCode, null, "child still running");
      assert.deepStrictEqual(manager.listOwnedTunnels(), []);
      assert.ok(!events.some((e) => e.type === "start"), "failed attempt announced");
    });

    test("a URL after failure creates no record, no start event and no running message (4.2, 4.3)", async function () {
      this.timeout(15000);
      const setIntervalSpy = sinon.spy(global, "setInterval");
      const clearIntervalSpy = sinon.spy(global, "clearInterval");
      // The child ignores every signal, so it is still around to print a late URL
      kill.ignore.add("SIGTERM");
      kill.ignore.add("SIGKILL");
      const pending = manager.createQuickTunnel(8080);
      const child = await nextChild(0);
      await assert.rejects(pending, /Timed out/);

      child.write(`INF |  ${URL_LATE}  |`, "stderr");
      await wait(250);
      assert.ok(!events.some((e) => e.type === "start"), "late URL fired start");
      assert.ok(!infos.some((m) => m.includes(URL_LATE)), "late URL announced");
      assert.deepStrictEqual(await manager.getQuickTunnels(), [], "late URL listed");

      const pollIntervals = setIntervalSpy.getCalls().filter((call) => call.args[1] === 100);
      assert.strictEqual(pollIntervals.length, 1, "URL poll not started exactly once");
      const cleared = clearIntervalSpy.getCalls().map((call) => call.args[0]);
      assert.ok(cleared.includes(pollIntervals[0].returnValue), "URL poll interval not cleared on settle");
    });

    test("an exit before the URL rejects with the specific error, after the child is gone", async () => {
      const pending = manager.createQuickTunnel(8080);
      const child = await nextChild(0);
      child.write("ERR 429 Too Many Requests", "stderr");
      child.exit(1);
      await assert.rejects(pending, /Rate limit exceeded/);
      assert.deepStrictEqual(errors, [Messages.QUICK_TUNNEL_RATE_LIMIT]);
      assert.deepStrictEqual(manager.listOwnedTunnels(), []);
      assert.strictEqual(kill.calls.length, 0, "an exited child was signalled");
    });

    test("a spawn error rejects and leaves nothing owned (8.1)", async () => {
      spawn.queue.push("error");
      await assert.rejects(manager.createQuickTunnel(8080), /ENOENT/);
      assert.deepStrictEqual(manager.listOwnedTunnels(), []);
      assert.strictEqual(kill.calls.length, 0);
    });

    test("a failed attempt leaves a healthy tunnel on the same port alone (5.1)", async function () {
      this.timeout(10000);
      const healthy = await startHealthy(8080);
      const pending = manager.createQuickTunnel(8080);
      const failing = await nextChild(1);
      await assert.rejects(pending, /Timed out/);

      assert.deepStrictEqual(kill.calls.map((c) => c.pid), [failing.pid], "a pid other than the attempt's was signalled");
      assert.strictEqual(healthy.child.signalCode, null);
      assert.deepStrictEqual(manager.listOwnedTunnels().map((r) => r.tunnelId), [healthy.tunnelId]);
      assert.deepStrictEqual((await manager.getQuickTunnels()).map((t) => t.tunnelId), [healthy.tunnelId]);
    });

    test("two quick tunnels on one port are stopped independently by id (5.2)", async () => {
      const first = await startHealthy(8080);
      const second = await startHealthy(8080);
      assert.notStrictEqual(first.tunnelId, second.tunnelId);

      const result = await manager.stopQuickTunnel(first.tunnelId);
      assert.strictEqual(result.outcome, "stopped");
      assert.deepStrictEqual(kill.calls.map((c) => c.pid), [first.child.pid]);
      assert.deepStrictEqual((await manager.getQuickTunnels()).map((t) => t.tunnelId), [second.tunnelId]);
      assert.deepStrictEqual(await manager.stopQuickTunnel("quick-8080-0"), {
        tunnelId: "quick-8080-0",
        outcome: "not-owned",
      });
    });

    test("two attempts on one port in the same millisecond get distinct ids", async function () {
      this.timeout(10000);
      sinon.stub(Date, "now").returns(1790000000000);
      const healthy = await startHealthy(8080);
      const pending = manager.createQuickTunnel(8080);
      const failing = await nextChild(1);
      await assert.rejects(pending, /Timed out/);
      const ids = manager.listOwnedTunnels().map((r) => r.tunnelId);
      assert.deepStrictEqual(ids, [healthy.tunnelId], "the failed attempt's cleanup reached the healthy tunnel");
      assert.deepStrictEqual(kill.calls.map((c) => c.pid), [failing.pid]);
    });

    test("a quick tunnel that exits in the same tick as its URL is not announced", async () => {
      const pending = manager.createQuickTunnel(8080);
      const child = await nextChild(0);
      child.write(`INF |  ${URL_A}  |`, "stderr");
      child.exit(1);
      await assert.rejects(pending, /exited right after reporting its URL/);
      assert.ok(!events.some((e) => e.type === "start"), "dead tunnel announced");
      assert.ok(!infos.some((m) => m.includes(URL_A)), "dead tunnel shown as running");
      assert.deepStrictEqual(await manager.getQuickTunnels(), []);
    });

    test("an adopted quick tunnel is listed with the URL from an earlier session's log", async () => {
      const startedAt = new Date(2026, 8, 24, 9, 0, 0).getTime();
      const memento = new TestMemento();
      await memento.update("tunnelfy.ownedTunnels", [
        { tunnelId: "quick-7070-1", pid: 700, startedAt, kind: "quick", target: "http://localhost:7070" },
        { tunnelId: "quick-7171-2", pid: 701, startedAt, kind: "quick", target: "http://localhost:7171" },
      ]);
      const adoptingRegistry = new TunnelProcessRegistry({
        memento,
        logger: mockLogger,
        spawn: spawn.spawn,
        kill: kill.kill,
        probe: async () => ({ state: "alive", executable: "cloudflared", startTimeMs: startedAt }),
      });
      const adoptingManager = new TunnelManager(
        mockContext,
        mockLogger,
        mockApiService,
        mockProfileManager,
        adoptingRegistry,
      );
      const logDir = path.join(mockContext.globalStoragePath, "logs", "tunnels");
      // The URL is only in a rotated file; the second tunnel's log has none
      const rotated = path.join(logDir, "quick-7070-1.2.log");
      const noUrl = path.join(logDir, "quick-7171-2.log");
      await fs.promises.writeFile(rotated, "INF |  https://from-last-session.trycloudflare.com  |\n");
      await fs.promises.writeFile(noUrl, "INF starting\n");
      try {
        await adoptingManager.reconcileOwned();
        assert.strictEqual(adoptingManager.listOwnedTunnels("quick").length, 2);
        const listed = await adoptingManager.getQuickTunnels();
        assert.deepStrictEqual(
          listed.map((t) => [t.tunnelId, t.port, t.url, t.tunnelUrl]),
          [["quick-7070-1", 7070, "http://localhost:7070", "https://from-last-session.trycloudflare.com"]],
        );
      } finally {
        await fs.promises.rm(rotated, { force: true });
        await fs.promises.rm(noUrl, { force: true });
        adoptingRegistry.dispose();
      }
    });

    test("a quick tunnel that exits on its own fires stop and leaves the list (6.1)", async () => {
      const { tunnelId, child } = await startHealthy(8080);
      child.exit(0);
      assert.ok(events.some((e) => e.type === "stop" && e.tunnelId === tunnelId), "no stop event");
      assert.deepStrictEqual(await manager.getQuickTunnels(), []);
      assert.deepStrictEqual(manager.listOwnedTunnels(), []);
    });
  });

  // Group tunnel operation tests.
  // These open real public quick tunnels against Cloudflare, so they only run
  // when TUNNELFY_NETWORK_TESTS=1 is set; CI leaves it unset.
  suite("Tunnel Operations", () => {
    setup(async function () {
      if (process.env.TUNNELFY_NETWORK_TESTS !== "1") {
        this.skip();
      }
      this.timeout(60000); // Increase timeout
      // Ensure cleanup before each test
      await tunnelManager.stopAllOwned();
      await wait(5000); // Wait longer for cleanup

      // Create a shared tunnel for tests that need it
      if (!sharedTunnel) {
        const port = 8080;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            const result = await retryOnRateLimit(
              async () => {
                const tunnel = await tunnelManager.createQuickTunnel(port);
                await wait(2000); // Wait longer for tunnel to be fully established
                return tunnel;
              },
              5,
              10000,
            ); // More retries, longer delay
            if (!result) {
              throw new Error("Quick tunnel was not created");
            }
            sharedTunnel = { port, ...result };
            await wait(5000); // Additional wait after creation
            break;
          } catch (error: unknown) {
            attempts++;
            console.error(
              `Failed to create shared tunnel (attempt ${attempts}/${maxAttempts}):`,
              error,
            );
            if (attempts === maxAttempts) {
              if (
                error instanceof Error &&
                error.message.includes("rate limit")
              ) {
                this.skip(); // Skip test if we hit rate limit after all retries
              } else {
                throw error;
              }
            }
            await wait(10000); // Wait longer between attempts
          }
        }
      }
    });

    test("should create and verify quick tunnel", async function () {
      this.timeout(20000); // Increase timeout
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
          reject(new Error("Timeout waiting for tunnel event"));
        }, 3000);

        const checkEvent = setInterval(() => {
          if (!eventEmitted) return;
          const event = eventEmitted as TunnelEvent;
          if (
            event.type === "start" &&
            event.tunnelId.startsWith(`quick-${port}-`)
          ) {
            clearTimeout(timeout);
            clearInterval(checkEvent);
            resolve();
          }
        }, 100);
      });

      // Verify tunnel properties
      assert.ok(tunnel, "Tunnel should be created");
      assert.strictEqual(typeof tunnel.url, "string");
      assert.strictEqual(tunnel.url, `http://localhost:${port}`);
      assert.ok(tunnel.tunnelUrl?.startsWith("https://"));
      assert.ok(tunnel.tunnelUrl?.endsWith(".trycloudflare.com"));

      // Verify event was emitted
      assert.ok(eventEmitted, "Event should be emitted");
      const event = eventEmitted as TunnelEvent;
      assert.strictEqual(event.type, "start", "Event should be start");
      assert.ok(
        event.tunnelId.startsWith(`quick-${port}-`),
        "Event should reference correct tunnel",
      );

      // Cleanup
      await tunnelManager.stopQuickTunnel(tunnel.tunnelId);
      await wait(1000);
    });
  });

  // Cleanup tests

  suiteTeardown(async () => {
    // Ensure cleanup
    if (sharedTunnel) {
      await tunnelManager.stopQuickTunnel(sharedTunnel.tunnelId);
      sharedTunnel = null;
    }
    await tunnelManager.stopAllOwned();
  });
});

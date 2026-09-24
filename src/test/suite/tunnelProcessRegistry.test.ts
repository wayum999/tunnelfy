import * as assert from "assert";
import {
  TunnelProcessRegistry,
  TunnelAlreadyRunningError,
  OWNED_TUNNELS_KEY,
  OwnedTunnelRecord,
  RegistryEvent,
  StartRequest,
} from "../../services/cloudflared/TunnelProcessRegistry";
import { ProbeResult } from "../../services/cloudflared/processIdentity";
import { TestMemento } from "./testUtils";
import {
  createFakeKill,
  createFakeSpawn,
  createRecordingLogger,
  FakeChild,
  FakeKill,
  FakeSpawn,
  LoggedLine,
  tick,
  wait,
} from "./fakeProcess";

const SECRET = "secret-tunnel-token-value";

suite("TunnelProcessRegistry Test Suite", () => {
  let memento: TestMemento;
  let spawn: FakeSpawn;
  let kill: FakeKill;
  let lines: LoggedLine[];
  let events: RegistryEvent[];
  let probeAnswers: Map<number, ProbeResult | ProbeResult[]>;
  let probeCalls: number[];
  let clock: number;
  let registry: TunnelProcessRegistry;

  const probe = async (pid: number): Promise<ProbeResult> => {
    probeCalls.push(pid);
    const answer = probeAnswers.get(pid);
    if (Array.isArray(answer)) {
      return answer.length > 1 ? answer.shift()! : answer[0];
    }
    return answer ?? { state: "dead" };
  };

  function makeRegistry(overrides: { platform?: NodeJS.Platform; probe?: typeof probe } = {}) {
    const { logger, lines: logged } = createRecordingLogger();
    lines = logged;
    const reg = new TunnelProcessRegistry({
      memento,
      logger,
      spawn: spawn.spawn,
      kill: kill.kill,
      probe: overrides.probe ?? probe,
      platform: overrides.platform ?? "linux",
      pollIntervalMs: 5,
    });
    reg.onDidChange((event) => events.push(event));
    return reg;
  }

  function request(tunnelId: string, extra: Partial<StartRequest> = {}): StartRequest {
    return {
      tunnelId,
      kind: "named",
      target: "http://localhost:8080",
      command: "/usr/local/bin/cloudflared",
      args: ["tunnel", "--url", "http://localhost:8080", "run"],
      env: { PATH: "/usr/bin", TUNNEL_TOKEN: SECRET },
      onOutput: () => {},
      ...extra,
    };
  }

  function persisted(): OwnedTunnelRecord[] {
    return memento.get<OwnedTunnelRecord[]>(OWNED_TUNNELS_KEY) ?? [];
  }

  function childFor(tunnelId: string): FakeChild {
    const record = registry.list().find((r) => r.tunnelId === tunnelId);
    const child = spawn.children.find((c) => c.pid === record?.pid);
    assert.ok(child, `no child for ${tunnelId}`);
    return child;
  }

  setup(() => {
    memento = new TestMemento();
    spawn = createFakeSpawn();
    kill = createFakeKill(() => spawn.children);
    events = [];
    probeAnswers = new Map();
    probeCalls = [];
    clock = Date.now();
    registry = makeRegistry();
  });

  teardown(() => registry.dispose());

  suite("start and record (1.1-1.5, 6.1, 8.1, 9.1, 9.2)", () => {
    test("records and persists the five fields on spawn, never the env or token", async () => {
      const owned = await registry.start(request("t1"));
      await registry.flush();

      assert.strictEqual(spawn.children.length, 1);
      const child = spawn.children[0];
      assert.deepStrictEqual(child.options.stdio, ["ignore", "pipe", "pipe"]);
      assert.strictEqual(child.options.env?.TUNNEL_TOKEN, SECRET, "env must reach the child");
      assert.ok(!child.args.includes(SECRET), "token on argv");

      assert.ok(owned.record.startedAt >= clock && owned.record.startedAt <= Date.now(), "startedAt not taken at spawn");
      assert.deepStrictEqual(owned.record, {
        tunnelId: "t1",
        pid: child.pid,
        startedAt: owned.record.startedAt,
        kind: "named",
        target: "http://localhost:8080",
      });
      assert.deepStrictEqual(persisted(), [owned.record]);
      assert.ok(!JSON.stringify(persisted()).includes(SECRET), "token persisted");
      assert.ok(!lines.some((l) => l.message.includes(SECRET)), "token logged");
      assert.strictEqual(registry.isOwned("t1"), true);
      assert.strictEqual(registry.isAdopted("t1"), false);
      assert.deepStrictEqual(events.map((e) => e.type), ["start"]);
    });

    test("forwards stdout and stderr chunks to onOutput", async () => {
      const chunks: string[] = [];
      await registry.start(request("t1", { onOutput: (chunk, source) => chunks.push(`${source}:${chunk}`) }));
      const child = spawn.children[0];
      child.write("hello", "stdout");
      child.write("oops", "stderr");
      assert.deepStrictEqual(chunks, ["stdout:hello", "stderr:oops"]);
    });

    test("exit removes the record from memory and globalState and fires stop", async () => {
      const exits: Array<number | null> = [];
      await registry.start(request("t1", { onExit: (code) => exits.push(code) }));
      spawn.children[0].exit(1);
      await registry.flush();

      assert.strictEqual(registry.isOwned("t1"), false);
      assert.deepStrictEqual(persisted(), []);
      assert.deepStrictEqual(events.map((e) => e.type), ["start", "stop"]);
      assert.deepStrictEqual(exits, [1]);
    });

    test("an error before spawn rejects, records nothing and fires error", async () => {
      spawn.queue.push("error");
      await assert.rejects(registry.start(request("t1")), /ENOENT/);
      await registry.flush();
      assert.strictEqual(registry.isOwned("t1"), false);
      assert.strictEqual(memento.get(OWNED_TUNNELS_KEY), undefined);
      assert.deepStrictEqual(events.map((e) => e.type), ["error"]);
    });

    test("a spawn with no pid, or a throwing spawn, records nothing", async () => {
      spawn.queue.push("no-pid", "throw");
      await assert.rejects(registry.start(request("t1")), /without a pid/);
      await assert.rejects(registry.start(request("t1")), /EACCES/);
      await registry.flush();
      assert.strictEqual(registry.isOwned("t1"), false);
      assert.strictEqual(memento.get(OWNED_TUNNELS_KEY), undefined);
      assert.deepStrictEqual(events.map((e) => e.type), ["error", "error"]);
      // The id is free again after a failed start
      await registry.start(request("t1"));
      assert.strictEqual(registry.isOwned("t1"), true);
    });

    test("reserve throws synchronously for a reserved or owned id, and release frees it", async () => {
      const release = registry.reserve("t1");
      assert.throws(() => registry.reserve("t1"), TunnelAlreadyRunningError);
      release();
      release(); // idempotent
      const again = registry.reserve("t1");
      again();

      await registry.start(request("t2"));
      assert.throws(() => registry.reserve("t2"), /already running or starting/);
      await assert.rejects(registry.start(request("t2")), TunnelAlreadyRunningError);
      assert.strictEqual(spawn.children.length, 1);
    });

    test("a second start while the first is in flight spawns once", async () => {
      const first = registry.start(request("t1"));
      await assert.rejects(registry.start(request("t1")), TunnelAlreadyRunningError);
      await first;
      assert.strictEqual(spawn.children.length, 1);
    });

    test("load discards malformed entries and warns without their contents", async () => {
      const good: OwnedTunnelRecord = {
        tunnelId: "good", pid: 101, startedAt: 1000, kind: "quick", target: "http://localhost:1",
      };
      await memento.update(OWNED_TUNNELS_KEY, [
        good,
        { tunnelId: "leaky-id-value", pid: -4, startedAt: 1, kind: "named", target: "x" },
        { tunnelId: "t", pid: 5, startedAt: 1, kind: "weird", target: "x" },
        { ...good, tunnelId: "extra", token: SECRET },
        "garbage",
        null,
      ]);
      const loaded = await registry.load();
      assert.deepStrictEqual(loaded.map((r) => r.tunnelId), ["good", "extra"]);
      assert.ok(!JSON.stringify(persisted()).includes(SECRET), "extra fields kept");
      assert.deepStrictEqual(persisted().map((r) => r.tunnelId), ["good", "extra"]);
      const warning = lines.find((l) => l.level === "warn");
      assert.ok(warning && /Discarded 4 malformed/.test(warning.message), "no warning");
      assert.ok(!lines.some((l) => l.message.includes("leaky-id-value") || l.message.includes(SECRET)));

      await memento.update(OWNED_TUNNELS_KEY, { not: "an array" });
      assert.deepStrictEqual(await registry.load(), []);
      assert.deepStrictEqual(persisted(), []);
    });
  });

  suite("stop and stopAll (3.1, 3.3, 3.4, 7.2, 7.3)", () => {
    test("not-owned sends no signal", async () => {
      const result = await registry.stop("nobody");
      assert.deepStrictEqual(result, { tunnelId: "nobody", outcome: "not-owned" });
      assert.strictEqual(kill.calls.length, 0);
    });

    test("SIGTERMs only the recorded pid and reports stopped", async () => {
      await registry.start(request("t1"));
      await registry.start(request("t2"));
      const pid = childFor("t1").pid;
      const result = await registry.stop("t1", 1000);
      await registry.flush();

      assert.strictEqual(result.outcome, "stopped");
      assert.deepStrictEqual(kill.calls, [{ pid, signal: "SIGTERM" }]);
      assert.strictEqual(registry.isOwned("t1"), false);
      assert.strictEqual(registry.isOwned("t2"), true);
      assert.deepStrictEqual(persisted().map((r) => r.tunnelId), ["t2"]);
    });

    test("force-kills a child that ignores SIGTERM", async () => {
      kill.ignore.add("SIGTERM");
      await registry.start(request("t1"));
      const result = await registry.stop("t1", 200);
      assert.strictEqual(result.outcome, "stopped");
      assert.deepStrictEqual(kill.calls.map((c) => c.signal), ["SIGTERM", "SIGKILL"]);
    });

    test("uses a plain kill on win32", async () => {
      registry.dispose();
      registry = makeRegistry({ platform: "win32" });
      await registry.start(request("t1"));
      const result = await registry.stop("t1", 500);
      assert.strictEqual(result.outcome, "stopped");
      assert.deepStrictEqual(kill.calls.map((c) => c.signal), [undefined]);
    });

    test("a kill error gives failed with the reason and keeps the record", async () => {
      await registry.start(request("t1"));
      kill.throwCode = "EPERM";
      const result = await registry.stop("t1", 200);
      await registry.flush();
      assert.deepStrictEqual(result, { tunnelId: "t1", outcome: "failed", reason: "kill-error: EPERM" });
      assert.strictEqual(registry.isOwned("t1"), true);
      assert.strictEqual(persisted().length, 1);
    });

    test("a child that survives SIGKILL stays recorded (7.3)", async () => {
      kill.ignore.add("SIGTERM");
      kill.ignore.add("SIGKILL");
      await registry.start(request("t1"));
      const result = await registry.stop("t1", 100);
      await registry.flush();
      assert.deepStrictEqual(result, { tunnelId: "t1", outcome: "failed", reason: "still-running-after-kill" });
      assert.strictEqual(persisted().length, 1);
    });

    test("stopAll stops every tunnel concurrently under one deadline", async () => {
      kill.ignore.add("SIGTERM");
      kill.ignore.add("SIGKILL");
      for (const id of ["a", "b", "c"]) {
        await registry.start(request(id));
      }
      const started = Date.now();
      const results = await registry.stopAll(300);
      const elapsed = Date.now() - started;
      await registry.flush();

      assert.ok(elapsed < 600, `stopAll took ${elapsed} ms, expected one 300 ms deadline, not three`);
      assert.deepStrictEqual(results.map((r) => r.outcome), ["failed", "failed", "failed"]);
      assert.strictEqual(persisted().length, 3, "unconfirmed records must stay persisted");
    });

    test("stopAll reports stopped for children that exit", async () => {
      for (const id of ["a", "b", "c"]) {
        await registry.start(request(id));
      }
      const results = await registry.stopAll(1000);
      await registry.flush();
      assert.deepStrictEqual(results.map((r) => r.outcome), ["stopped", "stopped", "stopped"]);
      assert.deepStrictEqual(persisted(), []);
    });
  });

  suite("reconcile and adopted records (2.1-2.4, 2.6, 3.2)", () => {
    const START = new Date(2026, 8, 24, 12, 0, 0).getTime();

    async function seed(...records: Array<Partial<OwnedTunnelRecord>>): Promise<void> {
      await memento.update(
        OWNED_TUNNELS_KEY,
        records.map((r, i) => ({
          tunnelId: `old-${i}`,
          pid: 500 + i,
          startedAt: START,
          kind: "named",
          target: "http://localhost:8080",
          ...r,
        })),
      );
    }

    test("a dead pid is dropped", async () => {
      await seed({ pid: 500 });
      probeAnswers.set(500, { state: "dead" });
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("old-0"), false);
      assert.deepStrictEqual(persisted(), []);
      assert.strictEqual(kill.calls.length, 0);
    });

    test("a pid reused by another program is dropped and never signalled", async () => {
      await seed({ pid: 500 });
      probeAnswers.set(500, { state: "alive", executable: "node", startTimeMs: START });
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("old-0"), false);
      assert.deepStrictEqual(persisted(), []);
      assert.deepStrictEqual(await registry.stop("old-0"), { tunnelId: "old-0", outcome: "not-owned" });
      assert.strictEqual(kill.calls.length, 0);
    });

    test("a pid reused by a later cloudflared is dropped and never signalled", async () => {
      await seed({ pid: 500 });
      probeAnswers.set(500, { state: "alive", executable: "cloudflared", startTimeMs: START + 60_000 });
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("old-0"), false);
      assert.deepStrictEqual(persisted(), []);
      assert.strictEqual(kill.calls.length, 0);
    });

    test("an inconclusive probe keeps no claim and sends no signal", async () => {
      await seed({ pid: 500 });
      probeAnswers.set(500, { state: "unknown" });
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("old-0"), false);
      assert.deepStrictEqual(persisted(), []);
      assert.strictEqual(kill.calls.length, 0);
      assert.ok(lines.some((l) => l.level === "warn" && l.message.includes("500")));
    });

    test("a verified record is adopted, then stopped after re-verification", async () => {
      await seed({ pid: 500, kind: "quick", tunnelId: "quick-8080-1" });
      probeAnswers.set(500, [
        { state: "alive", executable: "cloudflared.exe", startTimeMs: START + 900 }, // reconcile
        { state: "alive", executable: "cloudflared", startTimeMs: START + 900 }, // stop: re-verify
        { state: "dead" }, // stop: after SIGTERM
      ]);
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("quick-8080-1"), true);
      assert.strictEqual(registry.isAdopted("quick-8080-1"), true);
      assert.deepStrictEqual(events.map((e) => [e.type, e.adopted]), [["start", true]]);

      const result = await registry.stop("quick-8080-1", 500);
      await registry.flush();
      assert.strictEqual(result.outcome, "stopped");
      assert.deepStrictEqual(kill.calls, [{ pid: 500, signal: "SIGTERM" }]);
      assert.strictEqual(registry.isOwned("quick-8080-1"), false);
      assert.deepStrictEqual(persisted(), []);
    });

    test("an adopted record that fails re-verification at stop is not signalled", async () => {
      await seed({ pid: 500 });
      probeAnswers.set(500, [
        { state: "alive", executable: "cloudflared", startTimeMs: START },
        { state: "alive", executable: "bash", startTimeMs: START + 99_000 },
      ]);
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("old-0"), true);
      const result = await registry.stop("old-0", 500);
      assert.deepStrictEqual(result, { tunnelId: "old-0", outcome: "failed", reason: "identity-mismatch" });
      assert.strictEqual(kill.calls.length, 0);
      assert.strictEqual(registry.isOwned("old-0"), false);
    });

    test("an adopted record whose probe is inconclusive at stop is not signalled", async () => {
      await seed({ pid: 500 });
      probeAnswers.set(500, [
        { state: "alive", executable: "cloudflared", startTimeMs: START },
        { state: "unknown" },
      ]);
      await registry.reconcile();
      const result = await registry.stop("old-0", 300);
      assert.deepStrictEqual(result, { tunnelId: "old-0", outcome: "failed", reason: "identity-unverified" });
      assert.strictEqual(kill.calls.length, 0);
      assert.strictEqual(registry.isOwned("old-0"), true);
    });

    test("an adopted record that ignores SIGTERM is force-killed only while still verified", async () => {
      await seed({ pid: 500 });
      const alive: ProbeResult = { state: "alive", executable: "cloudflared", startTimeMs: START };
      const signalled: string[] = [];
      kill.kill = (pid, signal) => {
        kill.calls.push({ pid, signal });
        signalled.push(String(signal));
      };
      registry.dispose();
      registry = makeRegistry({
        probe: async (pid) => {
          probeCalls.push(pid);
          return signalled.includes("SIGKILL") ? { state: "dead" } : alive;
        },
      });
      await registry.reconcile();
      const result = await registry.stop("old-0", 200);
      assert.strictEqual(result.outcome, "stopped");
      assert.deepStrictEqual(kill.calls.map((c) => [c.pid, c.signal]), [[500, "SIGTERM"], [500, "SIGKILL"]]);
    });

    test("reconcile never throws, even when the probe does", async () => {
      await seed({ pid: 500 });
      registry.dispose();
      registry = makeRegistry({ probe: async () => { throw new Error("probe exploded"); } });
      await registry.reconcile();
      assert.strictEqual(registry.isOwned("old-0"), false);
      assert.strictEqual(kill.calls.length, 0);
    });

    test("records this session owns are left alone by reconcile", async () => {
      await registry.start(request("t1"));
      await registry.flush();
      await registry.reconcile();
      await tick();
      assert.strictEqual(registry.isOwned("t1"), true);
      assert.strictEqual(persisted().length, 1);
      assert.ok(!probeCalls.includes(childFor("t1").pid!), "own child probed");
      await wait(1);
    });
  });
});

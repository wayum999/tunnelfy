import * as assert from "assert";
import * as path from "path";
// The raw module object, so the wrapper sees every spawn made through child_process
import childProcess = require("child_process");

/**
 * The default test run must never start a real cloudflared tunnel (12.2). This file wraps
 * child_process.spawn for the whole run and fails the run's final hook if any spawn of a
 * cloudflared executable with a `tunnel` subcommand happened. Real-tunnel tests are opt-in
 * through TUNNELFY_NETWORK_TESTS=1, which disables the check.
 */
const tunnelSpawns: string[] = [];
const originalSpawn = childProcess.spawn;
const networkTestsEnabled = process.env.TUNNELFY_NETWORK_TESTS === "1";

function isCloudflaredTunnel(command: unknown, args: unknown): boolean {
  return (
    /^cloudflared(\.exe)?$/i.test(path.basename(String(command))) &&
    Array.isArray(args) &&
    args[0] === "tunnel"
  );
}

suiteSetup(() => {
  (childProcess as any).spawn = function (this: unknown, command: unknown, args: unknown, ...rest: unknown[]) {
    if (isCloudflaredTunnel(command, args)) {
      tunnelSpawns.push(`${path.basename(String(command))} ${(args as string[]).join(" ")}`);
    }
    return (originalSpawn as any).call(this, command, args, ...rest);
  };
});

suiteTeardown(() => {
  (childProcess as any).spawn = originalSpawn;
  if (!networkTestsEnabled) {
    assert.deepStrictEqual(tunnelSpawns, [], "the default test run started a real cloudflared tunnel");
  }
});

suite("Offline guard", () => {
  test("the guard records a cloudflared tunnel spawn", async () => {
    const before = tunnelSpawns.length;
    // A path that cannot exist, so nothing actually runs
    const child = childProcess.spawn(path.join(__dirname, "no-such-dir", "cloudflared"), ["tunnel", "--help"]);
    await new Promise<void>((resolve) => {
      child.once("error", () => resolve());
      child.once("spawn", () => resolve());
    });
    assert.strictEqual(tunnelSpawns.length, before + 1, "guard did not see the spawn");
    tunnelSpawns.splice(before, 1);
  });
});

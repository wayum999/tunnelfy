import * as assert from "assert";
import * as cp from "child_process";
import {
  ExecFileFn,
  probe,
  parsePsOutput,
  parseCimOutput,
} from "../../services/cloudflared/processIdentity";

interface RecordedCall {
  file: string;
  args: string[];
  options: cp.ExecFileOptions;
}

/** A stub execFile that records its calls and answers with a canned result. */
function fakeExecFile(
  answer: { error?: Partial<cp.ExecFileException> | null; stdout?: string },
  calls: RecordedCall[],
): ExecFileFn {
  return (file, args, options, callback) => {
    calls.push({ file, args, options });
    const error = answer.error
      ? Object.assign(new Error("probe failed"), answer.error)
      : null;
    setImmediate(() => callback(error as cp.ExecFileException | null, answer.stdout ?? "", ""));
  };
}

function assertSafeCalls(calls: RecordedCall[]): void {
  assert.ok(calls.length > 0, "probe never ran a command");
  for (const call of calls) {
    assert.ok(!/wmic/i.test(call.file), `wmic used: ${call.file}`);
    assert.ok(!call.args.some((arg) => /wmic/i.test(arg)), "wmic used in args");
    assert.notStrictEqual(call.options.shell, true, "probe ran through a shell");
  }
}

suite("processIdentity Test Suite", () => {
  for (const platform of ["darwin", "linux"] as NodeJS.Platform[]) {
    suite(`POSIX (${platform})`, () => {
      test("alive: parses executable basename and start time", async () => {
        const calls: RecordedCall[] = [];
        const result = await probe(4321, {
          platform,
          execFile: fakeExecFile(
            { stdout: "Thu Sep 24 21:18:53 2026 /usr/local/bin/cloudflared\n" },
            calls,
          ),
        });
        assert.strictEqual(result.state, "alive");
        assert.strictEqual(result.executable, "cloudflared");
        assert.strictEqual(result.startTimeMs, new Date(2026, 8, 24, 21, 18, 53).getTime());
        assert.strictEqual(calls[0].file, "ps");
        assert.deepStrictEqual(calls[0].args, ["-o", "lstart=", "-o", "comm=", "-p", "4321"]);
        assertSafeCalls(calls);
      });

      test("dead: exit 1 with no output", async () => {
        const calls: RecordedCall[] = [];
        const result = await probe(4321, {
          platform,
          execFile: fakeExecFile({ error: { code: 1 }, stdout: "" }, calls),
        });
        assert.strictEqual(result.state, "dead");
        assertSafeCalls(calls);
      });

      test("garbage output is unknown", async () => {
        const calls: RecordedCall[] = [];
        const result = await probe(4321, {
          platform,
          execFile: fakeExecFile({ stdout: "not a ps line at all\n" }, calls),
        });
        assert.strictEqual(result.state, "unknown");
        assertSafeCalls(calls);
      });

      test("timeout is unknown", async () => {
        const calls: RecordedCall[] = [];
        const result = await probe(4321, {
          platform,
          timeoutMs: 50,
          execFile: fakeExecFile({ error: { killed: true, signal: "SIGTERM" } }, calls),
        });
        assert.strictEqual(result.state, "unknown");
        assert.strictEqual(calls[0].options.timeout, 50);
        assertSafeCalls(calls);
      });

      test("a missing ps binary is unknown, not dead", async () => {
        const calls: RecordedCall[] = [];
        const result = await probe(4321, {
          platform,
          execFile: fakeExecFile({ error: { code: "ENOENT" as unknown as number } }, calls),
        });
        assert.strictEqual(result.state, "unknown");
      });
    });
  }

  suite("Windows (win32)", () => {
    test("alive: PowerShell 5.1 /Date()/ format", async () => {
      const calls: RecordedCall[] = [];
      const result = await probe(77, {
        platform: "win32",
        execFile: fakeExecFile(
          { stdout: '{"Name":"cloudflared.exe","CreationDate":"\\/Date(1790000000123)\\/"}' },
          calls,
        ),
      });
      assert.strictEqual(result.state, "alive");
      assert.strictEqual(result.executable, "cloudflared.exe");
      assert.strictEqual(result.startTimeMs, 1790000000123);
      assert.strictEqual(calls[0].file, "powershell.exe");
      assert.ok(calls[0].args.includes("-NoProfile"));
      assert.ok(calls[0].args.includes("-NonInteractive"));
      const command = calls[0].args[calls[0].args.length - 1];
      assert.ok(command.includes("Get-CimInstance Win32_Process"));
      assert.ok(command.includes('"ProcessId=77"'));
      assertSafeCalls(calls);
    });

    test("alive: PowerShell 7 ISO format and wrapped value", () => {
      const iso = parseCimOutput('{"Name":"cloudflared.exe","CreationDate":"2026-09-24T21:18:53.5+00:00"}');
      assert.strictEqual(iso.state, "alive");
      assert.strictEqual(iso.startTimeMs, Date.parse("2026-09-24T21:18:53.5Z"));
      const wrapped = parseCimOutput(
        '{"Name":"cloudflared.exe","CreationDate":{"value":"\\/Date(1790000000000)\\/","DateTime":"x"}}',
      );
      assert.strictEqual(wrapped.startTimeMs, 1790000000000);
    });

    test("dead: empty output", async () => {
      const calls: RecordedCall[] = [];
      const result = await probe(77, {
        platform: "win32",
        execFile: fakeExecFile({ stdout: "\r\n" }, calls),
      });
      assert.strictEqual(result.state, "dead");
      assertSafeCalls(calls);
    });

    test("garbage and timeout are unknown", async () => {
      const calls: RecordedCall[] = [];
      const garbage = await probe(77, {
        platform: "win32",
        execFile: fakeExecFile({ stdout: "{not json" }, calls),
      });
      assert.strictEqual(garbage.state, "unknown");
      const timedOut = await probe(77, {
        platform: "win32",
        execFile: fakeExecFile({ error: { killed: true } }, calls),
      });
      assert.strictEqual(timedOut.state, "unknown");
      assertSafeCalls(calls);
    });
  });

  test("non-integer or non-positive pids never reach a command", async () => {
    const calls: RecordedCall[] = [];
    const execFile = fakeExecFile({ stdout: "" }, calls);
    for (const pid of [0, -1, 1.5, NaN, Infinity, "12; rm" as unknown as number]) {
      for (const platform of ["linux", "win32"] as NodeJS.Platform[]) {
        const result = await probe(pid, { platform, execFile });
        assert.strictEqual(result.state, "unknown", `pid ${pid} on ${platform}`);
      }
    }
    assert.strictEqual(calls.length, 0, "a command ran for an invalid pid");
  });

  test("parsePsOutput rejects an unknown month", () => {
    assert.strictEqual(parsePsOutput("Thu Foo 24 21:18:53 2026 cloudflared").state, "unknown");
  });
});

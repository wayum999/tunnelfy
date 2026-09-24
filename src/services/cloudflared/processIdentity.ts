import * as cp from "child_process";

/**
 * What the operating system says about a pid.
 * - `alive`: a process with this pid exists; `executable` and `startTimeMs` describe it
 * - `dead`: no process has this pid
 * - `unknown`: the probe could not decide (command failed, timed out or printed something unparseable)
 */
export type ProbeResult =
  | {
      state: "alive";
      /** Executable basename, e.g. `cloudflared` or `cloudflared.exe` */
      executable: string;
      /** OS-reported process start time, epoch milliseconds */
      startTimeMs: number;
    }
  | { state: "dead" }
  | { state: "unknown" };

export type ExecFileFn = (
  file: string,
  args: string[],
  options: cp.ExecFileOptions,
  callback: (error: cp.ExecFileException | null, stdout: string, stderr: string) => void,
) => void;

export interface ProbeOptions {
  platform?: NodeJS.Platform;
  execFile?: ExecFileFn;
  timeoutMs?: number;
}

export type ProbeFn = (pid: number, opts?: ProbeOptions) => Promise<ProbeResult>;

export const DEFAULT_PROBE_TIMEOUT_MS = 5000;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** A pid is only ever passed to a probe command after this check. */
export function isValidPid(pid: unknown): pid is number {
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0;
}

function basename(executable: string): string {
  const parts = executable.split(/[\\/]/);
  return parts[parts.length - 1];
}

/**
 * Parses one line of `ps -o lstart= -o comm=` output (run under LC_ALL=C), e.g.
 * `Thu Sep 24 21:18:53 2026 /usr/local/bin/cloudflared`. lstart is local time.
 */
export function parsePsOutput(stdout: string): ProbeResult {
  const line = stdout.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) {
    return { state: "dead" };
  }
  const match = line.match(
    /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})\s+(.+)$/,
  );
  if (!match || MONTHS[match[1]] === undefined) {
    return { state: "unknown" };
  }
  const [, month, day, hours, minutes, seconds, year, command] = match;
  const startTimeMs = new Date(
    Number(year),
    MONTHS[month],
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  ).getTime();
  if (!Number.isFinite(startTimeMs)) {
    return { state: "unknown" };
  }
  return { state: "alive", executable: basename(command.trim()), startTimeMs };
}

function parseCimDate(value: unknown): number | undefined {
  // Windows PowerShell 5.1 serialises DateTime as "\/Date(<ms>)\/", sometimes wrapped
  // in an object with a `value` property; PowerShell 7 uses an ISO 8601 string.
  if (value && typeof value === "object" && "value" in value) {
    return parseCimDate((value as { value: unknown }).value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const legacy = value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (legacy) {
    return Number(legacy[1]);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parses `Get-CimInstance Win32_Process ... | Select-Object Name,CreationDate | ConvertTo-Json -Compress`.
 */
export function parseCimOutput(stdout: string): ProbeResult {
  const text = stdout.trim();
  if (!text) {
    return { state: "dead" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "unknown" };
  }
  const entry = Array.isArray(parsed) ? (parsed.length === 1 ? parsed[0] : undefined) : parsed;
  if (!entry || typeof entry !== "object") {
    return { state: "unknown" };
  }
  const { Name, CreationDate } = entry as { Name?: unknown; CreationDate?: unknown };
  const startTimeMs = parseCimDate(CreationDate);
  if (typeof Name !== "string" || !Name || startTimeMs === undefined) {
    return { state: "unknown" };
  }
  return { state: "alive", executable: basename(Name), startTimeMs };
}

function run(
  execFile: ExecFileFn,
  file: string,
  args: string[],
  options: cp.ExecFileOptions,
): Promise<{ error: cp.ExecFileException | null; stdout: string }> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, options, (error, stdout) => {
        resolve({ error, stdout: String(stdout ?? "") });
      });
    } catch (error) {
      resolve({ error: error as cp.ExecFileException, stdout: "" });
    }
  });
}

/**
 * Reports whether `pid` is alive, which executable it is, and when it started.
 * Runs the probe command with execFile (never a shell) and never uses `wmic`,
 * which recent Windows 11 builds no longer ship. It never signals the process.
 */
export async function probe(pid: number, opts: ProbeOptions = {}): Promise<ProbeResult> {
  if (!isValidPid(pid)) {
    return { state: "unknown" };
  }
  const platform = opts.platform ?? process.platform;
  const execFile: ExecFileFn = opts.execFile ?? (cp.execFile as unknown as ExecFileFn);
  const timeout = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  if (platform === "win32") {
    const command =
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | ` +
      "Select-Object Name,CreationDate | ConvertTo-Json -Compress";
    const { error, stdout } = await run(
      execFile,
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { timeout, windowsHide: true, shell: false },
    );
    if (error) {
      return { state: "unknown" };
    }
    return parseCimOutput(stdout);
  }

  const { error, stdout } = await run(
    execFile,
    "ps",
    ["-o", "lstart=", "-o", "comm=", "-p", String(pid)],
    { timeout, shell: false, env: { ...process.env, LC_ALL: "C" } },
  );
  if (error) {
    // ps exits 1 with no output when no process has the pid; anything else is inconclusive
    if (error.code === 1 && !error.killed && stdout.trim() === "") {
      return { state: "dead" };
    }
    return { state: "unknown" };
  }
  const result = parsePsOutput(stdout);
  // ps succeeding with no output is not a clean "no such process" signal
  return result.state === "dead" ? { state: "unknown" } : result;
}

import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as cp from "child_process";
import { Logger, LogComponent } from "../../utils/logger";

/**
 * Test doubles for cloudflared children: a fake ChildProcess, a spawn that hands them out,
 * and a kill that records signals. No real process is ever started or signalled.
 */
export class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  spawnargs: string[];

  constructor(
    public pid: number | undefined,
    public command: string,
    public args: string[],
    public options: cp.SpawnOptions,
  ) {
    super();
    this.spawnargs = [command, ...args];
  }

  /** Emits spawn on the next tick, as a real child does. */
  spawnSoon(): this {
    setImmediate(() => this.emit("spawn"));
    return this;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) {
      return;
    }
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  write(text: string, source: "stdout" | "stderr" = "stdout"): void {
    (source === "stdout" ? this.stdout : this.stderr).emit("data", Buffer.from(text));
  }
}

export type ChildBehaviour = "spawn" | "error" | "no-pid" | "throw";

export interface FakeSpawn {
  spawn: (command: string, args: string[], options: cp.SpawnOptions) => cp.ChildProcess;
  children: FakeChild[];
  /** Behaviour of the next spawned children, consumed in order; default "spawn" */
  queue: ChildBehaviour[];
}

export function createFakeSpawn(firstPid = 40000): FakeSpawn {
  let nextPid = firstPid;
  const fake: FakeSpawn = {
    children: [],
    queue: [],
    spawn: (command, args, options) => {
      const behaviour = fake.queue.shift() ?? "spawn";
      if (behaviour === "throw") {
        throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
      }
      const child = new FakeChild(behaviour === "no-pid" ? undefined : nextPid++, command, args, options);
      fake.children.push(child);
      if (behaviour === "error") {
        setImmediate(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
      } else {
        child.spawnSoon();
      }
      return child as unknown as cp.ChildProcess;
    },
  };
  return fake;
}

export interface KillCall {
  pid: number;
  signal?: NodeJS.Signals | number;
}

export interface FakeKill {
  kill: (pid: number, signal?: NodeJS.Signals | number) => void;
  calls: KillCall[];
  /** Signals the children ignore (e.g. SIGTERM); an ignored signal is recorded but has no effect */
  ignore: Set<string>;
  /** Error code thrown for every call, e.g. "EPERM" */
  throwCode?: string;
}

/** A kill that records every call and makes the matching fake child exit. */
export function createFakeKill(children: () => FakeChild[]): FakeKill {
  const fake: FakeKill = {
    calls: [],
    ignore: new Set(),
    kill: (pid, signal) => {
      fake.calls.push({ pid, signal });
      if (fake.throwCode) {
        throw Object.assign(new Error(`kill ${fake.throwCode}`), { code: fake.throwCode });
      }
      const name = String(signal ?? "SIGTERM");
      if (fake.ignore.has(name)) {
        return;
      }
      const child = children().find((c) => c.pid === pid);
      if (child) {
        setImmediate(() => child.exit(null, name as NodeJS.Signals));
      }
    },
  };
  return fake;
}

export interface LoggedLine {
  level: string;
  component: LogComponent;
  message: string;
}

export function createRecordingLogger(): { logger: Logger; lines: LoggedLine[] } {
  const lines: LoggedLine[] = [];
  const record = (level: string) => (component: LogComponent, message: string) => {
    lines.push({ level, component, message });
  };
  const logger = {
    info: record("info"),
    error: record("error"),
    debug: record("debug"),
    warn: record("warn"),
  } as unknown as Logger;
  return { logger, lines };
}

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

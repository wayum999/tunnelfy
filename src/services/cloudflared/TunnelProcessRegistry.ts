import * as vscode from "vscode";
import * as cp from "child_process";
import { Logger, LogComponent } from "../../utils/logger";
import {
  probe as defaultProbe,
  ProbeFn,
  DEFAULT_PROBE_TIMEOUT_MS,
  isValidPid,
} from "./processIdentity";

/** globalState key holding the array of OwnedTunnelRecord */
export const OWNED_TUNNELS_KEY = "tunnelfy.ownedTunnels";

export const DEFAULT_STOP_TIMEOUT_MS = 3000;
export const DEFAULT_START_TIME_TOLERANCE_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 200;
/** Share of a stop's budget spent waiting for a graceful exit before force-killing */
const GRACEFUL_SHARE = 0.6;
const CLOUDFLARED_EXECUTABLE = /^cloudflared(\.exe)?$/i;

export type TunnelKind = "named" | "quick";

/** What is persisted per owned tunnel. Never holds a token or any other credential. */
export interface OwnedTunnelRecord {
  /** Cloudflare tunnel id, or quick-<port>-<ms> */
  tunnelId: string;
  /** Positive integer pid from the child's spawn event */
  pid: number;
  /** Epoch ms taken when the spawn event fired */
  startedAt: number;
  kind: TunnelKind;
  /** Local origin, e.g. http://localhost:8080 */
  target: string;
}

/** A child this session spawned: the registry holds its ChildProcess */
export interface SpawnedTunnel {
  record: OwnedTunnelRecord;
  adopted: false;
  child: cp.ChildProcess;
}

/** A record adopted from an earlier session: verified by identity, with no child handle */
export interface AdoptedTunnel {
  record: OwnedTunnelRecord;
  adopted: true;
}

export type OwnedTunnel = SpawnedTunnel | AdoptedTunnel;

/** Why a stop failed; Messages.describeStopFailure explains each to the user */
export type StopFailureReason =
  | "identity-mismatch"
  | "identity-unverified"
  | "still-running-after-kill"
  | "timeout"
  | `kill-error: ${string}`
  | `error: ${string}`;

export interface StopResult {
  tunnelId: string;
  outcome: "stopped" | "not-owned" | "failed";
  /** Set when outcome is "failed" */
  reason?: StopFailureReason;
}

export type RegistryEvent =
  | {
      type: "start" | "stop";
      tunnelId: string;
      message: string;
      kind: TunnelKind;
      adopted: boolean;
    }
  | {
      type: "error";
      tunnelId: string;
      message: string;
      kind?: TunnelKind;
    };

export interface StartRequest {
  tunnelId: string;
  kind: TunnelKind;
  target: string;
  command: string;
  args: string[];
  /** Passed to the child only; never stored or logged */
  env?: NodeJS.ProcessEnv;
  onOutput(chunk: string, source: "stdout" | "stderr"): void;
  onExit?(code: number | null, signal: NodeJS.Signals | null): void;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: cp.SpawnOptions,
) => cp.ChildProcess;
export type KillFn = (pid: number, signal?: NodeJS.Signals | number) => void;

export class TunnelAlreadyRunningError extends Error {
  constructor(tunnelId: string) {
    super(`Tunnel ${tunnelId} is already running or starting`);
    this.name = "TunnelAlreadyRunningError";
  }
}

export interface TunnelProcessRegistryOptions {
  memento: vscode.Memento;
  logger: Logger;
  spawn?: SpawnFn;
  probe?: ProbeFn;
  kill?: KillFn;
  now?: () => number;
  platform?: NodeJS.Platform;
  startTimeToleranceMs?: number;
  pollIntervalMs?: number;
  probeTimeoutMs?: number;
}

/** A spawned entry also carries a promise that resolves when its child exits */
type SpawnedEntry = SpawnedTunnel & { exited: Promise<void> };
type OwnedEntry = SpawnedEntry | AdoptedTunnel;

type Verification = "verified" | "dead" | "mismatch" | "unknown";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

function isOwnedTunnelRecord(value: unknown): value is OwnedTunnelRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.tunnelId === "string" &&
    r.tunnelId.length > 0 &&
    isValidPid(r.pid) &&
    typeof r.startedAt === "number" &&
    Number.isFinite(r.startedAt) &&
    r.startedAt > 0 &&
    (r.kind === "named" || r.kind === "quick") &&
    typeof r.target === "string"
  );
}

/** Copies only the five record fields, so nothing else can ride along into globalState. */
function toRecord(r: OwnedTunnelRecord): OwnedTunnelRecord {
  return { tunnelId: r.tunnelId, pid: r.pid, startedAt: r.startedAt, kind: r.kind, target: r.target };
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code ?? (error instanceof Error ? error.message : String(error));
}

/**
 * TunnelProcessRegistry - the single owner of every cloudflared child the extension spawns.
 *
 * It spawns the child, records { tunnelId, pid, startedAt, kind, target } in memory and in
 * globalState once the child has really started, removes the record when the child exits,
 * reconciles persisted records against live processes on activate, and stops a tunnel only
 * by its recorded pid after checking that the pid still belongs to that child. It never
 * looks up or signals a process by name, command line or port.
 */
export class TunnelProcessRegistry implements vscode.Disposable {
  private readonly owned = new Map<string, OwnedEntry>();
  private readonly reservations = new Set<string>();
  private readonly starting = new Set<string>();
  private readonly stopping = new Map<string, Promise<StopResult>>();
  private persistChain: Promise<void> = Promise.resolve();

  private readonly _onDidChange = new vscode.EventEmitter<RegistryEvent>();
  readonly onDidChange = this._onDidChange.event;

  private readonly memento: vscode.Memento;
  private readonly logger: Logger;
  private readonly spawnFn: SpawnFn;
  private readonly probeFn: ProbeFn;
  private readonly killFn: KillFn;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly startTimeToleranceMs: number;
  private readonly pollIntervalMs: number;
  private readonly probeTimeoutMs: number;

  constructor(options: TunnelProcessRegistryOptions) {
    this.memento = options.memento;
    this.logger = options.logger;
    // Resolved at call time so a stubbed child_process.spawn is honoured
    this.spawnFn = options.spawn ?? ((command, args, spawnOptions) => cp.spawn(command, args, spawnOptions));
    this.probeFn = options.probe ?? defaultProbe;
    this.killFn = options.kill ?? ((pid, signal) => { process.kill(pid, signal); });
    this.now = options.now ?? Date.now;
    this.platform = options.platform ?? process.platform;
    this.startTimeToleranceMs = options.startTimeToleranceMs ?? DEFAULT_START_TIME_TOLERANCE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  /**
   * Reserves a tunnel id for a start that is about to happen. Synchronous, so a caller can
   * take it before its first await.
   * @returns a release function (idempotent)
   * @throws TunnelAlreadyRunningError if the id is reserved, starting or owned
   */
  reserve(tunnelId: string): () => void {
    if (this.reservations.has(tunnelId) || this.starting.has(tunnelId) || this.owned.has(tunnelId)) {
      throw new TunnelAlreadyRunningError(tunnelId);
    }
    this.reservations.add(tunnelId);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.reservations.delete(tunnelId);
      }
    };
  }

  /**
   * Spawns a cloudflared child and records it once the child has really started.
   * Resolves on the child's spawn event with a valid pid. Rejects, recording nothing,
   * when spawn throws, the child emits error first, or no pid is available.
   */
  async start(req: StartRequest): Promise<SpawnedTunnel> {
    const { tunnelId } = req;
    if (this.starting.has(tunnelId) || this.owned.has(tunnelId)) {
      throw new TunnelAlreadyRunningError(tunnelId);
    }
    this.starting.add(tunnelId);
    try {
      let child: cp.ChildProcess;
      try {
        child = this.spawnFn(req.command, req.args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: req.env,
          windowsHide: true,
        });
      } catch (error) {
        throw this.startFailed(tunnelId, error);
      }

      let resolveExited!: () => void;
      const exited = new Promise<void>((resolve) => { resolveExited = resolve; });

      const forward = (source: "stdout" | "stderr") => (data: Buffer | string) => {
        try {
          req.onOutput(data.toString(), source);
        } catch (error) {
          this.logger.warn(LogComponent.TUNNEL, `Output handler failed for tunnel ${tunnelId}: ${errorCode(error)}`);
        }
      };
      child.stdout?.on("data", forward("stdout"));
      child.stderr?.on("data", forward("stderr"));

      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => { detach(); resolve(); };
        const onError = (error: Error) => { detach(); reject(error); };
        const detach = () => {
          child.off("spawn", onSpawn);
          child.off("error", onError);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
      }).catch((error) => {
        throw this.startFailed(tunnelId, error);
      });

      const pid = child.pid;
      if (!isValidPid(pid)) {
        throw this.startFailed(tunnelId, new Error("cloudflared started without a pid"));
      }

      const record: OwnedTunnelRecord = {
        tunnelId,
        pid,
        startedAt: this.now(),
        kind: req.kind,
        target: req.target,
      };
      const entry: SpawnedEntry = { record, child, adopted: false, exited };
      this.owned.set(tunnelId, entry);

      child.on("error", (error) => {
        this.logger.error(LogComponent.TUNNEL, `Tunnel ${tunnelId} process error: ${error.message}`);
        this._onDidChange.fire({ type: "error", tunnelId, message: error.message, kind: req.kind });
      });
      child.once("exit", (code, signal) => {
        resolveExited();
        this.logger.info(
          LogComponent.TUNNEL,
          `Tunnel ${tunnelId} (pid ${pid}) exited with code ${code}, signal ${signal}`,
        );
        if (this.owned.get(tunnelId) === entry) {
          this.release(entry, "Tunnel stopped");
        }
        try {
          req.onExit?.(code, signal);
        } catch (error) {
          this.logger.warn(LogComponent.TUNNEL, `Exit handler failed for tunnel ${tunnelId}: ${errorCode(error)}`);
        }
      });
      // The child can exit between the spawn event and these listeners
      if (typeof child.exitCode === "number" || typeof child.signalCode === "string") {
        child.emit("exit", child.exitCode, child.signalCode);
      }

      if (this.owned.get(tunnelId) === entry) {
        void this.persist((records) => [
          ...records.filter((r) => r.tunnelId !== tunnelId),
          toRecord(record),
        ]);
        this.logger.info(LogComponent.TUNNEL, `Tunnel ${tunnelId} started (pid ${pid})`);
        this._onDidChange.fire({
          type: "start",
          tunnelId,
          message: `Tunnel started for ${req.target}`,
          kind: req.kind,
          adopted: false,
        });
      }
      return { record, child, adopted: false };
    } finally {
      this.starting.delete(tunnelId);
    }
  }

  private startFailed(tunnelId: string, error: unknown): Error {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(LogComponent.TUNNEL, `Failed to start cloudflared for tunnel ${tunnelId}: ${err.message}`);
    this._onDidChange.fire({ type: "error", tunnelId, message: err.message });
    return err;
  }

  /** Removes an owned entry from memory and globalState and announces the stop. */
  private release(entry: OwnedEntry, message: string): void {
    const { tunnelId, pid } = entry.record;
    if (this.owned.get(tunnelId) !== entry) {
      return;
    }
    this.owned.delete(tunnelId);
    void this.persist((records) => records.filter((r) => !(r.tunnelId === tunnelId && r.pid === pid)));
    this._onDidChange.fire({ type: "stop", tunnelId, message, kind: entry.record.kind, adopted: entry.adopted });
  }

  isOwned(tunnelId: string): boolean {
    return this.owned.has(tunnelId);
  }

  isAdopted(tunnelId: string): boolean {
    return this.owned.get(tunnelId)?.adopted ?? false;
  }

  list(kind?: TunnelKind): OwnedTunnelRecord[] {
    return Array.from(this.owned.values())
      .map((entry) => entry.record)
      .filter((record) => !kind || record.kind === kind)
      .map(toRecord);
  }

  /**
   * Stops an owned tunnel by its recorded pid: graceful termination, a bounded wait,
   * then a force-kill only while the process is still the verified child.
   * @param timeoutMs total budget for the stop
   */
  stop(tunnelId: string, timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS): Promise<StopResult> {
    const entry = this.owned.get(tunnelId);
    if (!entry) {
      return Promise.resolve({ tunnelId, outcome: "not-owned" });
    }
    const inFlight = this.stopping.get(tunnelId);
    if (inFlight) {
      return inFlight;
    }
    const deadline = this.now() + Math.max(0, timeoutMs);
    const stopping = (entry.adopted ? this.stopAdopted(entry, deadline) : this.stopSpawned(entry, deadline))
      .catch((error): StopResult => ({ tunnelId, outcome: "failed", reason: `error: ${errorCode(error)}` }))
      .then((result) => {
        this.logger.info(
          LogComponent.TUNNEL,
          `Stop tunnel ${tunnelId} (pid ${entry.record.pid}): ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`,
        );
        return result;
      })
      .finally(() => this.stopping.delete(tunnelId));
    this.stopping.set(tunnelId, stopping);
    return stopping;
  }

  /**
   * Stops every owned tunnel concurrently under one shared deadline. Records whose exit
   * was not confirmed stay persisted for the next reconcile.
   */
  async stopAll(timeoutMs: number): Promise<StopResult[]> {
    const ids = Array.from(this.owned.keys());
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
    });
    try {
      return await Promise.all(
        ids.map(async (tunnelId): Promise<StopResult> => {
          const result = await Promise.race([this.stop(tunnelId, timeoutMs), expired]);
          return result === "timeout" ? { tunnelId, outcome: "failed", reason: "timeout" } : result;
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private signal(pid: number, force: boolean): { ok: true } | { ok: false; code: string } {
    try {
      if (this.platform === "win32") {
        this.killFn(pid, force ? "SIGKILL" : undefined);
      } else {
        this.killFn(pid, force ? "SIGKILL" : "SIGTERM");
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, code: errorCode(error) };
    }
  }

  private async waitForExit(exited: Promise<void>, deadline: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, deadline - this.now()));
    });
    try {
      return await Promise.race([exited.then(() => true), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async stopSpawned(entry: SpawnedEntry, deadline: number): Promise<StopResult> {
    const { tunnelId, pid } = entry.record;
    const { exited } = entry;
    const graceDeadline = this.now() + (deadline - this.now()) * GRACEFUL_SHARE;

    const term = this.signal(pid, false);
    if (!term.ok && term.code !== "ESRCH") {
      return { tunnelId, outcome: "failed", reason: `kill-error: ${term.code}` };
    }
    if (await this.waitForExit(exited, graceDeadline)) {
      return { tunnelId, outcome: "stopped" };
    }
    // No exit event yet, so the pid still belongs to the child this session spawned
    const kill = this.signal(pid, true);
    if (!kill.ok && kill.code !== "ESRCH") {
      return { tunnelId, outcome: "failed", reason: `kill-error: ${kill.code}` };
    }
    if (await this.waitForExit(exited, deadline)) {
      return { tunnelId, outcome: "stopped" };
    }
    return { tunnelId, outcome: "failed", reason: "still-running-after-kill" };
  }

  private async stopAdopted(entry: AdoptedTunnel, deadline: number): Promise<StopResult> {
    const { tunnelId, pid } = entry.record;
    const identity = await this.verify(entry.record, deadline);
    if (identity === "dead") {
      this.release(entry, "Tunnel stopped");
      return { tunnelId, outcome: "stopped" };
    }
    if (identity === "mismatch") {
      this.logger.warn(LogComponent.TUNNEL, `Pid ${pid} is no longer tunnel ${tunnelId}; not signalling it`);
      this.release(entry, "Tunnel process is gone");
      return { tunnelId, outcome: "failed", reason: "identity-mismatch" };
    }
    if (identity === "unknown") {
      return { tunnelId, outcome: "failed", reason: "identity-unverified" };
    }

    const term = this.signal(pid, false);
    if (!term.ok && term.code !== "ESRCH") {
      return { tunnelId, outcome: "failed", reason: `kill-error: ${term.code}` };
    }
    const graceDeadline = this.now() + (deadline - this.now()) * GRACEFUL_SHARE;
    let state = await this.pollUntilGone(entry.record, graceDeadline);
    if (state === "gone") {
      this.release(entry, "Tunnel stopped");
      return { tunnelId, outcome: "stopped" };
    }
    // Force-kill only a process that is, right now, still the verified child
    if (state !== "verified") {
      return { tunnelId, outcome: "failed", reason: "identity-unverified" };
    }
    const kill = this.signal(pid, true);
    if (!kill.ok && kill.code !== "ESRCH") {
      return { tunnelId, outcome: "failed", reason: `kill-error: ${kill.code}` };
    }
    state = await this.pollUntilGone(entry.record, deadline);
    if (state === "gone") {
      this.release(entry, "Tunnel stopped");
      return { tunnelId, outcome: "stopped" };
    }
    return { tunnelId, outcome: "failed", reason: "still-running-after-kill" };
  }

  /** Polls the probe until the recorded process is gone or the deadline passes. */
  private async pollUntilGone(
    record: OwnedTunnelRecord,
    deadline: number,
  ): Promise<"gone" | "verified" | "unknown"> {
    let last: Verification = "unknown";
    do {
      last = await this.verify(record, deadline);
      if (last === "dead" || last === "mismatch") {
        return "gone";
      }
      if (this.now() >= deadline) {
        break;
      }
      await sleep(Math.min(this.pollIntervalMs, deadline - this.now()));
    } while (this.now() < deadline);
    return last === "verified" ? "verified" : "unknown";
  }

  /**
   * Checks that the recorded pid is still the child that was recorded: alive, a cloudflared
   * executable, and started within the tolerance of the recorded start time.
   */
  private async verify(record: OwnedTunnelRecord, deadline?: number): Promise<Verification> {
    const timeoutMs =
      deadline === undefined
        ? this.probeTimeoutMs
        : Math.max(1, Math.min(this.probeTimeoutMs, deadline - this.now()));
    let result;
    try {
      result = await this.probeFn(record.pid, { timeoutMs });
    } catch {
      return "unknown";
    }
    if (result.state === "dead") {
      return "dead";
    }
    if (result.state !== "alive") {
      return "unknown";
    }
    if (!CLOUDFLARED_EXECUTABLE.test(result.executable)) {
      return "mismatch";
    }
    if (Math.abs(result.startTimeMs - record.startedAt) > this.startTimeToleranceMs) {
      return "mismatch";
    }
    return "verified";
  }

  /**
   * Checks every persisted record against the live process table. Verified records are
   * adopted (owned, running, stoppable); dead, reused or unverifiable pids are dropped
   * without ever being signalled. Never throws.
   */
  async reconcile(): Promise<void> {
    try {
      const records = (await this.load()).filter((r) => !this.owned.has(r.tunnelId));
      const checked = await Promise.all(
        records.map(async (record) => ({ record, identity: await this.verify(record) })),
      );
      const dropped: OwnedTunnelRecord[] = [];
      const adopted: AdoptedTunnel[] = [];
      for (const { record, identity } of checked) {
        if (identity === "verified" && !this.owned.has(record.tunnelId)) {
          const entry: AdoptedTunnel = { record, adopted: true };
          this.owned.set(record.tunnelId, entry);
          adopted.push(entry);
        } else {
          dropped.push(record);
          if (identity === "unknown") {
            this.logger.warn(LogComponent.TUNNEL, `Could not verify pid ${record.pid}; not claiming it`);
          } else {
            this.logger.info(LogComponent.TUNNEL, `Dropped owned-tunnel record for pid ${record.pid} (${identity})`);
          }
        }
      }
      if (dropped.length > 0) {
        await this.persist((current) =>
          current.filter((r) => !dropped.some((d) => d.tunnelId === r.tunnelId && d.pid === r.pid)),
        );
      }
      for (const entry of adopted) {
        this.logger.info(
          LogComponent.TUNNEL,
          `Adopted tunnel ${entry.record.tunnelId} (pid ${entry.record.pid}) from a previous session`,
        );
        this._onDidChange.fire({
          type: "start",
          tunnelId: entry.record.tunnelId,
          message: "Tunnel adopted from a previous session",
          kind: entry.record.kind,
          adopted: true,
        });
      }
    } catch (error) {
      this.logger.warn(LogComponent.TUNNEL, `Reconciling owned tunnels failed: ${errorCode(error)}`);
    }
  }

  /**
   * Reads the persisted records, discarding malformed entries (and rewriting the key
   * without them). The warning never includes record contents.
   */
  async load(): Promise<OwnedTunnelRecord[]> {
    const { valid, discarded } = this.readPersisted();
    if (discarded > 0) {
      this.logger.warn(LogComponent.TUNNEL, `Discarded ${discarded} malformed owned-tunnel record(s)`);
      await this.persist(() => valid);
    }
    return valid;
  }

  private readPersisted(): { valid: OwnedTunnelRecord[]; discarded: number } {
    const value = this.memento.get<unknown>(OWNED_TUNNELS_KEY);
    if (value === undefined || value === null) {
      return { valid: [], discarded: 0 };
    }
    if (!Array.isArray(value)) {
      return { valid: [], discarded: 1 };
    }
    const valid = value.filter(isOwnedTunnelRecord).map(toRecord);
    return { valid, discarded: value.length - valid.length };
  }

  /**
   * Serialised read-modify-write of the persisted records, so records written by
   * another window sharing globalState are not overwritten wholesale.
   */
  private persist(mutate: (records: OwnedTunnelRecord[]) => OwnedTunnelRecord[]): Promise<void> {
    this.persistChain = this.persistChain
      .then(async () => {
        const next = mutate(this.readPersisted().valid).map(toRecord);
        await this.memento.update(OWNED_TUNNELS_KEY, next);
      })
      .catch((error) => {
        this.logger.warn(LogComponent.TUNNEL, `Failed to persist owned tunnels: ${errorCode(error)}`);
      });
    return this.persistChain;
  }

  /** Resolves once every queued globalState write has completed. */
  flush(): Promise<void> {
    return this.persistChain;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

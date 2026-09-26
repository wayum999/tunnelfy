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
/**
 * Attempts at reading this extension host's start time before settling for ownership by
 * pid alone. A failed attempt is retried on the next start or reconcile, up to this many.
 */
export const MAX_HOST_PROBE_ATTEMPTS = 3;
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
  /**
   * Pid of the extension host (VS Code window) that owns the tunnel. Absent on records
   * written before ownership was per window.
   */
  ownerPid?: number;
  /** OS start time of that extension host, epoch ms; absent when it could not be probed */
  ownerStartedAt?: number;
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
  /** Pid of this extension host; defaults to process.pid */
  ownerPid?: number;
}

/** The extension host this registry runs in, identified the same way as a tunnel's child */
interface HostIdentity {
  pid: number;
  /** Undefined when the probe could not report this host's start time */
  startedAt?: number;
}

/** A spawned entry also carries a promise that resolves when its child exits */
type SpawnedEntry = SpawnedTunnel & { exited: Promise<void> };
type OwnedEntry = SpawnedEntry | AdoptedTunnel;

type Verification = "verified" | "dead" | "mismatch" | "unknown";

/** True when both records name the same tunnel process */
function sameProcess(a: OwnedTunnelRecord, b: OwnedTunnelRecord): boolean {
  return a.tunnelId === b.tunnelId && a.pid === b.pid;
}

/** True when both records name the same owner window, or both name none */
function sameOwner(a: OwnedTunnelRecord, b: OwnedTunnelRecord): boolean {
  return a.ownerPid === b.ownerPid && a.ownerStartedAt === b.ownerStartedAt;
}

/**
 * Who owns a persisted record: this host, another host that is still running, nobody
 * (the owner is gone, or the record predates owners), or undecidable.
 */
type Ownership = "self" | "other-alive" | "orphaned" | "unknown";

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
    typeof r.target === "string" &&
    (r.ownerPid === undefined || isValidPid(r.ownerPid)) &&
    (r.ownerStartedAt === undefined ||
      (typeof r.ownerStartedAt === "number" && Number.isFinite(r.ownerStartedAt) && r.ownerStartedAt > 0))
  );
}

/** Copies only the record fields, so nothing else can ride along into globalState. */
function toRecord(r: OwnedTunnelRecord): OwnedTunnelRecord {
  const record: OwnedTunnelRecord = {
    tunnelId: r.tunnelId,
    pid: r.pid,
    startedAt: r.startedAt,
    kind: r.kind,
    target: r.target,
  };
  if (r.ownerPid !== undefined) {
    record.ownerPid = r.ownerPid;
  }
  if (r.ownerStartedAt !== undefined) {
    record.ownerStartedAt = r.ownerStartedAt;
  }
  return record;
}

function withOwner(r: OwnedTunnelRecord, host: HostIdentity): OwnedTunnelRecord {
  return toRecord({ ...r, ownerPid: host.pid, ownerStartedAt: host.startedAt });
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code ?? (error instanceof Error ? error.message : String(error));
}

/**
 * TunnelProcessRegistry - the single owner of every cloudflared child the extension spawns.
 *
 * It spawns the child, records { tunnelId, pid, startedAt, kind, target } plus the owning
 * extension host in memory and in globalState once the child has really started, removes
 * the record when the child exits, reconciles persisted records against live processes on
 * activate, and stops a tunnel only by its recorded pid after checking that the pid still
 * belongs to that child. globalState is shared by every VS Code window, so a record whose
 * owning window is still running is never adopted, signalled or stopped by another window.
 * It never looks up or signals a process by name, command line or port.
 *
 * One tunnel id can have more than one live cloudflared child (two windows each started it,
 * and both owners are later gone), so `owned` holds every tracked process of an id. Stop
 * and stopAll act on all of them; a verified live process is never dropped untracked.
 */
export class TunnelProcessRegistry implements vscode.Disposable {
  /** Every process this window tracks, by tunnel id; an id is present only while non-empty */
  private readonly owned = new Map<string, OwnedEntry[]>();
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
  private readonly ownerPid: number;
  /** Settled host identity: the start time was read, or every attempt failed */
  private knownHost?: HostIdentity;
  /** The host probe in flight, shared by concurrent callers */
  private hostProbe?: Promise<HostIdentity>;
  private hostProbeAttempts = 0;

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
    this.ownerPid = options.ownerPid ?? process.pid;
  }

  /**
   * This extension host's identity. Never rejects. The probe result is kept once it reads a
   * start time; a failed probe is not cached but retried on the next call, at most
   * MAX_HOST_PROBE_ATTEMPTS times in all. Until one succeeds the host is recorded by pid
   * alone, which other windows treat as undecidable while that pid is alive, so every
   * failed attempt still leaves them hands off. A later success backfills the start time
   * into the records this window holds.
   */
  private hostIdentity(): Promise<HostIdentity> {
    if (this.knownHost) {
      return Promise.resolve(this.knownHost);
    }
    if (!this.hostProbe) {
      const pid = this.ownerPid;
      const attempt = ++this.hostProbeAttempts;
      this.hostProbe = this.probeFn(pid, { timeoutMs: this.probeTimeoutMs, logger: this.logger })
        .catch((error: unknown) => {
          this.logger.warn(LogComponent.TUNNEL, `Probing this window's host (pid ${pid}) failed: ${errorCode(error)}`);
          return { state: "unknown" as const };
        })
        .then((result): HostIdentity => {
          this.hostProbe = undefined;
          if (result.state === "alive") {
            const host = { pid, startedAt: result.startTimeMs };
            this.knownHost = host;
            if (attempt > 1) {
              this.backfillHostStart(host);
            }
            return host;
          }
          const final = attempt >= MAX_HOST_PROBE_ATTEMPTS;
          this.logger.warn(
            LogComponent.TUNNEL,
            `Could not read this window's host start time (pid ${pid}, ${result.state}, attempt ${attempt} of ${MAX_HOST_PROBE_ATTEMPTS}); ` +
              (final ? "recording ownership by pid only from now on" : "recording ownership by pid only until a retry succeeds"),
          );
          const host = { pid };
          if (final) {
            this.knownHost = host;
          }
          return host;
        });
    }
    return this.hostProbe;
  }

  /**
   * Adds this host's start time to the records it holds that were written by pid alone,
   * in memory and in globalState, so other windows can decide them again. Only records
   * this window holds are touched.
   */
  private backfillHostStart(host: HostIdentity): void {
    const needsStart = (r: OwnedTunnelRecord) => r.ownerPid === host.pid && r.ownerStartedAt === undefined;
    const held: OwnedTunnelRecord[] = [];
    for (const entry of this.entries()) {
      if (needsStart(entry.record)) {
        entry.record = withOwner(entry.record, host);
        held.push(entry.record);
      }
    }
    if (held.length === 0) {
      return;
    }
    this.logger.info(LogComponent.TUNNEL, `Recorded this window's host start time on ${held.length} owned tunnel(s)`);
    void this.persist((records) =>
      records.map((r) => (needsStart(r) && held.some((h) => sameProcess(h, r)) ? withOwner(r, host) : r)),
    );
  }

  private entries(): OwnedEntry[] {
    return Array.from(this.owned.values()).flat();
  }

  private holds(entry: OwnedEntry): boolean {
    return this.owned.get(entry.record.tunnelId)?.includes(entry) ?? false;
  }

  private holdsProcess(record: OwnedTunnelRecord): boolean {
    return this.owned.get(record.tunnelId)?.some((e) => sameProcess(e.record, record)) ?? false;
  }

  private track(entry: OwnedEntry): void {
    const entries = this.owned.get(entry.record.tunnelId);
    if (entries) {
      entries.push(entry);
    } else {
      this.owned.set(entry.record.tunnelId, [entry]);
    }
  }

  /** Removes one entry; the id leaves `owned` with its last entry. */
  private untrack(entry: OwnedEntry): void {
    const { tunnelId } = entry.record;
    const remaining = (this.owned.get(tunnelId) ?? []).filter((e) => e !== entry);
    if (remaining.length > 0) {
      this.owned.set(tunnelId, remaining);
    } else {
      this.owned.delete(tunnelId);
    }
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
      const host = await this.hostIdentity();
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

      // A retry may have read the host start time while this child was spawning
      const record: OwnedTunnelRecord = withOwner(
        { tunnelId, pid, startedAt: this.now(), kind: req.kind, target: req.target },
        this.knownHost ?? host,
      );
      const entry: SpawnedEntry = { record, child, adopted: false, exited };
      this.track(entry);

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
        if (this.holds(entry)) {
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

      if (this.holds(entry)) {
        // Other records for this tunnel id stay: another window's, or an orphan whose
        // process reconcile has not checked. entry.record is read at write time, so a
        // backfilled host start time is not lost.
        void this.persist((records) => [
          ...records.filter((r) => !sameProcess(r, entry.record)),
          toRecord(entry.record),
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
      return { record: entry.record, child, adopted: false };
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

  /**
   * Removes an owned entry from memory and globalState. The stop is announced once the
   * tunnel id has no tracked process left.
   */
  private release(entry: OwnedEntry, message: string): void {
    const { tunnelId, pid } = entry.record;
    if (!this.holds(entry)) {
      return;
    }
    this.untrack(entry);
    void this.persist((records) => records.filter((r) => !sameProcess(r, entry.record)));
    if (this.owned.has(tunnelId)) {
      this.logger.info(LogComponent.TUNNEL, `Tunnel ${tunnelId} (pid ${pid}) released; another process of it is still tracked`);
      return;
    }
    this._onDidChange.fire({ type: "stop", tunnelId, message, kind: entry.record.kind, adopted: entry.adopted });
  }

  isOwned(tunnelId: string): boolean {
    return this.owned.has(tunnelId);
  }

  isAdopted(tunnelId: string): boolean {
    return this.owned.get(tunnelId)?.some((entry) => entry.adopted) ?? false;
  }

  /** One record per tracked process, so a tunnel id can appear more than once. */
  list(kind?: TunnelKind): OwnedTunnelRecord[] {
    return this.entries()
      .map((entry) => entry.record)
      .filter((record) => !kind || record.kind === kind)
      .map(toRecord);
  }

  /**
   * Stops an owned tunnel by its recorded pid: graceful termination, a bounded wait,
   * then a force-kill only while the process is still the verified child. Every process
   * this window tracks for the id is stopped concurrently; the result is stopped only when
   * all of them stopped, else the first failure.
   * @param timeoutMs total budget for the stop
   */
  stop(tunnelId: string, timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS): Promise<StopResult> {
    const entries = [...(this.owned.get(tunnelId) ?? [])];
    if (entries.length === 0) {
      return Promise.resolve({ tunnelId, outcome: "not-owned" });
    }
    const inFlight = this.stopping.get(tunnelId);
    if (inFlight) {
      return inFlight;
    }
    const deadline = this.now() + Math.max(0, timeoutMs);
    const stopping = Promise.all(
      entries.map((entry) =>
        (entry.adopted ? this.stopAdopted(entry, deadline) : this.stopSpawned(entry, deadline))
          .catch((error): StopResult => ({ tunnelId, outcome: "failed", reason: `error: ${errorCode(error)}` }))
          .then((result) => {
            this.logger.info(
              LogComponent.TUNNEL,
              `Stop tunnel ${tunnelId} (pid ${entry.record.pid}): ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`,
            );
            return result;
          }),
      ),
    )
      .then((results): StopResult => results.find((r) => r.outcome !== "stopped") ?? { tunnelId, outcome: "stopped" })
      .finally(() => this.stopping.delete(tunnelId));
    this.stopping.set(tunnelId, stopping);
    return stopping;
  }

  /**
   * Stops every tunnel this window owns concurrently under one shared deadline. Records
   * another window owns are never in `owned`, so they are never stopped here. Records whose
   * exit was not confirmed stay persisted for the next reconcile.
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
      result = await this.probeFn(record.pid, { timeoutMs, logger: this.logger });
    } catch (error) {
      this.logger.warn(
        LogComponent.TUNNEL,
        `Probing pid ${record.pid} for tunnel ${record.tunnelId} failed: ${errorCode(error)}`,
      );
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

  private ownershipOf(record: OwnedTunnelRecord, host: HostIdentity): Ownership | undefined {
    if (record.ownerPid === undefined) {
      // Written before records carried an owner
      return "orphaned";
    }
    if (
      record.ownerPid === host.pid &&
      record.ownerStartedAt !== undefined &&
      host.startedAt !== undefined &&
      Math.abs(record.ownerStartedAt - host.startedAt) <= this.startTimeToleranceMs
    ) {
      return "self";
    }
    return undefined;
  }

  /**
   * Decides whether the window that wrote a record is still running, by probing its
   * extension-host pid against its recorded start time. Undecidable means hands off.
   */
  private async ownerOf(record: OwnedTunnelRecord, host: HostIdentity): Promise<Ownership> {
    const known = this.ownershipOf(record, host);
    if (known) {
      return known;
    }
    const ownerPid = record.ownerPid as number;
    let result;
    try {
      result = await this.probeFn(ownerPid, { timeoutMs: this.probeTimeoutMs, logger: this.logger });
    } catch (error) {
      this.logger.warn(
        LogComponent.TUNNEL,
        `Probing owner window (pid ${ownerPid}) of tunnel ${record.tunnelId} failed: ${errorCode(error)}`,
      );
      return "unknown";
    }
    if (result.state === "dead") {
      return "orphaned";
    }
    if (result.state !== "alive" || record.ownerStartedAt === undefined) {
      return "unknown";
    }
    // A live pid with a different start time is a later process that reused the owner's pid
    return Math.abs(result.startTimeMs - record.ownerStartedAt) <= this.startTimeToleranceMs
      ? "other-alive"
      : "orphaned";
  }

  /**
   * Checks every persisted record against the live process table. A record whose owner
   * window is still running, or whose owner cannot be determined, is left in place and
   * never touched. Of the rest, verified records are adopted (owned, running, stoppable)
   * and rewritten to this window, even when this window already tracks another process of
   * the same tunnel id; dead, reused or unverifiable pids are dropped without ever being
   * signalled. Adoption is exclusive: see claimOrphans. Never throws.
   */
  async reconcile(): Promise<void> {
    try {
      const host = await this.hostIdentity();
      const records = (await this.load()).filter((r) => !this.holdsProcess(r));
      const checked = await Promise.all(
        records.map(async (record) => {
          const owner = await this.ownerOf(record, host);
          if (owner === "other-alive" || owner === "unknown") {
            return { record, owner, identity: undefined };
          }
          return { record, owner, identity: await this.verify(record) };
        }),
      );
      const dropped: OwnedTunnelRecord[] = [];
      const candidates: OwnedTunnelRecord[] = [];
      for (const { record, owner, identity } of checked) {
        if (identity === undefined) {
          if (owner === "unknown") {
            this.logger.warn(
              LogComponent.TUNNEL,
              `Could not tell whether window pid ${record.ownerPid} still owns tunnel ${record.tunnelId}; not claiming it`,
            );
          } else {
            this.logger.info(
              LogComponent.TUNNEL,
              `Tunnel ${record.tunnelId} (pid ${record.pid}) belongs to another open window (pid ${record.ownerPid}); leaving it`,
            );
          }
          continue;
        }
        if (identity === "verified") {
          if (!candidates.some((c) => sameProcess(c, record))) {
            candidates.push(record);
          }
        } else {
          dropped.push(record);
          if (identity === "unknown") {
            this.logger.warn(LogComponent.TUNNEL, `Could not verify pid ${record.pid}; not claiming it`);
          } else {
            this.logger.info(LogComponent.TUNNEL, `Dropped owned-tunnel record for pid ${record.pid} (${identity})`);
          }
        }
      }
      if (dropped.length === 0 && candidates.length === 0) {
        return;
      }
      const adopted = await this.claimOrphans(candidates, dropped, host);
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
   * Drops `dropped` and takes each candidate with a compare-and-set on its owner: the
   * persisted record is re-read, and rewritten to this host only if it still names the
   * owner reconcile saw (the dead window, or none for a legacy record). A record another
   * window has re-owned in the meantime, or one that is gone, is left alone. Nothing is
   * claimed if the write fails.
   *
   * globalState has no transactions. The compare and the write run in one synchronous
   * step (no await between the read and memento.update), so two reconciles in this window,
   * or two windows whose writes have already reached each other, cannot both win. The
   * remaining window of risk: VS Code replicates globalState between windows
   * asynchronously, so two windows reconciling within that replication delay can each read
   * the dead owner and both claim the record. Each still identity-verifies before any
   * signal, so the worst case is two windows listing, and able to stop, the same verified
   * tunnel.
   */
  private async claimOrphans(
    candidates: OwnedTunnelRecord[],
    dropped: OwnedTunnelRecord[],
    host: HostIdentity,
  ): Promise<AdoptedTunnel[]> {
    let won: AdoptedTunnel[] = [];
    const written = await this.persist((current) => {
      won = [];
      return current
        .filter((r) => !dropped.some((d) => sameProcess(d, r)))
        .map((r) => {
          const seen = candidates.find((c) => sameProcess(c, r));
          if (!seen || !sameOwner(seen, r) || this.holdsProcess(r)) {
            return r;
          }
          const entry: AdoptedTunnel = { record: withOwner(r, host), adopted: true };
          won.push(entry);
          return entry.record;
        });
    });
    if (!written) {
      if (candidates.length > 0) {
        this.logger.warn(LogComponent.TUNNEL, `Not adopting ${candidates.length} tunnel(s): their ownership could not be saved`);
      }
      return [];
    }
    for (const candidate of candidates) {
      if (!won.some((entry) => sameProcess(entry.record, candidate))) {
        this.logger.info(
          LogComponent.TUNNEL,
          `Tunnel ${candidate.tunnelId} (pid ${candidate.pid}) was claimed by another window first; leaving it`,
        );
      }
    }
    for (const entry of won) {
      this.track(entry);
    }
    return won;
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
   * another window sharing globalState are not overwritten wholesale. The read and the
   * write start in one synchronous step. Resolves true once written, false if it failed.
   */
  private persist(mutate: (records: OwnedTunnelRecord[]) => OwnedTunnelRecord[]): Promise<boolean> {
    const write = this.persistChain
      .then(async () => {
        const next = mutate(this.readPersisted().valid).map(toRecord);
        await this.memento.update(OWNED_TUNNELS_KEY, next);
        return true;
      })
      .catch((error) => {
        this.logger.warn(LogComponent.TUNNEL, `Failed to persist owned tunnels: ${errorCode(error)}`);
        return false;
      });
    this.persistChain = write.then(() => undefined);
    return write;
  }

  /** Resolves once every queued globalState write has completed. */
  flush(): Promise<void> {
    return this.persistChain;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

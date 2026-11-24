import type { TuneEntry } from "../tunes/library";
import { SHAPES_KEY, validShapeBook } from "../song/scaleShapes";
import { validTriadStore } from "../triads/model";

export interface SyncTransaction {
  v: 1;
  id: string;
  device: string;
  seq: number;
  clock: number;
  at: number;
  context: Record<string, number>;
  kind: "storage" | "tune";
  key: string;
  before: string | null;
  after: string | null;
  baseline?: true;
  delta?: true;
  reset?: true;
  label?: string;
}

export interface SyncSnapshot {
  format: "fretboard-focus-sync";
  version: 1;
  device: string;
  createdAt: string;
  transactions: SyncTransaction[];
}

export interface SyncConflict {
  kind: "legacy" | "tune";
  key: string;
  message: string;
  transactionIds: string[];
}

export interface MergeResult {
  received: number;
  added: number;
  changes: number;
  conflicts: SyncConflict[];
  revision: number;
}

const SETTINGS = new Set(["guitar-key", "guitar-tune", "guitar-arc", "guitar-freeplay", "guitar-freeplay-prefs", "guitar-ear-v1", "guitar-skills", "guitar-goals-v1", "guitar-triads-v1", "guitar-session-set", SHAPES_KEY]);
const reserved = (key: string) => key === "prototype" || Object.prototype.hasOwnProperty.call(Object.prototype, key);
export function syncableStorageKey(key: string): boolean {
  return SETTINGS.has(key) || key.startsWith("guitar-song-deck:") || key.startsWith("guitar-learn:");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Canonical values make IDs immutable even if an exchange's JSON property order changes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function parseValue(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

export function validTune(value: unknown): value is TuneEntry {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 512
    && typeof value.name === "string" && typeof value.xml === "string" && value.xml.length <= 20 * 1024 * 1024
    && (value.partId === undefined || typeof value.partId === "string") && (value.voice === undefined || typeof value.voice === "string");
}

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 80) return false;
  if (Array.isArray(value)) return value.every((item) => safeJson(item, depth + 1));
  if (isRecord(value)) return Object.entries(value).every(([key, item]) => !["__proto__", "prototype", "constructor"].includes(key) && safeJson(item, depth + 1));
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const optional = (value: unknown, check: (entry: unknown) => boolean) => value === undefined || check(value);
const fraction = (value: unknown) => finite(value) && value >= 0 && value <= 1;
const result = (value: unknown) => typeof value === "string" && ["clean", "ok", "fail", "skip"].includes(value);
const tally = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(count) && value[1] <= value[0];
export function validAttemptConditions(value: unknown): boolean {
  const oneOf = (entry: unknown, choices: string[]) => typeof entry === "string" && choices.includes(entry);
  return isRecord(value) && value.v === 1 && oneOf(value.source, ["measured", "self"])
    && oneOf(value.confidence, ["unknown", "limited", "usable"])
    && optional(value.support, (entry) => oneOf(entry, ["none", "guide", "adaptive"]))
    && optional(value.notation, (entry) => oneOf(entry, ["visible", "hidden", "faded"]))
    && optional(value.tempo, (entry) => oneOf(entry, ["own-pace", "adaptive", "fixed"]))
    && optional(value.exposure, (entry) => oneOf(entry, ["first", "repeated"]))
    && optional(value.uninterrupted, (entry) => typeof entry === "boolean");
}
function evidence(value: unknown): boolean {
  return isRecord(value) && [value.notes, value.leap, value.cross, value.shift].every(tally)
    && count(value.restarts) && count(value.hears) && Array.isArray(value.wrong)
    && value.wrong.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(finite))
    && optional(value.weakBars, (bars) => Array.isArray(bars) && bars.every(count))
    && optional(value.time, (time) => isRecord(time) && count(time.n) && finite(time.mean)
      && finite(time.spread) && time.spread >= 0 && count(time.rush) && count(time.drag));
}
function attempt(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.day === "string" && result(value.result)
    && finite(value.bpm) && value.bpm > 0 && finite(value.secs) && value.secs >= 0
    && optional(value.uid, (id) => typeof id === "string" && id.length > 0)
    && optional(value.at, (at) => finite(at) && at >= 0) && optional(value.goalBpm, (bpm) => finite(bpm) && bpm > 0)
    && optional(value.share, (share) => share === null || fraction(share)) && optional(value.from, count) && optional(value.to, count)
    && optional(value.timingMeasured, (flag) => typeof flag === "boolean") && optional(value.ev, evidence)
    && optional(value.conditions, validAttemptConditions)
    && optional(value.arrangementFingerprint, (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128);
}
function session(value: unknown): boolean {
  return isRecord(value) && typeof value.date === "string" && finite(value.minutes) && value.minutes >= 0
    && count(value.cards) && count(value.clean) && optional(value.share, fraction)
    && optional(value.uid, (id) => typeof id === "string" && id.length > 0);
}

function validFragments(tx: SyncTransaction, value: unknown): boolean {
  if (tx.key === "guitar-freeplay") return Array.isArray(value) && value.every(validFreeEntry);
  if (!isRecord(value)) return false;
  if (tx.kind === "tune") return (value.id === undefined || value.id === tx.key)
    && optional(value.name, (name) => typeof name === "string") && optional(value.xml, (xml) => typeof xml === "string" && xml.length <= 20 * 1024 * 1024)
    && optional(value.partId, (id) => typeof id === "string") && optional(value.voice, (voice) => typeof voice === "string");
  if (tx.key.startsWith("guitar-song-deck:") || tx.key === "guitar-skills") {
    return optional(value.history, (history) => Array.isArray(history) && history.every(attempt))
      && optional(value.sessions, (sessions) => Array.isArray(sessions) && sessions.every(session))
      && optional(value.cards, (cards) => isRecord(cards) && Object.values(cards).every(validCard));
  }
  return true;
}

function validCard(value: unknown): boolean {
  return isRecord(value) && count(value.box) && value.box >= 1 && value.box <= 5 && count(value.seen) && count(value.clean)
    && value.clean <= value.seen
    && finite(value.bpm) && value.bpm > 0 && typeof value.due === "string"
    && optional(value.last, (last) => last === null || result(last)) && optional(value.bestCleanBpm, (bpm) => finite(bpm) && bpm > 0);
}

function validSettings(value: unknown): boolean {
  return isRecord(value) && optional(value.newPerSession, count)
    && [value.guide, value.voice, value.shuffle, value.mix].every((flag) => optional(flag, (entry) => typeof entry === "boolean"))
    && optional(value.window, (fret) => fret === null || count(fret))
    && optional(value.length, (length) => typeof length === "string" && ["short", "normal", "long"].includes(length))
    && optional(value.loop, (mode) => typeof mode === "string" && ["adaptive", "turnaround", "continuous"].includes(mode));
}

function validGoal(value: unknown, tuneId: string, id: string): boolean {
  const text = (entry: unknown, limit: number) => typeof entry === "string" && entry.length > 0 && entry.length <= limit;
  const bpm = (entry: unknown): entry is number => finite(entry) && entry >= 30 && entry <= 240;
  return isRecord(value) && value.v === 1 && value.id === id && text(id, 512) && value.tuneId === tuneId
    && typeof value.kind === "string" && ["melody", "accompaniment", "ear", "reading", "improv"].includes(value.kind)
    && isRecord(value.arrangement) && value.arrangement.version === 1 && text(value.arrangement.fingerprint, 128)
    && isRecord(value.tempo) && bpm(value.tempo.minBpm) && bpm(value.tempo.targetBpm) && value.tempo.minBpm <= value.tempo.targetBpm
    && typeof value.createdAt === "string" && value.createdAt.length <= 40 && Number.isFinite(Date.parse(value.createdAt))
    && Array.isArray(value.essentialTasks) && value.essentialTasks.length > 0 && value.essentialTasks.length <= 12
    && new Set(value.essentialTasks.map((task) => isRecord(task) ? task.cardId : null)).size === value.essentialTasks.length
    && value.essentialTasks.every((task) => isRecord(task) && text(task.cardId, 1024) && bpm(task.targetBpm));
}

export function validGoalData(value: unknown): boolean {
  return isRecord(value) && value.v === 1 && isRecord(value.byTune) && Object.keys(value.byTune).length <= 128
    && Object.entries(value.byTune).every(([tuneId, bucket]) => tuneId.length > 0 && tuneId.length <= 512
      && isRecord(bucket) && isRecord(bucket.goals) && Object.keys(bucket.goals).length <= 256
      && (bucket.activeId === null || (typeof bucket.activeId === "string" && Object.prototype.hasOwnProperty.call(bucket.goals, bucket.activeId)))
      && Object.entries(bucket.goals).every(([id, goal]) => validGoal(goal, tuneId, id)));
}

function validFreeEntry(value: unknown): boolean {
  return isRecord(value) && typeof value.day === "string" && typeof value.key === "string"
    && typeof value.pattern === "string" && ["run", "thirds", "triads", "sevenths", "melody"].includes(value.pattern)
    && finite(value.bpm) && value.bpm >= 0 && finite(value.division) && value.division > 0 && finite(value.secs) && value.secs >= 0;
}

function validEar(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.progress) || !isRecord(value.stats) || !isRecord(value.settings)) return false;
  const progress = Object.values(value.progress).every((entry) => isRecord(entry) && count(entry.stage)
    && isRecord(entry.mastery) && Object.values(entry.mastery).every((mastery) => isRecord(mastery) && fraction(mastery.score) && count(mastery.attempts))
    && isRecord(entry.confusion) && Object.values(entry.confusion).every(count) && Array.isArray(entry.recent) && entry.recent.every(fraction));
  const stats = value.stats, settings = value.settings;
  return progress && [stats.rounds, stats.streak, stats.best].every(count) && isRecord(stats.names) && [stats.names.right, stats.names.total].every(count)
    && (settings.instrument === "keys" || settings.instrument === "guitar") && finite(settings.pace) && settings.pace > 0
    && count(settings.length) && typeof settings.randomKey === "boolean" && count(settings.fixedKey) && settings.fixedKey < 12;
}

function validPayload(tx: SyncTransaction, raw: string | null): boolean {
  if (raw === null) return true;
  if (typeof raw !== "string" || raw.length > 24 * 1024 * 1024) return false;
  const value = parseValue(raw);
  if (!safeJson(value)) return false;
  // Sparse mutations are validated again after replay, before any materialized write. Their
  // unchanged required fields deliberately live only in the original baseline.
  if (tx.delta) return validFragments(tx, value);
  if (tx.kind === "tune") return validTune(value) && value.id === tx.key;
  if (tx.key.startsWith("guitar-song-deck:") || tx.key === "guitar-skills") {
    if (!isRecord(value) || value.v !== 1 || !isRecord(value.cards)) return false;
    if (tx.key !== "guitar-skills" && (!Array.isArray(value.sessions) || !validSettings(value.settings))) return false;
    if (!optional(value.credit, (credit) => isRecord(credit) && Object.values(credit).every((entry) => finite(entry) && entry >= 0))) return false;
    if (!optional(value.history, (history) => Array.isArray(history) && history.every(attempt))
      || !optional(value.sessions, (sessions) => Array.isArray(sessions) && sessions.every(session))) return false;
    return Object.values(value.cards).every(validCard);
  }
  if (tx.key === "guitar-freeplay") return Array.isArray(value) && value.every(validFreeEntry);
  if (tx.key === "guitar-goals-v1") return validGoalData(value);
  if (tx.key === "guitar-ear-v1") return validEar(value);
  if (tx.key === "guitar-triads-v1") return validTriadStore(value);
  if (tx.key === SHAPES_KEY) return validShapeBook(value);
  if (tx.key === "guitar-session-set") return Array.isArray(value) && value.length <= 512 && value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 512);
  if (tx.key.startsWith("guitar-learn:")) return isRecord(value) && count(value.step) && Array.isArray(value.done) && value.done.every(count);
  return true;
}

export function parseSyncSnapshot(input: unknown): SyncSnapshot {
  if (!isRecord(input) || input.format !== "fretboard-focus-sync" || input.version !== 1
    || typeof input.device !== "string" || typeof input.createdAt !== "string" || !Array.isArray(input.transactions)
    || input.transactions.length > 250_000) throw new Error("That exchange format is not supported.");
  const transactions: SyncTransaction[] = [];
  for (const raw of input.transactions) {
    if (!isRecord(raw) || raw.v !== 1 || typeof raw.id !== "string" || typeof raw.device !== "string"
      || !raw.device || raw.device.length > 256 || reserved(raw.device) || raw.id !== `${raw.device}:${raw.seq}`
      || !Number.isSafeInteger(raw.seq) || (raw.seq as number) < 1
      || !Number.isSafeInteger(raw.clock) || (raw.clock as number) < 1
      || typeof raw.at !== "number" || !Number.isFinite(raw.at) || !isRecord(raw.context)
      || !Object.entries(raw.context).every(([device, seq]) => device.length > 0 && device.length <= 256 && !reserved(device) && Number.isSafeInteger(seq) && (seq as number) >= 0)
      || ((raw.context[raw.device] as number | undefined) ?? 0) >= (raw.seq as number)
      || (raw.kind !== "storage" && raw.kind !== "tune") || typeof raw.key !== "string" || !raw.key || raw.key.length > 1024
      || (raw.kind === "storage" && !syncableStorageKey(raw.key))
      || (raw.before !== null && typeof raw.before !== "string") || (raw.after !== null && typeof raw.after !== "string")
      || (raw.baseline !== undefined && raw.baseline !== true) || (raw.baseline && raw.before !== null)
      || (raw.delta !== undefined && raw.delta !== true) || (raw.baseline && raw.delta)
      || (raw.reset !== undefined && raw.reset !== true) || (raw.reset && (raw.baseline || raw.delta))
      || (raw.label !== undefined && typeof raw.label !== "string")) throw new Error("The exchange contains an invalid transaction.");
    const tx = raw as unknown as SyncTransaction;
    if (!validPayload(tx, tx.before) || !validPayload(tx, tx.after)) throw new Error("The exchange contains invalid practice data.");
    transactions.push({ v: 1, id: tx.id, device: tx.device, seq: tx.seq, clock: tx.clock, at: tx.at,
      context: { ...tx.context }, kind: tx.kind, key: tx.key, before: tx.before, after: tx.after,
      ...(tx.baseline ? { baseline: true as const } : {}), ...(tx.label ? { label: tx.label } : {}) });
    if (tx.delta) transactions[transactions.length - 1].delta = true;
    if (tx.reset) transactions[transactions.length - 1].reset = true;
  }
  return { format: "fretboard-focus-sync", version: 1, device: input.device, createdAt: input.createdAt, transactions: unionTransactions([], transactions) };
}

/** Rows have stable IDs from the moment new practice is recorded. Legacy rows are a multiset. */
export function addedRows(before: readonly unknown[], after: readonly unknown[]): unknown[] {
  const counts = new Map<string, number>();
  const identity = (row: unknown) => isRecord(row) && typeof row.uid === "string" ? `id:${row.uid}` : canonical(row);
  for (const row of before) { const key = identity(row); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return after.filter((row) => {
    const key = identity(row), left = counts.get(key) ?? 0;
    if (left) { counts.set(key, left - 1); return false; }
    return true;
  });
}

/** Save only changed paths. Bounded display history can shrink without deleting the journal. */
export function compactValues(before: string | null, after: string | null, key?: string): { before: string | null; after: string | null; delta?: true } {
  const left = parseValue(before), right = parseValue(after);
  if (key === "guitar-freeplay" && Array.isArray(left) && Array.isArray(right)) {
    const identity = (row: unknown) => { const entry = isRecord(row) ? row : {}; return `${entry.day}\0${entry.key}\0${entry.pattern}`; };
    const old = new Map(left.map((row) => [identity(row), row]));
    const changed = right.filter((row) => canonical(old.get(identity(row))) !== canonical(row));
    return { before: canonical(changed.flatMap((row) => old.has(identity(row)) ? [old.get(identity(row))] : [])), after: canonical(changed), delta: true };
  }
  if (!isRecord(left) || !isRecord(right)) return { before, after };
  const diff = (a: unknown, b: unknown, path: string): [unknown, unknown] => {
    if (canonical(a) === canonical(b)) return [undefined, undefined];
    if (/^cards\.[^.]+$/.test(path) || /\.mastery\.[^.]+$/.test(path)) return [a, b];
    if ((path === "history" || path === "sessions") && Array.isArray(a) && Array.isArray(b)) {
      const added = addedRows(a, b);
      return added.length ? [[], added] : [undefined, undefined];
    }
    if (isRecord(a) && isRecord(b)) {
      const old: Record<string, unknown> = {}, next: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const [was, now] = diff(a[key], b[key], path ? `${path}.${key}` : key);
        if (was !== undefined) old[key] = was;
        if (now !== undefined) next[key] = now;
      }
      return Object.keys(old).length || Object.keys(next).length ? [old, next] : [undefined, undefined];
    }
    return [a, b];
  };
  const [old, next] = diff(left, right, "");
  return { before: canonical(old ?? {}), after: canonical(next ?? {}), delta: true };
}

export function unionTransactions(left: readonly SyncTransaction[], right: readonly SyncTransaction[]): SyncTransaction[] {
  const byId = new Map(left.map((tx) => [tx.id, tx]));
  for (const tx of right) {
    const previous = byId.get(tx.id);
    if (previous && canonical(previous) !== canonical(tx)) throw new Error("An exchange reuses a transaction identity with different content.");
    byId.set(tx.id, tx);
  }
  for (const tx of byId.values()) for (const [device, seq] of Object.entries(tx.context)) {
    const predecessor = byId.get(`${device}:${seq}`);
    if (predecessor && predecessor.clock >= tx.clock) throw new Error("The exchange contains inconsistent transaction ordering.");
  }
  return [...byId.values()].sort((a, b) => a.clock - b.clock || a.device.localeCompare(b.device) || a.seq - b.seq);
}

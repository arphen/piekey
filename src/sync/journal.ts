import type { TuneEntry } from "../tunes/library";
import { canonical, compactValues, syncableStorageKey, unionTransactions, type SyncTransaction } from "./model";

export type { SyncTransaction } from "./model";
export { syncableStorageKey } from "./model";

const DB = "guitar-sync-v1";
const TRANSACTIONS = "transactions";
const META = "meta";
const BY_TARGET = "by-target";
const PRACTICE_READ_LIMIT = 5000;
const PRACTICE_READ_CHARS = 8 * 1024 * 1024;
const OUTBOX = "fretboard-sync-outbox-v1";
interface Identity { device: string; seq: number; clock: number; vector: Record<string, number>; known: Record<string, boolean> }
interface Change { kind: "storage" | "tune"; key: string; before: string | null; after: string | null; initial?: string | null; baseline?: true; delta?: true; reset?: true; label?: string }
interface Batch { token: string; at: number; changes: Change[] }
export interface SyncState { pending: number; error: string | null; revision: number; transactions: number }
let state: SyncState = { pending: 0, error: null, revision: 0, transactions: 0 };
const listeners = new Set<() => void>();
let suppressed = 0;
let opening: Promise<IDBDatabase> | undefined;
let running: Promise<void> | undefined;
const pending: Batch[] = [];
const capturedTargets = new Set<string>();
let outboxError: string | null = null;

export const getSyncState = (): SyncState => state;
export function subscribeSyncState(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
function update(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); }

function restoreOutbox() {
  try {
    const saved: Batch[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`${OUTBOX}:`)) continue;
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      const batch = value as Batch;
      if (!batch || typeof batch.token !== "string" || !Array.isArray(batch.changes)
        || !batch.changes.every((change) => change && (change.kind === "tune" || change.kind === "storage")
          && typeof change.key === "string" && (change.before === null || typeof change.before === "string")
          && (change.after === null || typeof change.after === "string"))) throw new Error("The pending exchange history is not readable.");
      if (!pending.some((entry) => entry.token === batch.token)) saved.push(batch);
      for (const change of batch.changes) capturedTargets.add(`${change.kind}:${change.key}`);
    }
    pending.push(...saved.sort((a, b) => a.at - b.at));
    if (pending.length) update({ pending: pending.length });
    outboxError = null;
  } catch (error) {
    outboxError = error instanceof Error ? error.message : "Pending exchange history could not be read.";
    update({ error: outboxError });
  }
}

function saveOutbox(batch: Batch) {
  try {
    localStorage.setItem(`${OUTBOX}:${batch.token}`, JSON.stringify(batch));
  } catch {
    update({ error: "Exchange history is still being saved. Keep this page open until the pending changes finish." });
  }
}

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot save the exchange history. IndexedDB is unavailable."));
    const request = indexedDB.open(DB, 2);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const records = request.result.objectStoreNames.contains(TRANSACTIONS)
        ? request.transaction!.objectStore(TRANSACTIONS)
        : request.result.createObjectStore(TRANSACTIONS, { keyPath: "id" });
      if (!records.indexNames.contains(BY_TARGET)) records.createIndex(BY_TARGET, ["kind", "key"]);
      if (!request.result.objectStoreNames.contains(META)) request.result.createObjectStore(META);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = () => { abandoned = true; reject(request.error ?? new Error("The exchange history could not be opened.")); };
    request.onblocked = () => { abandoned = true; reject(new Error("Close other copies of the app to open its exchange history.")); };
  }).catch((error: unknown) => { opening = undefined; throw error; });
  return opening!;
}

function newIdentity(): Identity {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return { device: `device-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`, seq: 0, clock: 0, vector: {}, known: {} };
}

async function append(batch: Batch): Promise<number> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRANSACTIONS, META], "readwrite");
    const meta = tx.objectStore(META);
    const records = tx.objectStore(TRANSACTIONS);
    const request = meta.get("identity");
    const applied = meta.get(`batch:${batch.token}`);
    let added = 0;
    const apply = () => {
      if (request.readyState !== "done" || applied.readyState !== "done") return;
      if (applied.result) return; // A crash after IDB commit but before outbox removal is harmless.
      const identity = (request.result as Identity | undefined) ?? newIdentity();
      const put = (change: Change) => {
        const context = { ...identity.vector };
        identity.seq++;
        identity.clock++;
        const { initial: _initial, ...payload } = change;
        const entry: SyncTransaction = { ...payload, v: 1, id: `${identity.device}:${identity.seq}`, device: identity.device,
          seq: identity.seq, clock: identity.clock, at: Date.now(), context };
        records.add(entry);
        identity.vector[identity.device] = identity.seq;
        identity.known[`${change.kind}:${change.key}`] = true;
        added++;
      };
      for (const change of batch.changes) {
        const known = identity.known[`${change.kind}:${change.key}`];
        // First user action captures the pre-action state before applying its delta. It is never
        // treated as a newly played session, even if initial hydration has not finished yet.
        const initial = change.initial !== undefined ? change.initial : change.delta ? null : change.before;
        if (!known && initial !== null) put({ kind: change.kind, key: change.key, before: null, after: initial, baseline: true, label: "Existing practice" });
        if (!change.baseline || !known) put(change);
      }
      meta.put(identity, "identity");
      meta.put(true, `batch:${batch.token}`);
    };
    request.onsuccess = applied.onsuccess = apply;
    tx.oncomplete = () => resolve(added);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The exchange history could not be saved."));
  });
}

function drain(): Promise<void> {
  if (running) return running;
  running = (async () => {
    while (pending.length) {
      const batch = pending[0];
      const added = await append(batch);
      pending.shift();
      // One immutable key per batch means another browser tab cannot replace this outbox.
      try { localStorage.removeItem(`${OUTBOX}:${batch.token}`); } catch { /* IDB token makes retry safe. */ }
      update({ pending: pending.length, transactions: state.transactions + added, revision: state.revision + (added ? 1 : 0), error: outboxError });
    }
  })().catch((error: unknown) => {
    update({ error: error instanceof Error ? error.message : "The exchange history could not be saved." });
    throw error;
  }).finally(() => { running = undefined; });
  return running;
}

function enqueue(changes: Change[]) {
  if (!changes.length) return;
  restoreOutbox();
  const compact = changes.map((change) => {
    const target = `${change.kind}:${change.key}`, first = !capturedTargets.has(target);
    capturedTargets.add(target);
    return change.baseline || change.reset ? change : { ...change, ...compactValues(change.before, change.after, change.key), ...(first ? { initial: change.before } : {}) };
  });
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const batch = { token: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""), at: Date.now(), changes: compact };
  pending.push(batch);
  saveOutbox(batch);
  update({ pending: pending.length });
  void drain().catch(() => undefined); // The pending batch remains available for retry/export.
}

export function recordStorageChange(key: string, before: string | null, after: string | null, label?: string): void {
  const reset = label === "Restore backup";
  if (suppressed || !syncableStorageKey(key) || (before === after && !reset)) return;
  enqueue([{ kind: "storage", key, before, after, ...(label ? { label } : {}), ...(reset ? { reset: true as const } : {}) }]);
}

export function recordLibraryChange(before: readonly TuneEntry[], after: readonly TuneEntry[], label?: string): void {
  if (suppressed) return;
  const previous = new Map(before.map((entry) => [entry.id, entry]));
  const next = new Map(after.map((entry) => [entry.id, entry]));
  const changes: Change[] = [];
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const left = previous.get(id), right = next.get(id);
    const old = left ? canonical(left) : null, value = right ? canonical(right) : null;
    if (old !== value) changes.push({ kind: "tune", key: id, before: old, after: value,
      ...(label ? { label } : {}), ...(label === "Restore backup" ? { reset: true as const } : {}) });
  }
  enqueue(changes);
}

/** Explicitly remove an unreadable score without inventing score contents for its history. */
export function recordLibraryRemoval(id: string): void {
  if (suppressed) return;
  enqueue([{ kind: "tune", key: id, before: null, after: null, label: "Remove unavailable score" }]);
}

export function bootstrapStorage(key: string, value: string): void {
  if (syncableStorageKey(key)) enqueue([{ kind: "storage", key, before: null, after: value, baseline: true, label: "Existing practice" }]);
}
export function bootstrapLibrary(entries: readonly TuneEntry[]): void {
  enqueue(entries.map((entry) => ({ kind: "tune", key: entry.id, before: null, after: canonical(entry), baseline: true, label: "Existing tune" })));
}

export function withSyncSuppressed<T>(action: () => T): T {
  suppressed++;
  try {
    const result = action();
    if (result instanceof Promise) return result.finally(() => { suppressed--; }) as T;
    suppressed--;
    return result;
  } catch (error) { suppressed--; throw error; }
}

export async function flushSyncJournal(): Promise<void> {
  restoreOutbox();
  if (outboxError) throw new Error(outboxError);
  do { await drain(); } while (pending.length);
}

export async function readSyncJournal(): Promise<{ device: string; transactions: SyncTransaction[] }> {
  await flushSyncJournal();
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRANSACTIONS, META], "readwrite");
    const meta = tx.objectStore(META);
    const identityRequest = meta.get("identity");
    const entries = tx.objectStore(TRANSACTIONS).getAll();
    let identity: Identity;
    identityRequest.onsuccess = () => { identity = (identityRequest.result as Identity | undefined) ?? newIdentity(); meta.put(identity, "identity"); };
    tx.oncomplete = () => {
      const transactions = entries.result as SyncTransaction[];
      update({ transactions: transactions.length });
      resolve({ device: identity.device, transactions: unionTransactions([], transactions) });
    };
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The exchange history could not be read."));
  });
}

export type PracticeTransactionRead = { status: "ready"; transactions: SyncTransaction[] } | { status: "too-large" };

/** Read a complete tune group or no evidence at all. Truncating transactions before replay
 * would lose reset boundaries and turn a partial archive into misleading negative proof.
 */
export async function readPracticeTransactions(tuneId: string, options: { maxTransactions?: number } = {}): Promise<PracticeTransactionRead> {
  if (!tuneId || tuneId.length > 512) throw new Error("A valid tune is required.");
  const limit = options.maxTransactions ?? PRACTICE_READ_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRACTICE_READ_LIMIT) throw new Error("The practice history query limit is invalid.");
  await flushSyncJournal();
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSACTIONS, "readonly");
    const request = tx.objectStore(TRANSACTIONS).index(BY_TARGET).openCursor(IDBKeyRange.only(["storage", `guitar-song-deck:${tuneId}`]));
    const transactions: SyncTransaction[] = [];
    let chars = 0;
    let capped = false;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as SyncTransaction;
      chars += (entry.before?.length ?? 0) + (entry.after?.length ?? 0);
      if (transactions.length >= limit || chars > PRACTICE_READ_CHARS) { capped = true; return; }
      transactions.push(entry);
      cursor.continue();
    };
    tx.oncomplete = () => {
      try { resolve(capped ? { status: "too-large" } : { status: "ready", transactions: unionTransactions([], transactions) }); }
      catch (error) { reject(error); }
    };
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The saved practice evidence could not be read."));
  });
}

/** Commit the union before touching materialized state. Failed projection can safely be retried. */
export async function importSyncTransactions(incoming: readonly SyncTransaction[]): Promise<{ added: number; transactions: SyncTransaction[] }> {
  await flushSyncJournal();
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRANSACTIONS, META], "readwrite");
    const records = tx.objectStore(TRANSACTIONS), meta = tx.objectStore(META);
    const entriesRequest = records.getAll(), identityRequest = meta.get("identity");
    let union: SyncTransaction[] = [], added = 0, failure: unknown;
    const apply = () => {
      if (entriesRequest.readyState !== "done" || identityRequest.readyState !== "done") return;
      try {
        const existing = entriesRequest.result as SyncTransaction[];
        union = unionTransactions(existing, incoming);
        const ids = new Set(existing.map((entry) => entry.id));
        const identity = (identityRequest.result as Identity | undefined) ?? newIdentity();
        for (const entry of union) {
          if (!ids.has(entry.id)) { records.add(entry); added++; }
          identity.vector[entry.device] = Math.max(identity.vector[entry.device] ?? 0, entry.seq);
          identity.clock = Math.max(identity.clock, entry.clock);
          if (entry.device === identity.device) identity.seq = Math.max(identity.seq, entry.seq);
          identity.known[`${entry.kind}:${entry.key}`] = true;
        }
        meta.put(identity, "identity");
      } catch (error) { failure = error; tx.abort(); }
    };
    entriesRequest.onsuccess = identityRequest.onsuccess = apply;
    tx.oncomplete = () => {
      update({ transactions: union.length, revision: state.revision + (added ? 1 : 0), error: null });
      resolve({ added, transactions: union });
    };
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("The incoming exchange could not be saved."));
  });
}

import { getStoredItem, removeStoredItem, retryStorageWrites, setStoredItem, storedKeys } from "../storage";
import { loadLibraryAsync, parseTuneEntry, saveLibrary } from "../tunes/library";
import { bootstrapLibrary, bootstrapStorage, flushSyncJournal, getSyncState, importSyncTransactions, readSyncJournal, syncableStorageKey, withSyncSuppressed } from "./journal";
import { canonical, isRecord, parseSyncSnapshot, parseValue, unionTransactions, type MergeResult, type SyncSnapshot } from "./model";
import { projectTransactions, type Projection } from "./merge";

export type { MergeResult, SyncConflict, SyncSnapshot, SyncTransaction } from "./model";
export { parseSyncSnapshot } from "./model";
export { flushSyncJournal, getSyncState, subscribeSyncState } from "./journal";

let initializing: Promise<void> | undefined;
let merging = Promise.resolve();

/** The existing browser state is a baseline, never a second copy of newly recorded practice. */
export function initializeSyncJournal(): Promise<void> {
  if (!initializing) initializing = (async () => {
    // Capture synchronously before library hydration yields to a user's first action.
    for (const key of storedKeys()) {
      if (!syncableStorageKey(key)) continue;
      const value = getStoredItem(key);
      if (value !== null) bootstrapStorage(key, value);
    }
    bootstrapLibrary(await loadLibraryAsync());
    await flushSyncJournal();
  })().catch((error: unknown) => { initializing = undefined; throw error; });
  return initializing;
}

export async function captureSnapshot(): Promise<SyncSnapshot> {
  await initializeSyncJournal();
  const { device, transactions } = await readSyncJournal();
  return parseSyncSnapshot({ format: "fretboard-focus-sync", version: 1, device, createdAt: new Date().toISOString(), transactions });
}

function displayValue(key: string, raw: string | null): string | null {
  if (raw === null || !key.startsWith("guitar-song-deck:")) return raw;
  const value = parseValue(raw);
  if (!isRecord(value)) return raw;
  if (Array.isArray(value.history)) value.history = value.history.slice(-800);
  if (Array.isArray(value.sessions)) value.sessions = value.sessions.slice(-200);
  return canonical(value);
}

/** Journal commit precedes projection; retries repair a failed projection without new events. */
function validateProjection(projection: Projection) {
  // Validate the complete materialized domain before committing an incoming transaction. Sparse
  // fragments can be individually safe yet form an unusable object when a baseline is missing.
  const projectedTransactions = [...projection.storage].map(([key, after], index) => ({
    v: 1 as const, id: `projection:${index + 1}`, device: "projection", seq: index + 1, clock: index + 1, at: 0,
    context: {}, kind: "storage" as const, key, before: null, after,
  }));
  parseSyncSnapshot({ format: "fretboard-focus-sync", version: 1, device: "projection", createdAt: "", transactions: projectedTransactions });
  for (const entry of projection.tunes) parseTuneEntry(entry);
}

async function applySnapshot(incoming: SyncSnapshot): Promise<MergeResult> {
  await initializeSyncJournal();
  const local = await readSyncJournal();
  validateProjection(projectTransactions(unionTransactions(local.transactions, incoming.transactions)));
  const committed = await importSyncTransactions(incoming.transactions);
  let transactions = committed.transactions;
  let changes = 0;
  for (let pass = 0; pass < 4; pass++) {
    // importSyncTransactions can include another tab's commit since the initial read.
    const projection = projectTransactions(transactions);
    validateProjection(projection);
    // A failed prior apply has effective in-memory values too; require those writes to reach
    // durable storage before considering an identical repeated exchange acknowledged.
    if (!withSyncSuppressed(retryStorageWrites)) throw new Error("Browser storage is full. The exchange history is safe; free space and retry the exchange.");
    for (const [key, raw] of projection.storage) {
      const next = displayValue(key, raw), previous = getStoredItem(key);
      if (previous === next || (previous !== null && next !== null && canonical(parseValue(previous)) === canonical(parseValue(next)))) continue;
      if (!(next === null ? removeStoredItem(key, false) : setStoredItem(key, next, false))) throw new Error("The exchange was saved, but practice could not be updated. Free browser storage and retry.");
      changes++;
    }
    const current = await loadLibraryAsync();
    const sorted = [...current].sort((a, b) => a.id.localeCompare(b.id));
    if (canonical(sorted) !== canonical(projection.tunes)) {
      if (!await saveLibrary(projection.tunes, undefined, false)) throw new Error("The incoming scores are in the exchange history, but the library could not be updated. Retry when browser storage is available.");
      changes++;
    }
    const latest = await readSyncJournal();
    if (canonical(latest.transactions) === canonical(transactions))
      return { received: incoming.transactions.length, added: committed.added, changes, conflicts: projection.conflicts, revision: getSyncState().revision };
    transactions = latest.transactions;
  }
  throw new Error("Practice changed in another tab during the exchange. Its transactions are safe; pause the other tab and retry.");
}

export async function mergeSnapshot(input: unknown): Promise<MergeResult> {
  const incoming = parseSyncSnapshot(input);
  const run = async (): Promise<MergeResult> => typeof navigator !== "undefined" && navigator.locks
    ? await navigator.locks.request("fretboard-focus-sync-merge", () => applySnapshot(incoming))
    : await applySnapshot(incoming);
  const task = merging.then(run, run);
  merging = task.then(() => undefined, () => undefined);
  return task;
}

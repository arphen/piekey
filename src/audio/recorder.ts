// The player's own sound stays recoverable in this page until IndexedDB commits it.
import { clearStorageError, reportStorageError } from "../storage";
import type { AttemptConditions } from "../song/leitner";

const DB = "guitar-recordings";
const STORE = "takes";
const KEEP = 10; // per tune, besides its very first take

export interface TakeMeta {
  id: string;
  tuneId: string;
  cardId: string;
  day: string;
  at: number;
  bpm: number;
  share: number | null;
  conditions?: AttemptConditions;
  arrangementFingerprint?: string;
}
export interface StoredTake extends TakeMeta { blob: Blob }
export type RecordingSaveStatus = "saving" | "saved" | "pending" | "unavailable";
export interface Recording { stop(): Promise<Blob | null> }

const pending = new Map<string, StoredTake>();
const writes = new Map<string, Promise<"saved" | "pending">>();
let pendingSnapshot: readonly StoredTake[] = [];
let saves: ReadonlyMap<string, RecordingSaveStatus> = new Map();
const listeners = new Set<() => void>();
export const getPendingTakes = (): readonly StoredTake[] => pendingSnapshot;
export const getRecordingSaves = (): ReadonlyMap<string, RecordingSaveStatus> => saves;
export function subscribeRecordingSaves(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function status(id: string, value: RecordingSaveStatus) {
  saves = new Map(saves).set(id, value);
  pendingSnapshot = [...pending.values()];
  listeners.forEach((listener) => listener());
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) { db?.close(); return; }
      settled = true;
      resolve(db);
    };
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("tune", "tuneId");
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        finish(req.result);
      };
      req.onerror = req.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}

function all(db: IDBDatabase, tuneId: string): Promise<StoredTake[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).index("tune").getAll(tuneId);
    req.onsuccess = () => resolve((req.result as StoredTake[]).sort((a, b) => a.at - b.at));
    req.onerror = () => reject(req.error ?? new Error("Recordings could not be read."));
  });
}

/** Which takes to drop: all but the first and the newest `keep`. */
export function toDrop(takes: TakeMeta[], keep = KEEP): string[] {
  const sorted = [...takes].sort((a, b) => a.at - b.at);
  return sorted.slice(1, Math.max(1, sorted.length - keep)).map((t) => t.id);
}

/** Returns saved only after commit; failures retain the complete take for retry or download. */
export function saveTake(meta: TakeMeta, blob: Blob): Promise<"saved" | "pending"> {
  return persistTake(meta, blob, true);
}

function persistTake(meta: TakeMeta, blob: Blob, prune: boolean): Promise<"saved" | "pending"> {
  const writing = writes.get(meta.id);
  if (writing) return writing;
  pending.set(meta.id, { ...meta, blob });
  status(meta.id, "saving");
  const write = (async (): Promise<"saved" | "pending"> => {
    const db = await open();
    try {
      if (!db) throw new Error("Recording storage could not be opened.");
      const takes = await all(db, meta.tuneId);
      const tx = db.transaction(STORE, "readwrite");
      const done = completed(tx);
      void done.catch(() => undefined); // put can throw before the await below
      const store = tx.objectStore(STORE);
      store.put({ ...meta, blob });
      // An old pending take may fall outside the recent window; retry must still keep it.
      if (prune) for (const id of toDrop([...takes.filter((take) => take.id !== meta.id), meta])) if (id !== meta.id) store.delete(id);
      await done;
      pending.delete(meta.id);
      if (!pending.size) clearStorageError("recordings");
      status(meta.id, "saved");
      return "saved";
    } catch (error) {
      reportStorageError("recordings", error, "A recording is unsaved and remains only in this open page. Retry or download its audio before closing. The JSON practice backup does not include audio.");
      status(meta.id, "pending");
      return "pending";
    } finally { db?.close(); }
  })();
  writes.set(meta.id, write);
  void write.finally(() => writes.delete(meta.id));
  return write;
}

/** Finishing the performance never waits on storage; its recording reports its own outcome. */
export async function finishTake(meta: TakeMeta, recording: Recording | null): Promise<RecordingSaveStatus> {
  status(meta.id, "saving");
  let blob: Blob | null = null;
  try { blob = await recording?.stop() ?? null; } catch { /* No usable captured audio. */ }
  if (!blob?.size) {
    status(meta.id, "unavailable");
    return "unavailable";
  }
  return saveTake(meta, blob);
}

export async function retryPendingTakes(): Promise<boolean> {
  for (const take of [...pending.values()]) {
    const { blob, ...meta } = take;
    await persistTake(meta, blob, false);
  }
  return pending.size === 0;
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The recording could not be saved."));
  });
}

/** Durable inventory only: memory-only audio must never cause a remote save to be skipped. */
export async function readAllTakes(): Promise<StoredTake[]> {
  const db = await open();
  if (!db) throw new Error("Recordings could not be opened. Nothing has been marked as synced.");
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as StoredTake[]);
      request.onerror = () => reject(request.error ?? new Error("Recordings could not be read."));
    });
  } finally { db.close(); }
}

/** Rescue pending audio too; a failed durable inventory is still surfaced, never omitted. */
export async function readExportableTakes(): Promise<StoredTake[]> {
  const takes = new Map((await readAllTakes()).map((take) => [take.id, take]));
  for (const take of pending.values()) takes.set(take.id, take);
  return [...takes.values()];
}

/** A transferred take is acknowledged only after its IndexedDB transaction commits. */
export async function storeTransferredTake(take: StoredTake): Promise<void> {
  const db = await open();
  if (!db) throw new Error("Recordings could not be saved on this device.");
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = completed(tx);
    void done.catch(() => undefined);
    tx.objectStore(STORE).put(take);
    await done;
  } finally { db.close(); }
}

export async function listTakes(tuneId: string): Promise<TakeMeta[]> {
  const db = await open();
  try {
    if (!db) throw new Error("Recordings could not be opened.");
    const takes = await all(db, tuneId);
    clearStorageError("recordings-list");
    return takes.map(({ blob: _blob, ...meta }) => meta);
  } catch (error) {
    reportStorageError("recordings-list", error, "Saved recordings could not be read. They have not been removed. Retry from Progress when storage is available.");
    throw error;
  } finally { db?.close(); }
}

export async function takeAudio(tuneId: string, id: string): Promise<Blob | null> {
  const waiting = pending.get(id);
  if (waiting?.tuneId === tuneId) return waiting.blob;
  const db = await open();
  try {
    if (!db) throw new Error("Recording audio could not be opened.");
    const take = (await all(db, tuneId)).find((take) => take.id === id);
    clearStorageError("recordings-audio");
    return take?.blob ?? null;
  } catch (error) {
    reportStorageError("recordings-audio", error, "Recording audio could not be read. Retry its player in Progress; the saved recording has not been removed.");
    throw error;
  } finally { db?.close(); }
}

/** Stop is idempotent, including unsupported capture and recorder errors. */
export function record(stream: MediaStream): Recording {
  try {
    const rec = new MediaRecorder(stream);
    const parts: Blob[] = [];
    let stopped: Promise<Blob | null> | null = null;
    let finish: ((blob: Blob | null) => void) | null = null;
    let failed = false;
    const audio = () => !failed && parts.length ? new Blob(parts, { type: rec.mimeType }) : null;
    rec.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    rec.onerror = () => {
      failed = true;
      if (rec.state !== "inactive") { try { rec.stop(); } catch { /* Already failed. */ } }
      finish?.(null);
    };
    rec.onstop = () => finish?.(audio());
    rec.start(1000);
    return {
      stop: () => {
        if (stopped) return stopped;
        stopped = new Promise((resolve) => {
          finish = resolve;
          if (failed || rec.state === "inactive") { resolve(audio()); return; }
          try { rec.stop(); } catch { resolve(null); }
        });
        return stopped;
      },
    };
  } catch { return { stop: async () => null }; }
}

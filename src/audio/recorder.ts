// Takes: the player's own sound, recorded during a run-through and kept on this machine
// (IndexedDB; audio is too big for localStorage). The first and the latest take of a tune can be
// played back to back, so progress is heard rather than read. Only the most recent takes are kept.

const DB = "guitar-recordings";
const STORE = "takes";
const KEEP = 10; // per tune, besides its very first take

export interface TakeMeta {
  id: string;
  tuneId: string;
  cardId: string;
  day: string;
  at: number; // Date.now()
  bpm: number;
  share: number | null;
}

export interface StoredTake extends TakeMeta {
  blob: Blob;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("tune", "tuneId");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function all(db: IDBDatabase, tuneId: string): Promise<StoredTake[]> {
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).index("tune").getAll(tuneId);
    req.onsuccess = () => resolve((req.result as StoredTake[]).sort((a, b) => a.at - b.at));
    req.onerror = () => resolve([]);
  });
}

/** Which takes to drop: all but the first and the newest `keep`. */
export function toDrop(takes: TakeMeta[], keep = KEEP): string[] {
  const sorted = [...takes].sort((a, b) => a.at - b.at);
  return sorted.slice(1, Math.max(1, sorted.length - keep)).map((t) => t.id);
}

export async function saveTake(meta: TakeMeta, blob: Blob): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const takes = await all(db, meta.tuneId);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ ...meta, blob });
    for (const id of toDrop([...takes, meta])) store.delete(id);
    await completed(tx);
  } catch {
    // not kept
  } finally {
    db.close();
  }
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The recording could not be saved."));
  });
}

/** Full immutable recording inventory, including takes whose tune is no longer in the library. */
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

/** A transferred take is acknowledged only after its IndexedDB transaction commits. */
export async function storeTransferredTake(take: StoredTake): Promise<void> {
  const db = await open();
  if (!db) throw new Error("Recordings could not be saved on this device.");
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(take);
    await completed(tx);
  } finally { db.close(); }
}

export async function listTakes(tuneId: string): Promise<TakeMeta[]> {
  const db = await open();
  if (!db) return [];
  try {
    return (await all(db, tuneId)).map(({ blob: _blob, ...meta }) => meta);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function takeAudio(tuneId: string, id: string): Promise<Blob | null> {
  const db = await open();
  if (!db) return null;
  try { return (await all(db, tuneId)).find((t) => t.id === id)?.blob ?? null; }
  finally { db.close(); }
}

/** Records the stream until `stop`, which hands back the take (null if nothing was recorded). */
export function record(stream: MediaStream): { stop(): Promise<Blob | null> } {
  try {
    const rec = new MediaRecorder(stream);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.start(1000);
    return {
      stop: () =>
        new Promise((resolve) => {
          if (rec.state === "inactive") return resolve(parts.length ? new Blob(parts, { type: rec.mimeType }) : null);
          rec.onstop = () => resolve(parts.length ? new Blob(parts, { type: rec.mimeType }) : null);
          rec.stop();
        }),
    };
  } catch {
    return { stop: async () => null };
  }
}

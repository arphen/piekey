// Large scores live outside localStorage. A new revision gets a new key, so a failed index
// update can never change the score behind the previous, successfully saved library.
const DB = "guitar-tune-files";
const STORE = "xml";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The tune database could not be opened."));
    request.onblocked = () => reject(new Error("Close other copies of the app, then reopen the library."));
  });
}

export async function writeTuneXml(ref: string, xml: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(xml, ref);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The score could not be saved."));
    });
  } finally {
    db.close();
  }
}

export async function readTuneXml(ref: string): Promise<string> {
  const db = await open();
  try {
    return await new Promise<string>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(ref);
      request.onsuccess = () => typeof request.result === "string"
        ? resolve(request.result)
        : reject(new Error("A saved score is missing. Restore it from your backup."));
      request.onerror = () => reject(request.error ?? new Error("The saved score could not be read."));
    });
  } finally {
    db.close();
  }
}

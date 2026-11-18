import { clearStorageError, getStoredItem, reportStorageError, setStoredItem } from "../storage";
import { readTuneXml, writeTuneXml } from "./database";
import { parseMusicXml, type LeadSheet } from "./musicxml";
import { recordLibraryChange } from "../sync/journal";

// Entry IDs belong to the library, never to mutable title/key/arrangement metadata. Existing IDs
// remain untouched so every saved card box and take keeps its owner.

export interface TuneEntry {
  id: string;
  name: string;
  xml: string; // kept whole, so a better reader can read it again
  partId?: string;
  voice?: string;
}

interface StoredTuneEntry extends Omit<TuneEntry, "xml"> {
  xml?: string;
  xmlRef?: string;
}

const LIBRARY_STORAGE = "guitar-tunes-v2";
const CURRENT_STORAGE = "guitar-tune";
const OLD_LIBRARY = "guitar-tunes";
export const LARGE_TUNE_CHARS = 128 * 1024;
const files = new Map<string, string>();
let saves = Promise.resolve(true);
let pendingOperations = 0;
const operationListeners = new Set<() => void>();

export const isLibraryBusy = () => pendingOperations > 0;
export function subscribeLibraryOperations(listener: () => void): () => void {
  operationListeners.add(listener);
  return () => { operationListeners.delete(listener); };
}

/** A save/restore stays guarded after its view unmounts, including queued and nested writes. */
export async function withLibraryOperation<T>(operation: () => Promise<T>): Promise<T> {
  pendingOperations++;
  try {
    if (pendingOperations === 1) operationListeners.forEach((listener) => listener());
    return await operation();
  } finally {
    if (--pendingOperations === 0) operationListeners.forEach((listener) => listener());
  }
}

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = getStoredItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  setStoredItem(key, JSON.stringify(value));
}

function storedEntries(): StoredTuneEntry[] {
  const raw = readStored<unknown>(LIBRARY_STORAGE, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is StoredTuneEntry =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as TuneEntry).id === "string" &&
      typeof (entry as TuneEntry).name === "string" &&
      (typeof (entry as StoredTuneEntry).xml === "string" || typeof (entry as StoredTuneEntry).xmlRef === "string"),
  );
}

/** Immediate cached snapshot. Await loadLibraryAsync before editing a library after a reload. */
export function loadLibrary(): TuneEntry[] {
  return storedEntries().flatMap(({ xmlRef, xml: inline, ...entry }) => {
    const xml = inline ?? (xmlRef ? files.get(xmlRef) : undefined);
    return xml === undefined ? [] : [{ ...entry, xml }];
  });
}

export async function loadLibraryAsync(): Promise<TuneEntry[]> {
  try {
    const originalIndex = getStoredItem(LIBRARY_STORAGE);
    const stored = storedEntries();
    const entries = await Promise.all(stored.map(async ({ xmlRef, xml: inline, ...entry }) => {
      const xml = inline ?? (xmlRef ? files.get(xmlRef) ?? await readTuneXml(xmlRef) : undefined);
      if (xml === undefined) throw new Error("A score could not be read.");
      if (xmlRef) files.set(xmlRef, xml);
      return { ...entry, xml };
    }));
    clearStorageError("tune-library-read");
    // A failed migration leaves the entire old localStorage entry intact and usable.
    if (getStoredItem(LIBRARY_STORAGE) !== originalIndex) return loadLibraryAsync();
    if (stored.some((entry) => entry.xml && entry.xml.length >= LARGE_TUNE_CHARS)) await saveLibrary(entries, originalIndex);
    return entries;
  } catch (error) {
    reportStorageError("tune-library-read", error, "The tune library could not be opened. Your saved library is unchanged; reopen it or restore a backup.");
    throw error;
  }
}

export function saveLibrary(entries: TuneEntry[], expectedIndex?: string | null, journal = true): Promise<boolean> {
  const snapshot = entries.map((entry) => ({ ...entry }));
  const save = async () => {
    try {
      // An obsolete hydration/migration must not overwrite a newer user edit queued before it.
      if (expectedIndex !== undefined && getStoredItem(LIBRARY_STORAGE) !== expectedIndex) return true;
      const previous = storedEntries();
      const previousFull = loadLibrary();
      if (previous.some((entry) => entry.xmlRef && !files.has(entry.xmlRef) && !snapshot.some((next) => next.id === entry.id)))
        throw new Error("Open the saved library before changing it.");
      if (new Set(snapshot.map((entry) => entry.id)).size !== snapshot.length) throw new Error("Duplicate tune identities cannot be saved.");
      const next: StoredTuneEntry[] = [];
      for (const { xml, ...entry } of snapshot) {
        if (xml.length < LARGE_TUNE_CHARS) {
          next.push({ ...entry, xml });
          continue;
        }
        const old = previous.find((item) => item.id === entry.id);
        let xmlRef = old?.xmlRef && files.get(old.xmlRef) === xml ? old.xmlRef : undefined;
        if (!xmlRef) {
          xmlRef = `xml-${newTuneId()}`;
          await writeTuneXml(xmlRef, xml);
          files.set(xmlRef, xml);
        }
        next.push({ ...entry, xmlRef });
      }
      const saved = setStoredItem(LIBRARY_STORAGE, JSON.stringify(next));
      if (saved && expectedIndex === undefined && journal) recordLibraryChange(previousFull, snapshot);
      if (saved) clearStorageError("tune-library-save");
      return saved;
    } catch (error) {
      reportStorageError("tune-library-save", error, "The tune library could not be saved. Your previous library is unchanged. Export a backup or free browser storage, then try again.");
      return false;
    }
  };
  saves = saves.then(save, save);
  const pendingSave = saves;
  return withLibraryOperation(() => pendingSave);
}

export function newTuneId(): string {
  if (typeof crypto.randomUUID === "function") return `tune-${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `tune-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function sameTuneContent(a: Pick<TuneEntry, "xml" | "partId" | "voice">, b: Pick<TuneEntry, "xml" | "partId" | "voice">): boolean {
  if (a.xml.replace(/\r\n/g, "\n").trim() !== b.xml.replace(/\r\n/g, "\n").trim()) return false;
  try {
    const left = parseMusicXml(a.xml, "Untitled", a).source;
    const right = parseMusicXml(b.xml, "Untitled", b).source;
    return left?.partId === right?.partId && left?.voice === right?.voice;
  } catch { return false; }
}

/** All consumers must parse through this seam to preserve the entry's durable identity. */
export function parseTuneEntry(entry: TuneEntry): LeadSheet {
  return { ...parseMusicXml(entry.xml, entry.name, { partId: entry.partId, voice: entry.voice }), id: entry.id };
}

export function loadCurrentTuneId(): string | null {
  const id = readStored<unknown>(CURRENT_STORAGE, null);
  return typeof id === "string" ? id : null;
}

export function saveCurrentTuneId(id: string): void {
  writeStored(CURRENT_STORAGE, id);
}

export function hasOldLibrary(): boolean {
  try {
    return Boolean(localStorage.getItem(OLD_LIBRARY));
  } catch {
    return false;
  }
}

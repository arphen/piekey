import { clearStorageError, getStoredItem, reportStorageError, setStoredItem } from "../storage";
import { readTuneXml, writeTuneXml } from "./database";
import { parseMusicXml, type LeadSheet } from "./musicxml";
import { recordLibraryChange, recordLibraryRemoval } from "../sync/journal";

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

export interface LibraryIssue {
  id: string;
  name: string;
  kind: "missing" | "invalid";
  message: string;
}

const LIBRARY_STORAGE = "guitar-tunes-v2";
const CURRENT_STORAGE = "guitar-tune";
const OLD_LIBRARY = "guitar-tunes";
export const LARGE_TUNE_CHARS = 128 * 1024;
const files = new Map<string, string>();
let saves = Promise.resolve(true);
let pendingOperations = 0;
const operationListeners = new Set<() => void>();
let libraryIssues: readonly LibraryIssue[] = [];
const issueListeners = new Set<() => void>();

export const getLibraryIssues = (): readonly LibraryIssue[] => libraryIssues;
export function subscribeLibraryIssues(listener: () => void): () => void {
  issueListeners.add(listener);
  return () => { issueListeners.delete(listener); };
}

function publishLibraryIssues(next: LibraryIssue[]) {
  if (JSON.stringify(next) !== JSON.stringify(libraryIssues)) {
    libraryIssues = next;
    issueListeners.forEach((listener) => listener());
  }
  if (next.length) {
    const names = next.slice(0, 3).map((issue) => issue.name).join(", ");
    reportStorageError("tune-library-read", null, `Scores need repair: ${names}${next.length > 3 ? ` and ${next.length - 3} more` : ""}. Healthy tunes remain available. Open Song's library to re-import or remove these entries.`);
  } else clearStorageError("tune-library-read");
}

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
  const stored = getStoredItem(LIBRARY_STORAGE);
  const raw: unknown = stored === null ? [] : JSON.parse(stored);
  if (!Array.isArray(raw) || !raw.every(
    (entry): entry is StoredTuneEntry =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as TuneEntry).id === "string" &&
      Boolean((entry as TuneEntry).id) &&
      typeof (entry as TuneEntry).name === "string",
  ) || new Set(raw.map((entry: StoredTuneEntry) => entry.id)).size !== raw.length)
    throw new Error("The saved tune library index is unreadable. Restore a backup before changing it.");
  return raw;
}

function cachedXml(entry: StoredTuneEntry): string | undefined {
  return typeof entry.xml === "string" ? entry.xml : typeof entry.xmlRef === "string" ? files.get(entry.xmlRef) : undefined;
}

function usableEntries(stored: StoredTuneEntry[]): { entries: TuneEntry[]; issues: LibraryIssue[] } {
  const entries: TuneEntry[] = [];
  const issues: LibraryIssue[] = [];
  for (const saved of stored) {
    const xml = cachedXml(saved);
    if (xml === undefined) {
      issues.push({ id: saved.id, name: saved.name, kind: "missing", message: "The saved score file could not be read. Re-import it to keep this tune's identity and practice history." });
      continue;
    }
    const { xmlRef: _ref, ...metadata } = saved;
    const entry: TuneEntry = { ...metadata, xml };
    try {
      parseTuneEntry(entry);
      entries.push(entry);
    } catch (error) {
      issues.push({ id: saved.id, name: saved.name, kind: "invalid", message: error instanceof Error ? error.message : "The saved score is unreadable." });
    }
  }
  return { entries, issues };
}

/** Immediate cached snapshot. Await loadLibraryAsync before editing a library after a reload. */
export function loadLibrary(): TuneEntry[] {
  try { return usableEntries(storedEntries()).entries; }
  catch (error) {
    reportStorageError("tune-library-read", error, "The tune library index could not be opened. Your saved data is unchanged; restore a backup before changing the library.");
    return [];
  }
}

export async function loadLibraryAsync(): Promise<TuneEntry[]> {
  try {
    const originalIndex = getStoredItem(LIBRARY_STORAGE);
    const stored = storedEntries();
    await Promise.all(stored.map(async (entry) => {
      if (cachedXml(entry) !== undefined || typeof entry.xmlRef !== "string") return;
      try {
        const xml = await readTuneXml(entry.xmlRef);
        if (typeof xml === "string") files.set(entry.xmlRef, xml);
      } catch { /* Keep this entry and its reference available for repair; other tunes can open. */ }
    }));
    // A failed migration leaves the entire old localStorage entry intact and usable.
    if (getStoredItem(LIBRARY_STORAGE) !== originalIndex) return loadLibraryAsync();
    const { entries, issues } = usableEntries(stored);
    publishLibraryIssues(issues);
    if (stored.some((entry) => typeof entry.xml === "string" && entry.xml.length >= LARGE_TUNE_CHARS)) {
      await saveLibrary(entries, originalIndex);
      // A queued edit can finish while migration waits. Return the same current index it saved.
      if (getStoredItem(LIBRARY_STORAGE) !== originalIndex) return loadLibraryAsync();
    }
    return entries;
  } catch (error) {
    reportStorageError("tune-library-read", error, "The tune library could not be opened. Your saved library is unchanged; reopen it or restore a backup.");
    throw error;
  }
}

/** Complete exports and device exchange must never silently omit an unreadable score. */
export async function loadCompleteLibraryAsync(): Promise<TuneEntry[]> {
  await loadLibraryAsync();
  // Validate and return one snapshot; another read/save may have updated the published issues.
  const { entries, issues } = usableEntries(storedEntries());
  publishLibraryIssues(issues);
  if (issues.length) throw new Error(`Repair or remove these scores in Song's library before exporting or exchanging the complete library: ${issues.map((issue) => issue.name).join(", ")}. Healthy tunes are still available for practice.`);
  return entries;
}

export function saveLibrary(entries: TuneEntry[], expectedIndex?: string | null, journal = true): Promise<boolean> {
  return saveLibrarySnapshot(entries, expectedIndex, journal);
}

function saveLibrarySnapshot(entries: TuneEntry[], expectedIndex?: string | null, journal = true, removedIds: ReadonlySet<string> = new Set()): Promise<boolean> {
  const snapshot = entries.map((entry) => ({ ...entry }));
  const save = async () => {
    try {
      // An obsolete hydration/migration must not overwrite a newer user edit queued before it.
      if (expectedIndex !== undefined && getStoredItem(LIBRARY_STORAGE) !== expectedIndex) return true;
      const previous = storedEntries();
      const { entries: previousFull, issues } = usableEntries(previous);
      const unavailable = new Set(issues.map((issue) => issue.id));
      if (new Set(snapshot.map((entry) => entry.id)).size !== snapshot.length) throw new Error("Duplicate tune identities cannot be saved.");
      for (const entry of snapshot) parseTuneEntry(entry);
      // A healthy-only read is never permission to delete an unreadable file/reference.
      const next: StoredTuneEntry[] = previous.filter((entry) => unavailable.has(entry.id) && !removedIds.has(entry.id) && !snapshot.some((item) => item.id === entry.id));
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
      if (saved && expectedIndex === undefined && journal) {
        recordLibraryChange(previousFull, snapshot);
        for (const id of removedIds) if (unavailable.has(id)) recordLibraryRemoval(id);
      }
      publishLibraryIssues(usableEntries(next).issues);
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

/** Explicit removal is separate from saving the usable portion of a damaged library. */
export async function removeLibraryEntry(id: string): Promise<boolean> {
  return withLibraryOperation(async () => {
    const entries = await loadLibraryAsync();
    return saveLibrarySnapshot(entries.filter((entry) => entry.id !== id), undefined, true, new Set([id]));
  });
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

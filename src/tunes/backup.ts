import { clearStorageError, getStoredItem, pendingStorageWrites, removeStoredItem, reportStorageError, setStoredItem, storedKeys } from "../storage";
import { loadCompleteLibraryAsync, loadLibraryAsync, parseTuneEntry, saveLibrary, withLibraryOperation, type TuneEntry } from "./library";
import { recordLibraryChange, recordStorageChange } from "../sync/journal";
import { syncableStorageKey, validAttemptConditions, validGoalData } from "../sync/model";
import { CURRICULUM_KEY, validCurriculumConfig } from "../song/curriculum";
import { CUSTOM_EXERCISES_KEY, validCustomExerciseBook } from "../song/customExercises";
import { whilePracticeIdle } from "../platform/practiceWindow";

const LIBRARY = "guitar-tunes-v2";
const FORMAT = "fretboard-focus-backup";

export interface PracticeBackup {
  format: typeof FORMAT;
  version: 1;
  createdAt: string;
  recordings: "excluded";
  tunes: TuneEntry[];
  storage: Record<string, string>;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && value >= 0 && Number.isInteger(value);
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const share = (value: unknown) => finite(value) && value >= 0 && value <= 1;
const result = (value: unknown) => typeof value === "string" && ["clean", "ok", "fail", "skip"].includes(value);
const tally = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(count) && value[1] <= value[0];

function validCard(value: unknown): boolean {
  return record(value) && count(value.box) && value.box >= 1 && value.box <= 5 && typeof value.due === "string"
    && finite(value.bpm) && value.bpm > 0 && count(value.seen) && count(value.clean)
    && optional(value.last, (last) => last === null || result(last))
    && optional(value.bestCleanBpm, (bpm) => finite(bpm) && bpm > 0)
    && optional(value.excluded, (flag) => typeof flag === "boolean");
}

function validEvidence(value: unknown): boolean {
  if (!record(value) || ![value.notes, value.leap, value.cross, value.shift].every(tally)
    || !count(value.restarts) || !count(value.hears) || !Array.isArray(value.wrong)
    || !value.wrong.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(finite))) return false;
  if (!optional(value.weakBars, (bars) => Array.isArray(bars) && bars.every(count))) return false;
  return optional(value.time, (time) => record(time) && count(time.n) && finite(time.mean)
    && finite(time.spread) && time.spread >= 0 && count(time.rush) && count(time.drag));
}

function validAttempt(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.day === "string" && result(value.result)
    && finite(value.bpm) && value.bpm > 0 && finite(value.secs) && value.secs >= 0
    && optional(value.share, (number) => number === null || share(number))
    && optional(value.from, count) && optional(value.to, count)
    && optional(value.at, (at) => finite(at) && at >= 0)
    && optional(value.goalBpm, (bpm) => finite(bpm) && bpm > 0) && optional(value.ev, validEvidence)
    && optional(value.conditions, validAttemptConditions)
    && optional(value.arrangementFingerprint, (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128);
}

function validSession(value: unknown): boolean {
  return record(value) && typeof value.date === "string" && finite(value.minutes) && value.minutes >= 0
    && count(value.cards) && count(value.clean) && optional(value.share, share);
}

function validSettings(value: unknown): boolean {
  if (!record(value)) return false;
  return optional(value.newPerSession, count)
    && [value.guide, value.voice, value.shuffle, value.mix, value.gapClick].every((flag) => optional(flag, (entry) => typeof entry === "boolean"))
    && optional(value.window, (fret) => fret === null || count(fret))
    && optional(value.length, (length) => typeof length === "string" && ["short", "normal", "long"].includes(length))
    && optional(value.loop, (mode) => typeof mode === "string" && ["adaptive", "turnaround", "continuous"].includes(mode));
}

function validPracticeStore(value: unknown, shared = false): boolean {
  if (!record(value) || value.v !== 1 || !record(value.cards) || !Object.values(value.cards).every(validCard)) return false;
  if (!optional(value.credit, (credit) => record(credit) && Object.values(credit).every((number) => finite(number) && number >= 0))) return false;
  if (shared) return true;
  return Array.isArray(value.sessions) && value.sessions.every(validSession)
    && optional(value.settings, validSettings)
    && optional(value.history, (history) => Array.isArray(history) && history.every(validAttempt))
    && optional(value.meta, (meta) => record(meta) && typeof meta.title === "string" && typeof meta.key === "string");
}

/** The score XML travels in the file, never as a machine-local IndexedDB reference. */
export async function createBackup(): Promise<PracticeBackup> {
  const tunes = await loadCompleteLibraryAsync();
  const storage: Record<string, string> = {};
  for (const key of storedKeys()) {
    if (!syncableStorageKey(key)) continue;
    const value = getStoredItem(key);
    if (value !== null) storage[key] = value;
  }
  for (const [key, value] of pendingStorageWrites()) {
    if (!syncableStorageKey(key)) continue;
    if (value === null) delete storage[key];
    else storage[key] = value;
  }
  return { format: FORMAT, version: 1, createdAt: new Date().toISOString(), recordings: "excluded", tunes, storage };
}

export function parseBackup(raw: string): PracticeBackup {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("That file is not a practice backup.");
  const backup = value as Partial<PracticeBackup>;
  if (backup.format !== FORMAT || backup.version !== 1 || !Array.isArray(backup.tunes) || !backup.storage || typeof backup.storage !== "object" || Array.isArray(backup.storage))
    throw new Error("That backup format is not supported.");
  const ids = new Set<string>();
  for (const entry of backup.tunes) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || typeof entry.xml !== "string" || entry.xml.length > 20 * 1024 * 1024 || (entry.partId !== undefined && typeof entry.partId !== "string") || (entry.voice !== undefined && typeof entry.voice !== "string"))
      throw new Error("The backup contains an invalid tune.");
    if (ids.has(entry.id)) throw new Error("The backup contains duplicate tune identities.");
    ids.add(entry.id);
    parseTuneEntry(entry); // reject a broken score before touching any saved state
  }
  const portable: Record<string, string> = {};
  for (const [key, entry] of Object.entries(backup.storage)) {
    if (!key.startsWith("guitar-") || key === LIBRARY || typeof entry !== "string") throw new Error("The backup contains an invalid setting.");
    // Older JSON backups included hardware setup. Read them compatibly, while preserving the
    // receiving browser's input, output, calibration and latency rather than restoring those.
    if (!syncableStorageKey(key)) continue;
    portable[key] = entry;
    if (key.startsWith("guitar-song-deck:") || key === "guitar-skills") {
      let store: unknown;
      try { store = JSON.parse(entry); } catch { throw new Error("A practice history in the backup is not readable."); }
      if (!validPracticeStore(store, key === "guitar-skills"))
        throw new Error("A practice history in the backup is invalid.");
    }
    if (key === "guitar-goals-v1") {
      let goals: unknown;
      try { goals = JSON.parse(entry); } catch { throw new Error("The musical goals in the backup are not readable."); }
      if (!validGoalData(goals)) throw new Error("The musical goals in the backup are invalid.");
    }
    if (key === CUSTOM_EXERCISES_KEY) {
      let book: unknown;
      try { book = JSON.parse(entry); } catch { throw new Error("The custom exercises in the backup are not readable."); }
      if (!validCustomExerciseBook(book)) throw new Error("The custom exercises in the backup are invalid.");
    }
    if (key === CURRICULUM_KEY) {
      let curriculum: unknown;
      try { curriculum = JSON.parse(entry); } catch { throw new Error("The curriculum settings in the backup are not readable."); }
      if (!validCurriculumConfig(curriculum)) throw new Error("The curriculum settings in the backup are invalid.");
    }
  }
  return { format: FORMAT, version: 1, createdAt: typeof backup.createdAt === "string" ? backup.createdAt : "", recordings: "excluded", tunes: backup.tunes, storage: portable };
}

/** Merge tunes; replace matching IDs/settings only. Roll back all local writes on a failure. */
export async function restoreBackup(backup: PracticeBackup): Promise<boolean> {
  let restored = false;
  try {
    const idle = await whilePracticeIdle(async () => { restored = await restoreBackupData(backup); });
    if (!idle) reportStorageError("backup-restore", new Error("Another writer is active"), "Finish practice or close Devices in other app windows before restoring. A browser with Web Locks is required for safe restore.");
    return idle && restored;
  } catch (error) {
    reportStorageError("backup-restore", error, "The backup could not be opened safely. Keep the file and try again after closing other app windows.");
    return false;
  }
}

function restoreBackupData(backup: PracticeBackup): Promise<boolean> {
  return withLibraryOperation(async () => {
    const before = new Map<string, string | null>();
    let previousTunes: TuneEntry[] = [];
    let restoredTunes: TuneEntry[] = [];
    let restoredStorage: Record<string, string> = {};
    try {
      const checked = parseBackup(JSON.stringify(backup));
      // A complete backup can recover missing IndexedDB files too. The save guard still refuses
      // to drop any unreadable score that the backup does not replace.
      const current = await loadLibraryAsync();
      const incoming = new Set(checked.tunes.map((entry) => entry.id));
      const merged = [...current.filter((entry) => !incoming.has(entry.id)), ...checked.tunes];
      previousTunes = current;
      restoredTunes = merged;
      restoredStorage = checked.storage;
      for (const key of [LIBRARY, ...Object.keys(checked.storage)]) before.set(key, getStoredItem(key));
      for (const [key, value] of Object.entries(checked.storage))
        if (!setStoredItem(key, value, false)) throw new Error("A setting could not be restored.");
      if (!await saveLibrary(merged, undefined, false)) throw new Error("The tune library could not be restored.");
      clearStorageError("backup-restore");
    } catch (error) {
      let rolledBack = true;
      for (const [key, value] of before) {
        const saved = value === null ? removeStoredItem(key, false) : setStoredItem(key, value, false);
        rolledBack = saved && rolledBack;
      }
      reportStorageError("backup-restore", error, rolledBack
        ? "The backup could not be restored. Previous saved data has been kept. Free browser storage and try again."
        : "The backup could not be fully restored. Keep your backup file, free browser storage, then restore it again.");
      return false;
    }
    for (const [key, value] of Object.entries(restoredStorage)) recordStorageChange(key, before.get(key) ?? null, value, "Restore backup");
    recordLibraryChange(previousTunes, restoredTunes, "Restore backup");
    return true;
  });
}

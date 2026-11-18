// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearStorageError, getStorageIssues, retryStorageWrites, setStoredItem } from "../storage";
import { loadStore } from "../song/leitner";
import { createBackup, parseBackup, restoreBackup } from "../tunes/backup";
import { writeTuneXml } from "../tunes/database";
import { getLibraryIssues, LARGE_TUNE_CHARS, loadCompleteLibraryAsync, loadLibraryAsync, removeLibraryEntry, saveLibrary } from "../tunes/library";

const database = vi.hoisted(() => ({ files: new Map<string, string>(), fail: false }));
vi.mock("../platform/practiceWindow", () => ({ whilePracticeIdle: async (action: () => Promise<void>) => { await action(); return true; } }));
vi.mock("../tunes/database", () => ({
  writeTuneXml: vi.fn(async (ref: string, xml: string) => {
    if (database.fail) throw new Error("database unavailable");
    database.files.set(ref, xml);
  }),
  readTuneXml: vi.fn(async (ref: string) => {
    const xml = database.files.get(ref);
    if (database.fail || xml === undefined) throw new Error("score missing");
    return xml;
  }),
}));

const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
const entry = { id: "preserved-id", name: "A tune", xml };
const large = { ...entry, xml: xml + `<!--${"x".repeat(LARGE_TUNE_CHARS)}-->` };

beforeEach(() => {
  vi.restoreAllMocks();
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => { kept.set(key, value); },
    removeItem: (key: string) => { kept.delete(key); },
    clear: () => kept.clear(),
    key: (index: number) => [...kept.keys()][index] ?? null,
    get length() { return kept.size; },
  });
  retryStorageWrites();
  localStorage.clear();
  for (const issue of getStorageIssues()) clearStorageError(issue.area);
  database.files.clear();
  database.fail = false;
});

describe("durable tune library", () => {
  it("opens healthy scores while retaining missing and invalid entries through ordinary saves", async () => {
    const missing = { id: "missing-score", name: "Missing study", xmlRef: "missing-ref" };
    const invalid = { id: "invalid-score", name: "Unreadable study", xml: "<not-a-score/>" };
    localStorage.setItem("guitar-tunes-v2", JSON.stringify([missing, entry, invalid]));
    expect(await loadLibraryAsync()).toEqual([entry]);
    expect(getLibraryIssues().map((issue) => [issue.id, issue.kind])).toEqual([[missing.id, "missing"], [invalid.id, "invalid"]]);
    const issues = getLibraryIssues();
    await loadLibraryAsync();
    expect(getLibraryIssues()).toBe(issues); // React's external-store snapshot must stay stable.
    expect(await saveLibrary([entry, { ...entry, id: "new-healthy" }])).toBe(true);
    const saved = JSON.parse(localStorage.getItem("guitar-tunes-v2")!);
    expect(saved).toContainEqual(missing);
    expect(saved).toContainEqual(invalid);
    expect((await loadLibraryAsync()).map((tune) => tune.id)).toEqual([entry.id, "new-healthy"]);
    await expect(createBackup()).rejects.toThrow("Missing study");
    await expect(loadCompleteLibraryAsync()).rejects.toThrow("Unreadable study");
  });

  it("repairs the same identity and explicitly removes an unrecoverable entry with a durable tombstone", async () => {
    const damaged = { id: "repair-this-id", name: "Repair me", xmlRef: "lost-repair-ref" };
    const discarded = { id: "remove-this-id", name: "Remove me", xmlRef: "lost-remove-ref" };
    const historyKey = `guitar-song-deck:${damaged.id}`;
    const history = JSON.stringify({ v: 1, cards: {}, sessions: [], settings: {}, meta: { title: "My practice", key: "C" } });
    localStorage.setItem(historyKey, history);
    localStorage.setItem("guitar-tunes-v2", JSON.stringify([entry, damaged, discarded]));
    const healthy = await loadLibraryAsync();
    const repaired = { ...entry, id: damaged.id, name: damaged.name };
    expect(await saveLibrary([...healthy, repaired])).toBe(true);
    expect((await loadLibraryAsync()).find((tune) => tune.id === damaged.id)).toEqual(repaired);
    expect(getLibraryIssues().map((issue) => issue.id)).toEqual([discarded.id]);
    expect(localStorage.getItem(historyKey)).toBe(history);
    expect(await removeLibraryEntry(discarded.id)).toBe(true);
    expect(getLibraryIssues()).toEqual([]);
    expect(await loadCompleteLibraryAsync()).toEqual([entry, repaired]);
    const batches = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("fretboard-sync-outbox-v1:")))
      .map((key) => JSON.parse(localStorage.getItem(key)!) as { changes: { kind: string; key: string; after: string | null }[] });
    expect(batches.flatMap((batch) => batch.changes)).toContainEqual(expect.objectContaining({ kind: "tune", key: discarded.id, after: null }));
  });

  it("refuses to overwrite an unreadable index with a healthy-only or empty snapshot", async () => {
    const before = '{"unexpected":"index"}';
    localStorage.setItem("guitar-tunes-v2", before);
    await expect(loadLibraryAsync()).rejects.toThrow("index");
    expect(await saveLibrary([entry])).toBe(false);
    expect(localStorage.getItem("guitar-tunes-v2")).toBe(before);
  });

  it("migrates large inline scores and reloads them without changing identity", async () => {
    localStorage.setItem("guitar-tunes-v2", JSON.stringify([large]));
    await loadLibraryAsync();
    const stored = JSON.parse(localStorage.getItem("guitar-tunes-v2")!);
    expect(stored[0].xml).toBeUndefined();
    vi.resetModules();
    const fresh = await import("../tunes/library");
    expect(await fresh.loadLibraryAsync()).toEqual([large]);
  });

  it("leaves the old inline library intact if migration cannot save its XML", async () => {
    const before = JSON.stringify([large]);
    localStorage.setItem("guitar-tunes-v2", before);
    database.fail = true;
    expect(await loadLibraryAsync()).toEqual([large]);
    expect(localStorage.getItem("guitar-tunes-v2")).toBe(before);
    expect(getStorageIssues().some((issue) => issue.area === "tune-library-save")).toBe(true);
  });

  it("does not let a stale migration overwrite a newer library", async () => {
    const old = JSON.stringify([large]);
    localStorage.setItem("guitar-tunes-v2", old);
    await saveLibrary([entry, { ...entry, id: "added-later" }]);
    await saveLibrary([large], old);
    expect((await loadLibraryAsync()).map((tune) => tune.id)).toEqual([entry.id, "added-later"]);
  });

  it("includes scores saved while a complete backup waits for library migration", async () => {
    let releaseMigration!: () => void;
    let migrationStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseMigration = resolve; });
    const started = new Promise<void>((resolve) => { migrationStarted = resolve; });
    vi.mocked(writeTuneXml).mockImplementationOnce(async (ref, score) => {
      migrationStarted();
      await blocked;
      database.files.set(ref, score);
    });
    localStorage.setItem("guitar-tunes-v2", JSON.stringify([large]));
    const backup = createBackup();
    await started;
    const latest = [entry, { ...entry, id: "added-during-migration" }];
    const saved = saveLibrary(latest);
    releaseMigration();
    expect(await saved).toBe(true);
    expect((await backup).tunes.map((tune) => tune.id)).toEqual(latest.map((tune) => tune.id));
    expect(await loadCompleteLibraryAsync()).toEqual(latest);
  });

  it("reports quota failure and keeps the previous persisted index", async () => {
    localStorage.setItem("guitar-tunes-v2", JSON.stringify([entry]));
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(await saveLibrary([entry, { ...entry, id: "other-id" }])).toBe(false);
    expect(JSON.parse(localStorage.getItem("guitar-tunes-v2")!)).toHaveLength(1);
    expect(getStorageIssues().some((issue) => issue.area === "guitar-tunes-v2")).toBe(true);
    expect((await createBackup()).tunes).toHaveLength(2); // the in-memory failed index can be rescued
  });

});

describe("one-file practice backup", () => {
  it("round-trips musical state and reads legacy backups without moving device setup", async () => {
    await saveLibrary([entry]);
    localStorage.setItem("guitar-key", "F#");
    localStorage.setItem("guitar-output", "device-123");
    const history = JSON.stringify({ v: 1, cards: {}, sessions: [], settings: {} });
    localStorage.setItem(`guitar-song-deck:${entry.id}`, history);
    const backup = parseBackup(JSON.stringify(await createBackup()));
    expect(backup.storage["guitar-output"]).toBeUndefined();
    await saveLibrary([{ ...entry, id: "unrelated-id" }]);
    localStorage.setItem("guitar-key", "A");
    localStorage.setItem("guitar-output", "this-device");
    const legacy = { ...backup, storage: { ...backup.storage, "guitar-output": "other-device" } };
    expect(await restoreBackup(legacy)).toBe(true);
    expect((await loadLibraryAsync()).map((tune) => tune.id)).toEqual(["unrelated-id", entry.id]);
    expect(localStorage.getItem("guitar-key")).toBe("F#");
    expect(localStorage.getItem("guitar-output")).toBe("this-device");
    expect(localStorage.getItem(`guitar-song-deck:${entry.id}`)).toBe(history);
    expect(backup.recordings).toBe("excluded");
  });

  it("rejects malformed practice shapes before replacing saved history", async () => {
    await saveLibrary([entry]);
    const original = JSON.stringify({ v: 1, cards: {}, sessions: [], settings: {} });
    localStorage.setItem("guitar-song-deck:preserved-id", original);
    const backup = await createBackup();
    const malformed = { ...backup, storage: { "guitar-song-deck:preserved-id": JSON.stringify({ v: 1, cards: {}, sessions: [], history: {} }) } };
    expect(() => parseBackup(JSON.stringify(malformed))).toThrow("practice history");
    expect(await restoreBackup(malformed)).toBe(false);
    expect(localStorage.getItem("guitar-song-deck:preserved-id")).toBe(original);
  });

  it("recovers a missing IndexedDB score from a complete backup without changing its ID", async () => {
    await saveLibrary([entry]);
    const backup = await createBackup();
    localStorage.setItem("guitar-tunes-v2", JSON.stringify([{ id: entry.id, name: entry.name, xmlRef: "missing-file" }]));
    expect(await restoreBackup(backup)).toBe(true);
    expect(await loadLibraryAsync()).toEqual([entry]);
  });

  it("rolls back to effective unsaved progress if any restore write fails", async () => {
    await saveLibrary([entry]);
    const key = `guitar-song-deck:${entry.id}`;
    const progress = { v: 1, cards: {}, sessions: [], settings: {}, meta: { title: "Latest playing", key: "C" } };
    const backup = { ...await createBackup(), storage: { [key]: JSON.stringify({ ...progress, meta: { title: "Older playing", key: "C" } }) } };
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    setStoredItem(key, JSON.stringify(progress)); // newest practice has not reached disk
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(await restoreBackup(backup)).toBe(false);
    expect(loadStore(entry.id).meta?.title).toBe("Latest playing");
    expect(getStorageIssues().some((issue) => issue.area === "backup-restore")).toBe(true);
  });
});

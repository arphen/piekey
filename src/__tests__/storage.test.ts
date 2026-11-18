// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearStorageError, getStorageIssues, retryStorageWrites, setStoredItem } from "../storage";
import { loadStore } from "../song/leitner";
import { createBackup, parseBackup, restoreBackup } from "../tunes/backup";
import { LARGE_TUNE_CHARS, loadLibraryAsync, saveLibrary } from "../tunes/library";

const database = vi.hoisted(() => ({ files: new Map<string, string>(), fail: false }));
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
  it("round-trips XML, plain device/key settings and progress while keeping unrelated tunes", async () => {
    await saveLibrary([entry]);
    localStorage.setItem("guitar-key", "F#");
    localStorage.setItem("guitar-output", "device-123");
    const history = JSON.stringify({ v: 1, cards: {}, sessions: [], settings: {} });
    localStorage.setItem(`guitar-song-deck:${entry.id}`, history);
    const backup = parseBackup(JSON.stringify(await createBackup()));
    await saveLibrary([{ ...entry, id: "unrelated-id" }]);
    localStorage.setItem("guitar-key", "A");
    expect(await restoreBackup(backup)).toBe(true);
    expect((await loadLibraryAsync()).map((tune) => tune.id)).toEqual(["unrelated-id", entry.id]);
    expect(localStorage.getItem("guitar-key")).toBe("F#");
    expect(localStorage.getItem("guitar-output")).toBe("device-123");
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

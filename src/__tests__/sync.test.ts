// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactValues, parseSyncSnapshot, unionTransactions, type SyncTransaction } from "../sync/model";
import { projectTransactions } from "../sync/merge";

const key = "guitar-song-deck:tune-1";
const card = (box = 2, seen = 1, clean = 1, last = "clean") => ({ box, seen, clean, last, bpm: 84, due: "2026-11-19", bestCleanBpm: 80 });
const attempt = (uid: string, result = "clean") => ({ uid, id: "mel:one", day: "2026-11-18", at: 100, result, bpm: 80, goalBpm: 100, secs: 20, share: 0.9, from: 2, to: result === "fail" ? 1 : 3, timingMeasured: true });
const store = (state = card(), history = [attempt("old")]) => ({ v: 1, cards: { "mel:one": state }, credit: {}, history, sessions: [], settings: { guide: false, voice: false, window: null, newPerSession: 4 } });
const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

function transaction(device: string, seq: number, before: unknown, after: unknown, options: Partial<SyncTransaction> = {}): SyncTransaction {
  const raw = (value: unknown) => value === null ? null : JSON.stringify(value);
  return { v: 1, id: `${device}:${seq}`, device, seq, clock: seq, at: 100, context: {}, kind: "storage", key, before: raw(before), after: raw(after), ...(!options.baseline && !options.reset ? compactValues(raw(before), raw(after), options.key ?? key) : {}), ...options };
}
const envelope = (transactions: SyncTransaction[]) => ({ format: "fretboard-focus-sync", version: 1, device: "test", createdAt: "", transactions });
const valueAt = (transactions: SyncTransaction[], storageKey = key) => JSON.parse(projectTransactions(transactions).storage.get(storageKey)!);
const outboxes = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((entry) => entry?.startsWith("fretboard-sync-outbox-v1:"));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => kept.get(name) ?? null,
    setItem: (name: string, value: string) => { kept.set(name, value); },
    removeItem: (name: string) => { kept.delete(name); },
    clear: () => kept.clear(), key: (index: number) => [...kept.keys()][index] ?? null,
    get length() { return kept.size; },
  });
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});

describe("transaction replay", () => {
  it("retains both offline attempts, replays a fail, and makes repeated/reordered exchange a no-op", () => {
    const initial = store();
    const baseline = transaction("base", 1, null, initial, { baseline: true });
    const a = transaction("a", 1, initial, store(card(3, 2, 2), [...initial.history, attempt("a")]), { clock: 2, context: { base: 1 } });
    const b = transaction("b", 1, initial, store(card(1, 2, 1, "fail"), [...initial.history, attempt("b", "fail")]), { clock: 3, context: { base: 1 } });
    const left = unionTransactions([baseline, a], [b, a]), right = unionTransactions([b], [a, baseline]);
    expect(projectTransactions(left)).toEqual(projectTransactions(right));
    const merged = valueAt(left);
    expect(merged.cards["mel:one"]).toMatchObject({ box: 1, seen: 3, clean: 2, bestCleanBpm: 80 });
    expect(merged.history.map((row: { uid: string }) => row.uid)).toEqual(["old", "a", "b"]);
    expect(unionTransactions(left, right)).toHaveLength(3);
  });

  it("adds independent free-play time and crosses shared kinship credit only once", () => {
    const entry = { day: "2026-11-18", key: "C-major", pattern: "run", bpm: 80, division: 1, secs: 10 };
    const free = [transaction("base", 1, null, [entry], { baseline: true, key: "guitar-freeplay" }),
      transaction("a", 1, [entry], [{ ...entry, secs: 30 }], { clock: 2, context: { base: 1 }, key: "guitar-freeplay" }),
      transaction("b", 1, [entry], [{ ...entry, secs: 50 }], { clock: 2, context: { base: 1 }, key: "guitar-freeplay" })];
    expect(valueAt(free, "guitar-freeplay")[0].secs).toBe(70);
    const initial = { v: 1, cards: { "scale:C": card() }, credit: { "scale:C": 0 } };
    const next = { ...initial, credit: { "scale:C": 0.6 } };
    const shared = [transaction("base", 1, null, initial, { baseline: true, key: "guitar-skills" }),
      transaction("a", 1, initial, next, { clock: 2, context: { base: 1 }, key: "guitar-skills" }),
      transaction("b", 1, initial, next, { clock: 2, context: { base: 1 }, key: "guitar-skills" })];
    const merged = valueAt(shared, "guitar-skills");
    expect(merged.cards["scale:C"].box).toBe(3);
    expect(merged.credit["scale:C"]).toBe(0.2);
  });

  it("replays Ear mastery with both devices' actual responses instead of merging EMA snapshots", () => {
    const progress = { stage: 0, mastery: { I: { score: 0.5, attempts: 0 } }, confusion: {}, recent: [] as number[] };
    const initial = { track: "pop", mode: "chords", settings: { instrument: "keys", pace: 1, length: 4, randomKey: true, fixedKey: 0 }, progress: { pop: progress }, stats: { rounds: 0, streak: 0, best: 0, names: { right: 0, total: 0 } } };
    const next = (score: number, attempts: number) => ({ ...initial, progress: { pop: { ...progress, mastery: { I: { score, attempts } } } }, stats: { ...initial.stats, rounds: 1 } });
    const events = [transaction("base", 1, null, initial, { baseline: true, key: "guitar-ear-v1" }),
      transaction("a", 1, initial, next(0.5 * 0.65 * 0.65 + 0.35, 2), { clock: 2, context: { base: 1 }, key: "guitar-ear-v1" }),
      transaction("b", 1, initial, next(0.5 + 0.35 * 0.5, 1), { clock: 2, context: { base: 1 }, key: "guitar-ear-v1" })];
    const merged = valueAt(events, "guitar-ear-v1");
    expect(merged.progress.pop.mastery.I.attempts).toBe(3);
    expect(merged.progress.pop.mastery.I.score).toBeCloseTo((0.5 * 0.65 * 0.65 + 0.35) * 0.65 + 0.35);
    expect(merged.stats.rounds).toBe(2);
  });

  it("keeps a tune deletion while preserving a concurrent offline score edit as a separate copy", () => {
    const tune = { id: "tune-1", name: "Original", xml };
    const baseline = transaction("base", 1, null, tune, { kind: "tune", key: tune.id, baseline: true });
    const deletion = transaction("a", 1, tune, null, { kind: "tune", key: tune.id, clock: 2, context: { base: 1 } });
    const edit = transaction("b", 1, tune, { ...tune, name: "Offline edit" }, { kind: "tune", key: tune.id, clock: 100, context: { base: 1 } });
    const merged = projectTransactions([edit, deletion, baseline]);
    expect(merged.tunes).toHaveLength(1);
    expect(merged.tunes[0]).toMatchObject({ id: "tune-1~b-1", name: "Offline edit (other device)", xml });
    expect(merged.conflicts[0].kind).toBe("tune");
  });

  it("compacts retained histories and rejects malformed rows, hardware keys and changed transaction identities", () => {
    const initial = store(card(), Array.from({ length: 800 }, (_, i) => attempt(String(i))));
    const after = { ...initial, history: [...initial.history.slice(1), attempt("new")] };
    const compact = compactValues(JSON.stringify(initial), JSON.stringify(after));
    expect(JSON.parse(compact.after!).history).toHaveLength(1);
    expect(compact.after!.length).toBeLessThan(500);
    expect(() => parseSyncSnapshot(envelope([transaction("a", 1, null, { ...initial, history: [null] })]))).toThrow("invalid practice data");
    expect(() => parseSyncSnapshot(envelope([transaction("a", 1, null, "interface-id", { key: "guitar-input" })]))).toThrow("invalid transaction");
    expect(() => parseSyncSnapshot(envelope([transaction("constructor", 1, null, initial)]))).toThrow("invalid transaction");
    const first = transaction("a", 1, null, initial);
    expect(() => unionTransactions([first], [{ ...first, at: 999 }])).toThrow("different content");
  });
});

describe("durable journal and projection", () => {
  it("honors an explicit backup restore across pairing while retaining conflicting offline transactions", async () => {
    const initial = store();
    localStorage.setItem(key, JSON.stringify(initial));
    const state = await import("../sync/state"), storage = await import("../storage"), journal = await import("../sync/journal");
    const baseline = (await state.captureSnapshot()).transactions.find((tx) => tx.key === key)!;
    const newer = { ...store(card(3, 2, 2), [...initial.history, attempt("rolled-back")]), sessions: [{ uid: "rolled-back-session", date: "2026-11-18", minutes: 1, cards: 1, clean: 1 }] };
    storage.setStoredItem(key, JSON.stringify(newer));
    await state.captureSnapshot();
    storage.setStoredItem(key, JSON.stringify(initial), false);
    journal.recordStorageChange(key, JSON.stringify(newer), JSON.stringify(initial), "Restore backup");
    const restored = await state.captureSnapshot(), reset = restored.transactions.find((tx) => tx.label === "Restore backup")!;
    expect(reset.reset).toBe(true);
    expect(reset.delta).toBeUndefined();
    expect(JSON.parse(reset.after!).history).toHaveLength(1);
    const resumed = store(card(3, 2, 2), [...initial.history, attempt("after-restore")]);
    storage.setStoredItem(key, JSON.stringify(resumed));
    const local = await state.captureSnapshot();
    const offline = transaction("offline", 1, initial, store(card(1, 2, 1, "fail"), [...initial.history, attempt("offline", "fail")]),
      { clock: 100, context: { [baseline.device]: baseline.seq } });
    const losingRestore = transaction("other-restore", 1, initial, { ...initial, cards: {}, history: [] },
      { clock: reset.clock - 1, context: { [baseline.device]: baseline.seq }, reset: true, label: "Restore backup" });
    const union = parseSyncSnapshot(envelope([...local.transactions, offline, losingRestore])).transactions;
    const projection = projectTransactions(union), merged = JSON.parse(projection.storage.get(key)!);
    expect(merged.cards["mel:one"]).toMatchObject({ seen: 2, clean: 2, box: 3 });
    expect(merged.history.map((row: { uid: string }) => row.uid)).toEqual(["old", "after-restore"]);
    expect(merged.sessions).toEqual([]);
    expect(union).toContainEqual(offline);
    expect(union).toContainEqual(losingRestore);
    expect(projection.conflicts.some((conflict) => conflict.transactionIds.includes(reset.id) && conflict.transactionIds.includes(offline.id))).toBe(true);
    expect(projectTransactions(unionTransactions(union, union))).toEqual(projection);
  });

  it("recovers a failed asynchronous journal write from its synchronous outbox without duplicating the first change", async () => {
    const initial = store(), after = store(card(3, 2, 2), [...initial.history, attempt("new")]);
    localStorage.setItem(key, JSON.stringify(initial));
    const failure = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => { throw new Error("database unavailable"); });
    const storage = await import("../storage"), journal = await import("../sync/journal");
    storage.setStoredItem(key, JSON.stringify(after));
    await expect(journal.flushSyncJournal()).rejects.toThrow("database unavailable");
    expect(outboxes()).toHaveLength(1);
    failure.mockRestore();
    vi.resetModules();
    const state = await import("../sync/state");
    const snapshot = await state.captureSnapshot();
    expect(snapshot.transactions.filter((tx) => tx.key === key)).toHaveLength(2);
    expect(valueAt(snapshot.transactions).cards["mel:one"].seen).toBe(2);
    expect(outboxes()).toHaveLength(0);
    await state.mergeSnapshot(snapshot);
    expect((await state.mergeSnapshot(snapshot)).changes).toBe(0);
  });

  it("durably retains an incoming union through quota failure and repairs it on an exchange with no new IDs", async () => {
    const initial = store(), after = store(card(3, 2, 2), [...initial.history, attempt("remote")]);
    localStorage.setItem(key, JSON.stringify(initial));
    const state = await import("../sync/state");
    const snapshot = await state.captureSnapshot(), baseline = snapshot.transactions.find((tx) => tx.key === key)!;
    const remote = transaction("remote", 1, initial, after, { clock: baseline.clock + 1, context: { [baseline.device]: baseline.seq } });
    const original = localStorage.setItem.bind(localStorage);
    const failure = vi.spyOn(localStorage, "setItem").mockImplementation((name: string, value: string) => {
      if (name === key) throw new DOMException("full", "QuotaExceededError");
      original(name, value);
    });
    await expect(state.mergeSnapshot(envelope([remote]))).rejects.toThrow("practice could not be updated");
    failure.mockRestore();
    const retried = await state.mergeSnapshot(envelope([]));
    expect(retried.added).toBe(0);
    expect(JSON.parse(localStorage.getItem(key)!).cards["mel:one"].seen).toBe(2);
    expect((await state.captureSnapshot()).transactions.map((tx) => tx.id)).toContain(remote.id);
  });
});

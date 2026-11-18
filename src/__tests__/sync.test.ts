// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactValues, parseSyncSnapshot, unionTransactions, type SyncTransaction } from "../sync/model";
import { projectTransactions } from "../sync/merge";
import { projectGoalEvidence } from "../song/goalEvidence";
import { goalProgress, type Goal } from "../song/goals";
import { projectPracticeHistory } from "../song/practiceHistory";

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
const evidenceGoal: Goal = { v: 1, id: "evidence-goal", tuneId: "tune-1", kind: "melody", createdAt: new Date(50).toISOString(), arrangement: { version: 1, fingerprint: "score-v1" }, tempo: { minBpm: 60, targetBpm: 80 }, essentialTasks: [{ cardId: "mel:one", targetBpm: 80 }] };

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

  it("unions independent first goals, keeps selection deterministic and honors an explicit restore", () => {
    const goalKey = "guitar-goals-v1";
    const goal = (id: string) => ({ v: 1, id, tuneId: "tune-1", kind: "melody", arrangement: { version: 1, fingerprint: "score-v1" }, tempo: { minBpm: 60, targetBpm: 100 }, essentialTasks: [{ cardId: "mel:one", targetBpm: 100 }], createdAt: "2026-11-18T10:00:00Z" });
    const first = (id: string) => ({ v: 1, byTune: { "tune-1": { activeId: id, goals: { [id]: goal(id) } } } });
    const a = transaction("a", 1, null, first("goal-a"), { key: goalKey });
    const b = transaction("b", 1, null, first("goal-b"), { key: goalKey });
    const union = parseSyncSnapshot(envelope([b, a, a])).transactions;
    const merged = valueAt(union, goalKey);
    expect(Object.keys(merged.byTune["tune-1"].goals)).toEqual(["goal-a", "goal-b"]);
    expect(merged.byTune["tune-1"].activeId).toBe("goal-b");
    expect(projectTransactions([a, b, b])).toEqual(projectTransactions(union));
    const deselected = { ...first("goal-a"), byTune: { "tune-1": { ...first("goal-a").byTune["tune-1"], activeId: null } } };
    const selection = transaction("a", 2, first("goal-a"), deselected, { key: goalKey, clock: 2, context: { a: 1 } });
    expect(valueAt([...union, selection], goalKey).byTune["tune-1"]).toMatchObject({ activeId: null, goals: merged.byTune["tune-1"].goals });
    const restore = transaction("restore", 1, merged, first("restored"), { key: goalKey, reset: true, clock: 3, context: { a: 2, b: 1 } });
    expect(valueAt([...union, selection, restore], goalKey)).toEqual(first("restored"));
    const changed = first("goal-a");
    changed.byTune["tune-1"].goals["goal-a"].tempo.targetBpm = 120;
    expect(() => projectTransactions([a, transaction("c", 1, null, changed, { key: goalKey })])).toThrow("same musical goal");
  });

  it("retains self-guided activity without promoting review boxes or kinship credit", () => {
    const initial = store();
    const self = { ...attempt("self"), conditions: { v: 1, source: "self", confidence: "unknown" } };
    const after = { ...store(card(5, 2, 2), [...initial.history]), credit: { "mel:one": 1 }, history: [...initial.history, self] };
    const merged = valueAt([transaction("base", 1, null, initial, { baseline: true }), transaction("a", 1, initial, after, { clock: 2, context: { base: 1 } })]);
    expect(merged.cards).toEqual(initial.cards);
    expect(merged.credit).toEqual(initial.credit);
    expect(merged.history.at(-1)).toMatchObject({ uid: "self", conditions: { source: "self" } });
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
    // A damaged local XML file can still be explicitly removed by identity alone.
    const unavailable = { ...deletion, before: null, label: "Remove unavailable score" };
    expect(projectTransactions([baseline, unavailable]).tunes).toEqual([]);
  });

  it("compacts retained histories and rejects malformed rows, hardware keys and changed transaction identities", () => {
    const initial = store(card(), Array.from({ length: 800 }, (_, i) => attempt(String(i))));
    const after = { ...initial, history: [...initial.history.slice(1), attempt("new")] };
    const compact = compactValues(JSON.stringify(initial), JSON.stringify(after));
    expect(JSON.parse(compact.after!).history).toHaveLength(1);
    expect(compact.after!.length).toBeLessThan(500);
    expect(() => parseSyncSnapshot(envelope([transaction("a", 1, null, { ...initial, history: [null] })]))).toThrow("invalid practice data");
    expect(() => parseSyncSnapshot(envelope([transaction("a", 1, null, "interface-id", { key: "guitar-input" })]))).toThrow("invalid transaction");
    const conditions = { v: 1, source: "measured", confidence: "unknown", support: "adaptive", notation: "visible", tempo: "fixed", exposure: "repeated", uninterrupted: true };
    const assessed = { ...initial, history: [{ ...attempt("context"), conditions }] };
    expect(valueAt(parseSyncSnapshot(envelope([transaction("context", 1, null, assessed)])).transactions).history[0].conditions).toEqual(conditions);
    expect(() => parseSyncSnapshot(envelope([transaction("context", 1, null, { ...assessed, history: [{ ...assessed.history[0], conditions: { ...conditions, confidence: "perfect" } }] })]))).toThrow("invalid practice data");
    expect(() => parseSyncSnapshot(envelope([transaction("constructor", 1, null, initial)]))).toThrow("invalid transaction");
    const first = transaction("a", 1, null, initial);
    expect(() => unionTransactions([first], [{ ...first, at: 999 }])).toThrow("different content");
  });
});

describe("durable journal and projection", () => {
  it("refuses conflicting attempt identities before replay deduplication while retaining equal and unidentified legacy rows", () => {
    const measured = { ...attempt("one-performance"), arrangementFingerprint: "score-v1", conditions: { v: 1, source: "measured", confidence: "unknown", tempo: "fixed" }, ev: { notes: [4, 0], leap: [0, 0], cross: [0, 0], shift: [0, 0], restarts: 0, hears: 0, wrong: [], time: { n: 4, mean: 0, spread: 10, rush: 0, drag: 0 } } };
    const self = { ...measured, conditions: { ...measured.conditions, source: "self" } };
    for (const history of [[measured, self], [self, measured]]) {
      const txs = [transaction("base", 1, null, store(card(), history), { baseline: true })];
      expect(projectPracticeHistory("tune-1", txs)).toEqual({ status: "conflicted" });
      expect(projectGoalEvidence(evidenceGoal, txs)).toEqual({ status: "conflicted" });
    }
    const baseline = transaction("base", 1, null, store(card(), [measured]), { baseline: true });
    const conflicting = transaction("writer", 1, {}, { history: [self] }, { clock: 2, context: { base: 1 } });
    expect(projectPracticeHistory("tune-1", [baseline, conflicting])).toEqual({ status: "conflicted" });
    expect(projectGoalEvidence(evidenceGoal, [baseline, conflicting])).toEqual({ status: "conflicted" });
    const equal = projectPracticeHistory("tune-1", [transaction("base", 1, null, store(card(), [measured, measured]), { baseline: true })]);
    expect(equal.status === "ready" && equal.exercises[0].attempts.length).toBe(1);
    const { uid: _uid, ...legacy } = attempt("legacy");
    const unknown = projectPracticeHistory("tune-1", [transaction("base", 1, null, { ...store(), history: [legacy, legacy] }, { baseline: true })]);
    expect(unknown.status === "ready" && unknown.exercises[0].unknown.length).toBe(2);
    const collision = transaction("base", 1, null, store(card(), [{ ...measured, uid: "writer:1:attempt:0" }]), { baseline: true });
    const legacyAddition = transaction("writer", 1, {}, { history: [legacy] }, { clock: 2, context: { base: 1 } });
    expect(projectPracticeHistory("tune-1", [collision, legacyAddition])).toEqual({ status: "conflicted" });
  });

  it("keeps archive checks bound to their tune and revision and retries unknown results", async () => {
    const React = await import("react"), { createRoot } = await import("react-dom/client");
    const journal = await import("../sync/journal");
    const queries: { tuneId: string; resolve(value: Awaited<ReturnType<typeof journal.readPracticeTransactions>>): void }[] = [];
    let revision = 0;
    const listeners = new Set<() => void>();
    vi.spyOn(journal, "getSyncState").mockImplementation(() => ({ pending: 0, error: null, transactions: 0, revision }));
    vi.spyOn(journal, "subscribeSyncState").mockImplementation((listener) => { listeners.add(listener); return () => listeners.delete(listener); });
    vi.spyOn(journal, "readPracticeTransactions").mockImplementation((tuneId) => new Promise((resolve) => queries.push({ tuneId, resolve })));
    const { usePracticeHistory } = await import("../song/usePracticeHistory");
    let current!: ReturnType<typeof usePracticeHistory>;
    function Harness({ tuneId }: { tuneId: string }) { current = usePracticeHistory(tuneId); return null; }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const render = async (tuneId: string) => { await React.act(async () => root.render(React.createElement(Harness, { tuneId }))); };
    try {
      await render("first");
      await render("second");
      expect(queries.map((query) => query.tuneId)).toEqual(["first", "second"]);
      await React.act(async () => queries[0].resolve({ status: "ready", transactions: [] }));
      expect(current.result.status).toBe("checking");
      await React.act(async () => queries[1].resolve({ status: "ready", transactions: [] }));
      expect(current.result).toMatchObject({ status: "ready", tuneId: "second", exercises: [] });
      await React.act(async () => { revision++; listeners.forEach((listener) => listener()); });
      expect(current.result.status).toBe("checking");
      await React.act(async () => queries[2].resolve({ status: "too-large" }));
      expect(current.result).toEqual({ status: "too-large" });
      await React.act(async () => current.retry());
      localStorage.setItem("guitar-song-deck:second", JSON.stringify(store()));
      await React.act(async () => queries[3].resolve({ status: "ready", transactions: [] }));
      expect(current.result).toEqual({ status: "unavailable" });
      await React.act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "guitar-song-deck:second" })));
      expect(current.result.status).toBe("checking");
      expect(queries).toHaveLength(5);
    } finally {
      await React.act(async () => root.unmount());
      host.remove();
    }
    await React.act(async () => queries[4].resolve({ status: "ready", transactions: [] }));
  });

  it("groups dated tune observations without turning self, skipped, shared or unknown history into tempo proof", () => {
    const conditions = { v: 1, source: "measured", confidence: "unknown", tempo: "fixed", support: "none", notation: "visible", exposure: "repeated", uninterrupted: true };
    const measured = { ...attempt("measured"), day: "2026-11-17", arrangementFingerprint: "music", conditions, ev: { notes: [4, 0], leap: [0, 0], cross: [0, 0], shift: [0, 0], restarts: 0, hears: 0, wrong: [], time: { n: 4, mean: 0, spread: 10, rush: 0, drag: 0 } } };
    const unknownContext = { ...measured, uid: "unknown-context", day: "2026-11-18", conditions: { ...conditions, support: undefined } };
    const changed = { ...measured, uid: "changed", day: "2026-11-18", arrangementFingerprint: "other-music" };
    const history = [changed, { ...measured, uid: "self", conditions: { ...conditions, source: "self" } },
      { ...measured, uid: "skipped", result: "skip" }, attempt("legacy"), measured, measured,
      { ...measured, uid: "shared", id: "scale:C" }, { ...measured, uid: "own-pace", conditions: { ...conditions, tempo: "own-pace" } },
      { ...measured, uid: "untimed", ev: undefined }, { ...measured, uid: "undated", day: "not-a-date" }, unknownContext];
    const result = projectPracticeHistory("tune-1", [transaction("base", 1, null, store(card(), history), { baseline: true })]);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a complete archive");
    expect(result).toMatchObject({ tuneId: "tune-1", excludesSharedSkills: true });
    expect(result.exercises).toHaveLength(1);
    const exercise = result.exercises[0];
    expect(exercise.attempts.map((row) => row.uid)).toEqual(["self", "skipped", "measured", "own-pace", "untimed", "changed", "legacy", "unknown-context", "undated"]);
    expect(exercise.selfGuided.map((row) => row.uid)).toEqual(["self"]);
    expect(exercise.skipped.map((row) => row.uid)).toEqual(["skipped"]);
    expect(exercise.unknown.map((row) => row.uid)).toEqual(["legacy"]);
    expect(exercise.measured).toHaveLength(6);
    expect(exercise.tempo.map((point) => point.attempt.uid)).toEqual(["measured", "changed", "unknown-context"]);
    expect(exercise.tempo[0].comparisonKey).toBeTruthy();
    expect(exercise.tempo[1].comparisonKey).not.toBe(exercise.tempo[0].comparisonKey);
    expect(exercise.tempo[2].comparisonKey).toBeNull();
    expect(exercise.tempo[0].attempt.conditions).toEqual(conditions);
  });

  it("upgrades and queries one complete practice group beyond the display cap, while honoring resets and refusing partial reads", async () => {
    const qualified = { ...attempt("qualified"), arrangementFingerprint: "score-v1", conditions: { v: 1, source: "measured", confidence: "unknown", tempo: "fixed" }, ev: { notes: [4, 0], leap: [0, 0], cross: [0, 0], shift: [0, 0], restarts: 0, hears: 0, wrong: [], time: { n: 4, mean: 0, spread: 10, rush: 0, drag: 0 } } };
    const initial = store(card(), [qualified, ...Array.from({ length: 799 }, (_, index) => attempt(`other-${index}`, "fail"))]);
    const trimmed = { ...initial, history: [...initial.history.slice(1), attempt("latest", "fail")] };
    const baseline = transaction("base", 1, null, initial, { baseline: true });
    const added = transaction("writer", 1, initial, trimmed, { clock: 2, context: { base: 1 } });
    // Build the shipped v1 schema: the new read must add its target index in place.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("guitar-sync-v1", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("transactions", { keyPath: "id" }); request.result.createObjectStore("meta"); };
      request.onsuccess = () => {
        const db = request.result;
        const write = db.transaction("transactions", "readwrite");
        for (const row of [baseline, added, transaction("unrelated", 1, null, store(), { key: "guitar-song-deck:other", baseline: true })]) write.objectStore("transactions").put(row);
        write.oncomplete = () => { db.close(); resolve(); };
        write.onerror = () => { db.close(); reject(write.error); };
      };
      request.onerror = () => reject(request.error);
    });
    localStorage.setItem(key, JSON.stringify(trimmed));
    expect(goalProgress(evidenceGoal, JSON.parse(localStorage.getItem(key)!)).demonstrated).toBe(0);
    const journal = await import("../sync/journal");
    const read = await journal.readPracticeTransactions("tune-1");
    expect(read.status).toBe("ready");
    if (read.status !== "ready") throw new Error("Complete target history required");
    expect(read.transactions.map((entry) => entry.id)).toEqual([baseline.id, added.id]);
    expect(projectGoalEvidence(evidenceGoal, read.transactions)).toMatchObject({ status: "ready", progress: { demonstrated: 1, total: 1 } });
    const archive = projectPracticeHistory("tune-1", [...read.transactions, added]);
    expect(archive).toMatchObject({ status: "ready", store: { history: expect.any(Array) } });
    if (archive.status !== "ready") throw new Error("Expected complete history beyond the local cap");
    expect(archive.exercises[0].attempts).toHaveLength(801);
    expect(archive.exercises[0].tempo.map((point) => point.attempt.uid)).toEqual(["qualified"]);
    expect(projectGoalEvidence(evidenceGoal, [transaction("fragment", 1, {}, { history: [qualified] })])).toEqual({ status: "unavailable" });
    expect(projectPracticeHistory("tune-1", [transaction("fragment", 1, {}, { history: [qualified] })])).toEqual({ status: "unavailable" });
    expect(await journal.readPracticeTransactions("tune-1", { maxTransactions: 1 })).toEqual({ status: "too-large" });
    const reset = transaction("restore", 1, trimmed, { ...trimmed, history: [] }, { reset: true, clock: 3, context: { base: 1, writer: 1 } });
    await journal.importSyncTransactions([reset]);
    const restored = await journal.readPracticeTransactions("tune-1");
    if (restored.status !== "ready") throw new Error("Complete restored history required");
    expect(projectGoalEvidence(evidenceGoal, restored.transactions)).toMatchObject({ status: "ready", progress: { demonstrated: 0 } });
    expect(projectPracticeHistory("tune-1", restored.transactions)).toMatchObject({ status: "ready", exercises: [] });
  });

  it("rejects a blocked history upgrade, closes its abandoned connection, and closes stale readers on versionchange", async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("guitar-sync-v1", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("transactions", { keyPath: "id" }); request.result.createObjectStore("meta"); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const journal = await import("../sync/journal");
    await expect(journal.readPracticeTransactions("tune-1")).rejects.toThrow("Close other copies");
    old.close();
    expect(await journal.readPracticeTransactions("tune-1")).toEqual({ status: "ready", transactions: [] });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("guitar-sync-v1", 3);
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onblocked = () => reject(new Error("A stale evidence reader kept the database open"));
      request.onerror = () => reject(request.error);
    });
  });

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
    expect(projectGoalEvidence(evidenceGoal, union)).toEqual({ status: "conflicted" });
    expect(projectPracticeHistory("tune-1", union)).toEqual({ status: "conflicted" });
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitLatency } from "../audio/latency";
import { toDrop } from "../audio/recorder";
import type { ReadingBar, ReadingNote } from "../core/contract";
import { buildDeck, familiesOnly } from "../song/deck";
import { newCards, nextArc, planBlocks } from "../song/planner";
import { tunePath, weeklyMinutes } from "../overview/progress";
import { addChord, cardForLoop, findLoop, nameChord } from "../song/progression";
import { stringPrompts, thirdPrompts, tonePrompts } from "../song/fretboard";
import { seeded } from "../song/rand";
import { parseChord, type Chord } from "../song/harmony";
import type { SkillProfile } from "../song/profile";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";
import type { NoteResult, PatternStep } from "../core/contract";
import { createEvidence, timingOf, type Evidence } from "../song/evidence";
import type { Attempt, Store } from "../song/leitner";
import { buildProfile } from "../song/profile";
import { cardTrend } from "../song/stats";
import { arrangementIdentity, createGoal, getGoals, GOALS_KEY, goalDeck, goalProgress, loadActiveGoal, saveGoal, setActiveGoal } from "../song/goals";

const step = (string: number, fret: number): PatternStep => ({ string, fret, pc: 0, midi: 0, startBeat: 0, durationBeats: 1 });

describe("evidence from a take", () => {
  it("counts misses by the shape of the line and keeps what sounded instead", () => {
    const midis = [57, 59, 60, 65, 64];
    const steps = [step(4, 0), step(4, 2), step(3, 5), step(3, 10), step(2, 5)];
    const results: NoteResult[] = ["hit", "hit", "hit", "miss", "hit"];
    const heard = [null, null, null, 66, null];
    const log = createEvidence();
    log.notes(midis, steps, results, heard, 0, 4);
    const e = log.done()!;
    expect(e.notes).toEqual([5, 1]);
    expect(e.leap).toEqual([1, 1]); // 60 → 65
    expect(e.cross).toEqual([2, 0]); // onto string 3, onto string 2
    expect(e.shift).toEqual([3, 1]); // 2 → 5, 5 → 10, 10 → 5
    expect(e.wrong).toEqual([[65, 66]]);
  });

  it("only judges the range it is given and leaves nothing for an empty visit", () => {
    const log = createEvidence();
    expect(log.done()).toBeUndefined();
    log.notes([60, 62, 64], [null, null, null], ["miss", "hit", "hit"], [61, null, null], 1, 2);
    expect(log.done()!.notes).toEqual([2, 0]);
  });

  it("sums up where notes sat against the beat", () => {
    const t = timingOf([-80, -20, 0, 20, 80]);
    expect(t).toMatchObject({ n: 5, mean: 0, rush: 1, drag: 1 });
    expect(t.spread).toBe(52);
    const log = createEvidence();
    log.timing([null, 30, 50]);
    expect(log.done()!.time).toMatchObject({ n: 2, mean: 40 });
  });
});

const ev = (over: Partial<Evidence>): Evidence => ({ notes: [20, 2], wrong: [], leap: [0, 0], cross: [0, 0], shift: [0, 0], restarts: 0, hears: 0, ...over });
const attempt = (id: string, day: string, over: Partial<Attempt> = {}): Attempt => ({ id, day, result: "clean", bpm: 80, share: 0.9, secs: 60, from: 1, to: 2, ...over });

describe("the player's profile", () => {
  const day = "2026-11-17";

  it("names leaps when they go wrong far more than lines in general", () => {
    const list = Array.from({ length: 6 }, (_, i) => attempt(`mel:new:${i}`, day, { ev: ev({ notes: [20, 3], leap: [5, 3] }) }));
    const p = buildProfile(list, day);
    expect(p.weaknesses[0].cls).toBe("leaps");
    expect(p.weaknesses[0].fact).toBe("Leaps · 60 % missed");
  });

  it("does not name a class on too little evidence", () => {
    const p = buildProfile([attempt("mel:new:0", day, { ev: ev({ leap: [3, 3] }) })], day);
    expect(p.weaknesses).toEqual([]);
  });

  it("excludes self-reported playing from every profile judgment even with misleading evidence", () => {
    const measured = attempt("mel:new:0", day, { ev: ev({ notes: [20, 2] }) });
    const self = Array.from({ length: 6 }, (_, i) => attempt(`scale:self:${i}`, day, {
      bpm: 220, goalBpm: 80, share: 1,
      conditions: { v: 1, source: "self", confidence: "unknown" },
      ev: ev({ notes: [20, 18], leap: [10, 9], wrong: [[70, 71]], time: { n: 40, mean: 200, spread: 100, rush: 0, drag: 40 } }),
    }));
    expect(buildProfile([measured, ...self], day)).toEqual(buildProfile([measured], day));
    expect(buildProfile(self, day).weaknesses).toEqual([]);
    expect(buildProfile(self, day).ceilings).toEqual({});
  });

  it("finds the same semitone slip across exercises", () => {
    const list = ["a", "b", "c", "d"].map((x) => attempt(`mel:new:${x}`, day, { ev: ev({ wrong: [[70, 71]] }) }));
    const w = buildProfile(list, day).weaknesses.find((x) => x.cls === "accidental")!;
    expect(w.n).toBe(4);
    expect(w.cards).toHaveLength(4);
  });

  it("hears a scattered beat without treating raw alignment as rushing", () => {
    const list = Array.from({ length: 4 }, (_, i) => attempt(`scale:A-major:run`, day, { ev: ev({ time: { n: 10, mean: -50, spread: 60, rush: 4, drag: 0 } }), bpm: 90 + i }));
    const profile = buildProfile(list, day);
    const cls = profile.weaknesses.map((w) => w.cls);
    expect(cls).not.toContain("rushing");
    expect(cls).toContain("unsteady");
    expect(buildProfile(list, day, false).axes.time.level).toBe(profile.axes.time.level);
  });

  it("keeps raw alignment and calibration provenance without penalizing steady performances", () => {
    const calibrated = attempt("mel:calibrated", day, {
      timingMeasured: true,
      ev: ev({ time: { n: 40, mean: -50, spread: 10, rush: 0, drag: 0 } }),
    });
    const recorded = buildProfile([calibrated], day, false);
    expect(recorded.weaknesses).toEqual([]);
    expect(recorded.axes.time.level).toBe(1);
    expect(calibrated).toMatchObject({ timingMeasured: true, ev: { time: { mean: -50 } } });
    for (const mean of [-240, 240]) {
      const unmeasured = attempt("mel:other-device", day, {
        timingMeasured: false,
        ev: ev({ time: { n: 40, mean, spread: 10, rush: 0, drag: 0 } }),
      });
      expect(buildProfile([calibrated, unmeasured], day, true).weaknesses).toEqual(recorded.weaknesses);
      expect(buildProfile([unmeasured], day, true).axes.time.level).toBe(1);
    }
  });

  it("weighs recent results most and sees a trend", () => {
    const old = Array.from({ length: 4 }, (_, i) => attempt("mel:new:0", `2026-10-0${i + 1}`, { result: "fail", share: 0 }));
    const recent = Array.from({ length: 4 }, (_, i) => attempt("mel:new:0", `2026-11-1${i}`));
    const p = buildProfile([...old, ...recent], day);
    expect(p.axes.pitch.level).toBeGreaterThan(0.7);
    expect(p.axes.pitch.trend).toBeGreaterThan(0.5);
    expect(p.axes.pitch.last).toBe("2026-11-13");
  });

  it("keeps each exercise's fastest clean tempo and where it fell apart above it", () => {
    const list = [attempt("x", day, { bpm: 100 }), attempt("x", day, { bpm: 92, result: "fail" }), attempt("x", day, { bpm: 112, result: "fail" }), attempt("x", day, { bpm: 108, result: "fail" })];
    expect(buildProfile(list, day).ceilings.x).toEqual({ clean: 100, fail: 108 });
    expect(cardTrend({ ...store(), history: list }, "x").best).toBe(100);
  });

  it("reports note accuracy and demonstrated clean tempo rather than completion labels", () => {
    const list = [
      attempt("scale:A-major:run", day, { bpm: 80, goalBpm: 100, ev: ev({ notes: [20, 5] }) }),
      attempt("scale:A-major:thirds", day, { result: "fail", bpm: 140, goalBpm: 100, share: 0.5 }),
    ];
    const p = buildProfile(list, day);
    expect(p.axes.pitch.level).toBeCloseTo(0.625);
    expect(p.axes.tempo).toMatchObject({ level: 0.8, n: 1 });
    expect(buildProfile([attempt("scale:A-major:run", day)], day).axes.tempo.n).toBe(0);
    expect(buildProfile([attempt("mel:new:0", day, { share: null })], day).axes.pitch.n).toBe(0);
  });
});

describe("the input's lag, from a play-along", () => {
  const clicks = Array.from({ length: 10 }, (_, i) => 1000 + i * 750);

  it("is the typical delay from a click to the note heard with it, after the first two", () => {
    const heard = clicks.map((c, i) => c + (i < 2 ? 300 : 70 + (i % 3) * 5));
    expect(fitLatency(clicks, heard)).toBe(75);
  });

  it("is not guessed from too few or too scattered notes", () => {
    expect(fitLatency(clicks, clicks.slice(0, 5).map((c) => c + 60))).toBeNull();
    expect(fitLatency(clicks, clicks.map((c, i) => c + (i % 2 ? -120 : 200)))).toBeNull();
  });
});

const rn = (midi: number, startBeat: number): ReadingNote => ({ rest: false, midi, vexKey: "a/4", accidental: null, duration: "q", dotted: false, startBeat, durationBeats: 1, string: 0, fret: 0 });
function sheet(): LeadSheet {
  const chords = ["Am", "Dm7", "E7", "Am", "Am", "Dm7", "E7", "Am"];
  const bars: ReadingBar[] = chords.map((c, i) => ({ barIndex: i, chordSymbols: [c], chordBeats: [0], notes: [57, 60, 64, 60].map((m, k) => rn(m, i * 4 + k)), beats: 4, section: i % 4 === 0 ? (i ? "B" : "A") : undefined }));
  return { id: "t", title: "T", composer: "", keySignature: "Am", timeSignature: "4/4", tempo: 100, bars, barNumbers: chords.map((_, i) => String(i + 1)), comp: [], chordsFromVoicings: false };
}
const store = (cards: Store["cards"] = {}): Store => ({ v: 1, cards, sessions: [], settings: { newPerSession: 4, guide: false, voice: false, window: null } });
const known = (box: number) => ({ box, due: "2026-11-01", bpm: 80, seen: 3, clean: 2, last: "clean" as const });
const flat = { level: 0.5, trend: null, n: 0, last: null };
const profileWith = (over: Partial<SkillProfile>): SkillProfile => ({ axes: { pitch: flat, time: flat, tempo: flat, chords: flat, reading: flat, ear: flat }, weaknesses: [], ceilings: {}, ...over });

describe("a learner's musical goal", () => {
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => { kept.set(key, value); },
      removeItem: (key: string) => { kept.delete(key); },
      key: (index: number) => [...kept.keys()][index] ?? null,
      get length() { return kept.size; },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const make = (kind: "melody" | "accompaniment" | "ear" | "reading" | "improv" = "melody") => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const goal = { ...createGoal(s, deck, { kind, minBpm: 60, targetBpm: 84 }), createdAt: "2026-11-17T10:00:00.000Z" };
    return { s, deck, goal };
  };

  it("keeps a fixed route and personal tempo without changing the imported score or deck", () => {
    const { s, deck, goal } = make();
    const before = deck.cards.map((card) => [card.bpm, card.goalBpm]);
    const bounded = goalDeck(deck, goal);
    expect(goal.essentialTasks.length).toBeGreaterThan(0);
    expect(goal.essentialTasks.length).toBeLessThanOrEqual(12);
    expect(goal.essentialTasks.some((task) => task.cardId === "mel:run")).toBe(true);
    expect(goal.essentialTasks.some((task) => task.cardId.startsWith("mel:memory:"))).toBe(false);
    expect(bounded.cards.every((card) => card.bpm >= 60 && card.bpm <= 84 && card.goalBpm === 84)).toBe(true);
    expect(deck.cards.map((card) => [card.bpm, card.goalBpm])).toEqual(before);
    expect(s.tempo).toBe(100);
    const fixed = JSON.stringify(goal.essentialTasks);
    goalDeck({ ...deck, cards: [...deck.cards, { ...deck.cards[0], id: "optional:new-variant" }] }, goal);
    expect(JSON.stringify(goal.essentialTasks)).toBe(fixed);
  });

  it("invalidates changed music while preserving goals across display/fingering choices", () => {
    const { s, deck, goal } = make();
    localStorage.removeItem(GOALS_KEY);
    expect(saveGoal(goal)).toBe(true);
    const moved = { ...s, title: "Renamed", bars: s.bars.map((bar) => ({ ...bar, notes: bar.notes.map((note) => ({ ...note, string: 3, fret: 9 })) })) };
    expect(arrangementIdentity(moved)).toEqual(goal.arrangement);
    expect(loadActiveGoal(moved, buildDeck(moved, buildTimeline(moved), { window: 7 }))?.id).toBe(goal.id);
    const changed = { ...s, bars: s.bars.map((bar, i) => i ? bar : { ...bar, notes: bar.notes.map((note, j) => j ? note : { ...note, midi: note.midi + 1 }) }) };
    expect(loadActiveGoal(changed, deck)).toBeNull();
    expect(getGoals().byTune[s.id].goals[goal.id]).toEqual(goal);
    localStorage.removeItem(GOALS_KEY);
  });

  it("stores independent immutable goals and refuses to overwrite unreadable saved data", () => {
    const { s, deck, goal } = make();
    localStorage.removeItem(GOALS_KEY);
    expect(saveGoal(goal)).toBe(true);
    expect(getGoals()).toBe(getGoals());
    const blockedRead = vi.spyOn(localStorage, "getItem").mockImplementationOnce(() => { throw new Error("Storage temporarily unavailable"); });
    expect(getGoals().byTune).toEqual({});
    blockedRead.mockRestore();
    expect(getGoals().byTune.t.goals[goal.id]).toEqual(goal);
    expect(saveGoal({ ...goal, tempo: { minBpm: 60, targetBpm: 100 } })).toBe(false);
    const second = createGoal(s, deck, { kind: "ear", minBpm: 50, targetBpm: 80 });
    expect(saveGoal(second)).toBe(true);
    expect(Object.keys(getGoals().byTune.t.goals)).toHaveLength(2);
    expect(setActiveGoal(s.id, goal.id)).toBe(true);
    expect(loadActiveGoal(s, deck)?.id).toBe(goal.id);
    localStorage.setItem(GOALS_KEY, "{broken");
    expect(saveGoal(second)).toBe(false);
    expect(localStorage.getItem(GOALS_KEY)).toBe("{broken");
    localStorage.removeItem(GOALS_KEY);
    getGoals();
    const imported = Object.fromEntries(Array.from({ length: 13 }, (_, index) => {
      const id = `${goal.id}-${index}`;
      return [id, { ...goal, id }];
    }));
    const importedId = Object.keys(imported)[0];
    localStorage.setItem(GOALS_KEY, JSON.stringify({ v: 1, byTune: { t: { activeId: importedId, goals: imported } } }));
    expect(Object.keys(getGoals().byTune.t.goals)).toHaveLength(13);
    expect(setActiveGoal("t", Object.keys(imported)[12])).toBe(true);
    expect(saveGoal(second)).toBe(false); // Exchange history has headroom; local creations stay bounded.
    expect(Object.keys(getGoals().byTune.t.goals)).toHaveLength(13);
    localStorage.removeItem(GOALS_KEY);
    getGoals();
  });

  it("counts exact measured takes since creation, excluding old arrangements, self reports and box credit", () => {
    const { goal } = make();
    const id = goal.essentialTasks[0].cardId;
    const checked = { ...attempt(id, "2026-11-17", { bpm: 84, at: Date.parse("2026-11-17T11:00:00Z"), ev: ev({ time: { n: 20, mean: 0, spread: 10, rush: 0, drag: 0 } }) }),
      conditions: { v: 1 as const, source: "measured" as const, confidence: "unknown" as const, tempo: "adaptive" as const }, arrangementFingerprint: goal.arrangement.fingerprint };
    const old = { ...checked, at: Date.parse("2026-11-16T11:00:00Z") };
    const wrong = { ...checked, arrangementFingerprint: "earlier-score" };
    const self = { ...checked, conditions: { ...checked.conditions, source: "self" as const } };
    const ownPace = { ...checked, conditions: { ...checked.conditions, tempo: "own-pace" as const } };
    const noTiming = { ...checked, ev: ev({}) };
    const state = { ...store({ [id]: { ...known(5), bestCleanBpm: 200 } }), credit: { [id]: 5 }, history: [old, wrong, self, ownPace, noTiming] };
    expect(goalProgress(goal, state).demonstrated).toBe(0);
    expect(goalProgress(goal, { ...state, history: [...state.history, checked] })).toMatchObject({ demonstrated: 1, total: goal.essentialTasks.length, taskIds: [id] });
    const { goal: earGoal } = make("ear");
    const echo = { ...ownPace, id: earGoal.essentialTasks[0].cardId, bpm: 40, arrangementFingerprint: earGoal.arrangement.fingerprint };
    expect(goalProgress(earGoal, { ...store(), history: [echo] })).toMatchObject({ demonstrated: 1, evidenceKind: "echo" });
  });

  it("prefers a goal-relevant weakness and closes on that goal within every session budget", () => {
    const { deck, goal } = make("accompaniment");
    const cards = Object.fromEntries(deck.intro.map((id) => [id, known(2)]));
    const melody = deck.cards.find((card) => card.family === "melody")!;
    const relevant = goal.essentialTasks[0].cardId;
    const profile = profileWith({ weaknesses: [
      { cls: "leaps", strength: .9, n: 40, cards: [`t::${melody.id}`], fact: "Unrelated leaps" },
      { cls: "unsteady", strength: .4, n: 40, cards: [`t::${relevant}`], fact: "Relevant beat" },
    ] });
    for (const minutes of [10, 25, 45]) {
      const plan = planBlocks(goalDeck(deck, goal), store(cards), "2026-11-17", { minutes, tuneId: "t", goal, profile });
      expect(plan.why).toBe("Relevant beat");
      expect(plan.arc?.cls).toBe("unsteady");
      expect(plan.ids).not.toContain(melody.id);
      expect(plan.blocks[plan.blocks.length - 1]?.role).toBe("music");
      expect(plan.blocks[plan.blocks.length - 1]?.cards.every((id) => goal.essentialTasks.some((task) => task.cardId === id))).toBe(true);
      expect(plan.minutes).toBeLessThanOrEqual(minutes);
      expect(new Set(plan.ids).size).toBe(plan.ids.length);
    }
  });

  it("prepares an improvisation goal through its section melody without enlarging the frozen route", () => {
    const { deck, goal } = make("improv");
    const fixed = JSON.stringify(goal.essentialTasks);
    const plan = planBlocks(deck, store(), "2026-11-17", { minutes: 10, tuneId: "t", goal });
    expect(plan.ids.length).toBeGreaterThan(0);
    expect(plan.ids.every((id) => id.startsWith("mel:") || id.endsWith(":guides"))).toBe(true);
    expect(plan.why).toContain("Improvise over the changes");
    expect(JSON.stringify(goal.essentialTasks)).toBe(fixed);
  });
});

describe("a session with a shape", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));
  const day = "2026-11-17";
  const scale = deck.intro.find((id) => id.startsWith("scale:"))!;
  const melodies = deck.intro.filter((id) => id.startsWith("mel:") && !id.startsWith("mel:hear:"));

  it("starts a new tune directly on Bar 1 (never auto-inserting mel:hear) and weaves an in-key reset when revisiting opening chunks", () => {
    const p = planBlocks(deck, store({ [scale]: known(3) }), day, { minutes: 25, tuneId: "t" });
    expect(p.blocks.map((b) => b.role)).toEqual(["music"]);
    expect(p.ids[0]).toMatch(/^mel:new:0-/);
    expect(p.ids.some((id) => id.startsWith("mel:hear:"))).toBe(false);
    expect(p.ids).not.toContain(scale);
    expect(p.why).toBe("");
    // After playing the opening chunk today (not due yet, section still locked), revisiting weaves an in-key reset card
    const playedToday = store({
      [scale]: known(3),
      [p.ids[0]]: { box: 1, due: "2026-11-20", bpm: 72, seen: 1, clean: 0, last: "ok" },
    });
    const p2 = planBlocks(deck, playedToday, day, { minutes: 25, tuneId: "t" });
    expect(p2.ids.some((id) => id.startsWith("mel:hear:"))).toBe(false);
    expect(p2.ids).toContain(p.ids[0]);
    const resetBlock = p2.blocks.find((b) => b.role === "side");
    expect(resetBlock?.cards).toHaveLength(1);
    const resetCard = deck.cards.find((c) => c.id === resetBlock!.cards[0])!;
    expect(["scales", "harmony", "reading"]).toContain(resetCard.family);
    expect(resetCard.id.startsWith("tech:")).toBe(false);
    expect(p2.blocks[p2.blocks.length - 1].role).toBe("music");
  });

  it("warms up on the tune's own home-key scale in position rather than remote-key tech foundations", () => {
    const tech = deck.cards.find((c) => c.family === "technique")!;
    const cards = Object.fromEntries([[scale, known(3)], [tech.id, known(3)], ...melodies.map((id) => [id, known(2)])]);
    // Odd session count previously alternated remote-key tech:* into song warm-ups
    const oddSessions = { ...store(cards), sessions: [{ date: "2026-11-16", minutes: 20, cards: 4, clean: 3 }] };
    const p = planBlocks(deck, oddSessions, day, { minutes: 25, tuneId: "t" });
    expect(p.blocks[0]).toMatchObject({ role: "warmup", cards: [scale] });
    expect(p.ids.some((id) => id.startsWith("tech:"))).toBe(false);

    // Technique focus mode (no scale cards in deck) still warms up with a known technique card
    const techDeck = familiesOnly(deck, ["technique"]);
    const pTech = planBlocks(techDeck, store({ [tech.id]: known(3) }), day, { minutes: 25, tuneId: "t" });
    expect(pTech.blocks[0]).toMatchObject({ role: "warmup", cards: [tech.id] });
  });

  it("warms up on a scale the hands know, then works the named mistake, then plays the tune", () => {
    const cards = Object.fromEntries([[scale, known(3)], ...melodies.map((id) => [id, known(2)])]);
    const weak = { cls: "leaps" as const, strength: 0.6, n: 40, cards: [`t::${melodies[0]}`], fact: "Leaps · 41 % missed" };
    const p = planBlocks(deck, store(cards), day, { minutes: 25, tuneId: "t", profile: profileWith({ weaknesses: [weak] }) });
    expect(p.blocks[0]).toMatchObject({ role: "warmup", cards: [scale] });
    expect(p.blocks.find((b) => b.role === "focus")!.cards).toEqual([melodies[0]]);
    expect(p.why).toBe("Leaps · 41 % missed");
    expect(p.arc).toMatchObject({ cls: "leaps", start: day });
    expect(new Set(p.ids).size).toBe(p.ids.length);
  });

  it("works a part, never the whole tune, when timing spreads most over the whole tune", () => {
    const tune = melodies.find((id) => id.startsWith("mel:tune:"))!;
    const part = melodies.find((id) => id.startsWith("mel:new:"))!;
    const cards = Object.fromEntries([[scale, known(3)], ...melodies.map((id) => [id, known(2)])]);
    const weak = { cls: "unsteady" as const, strength: 0.5, n: 300, cards: [`t::${tune}`, "t::mel:run", `t::${part}`], fact: "Spread 80 ms" };
    const p = planBlocks(deck, store(cards), day, { minutes: 25, tuneId: "t", profile: profileWith({ weaknesses: [weak] }) });
    expect(p.blocks.find((b) => b.role === "focus")!.cards).toEqual([part]);
  });

  it("fits every block into the minutes and reserves music even with a large focus", () => {
    const cards = Object.fromEntries(deck.intro.map((id) => [id, known(1)]));
    const weak = { cls: "leaps" as const, strength: 0.6, n: 40, cards: melodies.slice(0, 5).map((id) => `t::${id}`), fact: "x" };
    const short = planBlocks(deck, store(cards), day, { minutes: 10, tuneId: "t", profile: profileWith({ weaknesses: [weak] }) });
    const long = planBlocks(deck, store(cards), day, { minutes: 45, tuneId: "t", profile: profileWith({ weaknesses: [weak] }) });
    expect(short.blocks.find((b) => b.role === "focus")!.cards.length).toBeLessThan(5);
    expect(short.minutes).toBeLessThanOrEqual(10);
    expect(short.blocks[short.blocks.length - 1].role).toBe("music");
    expect(short.ids).toHaveLength(new Set(short.ids).size);
    expect(long.ids.length).toBeGreaterThan(short.ids.length);
  });

  it("turns to a skill left alone for a week when nothing is named", () => {
    const cards = Object.fromEntries([[scale, known(2)], ...melodies.map((id) => [id, known(2)])]);
    const p = planBlocks(deck, store(cards), day, { minutes: 25, tuneId: "t", profile: profileWith({ axes: { ...profileWith({}).axes, pitch: { ...flat, n: 5, last: "2026-11-05" } } }) });
    expect(p.why).toBe("Pitch · 12 days");
    expect(p.blocks.find((b) => b.role === "focus")!.cards.every((id) => id.startsWith("mel:"))).toBe(true);
  });

  it("caps focus at 3, schedules cohesive units in 25 min, and weaves an in-key pattern-breaker between heavy melody work", () => {
    const cards = Object.fromEntries([[scale, known(3)], ...melodies.map((id) => [id, known(2)])]);
    const weak = { cls: "crossing" as const, strength: 0.6, n: 40, cards: melodies.slice(0, 5).map((id) => `t::${id}`), fact: "String crossings · 45 % missed" };
    const p = planBlocks(deck, store(cards), day, { minutes: 25, tuneId: "t", profile: profileWith({ weaknesses: [weak] }) });
    const focusIdx = p.blocks.findIndex((b) => b.role === "focus");
    const sideIdx = p.blocks.findIndex((b) => b.role === "side");
    const musicIdx = p.blocks.findIndex((b) => b.role === "music");
    expect(p.blocks[focusIdx].cards.length).toBeLessThanOrEqual(3);
    expect(sideIdx).toBeGreaterThan(focusIdx);
    expect(sideIdx).toBeLessThan(musicIdx);
    const sideCard = deck.cards.find((c) => c.id === p.blocks[sideIdx].cards[0])!;
    expect(["reading", "harmony", "scales"]).toContain(sideCard.family);
    expect(sideCard.id.startsWith("tech:")).toBe(false);
    expect(p.sideWhy).toBeTruthy();
    expect(p.ids.length).toBeGreaterThanOrEqual(4);
    expect(p.ids.length).toBeLessThanOrEqual(8);
  });

  it("graduates to longer melody passages once shorter chunks are confident while keeping weak chunks drillable", () => {
    const shortChunk = deck.cards.find((c) => c.step?.kind === "new")!;
    const sectionCard = deck.cards.find((c) => c.step?.kind === "section")!;
    const wholeTune = deck.cards.find((c) => c.step?.kind === "tune")!;
    const cards: Store["cards"] = {
      [scale]: known(3),
      [shortChunk.id]: { ...known(4), bestCleanBpm: shortChunk.goalBpm },
      [sectionCard.id]: known(2),
      [wholeTune.id]: known(2),
    };
    const p = planBlocks(deck, store(cards), day, { minutes: 25, tuneId: "t" });
    const musicBlock = p.blocks.find((b) => b.role === "music")!;
    expect([wholeTune.id, "mel:run", sectionCard.id]).toContain(musicBlock.cards[0]);
    expect(musicBlock.cards[0]).not.toBe(shortChunk.id);

    // A weak/slow short chunk remains drillable in focus when named by a weakness
    const weakCards: Store["cards"] = {
      [scale]: known(3),
      [shortChunk.id]: { box: 1, due: day, bpm: 60, bestCleanBpm: 60, seen: 2, clean: 0, last: "fail" },
      [sectionCard.id]: known(2),
    };
    const weak = { cls: "leaps" as const, strength: 0.6, n: 40, cards: [`t::${shortChunk.id}`], fact: "Leaps · 40 % missed" };
    const pWeak = planBlocks(deck, store(weakCards), day, { minutes: 25, tuneId: "t", profile: profileWith({ weaknesses: [weak] }) });
    expect(pWeak.blocks.find((b) => b.role === "focus")!.cards).toContain(shortChunk.id);
  });
});

describe("arcs", () => {
  const w = (strength: number) => profileWith({ weaknesses: [{ cls: "leaps", strength, n: 30, cards: [], fact: "" }] });

  it("hold while the mistake is still strong and end once it has halved", () => {
    const arc = nextArc(null, w(0.6), "2026-11-10")!;
    expect(nextArc(arc, w(0.5), "2026-11-12")).toBe(arc);
    expect(nextArc(arc, w(0.2), "2026-11-12")).toBeNull(); // that mistake rests; nothing else is named
    const other = profileWith({ weaknesses: [{ cls: "leaps", strength: 0.2, n: 30, cards: [], fact: "" }, { cls: "rushing", strength: 0.1, n: 30, cards: [], fact: "" }] });
    expect(nextArc(arc, other, "2026-11-12")).toMatchObject({ cls: "rushing", start: "2026-11-12" });
  });

  it("rest after ten days whatever happened", () => {
    const arc = nextArc(null, w(0.6), "2026-11-01")!;
    expect(nextArc(arc, w(0.6), "2026-11-12")).toBeNull();
  });
});

describe("comping cards", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));
  const comp = deck.cards.filter((c) => c.kind === "comping");

  it("strike each chord on two and four, after its voicings card, then the Charleston", () => {
    const c24 = comp.find((c) => c.id.endsWith(":comp24"))!;
    expect(c24.needs).toBe(c24.id.replace(":comp24", ":voicings"));
    const hits = c24.tl.targets.slice(c24.first, c24.last + 1);
    expect(hits.every((t) => t.chord?.strike)).toBe(true);
    expect(hits.slice(0, 2).map((t) => t.t - c24.tl.slots[c24.from].start)).toEqual([1, 3]);
    const ch = comp.find((c) => c.id === c24.id.replace(":comp24", ":charleston"))!;
    expect(ch.needs).toBe(c24.id);
    expect(deck.intro.indexOf(ch.id)).toBeGreaterThan(deck.intro.indexOf(c24.id));
  });
});

describe("chords strummed in free play", () => {
  const ch = (x: string) => parseChord(x)!;

  it("are named the way the session judges them", () => {
    expect(nameChord([2, 5, 9, 0])?.symbol).toBe("Dm7");
    expect(nameChord([7, 11, 5])?.symbol).toBe("G7"); // a shell: no fifth
    expect(nameChord([0, 4, 7])?.symbol).toBe("C");
    expect(nameChord([0, 1, 2, 3])).toBeNull();
  });

  it("go round in a loop once it has come twice", () => {
    let list: Chord[] = [];
    for (const x of ["Am", "Dm7", "Dm7", "G7", "Dm7", "G7"]) list = addChord(list, ch(x));
    expect(list.map((c) => c.symbol)).toEqual(["Am", "Dm7", "G7", "Dm7", "G7"]);
    expect(findLoop(list)?.map((c) => c.symbol)).toEqual(["Dm7", "G7"]);
    expect(findLoop(["Dm7", "G7", "Cmaj7", "Dm7", "G7", "Cmaj7"].map(ch))?.map((c) => c.symbol)).toEqual(["Dm7", "G7", "Cmaj7"]);
    expect(findLoop(["Dm7", "G7", "Cmaj7"].map(ch))).toBeNull();
  });

  it("lead to the box's chord card that goes round the same changes", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const card = cardForLoop(deck, [ch("Dm7"), ch("E7")]);
    expect(card?.kind).toBe("voicings");
    expect(cardForLoop(deck, [ch("Bbmaj7"), ch("Eb7")])).toBeNull();
  });
});

describe("the run-through", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));
  const run = deck.cards.find((c) => c.id === "mel:run")!;

  it("is the whole tune once, after the tune top to bottom", () => {
    expect(run.run).toBe(true);
    expect([run.first, run.last]).toEqual([0, run.tl.targets.length - 1]);
    expect(deck.cards.find((c) => c.id === run.needs)?.family).toBe("melody");
    expect(run.pace).toBe(false);
  });

  it("sends its short bars to the next session's focus", () => {
    const cards = Object.fromEntries(deck.intro.filter((id) => id.startsWith("mel:")).map((id) => [id, known(2)]));
    const st = { ...store(cards), history: [attempt("mel:run", "2026-11-16", { result: "ok", ev: ev({ weakBars: [5] }) })] };
    const p = planBlocks(deck, st, "2026-11-17", { minutes: 25, tuneId: "t" });
    const focus = p.blocks.find((b) => b.role === "focus")!.cards;
    expect(focus).toHaveLength(1);
    const c = deck.cards.find((x) => x.id === focus[0])!;
    expect(c.tl.slots.slice(c.from, c.to + 1).some((x) => x.bar === 5)).toBe(true);
    expect(p.why).toBe("Run-through · bar 6");
  });
});

describe("improvising cards", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));
  const card = deck.cards.find((c) => c.id.endsWith(":improv"))!;
  const motif = deck.cards.find((c) => c.id.endsWith(":improv-motif"))!;

  it("land any chord tone on beats one and three, unlock from the section melody, and include a motif proposal", () => {
    const secMel = deck.cards.find((c) => c.step?.kind === "section")!;
    expect(card.stage).toBe(3);
    expect(card.needs).toBe(secMel.id);
    expect(card.anchor).toBe(secMel.id);
    expect(card.proposal).toBeTruthy();
    const hits = card.tl.targets.slice(card.first, card.last + 1);
    expect(hits.slice(0, 2).map((t) => t.t - card.tl.slots[card.from].start)).toEqual([0, 2]);
    hits.forEach((t, k) => expect(t.any).toEqual(card.context[card.first + k]!.chord!.pcs));
    expect(card.pace).toBe(false);
    expect(motif.needs).toBe(card.id);
    expect(motif.stage).toBe(3);
    expect(motif.proposal).toBeTruthy();

    // When a chord-only sheet has no melody notes, improv falls back to unlocking from guide tones
    const chordOnly: LeadSheet = {
      ...s,
      id: "chords-only",
      bars: s.bars.map((b) => ({ ...b, notes: [{ ...b.notes[0], rest: true, midi: 0, duration: "w", durationBeats: 4 }] })),
    };
    const chordDeck = buildDeck(chordOnly, buildTimeline(chordOnly));
    const fallbackImprov = chordDeck.cards.find((c) => c.id.endsWith(":improv"))!;
    expect(fallbackImprov.needs).toBe(fallbackImprov.id.replace(":improv", ":guides"));
  });
});

describe("the neck, asked about", () => {
  const aMinor = [9, 11, 0, 2, 4, 5, 7];
  const name = (m: number) => String(m);

  it("asks for scale notes on one string within the frets, never twice running, the same each time for a seed", () => {
    const a = stringPrompts(aMinor, 5, 10, name, seeded("x"));
    expect(a).toHaveLength(8);
    a.forEach((p, i) => {
      expect(p.midi - 40).toBeGreaterThanOrEqual(0);
      expect(p.midi - 40).toBeLessThanOrEqual(10);
      expect(aMinor).toContain(p.midi % 12);
      if (i) expect(p.midi).not.toBe(a[i - 1].midi);
    });
    expect(stringPrompts(aMinor, 5, 10, name, seeded("x"))).toEqual(a);
  });

  it("asks for the scale's 3rd above a note shown on the neck", () => {
    const ps = thirdPrompts(aMinor, 45, 70, () => ({ string: 4, fret: 0 }), name, seeded("y"));
    for (const p of ps) {
      const root = Number(p.text.replace("3rd above ", ""));
      expect([3, 4]).toContain(p.midi - root);
      expect(p.show).not.toBeNull();
    }
  });

  it("asks for the 3rd or 7th of the tune's chords, near a note", () => {
    const ps = tonePrompts([parseChord("Dm7")!, parseChord("G7")!], 52, seeded("z"));
    for (const p of ps) {
      const c = parseChord(p.text.split(" of ")[1])!;
      const want = (c.root + (p.text.startsWith("7th") ? c.seventh! : c.third!)) % 12;
      expect(p.midi % 12).toBe(want);
      expect(p.midi - 52).toBeLessThan(12);
    }
  });

  it("is a family of cards in the box, low strings first, a string's notes in any octave", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const fb = deck.cards.filter((c) => c.family === "fretboard");
    expect(fb[0].id).toBe("fb:string:5");
    expect(fb.find((c) => c.id === "fb:string:4")?.needs).toBe("fb:string:5");
    expect(fb.find((c) => c.id === "fb:string:5")?.exact).toBe(false);
    expect(fb.find((c) => c.id === "fb:thirds")?.exact).toBe(true); // the 3rd above, not below
    expect(fb.find((c) => c.id === "fb:tones")?.exact).toBe(false);
    expect(fb.every((c) => c.prompts?.length === c.last - c.first + 1)).toBe(true);
  });
});

describe("echo calls beyond the home scale's phrases", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));
  const ear = deck.cards.filter((c) => c.family === "ear");

  it("start from two notes and hear the tune's chords as lines", () => {
    expect(ear[0].id).toBe("ear:int");
    expect(ear[0].last - ear[0].first + 1).toBe(2);
    const arp = ear.find((c) => c.id.startsWith("ear:arp:"))!;
    const chord = parseChord(arp.id.slice("ear:arp:".length))!;
    expect(arp.tl.targets.every((t) => chord.pcs.includes(t.midi % 12))).toBe(true);
    expect(arp.needs).toBe("ear:2");
  });
});

describe("new material by how it is going", () => {
  const withResults = (results: Attempt["result"][]) => ({ ...store(), history: results.map((r, i) => attempt(`mel:new:${i}`, "2026-11-16", { result: r })) });

  it("tapers gently while struggling, adds more while cruising, and holds steady in between or without history", () => {
    expect(newCards(withResults(Array(16).fill("fail")))).toBe(1); // < 55%: keeps 1 flowing instead of dropping to 0
    expect(newCards(withResults([...Array(10).fill("clean"), ...Array(6).fill("ok")]))).toBe(2); // 62.5% (< 70%): half usual
    expect(newCards(withResults([...Array(12).fill("clean"), ...Array(4).fill("ok")]))).toBe(4); // 75% (70–85%): usual
    expect(newCards(withResults(Array(16).fill("clean")))).toBe(6); // > 85%: usual + 2
    expect(newCards(withResults(["fail", "fail"]))).toBe(4); // < 8 attempts: usual
  });

  it("uses recent dates and timestamps rather than the order mixed tunes were loaded", () => {
    const recent = Array.from({ length: 16 }, (_, i) => attempt("mel:new:0", "2026-11-17", { at: 100 + i }));
    const older = Array.from({ length: 16 }, (_, i) => attempt("other::mel:new:0", "2026-11-16", { result: "fail", at: i }));
    expect(newCards({ ...store(), history: [...recent, ...older] })).toBe(6);
    const later = recent.map((a, i) => ({ ...a, result: "fail" as const, at: 200 + i }));
    expect(newCards({ ...store(), history: [...later, ...recent] })).toBe(1);
  });
});

describe("progress over weeks", () => {
  it("uses musical milestones and actual clean performances, never the next suggested BPM", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const run = deck.cards.find((c) => c.run)!;
    const st = store(Object.fromEntries(deck.cards.map((c) => [c.id, { ...known(5), bpm: c.goalBpm }])));
    expect(tunePath(deck, st)).toMatchObject({ ready: 0, total: 4, share: 0 });
    st.history = [attempt(run.id, "2026-11-17", { bpm: run.goalBpm * 0.86 }), attempt(run.id, "2026-11-17", { bpm: run.goalBpm, result: "fail" })];
    expect(tunePath(deck, st).ready).toBe(0);
    st.history.push(attempt(run.id, "2026-11-17", { bpm: run.goalBpm }));
    const p = tunePath(deck, st);
    expect(p).toMatchObject({ ready: 3, total: 4, share: 0.75 });
    expect(p.milestones.find((m) => m.id === "memory")?.ready).toBe(false);
    const technique = deck.cards.find((c) => c.family === "harmony")!;
    expect(tunePath({ ...deck, cards: [...deck.cards, { ...technique, id: "optional-variant" }] }, st)).toEqual(p);
    st.history.push(...deck.cards.filter((c) => c.step?.kind === "memory").map((c) => attempt(c.id, "2026-11-17", { bpm: c.goalBpm })));
    expect(tunePath(deck, st).share).toBe(1);
  });

  it("adds up minutes per week across boxes, the last week ending today", () => {
    const st = (dates: [string, number][]) => ({ ...store(), sessions: dates.map(([date, minutes]) => ({ date, minutes, cards: 1, clean: 1 })) });
    expect(weeklyMinutes([st([["2026-11-17", 20], ["2026-11-11", 10]]), st([["2026-11-10", 5], ["2026-10-01", 99]])], "2026-11-17")).toEqual([0, 0, 5, 30]);
  });
});

describe("recorded takes", () => {
  it("keep a tune's first take and its newest ten", () => {
    const takes = Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, tuneId: "t", cardId: "mel:run", day: "2026-11-17", at: i, bpm: 80, share: 0.8 }));
    expect(toDrop(takes)).toEqual(["t1", "t2"]);
    expect(toDrop(takes.slice(0, 5))).toEqual([]);
  });
});

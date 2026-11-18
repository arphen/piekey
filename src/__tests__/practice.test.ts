import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteResult, ReadingBar, ReadingNote } from "../core/contract";
import { buildDeck, mixDecks } from "../song/deck";
import { windowAt } from "../song/fingering";
import { makeScale, parseChord } from "../song/harmony";
import { loadStore, loadStores, saveStore, saveStores } from "../song/leitner";
import { tunePath } from "../overview/progress";
import { cardTrend } from "../song/stats";
import { seeded } from "../song/rand";
import { freshLine, KNOWN, knownLine, knownNotes, vary } from "../song/reading";
import { createTrouble, spotCard } from "../song/spot";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";

const note = (midi: number, startBeat: number): ReadingNote => ({ rest: false, midi, vexKey: "a/4", accidental: null, duration: "q", dotted: false, startBeat, durationBeats: 1, string: 0, fret: 0 });

/** Four bars in A minor, four notes a bar. */
function sheet(id = "t"): LeadSheet {
  const chords = ["Am", "Dm7", "E7", "Am"];
  const bars: ReadingBar[] = chords.map((c, i) => ({ barIndex: i, chordSymbols: [c], chordBeats: [0], notes: [57, 60, 64, 60].map((m, k) => note(m, i * 4 + k)), beats: 4, section: i === 0 ? "A" : undefined }));
  return { id, title: id.toUpperCase(), composer: "", keySignature: "Am", timeSignature: "4/4", tempo: 100, bars, barNumbers: chords.map((_, i) => String(i + 1)), comp: [], chordsFromVoicings: false };
}

describe("a part of a long piece that keeps going wrong", () => {
  const tune = sheet();
  const whole = buildDeck(tune, buildTimeline(tune)).cards.find((c) => c.id.startsWith("mel:tune"))!;
  const pass = (wrong: number[]): NoteResult[] => whole.tl.targets.map((_, i) => (wrong.includes(i) ? "miss" : "hit"));

  it("is taken out once the same bar has come out short twice running", () => {
    const trouble = createTrouble(whole);
    expect(trouble.pass(pass([4, 5]))).toBeNull(); // once is a slip
    expect(trouble.pass(pass([4, 6]))).toMatchObject({ from: 1, to: 1, first: 4, last: 7 });
    // a time through in which the bar was fine starts the count again
    const other = createTrouble(whole);
    other.pass(pass([8, 9]));
    other.pass(pass([]));
    expect(other.pass(pass([8, 9]))).toBeNull();
  });

  it("gets a fingering of its own, in one position", () => {
    const spot = spotCard(whole, { from: 1, to: 1, first: 4, last: 7 });
    expect(spot).toMatchObject({ first: 4, last: 7, spot: true });
    const steps = spot.steps.slice(4, 8);
    expect(steps.every((s) => s !== null && s.fret >= spot.p - 1 && s.fret <= spot.p + 4)).toBe(true);
  });
});

describe("reading that cannot be memorised", () => {
  it("writes every known tune in whole bars", () => {
    for (const tune of KNOWN)
      for (const bar of tune.bars) expect([tune.title, knownNotes({ ...tune, bars: [bar] }).reduce((n, [, beats]) => n + beats, 0)]).toEqual([tune.title, 4]);
    const w = windowAt(5);
    const line = knownLine(KNOWN[0], 0, w);
    expect(line.every((n) => n.midi >= w.low && n.midi <= w.high)).toBe(true);
  });

  it("writes the same line for the same seed, another one for another, inside the position", () => {
    const scale = makeScale(9, "naturalMinor");
    const spans = ["Am", "Dm7", "E7", "Am"].map((c, i) => ({ chord: parseChord(c)!, scale, t: i * 4, dur: 4 }));
    const w = windowAt(5);
    const a = freshLine(spans, w, seeded("a"), 1);
    expect(freshLine(spans, w, seeded("a"), 1)).toEqual(a);
    expect(freshLine(spans, w, seeded("b"), 1)).not.toEqual(a);
    expect(a.every((n) => n.midi >= w.low && n.midi <= w.high && n.t >= 0 && n.t + n.dur <= 16 + 1e-6)).toBe(true);
    const last = a[a.length - 1];
    expect([9, 0]).toContain(last.midi % 12); // at home in A minor: its root or its third
  });

  it("moves some notes of a melody and leaves its rhythm alone", () => {
    const melody = [57, 60, 64, 60, 57, 60, 64, 60].map((midi, i) => ({ midi, t: i, dur: 1 }));
    const scale = makeScale(9, "naturalMinor");
    const { notes, changed } = vary(melody, () => scale, seeded("x"), 50, 70);
    expect(changed.length).toBeGreaterThanOrEqual(2);
    expect(changed).not.toContain(0);
    expect(notes.map((n) => [n.t, n.dur])).toEqual(melody.map((n) => [n.t, n.dur]));
    for (const i of changed) expect(scale.pcs).toContain(notes[i].midi % 12);
  });

  it("brings new notes when the round changes, under the same exercise", () => {
    const tune = sheet();
    const tl = buildTimeline(tune);
    const line = (round: string) => buildDeck(tune, tl, { round }).cards.find((c) => c.kind === "line")!;
    expect(line("a").id).toBe(line("b").id);
    expect(line("a").tl.targets.map((t) => t.midi)).not.toEqual(line("b").tl.targets.map((t) => t.midi));
    expect(line("a")).toMatchObject({ family: "reading", fresh: true, listen: false });
  });
});

describe("a session over several tunes", () => {
  // the card boxes live in localStorage: a plain map stands in for it
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
      clear: () => kept.clear(),
      key: (i: number) => [...kept.keys()][i] ?? null,
      get length() {
        return kept.size;
      },
    });
  });
  const decks = ["one", "two"].map((id) => {
    const tune = sheet(id);
    return { tuneId: id, deck: buildDeck(tune, buildTimeline(tune)) };
  });

  it("keeps the tunes' exercises apart and their scales as one, introduced in turn", () => {
    const mixed = mixDecks(decks[0].deck, [decks[1]]);
    const scales = decks[0].deck.cards.filter((c) => c.family === "scales").length;
    expect(mixed.cards.filter((c) => c.family === "scales")).toHaveLength(scales);
    expect(new Set(mixed.cards.map((c) => c.id)).size).toBe(mixed.cards.length);
    expect(mixed.cards.some((c) => c.id.startsWith("two::mel:") && c.tune === "TWO")).toBe(true);
    const melodies = mixed.intro.filter((id) => id.includes("mel:"));
    expect(melodies[0].startsWith("two::")).not.toBe(melodies[1].startsWith("two::"));
  });

  it("puts each exercise back into its own tune's box", () => {
    const st = { box: 3, due: "2026-01-01", bpm: 90, seen: 2, clean: 2, last: "clean" as const };
    const store = loadStores(["one", "two"]);
    saveStores(["one", "two"], { ...store, cards: { "mel:tune:0-3": st, "two::mel:tune:0-3": { ...st, box: 2 }, "scale:A-naturalMinor:run": st } });
    expect(loadStore("one").cards["mel:tune:0-3"].box).toBe(3);
    expect(loadStore("two").cards["mel:tune:0-3"].box).toBe(2);
    expect(Object.keys(loadStore("two").cards).some((id) => id.includes("::"))).toBe(false);
    expect(loadStore("two").cards["scale:A-naturalMinor:run"].box).toBe(3); // the player's, whichever tune
    expect(loadStores(["one", "two"]).cards["two::mel:tune:0-3"].box).toBe(2);
    saveStore("two", { ...loadStore("two"), sessions: [{ date: "2026-01-01", minutes: 5, cards: 2, clean: 1 }] });
    saveStores(["one", "two"], loadStores(["one", "two"]));
    expect(loadStore("two").sessions).toHaveLength(1); // a mixed session leaves the other tune's own record alone
  });

  it("merges legacy and timestamped attempts chronologically across tunes", () => {
    const old = { id: "mel:tune:0-3", day: "2026-11-16", result: "fail" as const, bpm: 80, share: 0.3, secs: 60, from: 1, to: 1 };
    const latest = { ...old, day: "2026-11-17", result: "clean" as const, at: 400, goalBpm: 100 };
    saveStore("one", { ...loadStore("one"), history: [latest] });
    saveStore("two", { ...loadStore("two"), history: [old, { ...latest, at: 300 }] });
    const mixed = loadStores(["one", "two"]);
    expect(mixed.history?.map((a) => [a.id, a.at])).toEqual([["two::mel:tune:0-3", undefined], ["two::mel:tune:0-3", 300], ["mel:tune:0-3", 400]]);
  });

  it("retains legacy clean performances after detailed history is trimmed", () => {
    const deck = decks[0].deck;
    const run = deck.cards.find((card) => card.run)!;
    const old = { id: run.id, day: "2026-01-01", result: "clean" as const, bpm: run.goalBpm, share: 0.95, secs: 60, from: 1, to: 2 };
    const rest = Array.from({ length: 800 }, (_, index) => ({ ...old, id: "mel:new:0-1", day: "2026-01-02", at: index, result: "fail" as const }));
    const legacy = { box: 2, due: "2026-01-02", bpm: run.goalBpm + 4, seen: 1, clean: 1, last: "clean" as const };
    saveStore("one", { ...loadStore("one"), cards: { [run.id]: legacy }, history: [old, ...rest] });
    const loaded = loadStore("one");
    expect(loaded.history?.some((a) => a.id === run.id)).toBe(false);
    expect(tunePath(deck, loaded).milestones.find((m) => m.id === "run")?.ready).toBe(true);
    expect(cardTrend(loaded, run.id).best).toBe(run.goalBpm);
  });
});

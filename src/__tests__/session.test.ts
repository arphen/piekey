import { describe, expect, it } from "vitest";
import type { ReadingBar, ReadingNote } from "../core/contract";
import { initFollow, stepFollow, type FollowState } from "../follow/follower";
import { buildDeck } from "../song/deck";
import { fitsClick, guessKey, guessPattern, readGrid, restingLock, stepLock, toRise, vamp, type Lock } from "../song/freeplay";
import { cleanTake } from "../song/judge";
import { kinship } from "../song/kin";
import { carryOver, planSession, unlocked, type Store } from "../song/leitner";
import { assignNoteKeys, commandMidis, usedMidis } from "../song/notekeys";
import { buildTree } from "../song/tree";
import { buildThemeCatalog, initThemeCapture, rankThemeMatches, stepThemeCapture, THEME_MAX_NOTES, THEME_MAX_TUNES, type ThemeCapture } from "../song/theme";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline, type Timeline } from "../tunes/order";
import { matchesPitch } from "../tunes/scoring";

const note = (midi: number, startBeat: number): ReadingNote => ({ rest: false, midi, vexKey: "a/4", accidental: null, duration: "q", dotted: false, startBeat, durationBeats: 1, string: 0, fret: 0 });

/** Four bars in A minor that use both the natural and the harmonic minor. */
function sheet(): LeadSheet {
  const chords = ["Am", "Dm7", "E7", "Am"];
  const bars: ReadingBar[] = chords.map((c, i) => ({ barIndex: i, chordSymbols: [c], chordBeats: [0], notes: [57, 60, 64, 60].map((m, k) => note(m, i * 4 + k)), beats: 4, section: i === 0 ? "A" : undefined }));
  return { id: "t", title: "T", composer: "", keySignature: "Am", timeSignature: "4/4", tempo: 100, bars, barNumbers: chords.map((_, i) => String(i + 1)), comp: [], chordsFromVoicings: false };
}

const emptyStore = (): Store => ({ v: 1, cards: {}, sessions: [], settings: { newPerSession: 4, guide: false, voice: false, window: null } });

describe("armed opening themes", () => {
  const opening = [60, 60, 64, 67, 65, 62, 64, 60];
  const timeline = (midis: number[]): Timeline => ({ slots: [], comp: [], total: midis.length, targets: midis.map((midi, i) => ({ midi, t: i, dur: 1, notes: [i], bar: 0, slot: 0 })) });
  const source = (id: string, midis = opening) => ({ id, title: id, tl: timeline(midis) });

  it("requires a strong original-key prefix, accepts any octave, and preserves shared-opening ambiguity", () => {
    const catalog = buildThemeCatalog([source("b"), source("a", [...opening.slice(0, 6), 65, 60])]);
    expect(rankThemeMatches(catalog, opening.slice(0, 5))).toEqual([]);
    expect(rankThemeMatches(catalog, opening.slice(0, 6).map((m, i) => m + (i % 2 ? 12 : -12))).map((candidate) => candidate.id)).toEqual(["a", "b"]);
    expect(rankThemeMatches(catalog, opening.slice(0, 7))).toEqual([{ id: "b", title: "b", matchedNotes: 7 }]);
    expect(rankThemeMatches(catalog, opening.map((m) => m + 2))).toEqual([]);
    expect(rankThemeMatches(catalog, [40, 41, ...opening])).toMatchObject([{ id: "b", matchedNotes: 8 }]);
    expect(rankThemeMatches(catalog, [60, 60, 64, 68, 65, 62])).toEqual([]);
  });

  it("bounds catalog and sequence work and leaves short, invalid or unvaried openings to manual selection", () => {
    const large = Array.from({ length: THEME_MAX_TUNES + 20 }, (_, i) => source(`t${i}`, Array.from({ length: 100 }, (_v, n) => opening[n % opening.length])));
    const catalog = buildThemeCatalog(large);
    expect(catalog.themes).toHaveLength(THEME_MAX_TUNES);
    expect(catalog.omitted).toBe(20);
    expect(catalog.themes.every((theme) => theme.pcs.length === THEME_MAX_NOTES)).toBe(true);
    const unsupported = buildThemeCatalog([source("short", opening.slice(0, 5)), source("one", Array(16).fill(60)), source("bad", [...opening.slice(0, 5), Number.NaN])]);
    expect(unsupported).toEqual({ themes: [], omitted: 3 });
    expect(rankThemeMatches(catalog, [...Array(500).fill(40), ...opening])).toHaveLength(THEME_MAX_TUNES);
  });

  it("counts fresh same-pitch picks and stable changed notes, never sustained frames or brief dropouts", () => {
    const feed = (state: ThemeCapture, midi: number | null, frames: number, rms = 0.02) => {
      for (let i = 0; i < frames; i++) state = stepThemeCapture(state, { midi, rms });
      return state;
    };
    let state = feed(initThemeCapture(), 60, 100);
    expect(state.heard).toEqual([]); // already ringing when the chooser opened
    state = feed(state, null, 6, 0);
    state = feed(state, 60, 100);
    expect(state.heard).toEqual([60]);
    state = feed(state, null, 1, 0);
    state = feed(state, 60, 4);
    expect(state.heard).toEqual([60, 60]); // a fresh rising attack after the quiet analysis frame
    state = feed(state, 60, 100);
    expect(state.heard).toHaveLength(2);
    state = feed(state, null, 1, 0.02); // pitch detector dropout without an attack or gap
    state = feed(state, 60, 4);
    expect(state.heard).toHaveLength(2);
    state = feed(state, 64, 3);
    expect(state.heard).toEqual([60, 60, 64]);
    state = feed(state, 64, 12, 0.01);
    state = feed(state, 64, 3, 0.04);
    expect(state.heard).toEqual([60, 60, 64, 64]);
    for (let i = 0; i < 100; i++) state = feed(state, i % 2 ? 64 : 67, 3, 0.04);
    expect(state.heard).toHaveLength(THEME_MAX_NOTES);
    expect(state.levels.length).toBeLessThanOrEqual(8);
    expect(state.runFrames).toBeLessThanOrEqual(3);
  });
});

describe("exercises that are related", () => {
  const deck = buildDeck(sheet(), buildTimeline(sheet()));
  const run = "scale:A-naturalMinor:run";
  const harmonic = "scale:A-harmonicMinor:run";

  it("share progress by how much they have in common", () => {
    expect(kinship(run, harmonic)).toBe(0.5); // one note apart, same tonic
    expect(kinship("scale:C-major:run", run)).toBe(0.5); // the same seven notes
    expect(kinship(run, "scale:A-naturalMinor:thirds")).toBeGreaterThan(0); // the same scale, another pattern
    expect(kinship("scale:C-major:run", "scale:F#-major:run")).toBe(0);
    expect(kinship(run, "mel:new:0-1")).toBe(0);
  });

  it("carry a relative up a box once a whole box of credit has come together", () => {
    const store = emptyStore();
    store.cards[harmonic] = { box: 1, due: "2026-11-15", bpm: 72, seen: 1, clean: 0, last: "ok" };
    store.credit = { [harmonic]: 0.6 };
    const card = deck.cards.find((c) => c.id === run)!;
    const { store: after, moved } = carryOver(store, deck, card, "2026-11-15");
    expect(moved).toEqual([{ id: harmonic, from: 1, to: 2 }]);
    expect(after.cards[harmonic].box).toBe(2);
    expect(after.credit![harmonic]).toBeCloseTo(0.1);
  });

  it("open in stages: a pattern waits for the scale it is made of", () => {
    const store = emptyStore();
    const thirds = deck.cards.find((c) => c.id === "scale:A-naturalMinor:thirds")!;
    expect(thirds.needs).toBe(run);
    expect(unlocked(thirds, store)).toBe(false);
    const ids = planSession(deck, { ...store, settings: { ...store.settings, newPerSession: 40 } }, "2026-11-15");
    expect(ids).toContain(run);
    expect(ids.some((id) => deck.cards.find((c) => c.id === id)?.needs)).toBe(false);
    store.cards[run] = { box: 2, due: "2026-11-16", bpm: 76, seen: 1, clean: 1, last: "clean" };
    expect(unlocked(thirds, store)).toBe(true);
  });
});

describe("a take", () => {
  it("is clean when the edges or one note in twelve went astray", () => {
    const hits = (n: number) => Array<"hit" | "miss">(n).fill("hit");
    expect(cleanTake(hits(8))).toBe(true);
    expect(cleanTake(["miss", ...hits(10), "miss"])).toBe(true); // first and last
    const one = hits(14);
    one[6] = "miss";
    expect(cleanTake(one)).toBe(true);
    const two = hits(14);
    two[5] = two[6] = "miss";
    expect(cleanTake(two)).toBe(false);
  });

  /** Feeds frames of one pitch: `level` then `frames - 1` more at the same level. */
  const feed = (s: FollowState, targets: number[], midi: number | null, frames: number, level: number, t: { now: number }) => {
    for (let i = 0; i < frames; i++) s = stepFollow(s, targets, { midi, rms: level, now: (t.now += 25) }, true);
    return s;
  };

  it("does not begin on a string still ringing from before", () => {
    const targets = [50, 52, 53];
    const t = { now: 0 };
    let s = feed(initFollow(3), targets, 50, 6, 0.01, t); // left over from the take before
    expect(s.index).toBe(0);
    s = feed(s, targets, 50, 4, 0.06, t); // picked
    expect(s.index).toBe(1);
    expect(s.results[0]).toBe("hit");
  });

  it("counts a first note that was already ringing when the player goes straight on", () => {
    const targets = [50, 52, 53];
    const t = { now: 0 };
    let s = feed(initFollow(3), targets, 50, 6, 0.01, t);
    s = feed(s, targets, 52, 4, 0.06, t);
    expect(s.results.slice(0, 2)).toEqual(["hit", "hit"]);
    expect(s.index).toBe(2);
  });
});

describe("note keys", () => {
  it("sit on their home notes unless the exercise plays them", () => {
    expect(assignNoteKeys(["hear", "pace"], [])).toEqual({ hear: 76, pace: 41 });
    const taken = assignNoteKeys(["hear", "pace"], [76, 41]);
    expect(taken.hear).toBe(77);
    expect([76, 41]).not.toContain(taken.pace);
  });

  it("never land on a note the card or its band sounds", () => {
    const deck = buildDeck(sheet(), buildTimeline(sheet()));
    for (const card of deck.cards) {
      const used = usedMidis(card);
      for (const m of Object.values(assignNoteKeys(["hear", "pace", "time", "next"], used))) expect(used).not.toContain(m);
    }
  });

  it("leaves a correct alternate-octave melody note available instead of making it a command", () => {
    const deck = buildDeck(sheet(), buildTimeline(sheet()));
    const card = deck.cards.find((candidate) => candidate.run)!;
    expect(card.exact).not.toBe(true);
    expect(card.tl.targets.some((target) => target.midi === 64)).toBe(true);
    expect(matchesPitch(76, 64, !card.exact)).toBe(true);
    expect(assignNoteKeys(["hear"], usedMidis(card)).hear).toBe(76); // the previously conflicting E5
    const keys = Object.values(assignNoteKeys(["hear", "pace", "time", "next"], commandMidis(card)));
    for (const key of keys) if (key !== null) expect(card.tl.targets.some((target) => matchesPitch(key, target.midi, !card.exact))).toBe(false);
    const exact = { ...card, exact: true };
    expect(assignNoteKeys(["hear"], commandMidis(exact)).hear).toBe(76);
  });

  it("uses no direct note commands when every pitch class belongs to an octave-tolerant melody", () => {
    const card = buildDeck(sheet(), buildTimeline(sheet())).cards.find((candidate) => candidate.run)!;
    const targets = Array.from({ length: 12 }, (_, i) => ({ ...card.tl.targets[0], midi: 60 + i, t: i }));
    const chromatic = { ...card, first: 0, last: 11, tl: { ...card.tl, targets } };
    expect(assignNoteKeys(["hear", "pace", "time", "next"], commandMidis(chromatic))).toEqual({ hear: null, pace: null, time: null, next: null });
    expect(assignNoteKeys(["hear", "pace", "time", "next"], commandMidis({ ...chromatic, exact: true }))).toEqual({ hear: 76, pace: 41, time: 43, next: 44 });
  });

  it("reserves every chord tone and any-note choice in every octave even on an exact card", () => {
    const card = buildDeck(sheet(), buildTimeline(sheet())).cards.find((candidate) => candidate.run)!;
    const allowed = [4, 5, 7, 8]; // all four usual command homes
    for (const target of [
      { ...card.tl.targets[0], midi: 60, any: allowed },
      { ...card.tl.targets[0], midi: 60, chord: { required: allowed, clash: [], voicing: [64, 65, 67, 68] } },
    ]) {
      const choices = { ...card, exact: true, first: 0, last: 0, tl: { ...card.tl, targets: [target] } };
      const keys = Object.values(assignNoteKeys(["hear", "pace", "time", "next"], commandMidis(choices)));
      for (const key of keys) if (key !== null) expect(allowed).not.toContain(key % 12);
    }
    // Tones the chord scorer only tolerates stay free: a chord card keeps all its note keys.
    const target = { ...card.tl.targets[0], chord: { required: [4], clash: [1, 3], voicing: [64] } };
    const chord = { ...card, exact: true, first: 0, last: 0, tl: { ...card.tl, targets: [target] } };
    const keys = Object.values(assignNoteKeys(["hear", "pace", "time", "next"], commandMidis(chord)));
    expect(keys.every((key) => key !== null && key % 12 !== 4)).toBe(true);
  });
});

describe("free play", () => {
  const up = (from: number, steps: number[]) => steps.map((s) => from + s);
  const major = [0, 2, 4, 5, 7, 9, 11, 12];
  const cRun = [...up(48, major), ...up(48, major).reverse().slice(1)];

  it("hears the key and which minor it is", () => {
    expect(guessKey(cRun)).toMatchObject({ tonic: 0, mode: "major" });
    const harmonic = up(57, [0, 2, 3, 5, 7, 8, 11, 12]);
    expect(guessKey([...harmonic, ...harmonic.reverse().slice(1)])?.scale.id).toBe("A-harmonicMinor");
    expect(guessKey([48, 50])).toBeNull();
  });

  it("tells a run from thirds from triads", () => {
    const scale = guessKey(cRun)!.scale;
    const degrees = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67];
    expect(guessPattern(cRun, scale)?.pattern).toBe("run");
    expect(guessPattern([0, 1, 2, 3, 4, 5].flatMap((d) => [degrees[d], degrees[d + 2]]), scale)?.pattern).toBe("thirds");
    expect(guessPattern([0, 1, 2, 3, 4].flatMap((d) => [degrees[d], degrees[d + 2], degrees[d + 4]]), scale)?.pattern).toBe("triads");
  });

  it("reads where the notes sit on the click", () => {
    const eighths = Array.from({ length: 12 }, (_, i) => 1000 + i * 250 + 30);
    expect(readGrid(eighths, 1000, 500)).toMatchObject({ division: 2, onGrid: 1 });
    expect(readGrid(eighths, 1000, 500)!.offset).toBeCloseTo(30);
  });

  const reading = (offset: number | number[], onGrid = 0.95, inKey = 1) => {
    const offsets = typeof offset === "number" ? Array<number>(12).fill(offset) : offset;
    const grid = readGrid(offsets.map((o, i) => 1000 + i * 375 + o), 1000, 750, 6);
    return { notes: offsets.length, grid: grid ? { ...grid, onGrid: Math.min(onGrid, grid.onGrid) } : null, inKey, beatMs: 750 };
  };

  it("raises equally for steady early/late playing, slows for actual drift and steps out for scattered notes", () => {
    const on: Lock = { ...restingLock(80), on: true };
    for (const offset of [-150, 5, 150]) {
      const r = reading(offset);
      expect(r.grid?.offset).toBeCloseTo(offset);
      const twice = stepLock(stepLock(on, r).lock, r);
      expect(twice.change).toBe("up");
      expect(twice.lock.bpm).toBe(84);
    }
    const drift = reading(Array.from({ length: 12 }, (_, i) => i * 12));
    let behind = stepLock(stepLock(on, drift).lock, drift);
    expect(behind.lock).toMatchObject({ bpm: 80, mood: "behind" });
    behind = stepLock(behind.lock, drift);
    expect(behind.change).toBe("down");
    const ahead = stepLock(on, reading(Array.from({ length: 12 }, (_, i) => -i * 12)));
    expect(ahead.lock).toMatchObject({ bpm: 80, mood: "ahead", clean: 0 });
    const loose = stepLock(stepLock(on, reading(0, 0.3)).lock, reading(0, 0.3));
    expect(loose.change).toBe("off");
    expect(loose.lock.on).toBe(false);
  });

  it("holds a tempo the player chose until the playing is very clean, and rests when they stop", () => {
    const on: Lock = { ...restingLock(80), on: true };
    // the click went up and the player did not go with it: back down, and it stays
    const rose = stepLock(stepLock(on, reading(5)).lock, reading(5)).lock;
    const drift = reading(Array.from({ length: 12 }, (_, i) => i * 12));
    const declined = stepLock(stepLock(rose, drift).lock, drift);
    expect(declined.change).toBe("down");
    expect(declined.lock).toMatchObject({ bpm: 80, hold: 80 });
    expect(toRise(declined.lock).need).toBe(4);
    let held = declined.lock;
    for (let i = 0; i < 3; i++) held = stepLock(held, reading(5)).lock;
    expect(held.bpm).toBe(80); // two clean readings are not enough here
    const lifted = stepLock(held, reading(5));
    expect(lifted.change).toBe("up");
    expect(lifted.lock.hold).toBeNull();
    // nothing played for two readings: the click steps out, to come back under whatever comes next
    const silence = { ...reading(0), notes: 0, grid: null };
    const rest = stepLock(stepLock(on, silence).lock, silence);
    expect(rest.change).toBe("rest");
    expect(rest.lock.on).toBe(false);
  });

  it("does not earn a rise from missing, repeated or too few attacks, or a whole-beat shift", () => {
    const on = { ...restingLock(80), on: true };
    const attacks = Array.from({ length: 12 }, (_, i) => 1000 + i * 375 + 90);
    for (const notes of [attacks.filter((_, i) => i !== 5), [...attacks, attacks[5] + 20], attacks.slice(0, 5), attacks.map((t) => t + 750)]) {
      const r = { notes: notes.length, grid: readGrid(notes, 1000, 750, 6), inKey: 1, beatMs: 750 };
      const twice = stepLock(stepLock(on, r).lock, r);
      expect(twice.change).not.toBe("up");
      expect(twice.lock.clean).toBe(0);
    }
  });

  it("knows a tempo of the player's own from one that belongs to the click", () => {
    expect(fitsClick(375, 750)).toBe(true); // 8ths
    expect(fitsClick(250, 750)).toBe(true); // triplets
    expect(fitsClick(480, 750)).toBe(false); // neither: they have moved on
  });

  it("gives the band four bars made of the scale's own notes", () => {
    const scale = guessKey(cRun)!.scale;
    const bars = vamp(scale);
    expect(bars.map((c) => c.name)).toEqual(["CΔ7", "Am7", "Dm7", "G7"]);
    for (const c of bars) for (const m of [c.bass, c.fifth, ...c.pad]) expect(scale.pcs).toContain(m % 12);
  });
});

describe("the map", () => {
  it("puts every key on the circle and fills what has been practised", () => {
    const tree = buildTree({
      cards: { "scale:A-naturalMinor:run": { box: 5, due: "", bpm: 100, seen: 6, clean: 5, last: "clean" } },
      credit: {},
      tunes: [{ id: "t", title: "Autumn Leaves", key: "A-minor", fill: 0.4 }],
      free: [],
      lit: new Set(["scale:A-naturalMinor:run"]),
    });
    expect(tree.nodes.filter((n) => n.kind === "major" || n.kind === "minor")).toHaveLength(24);
    const run = tree.nodes.find((n) => n.id === "m9/run")!;
    expect(run).toMatchObject({ fill: 1, lit: true });
    expect(tree.nodes.find((n) => n.id === "M0/run")!.fill).toBe(0); // C major: the same notes, not yet played
    expect(tree.nodes.some((n) => n.kind === "tune" && n.label === "Autumn Leaves")).toBe(true);
    const size = 640;
    for (const n of tree.nodes) expect(n.x >= 0 && n.x <= size && n.y >= 0 && n.y <= size).toBe(true);
  });
});

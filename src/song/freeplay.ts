import { mod } from "../musicTheory";
import { getStoredItem, setStoredItem } from "../storage";
import { makeScale, type Scale } from "./harmony";
import { fitTiming, timingPhaseLimit, timingTolerance } from "../tunes/scoring";

// Free play: nobody said what to play, so the app works it out from the notes. Pure functions
// over what was heard: which notes began when, what key they are in, what kind of exercise they
// make (a run, thirds, triads, 7th arpeggios), how they sit on the click, and what the click
// should do about it.
//
// The click's rule: it starts a little under the tempo the player is at, so they settle down onto
// it. Steady playing earns a faster click, a few bpm at a time. Drifting later brings it down;
// a constant early/late alignment is kept separate. And when the
// notes fall apart, the click goes away until the player has a steady tempo again.

// ---------- notes from frames ----------

const STABLE_FRAMES = 2;
const SILENT_FRAMES = 6;
const PICK_RATIO = 1.8;
const PICK_MIN_RMS = 0.004;
const LEVEL_WINDOW = 8;

export interface Onset {
  midi: number;
  at: number; // ms
}

/** Turns frames of pitch and level into note beginnings: a new pitch, or the same one picked again. */
export function createOnsets(): (frame: { midi: number | null; rms: number; now: number }) => Onset | null {
  let run: number | null = null;
  let runFrames = 0;
  let runStart = 0;
  let silent = 0;
  let fired = false;
  let last: number | null = null;
  let rearmed = true;
  let levels: number[] = [];
  let wasLoud = false;
  return (f) => {
    const floor = levels.length ? Math.min(...levels) : Infinity;
    const loud = f.rms > PICK_MIN_RMS && f.rms > floor * PICK_RATIO;
    const pick = loud && !wasLoud;
    wasLoud = loud;
    levels = [...levels, f.rms].slice(-LEVEL_WINDOW);
    if (f.midi === null) {
      run = null;
      runFrames = 0;
      if (++silent >= SILENT_FRAMES) rearmed = true;
      return null;
    }
    silent = 0;
    if (f.midi !== run || pick) {
      run = f.midi;
      runFrames = 1;
      runStart = f.now;
      fired = false;
      if (pick) rearmed = true;
      return null;
    }
    runFrames++;
    if (runFrames < STABLE_FRAMES || fired || (f.midi === last && !rearmed)) return null;
    fired = true;
    last = f.midi;
    rearmed = false;
    levels = [f.rms];
    return { midi: f.midi, at: runStart };
  };
}

// ---------- the key ----------

// Krumhansl–Kessler key profiles: how much each scale degree belongs
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MIN_NOTES = 8;
const MIN_PITCH_CLASSES = 4;
const TURN_WEIGHT = 3; // where a line starts or turns says more about the key than the notes in between

export interface KeyGuess {
  tonic: number;
  mode: "major" | "minor";
  fit: number; // correlation with the key's profile, −1..1
  scale: Scale; // major, or the minor the notes actually use (natural, harmonic, melodic)
}

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** The key a stretch of notes is in. Lines start and turn on the notes that matter, so those count for more. */
export function guessKey(midis: number[]): KeyGuess | null {
  if (midis.length < MIN_NOTES) return null;
  const weight = new Array<number>(12).fill(0);
  midis.forEach((m, i) => {
    const before = midis[i - 1];
    const after = midis[i + 1];
    const turn = before === undefined || after === undefined || (m - before) * (after - m) < 0;
    weight[mod(m)] += turn ? TURN_WEIGHT : 1;
  });
  if (weight.filter((w) => w > 0).length < MIN_PITCH_CLASSES) return null;
  let best: { tonic: number; mode: "major" | "minor"; fit: number } | null = null;
  for (let tonic = 0; tonic < 12; tonic++)
    for (const mode of ["major", "minor"] as const) {
      const profile = mode === "major" ? MAJOR_PROFILE : MINOR_PROFILE;
      const fit = correlation(weight, profile.map((_, pc) => profile[mod(pc - tonic)]));
      if (!best || fit > best.fit) best = { tonic, mode, fit };
    }
  if (!best || best.fit < 0.45) return null;
  const { tonic, mode } = best;
  if (mode === "major") return { ...best, scale: makeScale(tonic, "major") };
  // which minor: the one whose 6th and 7th are the ones being played
  const heard = (iv: number) => weight[mod(tonic + iv)];
  const kind = heard(11) > heard(10) ? (heard(9) > heard(8) ? "melodicMinor" : "harmonicMinor") : "naturalMinor";
  return { ...best, scale: makeScale(tonic, kind) };
}

// ---------- the exercise ----------

export type Pattern = "run" | "thirds" | "triads" | "sevenths" | "melody";
export const PATTERN_LABEL: Record<Pattern, string> = { run: "scale", thirds: "thirds", triads: "triads", sevenths: "7th arpeggios", melody: "melody" };

const MIN_STEPS = 8;

/** What the notes are doing inside the key: stepping, or stacking thirds in ones, twos or threes. */
export function guessPattern(midis: number[], scale: Scale): { pattern: Pattern; inKey: number } | null {
  const inScale = midis.filter((m) => scale.pcs.includes(mod(m)));
  const inKey = midis.length ? inScale.length / midis.length : 0;
  // each note as a step of the scale, octaves stacked
  const at = inScale.map((m) => Math.floor((m - scale.root) / 12) * 7 + scale.pcs.indexOf(mod(m)));
  const steps = at.slice(1).map((p, i) => p - at[i]).filter((s) => s !== 0);
  if (steps.length < MIN_STEPS) return null;
  const share = (size: number) => steps.filter((s) => Math.abs(s) === size).length / steps.length;
  if (share(1) >= 0.7) return { pattern: "run", inKey };
  if (share(2) < 0.45) return { pattern: "melody", inKey };
  // thirds in a row, in one direction: 1 at a time is thirds, 2 a triad, 3 a 7th chord
  const runs: number[] = [];
  let run = 0;
  steps.forEach((s, i) => {
    if (Math.abs(s) === 2 && (run === 0 || s === steps[i - 1])) run++;
    else {
      if (run) runs.push(run);
      run = Math.abs(s) === 2 ? 1 : 0;
    }
  });
  if (run) runs.push(run);
  const mean = runs.reduce((a, b) => a + b, 0) / (runs.length || 1);
  return { pattern: mean < 1.5 ? "thirds" : mean < 2.5 ? "triads" : "sevenths", inKey };
}

// ---------- the time ----------

export type Division = 1 | 2 | 3 | 4;
export const DIVISION_LABEL: Record<Division, string> = { 1: "quarters", 2: "8ths", 3: "triplets", 4: "16ths" };

const ON_GRID = 0.75; // share of notes on a grid for it to be the one being played
const MIN_GRID_NOTES = 6;

export interface Grid {
  division: Division;
  onGrid: number; // share near the fitted phase, including coverage of subdivision cells
  offset: number; // raw within-cell median alignment, ms; + after, − before
  spread: number;
  drift: number; // change in alignment across this reading, ms
  complete: boolean; // at least six distinct attacks, without missing/repeated subdivision cells
}

/** Fit one bounded phase per reading; never move the click or turn drift into a learned delay. */
export function readGrid(onsets: number[], beatAt: number, beatMs: number, beats?: number): Grid | null {
  if (onsets.length < MIN_GRID_NOTES || !Number.isFinite(beatMs) || beatMs <= 0) return null;
  let best: Grid | null = null;
  for (const division of [1, 2, 3, 4] as const) {
    const cell = beatMs / division;
    const slots = onsets.filter(Number.isFinite).sort((a, b) => a - b).map((t) => {
      const x = (t - beatAt) / cell;
      return { index: Math.round(x), offset: (x - Math.round(x)) * cell };
    }).filter((x) => beats === undefined || (x.index >= 0 && x.index < beats * division));
    const fit = fitTiming(slots.map((x) => x.offset));
    if (!fit) continue;
    const expected = beats === undefined ? slots[slots.length - 1].index - slots[0].index + 1 : Math.round(beats * division);
    const occupied = new Set(slots.map((x) => x.index));
    const tolerance = timingTolerance(beatMs, cell);
    const on = slots.filter((x) => Math.abs(x.offset - fit.offset) <= tolerance);
    const grid: Grid = {
      division, onGrid: Math.min(on.length / slots.length, occupied.size / expected), offset: fit.offset,
      spread: fit.spread, drift: fit.drift,
      complete: slots.length >= MIN_GRID_NOTES && occupied.size === slots.length && occupied.size === expected,
    };
    if (grid.complete && grid.onGrid >= ON_GRID && Math.abs(grid.offset) <= timingPhaseLimit(beatMs, cell)
      && grid.spread <= tolerance && Math.abs(grid.drift) <= tolerance) return grid;
    if (!best || grid.onGrid > best.onGrid) best = grid;
  }
  return best;
}

const TEMPO_NOTES = 6;
const TEMPO_SPREAD = 0.3;

/** The time between notes when it is even, in ms; null while it isn't. */
export function steadyGap(onsets: number[]): number | null {
  if (onsets.length < TEMPO_NOTES + 1) return null;
  const gaps = onsets.slice(-(TEMPO_NOTES + 1)).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1).sort((a, b) => a - b);
  const mid = gaps[gaps.length >> 1];
  return mid > 90 && mid < 2000 && (gaps[gaps.length - 1] - gaps[0]) / mid < TEMPO_SPREAD ? mid : null;
}

export const CLICK_MIN = 40;
export const CLICK_MAX = 160;
const UNDER = 0.9; // the click starts this far under the player
const COMFORT: [number, number] = [52, 112]; // where a click is easy to play to

/** A click for notes coming `gapMs` apart: the division that puts it at a comfortable tempo, a little under the player. */
export function clickFor(gapMs: number): { bpm: number; division: Division } {
  for (const division of [2, 1, 3, 4] as const) {
    const bpm = 60000 / (gapMs * division);
    if (bpm >= COMFORT[0] && bpm <= COMFORT[1]) return { bpm: Math.round((bpm * UNDER) / 2) * 2, division };
  }
  const division: Division = 60000 / gapMs > COMFORT[1] ? 4 : 1;
  return { bpm: Math.max(CLICK_MIN, Math.min(CLICK_MAX, Math.round((60000 / (gapMs * division)) * UNDER / 2) * 2)), division };
}

// ---------- what the click does about it ----------

export type Mood = "locked" | "ahead" | "behind" | "loose";

export interface Lock {
  on: boolean; // the click is sounding
  bpm: number;
  mood: Mood | null;
  clean: number; // readings in a row that were clean
  behind: number;
  loose: number;
  quiet: number; // readings in a row with nothing played
  streak: number; // readings in a row on the click
  hold: number | null; // a tempo the player chose, by hand or by not going along with a rise: it stays until the playing is very clean
  rose: number | null; // readings since the click last moved up by itself; null: not lately
  alignment: number | null; // preceding reading's phase, only for detecting change; never persisted
  division: Division | null;
}

export const restingLock = (bpm: number): Lock => ({ on: false, bpm, mood: null, clean: 0, behind: 0, loose: 0, quiet: 0, streak: 0, hold: null, rose: null, alignment: null, division: null });

export interface Reading {
  notes: number;
  grid: Grid | null;
  inKey: number; // share of notes in the key, 0..1
  beatMs: number;
}

export type Change = "up" | "down" | "off" | "rest" | null;

const STEP = 4;
const CLEAN_TO_RISE = 2; // clean readings before the click moves up
const HELD_TO_RISE = 4; // very clean ones, before a tempo the player chose moves again
const VERY_CLEAN = 0.9;
const BEHIND_TO_DROP = 3;
const DECLINE_WITHIN = 3; // readings after a rise in which falling behind means "not faster"
const BEHIND_TO_DECLINE = 2;
const LOOSE_TO_STOP = 2;
const QUIET_NOTES = 2; // fewer notes than this in a reading: nobody is playing
const QUIET_TO_REST = 2;

/** Is the tempo being held where the player put it? */
export const held = (s: Lock) => s.hold !== null && s.bpm >= s.hold;

/** How far the playing is from the next step up: clean readings so far, and how many it takes. */
export const toRise = (s: Lock): { have: number; need: number } => ({ have: s.clean, need: held(s) ? HELD_TO_RISE : CLEAN_TO_RISE });

/**
 * One reading (a couple of bars) of the player against the click, and what the click does next.
 * Steady playing moves it up. A player who drifts later brings it down, and one who falls behind
 * right after a rise has said "not faster": the click goes back and holds there until the playing
 * is very clean. Notes off the grid send it away; so does silence, so that stopping and coming
 * back in slower is all it takes to get a slower click.
 */
export function stepLock(s: Lock, r: Reading): { lock: Lock; change: Change } {
  if (!s.on) return { lock: s, change: null };
  if (r.notes < QUIET_NOTES) {
    const quiet = s.quiet + 1;
    if (quiet >= QUIET_TO_REST) return { lock: restingLock(s.bpm), change: "rest" };
    return { lock: { ...s, quiet, clean: 0, streak: 0, alignment: null, division: null }, change: null };
  }
  if (r.notes < MIN_GRID_NOTES || !r.grid) return { lock: { ...s, quiet: 0, clean: 0, streak: 0, alignment: null, division: null }, change: null };
  const rose = s.rose === null || s.rose + 1 > DECLINE_WITHIN ? null : s.rose + 1;
  const base: Lock = { ...s, quiet: 0, rose, alignment: r.grid.offset, division: r.grid.division };
  const cell = r.beatMs / r.grid.division;
  const tolerance = timingTolerance(r.beatMs, cell);
  if (r.grid.onGrid < 0.5 || r.inKey < 0.7) {
    const loose = s.loose + 1;
    if (loose >= LOOSE_TO_STOP) return { lock: restingLock(s.bpm), change: "off" };
    return { lock: { ...base, mood: "loose", clean: 0, streak: 0, loose }, change: null };
  }
  if (r.grid.drift > tolerance) {
    const behind = s.behind + 1;
    const declined = rose !== null && behind >= BEHIND_TO_DECLINE;
    if ((declined || behind >= BEHIND_TO_DROP) && s.bpm - STEP >= CLICK_MIN) {
      const bpm = s.bpm - STEP;
      const hold = declined ? bpm : s.hold !== null ? Math.min(s.hold, bpm) : null;
      return { lock: { ...base, bpm, mood: "behind", clean: 0, behind: 0, loose: 0, streak: 0, rose: null, hold, alignment: null, division: null }, change: "down" };
    }
    return { lock: { ...base, mood: "behind", clean: 0, streak: 0, behind, loose: 0 }, change: null };
  }
  if (r.grid.drift < -tolerance) return { lock: { ...base, mood: "ahead", clean: 0, streak: 0, behind: 0, loose: 0 }, change: null };
  const shifted = s.alignment !== null && s.division === r.grid.division && Math.abs(r.grid.offset - s.alignment) > tolerance;
  if (!r.grid.complete || shifted || r.grid.spread > tolerance || Math.abs(r.grid.offset) > timingPhaseLimit(r.beatMs, cell))
    return { lock: { ...base, mood: "loose", clean: 0, streak: 0, behind: 0, loose: 0 }, change: null };
  const good = held(s) ? r.grid.onGrid >= VERY_CLEAN && r.inKey >= 0.95 : r.grid.onGrid >= 0.8 && r.inKey >= 0.9;
  const clean = good ? s.clean + 1 : 0;
  const streak = s.streak + 1;
  if (clean >= toRise(s).need && s.bpm + STEP <= CLICK_MAX)
    return { lock: { ...base, bpm: s.bpm + STEP, mood: "locked", clean: 0, behind: 0, loose: 0, streak, rose: 0, hold: null, alignment: null, division: null }, change: "up" };
  return { lock: { ...base, mood: "locked", clean, streak, behind: 0, loose: 0 }, change: null };
}

const FIT = 0.16; // how far from a division of the beat a steady player may be and still be playing to the click

/** Do notes coming `gapMs` apart belong to this click (on some division of it), or to a tempo of their own? */
export function fitsClick(gapMs: number, beatMs: number): boolean {
  return [2, 1, 1 / 2, 1 / 3, 1 / 4].some((x) => Math.abs(gapMs - beatMs * x) <= FIT * beatMs * x);
}

// ---------- the band ----------

export interface VampChord {
  name: string; // "Dm7"
  bass: number; // midi, E2..D♯3
  fifth: number;
  pad: number[]; // 3rd, 5th and 7th around middle C
}

const SEVENTHS: Record<string, string> = { "4,7,11": "Δ7", "4,7,10": "7", "3,7,10": "m7", "3,6,10": "ø7", "3,6,9": "°7", "3,7,11": "m(Δ7)", "4,8,11": "Δ7♯5" };
const low = (pc: number, from: number) => from + mod(pc - from);

/**
 * Four bars for a band to play under whatever is being practised in `scale`: I vi ii V in major,
 * i iv V i in minor, every chord built from the scale's own notes, so nothing the player runs
 * through the scale can clash with it.
 */
export function vamp(scale: Scale): VampChord[] {
  const degrees = scale.kind === "major" ? [0, 5, 1, 4] : [0, 3, 4, 0];
  return degrees.map((d) => {
    const at = (k: number) => scale.pcs[(d + k) % 7];
    const [root, third, fifth, seventh] = [at(0), at(2), at(4), at(6)];
    const bottom = low(third, 52);
    return {
      name: scale.names[d] + (SEVENTHS[[third, fifth, seventh].map((pc) => mod(pc - root)).join(",")] ?? ""),
      bass: low(root, 40),
      fifth: low(fifth, 40),
      pad: [bottom, bottom + mod(fifth - third), bottom + mod(seventh - third)],
    };
  });
}

// ---------- what was practised, kept ----------

export interface FreeEntry {
  day: string;
  key: string; // a scale id: "C-major", "D-harmonicMinor"
  pattern: Pattern;
  bpm: number; // the fastest click played to cleanly
  division: Division;
  secs: number;
}

const STORAGE = "guitar-freeplay";
const MAX_ENTRIES = 400;

export function loadFreePlay(): FreeEntry[] {
  try {
    const raw = JSON.parse(getStoredItem(STORAGE) ?? "[]") as FreeEntry[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Adds to the day's entry for the same key and pattern, or starts one. */
export function logFreePlay(entry: FreeEntry): FreeEntry[] {
  const all = loadFreePlay();
  const same = all.find((e) => e.day === entry.day && e.key === entry.key && e.pattern === entry.pattern);
  if (same) {
    same.secs += entry.secs;
    if (entry.bpm * entry.division > same.bpm * same.division) {
      same.bpm = entry.bpm;
      same.division = entry.division;
    }
  } else all.push(entry);
  const kept = all.slice(-MAX_ENTRIES);
  try {
    setStoredItem(STORAGE, JSON.stringify(kept));
  } catch {
    // kept for this visit only
  }
  return kept;
}

/** The fastest this key and pattern has been played cleanly, on any day: notes per minute decide. */
export function freeRecord(entries: FreeEntry[], key: string, pattern: Pattern): { bpm: number; division: Division } | null {
  let best: FreeEntry | null = null;
  for (const e of entries) if (e.key === key && e.pattern === pattern && e.bpm > 0 && (!best || e.bpm * e.division > best.bpm * best.division)) best = e;
  return best ? { bpm: best.bpm, division: best.division } : null;
}

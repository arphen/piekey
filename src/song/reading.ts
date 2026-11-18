import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import { notesIn, type Window } from "./fingering";
import type { Chord, Scale } from "./harmony";
import type { LineNote } from "./lines";
import { shuffled } from "./rand";

// Material for reading that the fingers cannot know in advance, so the eyes have to do the work.
// Three kinds, each new every time it comes round:
//   a tune everybody knows, written out without its name: playing it right is hearing what it is
//   a stretch of the tune's own melody with some notes moved: the hands know the original
//   a line over the tune's chords that nobody has heard before
// All pure and seeded: the same seed writes the same notes.

// ---------- tunes everybody knows ----------

export interface Known {
  title: string;
  minor: boolean;
  bars: string[]; // per bar: "degree[:beats]", degrees 1–7 of the scale; b/# in front, ' or , after for the octave; r is a rest
}

/** Traditional and long out of copyright; four beats to the bar. */
export const KNOWN: Known[] = [
  { title: "Ode to Joy", minor: false, bars: ["3 3 4 5", "5 4 3 2", "1 1 2 3", "3:1.5 2:.5 2:2", "3 3 4 5", "5 4 3 2", "1 1 2 3", "2:1.5 1:.5 1:2"] },
  { title: "Frère Jacques", minor: false, bars: ["1 2 3 1", "1 2 3 1", "3 4 5:2", "3 4 5:2", "5:.5 6:.5 5:.5 4:.5 3 1", "5:.5 6:.5 5:.5 4:.5 3 1", "1 5, 1:2", "1 5, 1:2"] },
  { title: "Twinkle, Twinkle, Little Star", minor: false, bars: ["1 1 5 5", "6 6 5:2", "4 4 3 3", "2 2 1:2", "5 5 4 4", "3 3 2:2", "5 5 4 4", "3 3 2:2"] },
  { title: "When the Saints Go Marching In", minor: false, bars: ["r 1 3 4", "5:4", "r 1 3 4", "5:4", "r 1 3 4", "5:2 3:2", "1:2 3:2", "2:4"] },
  { title: "Jingle Bells", minor: false, bars: ["3 3 3:2", "3 3 3:2", "3 5 1:1.5 2:.5", "3:4", "4 4 4:1.5 4:.5", "4 3 3 3:.5 3:.5", "3 2 2 3", "2:2 5:2"] },
  { title: "Joy to the World", minor: false, bars: ["1':2 7:1.5 6:.5", "5:3 4", "3:2 2:2", "1:3 5", "6:3 6", "7:3 7", "1':4"] },
  { title: "Korobeiniki (the Tetris tune)", minor: true, bars: ["5 2:.5 3:.5 4 3:.5 2:.5", "1 1:.5 3:.5 5 4:.5 3:.5", "2:1.5 3:.5 4 5", "3 1 1:2", "r:.5 4 6:.5 1' 7:.5 6:.5", "5:1.5 3:.5 5 4:.5 3:.5", "2 2:.5 3:.5 4 5", "3 1 1:2"] },
  { title: "In the Hall of the Mountain King", minor: true, bars: ["1:.5 2:.5 3:.5 4:.5 5:.5 3:.5 5", "b5:.5 2:.5 b5 4:.5 b2:.5 4", "1:.5 2:.5 3:.5 4:.5 5:.5 3:.5 5:.5 1':.5", "7:.5 5:.5 3:.5 5:.5 7:2"] },
  { title: "Yankee Doodle", minor: false, bars: ["1 1 2 3", "1 3 2 5,", "1 1 2 3", "1:2 7,:2", "1 1 2 3", "4 3 2 1", "7, 5, 6, 7,", "1:2 1:2"] },
  { title: "London Bridge", minor: false, bars: ["5:1.5 6:.5 5 4", "3 4 5:2", "2 3 4:2", "3 4 5:2", "5:1.5 6:.5 5 4", "3 4 5:2", "2:2 5:2", "3 1:3"] },
  { title: "Oh! Susanna", minor: false, bars: ["r:3 1:.5 2:.5", "3 5 5:1.5 6:.5", "5 3 1:1.5 2:.5", "3 3 2 1", "2:3 1:.5 2:.5", "3 5 5:1.5 6:.5", "5 3 1:1.5 2:.5", "3 3 2 2", "1:4"] },
  { title: "Auld Lang Syne", minor: false, bars: ["r:3 5,", "1:1.5 1:.5 1 3", "2:1.5 1:.5 2 3", "1:1.5 1:.5 3 5", "6:3 6", "5:1.5 3:.5 3 1", "2:1.5 1:.5 2 3", "1:1.5 6,:.5 6, 5,", "1:4"] },
  { title: "The Can-Can", minor: false, bars: ["1 2:.5 4:.5 3:.5 2:.5 5", "5 5:.5 6:.5 3:.5 4:.5 2", "2 2:.5 4:.5 3:.5 2:.5 1:.5 1':.5", "7:.5 6:.5 5:.5 4:.5 3:.5 2:.5 1"] },
  { title: "Eine kleine Nachtmusik", minor: false, bars: ["1 r:.5 5,:.5 1 r:.5 5,:.5", "1:.5 5,:.5 1:.5 3:.5 5 r", "4 r:.5 2:.5 4 r:.5 2:.5", "4:.5 2:.5 7,:.5 2:.5 5, r"] },
  { title: "Pachelbel's Canon", minor: false, bars: ["3':2 2':2", "1':2 7:2", "6:2 5:2", "6:2 7:2"] },
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** A known tune as semitones above its keynote and beats: [semitones | null for a rest, beats]. */
export function knownNotes(tune: Known, maxBars = tune.bars.length): [number | null, number][] {
  const steps = tune.minor ? MINOR : MAJOR;
  return tune.bars.slice(0, maxBars).flatMap((bar) =>
    bar.split(/\s+/).map((tok): [number | null, number] => {
      const [what, len] = tok.split(":");
      const beats = len === undefined ? 1 : Number(len);
      const m = /^([b#]?)([1-7])([',]*)$/.exec(what);
      if (!m) return [null, beats];
      const octave = [...m[3]].reduce((n, ch) => n + (ch === "'" ? 12 : -12), 0);
      return [steps[Number(m[2]) - 1] + (m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0) + octave, beats];
    }),
  );
}

/** The tune as notes inside the position: the keynote in the octave that keeps most of it under the hand. */
export function knownLine(tune: Known, tonic: number, w: Window, maxBars?: number): LineNote[] {
  const rel = knownNotes(tune, maxBars);
  const pitches = rel.flatMap(([s]) => (s === null ? [] : [s]));
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  let best = w.low + mod(tonic - w.low);
  let cost = Infinity;
  for (let base = best - 12; base <= w.high; base += 12) {
    const out = Math.max(0, w.low - (base + lo)) + Math.max(0, base + hi - w.high);
    const c = out * 10 + Math.abs(base + (lo + hi) / 2 - (w.low + w.high) / 2);
    if (c < cost) {
      cost = c;
      best = base;
    }
  }
  const out: LineNote[] = [];
  let t = 0;
  for (const [s, beats] of rel) {
    if (s !== null) out.push({ midi: best + s, t, dur: beats });
    t += beats;
  }
  return out;
}

/** Which known tune this visit: all of them once, in an order of the player's own, before any comes again. */
export function pickKnown(order: () => number, visit: number): Known {
  return shuffled(KNOWN, order)[visit % KNOWN.length];
}

// ---------- the melody, with notes moved ----------

const VARY_SHARE = 0.3;

/**
 * The same rhythm and shape with about a third of the notes moved one step in the scale under
 * them. The first note stays (it is where the ear starts), and no two changes sit side by side.
 * `changed` lists which notes moved.
 */
export function vary(notes: LineNote[], scaleAt: (i: number) => Scale, rand: () => number, lo: number, hi: number): { notes: LineNote[]; changed: number[] } {
  const want = Math.max(Math.min(2, notes.length - 1), Math.round(notes.length * VARY_SHARE));
  const spots = shuffled(notes.map((_, i) => i).slice(1), rand);
  const changed = new Set<number>();
  const out = notes.map((n) => ({ ...n }));
  for (const i of spots) {
    if (changed.size >= want) break;
    if (changed.has(i - 1) || changed.has(i + 1)) continue;
    const scale = scaleAt(i);
    const up = rand() < 0.5;
    const step = (dir: number) => {
      for (let m = notes[i].midi + dir; m >= lo && m <= hi; m += dir) if (scale.pcs.includes(mod(m))) return m;
      return null;
    };
    const to = step(up ? 1 : -1) ?? step(up ? -1 : 1);
    // a moved note that lands on its neighbour reads as a repeat of it: not much of a change
    if (to === null || to === notes[i - 1]?.midi || to === notes[i + 1]?.midi) continue;
    out[i].midi = to;
    changed.add(i);
  }
  return { notes: out, changed: [...changed].sort((a, b) => a - b) };
}

// ---------- a line nobody has heard ----------

// negative: a rest of that length
const RHYTHMS: number[][][] = [
  [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1, 2, 1], [-1, 1, 1, 1]],
  [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 1, 0.5, 0.5, 1], [1.5, 0.5, 1, 1], [1, 1, 1.5, 0.5], [-1, 1, 0.5, 0.5, 1], [2, 0.5, 0.5, 1]],
  [[0.5, 0.5, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 0.5, 0.5, 1], [0.5, 1, 0.5, 1, 1], [1.5, 0.5, 0.5, 0.5, 1], [-0.5, 0.5, 1, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]],
];

export interface ReadSpan {
  chord: Chord;
  scale: Scale;
  t: number;
  dur: number;
}

/**
 * A melody over chord changes, in the position: chord tones where a chord arrives and on the
 * strong beats, steps of the scale in between, the last note long and at home in its chord.
 * `level` 0–2 picks the rhythms: quarters and halves, then 8ths, then off-beats.
 */
export function freshLine(spans: ReadSpan[], w: Window, rand: () => number, level: number): LineNote[] {
  if (!spans.length) return [];
  const t0 = spans[0].t;
  const end = spans[spans.length - 1].t + spans[spans.length - 1].dur;
  const lo = Math.max(w.low, OPEN_MIDI[4] + w.p); // from the A string up: lines sit in the middle of the staff
  const hi = OPEN_MIDI[0] + w.p + 3;
  const spanAt = (t: number) => spans.find((s) => t >= s.t - 1e-6 && t < s.t + s.dur - 1e-6) ?? spans[spans.length - 1];
  const pool = RHYTHMS[Math.max(0, Math.min(RHYTHMS.length - 1, level))];
  const out: LineNote[] = [];
  let prev: number | null = null;
  let dir = rand() < 0.5 ? 1 : -1;
  let lastChord = "";
  for (let bar = t0; bar < end - 1e-6; bar += 4) {
    const closing = bar + 4 >= end - 1e-6;
    const rhythm = closing ? [1, 1, 2] : pool[Math.floor(rand() * pool.length)];
    let t = bar;
    rhythm.forEach((len, k) => {
      const dur = Math.abs(len);
      if (len < 0 || t >= end - 1e-6) {
        t += dur;
        return;
      }
      const span = spanAt(t);
      const arrives = span.chord.symbol !== lastChord;
      lastChord = span.chord.symbol;
      const onBeat = Math.abs(t - Math.round(t)) < 1e-6;
      const strong = onBeat && Math.round(t - bar) % 2 === 0;
      const last = closing && k === rhythm.length - 1;
      const ref: number = prev ?? (lo + hi) / 2 + (rand() - 0.5) * 6;
      let pick: number;
      if (arrives || strong || last) {
        // a chord tone close by: the 3rd or 7th when the chord is new, the root or 3rd to end on
        const c = span.chord;
        const guide = [c.third ?? 4, c.seventh ?? c.fifth].map((iv) => mod(c.root + iv));
        const home = [c.root, mod(c.root + (c.third ?? 4))];
        const tones = notesIn(last ? home : arrives && rand() < 0.7 ? guide : c.pcs, lo, hi).filter((m) => m !== prev);
        const near = tones.filter((m) => Math.abs(m - ref) <= 5);
        const from = near.length ? near : tones;
        pick = from.length ? from.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a)) : Math.round(ref);
        if (near.length > 1 && rand() < 0.35) pick = near[Math.floor(rand() * near.length)];
        if (prev !== null && pick !== prev) dir = pick > prev ? 1 : -1;
      } else {
        // a step of the scale in the direction of travel, turning at the edges and now and then
        if (rand() < 0.22) dir = -dir;
        const p: number = prev ?? Math.round(ref);
        const next = (d: number) => {
          for (let m = p + d; m >= lo && m <= hi; m += d) if (span.scale.pcs.includes(mod(m))) return m;
          return null;
        };
        const stepped = next(dir) ?? next(-dir);
        if (stepped !== null && Math.sign(stepped - p) !== dir) dir = -dir;
        pick = stepped ?? p;
      }
      out.push({ midi: pick, t, dur });
      prev = pick;
      t += dur;
    });
  }
  return out;
}

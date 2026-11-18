import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import type { Chord } from "./harmony";
import { MAX_FRET, type Window } from "./fingering";

// Guitar voicings for comping: shells with the root on the low E or A string (root, 3rd, 7th —
// plus the ♭5 when it defines the chord), or the top four strings of the E and A barre shapes for
// triads. Through a progression each voicing is picked close to the last one, near the window.

export interface VoicingNote {
  string: number;
  fret: number;
  midi: number;
  label: string; // "R", "♭3", "7"
}

export interface Voicing {
  notes: VoicingNote[]; // low string to high
  midis: number[];
}

const LABEL: Record<number, string> = { 0: "R", 2: "2", 3: "♭3", 4: "3", 5: "4", 6: "♭5", 7: "5", 8: "♯5", 9: "6", 10: "♭7", 11: "7" };

/** Interval on each string, root string first. */
function layout(c: Chord, rootString: 5 | 4): [number, number][] {
  const third = c.third ?? 4;
  const odd = c.fifth !== 7; // ♭5 / ♯5 is part of the sound
  if (c.seventh === null)
    return rootString === 5
      ? [[5, 0], [4, c.fifth], [3, 0], [2, third]]
      : [[4, 0], [3, c.fifth], [2, 0], [1, third]];
  if (rootString === 5) return [[5, 0], [3, c.seventh], [2, third], ...(odd ? ([[1, c.fifth]] as [number, number][]) : [])];
  return odd ? [[4, 0], [3, c.fifth], [2, c.seventh], [1, third]] : [[4, 0], [3, third], [2, c.seventh]];
}

function build(c: Chord, rootString: 5 | 4, rootFret: number): Voicing | null {
  const rootMidi = OPEN_MIDI[rootString] + rootFret;
  const notes: VoicingNote[] = [];
  for (const [s, iv] of layout(c, rootString)) {
    let fret = -1;
    for (let k = -1; k <= 3; k++) {
      const f = rootMidi + iv + 12 * k - OPEN_MIDI[s];
      if (f >= rootFret - 2 && f <= rootFret + 4 && f >= 0) {
        fret = f;
        break;
      }
    }
    if (fret < 0) return null;
    const label = c.kind === "dim" && iv === 9 ? "°7" : LABEL[iv] ?? String(iv);
    notes.push({ string: s, fret, midi: OPEN_MIDI[s] + fret, label });
  }
  const fretted = notes.map((n) => n.fret).filter((f) => f > 0);
  if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 4) return null;
  if (Math.max(...notes.map((n) => n.fret)) > MAX_FRET) return null;
  return { notes, midis: notes.map((n) => n.midi) };
}

function candidates(c: Chord): Voicing[] {
  const out: Voicing[] = [];
  for (const rs of [5, 4] as const)
    for (let f = 0; f <= MAX_FRET; f++) {
      if (mod(OPEN_MIDI[rs] + f) !== c.root) continue;
      const v = build(c, rs, f);
      if (v) out.push(v);
    }
  return out;
}

const centre = (v: Voicing) => {
  const f = v.notes.map((n) => n.fret);
  return f.reduce((a, b) => a + b, 0) / f.length;
};

/** One voicing per chord, moving as little as possible and staying near the window. */
export function voiceChords(chords: Chord[], w: Window): Voicing[] {
  if (!chords.length) return [];
  const opts = chords.map(candidates);
  if (opts.some((o) => !o.length)) {
    // a chord no shell fits: fall back to its root, 3rd and 7th stacked on the middle strings
    opts.forEach((o, i) => {
      if (o.length) return;
      const c = chords[i];
      const base = 48 + mod(c.root - 48);
      const midis = c.tones.slice(0, 4).map((t) => base + t);
      o.push({ midis, notes: midis.map((m, k) => ({ string: 3 - k, fret: Math.max(0, m - OPEN_MIDI[3 - k]), midi: m, label: LABEL[c.tones[k]] ?? "" })) });
    });
  }
  const home = w.p + 1.5;
  const cost: number[][] = [opts[0].map((v) => 0.3 * Math.abs(centre(v) - home))];
  const from: number[][] = [opts[0].map(() => -1)];
  for (let i = 1; i < opts.length; i++) {
    cost.push([]);
    from.push([]);
    opts[i].forEach((v) => {
      let best = Infinity;
      let arg = 0;
      opts[i - 1].forEach((q, j) => {
        const c = cost[i - 1][j] + 0.6 * Math.abs(centre(v) - centre(q)) + (v.notes[0].string !== q.notes[0].string ? 0.3 : 0);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      cost[i].push(best + 0.3 * Math.abs(centre(v) - home));
      from[i].push(arg);
    });
  }
  const last = cost[cost.length - 1];
  let k = last.indexOf(Math.min(...last));
  const out: Voicing[] = Array(opts.length);
  for (let i = opts.length - 1; i >= 0; i--) {
    out[i] = opts[i][k];
    k = from[i][k];
  }
  return out;
}

import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import type { Chord } from "./harmony";
import { scaleNotes } from "./ear";

// Knowing the neck: prompts answered by playing. The pitch a player plays tells where it was only
// when the string is given (one pitch per fret on one string), so the prompts that need a place
// name the string or show a starting note; the rest accept the note in any octave. Every prompt
// comes from the tune's own key and chords, and a new set comes every visit (seeded).

export interface Prompt {
  midi: number; // the answer
  text: string; // what is asked: "C♯", "3rd of Dm7"
  sub: string; // under it: "on the G string", "above"
  show: { string: number; fret: number } | null; // a note shown on the neck as the starting point
}

export const STRING_NAMES = ["high E", "B", "G", "D", "A", "low E"];
const PROMPTS = 8;

const pick = <T,>(xs: T[], rand: () => number) => xs[Math.floor(rand() * xs.length) % xs.length];

/** Notes of the scale on one string, frets 0..maxFret, in a new order, never the same twice running. */
export function stringPrompts(pcs: number[], string: number, maxFret: number, name: (midi: number) => string, rand: () => number, n = PROMPTS): Prompt[] {
  const open = OPEN_MIDI[string];
  const pool = scaleNotes(pcs, open, open + maxFret);
  if (pool.length < 3) return [];
  const out: Prompt[] = [];
  let last = -1;
  for (let k = 0; out.length < n && k < n * 8; k++) {
    const m = pick(pool, rand);
    if (m === last) continue;
    last = m;
    out.push({ midi: m, text: name(m), sub: `on the ${STRING_NAMES[string]} string`, show: null });
  }
  return out;
}

/** A note of the scale shown on the neck; the scale's 3rd above it, played in the same position. */
export function thirdPrompts(pcs: number[], lo: number, hi: number, place: (midi: number) => { string: number; fret: number } | null, name: (midi: number) => string, rand: () => number, n = PROMPTS): Prompt[] {
  const pool = scaleNotes(pcs, lo, hi);
  const roots = pool.filter((_, i) => i + 2 < pool.length);
  if (roots.length < 3) return [];
  const out: Prompt[] = [];
  let last = -1;
  for (let k = 0; out.length < n && k < n * 8; k++) {
    const i = pool.indexOf(pick(roots, rand));
    if (pool[i] === last) continue;
    last = pool[i];
    const answer = pool[i + 2];
    out.push({ midi: answer, text: `3rd above ${name(pool[i])}`, sub: answer - pool[i] === 4 ? "major" : "minor", show: place(pool[i]) });
  }
  return out;
}

/** The 3rd or 7th of the tune's chords, any octave: the guide tones, found without a line around them. */
export function tonePrompts(chords: Chord[], near: number, rand: () => number, n = PROMPTS): Prompt[] {
  const usable = chords.filter((c, i) => c.third !== null && chords.findIndex((x) => x.symbol === c.symbol) === i);
  if (!usable.length) return [];
  const out: Prompt[] = [];
  let k = 0;
  while (out.length < n && k++ < n * 4) {
    const c = pick(usable, rand);
    const seventh = c.seventh !== null && rand() < 0.5;
    const pc = mod(c.root + (seventh ? c.seventh! : c.third!));
    const midi = near + mod(pc - near);
    const prev = out[out.length - 1];
    if (prev && prev.midi === midi) continue;
    out.push({ midi, text: `${seventh ? "7th" : "3rd"} of ${c.symbol}`, sub: "any octave", show: null });
  }
  return out;
}

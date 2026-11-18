import { intervalToDegree, mod } from "../musicTheory";
import type { KeyInfo, PatternStep } from "./contract";
import { OPEN_MIDI, parentScales, spell } from "./scales";

// Three-notes-per-string shapes of the key's harmonic minor: one shape per scale degree,
// each starting on that degree on the low E string (frets 1–12) and climbing 3 notes per string.

export interface ShapeNote {
  string: number; // 0 = high e, 5 = low E
  fret: number;
  midi: number;
  pc: number;
}

export interface ScaleShape {
  number: number; // 1..7, ordered up the neck; 0 = the root-to-root shape
  label: string; // "1".."7", "R"
  startName: string; // "F"
  startDegree: string; // relative to the tonic: "4"
  notes: ShapeNote[]; // 3 per string, low to high
  from: number; // lowest fret
  to: number; // highest fret
}

/** 3 notes per string from `pc` on `lowString` (lowest fret 1–12) up through the high e. */
function build3nps(key: KeyInfo, pc: number, lowString: number): Omit<ScaleShape, "number" | "label"> {
  const scale = parentScales(key).harmMinor;
  const startFret = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((f) => mod(OPEN_MIDI[lowString] + f) === pc)!;
  const startMidi = OPEN_MIDI[lowString] + startFret;
  const midis: number[] = [];
  for (let m = startMidi; midis.length < (lowString + 1) * 3; m++) if (scale.pcs.includes(mod(m))) midis.push(m);
  const notes = midis.map((midi, i) => {
    const string = lowString - Math.floor(i / 3);
    return { string, fret: midi - OPEN_MIDI[string], midi, pc: mod(midi) };
  });
  const frets = notes.map((n) => n.fret);
  return {
    startName: spell(pc, "harmMinor", key),
    startDegree: intervalToDegree(pc - key.tonicPc),
    notes,
    from: Math.min(...frets),
    to: Math.max(...frets),
  };
}

export function harmonicMinorShapes(key: KeyInfo): ScaleShape[] {
  return parentScales(key)
    .harmMinor.pcs.map((pc) => build3nps(key, pc, 5))
    .sort((a, b) => a.notes[0].fret - b.notes[0].fret)
    .map((s, i) => ({ ...s, number: i + 1, label: String(i + 1) }));
}

/**
 * Two octaves root to root: start on the tonic on the A string, 3 notes per string, end on the
 * tonic on the high e. In E minor: A7 → high e 12, shifting up on the G string.
 */
export function rootShape(key: KeyInfo): ScaleShape {
  return { ...build3nps(key, key.tonicPc, 4), number: 0, label: "R" };
}

export type ShapeDrill = "run" | "threes" | "thirds";

export const DRILL_LABELS: Record<ShapeDrill, string> = {
  run: "Up & down",
  threes: "Groups of 3",
  thirds: "Thirds",
};

const range = (a: number, b: number): number[] => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : range(b, a).reverse());

/**
 * The drill as pattern steps, repeated until it fills a whole number of 2-bar (i–V) phrases.
 * Runs and groups of 3 are triplets (one beat per string); thirds are eighths.
 */
export function shapeDrill(shape: ScaleShape, drill: ShapeDrill): { steps: PatternStep[]; bars: number } {
  const top = shape.notes.length - 1;
  let idx: number[];
  let dur: number;
  switch (drill) {
    case "run":
      idx = [...range(0, top), ...range(top, 0)];
      dur = 1 / 3;
      break;
    case "threes":
      idx = [...range(0, top - 2).flatMap((i) => [i, i + 1, i + 2]), ...range(top, 2).flatMap((i) => [i, i - 1, i - 2])];
      dur = 1 / 3;
      break;
    case "thirds":
      idx = [...range(0, top - 2).flatMap((i) => [i, i + 2]), ...range(top, 2).flatMap((i) => [i, i - 2])];
      dur = 0.5;
      break;
  }
  const once = idx.length * dur;
  let reps = 1;
  while (Math.abs(((once * reps) / 8) - Math.round((once * reps) / 8)) > 1e-6) reps++;
  const steps: PatternStep[] = [];
  for (let r = 0; r < reps; r++) {
    idx.forEach((i, k) => {
      const n = shape.notes[i];
      steps.push({ string: n.string, fret: n.fret, pc: n.pc, midi: n.midi, startBeat: (r * idx.length + k) * dur, durationBeats: dur });
    });
  }
  return { steps, bars: Math.round((once * reps) / 4) };
}

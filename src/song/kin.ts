import { mod } from "../musicTheory";
import { makeScale, type ScaleKind } from "./harmony";

// On the guitar things are connected: D harmonic minor is D natural minor with one note moved,
// F major is the same seven notes from another start, and thirds through a scale are its run
// with a different order. So work on one scale exercise counts a little for its relatives:
// kinship says how much, between 0 (nothing in common) and 1.

export interface ScaleTopic {
  root: number;
  kind: ScaleKind;
  drill: string; // run, thirds, triads, sevenths
  rhythm: string; // "" for the drill's own rhythm, else triplets, sixteenths
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "scale:Bb-harmonicMinor:thirds", "scale:C-major:run:triplets", "scale:C-major:run@E" (a chosen shape). */
export function parseScaleId(id: string): ScaleTopic | null {
  const m = /^scale:([A-G])([b#]*)-(major|naturalMinor|harmonicMinor|melodicMinor):([a-z]+)(?::([a-z]+))?(?:@[A-Za-z0-9-]+)?$/.exec(id);
  if (!m) return null;
  const alter = [...m[2]].reduce((n, ch) => n + (ch === "b" ? -1 : 1), 0);
  return { root: mod(LETTER_PC[m[1]] + alter), kind: m[3] as ScaleKind, drill: m[4], rhythm: m[5] ?? "" };
}

const SAME_NOTES = 0.5; // relatives: F major and D natural minor
const ONE_NOTE_SAME_ROOT = 0.5; // D natural, harmonic, melodic minor
const ONE_NOTE_NEIGHBOUR = 0.25; // a fifth away on the circle
const SAME_SCALE = 0.34; // the same scale in another pattern or rhythm
const OTHER_PATTERN = 0.4; // what a different pattern keeps of the above

/** How much of exercise `a` carries over to exercise `b`, 0..1. */
export function kinship(a: string, b: string): number {
  if (a === b) return 0;
  const x = parseScaleId(a);
  const y = parseScaleId(b);
  if (!x || !y) return 0;
  const sameDrill = x.drill === y.drill;
  if (x.root === y.root && x.kind === y.kind) return SAME_SCALE;
  const xs = makeScale(x.root, x.kind).pcs;
  const shared = makeScale(y.root, y.kind).pcs.filter((pc) => xs.includes(pc)).length;
  const notes = shared === 7 ? SAME_NOTES : shared === 6 ? (x.root === y.root ? ONE_NOTE_SAME_ROOT : ONE_NOTE_NEIGHBOUR) : 0;
  return notes * (sameDrill ? 1 : OTHER_PATTERN);
}

import type { HarmonyLevel, KeyInfo, Tune } from "./contract";
import { buildAutumnLeaves } from "./tunes/autumnLeaves";

export * from "./contract";
export { KEYS, getKey, parentScales, positionsFor, OPEN_MIDI, spell } from "./scales";
export { fretboardNotes } from "./fretboard";
export { landingMoves, landingTarget, stepShort } from "./landings";
export { buildPattern, PATTERN_LABELS } from "./patterns";
export { romanNumeral } from "./roman";
export type { RomanNumeral } from "./roman";
export { DRILL_LABELS, harmonicMinorShapes, rootShape, shapeDrill } from "./shapes";
export type { ScaleShape, ShapeDrill, ShapeNote } from "./shapes";

const cache = new Map<string, Tune>();
export function getTune(level: HarmonyLevel, key: KeyInfo): Tune {
  const id = `${key.tonic}-${level}`;
  let t = cache.get(id);
  if (!t) {
    t = buildAutumnLeaves(level, key);
    cache.set(id, t);
  }
  return t;
}

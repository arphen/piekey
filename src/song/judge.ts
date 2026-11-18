import type { NoteResult } from "../core/contract";

// Verdicts on what was played. Pitch detection is not perfect, and it goes wrong most at the
// edges of a phrase (a string still ringing from before, the hand already leaving the last note),
// so a take is not held to every single note: the first and last are forgiven, and so is one
// stray mark in twelve.

const NOTES_PER_STRAY = 12;

/** Notes that landed first time, out of all of them. */
export function takeShare(results: NoteResult[]): { hit: number; total: number } {
  return { hit: results.filter((r) => r === "hit").length, total: results.length };
}

/** A take at the player's own pace that counts as clean. */
export function cleanTake(results: NoteResult[]): boolean {
  const n = results.length;
  if (!n) return false;
  const inner = n >= 4 ? results.slice(1, -1) : results;
  return inner.filter((r) => r !== "hit").length <= Math.floor(n / NOTES_PER_STRAY);
}

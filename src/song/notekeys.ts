import type { Card } from "./deck";
import { mod } from "../musicTheory";

// Note keys: single notes that work the app instead of the exercise. Each action has a home note
// well outside what exercises play (the 12th fret of the high e string, the first frets of the
// low E string); a card that happens to use an action's home gets the next free note instead.
// The keys are shown on screen, so the player never has to remember them.

/** Open strings ring on and get tuned: they never work the app. */
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];

/** The guitar menu's note (D♯5, high e fret 11): fretted, above the default fret-10 range, never a note key. */
export const SUMMON_NOTE = 75;

const LOWEST = 40;
const HIGHEST = 79; // the 15th fret of the high e string

/** Where each action likes to sit, best first. */
export const KEY_HOMES: Record<string, number[]> = {
  hear: [76, 77, 78], // E5
  pace: [41, 78, 77], // F2
  time: [43, 79, 78], // G2
  next: [44, 79], // G♯2
};

/** Every pitch a card sounds, its own notes and the band's: none of them can be a key. */
export function usedMidis(card: Card): number[] {
  const t0 = card.tl.slots[card.from].start;
  const t1 = card.tl.slots[card.to].start + card.tl.slots[card.to].beats;
  const within = (t: number) => t >= t0 - 1e-6 && t < t1 - 1e-6;
  const out = new Set<number>();
  for (const t of card.tl.targets.slice(card.first, card.last + 1)) for (const m of t.chord?.voicing ?? [t.midi]) out.add(m);
  for (const v of [...(card.tl.guide ?? []), ...(card.tl.bass ?? [])]) if (within(v.t)) out.add(v.midi);
  for (const c of card.tl.comp) if (within(c.t)) c.midis.forEach((m) => out.add(m));
  return [...out];
}

/**
 * A session command must also leave every octave of what the player plays available: chord tones,
 * improvisation choices and (unless the card is exact) melody notes. Tones a chord scorer merely
 * tolerates stay free, or a chord card would have no note keys at all.
 */
export function commandMidis(card: Card): number[] {
  const out = new Set(usedMidis(card));
  const accepted = new Set<number>();
  for (const target of card.tl.targets.slice(card.first, card.last + 1)) {
    if (target.chord) {
      for (const pc of target.chord.required) accepted.add(mod(pc));
      for (const midi of target.chord.voicing) accepted.add(mod(midi));
    } else if (target.any) {
      for (const pc of target.any) accepted.add(mod(pc));
    } else if (!card.exact) accepted.add(mod(target.midi));
  }
  for (let midi = 0; midi <= 127; midi++) if (accepted.has(mod(midi))) out.add(midi);
  return [...out];
}

/** A note for each action: its home when the exercise leaves it free, else the nearest free note. `null` when nothing is left. */
export function assignNoteKeys(ids: string[], used: Iterable<number>, homes: Record<string, number[]> = KEY_HOMES): Record<string, number | null> {
  const busy = new Set([...used, ...OPEN_STRINGS, SUMMON_NOTE]);
  const out: Record<string, number | null> = {};
  for (const id of ids) {
    const wanted = homes[id] ?? [];
    let pick = wanted.find((m) => !busy.has(m)) ?? null;
    if (pick === null && wanted.length) {
      const near = wanted[0];
      const free = Array.from({ length: HIGHEST - LOWEST + 1 }, (_, i) => LOWEST + i).filter((m) => !busy.has(m));
      pick = free.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0] ?? null;
    }
    out[id] = pick;
    if (pick !== null) busy.add(pick);
  }
  return out;
}

/** The easiest place to play a note: the lowest fret that isn't an open string. */
export function spotOf(midi: number): { string: number; fret: number } | null {
  let best: { string: number; fret: number } | null = null;
  OPEN_STRINGS.forEach((open, i) => {
    const fret = midi - open;
    if (fret >= 1 && fret <= 15 && (!best || fret < best.fret)) best = { string: 6 - i, fret }; // strings numbered 6 (low E) to 1
  });
  return best;
}

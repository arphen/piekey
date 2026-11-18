import { mod } from "../musicTheory";
import type { LineNote } from "./lines";

// Echo cards: a short phrase is played, then played back. The notes come from the tune's own home
// scale, so a session only ever echoes keys the player plays songs in. Tiers widen the phrase:
// length, then the size of the leaps. The page is a help in the first two tiers and is hidden after.

export interface EarTier {
  n: number;
  notes: number; // phrase length
  leap: number; // the most scale steps between neighbours
  page: boolean; // the notation is shown while it is played back
  title: string;
}

export const EAR_TIERS: EarTier[] = [
  { n: 1, notes: 3, leap: 1, page: true, title: "Echo · three notes, with the page" },
  { n: 2, notes: 4, leap: 2, page: true, title: "Echo · four notes, with the page" },
  { n: 3, notes: 4, leap: 2, page: false, title: "Echo · four notes, by ear" },
  { n: 4, notes: 5, leap: 3, page: false, title: "Echo · five notes, wider steps" },
];

/** Every note of the scale (pitch classes `pcs`) between `lo` and `hi`, lowest first. */
export function scaleNotes(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod(m))) out.push(m);
  return out;
}

/**
 * One phrase in the scale. It starts on the tonic, 3rd or 5th near the middle of the range, moves
 * by at most `tier.leap` scale steps and ends on a tonic, 3rd or 5th so it sounds finished.
 * From tier two an adjacent pair repeats: the rhythm, not a changed pitch, marks its fresh attack.
 * Dotted and eighth-note groups give the call a rhythm of its own. Same `rand`, same phrase.
 */
export function earPhrase(pcs: number[], tonic: number, lo: number, hi: number, tier: EarTier, rand: () => number): LineNote[] {
  const pool = scaleNotes(pcs, lo, hi);
  if (pool.length < 4) return [];
  const stable = new Set([0, 2, 4].map((deg) => mod(pcsAbove(pcs, tonic)[deg])));
  const isStable = (i: number) => stable.has(mod(pool[i]));
  const mid = Math.floor(pool.length / 2);
  const starts = pool.map((_, i) => i).filter((i) => isStable(i) && Math.abs(i - mid) <= 3);
  let at = (starts.length ? starts : [mid])[Math.floor(rand() * Math.max(1, starts.length))];
  const idx = [at];
  const repeatAt = tier.n >= 2 && tier.notes >= 4 ? 1 + Math.floor(rand() * (tier.notes - 2)) : -1;
  for (let k = 1; k < tier.notes; k++) {
    if (k === repeatAt) { idx.push(at); continue; }
    const last = k === tier.notes - 1;
    const moves: number[] = [];
    for (let d = 1; d <= tier.leap; d++) moves.push(d, -d);
    const ok = moves.map((d) => at + d).filter((i) => i >= 0 && i < pool.length && i !== at && (!last || isStable(i)));
    const options = ok.length ? ok : moves.map((d) => at + d).filter((i) => i >= 0 && i < pool.length && i !== at);
    // small steps are likelier than leaps
    const weights = options.map((i) => 1 / (1 + Math.abs(i - at) * 0.8));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let pick = options[options.length - 1];
    for (let j = 0; j < options.length; j++) {
      r -= weights[j];
      if (r <= 0) {
        pick = options[j];
        break;
      }
    }
    at = pick;
    idx.push(at);
  }
  const rhythms: number[][] = tier.notes === 3 ? [[1.5, 0.5, 2], [0.5, 1.5, 2]]
    : tier.notes === 4 ? [[1, 0.5, 0.5, 2], [0.5, 0.5, 1, 2], [1.5, 0.5, 1, 1]]
      : tier.notes === 5 ? [[0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 1, 1], [0.5, 1, 0.5, 1, 1]] : [Array(tier.notes).fill(1) as number[]];
  const durations = rhythms[Math.floor(rand() * rhythms.length)];
  let t = 0;
  const notes = idx.map((i, k) => {
    const note = { midi: pool[i], t, dur: durations[k] };
    t += note.dur;
    return note;
  });
  const lastNote = notes[notes.length - 1];
  lastNote.dur = Math.max(lastNote.dur, Math.ceil((lastNote.t + lastNote.dur) / 4 - 1e-9) * 4 - lastNote.t);
  return notes;
}

/** The scale's pitch classes in order from the tonic, so degree 0 is the tonic. */
function pcsAbove(pcs: number[], tonic: number): number[] {
  return [...pcs].sort((a, b) => mod(a - tonic) - mod(b - tonic));
}

/** A phrase of the tune itself, from `t0`, at most `max` notes, moved to start at beat 0. */
export function echoOfTune(melody: LineNote[], t0: number, max: number): LineNote[] {
  const from = melody.filter((n) => n.t >= t0 - 1e-6).slice(0, max);
  if (from.length < 3) return [];
  const start = from[0].t;
  const notes = from.map((n) => ({ midi: n.midi, t: n.t - start, dur: n.dur }));
  const last = notes[notes.length - 1];
  last.dur = Math.max(last.dur, Math.ceil((last.t + last.dur) / 4 - 1e-9) * 4 - last.t);
  return notes;
}

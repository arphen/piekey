import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";

// One position at a time: a four-fret window [p, p+3] (one finger per fret), with a stretch of one
// fret either side when a note isn't there. Six frets per string cover every note between the
// lowest and highest note of the window, so any line inside that range can be played in position.

export const MAX_FRET = 10; // acoustic guitar: the body meets the neck around fret 12–14

export interface Fingered {
  string: number; // 0 = high e
  fret: number;
}

export interface Window {
  p: number; // first fret of the four-fret core
  low: number; // lowest midi in the core (low E string)
  high: number; // highest midi in the core (high e string)
}

export const windowAt = (p: number): Window => ({ p, low: OPEN_MIDI[5] + p, high: OPEN_MIDI[0] + p + 3 });

/** The position for a tune: its home tonic under the first fingers on the low E or A string, near fret 5. */
export function chooseWindow(tonic: number, maxFret = MAX_FRET): Window {
  let best = { p: 5, score: -Infinity };
  for (let p = 1; p + 4 <= maxFret; p++) {
    const onE = [p, p + 1, p + 2].some((f) => mod(OPEN_MIDI[5] + f) === tonic);
    const onA = [p, p + 1, p + 2].some((f) => mod(OPEN_MIDI[4] + f) === tonic);
    const score = (onE ? 3 : 0) + (onA ? 2 : 0) - 0.3 * Math.abs(p - 5);
    if (score > best.score) best = { p, score };
  }
  return windowAt(best.p);
}

/** The position that holds the most of these notes, as near to `prefer` as that allows. */
export function fitWindow(midis: number[], prefer: number, maxFret = MAX_FRET): Window {
  let best = windowAt(prefer);
  let cost = Infinity;
  for (let p = 1; p + 4 <= maxFret; p++) {
    const w = windowAt(p);
    const c = midis.filter((m) => m < w.low - 1 || m > w.high + 1).length * 10 + Math.abs(p - prefer);
    if (c < cost) {
      cost = c;
      best = w;
    }
  }
  return best;
}

function options(midi: number, p: number): (Fingered & { cost: number })[] {
  const out: (Fingered & { cost: number })[] = [];
  const lo = Math.max(0, p - 1);
  for (let s = 0; s < 6; s++) {
    const fret = midi - OPEN_MIDI[s];
    if (fret < lo || fret > p + 4) continue;
    const core = fret >= p && fret <= p + 3;
    out.push({ string: s, fret, cost: core ? 0 : fret === 0 ? 0.6 : 1.6 });
  }
  return out;
}

/**
 * Strings and frets for a line inside the window, chosen for the whole line at once: little hand
 * movement, no string crossings against the direction of the line, stretches only when needed.
 */
export function fingerLine(midis: number[], w: Window): Fingered[] {
  const opts = midis.map((m) => {
    const o = options(m, w.p);
    if (o.length) return o;
    // outside the window: the nearest spot to it, so the line still shows
    let best: (Fingered & { cost: number }) | null = null;
    for (let s = 0; s < 6; s++) {
      const fret = m - OPEN_MIDI[s];
      if (fret < 0 || fret > 15) continue;
      const d = fret < w.p ? w.p - fret : Math.max(0, fret - w.p - 3);
      if (!best || d < best.cost) best = { string: s, fret, cost: d };
    }
    return [best ? { ...best, cost: 5 + best.cost } : { string: 0, fret: 0, cost: 99 }];
  });
  if (!midis.length) return [];
  const cost: number[][] = [opts[0].map((o) => o.cost - 0.05 * o.string)]; // lower strings first: lines start low
  const from: number[][] = [opts[0].map(() => -1)];
  for (let i = 1; i < midis.length; i++) {
    const up = midis[i] > midis[i - 1];
    const down = midis[i] < midis[i - 1];
    cost.push([]);
    from.push([]);
    opts[i].forEach((o) => {
      let best = Infinity;
      let arg = 0;
      opts[i - 1].forEach((q, j) => {
        const ds = o.string - q.string; // negative: towards the high e
        let c = cost[i - 1][j] + 0.45 * Math.abs(o.fret - q.fret) + 0.35 * Math.abs(ds);
        if (ds === 0 && Math.abs(o.fret - q.fret) >= 4) c += 2;
        if (Math.abs(ds) >= 2) c += 0.6;
        if ((up && ds > 0) || (down && ds < 0)) c += 1.5;
        if (midis[i] === midis[i - 1] && (ds !== 0 || o.fret !== q.fret)) c += 1;
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      cost[i].push(best + o.cost);
      from[i].push(arg);
    });
  }
  const last = cost[cost.length - 1];
  let k = last.indexOf(Math.min(...last));
  const out: Fingered[] = Array(midis.length);
  for (let i = midis.length - 1; i >= 0; i--) {
    out[i] = { string: opts[i][k].string, fret: opts[i][k].fret };
    k = from[i][k];
  }
  return out;
}

/** Notes of a pitch-class set between two midis, ascending. */
export function notesIn(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod(m))) out.push(m);
  return out;
}

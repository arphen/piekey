import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import type { Chord, Scale } from "./harmony";
import { notesIn, type Window } from "./fingering";

// The single-note lines the exercises are made of, all inside the position window:
// scale runs, thirds, diatonic triads and 7ths, and over chord changes the arpeggios,
// a guide-tone line (3rds and 7ths moving by step) and an arpeggio chain.

export interface LineNote {
  midi: number;
  t: number; // beats
  dur: number;
}

export interface Span {
  chord: Chord;
  t: number;
  dur: number;
}

export type ScaleDrill = "run" | "thirds" | "triads" | "sevenths";

/** Lay out notes back to back from beat 0; the last note rings to the end of its bar. */
function inTime(midis: number[], dur: number): LineNote[] {
  const notes = midis.map((midi, i) => ({ midi, t: i * dur, dur }));
  const last = notes[notes.length - 1];
  if (last) {
    const end = Math.ceil((last.t + dur) / 4 - 1e-9) * 4;
    last.dur = Math.max(dur, end - last.t);
  }
  return notes;
}

const range = (a: number, b: number) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []);

/**
 * A scale drill in position, from the lowest tonic. The run climbs to the top of the window,
 * comes down to its lowest note and back up to the tonic; the others go up and back down.
 * `noteBeats` sets the rhythm (1/3: triplets, 1/4: 16ths); left out, each drill has its own.
 */
export function scaleLine(drill: ScaleDrill, scale: Scale, w: Window, noteBeats?: number): LineNote[] {
  const notes = notesIn(scale.pcs, w.low, w.high);
  const t0 = notes.findIndex((m) => mod(m) === scale.root);
  if (t0 < 0) return [];
  let top = notes.length - 1;
  let idx: number[];
  let dur = 0.5;
  if (drill === "run") {
    // on another grid the run turns a note or two lower, so that it still ends on a beat
    const div = noteBeats ? Math.round(1 / noteBeats) : 2;
    while (top > t0 + 1 && (2 * top) % div !== 0) top--;
    idx = [...range(t0, top), ...range(0, top - 1).reverse(), ...range(1, t0)];
  } else {
    const offsets = drill === "thirds" ? [0, 2] : drill === "triads" ? [0, 2, 4] : [0, 2, 4, 6];
    const span = offsets[offsets.length - 1];
    idx = [];
    for (const d of range(t0, top - span)) idx.push(...offsets.map((o) => d + o));
    for (const d of range(t0 + span, top).reverse()) idx.push(...offsets.map((o) => d - o));
    if (drill === "triads") dur = 1 / 3;
  }
  return inTime(idx.map((i) => notes[i]), noteBeats ?? dur);
}

/** Lowest root in the window that leaves room to climb `above` semitones. */
function rootFor(c: Chord, w: Window, above: number): number {
  const roots = notesIn([c.root], w.low - 1, w.high);
  return roots.find((r) => r >= w.low && r + above <= w.high + 1) ?? roots.find((r) => r >= w.low) ?? roots[0] ?? w.low;
}

/** Notes filling a span in 8ths; a long chord (two bars or more) arpeggiates a bar, then holds its root. */
function fill(span: Span, cycle: number[], hold: number): LineNote[] {
  const out: LineNote[] = [];
  const play = span.dur >= 8 ? 4 : span.dur;
  const n = Math.max(1, Math.round(play * 2));
  for (let k = 0; k < n; k++) out.push({ midi: cycle[k % cycle.length], t: span.t + k * 0.5, dur: 0.5 });
  const last = out[out.length - 1];
  if (span.dur >= 8) out.push({ midi: hold, t: span.t + 4, dur: span.dur - 4 });
  else last.dur = span.t + span.dur - last.t;
  return out;
}

/** Each chord's 1-3-5-7 from its root as the chord arrives, up and back down. */
export function arpLine(spans: Span[], w: Window): LineNote[] {
  return spans.flatMap((s) => {
    const c = s.chord;
    const third = c.third ?? 4;
    const seventh = c.seventh;
    const r = rootFor(c, w, seventh !== null ? 12 : 12 + third);
    const up = seventh !== null ? [0, third, c.fifth, seventh, 12] : [0, third, c.fifth, 12, 12 + third];
    const down = seventh !== null ? [seventh, c.fifth, third] : [12, c.fifth, third];
    return fill(s, [...up, ...down].map((iv) => r + iv), r);
  });
}

/** The 3rds and 7ths (3rd and 5th for triads), each moving to the nearest one of the next chord. */
export function guideLine(spans: Span[], w: Window): LineNote[] {
  const lo = OPEN_MIDI[3] + w.p;
  const hi = OPEN_MIDI[1] + w.p + 3;
  const out: LineNote[] = [];
  let prev: number | null = null;
  for (const s of spans) {
    const c = s.chord;
    const guides = [c.third ?? 4, c.seventh ?? c.fifth].map((iv) => mod(c.root + iv));
    const count = s.dur >= 4 ? 2 : 1;
    let firstPc = -1;
    for (let j = 0; j < count; j++) {
      const pcs = j === 0 ? guides : guides.filter((pc) => pc !== firstPc);
      const cands = notesIn(pcs, lo, hi);
      if (!cands.length) continue;
      const ref: number = prev ?? (lo + hi) / 2;
      // nearest; on a tie, step down (a 7th falling to the next 3rd)
      const pick = cands.reduce((a, b) => {
        const da = Math.abs(a - ref);
        const db = Math.abs(b - ref);
        return db < da || (db === da && b < a) ? b : a;
      });
      if (j === 0) firstPc = mod(pick);
      out.push({ midi: pick, t: s.t + (j * s.dur) / count, dur: s.dur / count });
      prev = pick;
    }
  }
  return out;
}

/** Unbroken 8ths through the chord tones; at each change, step to the nearest tone of the new chord. */
export function chainLine(spans: Span[], w: Window): LineNote[] {
  const out: LineNote[] = [];
  let last: number | null = null;
  let dir = 1;
  for (const s of spans) {
    const c = s.chord;
    const tones = notesIn(c.pcs, w.low, w.high);
    if (!tones.length) continue;
    const n = Math.max(1, Math.round(s.dur * 2));
    for (let k = 0; k < n; k++) {
      let next: number;
      if (last === null) next = rootFor(c, w, 12);
      else if (k === 0) {
        // the closest chord tone that isn't the note just played, in the direction of travel on a tie
        const l: number = last;
        const others = tones.filter((m) => m !== l);
        next = others.length ? others.reduce((a, b) => {
          const da = Math.abs(a - l);
          const db = Math.abs(b - l);
          return db < da || (db === da && Math.sign(b - l) === dir) ? b : a;
        }) : l;
        if (next !== l) dir = next > l ? 1 : -1;
      } else {
        const l: number = last;
        let ahead = tones.filter((m) => (dir > 0 ? m > l : m < l));
        if (!ahead.length) {
          dir = -dir;
          ahead = tones.filter((m) => (dir > 0 ? m > l : m < l));
        }
        next = ahead.length ? (dir > 0 ? Math.min(...ahead) : Math.max(...ahead)) : l;
      }
      out.push({ midi: next, t: s.t + k * 0.5, dur: 0.5 });
      last = next;
    }
    const tail = out[out.length - 1];
    tail.dur = s.t + s.dur - tail.t;
  }
  return out;
}

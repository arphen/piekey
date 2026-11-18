import type { NoteResult, PatternStep } from "../core/contract";

// What one visit to an exercise leaves behind besides its verdict: not only how many notes landed
// but where they went wrong, so the mistakes of many exercises can be read together
// (`profile.ts`). Everything here is counted from what the session already hears; strings are
// inferred from the fingering (nothing hears which string sounded), so the shape counts say
// "crossing" and "shift", never "wrong string".

/** [judged, missed]: kept as counts, not shares, so attempts add up. */
export type Tally = [number, number];

export interface Timing {
  n: number; // notes with a measured onset
  mean: number; // ms, + = after the beat
  spread: number; // standard deviation, ms
  rush: number; // notes well ahead of the beat
  drag: number; // notes well behind it
}

export interface Evidence {
  notes: Tally; // first-try notes
  wrong: [written: number, heard: number][]; // what sounded instead, midi
  leap: Tally; // notes reached by a leap of a fourth or more
  cross: Tally; // notes on another string than the one before (as fingered)
  shift: Tally; // notes just after the hand moves along the neck
  time?: Timing; // passes in time
  restarts: number; // takes started over at the player's own pace
  hears: number; // times the passage was asked for again
  weakBars?: number[]; // a run-through's bars (printed index) where most notes went missing
}

const MAX_WRONG = 8;
const LEAP = 5; // semitones: a fourth
const SHIFT_FRETS = 3; // a reach past the four-fret box
const SHIFT_NOTES = 2; // notes counted as "just after" a shift
const OFF_MS = 60; // further than this from the beat is rushing or dragging

const add = (t: Tally, missed: boolean): void => {
  t[0]++;
  if (missed) t[1]++;
};

export interface EvidenceLog {
  /** A take or a pass: arrays parallel to the timeline's targets, judged over `first..last`. */
  notes(midis: readonly number[], steps: readonly (PatternStep | null)[], results: readonly NoteResult[], heard: readonly (number | null)[], first: number, last: number): void;
  /** Onset offsets in ms, + = late, of the notes of a pass in time. */
  timing(offsets: readonly (number | null)[]): void;
  restart(): void;
  hear(): void;
  weak(bars: number[]): void;
  done(): Evidence | undefined;
}

export function createEvidence(): EvidenceLog {
  const e: Evidence = { notes: [0, 0], wrong: [], leap: [0, 0], cross: [0, 0], shift: [0, 0], restarts: 0, hears: 0 };
  const offs: number[] = [];
  return {
    notes(midis, steps, results, heard, first, last) {
      let sinceShift = SHIFT_NOTES;
      for (let i = first; i <= last; i++) {
        const r = results[i];
        const prev = i > first ? steps[i - 1] : null;
        const step = steps[i];
        if (prev && step && Math.abs(step.fret - prev.fret) >= SHIFT_FRETS) sinceShift = 0;
        else sinceShift++;
        if (!r) continue;
        const missed = r !== "hit";
        add(e.notes, missed);
        if (i > first && Math.abs(midis[i] - midis[i - 1]) >= LEAP) add(e.leap, missed);
        if (prev && step && prev.string !== step.string) add(e.cross, missed);
        if (sinceShift < SHIFT_NOTES) add(e.shift, missed);
        const h = heard[i];
        if (missed && h !== null && h !== undefined && h !== midis[i] && e.wrong.length < MAX_WRONG) e.wrong.push([midis[i], h]);
      }
    },
    timing(offsets) {
      for (const o of offsets) if (o !== null && o !== undefined && Number.isFinite(o)) offs.push(o);
    },
    restart() {
      e.restarts++;
    },
    hear() {
      e.hears++;
    },
    weak(bars) {
      e.weakBars = [...bars];
    },
    done() {
      if (!e.notes[0] && !offs.length) return undefined;
      const out: Evidence = { ...e, notes: [...e.notes], leap: [...e.leap], cross: [...e.cross], shift: [...e.shift], wrong: [...e.wrong] };
      if (offs.length) out.time = timingOf(offs);
      return out;
    },
  };
}

/** Mean, spread and the notes well off the beat. */
export function timingOf(offsets: readonly number[]): Timing {
  const n = offsets.length;
  const mean = offsets.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    n,
    mean: Math.round(mean),
    spread: Math.round(spread),
    rush: offsets.filter((o) => o < -OFF_MS).length,
    drag: offsets.filter((o) => o > OFF_MS).length,
  };
}

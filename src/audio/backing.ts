import { mod } from "../musicTheory";
import type { ChordInBar, KeyInfo, Tune } from "../core/contract";
import { getKey, parentScales } from "../core/scales";

export type BackingKind = "bass" | "comp" | "ride" | "hat" | "kick";

export interface BackingEvent {
  /** beats from loop start (straight grid; `off` events are swung later) */
  beat: number;
  kind: BackingKind;
  midis: number[];
  durBeats: number;
  vel: number;
  off: boolean;
}

const BASS_LO = 28; // E1
const BASS_HI = 48; // C3

function placeNear(pc: number, ref: number, lo: number, hi: number): number {
  let best = -1;
  for (let m = lo; m <= hi; m++) {
    if (mod(m) !== mod(pc)) continue;
    if (best < 0 || Math.abs(m - ref) < Math.abs(best - ref)) best = m;
  }
  return best < 0 ? ref : best;
}

function chordAt(bar: { chords: ChordInBar[] }, beat: number): { chord: ChordInBar; start: number } {
  let t = 0;
  for (const c of bar.chords) {
    if (beat < t + c.beats) return { chord: c, start: t };
    t += c.beats;
  }
  return { chord: bar.chords[bar.chords.length - 1], start: t - bar.chords[bar.chords.length - 1].beats };
}

/** Rootless/shell voicing: 3rd + 7th, plus 9th (if in parent scale) or 5th. */
export function compVoicing(chord: ChordInBar, key: KeyInfo): number[] {
  const third = placeNear(chord.guideTones[0], 58, 52, 64);
  let seventh = third + 1;
  while (mod(seventh) !== mod(chord.guideTones[1])) seventh++;
  const scale = parentScales(key)[chord.parentScale];
  const ninth = mod(chord.rootPc + 2);
  const extraPc = scale.pcs.includes(ninth) ? ninth : mod(chord.chordTones[2] ?? chord.rootPc + 7);
  let extra = seventh + 1;
  while (mod(extra) !== extraPc) extra++;
  return [third, seventh, extra];
}

/** Generate backing events for bars loop.start..loop.end; beats are relative to loop start. */
export function generateBacking(tune: Tune, loop: { start: number; end: number }): BackingEvent[] {
  const ev: BackingEvent[] = [];
  const key = getKey(tune.key.replace(" minor", ""));
  const start = Math.max(0, loop.start);
  const end = Math.min(tune.bars.length - 1, loop.end);
  let prevBass = 36;
  for (let b = start; b <= end; b++) {
    const bar = tune.bars[b];
    const nextBar = tune.bars[b === end ? start : b + 1];
    const base = (b - start) * 4;

    // bass
    for (let k = 0; k < 4; k++) {
      const { chord, start: cs } = chordAt(bar, k);
      const rel = k - cs;
      // next chord (may be the next bar)
      const idx = bar.chords.indexOf(chord);
      const nextChord = idx < bar.chords.length - 1 ? bar.chords[idx + 1] : nextBar.chords[0];
      const lastOfChord = rel === chord.beats - 1;
      let pc: number;
      if (rel === 0) pc = chord.rootPc;
      else if (lastOfChord) {
        const below = b % 2 === 0;
        pc = nextChord.rootPc + (below ? -1 : 1);
      } else if (rel === 1) pc = b % 2 === 0 ? chord.guideTones[0] : chord.chordTones[2] ?? chord.rootPc;
      else pc = b % 2 === 0 ? chord.chordTones[2] ?? chord.rootPc : chord.guideTones[0];
      const midi = placeNear(pc, prevBass, BASS_LO, BASS_HI);
      prevBass = midi;
      ev.push({ beat: base + k, kind: "bass", midis: [midi], durBeats: 0.9, vel: rel === 0 ? 0.9 : 0.75, off: false });
    }

    // comp: Charleston — start of each chord, plus the "and" of 2 for full-bar chords
    for (const [i, chord] of bar.chords.entries()) {
      const cs = bar.chords.slice(0, i).reduce((a, c) => a + c.beats, 0);
      const v = compVoicing(chord, key);
      ev.push({ beat: base + cs, kind: "comp", midis: v, durBeats: 1, vel: 0.55, off: false });
      if (chord.beats === 4) ev.push({ beat: base + cs + 1.5, kind: "comp", midis: v, durBeats: 0.5, vel: 0.5, off: true });
    }

    // drums
    for (let k = 0; k < 4; k++) {
      ev.push({ beat: base + k, kind: "ride", midis: [], durBeats: 0.5, vel: k % 2 === 0 ? 0.55 : 0.65, off: false });
      ev.push({ beat: base + k, kind: "kick", midis: [], durBeats: 0.25, vel: 0.12, off: false });
      if (k % 2 === 1) ev.push({ beat: base + k, kind: "hat", midis: [], durBeats: 0.1, vel: 0.7, off: false });
      if (k % 2 === 1) ev.push({ beat: base + k + 0.5, kind: "ride", midis: [], durBeats: 0.3, vel: 0.35, off: true });
    }
  }
  return ev;
}

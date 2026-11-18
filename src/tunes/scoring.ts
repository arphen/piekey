import { mod } from "../musicTheory";

/** Pitch policy is the same in timed playback and the own-pace follower: exact, or any octave. */
export const matchesPitch = (heard: number, written: number, anyOctave: boolean): boolean =>
  anyOctave ? mod(heard) === mod(written) : heard === written;

export interface PitchSample {
  t: number;
  midi: number | null;
  onset: number | null; // the beginning of a stable note, rather than another frame of its ring
}

export interface PitchWindow {
  midi: number;
  any?: readonly number[]; // improvisation accepts a ringing chord tone
  anyOctave: boolean;
  start: number;
  end: number;
  first: boolean;
  last: boolean;
  before: number | null;
  previousStart?: number | null;
  after?: number | null;
  nextStart?: number | null;
  lag: number;
}

/** Ties are already one timeline target. A second untied copy of a note needs a new beginning. */
export function judgePitch(samples: readonly PitchSample[], p: PitchWindow): { hit: boolean; wrong: number | null; offset: number | null } {
  const repeated = !p.any && p.before !== null && matchesPitch(p.before, p.midi, p.anyOctave);
  const repeatsNext = !p.any && p.after !== null && p.after !== undefined && matchesPitch(p.after, p.midi, p.anyOctave);
  const edge = p.start - (p.first ? 320 : 200);
  // Phase tolerance cannot give neighbouring targets ownership of the same attack.
  const lo = (p.previousStart !== null && p.previousStart !== undefined ? Math.max(edge, (p.previousStart + p.start) / 2) : edge) + p.lag;
  const end = p.end + (p.last ? 320 : 80);
  const exclusiveEnd = p.nextStart !== null && p.nextStart !== undefined;
  const hi = (exclusiveEnd ? Math.min(end, (p.start + p.nextStart!) / 2) : end) + p.lag;
  const within = (at: number) => at >= lo && (exclusiveEnd ? at < hi : at <= hi);
  const fits = (midi: number) => p.any ? p.any.includes(mod(midi)) : matchesPitch(midi, p.midi, p.anyOctave);
  const onset = samples.find((x) => x.midi !== null && fits(x.midi) && x.onset !== null && within(x.onset));
  const found = onset ?? (!repeated && !repeatsNext ? samples.find((x) => x.midi !== null && within(x.t) && fits(x.midi)) : undefined);
  if (found) return { hit: true, wrong: null, offset: onset?.onset !== null && onset?.onset !== undefined ? onset.onset - p.lag - p.start : null };
  const count = new Map<number, number>();
  for (const x of samples) {
    if (x.midi !== null && x.t >= lo && x.t <= hi && (p.before === null || mod(x.midi) !== mod(p.before))) count.set(x.midi, (count.get(x.midi) ?? 0) + 1);
  }
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  return { hit: false, wrong: top && top[1] >= 2 ? top[0] : null, offset: null };
}

export interface TimingFit {
  n: number;
  offset: number; // raw median alignment, ms; never a learned hardware latency
  spread: number; // RMS distance from that alignment, ms
  drift: number; // fitted change in offset from the first to last measured attack, ms
}

/** Keep missing positions and temporal order: sorting the offsets would conceal tempo drift. */
export function fitTiming(offsets: readonly (number | null)[]): TimingFit | null {
  const heard = offsets.flatMap((offset, i) => offset !== null && Number.isFinite(offset) ? [{ offset, i }] : []);
  if (!heard.length) return null;
  const ordered = heard.map((x) => x.offset).sort((a, b) => a - b);
  const n = heard.length;
  const offset = (ordered[(n - 1) >> 1] + ordered[n >> 1]) / 2;
  const spread = Math.sqrt(heard.reduce((sum, x) => sum + (x.offset - offset) ** 2, 0) / n);
  const meanIndex = heard.reduce((sum, x) => sum + x.i, 0) / n;
  const meanOffset = heard.reduce((sum, x) => sum + x.offset, 0) / n;
  const variance = heard.reduce((sum, x) => sum + (x.i - meanIndex) ** 2, 0);
  const slope = variance ? heard.reduce((sum, x) => sum + (x.i - meanIndex) * (x.offset - meanOffset), 0) / variance : 0;
  return { n, offset, spread, drift: slope * (heard[n - 1].i - heard[0].i) };
}

export const timingTolerance = (beatMs: number, spacingMs = beatMs): number => Math.min(Math.max(35, Math.min(65, beatMs * 0.1)), spacingMs * 0.2);
/** Stay well inside a neighbouring attack, symmetrically early/late; never wrap a whole beat. */
export const timingPhaseLimit = (beatMs: number, spacingMs = beatMs): number => Math.min(200, beatMs * 0.3, spacingMs * 0.45);

/** Edge notes stay forgiving. A constant alignment is separate from unevenness and tempo drift. */
export function assessTiming(offsets: readonly (number | null)[], bpm: number, spacingMs = 60000 / bpm): { fit: TimingFit | null; ready: boolean } {
  const middle = offsets.length >= 5 ? offsets.slice(1, -1) : offsets;
  const fit = fitTiming(middle);
  if (!fit || !Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(spacingMs) || spacingMs <= 0)
    return { fit, ready: false };
  const limit = timingTolerance(60000 / bpm, spacingMs);
  // A very short card can retain its centred timing policy, but cannot establish an offset.
  const phase = fit.n >= 3 ? timingPhaseLimit(60000 / bpm, spacingMs) : Math.min(limit, timingPhaseLimit(60000 / bpm, spacingMs));
  const enough = fit.n >= Math.min(3, middle.length) && fit.n >= middle.length * 0.8;
  return { fit, ready: enough && fit.spread <= limit && Math.abs(fit.drift) <= limit && Math.abs(fit.offset) <= phase };
}

/** The legacy measured flag does not turn observed alignment into a player-timing verdict. */
export function timingReady(offsets: readonly (number | null)[], bpm: number, _measured?: boolean, spacingMs?: number): boolean {
  return assessTiming(offsets, bpm, spacingMs).ready;
}

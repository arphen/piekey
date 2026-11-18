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
  const edge = p.start - (p.first ? 320 : 120);
  // Fast subdivisions have overlapping tolerance windows. The previous pick belongs to its own note.
  const lo = (repeated && p.previousStart !== null && p.previousStart !== undefined ? Math.max(edge, (p.previousStart + p.start) / 2) : edge) + p.lag;
  const end = p.end + (p.last ? 320 : 80);
  const exclusiveEnd = repeatsNext && p.nextStart !== null && p.nextStart !== undefined;
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

/** Edge notes stay forgiving; the middle of a pass must establish a steady, centred pulse. */
export function timingReady(offsets: readonly (number | null)[], bpm: number, measured: boolean): boolean {
  const middle = offsets.length >= 4 ? offsets.slice(1, -1) : offsets;
  const heard = middle.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!middle.length || heard.length < Math.min(3, middle.length) || heard.length < middle.length * 0.6) return false;
  const ordered = [...heard].sort((a, b) => a - b);
  const centre = ordered[ordered.length >> 1];
  const spread = Math.sqrt(heard.reduce((n, x) => n + (x - centre) ** 2, 0) / heard.length);
  const limit = Math.max(35, Math.min(65, (60000 / bpm) * 0.1));
  // A guessed input lag cannot support a small absolute judgement; steadiness still can.
  return spread <= limit && Math.abs(centre) <= (measured ? limit : Math.max(120, limit));
}

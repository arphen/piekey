import { pitchClassToName } from "./musicTheory";

export interface DetectedPitch {
  frequency: number;
  midi: number;
  pitchClass: number;
  noteName: string;
  octave: number;
  cents: number;
  clarity: number;
}

export interface DetectionResult {
  rms: number;
  frequency: number | null;
  clarity: number;
}

const MIN_FREQUENCY = 65;
const MAX_FREQUENCY = 1500;
const MAX_CLIPPING_RATIO = 0.1;
const SILENCE_RMS = 0.0012; // under this nothing is analysed, whatever the tuning says

/** The detector's judgement calls. The defaults suit most guitars; calibration fits them to one. */
export interface DetectorTuning {
  minRms: number; // quieter than this is not a note
  minClarity: number; // how periodic the sound must be
  prominence: number; // the first peak this close to the best one is taken as the pitch (octave errors live here)
}

export const DEFAULT_TUNING: DetectorTuning = { minRms: 0.003, minClarity: 0.6, prominence: 0.92 };
let tuning = DEFAULT_TUNING;

export function setDetectorTuning(t: DetectorTuning | null) {
  tuning = t ?? DEFAULT_TUNING;
}

let offsetCents = 0;

/** How far the guitar as a whole sits from concert pitch: notes are named relative to it. */
export function setTuningOffset(cents: number) {
  offsetCents = cents;
}

/** The MIDI note a frequency is, on this guitar. */
export function midiOfFrequency(frequency: number): number {
  return Math.round(69 + 12 * Math.log2(frequency / 440) - offsetCents / 100);
}

/** What a buffer has to say about pitch before any judgement: the periodicity peaks, by lag. */
export interface PitchAnalysis {
  rms: number;
  sampleRate: number;
  peaks: { lag: number; value: number; prev: number; next: number }[];
  best: number; // the highest peak
}

function average(buffer: Float32Array<ArrayBufferLike>): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    sum += buffer[i];
  }
  return sum / buffer.length;
}

export function rootMeanSquare(buffer: Float32Array<ArrayBufferLike>): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

/** The costly half: periodicity (NSDF) of the newest samples. Independent of the tuning. */
export function analysePitch(buffer: Float32Array<ArrayBufferLike>, sampleRate: number): PitchAnalysis {
  const rms = rootMeanSquare(buffer);
  const none: PitchAnalysis = { rms, sampleRate, peaks: [], best: 0 };
  if (rms < SILENCE_RMS) return none;

  const dcOffset = average(buffer);
  let clippedSamples = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (Math.abs(buffer[i] - dcOffset) > 0.97) clippedSamples += 1;
  }
  if (clippedSamples / buffer.length > MAX_CLIPPING_RATIO) return none;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQUENCY));
  const maxLag = Math.floor(sampleRate / MIN_FREQUENCY);
  // The newest samples only, and no more of them than the lowest string needs (about two and a
  // half periods): a new note is heard as soon as it fills this window, not the whole buffer.
  const windowSize = Math.min(buffer.length - maxLag - 1, Math.round(sampleRate * 0.032));
  const from = buffer.length - windowSize - maxLag - 1;
  if (windowSize < 256 || maxLag <= minLag) return none;

  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acf = 0;
    let energy = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const a = buffer[from + i] - dcOffset;
      const b = buffer[from + i + lag] - dcOffset;
      acf += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }

  const peaks: PitchAnalysis["peaks"] = [];
  let best = 0;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const value = nsdf[lag];
    const prev = nsdf[lag - 1];
    const next = nsdf[lag + 1];
    if (value > 0 && value >= prev && value >= next) {
      peaks.push({ lag, value, prev, next });
      if (value > best) best = value;
    }
  }
  return { rms, sampleRate, peaks, best };
}

/** The cheap half: which peak is the pitch, under a tuning. */
export function choosePitch(a: PitchAnalysis, t: DetectorTuning = tuning): DetectionResult {
  if (a.rms < t.minRms || a.peaks.length === 0) return { rms: a.rms, frequency: null, clarity: 0 };
  const threshold = Math.max(t.minClarity, a.best * t.prominence);
  const peak = a.peaks.find((p) => p.value >= threshold);
  if (!peak) return { rms: a.rms, frequency: null, clarity: Math.max(0, a.best) };
  const denominator = 2 * (2 * peak.value - peak.prev - peak.next);
  const refinedLag = peak.lag + (denominator !== 0 ? (peak.next - peak.prev) / denominator : 0);
  if (refinedLag <= 0) return { rms: a.rms, frequency: null, clarity: peak.value };
  return { rms: a.rms, frequency: a.sampleRate / refinedLag, clarity: peak.value };
}

export function detectPitchFromBuffer(buffer: Float32Array<ArrayBufferLike>, sampleRate: number): DetectionResult {
  return choosePitch(analysePitch(buffer, sampleRate));
}

export function frequencyToDetectedPitch(frequency: number, clarity: number): DetectedPitch {
  const midiFloat = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const pitchClass = ((midi % 12) + 12) % 12;

  return {
    frequency,
    midi,
    pitchClass,
    noteName: pitchClassToName(pitchClass),
    octave: Math.floor(midi / 12) - 1,
    cents,
    clarity,
  };
}

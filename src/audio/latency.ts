// How late the app hears a note after the string sounds: the input's buffers. Notes are timed at
// their attack (listen/attacks.ts), so the pitch detector's window no longer adds to it. Playback
// subtracts it before judging whether a note sat on the beat. Without a measurement it is a guess
// (30 ms); calibration measures it by having the player play along to a few clicks
// (`fitLatency`). The click's own output delay is accounted for by `ctxToPerf`, read from the
// output device's own clock. Measurements made before attacks were timed (no `method`) included
// the pitch window and a 50 ms output guess, so they no longer apply.
import { currentAudioSetup, sameAudioSetup, type AudioSetup } from "./setup";

const STORAGE = "guitar-latency";
const GUESS_MS = 30;
const METHOD = 2; // attack-timed notes, output read from the device
const MIN_PAIRS = 5;
const MAX_SCATTER_MS = 45; // notes this scattered around the clicks say nothing about the lag
const EARLY_MS = 150; // a note this far before a click still belongs to it
const LATE_MS = 400;

interface Measurement { ms: number; at: string; setup?: AudioSetup; method?: number }
let visit: Measurement | null = null;
let cached: { key: string; ms: number | null } | null = null;

function storedMeasurement(): string | null {
  try {
    return visit ? JSON.stringify(visit) : localStorage.getItem(STORAGE);
  } catch {
    return null;
  }
}

function valueForSetup(raw: string | null): number | null {
  try {
    const v = JSON.parse(raw ?? "null") as Measurement | null;
    return v && v.method === METHOD && Number.isFinite(v.ms) && v.ms >= 0 && v.ms <= 250 && sameAudioSetup(v.setup, currentAudioSetup()) ? v.ms : null;
  } catch {
    return null;
  }
}

export function loadLatency(): number | null {
  return valueForSetup(storedMeasurement());
}

export function saveLatency(ms: number) {
  if (!Number.isFinite(ms) || ms < 0 || ms > 250) return;
  visit = { ms, at: new Date().toISOString(), setup: currentAudioSetup() ?? undefined, method: METHOD };
  cached = null;
  try {
    localStorage.setItem(STORAGE, JSON.stringify(visit));
    visit = null;
  } catch {
    // applies for this visit
  }
}

/** The lag to subtract from a heard note's time, in ms. */
export function inputLag(): number {
  const raw = storedMeasurement();
  const key = `${JSON.stringify(currentAudioSetup())}:${raw}`;
  if (!cached || cached.key !== key) cached = { key, ms: valueForSetup(raw) };
  return cached.ms ?? GUESS_MS;
}

/** True once the lag has been measured rather than guessed: only then are small offsets meaningful. */
export const latencyMeasured = (): boolean => loadLatency() !== null;

/**
 * The lag from a play-along: the click times (when they left the speakers, perf ms) and the times a
 * note was first heard. Each click takes the first note near it; the first two clicks are the
 * player finding the beat. Null when there were too few notes or they were too scattered.
 */
export function fitLatency(clicks: number[], heard: number[]): number | null {
  const diffs: number[] = [];
  for (const c of clicks.slice(2)) {
    const h = heard.find((t) => t >= c - EARLY_MS && t <= c + LATE_MS);
    if (h !== undefined) diffs.push(h - c);
  }
  if (diffs.length < MIN_PAIRS) return null;
  const s = [...diffs].sort((a, b) => a - b);
  const mid = s[s.length >> 1];
  const scatter = [...s.map((d) => Math.abs(d - mid))].sort((a, b) => a - b)[s.length >> 1];
  if (scatter > MAX_SCATTER_MS) return null;
  return Math.max(0, Math.min(250, Math.round(mid)));
}

/**
 * Tone hands out a wrapper of the browser's AudioContext that has neither getOutputTimestamp()
 * nor outputLatency; only the native context behind it knows when sound leaves the device.
 */
export function nativeContext(ctx: AudioContext): AudioContext {
  const raw = ctx as unknown as Record<string, unknown>;
  const inner = raw._nativeAudioContext ?? raw._nativeContext;
  return inner && typeof inner === "object" ? (inner as AudioContext) : ctx;
}

const outputDelay = (c: AudioContext) => (c.outputLatency || 0) + (c.baseLatency || 0) || 0.05;

/** The audio-clock time coming out of the device right now: what is being heard, for what is shown. */
export function heardTime(ctx: AudioContext): number {
  const native = nativeContext(ctx);
  const s = native.getOutputTimestamp?.();
  if (s && s.contextTime && s.performanceTime) return s.contextTime + (performance.now() - s.performanceTime) / 1000;
  return native.currentTime - outputDelay(native);
}

/** When an audio-clock time comes out of the device, on the performance.now() clock, for what is shown. */
export function heardPerf(ctx: AudioContext, time: number): number {
  const native = nativeContext(ctx);
  const s = native.getOutputTimestamp?.();
  if (s && s.contextTime && s.performanceTime) return s.performanceTime + (time - s.contextTime) * 1000;
  return performance.now() + (time - native.currentTime + outputDelay(native)) * 1000;
}

/** A beat shown this much before it is heard is painted as it is heard: half a 25 ms tick and a frame. */
export const PAINT_LEAD_S = 0.02;

/** When an audio-clock time comes out of the speakers, on the performance.now() clock: for scoring and calibration. */
export function ctxToPerf(ctx: AudioContext, time: number): number {
  return heardPerf(ctx, time);
}

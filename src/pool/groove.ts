import { createOnsets, guessKey, readGrid, steadyGap } from "../song/freeplay";

// The pool's mood, read from the player's own pitched playing. Pure and deterministic: no DOM, no
// randomness and no clock except the frames' own `now`. It never feeds practice logic, and a
// steadiness reading is only a feature: no beat is predicted or pulsed from the player's notes.
//
// Warm-up curve: behaves like a heavy engine spinning up from cold water. The first few notes
// barely stir a distant calling; sustained, steady, clean playing builds momentum gradually,
// ebbing gently when the player falters and rising again when they lock back in.

export interface GrooveFrame { now: number; rms: number; midi: number | null; clarity: number; playing: boolean }
export interface GrooveContext {
  beatAt?: number; // ms of the last heard beat, when a click is sounding
  beatMs?: number;
  flow?: number; // the session's clean-playing share, when there is one
}
export interface GrooveOnset { midi: number; velocity: number; at: number }

export interface GrooveState {
  groove: number; // 0..1, slow flywheel
  energy: number; // loudness, smoothed
  kick: number; // gentle decaying breath from onsets, scaled by groove
  density: number; // onsets per second over the last few seconds
  steadiness: number;
  tonal: number;
  clean: number;
  continuity: number;
  tonic: number | null;
  mode: "major" | "minor" | null;
  activeMs: number;
  onsetSerial: number;
}

const CLEAR = 0.8; // clarity a pitch needs before it counts
const SOUND_RMS = 0.008;
const VOICED_MS = 900; // a pitched note keeps the room voiced this long while it rings
const BIN_MS = 250;
const BINS = 24; // 6 s of continuity: a breath between passes or a count-in does not undo it
const EARN_MS = 24000; // ~24 s of real playing opens full dynamic range; calm start, lush climb
const RISE_MS = 4600; // responsive marine flywheel: gathers speed smoothly with living momentum
const FALL_MS = 16000; // holds earned excitement gracefully across minor slips
const QUIET_FALL_MS = 8500; // halves within ~9.5 s after silence settles
const QUIET_MS = 4000;
const RATIOS = [0.5, 1, 1.5, 2, 3];

const unit = (n: number) => Math.max(0, Math.min(1, n));
const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

function regularity(times: number[]): number {
  const iois = times.slice(-13).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1).filter((x) => x > 40);
  if (iois.length < 4) return 0;
  const median = [...iois].sort((a, b) => a - b)[iois.length >> 1];
  const residuals = iois.map((ioi) => {
    const ratio = ioi / median;
    const snapped = RATIOS.reduce((best, r) => (Math.abs(r - ratio) < Math.abs(best - ratio) ? r : best), 1);
    return ratio / snapped - 1;
  });
  const cv = Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / residuals.length);
  return 1 - unit(cv / 0.15); // snapping to these ratios fits random gaps within ±25%, so allow little
}

export function createGroove() {
  const detect = createOnsets();
  const onsets: (GrooveOnset & { clarity: number })[] = [];
  const bins: boolean[] = [];
  const tonics: number[] = [];
  let last: number | null = null;
  let binStart: number | null = null;
  let binVoiced = false;
  let lastVoiced = -Infinity;
  let lastFeature = -Infinity;
  let target = 0;
  let peak = 0.02;
  const state: GrooveState = { groove: 0, energy: 0, kick: 0, density: 0, steadiness: 0, tonal: 0, clean: 0, continuity: 0, tonic: null, mode: null, activeMs: 0, onsetSerial: 0 };

  const features = (now: number, context: GrooveContext, playing: boolean) => {
    const times = onsets.map((o) => o.at);
    state.continuity = bins.filter(Boolean).length / BINS;
    const recent = times.filter((t) => now - t <= 6000);
    if (context.beatMs && context.beatAt !== undefined) state.steadiness = readGrid(recent, context.beatAt, context.beatMs)?.onGrid ?? 0;
    else state.steadiness = steadyGap(times) !== null ? 1 : regularity(times);
    const key = guessKey(onsets.slice(-24).map((o) => o.midi));
    if (key) {
      const changed = tonics.slice(-3).some((t) => t !== key.tonic);
      tonics.push(key.tonic);
      if (tonics.length > 3) tonics.shift();
      state.tonal = unit((key.fit - 0.45) / 0.3) * (changed ? 0.85 : 1);
      state.tonic = key.tonic;
      state.mode = key.mode;
    } else state.tonal = 0;
    const heard = onsets.slice(-12);
    state.clean = context.flow ?? (heard.length ? heard.reduce((s, o) => s + o.clarity, 0) / heard.length : 0);
    state.density = recent.length / 6;
    // Clean, steady, tonal playing earns the full ecstatic peak; minor slips keep momentum alive while silence cools.
    const raw = Math.pow(state.continuity, 0.72) * (0.55 * state.steadiness + 0.45 * state.tonal) * (0.55 + 0.45 * state.clean);
    // Gentle calm opening that swells rapidly once you settle into a groove.
    const earned = Math.pow(unit(state.activeMs / EARN_MS), 1.18);
    target = playing && now - lastVoiced <= QUIET_MS ? Math.min(raw, earned) : 0;
  };

  /** One input frame. Returns a note onset heard during the player's turn, for the pool to ripple and swirl. */
  const step = (frame: GrooveFrame, context: GrooveContext = {}): GrooveOnset | null => {
    const dt = last === null ? 0 : Math.max(0, Math.min(250, frame.now - last));
    last = frame.now;
    const midi = frame.midi !== null && frame.clarity >= CLEAR ? frame.midi : null;
    peak = Math.max(frame.rms, peak * Math.exp(-dt / 4000), 0.02);
    const found = detect({ midi, rms: frame.rms, now: frame.now });
    let onset: GrooveOnset | null = null;
    if (found && frame.playing) {
      onset = { midi: found.midi, at: found.at, velocity: unit(frame.rms / peak) };
      onsets.push({ ...onset, clarity: frame.clarity });
      while (onsets.length > 64 || (onsets.length && frame.now - onsets[0].at > 20000)) onsets.shift();
      state.onsetSerial++;
      // Tactile living breath on every pitched onset, building into exhilarating surges in the zone.
      state.kick = Math.min(1.6, state.kick + onset.velocity * (0.16 + 0.56 * state.groove));
    }
    if (midi !== null && frame.rms > SOUND_RMS) lastVoiced = frame.now;
    const voiced = frame.now - lastVoiced < VOICED_MS && frame.rms > SOUND_RMS * 0.5;
    if (frame.playing && voiced) state.activeMs += dt;
    else if (!voiced) state.activeMs = Math.max(0, state.activeMs - dt / 4);

    binStart ??= frame.now;
    binVoiced ||= frame.playing && voiced;
    while (frame.now - binStart >= BIN_MS) {
      bins.push(binVoiced);
      if (bins.length > BINS) bins.shift();
      binVoiced = false;
      binStart += BIN_MS;
    }
    if (frame.now - lastFeature >= BIN_MS) { lastFeature = frame.now; features(frame.now, context, frame.playing); }

    const loud = frame.playing ? unit(Math.sqrt(frame.rms) * 2.5) : 0;
    state.energy += (loud - state.energy) * ease(dt, loud > state.energy ? 320 : 1000);
    state.kick *= Math.exp(-dt / 850);
    const quiet = frame.now - lastVoiced > QUIET_MS;
    state.groove += (target - state.groove) * ease(dt, target > state.groove ? RISE_MS : quiet ? QUIET_FALL_MS : FALL_MS);
    return onset;
  };

  return { step, state: state as Readonly<GrooveState> };
}

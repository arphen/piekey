import * as Tone from "tone";
import { biquad, dcBlock, midiToHz, mulberry32, normalizeChannels, TAU } from "./dsp";
import { roomSend } from "./room";

// Warm acoustic / archtop guitar string: extended Karplus-Strong physical model rendered once per
// pitch into a stereo buffer and replayed with a buffer source.
// - Pick-position comb filtering (~21% from the bridge) removes harsh buzz and yields guitar tone.
// - Pitch-calibrated T60 decay & exact loop-filter phase delay keep tuning accurate across the neck
//   and let high notes sing sweetly instead of dying out in milliseconds.
// - Two slightly detuned string polarizations (+1.3 cents) add living acoustic warmth.
// - Wooden body resonance filters (air, spruce top, warm mid, de-boxiness, silky top roll-off)
//   plus a soft pick-on-string onset shape the string into a real instrument.

const SECONDS = 3.2;
const cache = new Map<string, AudioBuffer>();

function synthString(sr: number, len: number, midi: number, seed: number, brightOffset = 0): Float32Array {
  const f = midiToHz(midi);
  const period = sr / f;
  const w = (TAU * f) / sr;

  // Pitch-calibrated damping coefficient: warm bronze rolloff on bass strings, sweeter treble on high frets
  const reg = Math.max(0, Math.min(1, (midi - 40) / 40));
  const d = Math.max(0.14, Math.min(0.46, 0.42 - reg * 0.24 + brightOffset));

  // Exact phase delay and magnitude of H_lp(z) = (1 - d) + d * z^-1 at the fundamental
  const re = 1 - d + d * Math.cos(w);
  const im = d * Math.sin(w);
  const tauLp = w > 1e-6 ? Math.atan2(im, re) / w : d;
  const magLp = Math.hypot(re, im);

  // Keep Thiran fractional delay in [0.5, 1.5) so |ap| <= 1/3 for exact tuning and smooth HF phase
  const n = Math.max(2, Math.floor(period - tauLp - 0.5));
  const frac = period - tauLp - n;
  const ap = (1 - frac) / (1 + frac);

  // Target decay time (seconds to -60 dB): full bass sustain, singing treble
  const t60 = Math.max(1.5, Math.min(4.3, 4.1 - reg * 2.1));
  const rawLoss = Math.pow(0.001, period / (t60 * sr)) / Math.max(0.5, magLp);
  const loss = Math.min(0.9992, rawLoss);

  // Deterministic, softly filtered excitation with pick-position comb filter
  const rng = mulberry32(seed);
  const raw = new Float32Array(n);
  const excAlpha = Math.max(0.24, Math.min(0.62, 0.36 + reg * 0.22));
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const noise = rng() * 2 - 1;
    lp1 += excAlpha * (noise - lp1);
    lp2 += excAlpha * (lp1 - lp2);
    raw[i] = lp2;
  }

  // Pick-position comb (~21% from bridge) gives the hollow warm acoustic guitar spectrum
  const pickPos = Math.max(1, Math.min(n - 1, Math.round(n * 0.21)));
  const line = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const v = raw[i] - 0.78 * raw[(i - pickPos + n) % n];
    line[i] = v;
    mean += v;
  }
  mean /= n;
  for (let i = 0; i < n; i++) line[i] -= mean;

  const out = new Float32Array(len);
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0, k = 0; i < len; i++) {
    const v = line[k];
    out[i] = v;
    const filtered = (1 - d) * v + d * prev;
    prev = v;
    apOut = ap * filtered + apIn - ap * apOut;
    apIn = filtered;
    line[k] = apOut * loss;
    k = k + 1 === n ? 0 : k + 1;
  }
  dcBlock(out);
  return out;
}

function shapeGuitarBody(x: Float32Array, sr: number): void {
  biquad(x, "highpass", 68, 0.707, sr);
  biquad(x, "peaking", 108, 2.2, sr, 3.2); // Helmholtz air cavity resonance
  biquad(x, "peaking", 214, 2.4, sr, 2.6); // Main spruce top-plate warmth
  biquad(x, "peaking", 425, 1.7, sr, 1.4); // Woody midrange body
  biquad(x, "peaking", 780, 1.4, sr, -2.2); // Remove nasal boxiness
  biquad(x, "peaking", 2400, 1.2, sr, 1.2); // Gentle acoustic presence
  biquad(x, "lowpass", 5200, 0.7, sr); // Smooth natural high-frequency roll-off
}

export function renderPluckBuffer(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * SECONDS);
  const seed = ((Math.round(midi * 100) * 2654435761) ^ 0x47554954) >>> 0;

  const main = synthString(sr, len, midi, seed, 0);
  const symp = synthString(sr, len, midi + 0.013, (seed ^ 0x9e3779b9) >>> 0, 0.04);

  // Subtle acoustic pick / wooden top-plate onset (first ~14 ms)
  const rng = mulberry32((seed ^ 0x517cc1b7) >>> 0);
  const tapLen = Math.min(len, Math.floor(sr * 0.025));
  const tap = new Float32Array(tapLen);
  for (let i = 0; i < tapLen; i++) {
    const t = i / sr;
    tap[i] = (rng() * 2 - 1) * Math.min(1, t / 0.0012) * Math.exp(-t / 0.0045);
  }
  biquad(tap, "bandpass", 1450, 1.1, sr);

  // Normalize string pair before body EQ so tap sits consistently across pitches
  let mainPeak = 0;
  for (let i = 0; i < len; i++) mainPeak = Math.max(mainPeak, Math.abs(main[i]));
  let tapPeak = 0;
  for (let i = 0; i < tapLen; i++) tapPeak = Math.max(tapPeak, Math.abs(tap[i]));
  const tapGain = mainPeak > 0 && tapPeak > 0 ? (mainPeak * 0.07) / tapPeak : 0;

  const body = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    body[i] = main[i] + (i < tapLen ? tap[i] * tapGain : 0);
    side[i] = symp[i] * 0.22;
  }

  shapeGuitarBody(body, sr);
  shapeGuitarBody(side, sr);

  // Soft stereo mic imaging: mono-compatible body center + gentle micro-delayed sympathetic width
  const buf = ctx.createBuffer(2, len, sr);
  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);
  const shift = Math.max(1, Math.floor(sr * 0.00038));
  for (let i = 0; i < len; i++) {
    const sympDelayed = i >= shift ? side[i - shift] : 0;
    left[i] = body[i] + side[i];
    right[i] = body[i] - sympDelayed * 0.85;
  }

  normalizeChannels([left, right], 0.78, Math.floor(sr * 0.0022), Math.floor(sr * 0.09));
  return buf;
}

function bufferFor(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${midi}`;
  let b = cache.get(key);
  if (!b) {
    b = renderPluckBuffer(ctx, midi);
    cache.set(key, b);
  }
  return b;
}

export class BufferPluck {
  private last: { src: AudioBufferSourceNode; g: GainNode; send?: GainNode } | null = null;

  /**
   * mono: a new note damps the previous one, like fretting the next note on one string.
   * room: optional send to the shared studio room (set 0 when `out` already has a post-fader room send).
   */
  constructor(
    private out: Tone.ToneAudioNode,
    private mono = true,
    private room = 0.2,
  ) {}

  /** Render the buffer ahead of time. */
  prepare(midi: number): void {
    bufferFor(Tone.getContext().rawContext as AudioContext, midi);
  }

  trigger(midi: number, time: number, velocity = 1): void {
    const ctx = Tone.getContext().rawContext as AudioContext;
    if (this.mono && this.last) {
      this.last.g.gain.setTargetAtTime(0, time, 0.014);
      this.last.src.stop(time + 0.12);
    }
    const src = ctx.createBufferSource();
    src.buffer = bufferFor(ctx, midi);
    const g = ctx.createGain();
    g.gain.value = velocity;
    src.connect(g);
    Tone.connect(g, this.out);

    let send: GainNode | undefined;
    if (this.room > 0) {
      const dest = roomSend(ctx);
      if (dest) {
        send = ctx.createGain();
        send.gain.value = this.room;
        g.connect(send);
        send.connect(dest);
      }
    }

    src.onended = () => {
      g.disconnect();
      send?.disconnect();
    };
    src.start(time);
    this.last = { src, g, send };
  }
}

/** The plucked-string buffer for a pitch, rendered once per pitch. */
export const pluckBuffer = (midi: number) => bufferFor(Tone.getContext().rawContext as AudioContext, midi);

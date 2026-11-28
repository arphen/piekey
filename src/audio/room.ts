import * as Tone from "tone";
import { biquad, mulberry32 } from "./dsp";

// Warm, intimate wooden practice-room convolution bus.
// Deterministic, synchronous stereo impulse response (~1.3 s): subtle early studio reflections
// followed by a darkly damped stereo diffuse tail with lows high-passed out so bass stays tight.
// One shared ConvolverNode per AudioContext; zero AudioWorklets.

const IR_SECONDS = 1.32;
const irCache = new Map<number, AudioBuffer>();
const sends = new WeakMap<AudioContext, GainNode>();

// Early reflection taps: [timeMs, leftGain, rightGain]
const EARLY_TAPS: readonly [number, number, number][] = [
  [11.4, 0.42, 0.24],
  [15.8, -0.22, 0.39],
  [21.2, 0.31, -0.27],
  [27.5, -0.25, -0.33],
  [33.9, 0.26, 0.19],
  [41.3, -0.18, 0.24],
  [48.7, 0.21, -0.17],
  [56.4, -0.15, -0.19],
  [65.1, 0.14, 0.12],
  [74.2, -0.11, 0.13],
];

/** Deterministic stereo impulse response for a warm wooden music studio. */
export function roomIrBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const cached = irCache.get(sr);
  if (cached) return cached;

  const len = Math.ceil(sr * IR_SECONDS);
  const buf = ctx.createBuffer(2, len, sr);
  const left = buf.getChannelData(0);
  const right = buf.getChannelData(1);

  // Early reflections: 3-sample smoothed warm wooden taps (never raw 1-sample metallic clicks)
  for (const [ms, gl, gr] of EARLY_TAPS) {
    const idx = Math.floor((ms / 1000) * sr);
    if (idx <= 1 || idx >= len - 2) continue;
    left[idx - 1] += gl * 0.25;
    left[idx] += gl * 0.5;
    left[idx + 1] += gl * 0.25;
    right[idx - 1] += gr * 0.25;
    right[idx] += gr * 0.5;
    right[idx + 1] += gr * 0.25;
  }

  // Late stereo-decorrelated diffuse tail with progressive air absorption
  const renderTail = (ch: Float32Array, seed: number) => {
    const rng = mulberry32(seed);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < 0.018) continue;
      const bloom = Math.min(1, (t - 0.018) / 0.04);
      const decay = 0.68 * Math.exp(-(t - 0.018) / 0.21) + 0.32 * Math.exp(-(t - 0.018) / 0.42);
      // Warm progressive damping: highs absorb faster as the tail decays
      const damp = 0.16 + 0.32 * Math.exp(-t / 0.35);
      const w = rng() * 2 - 1;
      lp += damp * (w - lp);
      ch[i] += lp * bloom * decay * 0.36;
    }
    biquad(ch, "highpass", 155, 0.707, sr);
    biquad(ch, "lowpass", 3100, 0.68, sr);
    const fade = Math.min(len, Math.floor(sr * 0.09));
    for (let i = len - fade; i < len; i++) ch[i] *= (len - i) / fade;
  };

  renderTail(left, 0x51a7c0de);
  renderTail(right, 0x9b3e7f11);

  // Normalize energy (L2 norm per channel ~0.52) so wet sends sit consistently in the mix
  let energy = 0;
  for (let i = 0; i < len; i++) energy += left[i] * left[i] + right[i] * right[i];
  const rmsEnergy = Math.sqrt(energy / 2);
  const scale = rmsEnergy > 0 ? 0.52 / rmsEnergy : 1;
  for (let i = 0; i < len; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }

  irCache.set(sr, buf);
  return buf;
}

/** Shared studio-room reverb send connected to Tone's master destination, or null if unsupported. */
export function roomSend(ctx: AudioContext): GainNode | null {
  const existing = sends.get(ctx);
  if (existing) return existing;
  if (typeof ctx.createConvolver !== "function" || typeof ctx.createGain !== "function") return null;
  try {
    const input = ctx.createGain();
    input.gain.value = 1;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = roomIrBuffer(ctx);
    input.connect(conv);
    Tone.connect(conv, Tone.getDestination());
    sends.set(ctx, input);
    return input;
  } catch {
    return null;
  }
}

/** Attach a post-fader room send from a Tone bus (used when per-bus volume sliders mute dry+wet together). */
export function attachRoomBus(source: Tone.ToneAudioNode, amount: number): () => void {
  if (amount <= 0) return () => undefined;
  try {
    const ctx = Tone.getContext().rawContext as AudioContext;
    const send = roomSend(ctx);
    if (!send) return () => undefined;
    const tap = ctx.createGain();
    tap.gain.value = amount;
    Tone.connect(source, tap);
    tap.connect(send);
    return () => {
      try {
        tap.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => undefined;
  }
}

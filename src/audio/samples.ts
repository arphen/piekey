import * as Tone from "tone";

// The backing band as pre-rendered one-shot buffers. Tone's synths keep oscillators and
// ConstantSource "signals" running for every voice whether or not it is sounding (a 10-voice FM
// PolySynth alone costs ~8% of a core at idle); a buffer source exists only while its note rings.
// The patches approximate the Tone synths they replace.

type Render = (sr: number, out: Float32Array) => void;

const TAU = Math.PI * 2;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const cache = new Map<string, AudioBuffer>();

const rawContext = () => Tone.getContext().rawContext as AudioContext;

function cached(key: string, seconds: number, peak: number, render: Render): AudioBuffer {
  const ctx = rawContext();
  const id = `${ctx.sampleRate}:${key}`;
  let b = cache.get(id);
  if (!b) {
    b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
    const out = b.getChannelData(0);
    render(ctx.sampleRate, out);
    normalize(out, peak);
    cache.set(id, b);
  }
  return b;
}

function normalize(out: Float32Array, peak: number) {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  const g = m > 0 ? peak / m : 1;
  const fade = Math.min(out.length, 256);
  for (let i = 0; i < out.length; i++) out[i] *= g * (i >= out.length - fade ? (out.length - i) / fade : 1);
}

/** RBJ biquad, in place. */
function biquad(x: Float32Array, type: "bandpass" | "highpass", f0: number, q: number, sr: number) {
  const w = (TAU * f0) / sr;
  const c = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const [b0, b1, b2] = type === "bandpass" ? [al, 0, -al] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + al;
  const a1 = -2 * c;
  const a2 = 1 - al;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

function noise(out: Float32Array) {
  for (let i = 0; i < out.length; i++) out[i] = Math.random() * 2 - 1;
}

/** Comp: 2-operator FM (modulator at 3x), bright attack settling to a soft sustain. */
export const keysBuffer = (midi: number) =>
  cached(`keys:${midi}`, 3.5, 0.9, (sr, out) => {
    const f = hz(midi);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const amp = Math.min(1, t / 0.005) * (0.12 + 0.88 * Math.exp(-t / 0.16));
      const index = 1.5 * (0.1 + 0.9 * Math.exp(-t / 0.08));
      out[i] = amp * Math.sin(TAU * f * t + index * Math.sin(TAU * 3 * f * t));
    }
  });

/** Bass: triangle through a 2-pole lowpass whose cutoff falls from ~850 Hz to ~300 Hz. */
export const bassBuffer = (midi: number) =>
  cached(`bass:${midi}`, 2.5, 0.9, (sr, out) => {
    const f = hz(midi);
    let phase = 0;
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase = (phase + f / sr) % 1;
      const tri = 4 * Math.abs(phase - 0.5) - 1;
      const cutoff = 150 * 2 ** (2.5 * (0.4 + 0.6 * Math.exp(-t / 0.06)));
      const a = 1 - Math.exp((-TAU * cutoff) / sr);
      l1 += a * (tri - l1);
      l2 += a * (l1 - l2);
      const amp = Math.min(1, t / 0.01) * (0.5 + 0.5 * Math.exp(-t / 0.08));
      out[i] = l2 * amp;
    }
  });

export const rideBuffer = () =>
  cached("ride", 0.6, 0.22, (sr, out) => {
    noise(out);
    biquad(out, "bandpass", 6500, 0.8, sr);
    for (let i = 0; i < out.length; i++) out[i] *= Math.exp(-i / sr / 0.08);
  });

export const hatBuffer = () =>
  cached("hat", 0.15, 0.35, (sr, out) => {
    noise(out);
    biquad(out, "highpass", 7000, 0.7, sr);
    for (let i = 0; i < out.length; i++) out[i] *= Math.exp(-i / sr / 0.015);
  });

/** Kick: sine sweeping from 4x down to C1 in 30 ms. */
export const kickBuffer = () =>
  cached("kick", 0.4, 0.95, (sr, out) => {
    const f = hz(24);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase += (f * 4 ** Math.max(0, 1 - t / 0.03)) / sr;
      out[i] = Math.sin(TAU * phase) * Math.min(1, t / 0.001) * Math.exp(-t / 0.06);
    }
  });

export const clickBuffer = (accent: boolean) =>
  cached(`click:${accent}`, 0.08, 0.9, (sr, out) => {
    const f = accent ? 1500 : 1000;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] = Math.sin(TAU * f * t) * Math.min(1, t / 0.001) * Math.exp(-t / 0.012);
    }
  });

interface Voice {
  src: AudioBufferSourceNode;
  g: GainNode;
}

/** Plays buffers as one-shot voices; `dur` cuts a note off with a short release. */
export class OneShots {
  private active = new Set<Voice>();

  play(buffer: AudioBuffer, out: Tone.ToneAudioNode, time: number, velocity = 1, dur?: number, release = 0.05): void {
    const ctx = rawContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = velocity;
    src.connect(g);
    Tone.connect(g, out);
    const v = { src, g };
    this.active.add(v);
    src.onended = () => {
      g.disconnect();
      this.active.delete(v);
    };
    src.start(time);
    if (dur !== undefined && dur < buffer.duration) {
      g.gain.setTargetAtTime(0, time + dur, release / 4);
      src.stop(time + dur + release * 2);
    }
  }

  /** Silences everything sounding; `fade` (a time constant, in seconds) lets it die away instead of cutting. */
  stopAll(fade = 0.015): void {
    const now = rawContext().currentTime;
    for (const v of this.active) {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, fade);
      try {
        v.src.stop(now + Math.max(0.1, fade * 6));
      } catch {
        /* not started yet */
      }
    }
    this.active.clear();
  }
}

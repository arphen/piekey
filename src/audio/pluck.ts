import * as Tone from "tone";

// Plucked string: Karplus-Strong, rendered once per pitch into a buffer and replayed with a
// buffer source. Tone.PluckSynth runs an AudioWorklet comb filter on every audio block
// (~375 calls/s) even in silence; a buffer source costs nothing between notes.

const SECONDS = 2.2;
const cache = new Map<string, AudioBuffer>();

function render(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const period = sr / (440 * 2 ** ((midi - 69) / 12));
  // the averaging filter adds half a sample of delay, the allpass supplies the fraction
  const n = Math.max(2, Math.floor(period - 0.5 - 1e-3));
  const frac = period - 0.5 - n;
  const ap = (1 - frac) / (1 + frac);

  const line = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.55 * (Math.random() * 2 - 1 - lp); // soften the pick noise a little
    line[i] = lp;
  }

  const len = Math.floor(sr * SECONDS);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const loss = 0.9965;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  let peak = 0;
  for (let i = 0, k = 0; i < len; i++) {
    const v = line[k];
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
    const avg = 0.5 * (v + prev);
    prev = v;
    apOut = ap * avg + apIn - ap * apOut;
    apIn = avg;
    line[k] = apOut * loss;
    k = k + 1 === n ? 0 : k + 1;
  }
  const fade = Math.floor(sr * 0.05);
  const gain = peak > 0 ? 0.7 / peak : 1;
  for (let i = 0; i < len; i++) out[i] *= gain * (i > len - fade ? (len - i) / fade : 1);
  return buf;
}

function bufferFor(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${midi}`;
  let b = cache.get(key);
  if (!b) {
    b = render(ctx, midi);
    cache.set(key, b);
  }
  return b;
}

export class BufferPluck {
  private last: { src: AudioBufferSourceNode; g: GainNode } | null = null;

  /** mono: a new note damps the previous one, like fretting the next note on one string. */
  constructor(
    private out: Tone.ToneAudioNode,
    private mono = true,
  ) {}

  /** Render the buffer ahead of time. */
  prepare(midi: number): void {
    bufferFor(Tone.getContext().rawContext as AudioContext, midi);
  }

  trigger(midi: number, time: number, velocity = 1): void {
    const ctx = Tone.getContext().rawContext as AudioContext;
    if (this.mono && this.last) {
      this.last.g.gain.setTargetAtTime(0, time, 0.012);
      this.last.src.stop(time + 0.1);
    }
    const src = ctx.createBufferSource();
    src.buffer = bufferFor(ctx, midi);
    const g = ctx.createGain();
    g.gain.value = velocity;
    src.connect(g);
    Tone.connect(g, this.out);
    src.onended = () => g.disconnect();
    src.start(time);
    this.last = { src, g };
  }
}

/** The plucked-string buffer for a pitch, rendered once per pitch. */
export const pluckBuffer = (midi: number) => bufferFor(Tone.getContext().rawContext as AudioContext, midi);

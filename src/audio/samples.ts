import * as Tone from "tone";
import { biquad, dcBlock, midiToHz, mulberry32, normalizeChannels, seedFromKey, TAU } from "./dsp";
import { roomSend } from "./room";

// The backing band and cues as pre-rendered one-shot buffers. Tone's synths keep oscillators and
// ConstantSource "signals" running for every voice whether or not it is sounding (a 10-voice FM
// PolySynth alone costs ~8% of a core at idle); a buffer source exists only while its note rings.
// All buffers are deterministic and shaped for warm, non-fatiguing acoustic/studio playback.

type RenderMono = (sr: number, out: Float32Array) => void;
type RenderStereo = (sr: number, left: Float32Array, right: Float32Array) => void;

const cache = new Map<string, AudioBuffer>();

const rawContext = () => Tone.getContext().rawContext as AudioContext;

function cachedMono(
  ctx: BaseAudioContext,
  key: string,
  seconds: number,
  peak: number,
  render: RenderMono,
  fadeInMs = 1,
  fadeOutMs = 12,
): AudioBuffer {
  const id = `${ctx.sampleRate}:${key}`;
  let b = cache.get(id);
  if (!b) {
    const sr = ctx.sampleRate;
    b = ctx.createBuffer(1, Math.ceil(seconds * sr), sr);
    const out = b.getChannelData(0);
    render(sr, out);
    normalizeChannels([out], peak, Math.floor((fadeInMs / 1000) * sr), Math.floor((fadeOutMs / 1000) * sr));
    cache.set(id, b);
  }
  return b;
}

function cachedStereo(
  ctx: BaseAudioContext,
  key: string,
  seconds: number,
  peak: number,
  render: RenderStereo,
  fadeInMs = 2,
  fadeOutMs = 35,
): AudioBuffer {
  const id = `${ctx.sampleRate}:${key}`;
  let b = cache.get(id);
  if (!b) {
    const sr = ctx.sampleRate;
    b = ctx.createBuffer(2, Math.ceil(seconds * sr), sr);
    const left = b.getChannelData(0);
    const right = b.getChannelData(1);
    render(sr, left, right);
    normalizeChannels([left, right], peak, Math.floor((fadeInMs / 1000) * sr), Math.floor((fadeOutMs / 1000) * sr));
    cache.set(id, b);
  }
  return b;
}

function fillNoise(out: Float32Array, seed: number): void {
  const rng = mulberry32(seed);
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
}

/**
 * Render a warm felt Rhodes / suitcase electric piano buffer (stereo).
 * Natural multi-stage decay, singing 2nd harmonic warmth, gentle bell-tine transient, soft felt
 * hammer thump, and subtle stereo detuned chorus so chords wrap warmly behind the guitar.
 */
export function renderKeysBuffer(ctx: BaseAudioContext, midi: number, pad = false): AudioBuffer {
  const f = midiToHz(midi);
  const reg = Math.max(0, Math.min(1, (midi - 48) / 36));
  const decayScale = 1.25 - reg * 0.48;
  const seconds = pad ? 4.2 : 3.6;
  const key = `${pad ? "pad" : "keys"}:${midi}`;

  return cachedStereo(
    ctx,
    key,
    seconds,
    pad ? 0.78 : 0.85,
    (sr, left, right) => {
      const rng = mulberry32(seedFromKey(key));
      // Subtle stereo chorus detune (±0.28..0.42 Hz)
      const detuneHz = pad ? 0.42 : 0.3;
      const fL = f - detuneHz;
      const fR = f + detuneHz;
      const attackS = pad ? 0.042 : 0.0065;
      const invAttack = 1 / (attackS * sr);
      const invTineAtk = 1 / (0.0025 * sr);
      // Scale upper tine brightness down cleanly for high notes so voicings never sound piercing
      const tineScale = (pad ? 0.28 : 1.0) * Math.max(0.18, 1 - reg * 0.72);
      const feltScale = pad ? 0.02 : 0.08;
      const hasTine = fR * 7 < sr * 0.42;
      let feltLp = 0;

      // Exact multiplicative exponential decay steps (zero Math.exp in the inner loop)
      const dBodyA = Math.exp(-1 / ((pad ? 1.1 : 0.48) * decayScale * sr));
      const dBodyB = Math.exp(-1 / ((pad ? 2.8 : 2.15) * decayScale * sr));
      const dH2 = Math.exp(-1 / (0.58 * decayScale * sr));
      const dH3 = Math.exp(-1 / (0.28 * decayScale * sr));
      const dTine = Math.exp(-1 / ((pad ? 0.11 : 0.068) * sr));
      const dFm = Math.exp(-1 / (0.14 * sr));
      const dFelt = Math.exp(-1 / (0.009 * sr));

      const wStepL = (TAU * fL) / sr;
      const wStepR = (TAU * fR) / sr;
      const wTineL = (TAU * fL * 7.01) / sr;
      const wTineR = (TAU * fR * 7.01) / sr;
      const wBloom = (TAU * 1.35) / sr;

      let eBodyA = 1;
      let eBodyB = 1;
      let eH2 = 1;
      let eH3 = 1;
      let eTine = 1;
      let eFm = 1;
      let eFelt = 1;

      for (let i = 0; i < left.length; i++) {
        const atk = i * invAttack < 1 ? i * invAttack : 1;
        const smoothAtk = atk * atk * (3 - 2 * atk);

        // Natural suitcase Rhodes / piano decay — never a flat static buzz
        const bodyEnv = smoothAtk * (pad ? 0.45 * eBodyA + 0.55 * eBodyB : 0.56 * eBodyA + 0.44 * eBodyB);
        const h2Env = smoothAtk * eH2;
        const h3Env = smoothAtk * eH3;
        const tineEnv = (i * invTineAtk < 1 ? i * invTineAtk : 1) * eTine;

        // Gentle warm felt hammer thump during the first ~12ms
        const n = rng() * 2 - 1;
        feltLp += 0.08 * (n - feltLp);
        const felt = feltLp * eFelt * feltScale;

        // Subtle suitcase stereo tremolo/bloom (very gentle, ~1.35 Hz)
        const trem = 0.04 * Math.sin(wBloom * i);
        const bloomL = 1 + trem;
        const bloomR = 1 - trem;

        const wL = wStepL * i;
        const sL = Math.sin(wL);
        const cL = Math.cos(wL);
        const s2L = 2 * sL * cL;
        const c2L = 2 * cL * cL - 1;
        const s3L = sL * (3 - 4 * sL * sL);
        const fundL = Math.sin(wL + 0.22 * eFm * s2L);
        const h2L = 0.34 * h2Env * (s2L * 0.939 + c2L * 0.343);
        const h3L = 0.11 * h3Env * s3L;
        const tineL = hasTine ? 0.14 * tineScale * tineEnv * Math.sin(wTineL * i) : 0;
        left[i] = Math.tanh(((fundL * bodyEnv + h2L + h3L + tineL) * bloomL + felt) * 1.18);

        const wR = wStepR * i + 0.35;
        const sR = Math.sin(wR);
        const cR = Math.cos(wR);
        const s2R = 2 * sR * cR;
        const c2R = 2 * cR * cR - 1;
        const s3R = sR * (3 - 4 * sR * sR);
        const fundR = Math.sin(wR + 0.22 * eFm * s2R);
        const h2R = 0.34 * h2Env * (s2R * 0.939 + c2R * 0.343);
        const h3R = 0.11 * h3Env * s3R;
        const tineR = hasTine ? 0.14 * tineScale * tineEnv * Math.sin(wTineR * i + 0.35) : 0;
        right[i] = Math.tanh(((fundR * bodyEnv + h2R + h3R + tineR) * bloomR + felt) * 1.18);

        eBodyA *= dBodyA;
        eBodyB *= dBodyB;
        eH2 *= dH2;
        eH3 *= dH3;
        eTine *= dTine;
        eFm *= dFm;
        eFelt *= dFelt;
      }

      const lpCut = pad ? 2800 : 4600;
      biquad(left, "lowpass", lpCut, 0.68, sr);
      biquad(right, "lowpass", lpCut, 0.68, sr);
      biquad(left, "highpass", 65, 0.707, sr);
      biquad(right, "highpass", 65, 0.707, sr);
      dcBlock(left);
      dcBlock(right);
    },
    pad ? 12 : 2,
    pad ? 90 : 50,
  );
}

/** Comp keys: warm suitcase Rhodes / felt electric piano (stereo). */
export const keysBuffer = (midi: number) => renderKeysBuffer(rawContext(), midi, false);

/** Soft harmony pad: slower velvety Rhodes swell for sustained chords behind own-pace playing. */
export const padBuffer = (midi: number) => renderKeysBuffer(rawContext(), midi, true);

/**
 * Acoustic upright / flatwound warm bass (mono).
 * Plucked string pitch bloom (+13 cents settling over ~24 ms), woody fingerboard attack,
 * dynamic 2-pole lowpass closing smoothly, and genuine acoustic decay.
 */
export function renderBassBuffer(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const f = midiToHz(midi);
  const reg = Math.max(0, Math.min(1, (midi - 28) / 24));
  const decayScale = 1.15 - reg * 0.28;
  const key = `bass:${midi}`;

  return cachedMono(
    ctx,
    key,
    2.8,
    0.9,
    (sr, out) => {
      const rng = mulberry32(seedFromKey(key));
      let phase = 0;
      let l1 = 0;
      let l2 = 0;
      let pluckLp = 0;

      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        // Subtle heavy-string pluck pitch bloom (+13 cents settling over 24 ms)
        const pitchMult = 1 + 0.0075 * Math.exp(-t / 0.024);
        phase = (phase + (f * pitchMult) / sr) % 1;
        const w = TAU * phase;

        // Warm plucked upright harmonic recipe: rich fundamental + woody 2nd/3rd + fast-damping upper bite
        const h2 = 0.46 * Math.exp(-t / (0.65 * decayScale));
        const h3 = 0.24 * Math.exp(-t / (0.28 * decayScale));
        const h4 = 0.11 * Math.exp(-t / 0.11);
        const h5 = 0.05 * Math.exp(-t / 0.055);
        const wave = Math.sin(w) + h2 * Math.sin(2 * w + 0.4) + h3 * Math.sin(3 * w + 0.9) + h4 * Math.sin(4 * w) + h5 * Math.sin(5 * w);

        // Dynamic 2-pole lowpass: open on finger attack, warm mellow wood on sustain
        const cutoff = 230 + 920 * Math.exp(-t / 0.085);
        const a = 1 - Math.exp((-TAU * cutoff) / sr);
        l1 += a * (wave - l1);
        l2 += a * (l1 - l2);

        // Subtle finger-on-wood pluck thump (~14 ms)
        const n = rng() * 2 - 1;
        pluckLp += 0.14 * (n - pluckLp);
        const thump = pluckLp * Math.min(1, t / 0.0018) * Math.exp(-t / 0.013) * 0.28;

        const atk = Math.min(1, t / 0.008);
        const amp = atk * (0.42 * Math.exp(-t / (0.18 * decayScale)) + 0.58 * Math.exp(-t / (1.35 * decayScale)));
        out[i] = Math.tanh((l2 * amp + thump) * 1.12);
      }

      biquad(out, "highpass", 34, 0.707, sr);
      biquad(out, "peaking", 115, 1.3, sr, 2.2); // Warm acoustic double-bass chest
      biquad(out, "peaking", 360, 1.4, sr, -1.6); // Clear mud
      dcBlock(out);
    },
    1.5,
    45,
  );
}

export const bassBuffer = (midi: number) => renderBassBuffer(rawContext(), midi);

/**
 * Dark bronze jazz ride cymbal (stereo):
 * Woody stick-tip ping + 8 inharmonic bronze modal partials + silky stereo high-frequency shimmer.
 */
export function renderRideBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedStereo(
    ctx,
    "ride",
    1.05,
    0.3,
    (sr, left, right) => {
      const modes = [
        [587, 0.34, 0.16],
        [845, 0.31, 0.15],
        [1217, 0.27, 0.17],
        [1790, 0.24, 0.2],
        [2630, 0.2, 0.22],
        [3810, 0.16, 0.18],
        [5420, 0.12, 0.13],
        [7480, 0.08, 0.08],
      ] as const;

      const airL = new Float32Array(left.length);
      const airR = new Float32Array(right.length);
      fillNoise(airL, 0x2277a11b);
      fillNoise(airR, 0x89c41f03);
      biquad(airL, "bandpass", 6800, 0.85, sr);
      biquad(airR, "bandpass", 7100, 0.85, sr);
      biquad(airL, "lowpass", 11500, 0.7, sr);
      biquad(airR, "lowpass", 11500, 0.7, sr);

      for (let i = 0; i < left.length; i++) {
        const t = i / sr;
        const atk = Math.min(1, t / 0.0014);

        // Wooden bead stick ping (~15 ms)
        const pingEnv = atk * Math.exp(-t / 0.014);
        const ping = pingEnv * (0.55 * Math.sin(TAU * 2780 * t) + 0.35 * Math.sin(TAU * 4120 * t));

        // Bronze inharmonic shimmer with tiny stereo L/R modal spread
        let metalL = 0;
        let metalR = 0;
        for (let m = 0; m < modes.length; m++) {
          const [freq, tau, amp] = modes[m];
          const env = atk * Math.exp(-t / tau);
          metalL += amp * env * Math.sin(TAU * freq * t + m * 1.1);
          metalR += amp * env * Math.sin(TAU * (freq + 1.8 + m * 0.6) * t + m * 1.9);
        }

        const airEnv = Math.min(1, t / 0.004) * Math.exp(-t / 0.24);
        left[i] = ping + metalL * 0.42 + airL[i] * airEnv * 0.72;
        right[i] = ping * 0.94 + metalR * 0.42 + airR[i] * airEnv * 0.72;
      }

      biquad(left, "highpass", 420, 0.707, sr);
      biquad(right, "highpass", 420, 0.707, sr);
    },
    0.8,
    40,
  );
}

export const rideBuffer = () => renderRideBuffer(rawContext());

/** Tight closed acoustic hi-hat / brushed chick (stereo). */
export function renderHatBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedStereo(
    ctx,
    "hat",
    0.15,
    0.34,
    (sr, left, right) => {
      const modes = [3180, 4410, 5690, 6920, 8410, 9760];
      const nL = new Float32Array(left.length);
      const nR = new Float32Array(right.length);
      fillNoise(nL, 0x44a8e119);
      fillNoise(nR, 0x67b1d321);
      biquad(nL, "bandpass", 7400, 0.9, sr);
      biquad(nR, "bandpass", 7700, 0.9, sr);
      biquad(nL, "lowpass", 12500, 0.7, sr);
      biquad(nR, "lowpass", 12500, 0.7, sr);

      for (let i = 0; i < left.length; i++) {
        const t = i / sr;
        const atk = Math.min(1, t / 0.0015);
        const env = atk * Math.exp(-t / 0.022);
        const mEnv = atk * Math.exp(-t / 0.017);
        let metalL = 0;
        let metalR = 0;
        for (let k = 0; k < modes.length; k++) {
          metalL += Math.sin(TAU * modes[k] * t + k * 0.8);
          metalR += Math.sin(TAU * (modes[k] + 19 + k * 7) * t + k * 1.4);
        }
        left[i] = nL[i] * env * 0.85 + (metalL / modes.length) * mEnv * 0.35;
        right[i] = nR[i] * env * 0.85 + (metalR / modes.length) * mEnv * 0.35;
      }
      biquad(left, "highpass", 1800, 0.707, sr);
      biquad(right, "highpass", 1800, 0.707, sr);
    },
    0.6,
    18,
  );
}

export const hatBuffer = () => renderHatBuffer(rawContext());

/**
 * Warm acoustic jazz / studio kick drum (mono):
 * Pitch sweep from ~152 Hz down to ~54 Hz (audible punch on laptop speakers and headphones),
 * gentle 2nd-harmonic shell resonance, and soft felt beater contact.
 */
export function renderKickBuffer(ctx: BaseAudioContext): AudioBuffer {
  return cachedMono(
    ctx,
    "kick",
    0.42,
    0.92,
    (sr, out) => {
      const beater = new Float32Array(out.length);
      fillNoise(beater, 0x31a94e02);
      biquad(beater, "bandpass", 420, 1.1, sr);

      let phase = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = 54 + 98 * Math.exp(-t / 0.026);
        phase += f / sr;
        const atk = Math.min(1, t / 0.0018);
        const body = Math.sin(TAU * phase) * Math.exp(-t / 0.095);
        // Subtle 2nd harmonic warmth so small speakers clearly feel the beat
        const chest = 0.24 * Math.sin(TAU * 2 * phase + 0.3) * Math.exp(-t / 0.048);
        const felt = beater[i] * Math.exp(-t / 0.008) * 0.32;
        const click = 0.14 * Math.sin(TAU * 1350 * t) * Math.exp(-t / 0.0035);
        out[i] = Math.tanh((atk * (body + chest + felt + click)) * 1.25);
      }
      biquad(out, "highpass", 32, 0.707, sr);
    },
    0.5,
    25,
  );
}

export const kickBuffer = () => renderKickBuffer(rawContext());

/**
 * Warm wooden rim / rosewood block metronome click (mono):
 * Crisp ~0.4 ms onset for razor-sharp timing and latency calibration, with organic woody body modes
 * instead of a fatiguing pure sine beep.
 */
export function renderClickBuffer(ctx: BaseAudioContext, accent: boolean): AudioBuffer {
  const key = `click:${accent}`;
  return cachedMono(
    ctx,
    key,
    0.085,
    0.88,
    (sr, out) => {
      const f1 = accent ? 1220 : 860;
      const f2 = f1 * (accent ? 2.54 : 2.48); // Inharmonic hollow woodblock overtone
      const f0 = f1 * 0.51; // Warm wooden cavity body
      const tau = accent ? 0.017 : 0.014;
      const rng = mulberry32(seedFromKey(key));
      let tapLp = 0;

      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const atk = Math.min(1, t / 0.00045);
        const main = Math.sin(TAU * f1 * t) * Math.exp(-t / tau);
        const over = 0.34 * Math.sin(TAU * f2 * t + 0.6) * Math.exp(-t / (tau * 0.48));
        const body = 0.28 * Math.sin(TAU * f0 * t) * Math.exp(-t / (tau * 1.15));
        const n = rng() * 2 - 1;
        tapLp += 0.32 * (n - tapLp);
        const mallet = tapLp * Math.exp(-t / 0.0022) * 0.42;
        out[i] = Math.tanh(atk * (main + over + body + mallet) * 1.15);
      }
      biquad(out, "highpass", 240, 0.707, sr);
      biquad(out, "lowpass", 5200, 0.75, sr);
    },
    0.25,
    10,
  );
}

export const clickBuffer = (accent: boolean) => renderClickBuffer(rawContext(), accent);

/**
 * Crystalline acoustic guitar natural harmonic / celesta chime (stereo):
 * Pure, singing, peaceful tone for pass chimes, glints, and tempo lifts — rings sweetly even at C6–G6.
 */
export function renderHarmonicBuffer(ctx: BaseAudioContext, midi: number): AudioBuffer {
  const f = midiToHz(midi);
  const key = `harmonic:${midi}`;
  return cachedStereo(
    ctx,
    key,
    2.2,
    0.82,
    (sr, left, right) => {
      const detune = 0.45;
      for (let i = 0; i < left.length; i++) {
        const t = i / sr;
        const atk = Math.min(1, t / 0.0045);
        const sAtk = atk * atk * (3 - 2 * atk);
        const e1 = sAtk * Math.exp(-t / 0.78);
        const e2 = sAtk * Math.exp(-t / 0.34);
        const e3 = sAtk * Math.exp(-t / 0.14);

        const voice = (freq: number, phase: number) => {
          let v = Math.sin(TAU * freq * t + phase) * e1;
          if (freq * 2 < sr * 0.44) v += 0.24 * Math.sin(TAU * freq * 2 * t + phase + 0.5) * e2;
          if (freq * 3 < sr * 0.44) v += 0.08 * Math.sin(TAU * freq * 3 * t + phase + 1.1) * e3;
          return v;
        };

        left[i] = voice(f - detune, 0);
        right[i] = voice(f + detune, 0.4);
      }
      biquad(left, "lowpass", 7200, 0.7, sr);
      biquad(right, "lowpass", 7200, 0.7, sr);
    },
    3,
    70,
  );
}

export const harmonicBuffer = (midi: number) => renderHarmonicBuffer(rawContext(), midi);

export interface PlayOptions {
  /** Stereo pan (-1 left .. +1 right). */
  pan?: number;
  /** Shared studio room reverb send amount (0..1). */
  room?: number;
}

interface Voice {
  src: AudioBufferSourceNode;
  g: GainNode;
  nodes: AudioNode[];
}

/** Plays buffers as one-shot voices; `dur` cuts a note off with a short release. */
export class OneShots {
  private active = new Set<Voice>();

  play(
    buffer: AudioBuffer,
    out: Tone.ToneAudioNode,
    time: number,
    velocity = 1,
    dur?: number,
    release = 0.05,
    opts?: PlayOptions,
  ): void {
    const ctx = rawContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = velocity;
    src.connect(g);

    const nodes: AudioNode[] = [g];
    let tail: AudioNode = g;

    if (opts?.pan && Math.abs(opts.pan) > 1e-4 && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      tail.connect(panner);
      tail = panner;
      nodes.push(panner);
    }

    Tone.connect(tail, out);

    if (opts?.room && opts.room > 1e-4) {
      const dest = roomSend(ctx);
      if (dest) {
        const send = ctx.createGain();
        send.gain.value = opts.room;
        tail.connect(send);
        send.connect(dest);
        nodes.push(send);
      }
    }

    const v: Voice = { src, g, nodes };
    this.active.add(v);
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
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

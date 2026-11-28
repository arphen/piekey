// Shared deterministic DSP primitives for pre-rendered buffers and studio room IR.

export const TAU = Math.PI * 2;

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Deterministic PRNG (Mulberry32) so synthesized buffers are reproducible across sessions. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type BiquadType = "lowpass" | "highpass" | "bandpass" | "peaking" | "lowshelf" | "highshelf";

/** RBJ Audio EQ Cookbook biquad, applied in place. */
export function biquad(x: Float32Array, type: BiquadType, f0: number, q: number, sr: number, gainDb = 0): void {
  const clamped = Math.max(10, Math.min(sr * 0.45, f0));
  const w = (TAU * clamped) / sr;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const al = s / (2 * Math.max(0.1, q));
  const A = 10 ** (gainDb / 40);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (type) {
    case "lowpass":
      b0 = (1 - c) / 2;
      b1 = 1 - c;
      b2 = (1 - c) / 2;
      a0 = 1 + al;
      a1 = -2 * c;
      a2 = 1 - al;
      break;
    case "highpass":
      b0 = (1 + c) / 2;
      b1 = -(1 + c);
      b2 = (1 + c) / 2;
      a0 = 1 + al;
      a1 = -2 * c;
      a2 = 1 - al;
      break;
    case "bandpass":
      b0 = al;
      b1 = 0;
      b2 = -al;
      a0 = 1 + al;
      a1 = -2 * c;
      a2 = 1 - al;
      break;
    case "peaking":
      b0 = 1 + al * A;
      b1 = -2 * c;
      b2 = 1 - al * A;
      a0 = 1 + al / A;
      a1 = -2 * c;
      a2 = 1 - al / A;
      break;
    case "lowshelf": {
      const sq = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 - (A - 1) * c + sq);
      b1 = 2 * A * (A - 1 - (A + 1) * c);
      b2 = A * (A + 1 - (A - 1) * c - sq);
      a0 = A + 1 + (A - 1) * c + sq;
      a1 = -2 * (A - 1 + (A + 1) * c);
      a2 = A + 1 + (A - 1) * c - sq;
      break;
    }
    case "highshelf": {
      const sq = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 + (A - 1) * c + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * c);
      b2 = A * (A + 1 + (A - 1) * c - sq);
      a0 = A + 1 - (A - 1) * c + sq;
      a1 = 2 * (A - 1 - (A + 1) * c);
      a2 = A + 1 - (A - 1) * c - sq;
      break;
    }
  }

  const inv = 1 / a0;
  const nb0 = b0 * inv;
  const nb1 = b1 * inv;
  const nb2 = b2 * inv;
  const na1 = a1 * inv;
  const na2 = a2 * inv;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = nb0 * xi + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** Remove DC offset with a gentle 1st-order blocker, in place. */
export function dcBlock(x: Float32Array): void {
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < x.length; i++) {
    const cur = x[i];
    const y = cur - prevIn + 0.996 * prevOut;
    prevIn = cur;
    prevOut = y;
    x[i] = y;
  }
}

/** Normalize one or more channels jointly to `peak`, with smooth edge fades to prevent boundary clicks. */
export function normalizeChannels(channels: Float32Array[], peak: number, fadeInSamples = 16, fadeOutSamples = 512): void {
  let max = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > max) max = a;
    }
  }
  const g = max > 0 ? peak / max : 1;
  for (const ch of channels) {
    const len = ch.length;
    const fIn = Math.min(len, fadeInSamples);
    const fOut = Math.min(len, fadeOutSamples);
    for (let i = 0; i < len; i++) {
      let env = g;
      if (i < fIn) env *= i / fIn;
      if (i >= len - fOut) env *= (len - i) / fOut;
      ch[i] *= env;
    }
  }
}

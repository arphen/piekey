// Attacks: the moment a string is struck, read from the newest samples of each analysis frame.
//
// A pick or a pluck throws broadband noise into the signal for a few milliseconds. Its
// high-frequency energy (the signal's first difference) jumps far above what the note before
// leaves ringing, whose highs die away within a few tens of milliseconds. Measured in steps of
// 128 samples (~2.7 ms at 48 kHz), an attack is placed within a few milliseconds, rather than at
// the 25 ms frame that later finds its pitch, and a string picked again on the same pitch is
// caught while it still rings: fast triplets and repeated notes have a beginning each.
//
// Frames overlap (the analyser hands over its newest `fftSize` samples every ~25 ms); only the
// samples that arrived since the previous frame are read, placed in time back from the frame's
// moment. Nothing here knows pitch: the onset tracker pairs attacks with the notes it hears.

export interface Attack {
  at: number; // performance.now() ms of the block where the attack begins
  strength: number; // how far its highs rose above what came before
  rise: number; // full-band level of that block against the blocks before it
}

const BLOCK = 128;
const BASE_BLOCKS = 12; // ~32 ms of what came before
const RATIO = 10; // highs this many times what came before: something was struck (strings beating against each other swing a few times)
const NOISE_RATIO = 6; // and well clear of the input's own hiss
const FLOOR_RISE = 1.002; // the hiss estimate creeps up a little per block, so it follows a noisier input
const MIN_FULL = 1e-5; // quieter than this (rms ~0.003) is not playing
const REFRACTORY_MS = 40; // one attack's noise is not a second attack
const FIRST_MS = 200; // the first frame only warms the history

type Frame = { buf: Float32Array; sampleRate: number; now: number };

export function createAttacks(): (frame: Frame) => Attack[] {
  let lastNow: number | null = null;
  let unread = 0; // newest samples left over from the last frame, short of a whole block
  let lastBlock = -Infinity;
  let lastAttack = -Infinity;
  let floor = Infinity;
  const highs: number[] = [];
  const fulls: number[] = [];
  return ({ buf, sampleRate, now }) => {
    const len = buf.length;
    const blockMs = (BLOCK / sampleRate) * 1000;
    const warming = lastNow === null;
    const fresh = Math.max(0, Math.round(((warming ? FIRST_MS : now - lastNow!) * sampleRate) / 1000));
    lastNow = now;
    const pending = Math.min(len, unread + fresh);
    const blocks = Math.floor(pending / BLOCK);
    unread = pending - blocks * BLOCK;
    const out: Attack[] = [];
    for (let b = len - pending, end = b + blocks * BLOCK; b < end; b += BLOCK) {
      const at = now - ((len - b) / sampleRate) * 1000;
      if (at <= lastBlock + blockMs / 2) continue; // already read: the timer ran early
      lastBlock = at;
      let high = 0;
      let full = 0;
      for (let n = b; n < b + BLOCK; n++) {
        const x = buf[n];
        const d = n > 0 ? x - buf[n - 1] : 0;
        high += d * d;
        full += x * x;
      }
      high /= BLOCK;
      full /= BLOCK;
      floor = Math.max(1e-12, Math.min(floor * FLOOR_RISE, high));
      if (!warming && highs.length >= BASE_BLOCKS && full >= MIN_FULL && at - lastAttack >= REFRACTORY_MS) {
        const before = highs.reduce((a, v) => a + v, 0) / highs.length;
        const base = Math.max(before, floor * NOISE_RATIO);
        if (high > base * RATIO) {
          lastAttack = at;
          const level = fulls.reduce((a, v) => a + v, 0) / fulls.length;
          out.push({ at, strength: high / base, rise: full / Math.max(level, 1e-12) });
        }
      }
      highs.push(high);
      fulls.push(full);
      if (highs.length > BASE_BLOCKS) highs.shift();
      if (fulls.length > BASE_BLOCKS) fulls.shift();
    }
    return out;
  };
}

// Golden-ratio structure for the pool: placements and periods that never visibly repeat.

export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 137.5077°
export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;
export const PHRASE_WRAP = 89;

const frac = (n: number) => n - Math.floor(n);

/** The n-th seed of a sunflower: equal area per seed, each turned a golden angle from the last. */
export function phyllotaxis(n: number, radius: number, rotation = 0): { x: number; y: number } {
  const k = n % PHRASE_WRAP;
  const r = radius * Math.sqrt(k / PHRASE_WRAP);
  const theta = k * GOLDEN_ANGLE + rotation;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

/** Point i of a golden spiral r = a·φ^(2θ/π), sampled every eighth of a turn and rotated by `turn`. */
export function spiral(i: number, a: number, turn: number): { x: number; y: number } {
  const theta = (i * Math.PI) / 4;
  const r = a * Math.pow(PHI, (2 * theta) / Math.PI);
  return { x: r * Math.cos(theta + turn), y: r * Math.sin(theta + turn) };
}

/** frac(k·φ): a low-discrepancy sequence on [0, 1) that never clumps. */
export const goldenSpread = (k: number): number => frac(k * PHI);

/** Sum of sines with periods T·φ^k: a wander whose pattern never visibly loops. */
export function wander(t: number, period: number, phase = 0): number {
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += Math.sin((2 * Math.PI * t) / (period * Math.pow(PHI, k)) + phase * (k + 1)) / (k + 1);
  return sum / 2.083; // the weights' sum, so the result stays within ±1
}

/** A small seeded PRNG (mulberry32) so screenshots and tests reproduce. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

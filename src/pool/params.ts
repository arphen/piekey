// How the pool looks at a given groove. Pure. At rest the algae photograph is already there and
// flowing gently; glow, bloom and rising blobs are left for the player's own playing to earn.

export const GROOVE_ANCHORS = [0, 0.25, 0.5, 0.75, 1] as const;

export const ANCHORS = {
  drift: [0.05, 0.06, 0.08, 0.11, 0.14], // screen widths per minute
  vorticity: [5, 8, 14, 22, 32], // confinement ε
  vortices: [2, 3, 5, 5, 8], // ambient vortices, a Fibonacci count
  orbit: [0.025, 0.04, 0.08, 0.13, 0.2], // vortex orbit, rad/s
  velocityHalfLife: [3, 3.5, 4, 6, 8], // s
  flowPeriod: [14, 12, 10, 8, 6], // s for each flow phase before it restarts unseen
  saturation: [1.12, 1.24, 1.38, 1.52, 1.66], // poison green against the dark water, from the start
  sepia: [0, 0, 0, 0, 0],
  brightness: [0.58, 0.64, 0.70, 0.76, 0.82], // photograph opacity over the dark water
  contrast: [1.38, 1.48, 1.58, 1.66, 1.74], // a tone curve that keeps the water gaps dark
  spread: [0.78, 0.88, 0.96, 1, 1], // wraps the harbor room from the start
  emission: [0, 0.15, 0.4, 0.7, 1],
  bloom: [0, 0.08, 0.3, 0.55, 0.8],
  rippleHalfLife: [0.6, 0.8, 1.1, 1.5, 2],
  lava: [0, 0, 0.3, 0.7, 1],
  floaters: [8, 13, 21, 34, 34],
} as const satisfies Record<string, readonly number[]>;

export type PoolParams = { -readonly [K in keyof typeof ANCHORS]: number };

const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smoothstep between the anchor columns: anchors are hit exactly and every row stays monotonic. */
export function at(row: readonly number[], groove: number): number {
  const g = unit(groove) * (row.length - 1);
  const i = Math.min(row.length - 2, Math.floor(g));
  return row[i] + (row[i + 1] - row[i]) * smooth(g - i);
}

export function poolParams(groove: number): PoolParams {
  const out = {} as PoolParams;
  for (const key of Object.keys(ANCHORS) as (keyof PoolParams)[]) out[key] = at(ANCHORS[key], groove);
  return out;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Glow and dye lean warm gold-lime for major, cool jade-cyan for minor; ±15° around the circle of fifths. Never a rainbow. */
export function tintFor(tonic: number | null, mode: "major" | "minor" | null): [number, number, number] {
  const base = mode === "minor" ? 168 : mode === "major" ? 78 : 110;
  const fifths = tonic === null ? 6 : (tonic * 7) % 12;
  return hsl(base + (fifths / 11 - 0.5) * 30, 0.72, 0.56);
}

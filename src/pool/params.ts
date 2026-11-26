// How the pool looks at a given groove. Pure. At rest the harbor is deep, dark and nearly still,
// with algae hovering at the far edge; early playing wakes a distant calling, and only genuine
// locked-in mastery opens the full luminous bioluminescent embrace.

export const GROOVE_ANCHORS = [0, 0.25, 0.5, 0.75, 1] as const;

export const ANCHORS = {
  drift: [0.014, 0.026, 0.048, 0.082, 0.12], // screen widths per minute: serene at rest, hypnotic in the zone
  vorticity: [1.0, 2.5, 6.0, 12.5, 21], // confinement ε: velvet filaments, never violent turbulence
  vortices: [1, 2, 3, 5, 8], // ambient vortices, Fibonacci count
  orbit: [0.008, 0.018, 0.042, 0.082, 0.135], // slow marine inertia, rad/s
  velocityHalfLife: [2.6, 3.6, 5.2, 7.2, 9.5], // s: long lingering wakes as the engine warms
  flowPeriod: [24, 20, 15, 11, 8], // s for each flow phase before it restarts unseen
  saturation: [0.76, 0.92, 1.14, 1.44, 1.78], // deep dark harbor at rest, vivid bioluminescence at peak
  sepia: [0, 0, 0, 0, 0],
  brightness: [0.28, 0.36, 0.48, 0.66, 0.88], // emerges out of abyssal water as you earn it
  contrast: [1.54, 1.56, 1.60, 1.66, 1.72], // keeps water voids ink-black while algae ridges glow
  spread: [0.32, 0.48, 0.72, 0.92, 1.0], // starts far off at the rim and slowly embraces the whole room
  emission: [0, 0.025, 0.13, 0.44, 1.0], // non-linear: distant whisper early, transcendent glow at peak
  bloom: [0, 0.01, 0.07, 0.32, 0.90], // radiant halo reserved for truly entering the zone
  rippleHalfLife: [1.3, 1.6, 2.0, 2.5, 3.2], // long, slow propeller waves that glide across the pool
  lava: [0, 0, 0.08, 0.42, 1.0], // warm backlit upwelling only when deep in flow
  floaters: [3, 6, 13, 21, 34], // Fibonacci
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

const DRIFT_AMBER: readonly [number, number, number] = [0.80, 0.62, 0.20]; // yellowing amber tension
const MISS_UMBER: readonly [number, number, number] = [0.54, 0.31, 0.12]; // ochre-rust / warm umber decay

/** Blends a base algae tint toward yellowing amber ("drift") or muted ochre-umber ("miss") as decay rises. */
export function decayTint(
  base: readonly [number, number, number],
  decay: number,
  tone: "drift" | "miss" = "miss",
): [number, number, number] {
  const d = unit(decay);
  if (d === 0) return [base[0], base[1], base[2]];
  const target = tone === "drift" ? DRIFT_AMBER : MISS_UMBER;
  const mix = d * (tone === "miss" ? 0.82 : 0.68);
  return [
    unit(base[0] + (target[0] - base[0]) * mix),
    unit(base[1] + (target[1] - base[1]) * mix),
    unit(base[2] + (target[2] - base[2]) * mix),
  ];
}

/** Pure visual decay overlay on top of groove params: warms sepia and wilts glow without touching fluid motion. */
export function applyDecay(params: PoolParams, decay: number): PoolParams {
  const d = unit(decay);
  if (d === 0) return { ...params };
  return {
    ...params,
    sepia: unit(params.sepia + d * 0.68),
    saturation: params.saturation * (1 - d * 0.26),
    brightness: params.brightness * (1 - d * 0.14),
    emission: params.emission * (1 - d * 0.48),
    bloom: params.bloom * (1 - d * 0.55),
    lava: params.lava * (1 - d * 0.45),
  };
}

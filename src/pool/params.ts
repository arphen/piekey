// How the pool looks at a given groove. Pure. At rest the harbor is deep, dark and nearly still,
// with algae hovering at the far edge; early playing wakes a distant calling, and only genuine
// locked-in mastery opens the full luminous bioluminescent embrace.

export const GROOVE_ANCHORS = [0, 0.25, 0.5, 0.75, 1] as const;

export const ANCHORS = {
  drift: [0.018, 0.042, 0.078, 0.125, 0.175], // screen widths per minute: serene at rest, sweeping hypnotic currents at peak
  vorticity: [1.5, 5.5, 13.0, 24.0, 36.0], // confinement ε: velvet calm at rest, electric whirling filaments at peak
  vortices: [1, 3, 5, 6, 8], // ambient vortices, rising smoothly into a rich dance
  orbit: [0.012, 0.036, 0.085, 0.155, 0.23], // slow marine inertia at rest, living orbital dance at peak, rad/s
  velocityHalfLife: [2.8, 4.0, 5.8, 8.0, 10.5], // s: long lingering wakes as the engine warms
  flowPeriod: [22, 16, 11, 8, 5.5], // s for each flow phase before it restarts unseen
  saturation: [0.78, 1.04, 1.32, 1.62, 1.95], // deep dark harbor at rest, electric bioluminescence at peak
  sepia: [0, 0, 0, 0, 0],
  brightness: [0.30, 0.44, 0.60, 0.78, 0.96], // emerges out of abyssal water as you earn it
  contrast: [1.50, 1.54, 1.60, 1.68, 1.76], // keeps water voids ink-black while algae ridges shine
  spread: [0.36, 0.60, 0.84, 0.96, 1.0], // starts at the rim and embraces the whole room as you connect
  emission: [0, 0.08, 0.32, 0.68, 1.0], // calm dark rest -> alive mid-groove -> transcendent radiance at peak
  bloom: [0, 0.05, 0.22, 0.56, 1.0], // radiant halo that blossoms into ecstatic glow in the zone
  rippleHalfLife: [1.1, 1.5, 2.0, 2.6, 3.4], // lingering liquid waves that glide across the pool
  lava: [0, 0, 0.24, 0.64, 1.0], // warm backlit lava-lamp upwelling rising from mid-groove onward
  floaters: [3, 8, 16, 26, 34], // Fibonacci
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

/** Subtle global decay veil on top of groove params: mistakes primarily leave localized dying wounds rather than turning the whole pool brown or killing excitement. */
export function applyDecay(params: PoolParams, decay: number): PoolParams {
  const d = unit(decay);
  if (d === 0) return { ...params };
  return {
    ...params,
    sepia: unit(params.sepia + d * 0.16),
    saturation: params.saturation * (1 - d * 0.07),
    brightness: params.brightness * (1 - d * 0.04),
    emission: params.emission * (1 - d * 0.10),
    bloom: params.bloom * (1 - d * 0.12),
    lava: params.lava * (1 - d * 0.10),
  };
}

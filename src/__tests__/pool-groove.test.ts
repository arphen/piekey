import { describe, expect, it } from "vitest";
import { createGroove, type GrooveContext } from "../pool/groove";
import { mulberry32 } from "../pool/golden";
import { ANCHORS, applyDecay, at, decayTint, GROOVE_ANCHORS, poolParams, tintFor } from "../pool/params";

const G_MAJOR = [55, 57, 59, 60, 62, 64, 66, 67, 69, 71, 72, 71, 69, 67, 66, 64, 62, 60, 59, 57];
const FRAME = 25;

/** Notes at `times` (ms), each ringing until the next; frames every 25 ms like the shared input. */
function perform(groove: ReturnType<typeof createGroove>, from: number, until: number, notes: { at: number; midi: number | null }[], playing = true, context?: (now: number) => GrooveContext) {
  let n = 0;
  let onsets = 0;
  for (let now = from; now < until; now += FRAME) {
    while (n + 1 < notes.length && notes[n + 1].at <= now) n++;
    const note = notes[n] && notes[n].at <= now ? notes[n] : null;
    const age = note ? (now - note.at) / 1000 : Infinity;
    const rms = note ? 0.05 * (0.25 + 0.75 * Math.exp(-age / 0.5)) : 0.001;
    if (groove.step({ now, rms, midi: note?.midi ?? null, clarity: note?.midi != null ? 0.95 : 0.2, playing }, context?.(now))) onsets++;
  }
  return onsets;
}

const steady = (from: number, until: number, gap: number, midis = G_MAJOR) =>
  Array.from({ length: Math.floor((until - from) / gap) }, (_, i) => ({ at: from + i * gap, midi: midis[i % midis.length] }));

describe("pool groove", () => {
  it("stays at rest in silence", () => {
    const g = createGroove();
    perform(g, 0, 60000, []);
    expect(g.state.groove).toBe(0);
    expect(g.state.activeMs).toBe(0);
  });

  it("rises within about half a minute of steady eighths in one key, and only during the player's turn", () => {
    const soon = createGroove();
    perform(soon, 0, 35000, steady(0, 35000, 300));
    expect(soon.state.groove).toBeGreaterThan(0.6);
    const playing = createGroove();
    expect(perform(playing, 0, 120000, steady(0, 120000, 300))).toBeGreaterThan(300);
    expect(playing.state.groove).toBeGreaterThan(0.7);
    expect(playing.state).toMatchObject({ tonic: 7, mode: "major" });
    const demo = createGroove();
    expect(perform(demo, 0, 120000, steady(0, 120000, 300), false)).toBe(0);
    expect(demo.state.groove).toBe(0);
  });

  it("keeps random chromatic notes at random times low, and unpitched clicks at zero", () => {
    const random = mulberry32(7);
    let t = 0;
    const notes = Array.from({ length: 500 }, () => ({ at: (t += 120 + random() * 600), midi: 45 + Math.floor(random() * 30) }));
    const chaos = createGroove();
    perform(chaos, 0, 120000, notes);
    expect(chaos.state.groove).toBeLessThan(0.35);
    const clicks = createGroove();
    perform(clicks, 0, 120000, steady(0, 120000, 500).map((n) => ({ ...n, midi: null })));
    expect(clicks.state.groove).toBe(0);
    expect(clicks.state.onsetSerial).toBe(0);
  });

  it("sinks gradually after the playing stops, halving within 8–12 s", () => {
    const g = createGroove();
    perform(g, 0, 150000, steady(0, 150000, 300));
    const peak = g.state.groove;
    let previous = peak;
    let halved: number | null = null;
    for (let now = 150000; now < 170000; now += FRAME) {
      g.step({ now, rms: 0.001, midi: null, clarity: 0, playing: true });
      expect(previous - g.state.groove).toBeLessThan(0.01); // no step drop
      previous = g.state.groove;
      if (halved === null && g.state.groove <= peak / 2) halved = now - 150000;
    }
    expect(halved).toBeGreaterThanOrEqual(8000);
    expect(halved).toBeLessThanOrEqual(12000);
  });

  it("scores onsets on a heard click as steadier than the same onsets off it", () => {
    const beatMs = 600;
    const context = (now: number): GrooveContext => ({ beatAt: Math.floor(now / beatMs) * beatMs, beatMs });
    const rand = mulberry32(3);
    const jitter = Array.from({ length: 100 }, () => 60 + rand() * 220);
    const on = createGroove();
    perform(on, 0, 30000, steady(0, 30000, 300).map((n, i) => ({ ...n, at: n.at + (i % 2 ? 4 : -4) })), true, context);
    const off = createGroove();
    perform(off, 0, 30000, steady(0, 30000, 300).map((n, i) => ({ ...n, at: n.at + jitter[i % 100] * (i % 2 ? 1 : -0.5) })), true, context);
    expect(on.state.steadiness).toBeGreaterThan(off.state.steadiness);
  });

  it("wakes slowly like a cold engine in the first seconds before swelling into the zone", () => {
    const g = createGroove();
    perform(g, 0, 5000, steady(0, 5000, 300));
    expect(g.state.groove).toBeLessThan(0.12);
    expect(poolParams(g.state.groove).emission).toBeLessThan(0.02);
    // Mid-zone holds back peak radiance so the full algae embrace is earned at the top.
    expect(poolParams(0.5).emission).toBeLessThan(0.2);
    expect(poolParams(1).emission).toBe(1);
  });

  it("is deterministic", () => {
    const a = createGroove();
    const b = createGroove();
    perform(a, 0, 40000, steady(0, 40000, 280));
    perform(b, 0, 40000, steady(0, 40000, 280));
    expect(a.state).toEqual(b.state);
  });
});

describe("pool parameters", () => {
  it("hits each anchor exactly and never falls as the groove rises", () => {
    for (const [key, row] of Object.entries(ANCHORS)) {
      GROOVE_ANCHORS.forEach((g, i) => expect(at(row, g), `${key} at ${g}`).toBeCloseTo(row[i], 10));
      const direction = Math.sign(row[row.length - 1] - row[0]);
      for (let g = 0; g < 1; g += 0.01) expect((at(row, g + 0.01) - at(row, g)) * direction, key).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("leaves glow, bloom and rising blobs for the player to earn", () => {
    expect(poolParams(0)).toMatchObject({ emission: 0, bloom: 0, lava: 0 });
    expect(poolParams(0.25).lava).toBe(0);
  });

  it("applies decay purely: rises sepia and wilts glow without touching fluid motion", () => {
    const base = poolParams(0.85);
    expect(applyDecay(base, 0)).toEqual(base);
    expect(applyDecay(base, -0.5)).toEqual(base);

    const mid = applyDecay(base, 0.5);
    const full = applyDecay(base, 1);
    expect(applyDecay(base, 2)).toEqual(full);

    expect(mid.sepia).toBeGreaterThan(base.sepia);
    expect(full.sepia).toBeGreaterThan(mid.sepia);
    expect(mid.emission).toBeLessThan(base.emission);
    expect(full.emission).toBeLessThan(mid.emission);
    expect(full.emission).toBeGreaterThanOrEqual(0);
    expect(full.bloom).toBeLessThan(mid.bloom);
    expect(full.saturation).toBeLessThan(base.saturation);
    expect(full.brightness).toBeLessThan(base.brightness);
    expect(full.lava).toBeLessThan(base.lava);

    // Fluid physics and geometry stay unaffected so decay never jerks the water.
    expect(full.drift).toBe(base.drift);
    expect(full.vorticity).toBe(base.vorticity);
    expect(full.vortices).toBe(base.vortices);
    expect(full.orbit).toBe(base.orbit);
    expect(full.velocityHalfLife).toBe(base.velocityHalfLife);
    expect(full.rippleHalfLife).toBe(base.rippleHalfLife);
  });

  it("shifts algae tint toward yellowing amber on drift and deeper ochre-umber on miss", () => {
    const emerald = tintFor(4, "minor");
    expect(decayTint(emerald, 0, "drift")).toEqual(emerald);
    expect(decayTint(emerald, 0, "miss")).toEqual(emerald);

    const drifted = decayTint(emerald, 0.8, "drift");
    const missed = decayTint(emerald, 0.8, "miss");

    // Both warm away from cool cyan-emerald (higher red, lower blue).
    expect(drifted[0]).toBeGreaterThan(emerald[0]);
    expect(drifted[2]).toBeLessThan(emerald[2]);
    expect(missed[0]).toBeGreaterThan(emerald[0]);
    expect(missed[2]).toBeLessThan(emerald[2]);

    // Drift stays brighter yellowing amber; miss settles into darker brown-umber.
    const luma = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(luma(drifted)).toBeGreaterThan(luma(missed));
    expect(missed[1]).toBeLessThan(drifted[1]);

    // Clamped to [0, 1] even for out-of-range inputs.
    for (const c of [...decayTint(emerald, 5, "miss"), ...decayTint(emerald, -2, "drift")]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

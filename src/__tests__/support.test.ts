import { describe, expect, it } from "vitest";
import { createSupport } from "../song/support";

// sixteen quarter notes: four bars of 4/4
const times = Array.from({ length: 16 }, (_, i) => i);
const pass = (s: ReturnType<typeof createSupport>, hit: (i: number) => boolean) => times.map((_, i) => {
  const g = s.gain(i); // the note sounds, then it is scored
  s.observe(i, hit(i));
  return g;
});

describe("the melody shadow", () => {
  it("stays out while the notes land", () => {
    const s = createSupport(times);
    expect(Math.max(...pass(s, () => true))).toBe(0);
    // one stray miss is not a struggle
    const g = pass(s, (i) => i !== 5);
    expect(Math.max(...g)).toBeLessThan(0.15);
  });

  it("comes in where the player struggles, inside the same pass, and stays local", () => {
    const s = createSupport(times);
    const g = pass(s, (i) => i < 4 || i >= 8); // bar 2 falls apart
    expect(g[7]).toBeGreaterThan(0.5); // by the end of that bar
    expect(g[2]).toBe(0);
    expect(g[15]).toBeLessThan(0.1);
    const again = pass(s, (i) => i < 4 || i >= 8);
    expect(again[5]).toBeGreaterThan(0.6); // waiting there next time round
  });

  it("eases off as it comes together, slower than it came", () => {
    const s = createSupport(times);
    pass(s, () => false);
    const full = pass(s, () => false)[15];
    expect(full).toBeGreaterThan(0.85);
    const one = pass(s, () => true)[15];
    expect(one).toBeGreaterThan(0.3); // one good pass with the shadow on proves little
    const later = [1, 2, 3, 4, 5].map(() => pass(s, () => true)[15]);
    expect(later[0]).toBeLessThan(one);
    expect(later[4]).toBe(0);
  });

  it("supports a gentle warm-start blend that dissolves as the player lands notes", () => {
    const s = createSupport(times, { warmStart: 0.36 });
    const first = pass(s, () => true);
    expect(first[0]).toBeGreaterThan(0.15); // joins in softly on note 1
    expect(first[15]).toBeLessThan(first[0]); // fades out as notes land
    const second = pass(s, () => true);
    expect(second[15]).toBe(0); // player carries it solo
  });
});

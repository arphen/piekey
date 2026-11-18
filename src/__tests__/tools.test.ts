import { describe, expect, it } from "vitest";
import { tapTempo } from "../tools/timing";

describe("tap tempo", () => {
  it("uses recent intervals, resisting an uneven tap without changing the beat unit", () => {
    let taps: number[] = [];
    let bpm: number | null = null;
    for (const at of [0, 750, 1500, 2250, 3100, 3750, 4500]) {
      const next = tapTempo(taps, at);
      taps = next.taps; bpm = next.bpm;
    }
    expect(bpm).toBe(80);
  });

  it("ignores accidental double taps, restarts after a pause, and supports the slow tempo limit", () => {
    expect(tapTempo([0, 750], 800)).toEqual({ taps: [0, 750], bpm: null });
    expect(tapTempo([0, 750], 4000)).toEqual({ taps: [4000], bpm: null });
    expect(tapTempo([4000], 6000).bpm).toBe(30);
  });
});

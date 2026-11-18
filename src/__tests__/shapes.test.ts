import { describe, expect, it } from "vitest";
import { KEYS, getKey, harmonicMinorShapes, rootShape, shapeDrill, type ShapeDrill } from "../core";
import { buildMinorVamp } from "../core/tunes/autumnLeaves";

describe("harmonic minor 3NPS shapes", () => {
  it("matches the standard C harmonic minor chart on the low E string", () => {
    const shapes = harmonicMinorShapes(getKey("C"));
    const lowE = shapes.map((s) => s.notes.slice(0, 3).map((n) => n.fret));
    expect(lowE).toEqual([
      [1, 3, 4],
      [3, 4, 7],
      [4, 7, 8],
      [7, 8, 10],
      [8, 10, 11],
      [10, 11, 13],
      [11, 13, 15],
    ]);
    expect(shapes.map((s) => s.startName)).toEqual(["F", "G", "Ab", "B", "C", "D", "Eb"]);
  });

  it("every key: 7 shapes, 3 ascending notes on each string, playable frets", () => {
    for (const key of KEYS) {
      const shapes = harmonicMinorShapes(key);
      expect(shapes).toHaveLength(7);
      for (const s of shapes) {
        expect(s.notes).toHaveLength(18);
        for (let str = 0; str < 6; str++) expect(s.notes.filter((n) => n.string === str)).toHaveLength(3);
        expect(s.from).toBeGreaterThanOrEqual(0);
        expect(s.to).toBeLessThanOrEqual(21);
        expect(s.to - s.from).toBeLessThanOrEqual(7);
      }
    }
  });

  it("drills fill whole i–V phrases", () => {
    const shape = harmonicMinorShapes(getKey("A"))[0];
    for (const d of ["run", "threes", "thirds"] as ShapeDrill[]) {
      const { steps, bars } = shapeDrill(shape, d);
      expect(bars % 2).toBe(0);
      const last = steps[steps.length - 1];
      expect(last.startBeat + last.durationBeats).toBeCloseTo(bars * 4, 6);
      expect(buildMinorVamp(getKey("A"), bars).bars.map((b) => b.chords[0].symbol).slice(0, 2)).toEqual(["Am(maj7)", "E7"]);
    }
  });
});

describe("root-to-root shape", () => {
  it("E minor: A7 → high e 12, shifting on the G string", () => {
    const s = rootShape(getKey("E"));
    const byString = [4, 3, 2, 1, 0].map((str) => s.notes.filter((n) => n.string === str).map((n) => n.fret));
    expect(byString).toEqual([
      [7, 9, 10],
      [7, 9, 10],
      [8, 9, 11],
      [8, 10, 12],
      [8, 11, 12],
    ]);
    expect(s.notes[0].pc).toBe(s.notes[s.notes.length - 1].pc);
    for (const d of ["run", "threes", "thirds"] as ShapeDrill[]) expect(shapeDrill(s, d).bars % 2).toBe(0);
  });
});

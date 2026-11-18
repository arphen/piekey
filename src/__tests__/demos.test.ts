import { describe, expect, it } from "vitest";
import { KEYS, getTune, landingTarget } from "../core";
import { legendDemo, type DemoId } from "../core/demos";

const IDS: DemoId[] = ["root", "guideTone", "chordTone", "scale", "changed", "target", "parent", "mode"];

describe("legend demos", () => {
  it("every bar in every key gives well-formed two-bar phrases", () => {
    for (const key of KEYS) {
      const chords = getTune(2, key).bars.flatMap((b) => b.chords);
      chords.forEach((chord, i) => {
        const args = { chord, prevChord: chords[i - 1], nextChord: chords[i + 1], key };
        for (const id of IDS) {
          const d = legendDemo(id, args);
          if (!d) continue;
          expect(d.notes.length).toBeGreaterThan(4);
          expect(d.notes.some((n) => n.accent)).toBe(true);
          for (const n of d.notes) {
            expect(n.midi).toBeGreaterThanOrEqual(43);
            expect(n.midi).toBeLessThanOrEqual(91);
            expect(n.beat + n.dur).toBeLessThanOrEqual(8);
          }
        }
      });
    }
  });

  it("target demo ends and lands on the landing target", () => {
    const key = KEYS[0];
    const chords = getTune(2, key).bars.flatMap((b) => b.chords);
    const d = legendDemo("target", { chord: chords[0], nextChord: chords[1], key })!;
    const land = landingTarget(chords[0], chords[1], key);
    expect(d.notes.find((n) => n.tag === "end")!.midi % 12).toBe(land.endPc);
    expect(d.notes.find((n) => n.tag === "land")!.midi % 12).toBe(land.landPc);
  });

  it("changed demo only exists across a scale switch", () => {
    const key = KEYS[0];
    const chords = getTune(2, key).bars.flatMap((b) => b.chords);
    for (let i = 1; i < chords.length; i++) {
      const d = legendDemo("changed", { chord: chords[i], prevChord: chords[i - 1], key });
      expect(d !== null).toBe(chords[i].parentScale !== chords[i - 1].parentScale);
      if (d) expect(d.notes.some((n) => n.role === "changed")).toBe(true);
    }
  });
});

describe("mode demos", () => {
  it("every mode in the tune has a flavour note", () => {
    for (const level of [1, 2] as const) {
      for (const chord of getTune(level, KEYS[0]).bars.flatMap((b) => b.chords)) {
        const d = legendDemo("mode", { chord, key: KEYS[0] })!;
        expect(d.notes.some((n) => n.accent && n.midi % 12 !== chord.rootPc), chord.modeName).toBe(true);
      }
    }
  });
});

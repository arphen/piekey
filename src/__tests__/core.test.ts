import { describe, expect, it } from "vitest";
import { KEYS, buildPattern, fretboardNotes, getKey, getTune, landingTarget, parentScales, positionsFor, spell } from "../core";
import type { PatternId } from "../core";
import { generateBacking } from "../audio/backing";

const PATTERNS: PatternId[] = ["scale", "thirds", "triads", "sevenths", "guideTones", "arpChain"];
const A = getKey("A");

describe("keys", () => {
  it("12 keys, A first, offsets in range", () => {
    expect(KEYS.map((k) => k.tonic)).toEqual(["A", "E", "D", "G", "C", "F", "Bb", "Eb", "B", "F#", "C#", "G#"]);
    expect(getKey("nope").tonic).toBe("A");
    for (const k of KEYS) {
      expect(k.offset).toBeGreaterThanOrEqual(-5);
      expect(k.offset).toBeLessThanOrEqual(6);
    }
    expect(getKey("G").offset).toBe(-2);
    expect(getKey("B").offset).toBe(2);
    expect(getKey("E").offset).toBe(-5);
  });
});

for (const key of KEYS) {
  describe(`key ${key.label}`, () => {
    const PS = parentScales(key);
    for (const level of [1, 2] as const) {
      const tune = getTune(level, key);
      it(`level ${level}: 32 bars of 4 beats, key label`, () => {
        expect(tune.bars).toHaveLength(32);
        expect(tune.key).toBe(key.label);
        for (const b of tune.bars) expect(b.chords.reduce((a, c) => a + c.beats, 0)).toBe(4);
      });
      it(`level ${level}: chord tones in parent scale; leading tone only in harmMinor`, () => {
        const lt = (key.tonicPc + 11) % 12;
        for (const b of tune.bars)
          for (const c of b.chords) {
            for (const pc of c.chordTones) expect(PS[c.parentScale].pcs).toContain(pc);
            if (c.parentScale !== "harmMinor") expect(c.chordTones).not.toContain(lt);
            expect(PS[c.parentScale].pcs.includes(lt)).toBe(c.parentScale === "harmMinor");
          }
      });
    }
    it("every scale is spelled with 7 distinct letters", () => {
      for (const s of Object.values(PS)) {
        const letters = s.pcs.map((pc) => spell(pc, s.id, key)[0]);
        expect(new Set(letters).size).toBe(7);
      }
    });
    it("positions within 0..15", () => {
      for (const p of positionsFor(key)) {
        expect(p.from).toBeGreaterThanOrEqual(0);
        expect(p.to).toBeLessThanOrEqual(15);
        expect(p.to - p.from).toBe(3);
      }
    });
    it("fretboard roles and window", () => {
      const t = getTune(1, key);
      const pos = positionsFor(key)[0];
      const notes = fretboardNotes({ chord: t.bars[5].chords[0], prevChord: t.bars[4].chords[0], nextChord: t.bars[6].chords[0], position: pos, fretCount: 15, key });
      expect(notes.find((n) => n.pc === t.bars[5].chords[0].rootPc)!.role).toBe("root");
      for (const n of notes) expect(n.inWindow).toBe(n.fret >= pos.from && n.fret <= pos.to);
    });
    it("buildPattern steps in window (all patterns, all positions)", () => {
      const t = getTune(2, key);
      for (const pos of positionsFor(key))
        for (const id of PATTERNS) {
          const seen = new Set<string>();
          for (const bar of t.bars)
            for (const chord of bar.chords) {
              if (seen.has(chord.symbol)) continue;
              seen.add(chord.symbol);
              const steps = buildPattern(id, chord, pos, key);
              expect(steps.length).toBeGreaterThan(1);
              expect(steps.length).toBeLessThan(200);
              for (const s of steps) {
                expect(s.fret).toBeGreaterThanOrEqual(pos.from);
                expect(s.fret).toBeLessThanOrEqual(pos.to);
                expect(PS[chord.parentScale].pcs).toContain(s.pc);
              }
            }
        }
    });
  });
}

describe("spelling spot checks", () => {
  it("A minor keeps original symbols", () => {
    const t = getTune(1, A);
    expect(t.bars.slice(0, 8).map((b) => b.chords[0].symbol)).toEqual(["Dm7", "G7", "Cmaj7", "Fmaj7", "Bm7b5", "E7", "Am", "Am"]);
    expect(t.bars[29].chords.map((c) => [c.symbol, c.beats])).toEqual([["Bm7b5", 2], ["E7", 2]]);
    expect(getTune(2, A).bars[26].chords.map((c) => c.symbol)).toEqual(["Am7", "D7"]);
  });
  it("G minor", () => {
    const g = getKey("G");
    const t = getTune(1, g);
    expect(t.bars.slice(0, 8).map((b) => b.chords[0].symbol)).toEqual(["Cm7", "F7", "Bbmaj7", "Ebmaj7", "Am7b5", "D7", "Gm", "Gm"]);
    expect(getTune(2, g).bars[26].chords.map((c) => c.symbol)).toEqual(["Gm7", "C7"]);
    const PS = parentScales(g);
    expect(PS.relMajor.pcs.map((pc) => spell(pc, "relMajor", g)).join(" ")).toBe("Bb C D Eb F G A");
    expect(PS.harmMinor.pcs.map((pc) => spell(pc, "harmMinor", g)).join(" ")).toBe("G A Bb C D Eb F#");
    expect(t.key).toBe("G minor");
  });
  it("F# and Eb minor", () => {
    const f = getKey("F#");
    expect(parentScales(f).harmMinor.pcs.map((pc) => spell(pc, "harmMinor", f)).join(" ")).toBe("F# G# A B C# D E#");
    const e = getKey("Eb");
    expect(parentScales(e).harmMinor.pcs.map((pc) => spell(pc, "harmMinor", e)).join(" ")).toBe("Eb F Gb Ab Bb Cb D");
    expect(parentScales(e).relMajor.name).toBe("Gb major");
  });
  it("E minor positions", () => {
    const p = positionsFor(getKey("E"));
    expect(p.map((x) => [x.id, x.from, x.to, x.label])).toEqual([
      ["V", 0, 3, "Open position"],
      ["VII", 2, 5, "Position II"],
      ["II", 9, 12, "Position IX"],
      ["IX", 4, 7, "Position IV"],
      ["XII", 7, 10, "Position VII"],
    ]);
  });
  it("A minor positions unchanged", () => {
    expect(positionsFor(A).map((x) => [x.from, x.to])).toEqual([[5, 8], [7, 10], [2, 5], [9, 12], [12, 15]]);
  });
});

describe("backing", () => {
  it("bass stays in range, one note per beat, all keys", () => {
    for (const key of KEYS) {
      const bass = generateBacking(getTune(1, key), { start: 0, end: 31 }).filter((e) => e.kind === "bass");
      expect(bass).toHaveLength(128);
      for (const b of bass) {
        expect(b.midis[0]).toBeGreaterThanOrEqual(28);
        expect(b.midis[0]).toBeLessThanOrEqual(48);
      }
    }
  });
});

describe("landingTarget", () => {
  it("ends each ii-V-I chord on the guide tone a half step above the next 3rd/7th", () => {
    const key = getKey("G");
    const tune = getTune(1, key);
    const [cm7, f7, bbmaj7] = tune.bars.slice(0, 3).map((b) => b.chords[0]);
    expect(landingTarget(cm7, f7, key)).toMatchObject({ endName: "Bb", landName: "A", landRole: "3rd", step: -1 });
    expect(landingTarget(f7, bbmaj7, key)).toMatchObject({ endName: "Eb", landName: "D", landRole: "3rd", step: -1 });
  });
});

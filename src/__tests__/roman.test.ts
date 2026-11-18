import { describe, expect, it } from "vitest";
import { getKey, getTune } from "../core";
import { romanNumeral } from "../core/roman";

const rn = (symbol: string, tonicPc: number) => {
  const r = romanNumeral(symbol, tonicPc);
  return r ? r.numeral + r.quality : null;
};

describe("romanNumeral", () => {
  it("analyses Autumn Leaves in A minor (jazz convention: accidentals relative to major)", () => {
    expect(["Dm7", "G7", "Cmaj7", "Fmaj7", "Bm7b5", "E7", "Am"].map((s) => rn(s, 9))).toEqual([
      "iv7", "♭VII7", "♭IIIΔ7", "♭VIΔ7", "iiø7", "V7", "i",
    ]);
    expect(["Am7", "D7", "Gm7", "C7", "Am(maj7)"].map((s) => rn(s, 9))).toEqual(["i7", "IV7", "♭vii7", "♭III7", "iΔ7"]);
  });

  it("handles sharps, flats and diminished chords", () => {
    expect(rn("F#m7b5", 4)).toBe("iiø7");
    expect(rn("Bbmaj7", 2)).toBe("♭VIΔ7");
    expect(rn("G#dim7", 9)).toBe("vii°7");
    expect(rn("nonsense", 0)).toBeNull();
  });

  it("gives the same numerals in every key", () => {
    const ref = getTune(2, getKey("A")).bars.flatMap((b) => b.chords.map((c) => rn(c.symbol, 9)));
    for (const tonic of ["E", "F#", "Bb", "C", "G#"]) {
      const key = getKey(tonic);
      const got = getTune(2, key).bars.flatMap((b) => b.chords.map((c) => rn(c.symbol, key.tonicPc)));
      expect(got).toEqual(ref);
    }
  });
});

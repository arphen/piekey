import { describe, expect, it } from "vitest";
import { buildCampfireSheet, transposeChord, transposeKey } from "../tunes/campfire";
import type { LeadSheet } from "../tunes/musicxml";

const MOCK_SHEET: LeadSheet = {
  id: "test-campfire",
  title: "Campfire Test",
  composer: "Traditional",
  keySignature: "Am",
  timeSignature: "4/4",
  tempo: 96,
  barNumbers: ["1", "2", "3", "4"],
  comp: [],
  chordsFromVoicings: false,
  bars: [
    { barIndex: 0, section: "Intro", chordSymbols: ["Am", "C/G"], notes: [], lyrics: "Hello world" },
    { barIndex: 1, chordSymbols: ["D/F#"], notes: [] },
    { barIndex: 2, section: "Chorus", chordSymbols: ["Fmaj7", "G"], notes: [], repeatStart: true, lyrics: "Sing along" },
    { barIndex: 3, chordSymbols: ["Am"], notes: [], repeatEnd: 2 },
  ],
};

describe("campfire songbook helpers", () => {
  it("transposes chords including slash bass notes and keys", () => {
    expect(transposeChord("Am", 2)).toBe("Bm");
    expect(transposeChord("C/G", -2)).toBe("A#/F");
    expect(transposeChord("C/G", -2, true)).toBe("Bb/F");
    expect(transposeChord("D/F#", 1, true)).toBe("Eb/G");
    expect(transposeChord("N.C.", 3)).toBe("N.C.");
    expect(transposeKey("Am", -2)).toBe("Gm");
    expect(transposeKey("C", 5)).toBe("F");
  });

  it("groups sections, builds unique chord palette, and carries lyrics", () => {
    const cf = buildCampfireSheet(MOCK_SHEET, 0);
    expect(cf.key).toBe("Am");
    expect(cf.hasChords).toBe(true);
    expect(cf.hasLyrics).toBe(true);
    expect(cf.sections.map((s) => [s.title, s.bars.length])).toEqual([
      ["Intro", 2],
      ["Chorus", 2],
    ]);
    expect(cf.sections[0].bars[0].lyrics).toBe("Hello world");
    expect(cf.sections[1].bars[0].lyrics).toBe("Sing along");
    expect(cf.palette.map((p) => p.symbol)).toEqual(["Am", "C/G", "D/F#", "Fmaj7", "G"]);
    expect(cf.palette.every((p) => p.voicing.notes.length > 0)).toBe(true);

    // Transposed down 2 semitones (Capo 2 shapes)
    const transposed = buildCampfireSheet(MOCK_SHEET, -2);
    expect(transposed.key).toBe("Gm");
    expect(transposed.sections[0].bars[0].chords).toEqual(["Gm", "Bb/F"]);
    expect(transposed.sections[0].bars[1].chords).toEqual(["C/E"]);
  });
});

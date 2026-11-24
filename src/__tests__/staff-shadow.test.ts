import { describe, expect, it } from "vitest";
import { analyzeWrongNote, mistakeDeltaText, writtenStaffPos } from "../song/staffShadow";

describe("staffShadow — engraved wrong-note geometry & ledger helpers", () => {
  it("maps written treble-clef keys to exact staff positions (E4 = 0, F5 = 8)", () => {
    expect(writtenStaffPos("e/4")).toBe(0);
    expect(writtenStaffPos("f/4")).toBe(1);
    expect(writtenStaffPos("f/5")).toBe(8);
    expect(writtenStaffPos("c/4")).toBe(-2);
    expect(writtenStaffPos("a/3")).toBe(-4);
    expect(writtenStaffPos("a/5")).toBe(10);
    expect(writtenStaffPos("c/6")).toBe(12);
  });

  it("shows natural and sharp accidentals accurately in D natural minor (1 flat)", () => {
    // Target is written B♭4 (sounding B♭3 = MIDI 58); player hits B♮3 (MIDI 59)
    const bNat = analyzeWrongNote(59, 58, "bb/4", "Dm");
    expect(bNat.steps).toBe(0);
    expect(bNat.acc).toBe("♮");
    expect(bNat.ghostPos).toBe(4);
    expect(bNat.onLine).toBe(true);
    expect(bNat.inStaff).toBe(true);
    expect(bNat.ledgerHalfSpaces).toEqual([]);
    expect(mistakeDeltaText(59, 58)).toBe("1 fret high ↓");

    // Target is written C5 (sounding C4 = MIDI 60); player hits D♭4 / C♯4 (MIDI 61)
    const cSharp = analyzeWrongNote(61, 60, "c/5", "Dm");
    expect(cSharp.acc).toBe("♭"); // Dm uses flats -> D♭
    expect(cSharp.steps).toBe(1);
    expect(cSharp.ghostPos).toBe(6);
    expect(cSharp.onLine).toBe(true);
  });

  it("computes exact ledger-line offsets below and above the treble staff", () => {
    // Target is written C4 (sounding C3 = MIDI 48); player plays A2 (MIDI 45, written A3 = pos -4 -> 2 ledger lines at -2 and -4)
    const lowA = analyzeWrongNote(45, 48, "c/4", "C");
    expect(lowA.ghostPos).toBe(-4);
    expect(lowA.onLine).toBe(true);
    expect(lowA.inStaff).toBe(false);
    // Relative to ghost center (-4): line at -2 is -2 half-spaces above, line at -4 is 0 (through the notehead)
    expect(lowA.ledgerHalfSpaces).toEqual([-2, 0]);

    // Target is written G5 (sounding G4 = MIDI 67); player plays C5 (MIDI 72, written C6 = pos 12 -> 2 ledger lines at 10 and 12)
    const highC = analyzeWrongNote(72, 67, "g/5", "C");
    expect(highC.ghostPos).toBe(12);
    expect(highC.onLine).toBe(true);
    expect(highC.inStaff).toBe(false);
    // Relative to ghost center (12): line at 10 is +2 half-spaces below, line at 12 is 0 (through the notehead)
    expect(highC.ledgerHalfSpaces).toEqual([2, 0]);
  });

  it("describes octave-off mistakes cleanly", () => {
    const oct = analyzeWrongNote(62, 50, "d/4", "Dm");
    expect(oct.octaveOff).toBe(true);
    expect(mistakeDeltaText(62, 50)).toBe("1 octave high ↓");
    expect(mistakeDeltaText(38, 50)).toBe("1 octave low ↑");
  });
});

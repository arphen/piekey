import { describe, expect, it } from "vitest";
import { buildDeck, findCard } from "../song/deck";
import { makeScale } from "../song/harmony";
import { parseScaleId } from "../song/kin";
import { keyStudySheet } from "../song/keyStudy";
import { cagedShapes, findOwnPass, knownLine, shapeLine, validShapeBook, type ShapeBook } from "../song/scaleShapes";
import { buildTimeline } from "../tunes/order";

const C = makeScale(0, "major");
const shape = (scale: ReturnType<typeof makeScale>, id: string) => cagedShapes(scale).find((o) => o.id === id)!;
const midis = (notes: { midi: number }[]) => notes.map((n) => n.midi);

describe("scale shapes", () => {
  it("places the CAGED shapes where the barre chords are", () => {
    expect(shape(C, "E").p).toBe(7); // C major, E shape: root on the low E, fret 8
    expect(shape(makeScale(2, "naturalMinor"), "A").p).toBe(5); // D minor, A shape: root on the A string, fret 5
    expect(shape(makeScale(7, "major"), "A").p).toBe(9); // G major, A shape: root on the A string, fret 10
    expect(shape(makeScale(5, "major"), "A").p).toBe(7);
  });

  it("goes root to root and turns round without striking the top note twice", () => {
    const run = midis(shapeLine("run", C, shape(C, "E")));
    expect([run[0], Math.max(...run), run[run.length - 1]]).toEqual([48, 72, 48]); // C3 → C5 → C3
    const thirds = midis(shapeLine("thirds", C, shape(C, "E")));
    expect(thirds.slice(0, 4)).toEqual([48, 52, 50, 53]); // C E D F
    const top = thirds.indexOf(72);
    expect(thirds[top + 1]).not.toBe(72);
    expect(thirds[thirds.length - 1]).toBe(48);
    expect(midis(shapeLine("triads", C, shape(C, "E"))).slice(0, 6)).toEqual([48, 52, 55, 50, 53, 57]); // C E G, D F A
  });

  it("turns round on the tonic triad when a shape holds only one octave of roots", () => {
    const run = midis(shapeLine("run", makeScale(2, "naturalMinor"), shape(makeScale(2, "naturalMinor"), "A")));
    expect([run[0], Math.max(...run), Math.min(...run)]).toEqual([50, 69, 50]); // D3 → A4, nothing under D3
  });

  it("hears a whole pass of the scale, turnarounds of the player's own included", () => {
    const up = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67];
    const pass = [...up, ...up.slice(0, -1).reverse()];
    expect(findOwnPass([61, 70, ...pass], C.pcs)).toEqual(pass);
    // under the root and back up to it
    const low = [...up, ...up.slice(0, -1).reverse(), 47, 45, 47, 48];
    expect(findOwnPass(low, C.pcs)).toEqual(low);
    // half a pass, another scale, or a leap is not a version
    expect(findOwnPass(up, C.pcs)).toBeNull();
    expect(findOwnPass(pass.map((m) => m + 1), C.pcs)).toBeNull();
    expect(findOwnPass([48, 50, 52, 64, 65, 67, 65, 64, 52, 50, 48], C.pcs)).toBeNull();
  });

  it("takes the score played with a slip for the score, and another turnaround for a version", () => {
    const score = midis(shapeLine("run", C, shape(C, "E")));
    const slip = [...score];
    slip[5] = slip[5] + 1;
    expect(knownLine(slip, [score])).toBe(true);
    const top = score.indexOf(72);
    const lower = [...score.slice(0, top - 1), ...score.slice(top + 2)]; // turns round on A4, not C5
    expect(knownLine(lower, [score])).toBe(false);
  });

  it("builds a chosen shape as its own exercise, and the next drill builds on it", () => {
    const sheet = keyStudySheet("M0")!;
    const book: ShapeBook = { v: 1, own: {}, chosen: { "scale:C-major:run": "E" } };
    const deck = buildDeck(sheet, buildTimeline(sheet), { shapes: book });
    const run = findCard(deck.cards, "scale:C-major:run")!;
    expect(run.id).toBe("scale:C-major:run@E");
    expect(run.p).toBe(7);
    expect(run.base).toBe("scale:C-major:run");
    expect(deck.cards.find((c) => c.id === "scale:C-major:thirds")?.needs).toBe("scale:C-major:run@E");
    expect(parseScaleId(run.id)).toMatchObject({ root: 0, kind: "major", drill: "run" });
  });

  it("accepts only well-formed shape books from storage and sync", () => {
    expect(validShapeBook({ v: 1, own: { "C-major": [{ id: "my1", notes: [48, 50, 48], p: 7, at: "2026-11-24" }] }, chosen: { "scale:C-major:run": "my1" } })).toBe(true);
    expect(validShapeBook({ v: 1, own: {}, chosen: { "mel:new:0-1": "E" } })).toBe(false);
    expect(validShapeBook({ v: 1, own: { "C-major": [{ id: "my 1", notes: [48], p: 7, at: "x" }] }, chosen: {} })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { ReadingBar, ReadingNote } from "../core/contract";
import { flowOf } from "../tunes/flow";
import { buildPlan } from "../tunes/learn";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";

const note = (midi: number, startBeat: number, extra: Partial<ReadingNote> = {}): ReadingNote => ({
  rest: false, midi, vexKey: "c/5", accidental: null, duration: "q", dotted: false, startBeat, durationBeats: 1, string: 0, fret: 0, ...extra,
});
let at = 0;
const bar = (midis: number[], extra: Partial<ReadingBar> = {}, chords: string[] = []): ReadingBar => {
  const notes = midis.map((m, i) => note(m, at + i));
  at += 4;
  return { barIndex: 0, chordSymbols: chords, notes, beats: 4, ...extra };
};
const sheetOf = (bars: ReadingBar[]) => ({ bars, barNumbers: bars.map((_, i) => String(i + 1)), keySignature: "C", timeSignature: "4/4", comp: [] });
const whole = (sheet: ReturnType<typeof sheetOf>) => {
  const tl = buildTimeline(sheet);
  return { tl, flow: flowOf(sheet, tl, 0, tl.slots.length - 1, 0, tl.targets.length - 1) };
};

describe("the tune as it is played", () => {
  it("unrolls repeats and endings into forward bars without the marks that send the eyes back", () => {
    at = 0;
    const sheet = sheetOf([
      bar([60, 62, 64, 65], { repeatStart: true }),
      bar([67, 69, 71, 72], { volta: { label: "1.", numbers: [1], begin: true, end: true, closed: true }, repeatEnd: 2 }),
      bar([72, 71, 69, 67], { volta: { label: "2.", numbers: [2], begin: true, end: true, closed: false } }),
      bar([60, 60, 60, 60], { barline: "final" }),
    ]);
    const { tl, flow } = whole(sheet);
    expect(flow.bars.map((b) => b.bar)).toEqual([0, 1, 0, 2, 3]);
    expect(flow.bars.map((b) => b.pass)).toEqual([1, 1, 2, 2, 1]);
    expect(flow.exercise.bars.some((b) => b.repeatStart || b.repeatEnd || b.volta || b.barline)).toBe(false);
    // every target lands on its own flow note, in order: the second time through is new paper
    expect(flow.notesOf.flat()).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(flow.notesOf.map((_, i) => flow.noteTarget[flow.notesOf[i][0]])).toEqual(tl.targets.map((_, i) => i));
    expect(flow.printed.slice(8, 12)).toEqual([0, 1, 2, 3]); // the repeat plays the first bar's notes again
  });

  it("draws a tie only where the music holds one note on, never into the bar a repeat goes back to", () => {
    at = 0;
    const b0 = bar([62, 64, 65, 67], { repeatStart: true });
    const b1 = bar([69, 71, 72, 74], { repeatEnd: 2 });
    b1.notes[3] = { ...b1.notes[3], tieToNext: true };
    const b2 = bar([74, 72, 71, 69]);
    const sheet = sheetOf([b0, b1, b2]);
    const { flow } = whole(sheet);
    // flow bars: 0 1 0 1 2. The first time bar 1's last note meets bar 0's D; the second time it holds into bar 2.
    expect(flow.exercise.bars[1].notes[3].tieToNext).toBe(false);
    expect(flow.exercise.bars[3].notes[3].tieToNext).toBe(true);
    expect(flow.notesOf.at(-4)).toEqual([15, 16]);
  });

  it("names sections from rehearsal marks and counts the times round", () => {
    at = 0;
    const sheet = sheetOf([
      bar([60, 60, 60, 60], { section: "A", repeatStart: true }),
      bar([62, 62, 62, 62]),
      bar([64, 64, 64, 64], { section: "B" }),
      bar([65, 65, 65, 65], { repeatEnd: 2 }),
    ]);
    const { flow } = whole(sheet);
    expect(flow.sections.map((s) => [s.label, s.pass, s.from, s.to])).toEqual([["A", 1, 0, 1], ["B", 1, 2, 3], ["A", 2, 4, 5], ["B", 2, 6, 7]]);
    expect(flow.sections.every((s) => s.printed)).toBe(true);
  });

  it("finds the form of an unmarked tune in what comes back: the same changes are the same part", () => {
    at = 0;
    const changes = ["Am7", "G", "Bm", "Em"];
    const a = (shift: number) => changes.map((c, i) => bar([69 + shift + i, 72, 74, 76], {}, [c]));
    const sheet = sheetOf([
      ...a(0), ...a(0), // A: the changes twice
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => bar([50 + i, 52, 53, 55], {}, [i % 2 ? "D" : "C"])), // B: something else
      ...a(0).map((b, i) => (i === 3 ? { ...b, notes: b.notes.map((n) => ({ ...n, midi: n.midi - 7 })) } : b)), ...a(0), // A again, one bar's line changed
    ]);
    const { flow } = whole(sheet);
    const labels = flow.sections.map((s) => s.label);
    expect(labels[0]).toBe("A");
    expect(labels).toContain("B");
    expect(labels.at(-1)?.startsWith("A")).toBe(true);
    expect(flow.sections.every((s) => !s.printed)).toBe(true);
    // sections tile the stream
    flow.sections.forEach((s, i) => expect(s.from).toBe(i ? flow.sections[i - 1].to + 1 : 0));
    expect(flow.sections.at(-1)?.to).toBe(flow.bars.length - 1);

    // and an unmarked tune is learned by those parts: B gets its own lessons before the whole tune
    const plan = buildPlan(sheet as unknown as LeadSheet, buildTimeline(sheet));
    const titles = plan.map((s) => s.title);
    const tune = titles.indexOf("The whole tune");
    expect(titles.indexOf("A section in time")).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf("B section in time")).toBeGreaterThan(titles.indexOf("A section in time"));
    expect(titles.indexOf("B section in time")).toBeLessThan(tune);
    const b = flow.sections.find((s) => s.label === "B")!;
    expect(plan.some((s) => s.kind === "new" && s.from === b.from)).toBe(true); // B's first chunk starts with B
    expect(plan.filter((s) => s.kind === "section").every((s) => s.to - s.from < flow.bars.length - 1)).toBe(true); // no part is the whole tune
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { getKey, getTune, positionsFor } from "../core";
import type { ReadingLevel } from "../core/contract";
import { Score } from "../components/Score";
import { generateReading } from "../reading";

// jsdom has no layout: give VexFlow text measurement and ResizeObserver something to work with.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(globalThis as any).ResizeObserver = class {
  constructor(private cb: (e: { contentRect: { width: number } }[]) => void) {}
  observe() {
    this.cb([{ contentRect: { width: 900 } }]);
  }
  disconnect() {}
};

for (const tonic of ["A", "G", "Eb", "F#"]) {
  for (const level of [1, 2, 3, 4] as ReadingLevel[]) {
    it(`renders ${tonic} minor level ${level}`, () => {
      const key = getKey(tonic);
      const ex = generateReading({
        tune: getTune(1, key),
        key,
        level,
        loop: { start: 0, end: 7 },
        position: positionsFor(key)[0],
        seed: 3,
      });
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      act(() => root.render(<Score exercise={ex} activeStep={2} results={["hit", "miss"]} showFingering />));
      const notes = host.querySelectorAll(".vf-stavenote");
      expect(notes.length).toBe(ex.bars.flatMap((b) => b.notes).length);
      expect(host.querySelectorAll(".vf-stavenote.is-active").length).toBe(1);
      act(() => root.unmount());
    });
  }
}

it("keeps concealed memory notes and connecting marks hidden after scoring, with optional bar-start landmarks", () => {
  const key = getKey("A");
  const exercise = generateReading({ tune: getTune(1, key), key, level: 2, loop: { start: 0, end: 1 }, position: positionsFor(key)[0], seed: 3 });
  exercise.bars[0].notes.find((note) => !note.rest)!.tieToNext = true;
  const hideBars = exercise.bars.map((_, index) => index);
  const count = exercise.bars.flatMap((bar) => bar.notes.filter((note) => !note.rest)).length;
  const results = Array.from({ length: count }, () => "hit" as const);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (noteVisibility: "played" | "landmarks" | "hidden") => act(() => root.render(<Score exercise={exercise} activeStep={1} results={results} showFingering={false} hideBars={hideBars} noteVisibility={noteVisibility} />));
  render("hidden");
  expect(host.querySelectorAll("[data-note].is-hidden")).toHaveLength(count);
  const links = [...host.querySelectorAll(".vf-score-note-links")];
  expect(links.length).toBeGreaterThan(0);
  expect(links.some((element) => element.children.length > 0)).toBe(true);
  expect(links.every((element) => element.getAttribute("opacity") === "0")).toBe(true);
  render("landmarks");
  expect(host.querySelectorAll("[data-note]:not(.is-hidden)")).toHaveLength(exercise.bars.length);
  render("played");
  expect(host.querySelectorAll("[data-note].is-hidden")).toHaveLength(0);
  expect(links.every((element) => element.getAttribute("opacity") === "1")).toBe(true);
  act(() => root.unmount());
  host.remove();
});

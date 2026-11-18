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

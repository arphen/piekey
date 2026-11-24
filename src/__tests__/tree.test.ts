import { describe, expect, it } from "vitest";
import { buildDeck } from "../song/deck";
import { keyStudySheet } from "../song/keyStudy";
import { foundationKey, TECHNIQUE_TRACKS } from "../song/technique";
import { buildTimeline } from "../tunes/order";

describe("foundations in their own key", () => {
  const deckOf = (hub: string) => {
    const sheet = keyStudySheet(hub)!;
    return buildDeck(sheet, buildTimeline(sheet));
  };

  it("builds the same exercise in the anchor key whichever tune's deck asks for it", () => {
    const fromD = deckOf("M2").cards.find((c) => c.id === "tech:pyramid:core")!;
    const fromAm = deckOf("m9").cards.find((c) => c.id === "tech:pyramid:core")!;
    expect(fromD.steps).toEqual(fromAm.steps);
    const { scale } = foundationKey(TECHNIQUE_TRACKS.find((t) => t.id === "tech:pyramid:core")!);
    expect(fromD.steps.every((s) => s !== null && scale.pcs.includes(s.pc))).toBe(true);
    expect(fromD.where).toContain(scale.name);
  });

  it("walks the key's I–IV–V7–I under the rhythm pyramid, one chord a bar", () => {
    const card = deckOf("M2").cards.find((c) => c.id === "tech:pyramid:core")!;
    const romanAt = (beat: number) => card.context[card.steps.findIndex((s) => s !== null && (s.startBeat ?? 0) >= beat)]?.roman;
    expect([0, 4, 8, 12].map(romanAt)).toEqual(["I", "IV", "V7", "I"]);
  });
});

import { describe, expect, it } from "vitest";
import { buildDeck } from "../song/deck";
import { keyStudySheet } from "../song/keyStudy";
import { foundationKey, TECHNIQUE_TRACKS } from "../song/technique";
import { buildTimeline } from "../tunes/order";
import { homeTreeSpec, MID } from "../overview/homeTree";
import { bearingOf, resolveTree } from "../tree/layout";
import type { TreeSpec } from "../tree/model";

describe("passive tree layout", () => {
  const spec: TreeSpec = {
    origin: { x: 0, y: 0 },
    groups: [
      { id: "wheel", x: 0, y: 0, orbits: [0, 100] },
      { id: "branch", anchor: "east", heading: "outward", orbits: [20] },
    ],
    nodes: [
      { id: "north", kind: "hub", group: "wheel", orbit: 1, angle: 0, label: "N", family: "key", size: 10, out: ["east"] },
      { id: "east", kind: "hub", group: "wheel", orbit: 1, angle: 90, label: "E", family: "key", size: 10, out: ["tip"] },
      { id: "tip", kind: "skill", group: "branch", orbit: 0, angle: 0, label: "t", family: "scales", size: 4 },
      { id: "stray", kind: "skill", group: "missing", orbit: 0, angle: 0, label: "s", family: "scales", size: 4 },
    ],
  };
  const tree = resolveTree(spec);

  it("derives positions from orbits and pins anchored groups facing away from the origin", () => {
    expect(tree.byId.get("north")).toMatchObject({ x: 0, y: -100 });
    expect(tree.byId.get("east")!.x).toBeCloseTo(100);
    expect(tree.byId.get("tip")!.x).toBeCloseTo(120);
    expect(tree.byId.get("tip")!.y).toBeCloseTo(0);
    expect(tree.byId.has("stray")).toBe(false);
  });

  it("draws links within one orbit as arcs and other links as paths between the nodes", () => {
    const round = tree.edges.find((e) => e.id === "north>east")!;
    expect(round.shape).toBe("orbit");
    expect(round.d).toContain(" A 100.0 100.0 0 0 1 ");
    expect(tree.edges.find((e) => e.id === "east>tip")!.shape).toBe("line");
  });
});

describe("home tree", () => {
  const tree = resolveTree(homeTreeSpec([{ id: "s1", title: "Song", key: "F#-major", fill: 0 }]));

  it("hangs every foundation on the branch of the key it lives in, chained in the order it opens", () => {
    for (const t of TECHNIQUE_TRACKS) {
      const node = tree.byId.get(t.id)!;
      const hub = tree.byId.get(t.hub)!;
      expect(node.group).toBe(`branch:${t.hub}`);
      const turn = (((bearingOf(hub, node) - bearingOf({ x: MID, y: MID }, hub)) % 360) + 540) % 360 - 180;
      expect(Math.abs(turn)).toBeLessThan(40); // grows outward from the hub, beside its own exercises
      if (t.needs) expect(tree.edges.some((e) => e.from === t.needs && e.to === t.id && e.kind === "chain")).toBe(true);
    }
    // two on one key sit either side of its axis
    const [a, b] = TECHNIQUE_TRACKS.filter((t) => t.hub === "M4").map((t) => tree.byId.get(t.id)!);
    expect(a.angle).toBeCloseTo(-b.angle);
  });

  it("moves a song out past the foundations of its key", () => {
    expect(tree.byId.get("tune:s1")!.orbit).toBe(5);
  });
});

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

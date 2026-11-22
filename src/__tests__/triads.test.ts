import { describe, expect, it } from "vitest";
import { answerTriad, emptyTriads, newDrill, nextTriad, openMap, openRings, validTriadStore, type TriadStore } from "../triads/box";
import { choicesFor, germanName, keyName, MINOR_KEYS, pcOf, TRIAD_BY_ID, TRIAD_CARDS, TRIAD_KEYS, vexOf } from "../triads/triads";

const card = (key: string, degree: number) => TRIAD_BY_ID.get(`triad:${key}:${degree}`)!;
const DAY = "2026-11-22";

describe("triads by heart", () => {
  it("spells each degree from its key's scale and writes it in close position", () => {
    expect(card("C", 1).triad.notes).toEqual(["D", "F", "A"]);
    expect(card("B♭", 1).triad.notes).toEqual(["C", "E♭", "G"]);
    expect(card("D♭", 2).triad.notes).toEqual(["F", "A♭", "C"]);
    expect(card("G♭", 3).triad.notes).toEqual(["C♭", "E♭", "G♭"]);
    const leading = card("F♯", 6);
    expect(leading.roman).toBe("vii°");
    expect(leading.triad).toMatchObject({ notes: ["E♯", "G♯", "B"], quality: "diminished", octaves: [4, 4, 4], midis: [65, 68, 71] });
    expect(vexOf(card("B", 6).triad)).toEqual({ keys: ["a/4", "c/5", "e/5"], accidentals: ["#", "#", null] });
    expect(card("G♭", 3).triad.midis).toEqual([59, 63, 66]); // C♭4 sounds as B3
  });

  it("comes round the circle of fifths from C, a step each way at a time", () => {
    expect(TRIAD_KEYS.map((k) => k.name)).toEqual(["C", "G", "F", "D", "B♭", "A", "E♭", "E", "A♭", "B", "D♭", "F♯", "G♭"]);
    expect(MINOR_KEYS.map((k) => k.name)).toEqual(["A", "E", "D", "B", "G", "F♯", "C", "C♯", "F", "G♯", "B♭", "D♯", "E♭"]);
    expect(TRIAD_CARDS).toHaveLength(13 * 7 * 8); // major and minor; named, which degree, two inversions
  });

  it("offers the answer, its root in the other quality and the degrees either side, the same way each turn", () => {
    const ii = card("F♯", 1); // G♯ B D♯
    const { choices, answer } = choicesFor(ii, 3);
    expect(choices[answer].triad!.notes).toEqual(["G♯", "B", "D♯"]);
    expect(choices.map((c) => c.triad!.notes.join(" ")).sort()).toEqual(["A♯ C♯ E♯", "F♯ A♯ C♯", "G♯ B D♯", "G♯ B♯ D♯"]);
    expect(new Set(choices.map((c) => c.triad!.notes.join())).size).toBe(4);
    expect(choicesFor(ii, 3)).toEqual({ choices, answer });
    const iii = choicesFor(card("F♯", 2), 0).choices.find((c) => c.triad!.quality === "major" && c.triad!.notes[0] === "A♯")!;
    expect(iii.triad!.notes).toEqual(["A♯", "C♯♯", "E♯"]);
    expect(pcOf("C♯♯")).toBe(2);
  });

  it("names notes and keys the German way when asked", () => {
    expect(["B", "B♭", "E♭", "A♭", "D♭", "F♯", "C♯♯", "B♯", "G"].map(germanName)).toEqual(["H", "B", "Es", "As", "Des", "Fis", "Cisis", "His", "G"]);
    expect([TRIAD_KEYS[4], MINOR_KEYS[5], MINOR_KEYS[3]].map((k) => keyName(k, "german"))).toEqual(["B-Dur", "fis-Moll", "h-Moll"]);
    expect(keyName(MINOR_KEYS[5], "english")).toBe("F♯ minor");
  });

  it("takes a minor key's V and vii° from the harmonic minor, and its III from the natural", () => {
    const minor = (k: string, d: number) => TRIAD_BY_ID.get(`triad:${k}m:${d}`)!;
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => minor("A", d).triad.notes.join(" "))).toEqual(["A C E", "B D F", "C E G", "D F A", "E G♯ B", "F A C", "G♯ B D"]);
    expect(minor("A", 4).roman).toBe("V");
    expect(minor("D♯", 1).triad.notes).toEqual(["E♯", "G♯", "B"]);
    expect(minor("E♭", 6).triad.notes).toEqual(["D", "F", "A♭"]);
  });

  it("turns a triad over for its inversions and asks which degree the other way round", () => {
    const first = TRIAD_BY_ID.get("triad:C:1:inv1")!;
    expect(first.triad).toMatchObject({ notes: ["F", "A", "D"], octaves: [4, 4, 5], root: "D" });
    expect(TRIAD_BY_ID.get("triad:C:1:inv2")!.triad.notes).toEqual(["A", "D", "F"]);
    const offered = choicesFor(first, 0).choices.map((c) => c.triad!.notes.join(" "));
    expect(offered).toContain("F A D");
    expect(offered).toContain("A D F"); // the same triad turned the other way
    const degree = TRIAD_BY_ID.get("triad:B♭:1:degree")!;
    const asked = choicesFor(degree, 2);
    expect(asked.choices[asked.answer].roman).toBe("ii");
    expect(asked.choices.map((c) => c.roman).sort()).toEqual(["I", "V", "ii", "iii"]);
    expect(asked.choices.every((c) => c.triad === null)).toBe(true);
  });

  it("climbs a box only for a quick right answer on a due card, and starts over on a miss", () => {
    const id = card("C", 4).id;
    let store = answerTriad(emptyTriads(), id, true, 1200, DAY);
    expect(store.cards[id]).toMatchObject({ box: 2, due: "2026-11-23", seen: 1, right: 1 });
    expect(answerTriad(store, id, true, 900, DAY).cards[id].box).toBe(2); // not due yet: practised, not promoted
    store = answerTriad(store, id, true, 900, "2026-11-23");
    expect(store.cards[id]).toMatchObject({ box: 3, due: "2026-11-26" });
    expect(answerTriad(store, id, true, 5000, "2026-11-26").cards[id].box).toBe(3); // right, but not yet instant
    expect(answerTriad(store, id, false, 800, "2026-11-26").cards[id]).toMatchObject({ box: 1, due: "2026-11-26" });
    expect(validTriadStore(store)).toBe(true);
    expect(validTriadStore({ v: 1, cards: { [id]: { box: 9, due: DAY, seen: 1, right: 1 } } })).toBe(false);
  });

  it("opens the next keys once most of C is known, and brings a miss back after a few other cards", () => {
    let store: TriadStore = emptyTriads();
    const drill = newDrill();
    const asked: string[] = [];
    const ask = (right: (id: string) => boolean) => {
      const next = nextTriad(store, drill, DAY);
      asked.push(next.id);
      drill.asked.set(next.id, drill.turn++);
      store = answerTriad(store, next.id, right(next.id), 1000, DAY);
    };
    const missed = card("C", 2).id;
    const wrongOnce = new Set([missed]);
    for (let i = 0; i < 6; i++) ask((id) => !wrongOnce.delete(id));
    expect(asked).toEqual(TRIAD_CARDS.slice(0, 6).map((c) => c.id)); // C: I, ii, iii (missed), IV, V, vi
    expect(openRings(store)).toBe(1);
    ask(() => true);
    expect(asked[6]).toBe(missed); // due again, three others since: before anything new
    ask(() => true);
    expect(asked[7]).toBe(card("C", 6).id);
    expect(openRings(store)).toBe(2);
    ask(() => true);
    expect(["G", "F"]).toContain(TRIAD_BY_ID.get(asked[8])!.key.name);
    // the same knowledge opens "which degree" in C beside it; minor waits for that
    expect(openMap(store).map((rings) => rings.filter(Boolean).length)).toEqual([2, 1, 0, 0, 0, 0]);
  });

  it("opens each layer's rings behind the layer before, a wave down the circle", () => {
    const known = (ids: string[]) => ids.reduce((s: TriadStore, id) => answerTriad(s, id, true, 900, DAY), emptyTriads());
    const ring = (layer: number, r: number) => TRIAD_CARDS.filter((c) => c.layer === layer && c.key.ring === r).map((c) => c.id);
    const store = known([...ring(0, 0), ...ring(0, 1), ...ring(1, 0)]);
    expect(openRings(store, 0)).toBe(3);
    expect(openRings(store, 1)).toBe(2); // its C is known and major knows G and F
    expect(openRings(store, 2)).toBe(1); // A minor, behind "which degree" in C
    expect(openRings(store, 3)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { answerTriad, emptyTriads, newDrill, nextTriad, openRings, validTriadStore, type TriadStore } from "../triads/box";
import { choicesFor, germanName, pcOf, TRIAD_BY_ID, TRIAD_CARDS, TRIAD_KEYS, vexOf } from "../triads/triads";

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
    expect(TRIAD_CARDS).toHaveLength(91);
  });

  it("offers the answer, its root in the other quality and the degrees either side, the same way each turn", () => {
    const ii = card("F♯", 1); // G♯ B D♯
    const { choices, answer } = choicesFor(ii, 3);
    expect(choices[answer].notes).toEqual(["G♯", "B", "D♯"]);
    expect(choices.map((c) => c.notes.join(" ")).sort()).toEqual(["A♯ C♯ E♯", "F♯ A♯ C♯", "G♯ B D♯", "G♯ B♯ D♯"]);
    expect(new Set(choices.map((c) => c.notes.join())).size).toBe(4);
    expect(choicesFor(ii, 3)).toEqual({ choices, answer });
    const iii = choicesFor(card("F♯", 2), 0).choices.find((c) => c.quality === "major" && c.notes[0] === "A♯")!;
    expect(iii.notes).toEqual(["A♯", "C♯♯", "E♯"]);
    expect(pcOf("C♯♯")).toBe(2);
  });

  it("names notes the German way when asked", () => {
    expect(["B", "B♭", "E♭", "A♭", "D♭", "F♯", "C♯♯", "B♯", "G"].map(germanName)).toEqual(["H", "B", "Es", "As", "Des", "Fis", "Cisis", "His", "G"]);
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
  });
});

import { describe, expect, it } from "vitest";
import type { ReadingBar, ReadingNote } from "../core/contract";
import { pickGlobalUnits, summarizeSong } from "../overview/summary";
import { nextUnits } from "../overview/summary";
import { songAccent, songMonogram } from "../overview/visual";
import { buildDeck, familiesOnly } from "../song/deck";
import { EAR_TIERS, earPhrase, scaleNotes } from "../song/ear";
import { seeded } from "../song/rand";
import type { Store } from "../song/leitner";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";

const note = (midi: number, startBeat: number): ReadingNote => ({
  rest: false,
  midi,
  vexKey: "a/4",
  accidental: null,
  duration: "q",
  dotted: false,
  startBeat,
  durationBeats: 1,
  string: 0,
  fret: 0,
});

function sheet(id = "test", title = "Test"): LeadSheet {
  const chords = ["Am", "Dm7", "E7", "Am"];
  const bars: ReadingBar[] = chords.map((chord, i) => ({
    barIndex: i,
    chordSymbols: [chord],
    chordBeats: [0],
    notes: [57, 60, 64, 60].map((midi, k) => note(midi, i * 4 + k)),
    beats: 4,
    section: i === 0 ? "A" : undefined,
  }));
  return {
    id,
    title,
    composer: "",
    keySignature: "Am",
    timeSignature: "4/4",
    tempo: 100,
    bars,
    barNumbers: chords.map((_, i) => String(i + 1)),
    comp: [],
    chordsFromVoicings: false,
  };
}

const emptyStore = (): Store => ({
  v: 1,
  cards: {},
  sessions: [],
  settings: { newPerSession: 4, guide: false, voice: false, window: null },
});

describe("tutor overview", () => {
  it("offers three unlocked next units, reviews first", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const store = emptyStore();
    expect(nextUnits(deck, store, 3, "2026-11-16")).toHaveLength(3);

    const due = deck.intro.find((id) => id.startsWith("mel:"))!;
    store.cards[due] = { box: 1, due: "2026-11-15", bpm: 70, seen: 1, clean: 0, last: "fail" };
    const next = nextUnits(deck, store, 3, "2026-11-16");
    expect(next[0]).toMatchObject({ id: due, status: "due" });
    expect(new Set(next.map((unit) => unit.id)).size).toBe(next.length);
  });

  it("summarizes a song's boxes and last session", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const store = emptyStore();
    const first = deck.intro[0];
    store.cards[first] = { box: 2, due: "2026-11-20", bpm: 72, seen: 1, clean: 1, last: "clean" };
    store.sessions = [{ date: "2026-11-15", minutes: 9, cards: 2, clean: 1 }];

    const summary = summarizeSong(s, deck, store, "2026-11-16");
    expect(summary).toMatchObject({
      tuneId: "test",
      title: "Test",
      key: "Am",
      lastPlayed: "2026-11-15",
      total: deck.intro.length,
    });
    expect(summary.boxes.reduce((n, count) => n + count, 0) + summary.fresh).toBe(summary.total);
    expect(summary.next).toHaveLength(3);
  });

  it("mixes the current song with other songs without repeating a card", () => {
    const one = sheet("one", "One");
    const two = sheet("two", "Two");
    const first = summarizeSong(one, buildDeck(one, buildTimeline(one)), emptyStore(), "2026-11-16");
    const second = summarizeSong(two, buildDeck(two, buildTimeline(two)), emptyStore(), "2026-11-16");

    const mixed = pickGlobalUnits([first, second], "one", 3);
    expect(mixed).toHaveLength(3);
    expect(mixed[0]).toMatchObject({ tuneId: "one", reason: "continue" });
    expect(mixed.some((unit) => unit.tuneId === "two")).toBe(true);
    expect(new Set(mixed.map((unit) => `${unit.tuneId}:${unit.id}`)).size).toBe(3);
  });

  it("narrows a deck to some families without leaving dangling dependencies", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const focused = familiesOnly(deck, ["chords", "harmony"]);
    expect(focused.cards.length).toBeGreaterThan(0);
    expect(focused.cards.every((card) => card.family === "chords" || card.family === "harmony")).toBe(true);
    const ids = new Set(focused.cards.map((card) => card.id));
    expect(focused.cards.every((card) => !card.needs || ids.has(card.needs))).toBe(true);
    expect(focused.intro.every((id) => ids.has(id))).toBe(true);
    expect(nextUnits(focused, emptyStore(), 3, "2026-11-16").every((unit) => unit.family === "chords" || unit.family === "harmony")).toBe(true);
  });

  it("gives songs a stable monogram and key accent", () => {
    expect(songMonogram("Autumn Leaves")).toBe("AL");
    expect(songMonogram("Take the A Train")).toBe("TT");
    expect(songAccent("Am")).toBe(songAccent("Am"));
    expect(songAccent("C")).not.toBe(songAccent("F#m"));
  });

  it("echo phrases stay in the home scale and range, within each tier's leap, and end on a stable tone", () => {
    const aMinor = [9, 11, 0, 2, 4, 5, 7];
    const pool = scaleNotes(aMinor, 52, 76);
    for (const tier of EAR_TIERS)
      for (let seed = 0; seed < 40; seed++) {
        const notes = earPhrase(aMinor, 9, 52, 76, tier, seeded(`t${tier.n}:${seed}`));
        expect(notes).toHaveLength(tier.notes);
        const at = notes.map((n) => pool.indexOf(n.midi));
        expect(at.every((i) => i >= 0)).toBe(true); // in the scale and the range
        for (let k = 1; k < at.length; k++) {
          expect(at[k]).not.toBe(at[k - 1]);
          expect(Math.abs(at[k] - at[k - 1])).toBeLessThanOrEqual(tier.leap);
        }
        expect([9, 0, 4]).toContain(notes[notes.length - 1].midi % 12); // A, C or E
      }
    const again = (n: number) => earPhrase(aMinor, 9, 52, 76, EAR_TIERS[1], seeded(`same:${n}`)).map((x) => x.midi);
    expect(again(1)).toEqual(again(1));
    expect(new Set([1, 2, 3, 4, 5, 6].map((n) => again(n).join())).size).toBeGreaterThan(1);
  });

  it("builds tiered echo cards from the tune's own key: the page helps first, then it is hidden", () => {
    const s = sheet();
    const deck = buildDeck(s, buildTimeline(s));
    const echoes = deck.cards.filter((card) => card.family === "ear");
    const tiers = EAR_TIERS.map((tier) => echoes.find((card) => card.id === `ear:${tier.n}`)!);
    expect(tiers.every(Boolean)).toBe(true);
    expect(tiers.map((card) => card.memory)).toEqual([false, false, true, true]);
    expect(tiers.map((card) => card.needs)).toEqual([undefined, "ear:1", "ear:2", "ear:3"]);
    for (const card of echoes) {
      expect(card.listen).toBe(true);
      // A natural minor only (the chord and other-key calls follow the tune's own chords and keys)
      if (!card.id.startsWith("ear:arp:") && !card.id.startsWith("ear:key:")) expect(card.tl.targets.every((t) => [9, 11, 0, 2, 4, 5, 7].includes(t.midi % 12))).toBe(true);
    }
    expect(deck.intro).toContain("ear:1");
    expect(familiesOnly(deck, ["ear"]).cards.every((card) => card.family === "ear")).toBe(true);
  });
});

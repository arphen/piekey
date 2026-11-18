import { describe, expect, it } from "vitest";
import type { ReadingBar, ReadingNote } from "../core/contract";
import { buildTimeline } from "../tunes/order";
import type { LeadSheet } from "../tunes/musicxml";
import { buildDeck, rhythmSourceId } from "../song/deck";
import { EAR_TIERS, earPhrase } from "../song/ear";
import { MAX_FRET } from "../song/fingering";
import { analyze, makeScale, parseChord } from "../song/harmony";
import { applyResult, planSession, type Store } from "../song/leitner";
import { seeded } from "../song/rand";
import { isolateRhythm, rhythmSheet } from "../song/rhythm";

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

/** Autumn Leaves' A section in A minor: ii–V–I to C, then iiø–V–i to Am. */
function sheet(): LeadSheet {
  const chords = ["Dm7", "G7", "Cmaj7", "Fmaj7", "Bm7b5", "E7", "Am", "Am"];
  const melody = [[60, 62, 64, 65], [71, 69, 67, 65], [64, 64, 64, 64], [69, 67, 65, 64], [62, 64, 65, 62], [68, 68, 71, 71], [69, 69, 69, 69], [69, 69, 69, 69]];
  const bars: ReadingBar[] = chords.map((c, i) => ({
    barIndex: i,
    chordSymbols: [c],
    chordBeats: [0],
    notes: melody[i].map((m, k) => note(m, i * 4 + k)),
    beats: 4,
    section: i === 0 ? "A" : undefined,
  }));
  return { id: "test", title: "Test", composer: "", keySignature: "Am", timeSignature: "4/4", tempo: 100, bars, barNumbers: chords.map((_, i) => String(i + 1)), comp: [], chordsFromVoicings: false };
}

describe("chord symbols", () => {
  it("reads qualities and what must ring", () => {
    expect(parseChord("Bm7b5")).toMatchObject({ kind: "hdim", seventh: 10, fifth: 6 });
    expect(parseChord("Ebmaj7")?.pcs).toEqual([3, 7, 10, 2]);
    expect(parseChord("Dm(maj7)")).toMatchObject({ kind: "min", seventh: 11 });
    expect(parseChord("Bb6")).toMatchObject({ kind: "maj", seventh: 9 });
    expect(parseChord("A7b9")).toMatchObject({ kind: "dom", seventh: 10 });
    expect(parseChord("C7")?.clash).toContain(3); // E♭ would make it minor
    expect(parseChord("N.C.")).toBeNull();
  });
});

describe("a tune's harmony", () => {
  const s = sheet();
  const tl = buildTimeline(s);
  const h = analyze(s, tl);

  it("finds the key, the scale per chord and the cadences", () => {
    expect(h.home.name).toBe("A minor");
    const scaleOf = (sym: string) => h.events.find((e) => e.chord.symbol === sym)?.scale.name;
    expect(scaleOf("Dm7")).toBe("A natural minor");
    expect(scaleOf("E7")).toBe("A harmonic minor");
    expect(h.cadences.map((c) => c.label)).toEqual(["ii–V–I in C major", "iiø–V–i in A minor"]);
  });

  it("builds playable cards inside the position", () => {
    const deck = buildDeck(s, tl);
    expect(new Set(deck.cards.map((c) => c.id)).size).toBe(deck.cards.length);
    expect(deck.intro).toHaveLength(deck.cards.length);
    for (const c of deck.cards) {
      expect(c.last).toBeGreaterThanOrEqual(c.first);
      for (const st of c.steps) if (st) expect(st.fret).toBeLessThanOrEqual(MAX_FRET);
      for (const v of c.voicings) if (v) expect(Math.max(...v.notes.map((n) => n.fret))).toBeLessThanOrEqual(MAX_FRET);
    }
    const run = deck.cards.find((c) => c.id === "scale:A-harmonicMinor:run")!;
    const midis = run.tl.targets.map((t) => t.midi);
    expect(midis[0] % 12).toBe(9);
    expect(midis[midis.length - 1]).toBe(midis[0]);
    expect(midis.map((m) => m % 12)).toContain(8); // G♯
    expect(midis.map((m) => m % 12)).not.toContain(7);
  });
});

describe("the card box", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));
  const card = deck.cards[0];

  it("moves cards up on a clean pass, back to box 1 on a miss", () => {
    const a = applyResult(undefined, card, "clean", card.bpm, "2026-11-13");
    expect(a).toMatchObject({ box: 2, due: "2026-11-14", bpm: card.bpm + 4 });
    const b = applyResult({ ...a, box: 4 }, card, "fail", card.bpm, "2026-11-13");
    expect(b).toMatchObject({ box: 1, due: "2026-11-13" });
    expect(applyResult(a, card, "ok", card.bpm, "2026-11-13").box).toBe(2);
  });

  it("plans due cards first, a few new ones, a scale card to warm up", () => {
    const store: Store = { v: 1, cards: {}, sessions: [], settings: { newPerSession: 3, guide: false, voice: false, window: null } };
    const first = planSession(deck, store, "2026-11-13");
    expect(first).toHaveLength(3);
    expect(deck.cards.find((c) => c.id === first[0])?.family).toBe("scales");
    store.cards[deck.intro[5]] = { box: 1, due: "2026-11-13", bpm: 60, seen: 1, clean: 0, last: "fail" };
    store.cards[deck.intro[6]] = { box: 3, due: "2026-11-20", bpm: 60, seen: 2, clean: 2, last: "clean" };
    const next = planSession(deck, store, "2026-11-13");
    expect(next).toContain(deck.intro[5]);
    expect(next).not.toContain(deck.intro[6]);
  });
});

describe("the selected phrase's rhythm", () => {
  it("preserves source rests, tied chains, fresh repeated attacks and repeated-bar playing order", () => {
    const s = sheet();
    s.bars = s.bars.slice(0, 2);
    s.barNumbers = ["1", "2"];
    s.bars[0].repeatStart = true;
    s.bars[1].repeatEnd = 2;
    s.bars[0].notes = [
      { ...note(0, 0), rest: true, duration: "8", durationBeats: 0.5 },
      { ...note(60, 0.5), duration: "8", durationBeats: 0.5 },
      { ...note(60, 1), tieToNext: true },
      { ...note(60, 2), duration: "8", durationBeats: 0.5 },
      { ...note(60, 2.5), duration: "8", durationBeats: 0.5 },
      note(64, 3),
    ];
    const source = buildTimeline(s);
    const isolated = isolateRhythm(source, 60);
    expect(isolated.slots.map((slot) => slot.bar)).toEqual([0, 1, 0, 1]);
    expect(isolated.targets.map(({ midi: _midi, any: _any, chord: _chord, ...target }) => target)).toEqual(source.targets.map(({ midi: _midi, ...target }) => target));
    expect(isolated.targets[0].t).toBe(0.5); // the opening rest stays a rest
    expect(isolated.targets[1]).toMatchObject({ t: 1, dur: 1.5, notes: [1, 2] });
    expect(isolated.targets[2].t).toBe(2.5); // untied same-pitch note is still a new attack
    expect(isolated.targets.every((target) => target.midi === 60)).toBe(true);
    expect(isolated.comp).toEqual([]);
    const written = rhythmSheet(s, 60);
    expect(written.bars.flatMap((bar) => bar.notes.map(({ rest, durationBeats, tieToNext }) => ({ rest, durationBeats, tieToNext })))).toEqual(s.bars.flatMap((bar) => bar.notes.map(({ rest, durationBeats, tieToNext }) => ({ rest, durationBeats, tieToNext }))));
    expect(buildTimeline(written).targets.map(({ t, dur, notes }) => ({ t, dur, notes }))).toEqual(source.targets.map(({ t, dur, notes }) => ({ t, dur, notes })));
  });

  it("adds only the explicitly requested source/context route with stable IDs", () => {
    const s = sheet();
    const tl = buildTimeline(s);
    const normal = buildDeck(s, tl);
    const phrase = normal.cards.find((card) => card.step?.kind === "new")!;
    const explicit = buildDeck(s, tl, { rhythmFrom: phrase.id });
    expect(normal.cards.some((card) => card.rhythmPitch !== undefined)).toBe(false);
    expect(explicit.cards).toHaveLength(normal.cards.length + 2);
    expect(explicit.intro.slice(0, normal.intro.length)).toEqual(normal.intro);
    const isolated = explicit.cards.find((card) => card.id === `rhythm:${phrase.id}`)!;
    const context = explicit.cards.find((card) => card.id === isolated.followedBy)!;
    expect([isolated.from, isolated.to, isolated.first, isolated.last]).toEqual([phrase.from, phrase.to, phrase.first, phrase.last]);
    expect(isolated.exact).toBe(true); // one detected pitch, never muted-string grading
    expect(context.tl).toEqual(phrase.tl);
    expect(context.tl.targets).toEqual(phrase.tl.targets);
    expect(context.needs).toBe(isolated.id);
    expect(rhythmSourceId(isolated.id)).toBe(phrase.id);
    expect(rhythmSourceId(context.id)).toBe(phrase.id);
    expect(rhythmSourceId(phrase.id)).toBeUndefined();
  });
});

describe("echo phrases", () => {
  it("keeps seeded calls in key with nonuniform rhythms and distinct repeated-note attacks", () => {
    const scale = makeScale(9, "naturalMinor", "A");
    for (const tier of EAR_TIERS) {
      const phrase = earPhrase(scale.pcs, 9, 48, 72, tier, seeded(`ear:${tier.n}`));
      expect(phrase).toEqual(earPhrase(scale.pcs, 9, 48, 72, tier, seeded(`ear:${tier.n}`)));
      expect(phrase).toHaveLength(tier.notes);
      expect(phrase.every((note) => scale.pcs.includes(note.midi % 12))).toBe(true);
      expect(new Set(phrase.map((note) => note.dur)).size).toBeGreaterThan(1);
      for (let i = 1; i < phrase.length; i++) expect(phrase[i].t).toBeCloseTo(phrase[i - 1].t + phrase[i - 1].dur);
      if (tier.n >= 2) expect(phrase.some((note, i) => i > 0 && note.midi === phrase[i - 1].midi && note.t > phrase[i - 1].t)).toBe(true);
      expect(new Set(phrase.map((note) => note.midi)).size).toBeGreaterThan(1);
      expect(phrase[phrase.length - 1].t + phrase[phrase.length - 1].dur).toBe(4);
    }
  });
});

describe("a line written out", () => {
  const s = sheet();
  const deck = buildDeck(s, buildTimeline(s));

  it("reads note for note like the card, in full bars", async () => {
    const { lineSheet } = await import("../song/notation");
    for (const card of deck.cards.filter((c) => c.view === "fretboard")) {
      const written = lineSheet(card, "Am");
      const heads = written.bars.flatMap((b) => b.notes.filter((n) => !n.rest));
      expect(heads.map((n) => n.midi)).toEqual(card.tl.targets.slice(card.first, card.last + 1).map((t) => t.midi));
      for (const b of written.bars) expect(b.notes.reduce((n, x) => n + x.durationBeats, 0)).toBeCloseTo(b.beats ?? 4, 2);
    }
    const run = lineSheet(deck.cards.find((c) => c.id === "scale:A-harmonicMinor:run")!, "Am");
    const heads = run.bars.flatMap((b) => b.notes.filter((n) => !n.rest));
    expect(heads[0].vexKey).toBe("a/3"); // sounding A2, written an octave up
    expect(heads.find((n) => n.vexKey.startsWith("g#"))?.accidental).toBe("#"); // not in the signature: written
  });
});

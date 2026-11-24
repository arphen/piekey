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
import { entrySubdivision } from "../tunes/usePlayback";
import { parsePassageId, passageId, passageLabel, passageOccurrences, passageTimeline } from "../tunes/passage";

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

describe("selected passages", () => {
  it("keeps exact repeated-bar occurrences outside the daily deck, with arrangement-qualified identity", () => {
    const s = sheet();
    s.bars = s.bars.slice(0, 3);
    s.barNumbers = ["1", "2", "3"];
    s.bars[0].repeatStart = true;
    s.bars[1].repeatEnd = 2;
    const tl = buildTimeline(s);
    const range = { start: 1, end: 2 };
    const id = passageId(s, range);
    const normal = buildDeck(s, tl);
    const explicit = buildDeck(s, tl, { passageFrom: id });
    const card = explicit.cards.find((item) => item.id === id)!;
    expect(tl.slots.map((slot) => slot.bar)).toEqual([0, 1, 0, 1, 2]);
    expect(passageOccurrences(s, tl).map((item) => item.occurrence)).toEqual([1, 1, 2, 2, 1]);
    expect(passageLabel(s, tl, range)).toBe("Bar 2 · occurrence 1 → bar 1 · occurrence 2 · playing order 2–3");
    expect(card).toMatchObject({ from: 1, to: 2, memory: false, run: false, family: "melody", view: "score" });
    expect(card.title).toBe("Bar 2 → bar 1 · playing order 2–3");
    expect(card.tl.slots).toBe(tl.slots);
    expect(card.tl.targets.slice(card.first, card.last + 1).map((target) => target.slot)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(explicit.intro).toEqual(normal.intro);
    expect(normal.cards.some((item) => item.id === id)).toBe(false);
    expect(passageId(s, range)).toBe(id);
    const changed = { ...s, bars: s.bars.map((bar, index) => index ? bar : { ...bar, notes: bar.notes.map((n) => ({ ...n, midi: n.midi + 1 })) }) };
    expect(passageId(changed, range)).not.toBe(id);
    expect(buildDeck(changed, buildTimeline(changed), { passageFrom: id }).cards.some((item) => item.id === id)).toBe(false);
    expect(parsePassageId(id)?.start).toBe(1);
    for (const invalid of ["mel:passage:bad:1-2", id.replace(":1-2", ":2-1"), id.replace(":1-2", ":0-4000"), `${id}:extra`]) expect(parsePassageId(invalid)).toBeNull();
  });

  it("rearticulates a held start and clips every voice at the exact end without mutating the source", () => {
    const s = sheet();
    s.bars = s.bars.slice(0, 3);
    s.barNumbers = ["1", "2", "3"];
    s.bars[0].notes = [{ ...note(60, 0), duration: "w", durationBeats: 4, tieToNext: true }];
    s.bars[1].notes = [{ ...note(60, 4), duration: "w", durationBeats: 4, tieToNext: true }];
    s.bars[2].notes = [{ ...note(60, 8), duration: "h", durationBeats: 2 }, { ...note(62, 10), duration: "h", durationBeats: 2 }];
    s.comp = [{ bar: 0, beat: 0, dur: 12, midis: [48, 52, 55] }];
    const tl = { ...buildTimeline(s), bass: [{ t: 0, dur: 12, midi: 36 }], guide: [{ t: 0, dur: 12, midi: 60 }] };
    const before = JSON.stringify(tl);
    const range = { start: 1, end: 1 };
    const selected = passageTimeline(s, tl, range);
    expect(selected.targets[0]).toMatchObject({ slot: 1, bar: 1, t: 4, dur: 4, notes: [1] });
    for (const voice of [selected.comp, selected.bass!, selected.guide!]) expect(voice[0]).toMatchObject({ t: 4, dur: 4 });
    const card = buildDeck(s, tl, { passageFrom: passageId(s, range) }).cards.find((item) => item.id.startsWith("mel:passage:"))!;
    expect(card).toMatchObject({ from: 1, to: 1, first: 0, last: 0 });
    expect(card.tl.targets[0]).toMatchObject({ t: 4, dur: 4 });
    expect(JSON.stringify(tl)).toBe(before);
    expect(() => passageTimeline(s, tl, { start: 2, end: 1 })).toThrow("Choose a passage");
    s.bars[1].notes = [{ ...note(0, 4), rest: true, duration: "w", durationBeats: 4 }];
    s.bars[0].notes[0].tieToNext = false;
    const rests = buildTimeline(s);
    expect(buildDeck(s, rests, { passageFrom: passageId(s, range) }).cards.some((item) => item.id.startsWith("mel:passage:"))).toBe(false);
  });
});

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
    expect(deck.intro).toHaveLength(deck.cards.filter((c) => !c.once).length);
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

  it("climbs tempo while capping long-term spacing until near goal, and decays gently on a miss", () => {
    const a = applyResult(undefined, card, "clean", card.bpm, "2026-11-13");
    expect(a).toMatchObject({ box: 2, due: "2026-11-14", bpm: card.bpm + 4 });
    // Still well below goalBpm: caps at box 3 (3-day speed-building spacing) and climbs +6 when far below
    const mid = applyResult({ ...a, box: 3 }, card, "clean", card.bpm, "2026-11-13");
    expect(mid.box).toBe(3);
    expect(mid.bpm).toBe(Math.min(card.goalBpm, card.bpm + 6));
    // Once near goalBpm (>= 90%), graduates cleanly into box 4 (7-day spacing)
    const fast = applyResult({ ...a, box: 3 }, card, "clean", card.goalBpm, "2026-11-13");
    expect(fast).toMatchObject({ box: 4, due: "2026-11-20" });
    // Soft decay on fail: steps back 2 boxes instead of wiping to box 1, and trims tempo slightly
    const b = applyResult({ ...a, box: 4, bpm: 80 }, card, "fail", 80, "2026-11-13");
    expect(b).toMatchObject({ box: 2, due: "2026-11-13", bpm: 76 });
    expect(applyResult(a, card, "ok", card.bpm, "2026-11-13").box).toBe(2);
  });

  it("includes holistic shared technique cards (spiders, pyramid, skips, shifting, enclosures) inside playable frets", () => {
    const tech = deck.cards.filter((c) => c.family === "technique");
    expect(tech.map((c) => c.kind)).toEqual(expect.arrayContaining(["spider", "pyramid", "skip", "shift", "enclose"]));
    for (const c of tech) {
      expect(c.id.startsWith("tech:")).toBe(true);
      expect(c.steps.every((st) => st !== null && st.fret <= MAX_FRET)).toBe(true);
    }
  });

  it("plans opening melody chunks first, then due cards, new ones, and a scale card to warm up", () => {
    const store: Store = { v: 1, cards: {}, sessions: [], settings: { newPerSession: 3, guide: false, voice: false, window: null } };
    const opening = planSession(deck, store, "2026-11-13");
    expect(opening.every((id) => deck.cards.find((c) => c.id === id)?.family === "melody")).toBe(true);
    const gate = deck.cards.find((c) => c.after)?.after;
    if (gate) store.cards[gate] = { box: 2, due: "2026-11-20", bpm: 72, seen: 1, clean: 1, last: "clean" };
    const first = planSession(deck, store, "2026-11-13");
    expect(first).toHaveLength(3);
    expect(deck.cards.find((c) => c.id === first[0])?.family).toBe("scales");
    store.cards[deck.intro[5]] = { box: 1, due: "2026-11-13", bpm: 60, seen: 1, clean: 0, last: "fail" };
    store.cards[deck.intro[6]] = { box: 3, due: "2026-11-20", bpm: 60, seen: 2, clean: 2, last: "clean" };
    const next = planSession(deck, store, "2026-11-13");
    expect(next).toContain(deck.intro[5]);
    expect(next).not.toContain(deck.intro[6]);
  });

  it("picks matching count-in subdivision for off-beat phrase entries", () => {
    expect(entrySubdivision(0)).toBe(1);
    expect(entrySubdivision(1)).toBe(1);
    expect(entrySubdivision(0.5)).toBe(2);
    expect(entrySubdivision(1.5)).toBe(2);
    expect(entrySubdivision(0.25)).toBe(4);
    expect(entrySubdivision(0.75)).toBe(4);
    expect(entrySubdivision(1 / 3)).toBe(3);
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

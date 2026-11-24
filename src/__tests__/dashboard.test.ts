// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildPracticeDashboard, explainScheduling } from "../overview/dashboard";
import { buildCatalog, filterCatalog } from "../tunes/catalog";
import { STARTER_ENTRY } from "../tunes/starter";
import { BLUE_HOUR_ENTRY } from "../tunes/demos";
import { parseTuneEntry } from "../tunes/library";
import { buildTimeline } from "../tunes/order";
import { buildDeck } from "../song/deck";
import { addDays, type Attempt, type Store } from "../song/leitner";
import type { SongSummary } from "../overview/summary";

function emptyStore(): Store {
  return {
    v: 1,
    cards: {},
    sessions: [],
    settings: { newPerSession: 4, guide: false, voice: false, window: null },
    history: [],
  };
}

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: "mel:new:0-1",
    day: "2026-11-24",
    result: "clean",
    bpm: 80,
    goalBpm: 90,
    share: 1,
    secs: 45,
    from: 1,
    to: 2,
    conditions: { v: 1, source: "measured", confidence: "unknown", tempo: "fixed", support: "none", notation: "visible" },
    ...overrides,
  };
}

describe("buildPracticeDashboard", () => {
  it("computes streaks, 84-day heatmap, deduplicated boxes and clean rate", () => {
    const day = "2026-11-24";
    const s1 = emptyStore();
    s1.sessions = [
      { date: addDays(day, -2), minutes: 15, cards: 4, clean: 3 },
      { date: addDays(day, -1), minutes: 25, cards: 6, clean: 5 },
      { date: day, minutes: 42, cards: 8, clean: 7 },
      { date: addDays(day, -10), minutes: 12, cards: 3, clean: 2 },
      { date: addDays(day, -9), minutes: 18, cards: 4, clean: 3 },
      { date: addDays(day, -8), minutes: 20, cards: 5, clean: 4 },
      { date: addDays(day, -7), minutes: 22, cards: 5, clean: 4 },
    ];
    s1.cards = {
      "mel:new:0-1": { box: 5, due: addDays(day, 10), seen: 6, clean: 5, last: "clean", bpm: 90 },
      "scale:C-major:run": { box: 3, due: day, seen: 3, clean: 2, last: "clean", bpm: 76 },
    };
    s1.history = [
      makeAttempt({ result: "clean" }),
      makeAttempt({ result: "clean" }),
      makeAttempt({ result: "ok" }),
      makeAttempt({ result: "fail", conditions: { v: 1, source: "self", confidence: "unknown" } }), // excluded from measured
    ];

    const s2 = emptyStore();
    // Same shared scale card should be deduplicated across stores
    s2.cards = {
      "scale:C-major:run": { box: 3, due: day, seen: 3, clean: 2, last: "clean", bpm: 76 },
      "sec:A:voicings": { box: 2, due: addDays(day, 2), seen: 2, clean: 1, last: "ok", bpm: 70 },
    };

    const dash = buildPracticeDashboard(
      [
        { tuneId: "tune-a", store: s1 },
        { tuneId: "tune-b", store: s2 },
      ],
      day,
    );

    expect(dash.totalMinutes).toBe(154);
    expect(dash.currentStreak).toBe(3);
    expect(dash.bestStreak).toBe(4);
    expect(dash.heatmap).toHaveLength(84);
    expect(dash.heatmap[83].day).toBe(day);
    expect(dash.heatmap[83].intensity).toBe(4);
    expect(dash.startedCards).toBe(3); // deduplicated shared scale
    expect(dash.masteredCards).toBe(1);
    expect(dash.dueCards).toBe(1);
    expect(dash.measuredAttempts).toBe(3);
    expect(dash.cleanRate).toBeCloseTo(2 / 3, 4);
    expect(dash.familyBreakdown.map((f) => f.family)).toEqual(["melody", "chords", "scales"]);
  });
});

describe("explainScheduling", () => {
  const sheet = parseTuneEntry(STARTER_ENTRY);
  const tl = buildTimeline(sheet);
  const deck = buildDeck(sheet, tl, {});
  const firstMelody = deck.cards.find((c) => c.family === "melody" && !c.run && !c.once && c.step?.kind !== "tune")!;

  it("explains consolidating vs cruising pacing zones from recent attempts", () => {
    const day = "2026-11-24";
    const struggling = emptyStore();
    struggling.history = Array.from({ length: 10 }, (_, i) =>
      makeAttempt({ id: firstMelody.id, day: addDays(day, -i), result: i < 4 ? "clean" : "fail" }),
    );
    const dash1 = buildPracticeDashboard([{ tuneId: sheet.id, store: struggling }], day);
    const exp1 = explainScheduling({ sheet, deck, store: struggling, profile: dash1.profile, day, arc: null });
    expect(exp1.pacingZone).toBe("consolidating");
    expect(exp1.newCardsPerSession).toBe(0);

    const cruising = emptyStore();
    cruising.history = Array.from({ length: 10 }, (_, i) =>
      makeAttempt({ id: firstMelody.id, day: addDays(day, -i), result: i === 0 ? "ok" : "clean" }),
    );
    const dash2 = buildPracticeDashboard([{ tuneId: sheet.id, store: cruising }], day);
    const exp2 = explainScheduling({ sheet, deck, store: cruising, profile: dash2.profile, day, arc: null });
    expect(exp2.pacingZone).toBe("cruising");
    expect(exp2.newCardsPerSession).toBe(6);
  });

  it("surfaces detected weaknesses, active focus arc day, and playable drill cards", () => {
    const day = "2026-11-24";
    const store = emptyStore();
    const opening = deck.cards.find((c) => c.after)?.after;
    if (opening) store.cards[opening] = { box: 2, due: addDays(day, 3), seen: 2, clean: 2, last: "clean", bpm: 72 };
    store.cards[firstMelody.id] = { box: 2, due: day, seen: 5, clean: 2, last: "ok", bpm: 72 };
    // Create strong leap-miss evidence (>20 leap notes, high miss rate compared to base)
    store.history = Array.from({ length: 6 }, (_, i) =>
      makeAttempt({
        id: firstMelody.id,
        day: addDays(day, -i),
        result: "ok",
        ev: {
          notes: [40, 6],
          leap: [6, 5],
          cross: [4, 0],
          shift: [2, 0],
          restarts: 0,
          hears: 0,
          wrong: [],
        },
      }),
    );

    const dash = buildPracticeDashboard([{ tuneId: sheet.id, store }], day);
    const arc = { cls: "leaps" as const, start: addDays(day, -2), strength: 0.7 };
    const exp = explainScheduling({ sheet, deck, store, profile: dash.profile, day, arc });

    expect(exp.focusKind).toBe("weakness-arc");
    expect(exp.arcDay).toBe(3);
    expect(exp.diagnoses.length).toBeGreaterThan(0);
    expect(exp.diagnoses[0].cls).toBe("leaps");
    expect(exp.diagnoses[0].isActiveArc).toBe(true);
    expect(exp.diagnoses[0].drillCardId).toBe(firstMelody.id);
    expect(exp.blocks.length).toBeGreaterThan(0);
  });
});

describe("Library catalog search & filtering", () => {
  it("indexes chords/keys and filters by search query, session membership and sort order", () => {
    const summaries: SongSummary[] = [
      {
        tuneId: STARTER_ENTRY.id,
        title: "First Steps",
        composer: "Original Study",
        key: "C",
        lastPlayed: "2026-11-20",
        boxes: [2, 1, 0, 0, 2],
        fresh: 0,
        due: 0,
        mastered: 2,
        total: 5,
        next: [],
        path: { ready: 1, total: 2, share: 0.5, milestones: [] },
      },
      {
        tuneId: BLUE_HOUR_ENTRY.id,
        title: "Blue Hour",
        composer: "Jazz Study",
        key: "C",
        lastPlayed: "2026-11-24",
        boxes: [1, 0, 0, 0, 0],
        fresh: 4,
        due: 0,
        mastered: 0,
        total: 5,
        next: [],
        path: { ready: 0, total: 2, share: 0, milestones: [] },
      },
    ];

    const catalog = buildCatalog(
      [STARTER_ENTRY, BLUE_HOUR_ENTRY],
      summaries,
      (id) => id === BLUE_HOUR_ENTRY.id,
    );

    expect(catalog).toHaveLength(2);
    expect(catalog.find((c) => c.id === BLUE_HOUR_ENTRY.id)?.hasChords).toBe(true);

    // Search by title
    expect(filterCatalog(catalog, "blue", "all", "title").map((c) => c.id)).toEqual([BLUE_HOUR_ENTRY.id]);
    // Filter by next session
    expect(filterCatalog(catalog, "", "session", "title").map((c) => c.id)).toEqual([BLUE_HOUR_ENTRY.id]);
    // Sort by progress puts higher mastery first
    expect(filterCatalog(catalog, "", "all", "progress").map((c) => c.id)).toEqual([STARTER_ENTRY.id, BLUE_HOUR_ENTRY.id]);
    // Sort by recent puts session-queued song first
    expect(filterCatalog(catalog, "", "all", "recent").map((c) => c.id)).toEqual([BLUE_HOUR_ENTRY.id, STARTER_ENTRY.id]);
  });
});

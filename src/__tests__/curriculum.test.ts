// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  alternatePositions,
  CUSTOM_EXERCISES_KEY,
  customExerciseToCard,
  customExerciseToSheet,
  deleteCustomExercise,
  guessExerciseHub,
  loadCustomExercises,
  newCustomExerciseId,
  quantizeRecordedOnsets,
  resolveExerciseSteps,
  saveCustomExercise,
  transposeCustomExercise,
  validCustomExerciseBook,
  type CustomExercise,
} from "../song/customExercises";
import {
  addCurriculumCustom,
  addCurriculumScale,
  buildCurriculumCards,
  CURRICULUM_KEY,
  CURRICULUM_STUDY_ID,
  curriculumCount,
  curriculumSheet,
  loadCurriculum,
  mergeCurriculumIntoDeck,
  removeCurriculumCustom,
  scaleCardOptionsForHub,
  toggleCurriculumFoundation,
  validCurriculumConfig,
} from "../song/curriculum";
import { buildDeck } from "../song/deck";
import { isShared } from "../song/ids";
import { loadStore, saveStore } from "../song/leitner";
import { planBlocks } from "../song/planner";
import { familyOf } from "../song/stats";
import { sessionLead } from "../components/PracticeRoom";
import { saveSessionSet } from "../song/sessionSet";
import { parseSyncSnapshot, syncableStorageKey } from "../sync/model";
import { createBackup, parseBackup } from "../tunes/backup";
import { BLUE_HOUR_ENTRY } from "../tunes/demos";
import { parseTuneEntry } from "../tunes/library";
import { buildTimeline } from "../tunes/order";

function sampleThirdsExercise(overrides: Partial<CustomExercise> = {}): CustomExercise {
  // C major scale in thirds in E shape around frets 7-10 (starting on C3=48 on E string fret 8)
  return {
    id: "custom:scales:c-thirds-e",
    title: "C major thirds · E shape",
    family: "scales",
    hub: "M0",
    shape: "E",
    p: 7,
    beatsPerBar: 4,
    bpm: 76,
    goalBpm: 120,
    notes: [
      { midi: 48, beats: 0.5, string: 5, fret: 8 },  // C3
      { midi: 52, beats: 0.5, string: 4, fret: 7 },  // E3
      { midi: 50, beats: 0.5, string: 5, fret: 10 }, // D3
      { midi: 53, beats: 0.5, string: 4, fret: 8 },  // F3
      { midi: 52, beats: 0.5, string: 4, fret: 7 },  // E3
      { midi: 55, beats: 0.5, string: 4, fret: 10 }, // G3
      { midi: 53, beats: 0.5, string: 4, fret: 8 },  // F3
      { midi: 57, beats: 0.5, string: 3, fret: 7 },  // A3
    ],
    createdAt: "2026-11-28",
    updatedAt: "2026-11-28",
    ...overrides,
  };
}

function stubStorage() {
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return kept.size; },
    key: (i: number) => [...kept.keys()][i] ?? null,
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => { kept.set(k, v); },
    removeItem: (k: string) => { kept.delete(k); },
    clear: () => { kept.clear(); },
  });
}

describe("custom exercises", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("preserves explicit string/fret fingerings in steps, score sheet, and playable SongCoach card", () => {
    const ex = sampleThirdsExercise();
    const steps = resolveExerciseSteps(ex);
    expect(steps).toHaveLength(8);
    expect(steps[0]).toMatchObject({ string: 5, fret: 8, midi: 48 });
    expect(steps[2]).toMatchObject({ string: 5, fret: 10, midi: 50 });

    const sheet = customExerciseToSheet(ex);
    expect(sheet.exercise.bars).toHaveLength(1);
    expect(sheet.exercise.keySignature).toBe("C");
    expect(sheet.exercise.timeSignature).toBe("4/4");
    expect(sheet.scoreToNoteIndex).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const card = customExerciseToCard(ex);
    expect(card).not.toBeNull();
    expect(card!.id).toBe(ex.id);
    expect(card!.view).toBe("fretboard");
    expect(card!.tl.targets).toHaveLength(8);
    expect(card!.steps[0]).toMatchObject({ string: 5, fret: 8, midi: 48 });
    expect(card!.bpm).toBe(76);
    expect(card!.goalBpm).toBe(120);
  });

  it("maps rests cleanly in customExerciseToSheet without breaking score-to-note click indexing", () => {
    const ex = sampleThirdsExercise({
      notes: [
        { midi: 60, beats: 1 },
        { midi: null, beats: 1 },
        { midi: 64, beats: 1 },
        { midi: 67, beats: 1 },
      ],
    });
    const sheet = customExerciseToSheet(ex);
    expect(sheet.scoreToNoteIndex).toEqual([0, 2, 3]);
    expect(sheet.noteToScoreIndex).toEqual([0, -1, 1, 2]);
    const card = customExerciseToCard(ex);
    expect(card!.tl.targets).toHaveLength(3);
    expect(card!.tl.targets[1].t).toBeCloseTo(2, 3);
  });

  it("transposes a custom exercise while keeping its exact geometric fret shape intact", () => {
    const cThirds = sampleThirdsExercise();
    // Transpose C major (E shape, fret 8) down 5 semitones to G major (E shape, fret 3)
    const gThirds = transposeCustomExercise(cThirds, -5, { newId: true, day: "2026-11-28" });
    expect(gThirds.id).not.toBe(cThirds.id);
    expect(gThirds.hub).toBe("M7");
    expect(gThirds.title).toContain("G major");
    expect(gThirds.p).toBe(2);
    expect(gThirds.notes[0]).toMatchObject({ midi: 43, string: 5, fret: 3 });
    expect(gThirds.notes[1]).toMatchObject({ midi: 47, string: 4, fret: 2 });
    expect(gThirds.notes[2]).toMatchObject({ midi: 45, string: 5, fret: 5 });
  });

  it("quantizes timed onset recordings into grid notes and rests", () => {
    // At 120 BPM, 1 beat = 500ms, 8th note = 250ms.
    const notes = quantizeRecordedOnsets(
      [
        { midi: 60, ms: 10 },   // beat 0
        { midi: 64, ms: 260 },  // beat 0.5
        { midi: 67, ms: 1010 }, // beat 2.0 (1 beat gap -> 8th note + rest or quarter + rest)
      ],
      120,
      0.5,
      4,
      5,
    );
    expect(notes.filter((n) => n.midi !== null).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(notes.reduce((sum, n) => sum + n.beats, 0)).toBeGreaterThanOrEqual(2);
  });

  it("persists, updates, deletes, and validates custom exercise books", () => {
    const ex = sampleThirdsExercise({ id: newCustomExerciseId("scales") });
    saveCustomExercise(ex);
    expect(loadCustomExercises()).toHaveLength(1);
    expect(loadCustomExercises()[0].title).toBe(ex.title);

    saveCustomExercise({ ...ex, title: "Updated thirds" });
    expect(loadCustomExercises()).toHaveLength(1);
    expect(loadCustomExercises()[0].title).toBe("Updated thirds");

    expect(validCustomExerciseBook({ v: 1, exercises: [ex] })).toBe(true);
    expect(validCustomExerciseBook({ v: 1, exercises: [{ id: "bad" }] })).toBe(false);

    deleteCustomExercise(ex.id);
    expect(loadCustomExercises()).toHaveLength(0);
  });

  it("lists alternate playable positions and guesses key hub cleanly", () => {
    const spots = alternatePositions(60, 5);
    expect(spots.length).toBeGreaterThanOrEqual(2);
    expect(spots.every((s) => s.fret >= 0 && s.fret <= 20)).toBe(true);
    expect(guessExerciseHub([60, 64, 62, 65, 64, 67, 65, 69, 71, 72])).toBe("M0");
  });

  it("treats custom exercises as shared skills across decks and maps family from ID", () => {
    expect(isShared("custom:scales:abc")).toBe(true);
    expect(familyOf("custom:scales:abc")).toBe("scales");
    expect(familyOf("custom:technique:abc")).toBe("technique");
    expect(familyOf("custom:melody:abc")).toBe("melody");

    const store = loadStore(CURRICULUM_STUDY_ID);
    store.cards["custom:scales:abc"] = { box: 3, due: "2026-12-01", bpm: 92, bestCleanBpm: 92, seen: 4, clean: 3, last: "clean" };
    saveStore(CURRICULUM_STUDY_ID, store);
    // Persisted into shared `guitar-skills`, so any other tune store sees it automatically.
    expect(loadStore("other-tune").cards["custom:scales:abc"]?.box).toBe(3);
  });
});

describe("unified curriculum, sync, backup, and planning", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("builds a curriculum deck from custom exercises, scales, and foundations and runs cleanly without songs", () => {
    const ex = sampleThirdsExercise();
    saveCustomExercise(ex);
    addCurriculumCustom(ex.id);
    const scaleChoices = scaleCardOptionsForHub("M7"); // G major
    const gThirdsId = scaleChoices.find((c) => c.label === "Thirds")!.id;
    addCurriculumScale(gThirdsId);
    toggleCurriculumFoundation("tech:spider:1234");

    const cur = loadCurriculum();
    expect(validCurriculumConfig(cur)).toBe(true);
    expect(curriculumCount([], cur, [ex])).toEqual({ songs: 0, custom: 1, scales: 1, foundations: 1, total: 3 });

    // With 0 songs in the curriculum, sessionLead routes Practice straight to CURRICULUM_STUDY_ID.
    saveSessionSet([]);
    expect(sessionLead([BLUE_HOUR_ENTRY])).toBe(CURRICULUM_STUDY_ID);

    const extraCards = buildCurriculumCards(cur, [ex]);
    expect(extraCards.map((c) => c.id)).toContain(ex.id);
    expect(extraCards.map((c) => c.id)).toContain(gThirdsId);
    expect(extraCards.map((c) => c.id)).toContain("tech:spider:1234");

    const host = curriculumSheet();
    const deck = mergeCurriculumIntoDeck(buildDeck(host, buildTimeline(host)), extraCards, true);
    expect(deck.cards).toHaveLength(3);
    const plan = planBlocks(deck, loadStore(CURRICULUM_STUDY_ID), "2026-11-28", { minutes: 25, tuneId: CURRICULUM_STUDY_ID });
    expect(plan.ids).toContain(ex.id);
    expect(plan.ids.length).toBeGreaterThanOrEqual(2);
  });

  it("weaves custom curriculum exercises into a mixed song session instead of starving them behind Bar 1", () => {
    const ex = sampleThirdsExercise();
    saveCustomExercise(ex);
    addCurriculumCustom(ex.id);

    const sheet = parseTuneEntry(BLUE_HOUR_ENTRY);
    const songDeck = buildDeck(sheet, buildTimeline(sheet));
    const merged = mergeCurriculumIntoDeck(songDeck, buildCurriculumCards(loadCurriculum(), [ex]), false);
    const plan = planBlocks(merged, loadStore(sheet.id), "2026-11-28", { minutes: 25, tuneId: sheet.id });
    expect(plan.ids).toContain(ex.id);
  });

  it("syncs and backs up custom exercises and curriculum config with strict validation", async () => {
    expect(syncableStorageKey(CUSTOM_EXERCISES_KEY)).toBe(true);
    expect(syncableStorageKey(CURRICULUM_KEY)).toBe(true);

    const ex = sampleThirdsExercise();
    saveCustomExercise(ex);
    addCurriculumCustom(ex.id);
    toggleCurriculumFoundation("tech:spider:1234");

    // Sync snapshot validation
    const snap = parseSyncSnapshot({
      format: "fretboard-focus-sync",
      version: 1,
      device: "dev-1",
      createdAt: "2026-11-28T12:00:00Z",
      transactions: [
        {
          v: 1,
          id: "dev-1:1",
          device: "dev-1",
          seq: 1,
          clock: 1,
          at: Date.now(),
          context: {},
          kind: "storage",
          key: CUSTOM_EXERCISES_KEY,
          before: null,
          after: localStorage.getItem(CUSTOM_EXERCISES_KEY),
        },
        {
          v: 1,
          id: "dev-1:2",
          device: "dev-1",
          seq: 2,
          clock: 2,
          at: Date.now(),
          context: { "dev-1": 1 },
          kind: "storage",
          key: CURRICULUM_KEY,
          before: null,
          after: localStorage.getItem(CURRICULUM_KEY),
        },
      ],
    });
    expect(snap.transactions).toHaveLength(2);

    // Backup round-trip validation
    const backup = await createBackup();
    expect(backup.storage[CUSTOM_EXERCISES_KEY]).toBeTruthy();
    expect(backup.storage[CURRICULUM_KEY]).toBeTruthy();
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.storage[CUSTOM_EXERCISES_KEY]).toBe(backup.storage[CUSTOM_EXERCISES_KEY]);

    removeCurriculumCustom(ex.id);
    expect(loadCurriculum().customIds).toEqual([]);
  });
});

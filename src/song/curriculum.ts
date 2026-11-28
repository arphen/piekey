import { useSyncExternalStore } from "react";
import { getStoredItem, setStoredItem } from "../storage";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";
import { buildDeck, findCard, type Card, type Deck } from "./deck";
import { customExerciseToCard, loadCustomExercises, type CustomExercise } from "./customExercises";
import { keyStudySheet, parseHubId, skillCardId } from "./keyStudy";
import type { ShapeBook } from "./scaleShapes";
import { TECHNIQUE_TRACKS } from "./technique";

// The player's unified curriculum: beyond songs (`guitar-session-set`), the player can add and
// remove custom recorded exercises, specific key scale drills, and built-in foundations.
// When launching Practice without picking a single song/node, Piekey practices *everything* in the
// curriculum together in one blended deck — even if no songs are in the curriculum at all.

export const CURRICULUM_KEY = "guitar-curriculum-v1";
export const CURRICULUM_STUDY_ID = "curriculum:studio";

export interface CurriculumConfig {
  v: 1;
  /** Active custom exercise IDs ("custom:..."). */
  customIds: string[];
  /** Active standalone scale card IDs ("scale:C-major:thirds", etc.). */
  scaleIds: string[];
  /** Active foundation track IDs ("tech:spider:1234", etc.). */
  foundationIds: string[];
}

export const EMPTY_CURRICULUM: CurriculumConfig = {
  v: 1,
  customIds: [],
  scaleIds: [],
  foundationIds: [],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const validIdList = (v: unknown, prefix: string, limit: number): v is string[] =>
  Array.isArray(v) && v.length <= limit && v.every((x) => typeof x === "string" && x.startsWith(prefix) && x.length <= 256);

export function validCurriculumConfig(v: unknown): v is CurriculumConfig {
  if (!isRecord(v) || v.v !== 1) return false;
  return validIdList(v.customIds, "custom:", 128)
    && validIdList(v.scaleIds, "scale:", 256)
    && validIdList(v.foundationIds, "tech:", 64);
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: { raw: string | null; config: CurriculumConfig } = { raw: null, config: EMPTY_CURRICULUM };

function read(): CurriculumConfig {
  let raw: string | null = null;
  try { raw = getStoredItem(CURRICULUM_KEY); } catch { /* empty fallback */ }
  if (raw === snapshot.raw) return snapshot.config;
  let config = EMPTY_CURRICULUM;
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (validCurriculumConfig(parsed)) config = parsed;
  } catch { /* empty fallback */ }
  snapshot = { raw, config };
  return config;
}

function write(config: CurriculumConfig): void {
  const clean: CurriculumConfig = {
    v: 1,
    customIds: [...new Set(config.customIds)],
    scaleIds: [...new Set(config.scaleIds)],
    foundationIds: [...new Set(config.foundationIds)],
  };
  try { setStoredItem(CURRICULUM_KEY, JSON.stringify(clean)); } catch { /* storage reports its own failure */ }
  listeners.forEach((l) => l());
}

export function loadCurriculum(): CurriculumConfig {
  return read();
}

export function saveCurriculum(config: CurriculumConfig): void {
  write(config);
}

export function subscribeCurriculum(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCurriculum(): CurriculumConfig {
  return useSyncExternalStore(subscribeCurriculum, read, read);
}

export function addCurriculumCustom(id: string): void {
  const cur = read();
  if (!cur.customIds.includes(id)) write({ ...cur, customIds: [...cur.customIds, id] });
}

export function removeCurriculumCustom(id: string): void {
  const cur = read();
  if (cur.customIds.includes(id)) write({ ...cur, customIds: cur.customIds.filter((x) => x !== id) });
}

export function toggleCurriculumCustom(id: string): void {
  const cur = read();
  const next = cur.customIds.includes(id) ? cur.customIds.filter((x) => x !== id) : [...cur.customIds, id];
  write({ ...cur, customIds: next });
}

export function toggleCurriculumScale(id: string): void {
  const cur = read();
  const next = cur.scaleIds.includes(id) ? cur.scaleIds.filter((x) => x !== id) : [...cur.scaleIds, id];
  write({ ...cur, scaleIds: next });
}

export function addCurriculumScale(id: string): void {
  const cur = read();
  if (!cur.scaleIds.includes(id)) write({ ...cur, scaleIds: [...cur.scaleIds, id] });
}

export function toggleCurriculumFoundation(id: string): void {
  const cur = read();
  const next = cur.foundationIds.includes(id) ? cur.foundationIds.filter((x) => x !== id) : [...cur.foundationIds, id];
  write({ ...cur, foundationIds: next });
}

export function isCurriculumStudyId(id: string | null | undefined): boolean {
  return id === CURRICULUM_STUDY_ID;
}

/** A lightweight virtual LeadSheet used as the room host when practicing a curriculum with no songs. */
export function curriculumSheet(title = "My Curriculum"): LeadSheet {
  const base = keyStudySheet("M0")!;
  return {
    ...base,
    id: CURRICULUM_STUDY_ID,
    title,
    composer: "Custom exercises, scales & foundations",
  };
}

const SCALE_NAME_TO_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, "C♯": 1, "D♭": 1,
  D: 2, "D#": 3, Eb: 3, "D♯": 3, "E♭": 3,
  E: 4, F: 5, "F#": 6, Gb: 6, "F♯": 6, "G♭": 6,
  G: 7, "G#": 8, Ab: 8, "G♯": 8, "A♭": 8,
  A: 9, "A#": 10, Bb: 10, "A♯": 10, "B♭": 10,
  B: 11, Cb: 11,
};

/** Resolve `"scale:D-naturalMinor:thirds"` -> hub `"m2"` so we can synthesize its deck card cleanly. */
export function hubForScaleCardId(cardId: string): string | null {
  const m = /^scale:([A-G][#b♯♭]?)-([a-zA-Z]+):/.exec(cardId);
  if (!m) return null;
  const pc = SCALE_NAME_TO_PC[m[1]];
  if (pc === undefined) return null;
  const minor = m[2] !== "major";
  return `${minor ? "m" : "M"}${pc}`;
}

export function labelForScaleCardId(cardId: string): { key: string; drill: string } {
  const m = /^scale:([A-G][#b♯♭]?)-([a-zA-Z]+):(.+)$/.exec(cardId);
  if (!m) return { key: "", drill: cardId };
  const root = m[1].replace("#", "♯").replace("b", "♭");
  const kindLabel = m[2] === "major" ? "major" : m[2] === "harmonicMinor" ? "harmonic minor" : "minor";
  const drillRaw = m[3].split("@")[0];
  const drillMap: Record<string, string> = {
    run: "Scale",
    "run:quarters": "Scale · quarters",
    "run:triplets": "Scale · triplets",
    "run:sixteenths": "Scale · 16ths",
    thirds: "Thirds",
    triads: "Diatonic triads",
    sevenths: "7th arpeggios",
  };
  return { key: `${root} ${kindLabel}`, drill: drillMap[drillRaw] ?? drillRaw };
}

/**
 * Build the extra cards contributed by the player's curriculum:
 * active custom exercises, standalone scale drills, and selected foundation tracks.
 * If `includeCustomId` is given (e.g. direct solo practice of a custom exercise), it is always included.
 */
export function buildCurriculumCards(
  config: CurriculumConfig,
  exercises: readonly CustomExercise[] = loadCustomExercises(),
  shapes?: ShapeBook,
  includeCustomId?: string,
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  const pushCard = (card: Card | null | undefined) => {
    if (!card || seen.has(card.id)) return;
    seen.add(card.id);
    cards.push(card);
  };

  // 1. Custom recorded exercises (in curriculum, plus any explicitly launched custom exercise)
  const wantedCustom = new Set(config.customIds);
  if (includeCustomId) wantedCustom.add(includeCustomId);
  for (const ex of exercises) {
    if (!wantedCustom.has(ex.id)) continue;
    pushCard(customExerciseToCard(ex));
  }

  // 2. Standalone scale drills (built via their key study deck, respecting the user's chosen CAGED/own shape)
  const byHub = new Map<string, string[]>();
  for (const scaleId of config.scaleIds) {
    const hub = hubForScaleCardId(scaleId);
    if (!hub) continue;
    byHub.set(hub, [...(byHub.get(hub) ?? []), scaleId]);
  }
  const hubDeckCache = new Map<string, Deck>();
  const deckForHub = (hub: string): Deck | null => {
    if (hubDeckCache.has(hub)) return hubDeckCache.get(hub)!;
    const sheet = keyStudySheet(hub);
    if (!sheet) return null;
    const deck = buildDeck(sheet, buildTimeline(sheet), { shapes });
    hubDeckCache.set(hub, deck);
    return deck;
  };
  for (const [hub, scaleIds] of byHub) {
    const d = deckForHub(hub);
    if (!d) continue;
    for (const id of scaleIds) {
      const found = findCard(d.cards, id);
      if (found) pushCard({ ...found, needs: undefined, after: undefined });
    }
  }

  // 3. Selected foundation tracks
  if (config.foundationIds.length > 0) {
    const wantedFound = new Set(config.foundationIds);
    const hubs = new Set(TECHNIQUE_TRACKS.filter((t) => wantedFound.has(t.id)).map((t) => t.hub));
    for (const hub of hubs) {
      const d = deckForHub(hub);
      if (!d) continue;
      for (const c of d.cards) {
        if (wantedFound.has(c.id)) {
          // Clear `needs` if prerequisite wasn't added to the curriculum so user-chosen tracks are immediately playable.
          const needs = c.needs && wantedFound.has(c.needs) ? c.needs : undefined;
          pushCard({ ...c, needs, after: undefined });
        }
      }
    }
  }

  return cards;
}

/** Merge curriculum cards cleanly into an existing deck (preserving existing song cards & adding custom/scale/foundation cards). */
export function mergeCurriculumIntoDeck(deck: Deck, extraCards: readonly Card[], replaceAll = false): Deck {
  if (!extraCards.length) return deck;
  if (replaceAll) {
    return {
      ...deck,
      cards: [...extraCards],
      intro: extraCards.map((c) => c.id),
    };
  }
  const have = new Set(deck.cards.map((c) => c.id));
  const added: Card[] = [];
  for (const c of extraCards) {
    if (have.has(c.id)) continue;
    have.add(c.id);
    added.push(c);
  }
  if (!added.length) return deck;
  // Interleave custom exercises near the front of `intro` so they are never starved behind a long song deck.
  const customIds = added.filter((c) => c.id.startsWith("custom:")).map((c) => c.id);
  const otherIds = added.filter((c) => !c.id.startsWith("custom:")).map((c) => c.id);
  const intro = [...deck.intro];
  // Insert custom exercises right after the first card (or at front if empty) and append scales/foundations early.
  const insertAt = Math.min(1, intro.length);
  intro.splice(insertAt, 0, ...customIds);
  const otherAt = Math.min(insertAt + customIds.length + 2, intro.length);
  intro.splice(otherAt, 0, ...otherIds);
  return {
    ...deck,
    cards: [...deck.cards, ...added],
    intro,
  };
}

/** How many active items exist in the player's total curriculum (songs + custom + scales + foundations). */
export function curriculumCount(
  songIds: readonly string[],
  config: CurriculumConfig,
  exercises: readonly CustomExercise[],
): { songs: number; custom: number; scales: number; foundations: number; total: number } {
  const validCustom = new Set(exercises.map((e) => e.id));
  const custom = config.customIds.filter((id) => validCustom.has(id)).length;
  const scales = config.scaleIds.length;
  const foundations = config.foundationIds.length;
  const songs = songIds.length;
  return { songs, custom, scales, foundations, total: songs + custom + scales + foundations };
}

/** Build a clean display summary like "2 songs · 3 exercises · 1 scale". */
export function curriculumSummaryLabel(counts: ReturnType<typeof curriculumCount>): string {
  const parts: string[] = [];
  if (counts.songs) parts.push(`${counts.songs} song${counts.songs === 1 ? "" : "s"}`);
  if (counts.custom) parts.push(`${counts.custom} exercise${counts.custom === 1 ? "" : "s"}`);
  if (counts.scales) parts.push(`${counts.scales} scale${counts.scales === 1 ? "" : "s"}`);
  if (counts.foundations) parts.push(`${counts.foundations} foundation${counts.foundations === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "empty curriculum";
}

export function scaleCardOptionsForHub(hub: string): { id: string; label: string }[] {
  if (!parseHubId(hub)) return [];
  const skills: [string, string][] = [
    ["run", "Scale"],
    ["thirds", "Thirds"],
    ["triads", "Diatonic triads"],
    ["sevenths", "7th arpeggios"],
    ["run:triplets", "Scale · triplets"],
    ["run:sixteenths", "Scale · 16ths"],
  ];
  return skills.flatMap(([skill, label]) => {
    const id = skillCardId(hub, skill);
    return id ? [{ id, label }] : [];
  });
}

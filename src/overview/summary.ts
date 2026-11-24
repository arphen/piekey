import { tunePath, type TunePath } from "./progress";
import type { Card, Deck, Family } from "../song/deck";
import { BOXES, boxCounts, today, unlocked, waiting, type Store } from "../song/leitner";
import type { LeadSheet } from "../tunes/musicxml";
import type { ReadingExercise } from "../core/contract";
import { goalDeck, goalProgress, type Goal } from "../song/goals";

// Read-only summaries for the tutor overview. Nothing here plans or mutates a session: the same
// deck/store data the session uses is projected into "what is next" for each song.

export type UnitStatus = "due" | "next" | "in-box" | "mastered";

export interface UnitPreview {
  id: string;
  family: Family;
  title: string;
  detail: string;
  group: string;
  where: string;
  bpm: number;
  box: number;
  status: UnitStatus;
}

export interface SongSummary {
  tuneId: string;
  title: string;
  composer: string;
  key: string;
  lastPlayed: string | null;
  boxes: number[];
  fresh: number;
  due: number;
  mastered: number;
  total: number;
  next: UnitPreview[];
  path: TunePath; // towards playing the tune whole
  excerpt?: Pick<ReadingExercise, "bars" | "keySignature" | "timeSignature">;
  tempo?: number;
  barCount?: number;
}

export type MixReason = "continue" | "due" | "next";

export interface MixedUnit extends UnitPreview {
  tuneId: string;
  tuneTitle: string;
  reason: MixReason;
}

const statusOf = (card: Card, store: Store, day: string): UnitStatus => {
  const state = store.cards[card.id];
  if (!state) return "next";
  if (state.due <= day) return "due";
  return state.box >= BOXES ? "mastered" : "in-box";
};

const preview = (card: Card, store: Store, day: string): UnitPreview => ({
  id: card.id,
  family: card.family,
  title: card.title,
  detail: card.detail,
  group: card.group,
  where: card.where,
  bpm: card.bpm,
  box: store.cards[card.id]?.box ?? 0,
  status: statusOf(card, store, day),
});

/** The next exercises for one song: due reviews, then unlocked new cards, then unfinished work. */
export function nextUnits(deck: Deck, store: Store, count = 3, day = today()): UnitPreview[] {
  const byId = new Map(deck.cards.map((card) => [card.id, card]));
  const order = new Map(deck.intro.map((id, index) => [id, index]));
  const picked: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    picked.push(id);
  };

  const due = deck.intro
    .filter((id) => store.cards[id] && store.cards[id].due <= day && !byId.get(id)?.once)
    .sort(
      (a, b) =>
        store.cards[a].box - store.cards[b].box ||
        store.cards[a].due.localeCompare(store.cards[b].due) ||
        (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );
  const fresh = deck.intro.filter((id) => !store.cards[id] && unlocked(byId.get(id), store) && !waiting(byId.get(id), store));

  for (const id of [...due, ...fresh]) add(id);

  // Not enough due/new material: show the next unlocked, unfinished cards in curriculum order.
  for (const id of deck.intro) {
    if (picked.length >= count) break;
    const state = store.cards[id];
    if ((!state || state.box < BOXES) && unlocked(byId.get(id), store)) add(id);
  }

  // Everything is mastered: offer reviews from the start of the curriculum.
  if (picked.length < count) for (const id of deck.intro) if (unlocked(byId.get(id), store)) add(id);

  return picked.slice(0, count).map((id) => preview(byId.get(id)!, store, day));
}

function goalUnits(deck: Deck, store: Store, goal: Goal, day: string): UnitPreview[] {
  const bounded = goalDeck(deck, goal);
  const byId = new Map(bounded.cards.map((card) => [card.id, card]));
  const demonstrated = new Set(goalProgress(goal, store).taskIds);
  const unfinished = goal.essentialTasks.filter((task) => !demonstrated.has(task.cardId));
  const picked = new Set<string>();
  const ready = (id: string, visited = new Set<string>()): string | null => {
    const card = byId.get(id);
    if (!card || visited.has(id)) return null;
    visited.add(id);
    return unlocked(card, store) ? id : card.needs ? ready(card.needs, visited) : null;
  };
  for (const task of unfinished.length ? unfinished : goal.essentialTasks) {
    const id = ready(task.cardId);
    if (id) picked.add(id);
    if (picked.size >= 3) break;
  }
  return [...picked].map((id) => {
    const card = byId.get(id)!;
    const bpm = Math.min(card.goalBpm, Math.max(goal.tempo.minBpm, store.cards[id]?.bpm ?? card.bpm));
    return preview({ ...card, bpm }, store, day);
  });
}

export function summarizeSong(sheet: LeadSheet, deck: Deck, store: Store, day = today(), goal?: Goal | null): SongSummary {
  const counts = boxCounts(deck, store);
  const lastPlayed = store.sessions[store.sessions.length - 1]?.date ?? store.history?.[store.history.length - 1]?.day ?? null;
  return {
    tuneId: sheet.id,
    title: sheet.title,
    composer: sheet.composer,
    key: sheet.keySignature,
    lastPlayed,
    boxes: counts.boxes,
    fresh: counts.fresh,
    due: counts.due,
    mastered: counts.boxes[BOXES - 1] ?? 0,
    total: deck.intro.length,
    next: goal ? goalUnits(deck, store, goal, day) : nextUnits(deck, store, 3, day),
    path: tunePath(deck, store),
    excerpt: { bars: sheet.bars.slice(0, 2), keySignature: sheet.keySignature, timeSignature: sheet.timeSignature },
    tempo: sheet.tempo ?? undefined,
    barCount: sheet.bars.length,
  };
}

/**
 * Three exercises across songs: the current song first, then an overdue review from another song,
 * then a new/different-family exercise. Deterministic; no shuffling.
 */
export function pickGlobalUnits(songs: SongSummary[], currentTuneId: string | null, count = 3): MixedUnit[] {
  const ordered = [...songs].sort((a, b) => {
    if (a.tuneId === currentTuneId) return -1;
    if (b.tuneId === currentTuneId) return 1;
    const at = a.lastPlayed ?? "";
    const bt = b.lastPlayed ?? "";
    if (at !== bt) return bt.localeCompare(at);
    return a.title.localeCompare(b.title);
  });

  const out: MixedUnit[] = [];
  const used = new Set<string>();
  const add = (song: SongSummary, unit: UnitPreview | undefined, reason: MixReason): boolean => {
    if (!unit || out.length >= count) return false;
    const key = `${song.tuneId}:${unit.id}`;
    if (used.has(key)) return false;
    used.add(key);
    out.push({ ...unit, tuneId: song.tuneId, tuneTitle: song.title, reason });
    return true;
  };

  const current = ordered.find((song) => song.tuneId === currentTuneId) ?? ordered[0];
  add(current, current?.next[0], "continue");

  for (const song of ordered) {
    if (out.length >= count) break;
    if (song.tuneId === current?.tuneId) continue;
    add(song, song.next.find((unit) => unit.status === "due"), "due");
  }

  const usedFamilies = new Set(out.map((unit) => unit.family));
  for (const song of ordered) {
    if (out.length >= count) break;
    if (song.tuneId === current?.tuneId) continue;
    const unit = song.next.find((u) => u.status !== "mastered" && !usedFamilies.has(u.family));
    if (unit && add(song, unit, "next")) usedFamilies.add(unit.family);
  }

  for (const song of ordered) for (const unit of song.next) add(song, unit, "next");

  return out;
}

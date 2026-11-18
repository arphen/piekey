import type { Card, Deck } from "../song/deck";
import { addDays, type Store } from "../song/leitner";

// Progress over weeks, for the overview: how far a tune is towards being played whole (its path),
// and how much playing there has been. Derived from demonstrated performances; nothing is stored.

const FINISH_TEMPO = 0.9; // of the card's goal tempo

export interface TuneMilestone {
  id: "sections" | "whole" | "memory" | "run";
  label: string;
  ready: boolean;
}

export interface TunePath {
  ready: number; // demonstrated performance milestones
  total: number;
  share: number; // 0..1
  milestones: TuneMilestone[];
}

/** Technique variants never enlarge the tune's performance goal. Suggested BPM is not evidence. */
export function tunePath(deck: Deck, store: Store): TunePath {
  const cards = deck.cards.filter((c) => c.family === "melody");
  const achieved = (card: Card) => (store.cards[card.id]?.bestCleanBpm ?? 0) >= card.goalBpm * FINISH_TEMPO
    || (store.history ?? []).some((a) => a.id === card.id && a.result === "clean" && Number.isFinite(a.bpm) && a.bpm >= card.goalBpm * FINISH_TEMPO);
  const sections = cards.filter((c) => c.step?.kind === "section");
  const whole = cards.filter((c) => c.step?.kind === "tune");
  const memory = cards.filter((c) => c.step?.kind === "memory");
  const run = cards.filter((c) => c.run);
  const playedWhole = [...whole, ...run].some(achieved);
  const milestones: TuneMilestone[] = [];
  if (sections.length) milestones.push({ id: "sections", label: "Sections connected", ready: playedWhole || sections.every(achieved) });
  if (whole.length) milestones.push({ id: "whole", label: "Whole tune", ready: playedWhole });
  if (memory.length) milestones.push({ id: "memory", label: "From memory", ready: memory.every(achieved) });
  if (run.length) milestones.push({ id: "run", label: "Run-through", ready: run.some(achieved) });
  const ready = milestones.filter((m) => m.ready).length;
  return { ready, total: milestones.length, share: milestones.length ? ready / milestones.length : 0, milestones };
}

/** Minutes played in each of the last `weeks` weeks, oldest first; the last week ends today. */
export function weeklyMinutes(stores: Store[], day: string, weeks = 4): number[] {
  const out = Array(weeks).fill(0) as number[];
  const start = addDays(day, -7 * weeks + 1);
  for (const s of stores)
    for (const e of s.sessions) {
      if (e.date < start || e.date > day) continue;
      const days = Math.round((Date.parse(e.date) - Date.parse(start)) / 86400000);
      out[Math.min(weeks - 1, Math.floor(days / 7))] += e.minutes;
    }
  return out;
}

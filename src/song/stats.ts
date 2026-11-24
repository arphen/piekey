import type { Family } from "./deck";
import { localId } from "./ids";
import { chronologicalAttempts, type Attempt, type SessionEntry, type Store } from "./leitner";

// Numbers over time, read off the card box: how one exercise has gone each time it was played,
// how the sessions have gone, and totals. Nothing here is stored; it is all derived.

/** An exercise's kind from its id alone, so a tune's box can be read without its deck. */
export function familyOf(id: string): Family {
  const own = localId(id);
  if (own.startsWith("scale:")) return "scales";
  if (own.startsWith("tech:")) return "technique";
  if (own.startsWith("mel:")) return "melody";
  if (own.startsWith("read:")) return "reading";
  if (own.startsWith("ear:")) return "ear";
  if (own.startsWith("fb:")) return "fretboard";
  return /:(voicings|comp24|charleston)$/.test(own) ? "chords" : "harmony";
}

export function attemptsOf(store: Store, id: string): Attempt[] {
  return chronologicalAttempts(store.history ?? []).filter((a) => a.id === id && a.result !== "skip");
}

export interface CardTrend {
  bpm: number[]; // the tempo each time, oldest first
  share: number[]; // notes landed each time, 0..1 (times without a number left out)
  plays: number;
  bpmDelta: number | null; // this time against the time before
  best: number | null; // fastest demonstrated clean tempo
}

export function cardTrend(store: Store, id: string, last = 10): CardTrend {
  const all = attemptsOf(store, id);
  const recent = all.slice(-last);
  const bpm = recent.map((a) => a.bpm);
  const clean = all.filter((a) => a.result === "clean" && a.bpm > 0 && Number.isFinite(a.bpm));
  const retained = store.cards[id]?.bestCleanBpm;
  const best = Math.max(typeof retained === "number" && Number.isFinite(retained) ? retained : 0, ...clean.map((a) => a.bpm));
  return {
    bpm,
    share: recent.map((a) => a.share).filter((x): x is number => x !== null),
    plays: all.length,
    bpmDelta: bpm.length >= 2 ? bpm[bpm.length - 1] - bpm[bpm.length - 2] : null,
    best: best > 0 ? best : null,
  };
}

export interface SessionPoint extends SessionEntry {
  cleanShare: number; // 0..1
}

export function sessionTrend(store: Store, last = 14): SessionPoint[] {
  return store.sessions.slice(-last).map((s) => ({ ...s, cleanShare: s.cards ? s.clean / s.cards : 0 }));
}

export function totals(store: Store): { sessions: number; minutes: number; cards: number; clean: number; days: number } {
  const s = store.sessions;
  return {
    sessions: s.length,
    minutes: s.reduce((n, x) => n + x.minutes, 0),
    cards: s.reduce((n, x) => n + x.cards, 0),
    clean: s.reduce((n, x) => n + x.clean, 0),
    days: new Set(s.map((x) => x.date)).size,
  };
}

/** Mean of the numbers that are there. */
export function meanShare(attempts: { share: number | null }[]): number | null {
  const xs = attempts.map((a) => a.share).filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

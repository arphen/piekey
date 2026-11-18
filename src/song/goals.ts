import { clearStorageError, getStoredItem, reportStorageError, setStoredItem } from "../storage";
import { validGoalData } from "../sync/model";
import type { LeadSheet } from "../tunes/musicxml";
import type { Card, Deck } from "./deck";
import type { Store } from "./leitner";

export type GoalKind = "melody" | "accompaniment" | "ear" | "reading" | "improv";
export interface Goal {
  v: 1;
  id: string;
  tuneId: string;
  arrangement: { version: 1; fingerprint: string };
  kind: GoalKind;
  tempo: { minBpm: number; targetBpm: number };
  essentialTasks: { cardId: string; targetBpm: number }[];
  createdAt: string;
}
export interface GoalStore {
  v: 1;
  byTune: Record<string, { activeId: string | null; goals: Record<string, Goal> }>;
}
export const GOAL_LABELS: Record<GoalKind, string> = {
  melody: "Play the melody", accompaniment: "Accompany the tune", ear: "Echo phrases by ear", reading: "Read fresh lines", improv: "Improvise over the changes",
};
export const GOALS_KEY = "guitar-goals-v1";
export const LOCAL_GOAL_LIMIT = 12;
const EMPTY: GoalStore = { v: 1, byTune: {} };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let snapshot = EMPTY;
let valid = true;

/** A versioned musical change detector, independent of display position and chosen fingering. */
export function arrangementIdentity(sheet: LeadSheet): Goal["arrangement"] {
  const music = JSON.stringify([
    sheet.keySignature, sheet.timeSignature, sheet.tempo, sheet.source?.partId ?? null, sheet.source?.voice ?? null,
    sheet.barNumbers,
    sheet.bars.map((bar) => [bar.barIndex, bar.beats, bar.chordSymbols, bar.chordBeats, bar.repeatStart, bar.repeatEnd,
      bar.volta, bar.section, bar.tempo, bar.keyChange, bar.timeChange, bar.jumps,
      bar.notes.map(({ string: _string, fret: _fret, ...note }) => note)]),
    sheet.comp.map((event) => [event.bar, event.beat, event.dur, event.midis]),
  ]);
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < music.length; i++) {
    a = Math.imul(a ^ music.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ music.charCodeAt(i);
  }
  return { version: 1, fingerprint: `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${music.length}` };
}

function route(deck: Deck, kind: GoalKind): Card[] {
  const byId = new Map(deck.cards.map((card) => [card.id, card]));
  const cards = deck.intro.map((id) => byId.get(id)).filter((card): card is Card => Boolean(card));
  if (kind === "melody") {
    const final = cards.filter((card) => card.step?.kind === "tune" || card.run);
    return [...cards.filter((card) => card.family === "melody" && ["new", "join", "section"].includes(card.step?.kind ?? "")).slice(0, 12 - final.length), ...final].slice(0, 12);
  }
  if (kind === "accompaniment") return cards.filter((card) => card.id.startsWith("sec:") && (card.kind === "voicings" || card.id.endsWith(":comp24"))).slice(0, 12);
  if (kind === "ear") return cards.filter((card) => card.id === "ear:1" || card.id === "ear:2" || card.id.startsWith("ear:tune:")).slice(0, 12);
  if (kind === "reading") return cards.filter((card) => card.kind === "line").slice(0, 12);
  return cards.filter((card) => card.id.startsWith("sec:") && card.kind === "improv").slice(0, 12);
}

function newGoalId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Freeze the chosen route now; future optional deck variants cannot enlarge it. */
export function createGoal(sheet: LeadSheet, deck: Deck, options: { kind: GoalKind; minBpm: number; targetBpm: number }): Goal {
  const tasks = route(deck, options.kind);
  if (!tasks.length) throw new Error(`This score has no tasks for “${GOAL_LABELS[options.kind]}”. Choose another outcome.`);
  const goal: Goal = {
    v: 1, id: newGoalId(), tuneId: sheet.id, arrangement: arrangementIdentity(sheet), kind: options.kind,
    tempo: { minBpm: options.minBpm, targetBpm: options.targetBpm },
    essentialTasks: tasks.map((card) => ({ cardId: card.id, targetBpm: options.targetBpm })),
    createdAt: new Date().toISOString(),
  };
  if (!validGoalData({ v: 1, byTune: { [sheet.id]: { activeId: goal.id, goals: { [goal.id]: goal } } } }))
    throw new Error("Choose an available outcome and tempos from 30 to 240 BPM, with the starting tempo no higher than the target.");
  return goal;
}

/** A stable external-store snapshot. Invalid data is retained for recovery, never overwritten. */
export function getGoals(): GoalStore {
  let raw: string | null | undefined;
  try {
    raw = getStoredItem(GOALS_KEY);
    if (raw === cachedRaw) return snapshot;
    cachedRaw = raw;
    const parsed: unknown = raw === null ? EMPTY : JSON.parse(raw);
    if (!validGoalData(parsed)) throw new Error("Invalid goals");
    snapshot = parsed as GoalStore;
    valid = true;
    clearStorageError(`${GOALS_KEY}-read`);
  } catch (error) {
    // A transient denied read must not cache an empty snapshot against a previously valid value.
    if (raw === undefined) cachedRaw = undefined;
    valid = false;
    snapshot = EMPTY;
    reportStorageError(`${GOALS_KEY}-read`, error, "Saved musical goals could not be read. Export a backup before repairing browser data. Existing goals have been kept.");
  }
  return snapshot;
}

function notify() { listeners.forEach((listener) => listener()); }
function storageChanged(event: StorageEvent) {
  if (event.key === GOALS_KEY || event.key === null) { getGoals(); notify(); }
}
export function subscribeGoals(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener("storage", storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}
function writeGoals(next: GoalStore): boolean {
  if (!validGoalData(next)) {
    reportStorageError(`${GOALS_KEY}-write`, new Error("Goal limit or shape"), "This goal could not be saved. Portable goal history is limited to 256 goals per tune and 128 tunes.");
    return false;
  }
  clearStorageError(`${GOALS_KEY}-write`);
  const saved = setStoredItem(GOALS_KEY, JSON.stringify(next));
  getGoals();
  notify();
  return saved;
}
export function saveGoal(goal: Goal): boolean {
  const current = getGoals();
  if (!valid) return false;
  const bucket = current.byTune[goal.tuneId] ?? { activeId: null, goals: {} };
  const existing = bucket.goals[goal.id];
  if (!existing && Object.keys(bucket.goals).length >= LOCAL_GOAL_LIMIT) {
    reportStorageError(`${GOALS_KEY}-write`, new Error("Local goal limit"), "This tune has reached its local goal creation limit. Select an existing goal; imported goal histories have been kept.");
    return false;
  }
  if (existing && JSON.stringify(existing) !== JSON.stringify(goal)) return false;
  return writeGoals({ ...current, byTune: { ...current.byTune, [goal.tuneId]: { activeId: goal.id, goals: { ...bucket.goals, [goal.id]: goal } } } });
}
export function setActiveGoal(tuneId: string, id: string | null): boolean {
  const current = getGoals();
  if (!valid) return false;
  const bucket = current.byTune[tuneId];
  if (!bucket || (id !== null && !Object.prototype.hasOwnProperty.call(bucket.goals, id))) return false;
  return writeGoals({ ...current, byTune: { ...current.byTune, [tuneId]: { ...bucket, activeId: id } } });
}
export function goalMatches(sheet: LeadSheet, deck: Deck, goal: Goal): boolean {
  return goal.tuneId === sheet.id && goal.arrangement.fingerprint === arrangementIdentity(sheet).fingerprint
    && goal.essentialTasks.every((task) => deck.cards.some((card) => card.id === task.cardId));
}
export function loadActiveGoal(sheet: LeadSheet, deck: Deck): Goal | null {
  const bucket = getGoals().byTune[sheet.id];
  const goal = bucket?.activeId ? bucket.goals[bucket.activeId] : null;
  return goal && goalMatches(sheet, deck, goal) ? goal : null;
}
/** Session tempos follow the learner's target without rewriting imported score tempo or cards. */
export function goalDeck(deck: Deck, goal: Goal | null): Deck {
  if (!goal) return deck;
  const tasks = new Map(goal.essentialTasks.map((task) => [task.cardId, task.targetBpm]));
  return { ...deck, cards: deck.cards.map((card) => {
    const target = tasks.get(card.id) ?? goal.tempo.targetBpm;
    return { ...card, bpm: Math.min(target, Math.max(goal.tempo.minBpm, card.bpm)), goalBpm: target };
  }) };
}

/** Lifetime card boxes/tempos do not identify an arrangement; count actual takes since this goal. */
export function goalProgress(goal: Goal, store: Store): { demonstrated: number; total: number; lastPlayed: string | null; taskIds: string[]; evidenceKind: "tempo" | "echo" } {
  const since = Date.parse(goal.createdAt);
  const targets = new Map(goal.essentialTasks.map((task) => [task.cardId, task.targetBpm]));
  const met = new Set<string>();
  let latest = 0;
  for (const attempt of store.history ?? []) {
    const target = targets.get(attempt.id);
    if (target === undefined || !attempt.at || attempt.at < since || attempt.arrangementFingerprint !== goal.arrangement.fingerprint) continue;
    latest = Math.max(latest, attempt.at);
    if (attempt.conditions?.source !== "measured" || attempt.result !== "clean") continue;
    // An echo is checked at the player's own pace. Its configured BPM describes the call only.
    if (goal.kind === "ear") { met.add(attempt.id); continue; }
    const timed = attempt.conditions.tempo === "fixed" || attempt.conditions.tempo === "adaptive";
    if (timed && (attempt.ev?.time?.n ?? 0) > 0 && Number.isFinite(attempt.bpm) && attempt.bpm >= target) met.add(attempt.id);
  }
  return { demonstrated: met.size, total: targets.size, lastPlayed: latest ? new Date(latest).toISOString() : null, taskIds: [...met], evidenceKind: goal.kind === "ear" ? "echo" : "tempo" };
}

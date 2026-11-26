import type { Deck, Focus } from "./deck";
import type { SessionPlan } from "./planner";
import type { Outcome } from "./useSession";

// Device-local checkpoint of an unfinished practice session so closing the room, stopping early,
// or reloading the browser lets the player pick up right where they left off. Completed exercises
// already persist to the Leitner store and sync journal individually; this only stores the queue
// cursor, session progress log, and elapsed-time counters for this device.

export const PARTIAL_SESSION_KEY = "guitar-partial-sessions-v1";
const MAX_SAVED_SESSIONS = 6;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionSnapshot {
  queue: string[];
  pos: number;
  log: Outcome[];
  selfGuided: boolean;
  activeMs: number;
  recordedOutcomes: number;
  recordedMs: number;
}

export interface PartialSession extends SessionSnapshot {
  v: 1;
  tuneId: string;
  focus: Focus;
  savedAt: number;
  day: string;
  blocks: SessionPlan["blocks"];
  gapIds: string[];
}

export const partialSessionKey = (tuneId: string, focus: Focus): string => `${tuneId}\u0000${focus}`;

function validSession(value: unknown): value is PartialSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<PartialSession>;
  return (
    s.v === 1 &&
    typeof s.tuneId === "string" &&
    s.tuneId.length > 0 &&
    typeof s.focus === "string" &&
    typeof s.savedAt === "number" &&
    Number.isFinite(s.savedAt) &&
    typeof s.day === "string" &&
    Array.isArray(s.queue) &&
    s.queue.every((id) => typeof id === "string") &&
    typeof s.pos === "number" &&
    Number.isInteger(s.pos) &&
    s.pos >= 0 &&
    s.pos < s.queue.length &&
    Array.isArray(s.log) &&
    Array.isArray(s.blocks) &&
    Array.isArray(s.gapIds) &&
    typeof s.selfGuided === "boolean" &&
    typeof s.activeMs === "number" &&
    Number.isFinite(s.activeMs) &&
    s.activeMs >= 0 &&
    typeof s.recordedOutcomes === "number" &&
    Number.isInteger(s.recordedOutcomes) &&
    s.recordedOutcomes >= 0 &&
    typeof s.recordedMs === "number" &&
    Number.isFinite(s.recordedMs) &&
    s.recordedMs >= 0
  );
}

function readAll(now = Date.now()): Record<string, PartialSession> {
  try {
    const raw = localStorage.getItem(PARTIAL_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, PartialSession> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (validSession(v) && now - v.savedAt <= MAX_AGE_MS && (v.pos > 0 || v.log.length > 0)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(entries: Record<string, PartialSession>): void {
  try {
    const trimmed = Object.entries(entries)
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, MAX_SAVED_SESSIONS);
    if (!trimmed.length) localStorage.removeItem(PARTIAL_SESSION_KEY);
    else localStorage.setItem(PARTIAL_SESSION_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // convenience only: ignore quota or unavailable storage
  }
}

export function loadPartialSession(tuneId: string, focus: Focus, now = Date.now()): PartialSession | null {
  const all = readAll(now);
  return all[partialSessionKey(tuneId, focus)] ?? null;
}

export function savePartialSession(session: PartialSession): void {
  if (session.pos >= session.queue.length || (session.pos === 0 && session.log.length === 0)) {
    clearPartialSession(session.tuneId, session.focus);
    return;
  }
  const all = readAll(session.savedAt);
  all[partialSessionKey(session.tuneId, session.focus)] = session;
  writeAll(all);
}

export function clearPartialSession(tuneId: string, focus: Focus): void {
  const all = readAll();
  const key = partialSessionKey(tuneId, focus);
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
}

/**
 * Reconciles a saved partial session against the current deck (for example if a mixed guest tune
 * was removed or toggled off). Returns null if no unfinished exercises remain.
 */
export function resolvePartialSession(saved: PartialSession | null, deck: Deck): PartialSession | null {
  if (!saved) return null;
  const valid = new Set(deck.cards.map((c) => c.id));
  const queue: string[] = [];
  const indexMap = new Map<number, number>();
  let pos = 0;
  saved.queue.forEach((id, i) => {
    if (!valid.has(id)) return;
    indexMap.set(i, queue.length);
    queue.push(id);
    if (i < saved.pos) pos++;
  });
  if (!queue.length || pos >= queue.length || (pos === 0 && saved.log.length === 0)) return null;
  const keptSet = new Set(queue);
  const log = saved.log.map((entry) => ({ ...entry, at: indexMap.get(entry.at) ?? -1 }));
  const blocks = saved.blocks
    .map((block) => ({ ...block, cards: block.cards.filter((id) => keptSet.has(id)) }))
    .filter((block) => block.cards.length > 0);
  const gapIds = saved.gapIds.filter((id) => keptSet.has(id));
  return {
    ...saved,
    queue,
    pos,
    log,
    blocks,
    gapIds,
    recordedOutcomes: Math.min(saved.recordedOutcomes, log.length),
  };
}

export function partialSessionProgress(saved: PartialSession): { done: number; total: number; remaining: number } {
  const total = saved.queue.length;
  const done = Math.min(total, Math.max(0, saved.pos));
  return { done, total, remaining: Math.max(0, total - done) };
}

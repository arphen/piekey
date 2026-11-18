import { projectTransactions } from "../sync/merge";
import { addedRows, canonical, isRecord, parseSyncSnapshot, type SyncTransaction } from "../sync/model";
import { isShared } from "./ids";
import { chronologicalAttempts, type Attempt, type Store } from "./leitner";

export interface PracticeTempoPoint {
  attempt: Attempt;
  day: string;
  at: number | null;
  bpm: number;
  arrangementFingerprint: string | null;
  /** Equal recorded conditions permit a connecting line. Missing context permits dots only;
   * even matching keys describe app observations, not an independent performance test. */
  comparisonKey: string | null;
}

export interface ExerciseHistory {
  cardId: string;
  /** Oldest first. Day-only legacy rows retain their stored order within that day;
   * rows without a valid calendar day come last and have no chart position. */
  attempts: Attempt[];
  measured: Attempt[];
  selfGuided: Attempt[];
  skipped: Attempt[];
  unknown: Attempt[];
  tempo: PracticeTempoPoint[];
}

export type PracticeStoreProjection = { status: "ready"; store: Store }
  | { status: "unavailable" | "conflicted" };
export type PracticeHistoryResult = {
  status: "ready";
  tuneId: string;
  excludesSharedSkills: true;
  store: Store;
  exercises: ExerciseHistory[];
} | { status: "unavailable" | "too-large" | "conflicted" };

/** Replay deduplicates immutable UIDs. Check their contents before it can suppress a
 * conflicting row; UID-less legacy rows remain a multiset, without inferred provenance. */
function attemptIdentities() {
  const known = new Map<string, string>();
  return (rows: readonly unknown[]): boolean => rows.some((row) => {
    if (!isRecord(row) || typeof row.uid !== "string") return false;
    const content = canonical(row), previous = known.get(row.uid);
    if (previous !== undefined && previous !== content) return true;
    known.set(row.uid, content);
    return false;
  });
}

function historyOf(raw: string | null): unknown[] {
  const value: unknown = raw === null ? null : JSON.parse(raw);
  return isRecord(value) && Array.isArray(value.history) ? value.history : [];
}

/** The complete captured tune group, never a lifetime claim or a source for planner writes. */
export function projectPracticeStore(tuneId: string, transactions: readonly SyncTransaction[]): PracticeStoreProjection {
  try {
    if (!tuneId || tuneId.length > 512) return { status: "unavailable" };
    const key = `guitar-song-deck:${tuneId}`;
    const target = transactions.filter((entry) => entry.kind === "storage" && entry.key === key);
    const checked = parseSyncSnapshot({ format: "fretboard-focus-sync", version: 1, device: "practice-history", createdAt: "", transactions: target }).transactions;
    const conflicting = attemptIdentities();
    for (const tx of checked) {
      const before = historyOf(tx.before), after = historyOf(tx.after);
      if (conflicting(before) || conflicting(after)) return { status: "conflicted" };
      if (!tx.baseline && !tx.reset && tx.after !== null) {
        // The normal projector assigns IDs to added legacy rows. Check that namespace
        // too, so an explicit UID cannot silently hide a different legacy observation.
        const additions = addedRows(before, after).map((row, index) => isRecord(row) && typeof row.uid !== "string"
          ? { ...row, uid: `${tx.id}:attempt:${index}` } : row);
        if (conflicting(additions)) return { status: "conflicted" };
      }
    }
    const projection = projectTransactions(checked);
    if (projection.conflicts.length) return { status: "conflicted" };
    const raw = projection.storage.get(key);
    // A valid sparse delta is not necessarily a complete practice store. Its missing
    // baseline cannot certify a negative result, so validate the complete projection too.
    if (raw) parseSyncSnapshot({ format: "fretboard-focus-sync", version: 1, device: "projection", createdAt: "", transactions: [{
      v: 1, id: "projection:1", device: "projection", seq: 1, clock: 1, at: 0, context: {}, kind: "storage", key, before: null, after: raw,
    }] });
    const store: Store = raw ? JSON.parse(raw) as Store : { v: 1, cards: {}, history: [], sessions: [], settings: { newPerSession: 4, guide: false, voice: false, window: null } };
    if (conflicting(store.history ?? [])) return { status: "conflicted" };
    return { status: "ready", store };
  } catch {
    return { status: "unavailable" };
  }
}

function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function comparisonKey(attempt: Attempt): string | null {
  const c = attempt.conditions;
  if (!attempt.arrangementFingerprint || !c || c.support === undefined || c.notation === undefined
    || c.tempo === undefined || c.exposure === undefined || c.uninterrupted === undefined) return null;
  return JSON.stringify([attempt.arrangementFingerprint, c.source, c.support, c.notation, c.tempo, c.exposure, c.uninterrupted, c.confidence]);
}

/** Group actual tune-local observations. Shared scales have a cross-tune identity and are
 * intentionally absent; a tune journal alone cannot establish their complete history. */
export function groupPracticeHistory(store: Store): ExerciseHistory[] {
  const seen = new Set<string>();
  const retained = (store.history ?? []).filter((attempt) => {
    if (isShared(attempt.id)) return false;
    if (!attempt.uid) return true;
    if (seen.has(attempt.uid)) return false;
    seen.add(attempt.uid);
    return true;
  });
  const ordered = [...chronologicalAttempts(retained.filter((attempt) => validDay(attempt.day))), ...retained.filter((attempt) => !validDay(attempt.day))];
  const groups = new Map<string, ExerciseHistory>();
  for (const attempt of ordered) {
    let exercise = groups.get(attempt.id);
    if (!exercise) {
      exercise = { cardId: attempt.id, attempts: [], measured: [], selfGuided: [], skipped: [], unknown: [], tempo: [] };
      groups.set(attempt.id, exercise);
    }
    exercise.attempts.push(attempt);
    if (attempt.result === "skip") exercise.skipped.push(attempt);
    else if (attempt.conditions?.source === "self") exercise.selfGuided.push(attempt);
    else if (attempt.conditions?.source === "measured") exercise.measured.push(attempt);
    else exercise.unknown.push(attempt);
    if (attempt.result === "clean" && attempt.conditions?.source === "measured"
      && (attempt.conditions.tempo === "fixed" || attempt.conditions.tempo === "adaptive")
      && (attempt.ev?.time?.n ?? 0) > 0 && Number.isFinite(attempt.bpm) && attempt.bpm > 0 && validDay(attempt.day)) {
      exercise.tempo.push({ attempt, day: attempt.day, at: attempt.at ?? null, bpm: attempt.bpm,
        arrangementFingerprint: attempt.arrangementFingerprint ?? null, comparisonKey: comparisonKey(attempt) });
    }
  }
  return [...groups.values()].sort((a, b) => a.cardId.localeCompare(b.cardId));
}

export function projectPracticeHistory(tuneId: string, transactions: readonly SyncTransaction[]): PracticeHistoryResult {
  const result = projectPracticeStore(tuneId, transactions);
  return result.status === "ready"
    ? { ...result, tuneId, excludesSharedSkills: true, exercises: groupPracticeHistory(result.store) }
    : result;
}

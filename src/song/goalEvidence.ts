import { projectTransactions } from "../sync/merge";
import { parseSyncSnapshot, type SyncTransaction } from "../sync/model";
import { goalProgress, type Goal } from "./goals";
import type { Store } from "./leitner";

export type GoalEvidence = { status: "ready"; progress: ReturnType<typeof goalProgress> }
  | { status: "unavailable" | "too-large" | "conflicted" };

/** Display-only evidence: the ordinary store/planner keeps its bounded recent history. */
export function projectGoalEvidence(goal: Goal, transactions: readonly SyncTransaction[]): GoalEvidence {
  try {
    const key = `guitar-song-deck:${goal.tuneId}`;
    const target = transactions.filter((entry) => entry.kind === "storage" && entry.key === key);
    const checked = parseSyncSnapshot({ format: "fretboard-focus-sync", version: 1, device: "goal-evidence", createdAt: "", transactions: target }).transactions;
    const projection = projectTransactions(checked);
    if (projection.conflicts.length) return { status: "conflicted" };
    const raw = projection.storage.get(key);
    // Sparse transactions without their baseline are valid fragments, but cannot
    // establish a complete practice store or a negative goal-evidence result.
    if (raw) parseSyncSnapshot({ format: "fretboard-focus-sync", version: 1, device: "projection", createdAt: "", transactions: [{
      v: 1, id: "projection:1", device: "projection", seq: 1, clock: 1, at: 0, context: {}, kind: "storage", key, before: null, after: raw,
    }] });
    const store: Store = raw ? JSON.parse(raw) as Store : { v: 1, cards: {}, history: [], sessions: [], settings: { newPerSession: 4, guide: false, voice: false, window: null } };
    return { status: "ready", progress: goalProgress(goal, store) };
  } catch {
    return { status: "unavailable" };
  }
}

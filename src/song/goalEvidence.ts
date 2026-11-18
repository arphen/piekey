import type { SyncTransaction } from "../sync/model";
import { goalProgress, type Goal } from "./goals";
import { projectPracticeStore } from "./practiceHistory";

export type GoalEvidence = { status: "ready"; progress: ReturnType<typeof goalProgress> }
  | { status: "unavailable" | "too-large" | "conflicted" };

/** Display-only evidence: the ordinary store/planner keeps its bounded recent history. */
export function projectGoalEvidence(goal: Goal, transactions: readonly SyncTransaction[]): GoalEvidence {
  const result = projectPracticeStore(goal.tuneId, transactions);
  try {
    return result.status === "ready" ? { status: "ready", progress: goalProgress(goal, result.store) } : result;
  } catch {
    return { status: "unavailable" };
  }
}

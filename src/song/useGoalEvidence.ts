import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getStoredItem } from "../storage";
import { getSyncState, readPracticeTransactions, subscribeSyncState } from "../sync/journal";
import { projectGoalEvidence, type GoalEvidence } from "./goalEvidence";
import type { Goal } from "./goals";

const revisionOf = () => getSyncState().revision;
type Check = GoalEvidence | { status: "checking" };

/** The checked result belongs to a goal and journal revision; stale results never leak into
 * another arrangement. Failed/capped/conflicted archives remain unknown, rather than zero.
 */
export function useGoalEvidence(goal: Goal | null) {
  const revision = useSyncExternalStore(subscribeSyncState, revisionOf, revisionOf);
  const [refresh, setRefresh] = useState(0);
  const [checked, setChecked] = useState<{ goal: Goal; revision: number; refresh: number; result: GoalEvidence }>();
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    if (!goal) return;
    let disposed = false;
    void readPracticeTransactions(goal.tuneId).then((read): GoalEvidence => {
      if (read.status !== "ready") return read;
      // An existing store with no captured journal group may still be initializing or
      // recovering. Its recent subset cannot certify that no older goal proof exists.
      if (!read.transactions.length && getStoredItem(`guitar-song-deck:${goal.tuneId}`) !== null) return { status: "unavailable" };
      return projectGoalEvidence(goal, read.transactions);
    }).catch((): GoalEvidence => ({ status: "unavailable" })).then((result) => {
      if (!disposed) setChecked({ goal, revision, refresh, result });
    });
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === `guitar-song-deck:${goal.tuneId}`) retry(); };
    window.addEventListener("storage", changed);
    return () => { disposed = true; window.removeEventListener("storage", changed); };
  }, [goal, revision, refresh, retry]);
  const result: Check = checked?.goal === goal && checked.revision === revision && checked.refresh === refresh
    ? checked.result : { status: "checking" };
  return { result, retry };
}

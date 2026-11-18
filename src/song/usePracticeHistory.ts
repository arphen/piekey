import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getStoredItem } from "../storage";
import { getSyncState, readPracticeTransactions, subscribeSyncState } from "../sync/journal";
import { projectPracticeHistory, type PracticeHistoryResult } from "./practiceHistory";

const revisionOf = () => getSyncState().revision;
type Check = PracticeHistoryResult | { status: "checking" };

/** Read-only archive checks belong to one tune and journal revision. Neither an older
 * response nor the bounded local display store can become a newer tune's evidence. */
export function usePracticeHistory(tuneId: string | null) {
  const revision = useSyncExternalStore(subscribeSyncState, revisionOf, revisionOf);
  const [refresh, setRefresh] = useState(0);
  const [checked, setChecked] = useState<{ tuneId: string; revision: number; refresh: number; result: PracticeHistoryResult }>();
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    if (!tuneId) return;
    let disposed = false;
    void readPracticeTransactions(tuneId).then((read): PracticeHistoryResult => {
      if (read.status !== "ready") return read;
      if (!read.transactions.length && getStoredItem(`guitar-song-deck:${tuneId}`) !== null) return { status: "unavailable" };
      return projectPracticeHistory(tuneId, read.transactions);
    }).catch((): PracticeHistoryResult => ({ status: "unavailable" })).then((result) => {
      if (!disposed) setChecked({ tuneId, revision, refresh, result });
    });
    const changed = (event: StorageEvent) => { if (event.key === null || event.key === `guitar-song-deck:${tuneId}`) retry(); };
    window.addEventListener("storage", changed);
    return () => { disposed = true; window.removeEventListener("storage", changed); };
  }, [tuneId, revision, refresh, retry]);
  const result: Check = checked?.tuneId === tuneId && checked.revision === revision && checked.refresh === refresh
    ? checked.result : { status: "checking" };
  return { result, retry };
}

import { useSyncExternalStore } from "react";
import { getStorageIssues, subscribeStorageIssues } from "../storage";
import { flushSyncJournal } from "../sync/journal";

/** A failed save stays visible until the affected storage succeeds again. */
export function SaveNotice() {
  const issues = useSyncExternalStore(subscribeStorageIssues, getStorageIssues, getStorageIssues);
  if (!issues.length) return null;
  return (
    <aside className="storage-notice" role="alert">
      <strong>Some changes could not be saved.</strong>
      {issues.map((issue) => <p key={issue.area}>{issue.message}</p>)}
      {issues.some((issue) => issue.area === "sync-history") ? <button type="button" onClick={() => { void flushSyncJournal().catch(() => undefined); }}>Retry sync history</button> : null}
      <p>Keep this page open. You can export a backup from Song.</p>
    </aside>
  );
}

import { useSyncExternalStore } from "react";
import { checkForOfflineUpdate, getOfflineSnapshot, subscribeOffline } from "../pwa";
import { getLocalPracticeActive, subscribeLocalPractice } from "./practiceWindow";
import "./platform.css";

export function PlatformStatus() {
  const status = useSyncExternalStore(subscribeOffline, getOfflineSnapshot);
  const practice = useSyncExternalStore(subscribeLocalPractice, getLocalPracticeActive);
  // Nothing to say while everything is fine: the status only shows when it needs an action or is still working.
  if (status.state === "ready" || status.state === "development" || status.state === "unavailable") return null;
  return <aside className="platform-status" aria-label="app availability">
    <p role="status">{status.message}</p>
    {status.state === "update-ready" || status.state === "error" ? <button type="button" disabled={practice || status.checking} title={practice ? "Finish practice before checking for updates" : undefined} onClick={() => { void checkForOfflineUpdate(); }}>{status.state === "error" ? "Retry" : "Check for updates"}</button> : null}
  </aside>;
}

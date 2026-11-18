import { useSyncExternalStore } from "react";

// Rendering is a preference for this device, like its audio route. It does not travel in sync.
const KEY = "guitar-rendered-room";
const CHANGE = "guitar-rendered-room-change";
let transient: boolean | undefined;

function read(): boolean {
  if (transient !== undefined) return transient;
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}

function subscribe(listener: () => void): () => void {
  const changed = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { transient = undefined; listener(); } };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", changed);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener("storage", changed); };
}

function toggle(): void {
  const enabled = !read();
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); transient = undefined; }
  catch { transient = enabled; }
  window.dispatchEvent(new Event(CHANGE));
}

export function useRenderedRoom(): { enabled: boolean; toggle(): void } {
  return { enabled: useSyncExternalStore(subscribe, read, () => false), toggle };
}

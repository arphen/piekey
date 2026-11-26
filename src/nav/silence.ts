import { useSyncExternalStore } from "react";

// How many seconds of silence must pass before shell guitar navigation (D♯5 lead) can arm.
// Device-local preference, like audio input/output and room renderer: never synced or backed up.

const KEY = "guitar-nav-silence";
const CHANGE = "guitar-nav-silence-change";

export const DEFAULT_NAV_SILENCE_S = 3;
export const MIN_NAV_SILENCE_S = 0;
export const MAX_NAV_SILENCE_S = 15;
export const NAV_SILENCE_PRESETS = [0, 1, 2, 3, 5, 10] as const;

let transient: number | undefined;

function clamp(seconds: number): number {
  return Math.max(MIN_NAV_SILENCE_S, Math.min(MAX_NAV_SILENCE_S, Math.round(seconds)));
}

export function parseNavSilence(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_NAV_SILENCE_S;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n) : DEFAULT_NAV_SILENCE_S;
}

export function readNavSilence(): number {
  if (transient !== undefined) return transient;
  try {
    return parseNavSilence(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_NAV_SILENCE_S;
  }
}

export function setNavSilence(seconds: number): void {
  const n = Number.isFinite(seconds) ? clamp(seconds) : DEFAULT_NAV_SILENCE_S;
  try {
    localStorage.setItem(KEY, String(n));
    transient = undefined;
  } catch {
    transient = n;
  }
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(listener: () => void): () => void {
  const changed = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      transient = undefined;
      listener();
    }
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", changed);
  };
}

/** Silence required before shell guitar navigation arms, in seconds and milliseconds. */
export function useNavSilence(): { seconds: number; ms: number; set(seconds: number): void } {
  const seconds = useSyncExternalStore(subscribe, readNavSilence, () => DEFAULT_NAV_SILENCE_S);
  return { seconds, ms: seconds * 1000, set: setNavSilence };
}

/** Tests reset module state between cases. */
export function resetNavSilenceForTests(): void {
  transient = undefined;
}

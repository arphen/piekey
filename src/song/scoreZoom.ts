import { useSyncExternalStore } from "react";

// How close the flowing score sits: how many beats of what is coming stay in view ahead of the
// line. It comes closer by itself as an exercise settles in the box (a tune that is known needs
// less warning and rewards larger notes); the player can move it either way from there. A
// preference of this device, like the room's renderer: never synced, backed up or journalled.

const KEY = "guitar-score-zoom";
const CHANGE = "guitar-score-zoom-change";

export const LOOKAHEAD = [16, 11, 7.5, 5] as const; // beats ahead of the line, wide → closest
// the smallest the staff may get at each level: dense music shows fewer beats rather than tiny notes
export const SCALE = [0.9, 1.05, 1.3, 1.6] as const;
export const ZOOM_NAMES = ["wide", "even", "close", "closest"] as const;
const TOP = LOOKAHEAD.length - 1;

/** Where the score sits by itself: further off while new, closer as the box fills. */
export const autoZoom = (box: number): number => Math.min(TOP, 1 + Math.floor(Math.max(0, box) / 2));
export const zoomLevel = (box: number, offset: number): number => Math.max(0, Math.min(TOP, autoZoom(box) + offset));

let transient: number | undefined;

function readOffset(): number {
  if (transient !== undefined) return transient;
  try {
    const n = Number(localStorage.getItem(KEY) ?? 0);
    return Number.isFinite(n) ? Math.max(-TOP, Math.min(TOP, Math.round(n))) : 0;
  } catch {
    return 0;
  }
}

function writeOffset(offset: number): void {
  const n = Math.max(-TOP, Math.min(TOP, Math.round(offset)));
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

/** The score's closeness for an exercise in `box`, and the ways to move it. */
export function useScoreZoom(box: number): { level: number; name: string; lookahead: number; scale: number; step(delta: 1 | -1): void; cycle(): void } {
  const offset = useSyncExternalStore(subscribe, readOffset, () => 0);
  const level = zoomLevel(box, offset);
  const to = (next: number) => writeOffset(Math.max(0, Math.min(TOP, next)) - autoZoom(box));
  return {
    level,
    name: ZOOM_NAMES[level],
    lookahead: LOOKAHEAD[level],
    scale: SCALE[level],
    step: (delta) => to(level + delta),
    cycle: () => to(level === TOP ? 0 : level + 1),
  };
}

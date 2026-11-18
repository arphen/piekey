import { recordStorageChange } from "./sync/journal";

// A failed browser write must stay visible after the component that made it has gone away.
export interface StorageIssue {
  area: string;
  message: string;
}

let issues: readonly StorageIssue[] = [];
const listeners = new Set<() => void>();
const pending = new Map<string, string | null>();

/** Include failed writes in a downloadable backup, even before browser storage recovers. */
export const pendingStorageWrites = (): ReadonlyMap<string, string | null> => new Map(pending);
export function getStoredItem(key: string): string | null {
  return pending.has(key) ? pending.get(key)! : localStorage.getItem(key);
}
export function storedKeys(): string[] {
  const keys = new Set<string>();
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key) keys.add(key);
    }
  } catch { /* Pending writes are still available when browser storage itself is denied. */ }
  for (const [key, value] of pending) {
    if (value === null) keys.delete(key);
    else keys.add(key);
  }
  return [...keys];
}
export function retryStorageWrites(): boolean {
  let saved = true;
  for (const [key, value] of [...pending]) saved = (value === null ? removeStoredItem(key) : setStoredItem(key, value)) && saved;
  return saved;
}

export const getStorageIssues = (): readonly StorageIssue[] => issues;
export function subscribeStorageIssues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportStorageError(area: string, error: unknown, message?: string): void {
  const full = message ?? (error instanceof Error && error.name === "QuotaExceededError"
    ? "Browser storage is full. New changes have not been saved. Export a backup before removing anything."
    : "Changes could not be saved on this browser. Export a backup before closing the app.");
  if (issues.find((issue) => issue.area === area)?.message === full) return;
  issues = [...issues.filter((issue) => issue.area !== area), { area, message: full }];
  listeners.forEach((listener) => listener());
}

export function clearStorageError(area: string): void {
  if (!issues.some((issue) => issue.area === area)) return;
  issues = issues.filter((issue) => issue.area !== area);
  listeners.forEach((listener) => listener());
}

export function setStoredItem(key: string, value: string, journal = true): boolean {
  let before: string | null = null;
  try { before = getStoredItem(key); } catch { /* The journal keeps the pending value below. */ }
  if (journal) recordStorageChange(key, before, value);
  try {
    localStorage.setItem(key, value);
    pending.delete(key);
    clearStorageError(key);
    return true;
  } catch (error) {
    pending.set(key, value);
    reportStorageError(key, error);
    return false;
  }
}
export function removeStoredItem(key: string, journal = true): boolean {
  let before: string | null = null;
  try { before = getStoredItem(key); } catch { /* The journal keeps the pending removal below. */ }
  if (journal) recordStorageChange(key, before, null);
  try {
    localStorage.removeItem(key);
    pending.delete(key);
    clearStorageError(key);
    return true;
  } catch (error) {
    pending.set(key, null);
    reportStorageError(key, error);
    return false;
  }
}

import { useCallback, useSyncExternalStore } from "react";
import { getStoredItem, setStoredItem } from "../storage";

// The songs the next practice session draws from. The session is led by one tune (the current
// one) and mixes in the exercises of the others in this set. Nothing stored means every tune in
// the library, which is how sessions behaved before the set existed. Once the player edits it,
// it is an explicit, ordered list of tune IDs; IDs no longer in the library are ignored on read
// and dropped on the next write.

export const SESSION_SET_KEY = "guitar-session-set";

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: { raw: string | null; ids: readonly string[] | null } = { raw: null, ids: null };

function read(): readonly string[] | null {
  let raw: string | null = null;
  try { raw = getStoredItem(SESSION_SET_KEY); } catch { /* an unreadable preference means "everything" */ }
  if (raw === snapshot.raw) return snapshot.ids;
  let ids: readonly string[] | null = null;
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch { /* keep null */ }
  snapshot = { raw, ids };
  return ids;
}

/** The stored set, or null when the player never chose (every tune). */
export function loadSessionSet(): readonly string[] | null {
  return read();
}

export function subscribeSessionSet(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The tunes a session draws from, in order, limited to what is in the library. */
export function resolveSessionSet(stored: readonly string[] | null, libraryIds: readonly string[]): string[] {
  if (stored === null) return [...libraryIds];
  const known = new Set(libraryIds);
  return [...new Set(stored)].filter((id) => known.has(id));
}

export function saveSessionSet(ids: readonly string[]): void {
  try { setStoredItem(SESSION_SET_KEY, JSON.stringify([...new Set(ids)])); }
  catch { /* storage reports its own failure */ }
  listeners.forEach((listener) => listener());
}

/** In or out of the set; an implicit "everything" becomes explicit on the first edit. */
export function toggleSessionTune(id: string, libraryIds: readonly string[]): string[] {
  const now = resolveSessionSet(read(), libraryIds);
  const next = now.includes(id) ? now.filter((other) => other !== id) : [...now, id];
  saveSessionSet(next);
  return next;
}

/** A newly imported or added tune joins an explicit set; an implicit set already holds it. */
export function addSessionTune(id: string, libraryIds: readonly string[]): void {
  const stored = read();
  if (stored === null) return;
  const now = resolveSessionSet(stored, libraryIds);
  if (!now.includes(id)) saveSessionSet([...now, id]);
}

export interface SessionSetApi {
  ids: string[];
  has(id: string): boolean;
  toggle(id: string): void;
  add(id: string): void;
  remove(id: string): void;
}

export function useSessionSet(libraryIds: readonly string[]): SessionSetApi {
  const stored = useSyncExternalStore(subscribeSessionSet, read, read);
  const ids = resolveSessionSet(stored, libraryIds);
  const key = libraryIds.join("\u0000");
  const toggle = useCallback((id: string) => { toggleSessionTune(id, key ? key.split("\u0000") : []); }, [key]);
  const add = useCallback((id: string) => {
    const all = key ? key.split("\u0000") : [];
    const now = resolveSessionSet(read(), all);
    if (!now.includes(id)) saveSessionSet([...now, id]);
  }, [key]);
  const remove = useCallback((id: string) => {
    const all = key ? key.split("\u0000") : [];
    saveSessionSet(resolveSessionSet(read(), all).filter((other) => other !== id));
  }, [key]);
  return { ids, has: (id) => ids.includes(id), toggle, add, remove };
}

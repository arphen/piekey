import { useSyncExternalStore } from "react";
import { getStoredItem, setStoredItem } from "../storage";
import { EMPTY_SHAPES, MAX_OWN, SHAPES_KEY, validShapeBook, type OwnShape, type ShapeBook } from "./scaleShapes";

// The shapes chosen for each scale exercise and the versions the player kept: a synced practice
// setting (`guitar-scale-shapes`), journalled like the others so devices exchange it.

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: { raw: string | null; book: ShapeBook } = { raw: null, book: EMPTY_SHAPES };

function read(): ShapeBook {
  let raw: string | null = null;
  try { raw = getStoredItem(SHAPES_KEY); } catch { /* unreadable: every exercise in its default shape */ }
  if (raw === snapshot.raw) return snapshot.book;
  let book = EMPTY_SHAPES;
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (validShapeBook(value)) book = value;
  } catch { /* keep the defaults */ }
  snapshot = { raw, book };
  return book;
}

export const loadShapeBook = read;

function write(book: ShapeBook) {
  try { setStoredItem(SHAPES_KEY, JSON.stringify(book)); } catch { /* storage reports its own failure */ }
  listeners.forEach((l) => l());
}

export function subscribeShapeBook(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useShapeBook(): ShapeBook {
  return useSyncExternalStore(subscribeShapeBook, read, read);
}

/** Play this exercise in that shape from now on ("" back to the default). */
export function chooseShape(base: string, shapeId: string): void {
  const book = read();
  const chosen = { ...book.chosen };
  if (shapeId) chosen[base] = shapeId;
  else delete chosen[base];
  write({ ...book, chosen });
}

/** Keep a heard version as a shape of its scale; returns its ID. The same notes kept twice are one shape. */
export function keepOwnShape(scaleId: string, notes: readonly number[], p: number, day: string): string {
  const book = read();
  const list = book.own[scaleId] ?? [];
  const same = list.find((s) => s.notes.length === notes.length && s.notes.every((m, i) => m === notes[i]));
  if (same) return same.id;
  let n = 1;
  while (list.some((s) => s.id === `my${n}`)) n++;
  const shape: OwnShape = { id: `my${n}`, notes: [...notes], p: Math.min(15, Math.max(0, p)), at: day };
  write({ ...book, own: { ...book.own, [scaleId]: [...list, shape].slice(-MAX_OWN) } });
  return shape.id;
}

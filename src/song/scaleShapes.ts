import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import { fingerLine, fitWindow, notesIn, windowAt, type Window } from "./fingering";
import type { Scale } from "./harmony";
import { boundedLine, type Bounds, type LineNote, type ScaleDrill } from "./lines";

// Where on the neck a scale exercise is played. Besides the deck's own line (the default, fitted
// to the tune's position), every scale can be played in its five CAGED shapes and in versions the
// player made up and played: their own turnarounds, with or without the part below the root.
//
// Each exercise (a scale's run, thirds, triads, 7ths, each rhythm) remembers the shape chosen for
// it. A shape other than the default is its own exercise, `scale:C-major:run@E`, so it climbs the
// box at its own tempo; the default keeps the plain ID and the history it already has.

export type ShapeLetter = "C" | "A" | "G" | "E" | "D";

/** A version the player played and kept: the notes of one pass, up and back, and where it sits. */
export interface OwnShape {
  id: string; // "my1", "my2", … unique within its scale
  notes: number[]; // midi, in playing order
  p: number; // first fret of the position it was played in
  at: string; // YYYY-MM-DD it was kept
}

export interface ShapeBook {
  v: 1;
  own: Record<string, OwnShape[]>; // by scale ID ("C-major")
  chosen: Record<string, string>; // base exercise ID → shape ID; absent means the default
}

export interface ShapeOption {
  id: string; // "" for the default, a CAGED letter, or an own shape's ID
  label: string; // "Default", "E shape", "My version 2"
  p: number | null; // first fret of the position; null for the default (the deck's own window)
  own?: OwnShape;
}

export const SHAPES_KEY = "guitar-scale-shapes";
export const MAX_OWN = 8; // per scale
const HIGHEST_P = 11; // a shape's core may reach fret 15 when it is chosen on purpose

export const EMPTY_SHAPES: ShapeBook = { v: 1, own: {}, chosen: {} };

const LETTERS: ShapeLetter[] = ["C", "A", "G", "E", "D"];
// First fret of each shape, counted from the tonic's fret on the low E string.
// Major: the barre shapes of the major chord. Minor: those of the minor chord (Am shape = Dm at fret 5).
const MAJOR_OFFSET: Record<ShapeLetter, number> = { E: -1, D: 1, C: 4, A: 6, G: 8 };
const MINOR_OFFSET: Record<ShapeLetter, number> = { E: 0, D: 2, C: 4, A: 7, G: 9 };

const isMinor = (scale: Scale) => scale.kind !== "major";

/** The five CAGED positions of a scale, low on the neck first. */
export function cagedShapes(scale: Scale): ShapeOption[] {
  const r6 = mod(scale.root - OPEN_MIDI[5]);
  const offset = isMinor(scale) ? MINOR_OFFSET : MAJOR_OFFSET;
  return LETTERS.map((letter) => ({ id: letter, label: `${letter} shape`, p: mod(r6 + offset[letter]) }))
    .sort((a, b) => (a.p ?? 0) - (b.p ?? 0));
}

/** Default first, the CAGED shapes up the neck, then the player's own versions. */
export function shapeOptions(scale: Scale, book: ShapeBook): ShapeOption[] {
  const own = (book.own[scale.id] ?? []).map((s, i) => ({ id: s.id, label: `My version${(book.own[scale.id]?.length ?? 0) > 1 ? ` ${i + 1}` : ""}`, p: s.p, own: s }));
  return [{ id: "", label: "Default", p: null }, ...cagedShapes(scale), ...own];
}

export function findShape(scale: Scale, book: ShapeBook, id: string): ShapeOption | null {
  if (!id) return null;
  return shapeOptions(scale, book).find((o) => o.id === id) ?? null;
}

/** "scale:C-major:run@E" → "scale:C-major:run"; anything else is its own base. */
export const baseOf = (cardId: string) => {
  const at = cardId.indexOf("@");
  return at < 0 ? cardId : cardId.slice(0, at);
};
export const shapeOf = (cardId: string) => {
  const at = cardId.indexOf("@");
  return at < 0 ? "" : cardId.slice(at + 1);
};
export const variantId = (base: string, shapeId: string) => (shapeId ? `${base}@${shapeId}` : base);

/** The lowest notes a window's outer strings reach with one fret of stretch either side. */
function reach(w: Window): { lo: number; hi: number } {
  return { lo: Math.max(OPEN_MIDI[5], w.low - 1), hi: w.high + 1 };
}

/**
 * Where a line in a CAGED shape turns round: from its lowest root, up to the root two octaves
 * above when the shape holds it, else to the highest note of the tonic triad, and back to the
 * root it started on. Nothing below the starting root.
 */
export function shapeBounds(scale: Scale, w: Window): Bounds | null {
  const { lo, hi } = reach(w);
  const roots = notesIn([scale.root], lo, hi);
  if (!roots.length) return null;
  const start = roots[0];
  if (roots.length >= 3) return { start, top: roots[2], bottom: start };
  const triad = notesIn([scale.pcs[0], scale.pcs[2], scale.pcs[4]], start + 12, hi);
  const top = triad[triad.length - 1] ?? roots[roots.length - 1];
  return top > start ? { start, top, bottom: start } : null;
}

/** An own version's turning points: where it starts, its highest and its lowest note. */
export function ownBounds(own: OwnShape): Bounds {
  return { start: own.notes[0], top: Math.max(...own.notes), bottom: Math.min(...own.notes) };
}

/** The window a shape is fingered in. */
export const shapeWindow = (option: ShapeOption): Window | null => (option.p === null ? null : windowAt(Math.min(HIGHEST_P, Math.max(0, option.p))));

/**
 * A drill in a chosen shape. An own version's run is the version itself, note for note; its
 * other drills, like a CAGED shape's, go root to root through the scale between its turning points.
 */
export function shapeLine(drill: ScaleDrill, scale: Scale, option: ShapeOption, noteBeats?: number): LineNote[] {
  const w = shapeWindow(option);
  if (!w) return [];
  if (option.own) {
    if (drill === "run") return boundedLine("run", scale.pcs, ownBounds(option.own), noteBeats, option.own.notes);
    const b = ownBounds(option.own);
    // the drills keep to the scale's own notes, from the version's start up to its top and back
    return boundedLine(drill, scale.pcs, { start: b.start, top: b.top, bottom: Math.min(b.start, b.bottom) }, noteBeats);
  }
  const b = shapeBounds(scale, w);
  return b ? boundedLine(drill, scale.pcs, b, noteBeats) : [];
}

/** "frets 7–10": the frets a shape's run is fingered on. */
export function shapeFrets(scale: Scale, option: ShapeOption): string {
  const w = shapeWindow(option);
  if (!w) return "";
  const notes = shapeLine("run", scale, option);
  if (!notes.length) return `frets ${w.p}–${w.p + 3}`;
  const frets = fingerLine(notes.map((n) => n.midi), w).map((f) => f.fret);
  const a = Math.min(...frets);
  const b = Math.max(...frets);
  return a === b ? `fret ${a}` : `frets ${a}–${b}`;
}

// ---------- hearing a version of the player's own ----------

const MIN_NOTES = 9;
const MIN_SPAN = 10; // semitones between the lowest and highest note
const MAX_STEP = 5; // a scale moves by step; a skipped note is still a scale
const IN_SCALE = 0.85; // added passing notes are fine, a different scale is not

/**
 * The latest complete pass of a scale in what was heard: it ends where it started, turns round
 * at the top (and, if it went below where it started, once more at the bottom), moves by step and
 * keeps to the scale apart from a few added notes. The longest such pass ending on the last note,
 * or null.
 */
export function findOwnPass(heard: readonly number[], pcs: readonly number[]): number[] | null {
  const end = heard.length - 1;
  if (end < MIN_NOTES - 1) return null;
  let best: number[] | null = null;
  for (let s = end - (MIN_NOTES - 1); s >= Math.max(0, end - 90); s--) {
    if (heard[s] !== heard[end]) continue;
    const pass = heard.slice(s, end + 1);
    if (isPass(pass, pcs)) best = pass;
  }
  return best;
}

function isPass(pass: readonly number[], pcs: readonly number[]): boolean {
  const lo = Math.min(...pass);
  const hi = Math.max(...pass);
  if (hi - lo < MIN_SPAN || hi === pass[0]) return false;
  if (pass.filter((m) => pcs.includes(mod(m))).length < IN_SCALE * pass.length) return false;
  if (!pcs.includes(mod(pass[0]))) return false;
  // direction changes: up, then down, then (only below the start) up again
  const dirs: number[] = [];
  for (let i = 1; i < pass.length; i++) {
    const d = pass[i] - pass[i - 1];
    if (d === 0 || Math.abs(d) > MAX_STEP) return false;
    const sign = Math.sign(d);
    if (dirs[dirs.length - 1] !== sign) dirs.push(sign);
  }
  if (dirs.length === 2) return dirs[0] === 1;
  return dirs.length === 3 && dirs[0] === 1 && lo < pass[0];
}

const SLIPS = 2; // note edits a pass may differ by and still be the same line played with slips

function edits(a: readonly number[], b: readonly number[]): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}

/**
 * Whether a heard pass is one of these lines, slips included: the same start and turning points
 * and no more than a couple of notes added, dropped or changed. A version of the player's own
 * turns round somewhere else, or changes more than that.
 */
export function knownLine(pass: readonly number[], lines: readonly (readonly number[])[]): boolean {
  const turns = (l: readonly number[]) => `${l[0]}:${Math.max(...l)}:${Math.min(...l)}`;
  return lines.some((l) => l.length > 0 && turns(l) === turns(pass) && Math.abs(l.length - pass.length) <= SLIPS && edits(l, pass) <= SLIPS);
}

/** The position a heard version sits in: the shape it was played from when it fits there, else the best fit. */
export function placeOwn(notes: readonly number[], prefer: number): number {
  const w = windowAt(prefer);
  const { lo, hi } = reach(w);
  if (notes.every((m) => m >= lo && m <= hi)) return prefer;
  return fitWindow([...notes], prefer, HIGHEST_P + 4).p;
}

// ---------- the stored book (read and written by shapeBook.ts, validated on sync) ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const shortId = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9-]{1,24}$/.test(v);

export function validShapeBook(value: unknown): value is ShapeBook {
  if (!isRecord(value) || value.v !== 1 || !isRecord(value.own) || !isRecord(value.chosen)) return false;
  for (const [scaleId, list] of Object.entries(value.own)) {
    if (scaleId.length > 64 || !Array.isArray(list) || list.length > MAX_OWN) return false;
    for (const s of list)
      if (!isRecord(s) || !shortId(s.id) || !Array.isArray(s.notes) || s.notes.length < 2 || s.notes.length > 256
        || !s.notes.every((m) => Number.isInteger(m) && m >= 0 && m <= 127)
        || !Number.isInteger(s.p) || (s.p as number) < 0 || (s.p as number) > 15 || typeof s.at !== "string") return false;
  }
  return Object.entries(value.chosen).every(([id, shape]) => id.length <= 256 && id.startsWith("scale:") && shortId(shape));
}

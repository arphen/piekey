import { mod } from "../musicTheory";
import type { Timeline } from "../tunes/order";

export const THEME_MIN_NOTES = 6;
export const THEME_MAX_NOTES = 16;
export const THEME_MAX_TUNES = 128;

export interface ThemeSource {
  id: string;
  title: string;
  tl: Timeline;
}

export interface OpeningTheme {
  id: string;
  title: string;
  pcs: readonly number[];
}

export interface ThemeCatalog {
  themes: readonly OpeningTheme[];
  omitted: number;
}

export interface ThemeCandidate {
  id: string;
  title: string;
  matchedNotes: number;
}

const validMidi = (midi: number) => Number.isInteger(midi) && midi >= 0 && midi <= 127;

/** Timelines already fold ties into one attack. Inspect only a bounded opening of each tune. */
export function buildThemeCatalog(sources: readonly ThemeSource[]): ThemeCatalog {
  const themes: OpeningTheme[] = [];
  const ids = new Set<string>();
  let omitted = Math.max(0, sources.length - THEME_MAX_TUNES);
  for (const source of sources.slice(0, THEME_MAX_TUNES)) {
    const targets = source.tl.targets.slice(0, THEME_MAX_NOTES);
    const pcs = targets.map((target) => mod(target.midi));
    if (!source.id || ids.has(source.id) || targets.some((target) => !validMidi(target.midi) || target.chord || target.any) || pcs.length < THEME_MIN_NOTES || new Set(pcs).size < 3) {
      omitted++;
      continue;
    }
    ids.add(source.id);
    themes.push({ id: source.id, title: source.title, pcs });
  }
  return { themes, omitted };
}

/**
 * Original-key, octave-tolerant recognition. A recent exact prefix of at least six attacks
 * and three pitch classes is evidence; duration/rhythm and transposition are not inferred.
 * A suffix lets the player start the opening again without leaving the chooser.
 */
export function rankThemeMatches(catalog: ThemeCatalog, heard: readonly number[]): ThemeCandidate[] {
  const recent = heard.slice(-THEME_MAX_NOTES);
  if (recent.length < THEME_MIN_NOTES || recent.some((midi) => !validMidi(midi))) return [];
  const candidates: ThemeCandidate[] = [];
  for (const theme of catalog.themes.slice(0, THEME_MAX_TUNES)) {
    for (let length = Math.min(recent.length, theme.pcs.length, THEME_MAX_NOTES); length >= THEME_MIN_NOTES; length--) {
      const start = recent.length - length;
      const played = recent.slice(start).map((midi) => mod(midi));
      if (new Set(played).size < 3 || !played.every((pc, index) => pc === theme.pcs[index])) continue;
      candidates.push({ id: theme.id, title: theme.title, matchedNotes: length });
      break;
    }
  }
  return candidates.sort((a, b) => b.matchedNotes - a.matchedNotes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ThemeCapture {
  heard: readonly number[];
  run: number | null;
  runFrames: number;
  silent: number;
  fired: boolean;
  lastEvent: number | null;
  rearmed: boolean;
  levels: readonly number[];
  loud: boolean;
}

export function initThemeCapture(): ThemeCapture {
  return { heard: [], run: null, runFrames: 0, silent: 0, fired: false, lastEvent: null, rearmed: false, levels: [], loud: false };
}

/**
 * Like the own-pace follower, require stable pitch and rearm a repeated note on a new pick
 * or a quiet gap. Opening the chooser over a ringing string does not count it as a note.
 */
export function stepThemeCapture(s: ThemeCapture, frame: { midi: number | null; rms: number }): ThemeCapture {
  const p = frame.midi !== null && validMidi(frame.midi) && Number.isFinite(frame.rms) && frame.rms >= 0.004 ? frame.midi : null;
  const sameRun = p !== null && p === s.run;
  const floor = s.levels.length ? Math.min(...s.levels) : Infinity;
  const loud = frame.rms > 0.004 && frame.rms > floor * 1.8;
  const pick = loud && !s.loud;
  const runFrames = p === null ? 0 : sameRun && !pick ? Math.min(3, s.runFrames + 1) : 1;
  const silent = p === null ? Math.min(6, s.silent + 1) : 0;
  const next: ThemeCapture = {
    ...s, run: p, runFrames, silent,
    levels: [...s.levels, Number.isFinite(frame.rms) ? Math.max(0, frame.rms) : 0].slice(-8),
    loud, rearmed: s.rearmed || pick || silent >= 6,
    fired: sameRun && !pick ? s.fired : false,
  };
  if (p === null || runFrames < 3 || next.fired || (!next.rearmed && (s.lastEvent === null || p === s.lastEvent))) return next;
  return { ...next, heard: [...s.heard, p].slice(-THEME_MAX_NOTES), fired: true, lastEvent: p, rearmed: false, levels: [frame.rms] };
}

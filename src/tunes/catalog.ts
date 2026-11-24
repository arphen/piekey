import { songFill } from "../overview/map";
import type { SongSummary } from "../overview/summary";
import { parseTuneEntry, type TuneEntry } from "./library";
import type { LeadSheet } from "./musicxml";

// Fast, user-journey-oriented repertoire indexing, filtering and sorting for Library.

export type LibraryFilter = "all" | "session" | "chords" | "lyrics";
export type LibrarySort = "recent" | "title" | "artist" | "progress";

export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  key: string;
  keyDisplay: string;
  tempo: number | null;
  bars: number;
  hasChords: boolean;
  hasLyrics: boolean;
  chordPalette: string[]; // unique chord symbols in order of appearance, up to 10
  fill: number; // 0..1 mastery fill
  inSession: boolean;
  lastPlayed: string | null;
  partCount: number;
}

const formatKey = (signature: string) => signature.replace("b", "♭").replace("#", "♯");

function uniqueChords(sheet: LeadSheet, limit = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const bar of sheet.bars) {
    for (const raw of bar.chordSymbols ?? []) {
      const sym = raw?.trim();
      if (!sym || sym === "N.C." || seen.has(sym)) continue;
      seen.add(sym);
      out.push(sym);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function buildCatalog(
  library: readonly TuneEntry[],
  summaries: readonly SongSummary[],
  inSession: (id: string) => boolean,
): CatalogSong[] {
  const byId = new Map(summaries.map((s) => [s.tuneId, s]));
  return library.map((entry) => {
    const summary = byId.get(entry.id);
    let sheet: LeadSheet | null = null;
    try {
      sheet = parseTuneEntry(entry);
    } catch {
      sheet = null;
    }
    const key = sheet?.keySignature ?? summary?.key ?? "";
    const chordPalette = sheet ? uniqueChords(sheet) : [];
    const hasChords = Boolean(sheet?.source?.hasChords || chordPalette.length > 0);
    const hasLyrics = Boolean(sheet?.bars.some((b) => Boolean(b.lyrics?.trim())));
    const partCount = sheet?.source?.parts.filter((p) => p.notes > 0).length ?? 1;

    return {
      id: entry.id,
      title: sheet?.title ?? summary?.title ?? entry.name,
      artist: sheet?.composer ?? summary?.composer ?? "",
      key,
      keyDisplay: key ? formatKey(key) : "—",
      tempo: sheet?.tempo ?? summary?.tempo ?? null,
      bars: sheet?.bars.length ?? summary?.barCount ?? 0,
      hasChords,
      hasLyrics,
      chordPalette,
      fill: summary ? songFill(summary) : 0,
      inSession: inSession(entry.id),
      lastPlayed: summary?.lastPlayed ?? null,
      partCount,
    };
  });
}

export function filterCatalog(
  items: readonly CatalogSong[],
  query: string,
  filter: LibraryFilter,
  sort: LibrarySort,
): CatalogSong[] {
  const q = query.trim().toLowerCase();
  const matched = items.filter((item) => {
    if (filter === "session" && !item.inSession) return false;
    if (filter === "chords" && !item.hasChords) return false;
    if (filter === "lyrics" && !item.hasLyrics) return false;
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      item.artist.toLowerCase().includes(q) ||
      item.key.toLowerCase().includes(q) ||
      item.keyDisplay.toLowerCase().includes(q) ||
      item.chordPalette.some((c) => c.toLowerCase().includes(q))
    );
  });

  const sorted = [...matched];
  sorted.sort((a, b) => {
    if (sort === "recent") {
      if (a.inSession !== b.inSession) return a.inSession ? -1 : 1;
      const ad = a.lastPlayed ?? "";
      const bd = b.lastPlayed ?? "";
      if (ad !== bd) return bd.localeCompare(ad);
      return a.title.localeCompare(b.title);
    }
    if (sort === "artist") {
      const aa = a.artist || "\uffff";
      const ba = b.artist || "\uffff";
      const cmp = aa.localeCompare(ba);
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
    }
    if (sort === "progress") {
      if (b.fill !== a.fill) return b.fill - a.fill;
      return a.title.localeCompare(b.title);
    }
    return a.title.localeCompare(b.title);
  });
  return sorted;
}

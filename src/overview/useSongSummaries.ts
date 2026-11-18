import { useEffect, useState } from "react";
import { buildDeck, type Deck } from "../song/deck";
import { loadStore } from "../song/leitner";
import { loadCurrentTuneId, loadLibraryAsync, parseTuneEntry } from "../tunes/library";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";
import { summarizeSong, type SongSummary } from "./summary";

// Building a deck is the expensive part of reading a song. Keep the parsed sheet and deck for the
// life of the tab; only the box/store is re-read, so a practice session shows up on return.
interface CachedDeck {
  stamp: string;
  sheet: LeadSheet;
  deck: Deck;
}

const cache = new Map<string, CachedDeck>();

function stampOf(id: string, name: string, xml: string): string {
  let hash = 0;
  for (let i = 0; i < xml.length; i += 1) hash = (hash * 31 + xml.charCodeAt(i)) | 0;
  return `${id}:${name}:${xml.length}:${hash}`;
}

export interface SongSummaries {
  songs: SongSummary[];
  currentTuneId: string | null;
  loading: boolean;
  error: string | null;
}

export function useSongSummaries(): SongSummaries {
  const [state, setState] = useState<SongSummaries>({ songs: [], currentTuneId: null, loading: true, error: null });

  useEffect(() => {
    let gone = false;
    void loadLibraryAsync().then((entries) => {
      if (gone) return;
      const songs: SongSummary[] = [];
      const ids = new Set(entries.map((entry) => entry.id));
      for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);

      for (const entry of entries) {
        try {
          const stamp = `${stampOf(entry.id, entry.name, entry.xml)}:${entry.partId ?? ""}:${entry.voice ?? ""}`;
          let cached = cache.get(entry.id);
          if (!cached || cached.stamp !== stamp) {
            const sheet = parseTuneEntry(entry);
            cached = { stamp, sheet, deck: buildDeck(sheet, buildTimeline(sheet)) };
            cache.set(entry.id, cached);
          }
          songs.push(summarizeSong(cached.sheet, cached.deck, loadStore(cached.sheet.id)));
        } catch {
          // One unreadable import should not hide the rest of the library.
        }
      }

      setState({ songs, currentTuneId: loadCurrentTuneId(), loading: false, error: null });
    }).catch(() => {
      if (!gone) setState({ songs: [], currentTuneId: null, loading: false, error: "Your saved library could not be opened. It has not been changed." });
    });
    return () => { gone = true; };
  }, []);

  return state;
}

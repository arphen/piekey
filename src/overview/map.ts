import { allStores, BOXES, loadSharedSkills, type CardState } from "../song/leitner";
import { loadFreePlay } from "../song/freeplay";
import { buildTree, TREE_SIZE, type TreeEdge, type TreeNode } from "../song/tree";
import type { SongSummary } from "./summary";

// The home map: every song in the library placed on the circle of fifths beside the key it is in,
// with the drills practised in each key growing out of it. Read-only; built from the same stores
// the session writes, so a practice session shows up on return.

export interface MapSong {
  id: string;
  title: string;
  key: string; // "D-minor"
  fill: number; // 0..1
}

export interface PracticeMap {
  nodes: TreeNode[];
  edges: TreeEdge[];
}

/** The map's frame in tree coordinates: room for the songs' names around the rim. */
export const MAP_VIEW = { x: -170, y: -64, w: TREE_SIZE + 340, h: TREE_SIZE + 128 };

const LETTERS = /^([A-G])([b#♭♯]?)(m?)$/;

/** A key signature as the summary shows it ("F", "Am", "B♭") as a tree key ("F-major", "A-minor"). */
export function keyFromSignature(signature: string): string | null {
  const m = LETTERS.exec(signature.trim());
  if (!m) return null;
  const accidental = m[2] === "♭" ? "b" : m[2] === "♯" ? "#" : m[2];
  return `${m[1]}${accidental}-${m[3] ? "minor" : "major"}`;
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** The major key sharing a key's signature: C for C major and A minor. */
function signatureRoot(key: string): number | null {
  const m = /^([A-G])([b#]?)-(major|minor)$/.exec(key);
  if (!m) return null;
  const pc = (PC[m[1]] + (m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0) + 12) % 12;
  return m[3] === "minor" ? (pc + 3) % 12 : pc;
}

/**
 * The key a song sits beside. The harmony's home key knows a minor tune written with a major
 * signature (D minor under one flat); when it disagrees with the written signature altogether,
 * the written key wins, since the analysis has then misread the tune.
 */
export function songKey(home: string | undefined, signature: string): string | null {
  const written = keyFromSignature(signature);
  if (!home) return written;
  if (!written) return home;
  return signatureRoot(home) === signatureRoot(written) ? home : written;
}

/** "D-minor" → "Dm", "Bb-major" → "B♭". */
export function keyName(key: string): string {
  const m = /^([A-G])([b#]?)-(major|minor)$/.exec(key);
  if (!m) return key;
  return `${m[1]}${m[2] === "b" ? "♭" : m[2] === "#" ? "♯" : ""}${m[3] === "minor" ? "m" : ""}`;
}

/** How far a song's exercises have climbed the card box, 0..1. */
export function songFill(song: Pick<SongSummary, "boxes" | "total">): number {
  if (!song.total) return 0;
  const climbed = song.boxes.reduce((sum, count, index) => sum + count * (index + 1), 0);
  return Math.min(1, climbed / (song.total * BOXES));
}

export function practiceMap(songs: MapSong[]): PracticeMap {
  const cards: Record<string, CardState> = {};
  const credit: Record<string, number> = {};
  const shared = loadSharedSkills();
  for (const [id, state] of Object.entries(shared.cards)) if (id.startsWith("scale:")) cards[id] = state;
  Object.assign(credit, shared.credit);
  for (const { store } of allStores()) {
    for (const [id, state] of Object.entries(store.cards)) if (id.startsWith("scale:") && (!cards[id] || state.seen >= cards[id].seen)) cards[id] = state;
    Object.assign(credit, store.credit);
  }
  let free: ReturnType<typeof loadFreePlay> = [];
  try { free = loadFreePlay(); } catch { /* free play history is optional here */ }
  return buildTree({ cards, credit, tunes: songs, free, lit: new Set(), stagger: true });
}

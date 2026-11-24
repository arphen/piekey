import { allStores, BOXES, loadSharedSkills, type CardState } from "../song/leitner";
import { loadFreePlay } from "../song/freeplay";
import { buildTree, parseKey, TREE_SIZE, type TreeEdge, type TreeNode } from "../song/tree";
import type { SongSummary } from "./summary";

// The home map: every song in the library placed on the circle of fifths beside the key it is in,
// with the drills practised in each key growing out of it. Built from the same stores the session
// writes, so a practice session shows up on return.

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

export interface KeySkillSummary {
  id: string; // e.g. "m2/thirds"
  skill: string; // e.g. "thirds"
  label: string;
  branch: "foundation" | "melodic" | "rhythm";
  fill: number;
  box: number;
  status: "mastered" | "growing" | "kinship" | "unexplored";
}

export interface KeyTuneIdea {
  title: string;
  note: string;
}

export interface KeyDetail {
  hubId: string;
  keyId: string; // e.g. "D-minor"
  shortName: string; // e.g. "Dm"
  fullName: string; // e.g. "D minor"
  minor: boolean;
  pc: number;
  relativeHubId: string;
  relativeName: string;
  fill: number;
  skills: KeySkillSummary[];
  ideas: KeyTuneIdea[];
}

/** The map's frame in tree coordinates: room for the songs' names around the rim. */
export const MAP_VIEW = { x: -176, y: -68, w: TREE_SIZE + 352, h: TREE_SIZE + 136 };

const LETTERS = /^([A-G])([b#♭♯]?)(m?)$/;

/** A key signature as the summary shows it ("F", "Am", "B♭") as a tree key ("F-major", "A-minor"). */
export function keyFromSignature(signature: string): string | null {
  const m = LETTERS.exec(signature.trim());
  if (!m) return null;
  const accidental = m[2] === "♭" ? "b" : m[2] === "♯" ? "#" : m[2];
  return `${m[1]}${accidental}-${m[3] ? "minor" : "major"}`;
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_ID_BY_PC = ["C-major", "Db-major", "D-major", "Eb-major", "E-major", "F-major", "F#-major", "G-major", "Ab-major", "A-major", "Bb-major", "B-major"];
const MINOR_ID_BY_PC = ["C-minor", "C#-minor", "D-minor", "Eb-minor", "E-minor", "F-minor", "F#-minor", "G-minor", "G#-minor", "A-minor", "Bb-minor", "B-minor"];
const MAJOR_FULL_BY_PC = ["C major", "D♭ major", "D major", "E♭ major", "E major", "F major", "F♯ major", "G major", "A♭ major", "A major", "B♭ major", "B major"];
const MINOR_FULL_BY_PC = ["C minor", "C♯ minor", "D minor", "E♭ minor", "E minor", "F minor", "F♯ minor", "G minor", "G♯ minor", "A minor", "B♭ minor", "B minor"];
const MAJOR_SHORT_BY_PC = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_SHORT_BY_PC = ["Cm", "C♯m", "Dm", "E♭m", "Em", "Fm", "F♯m", "Gm", "G♯m", "Am", "B♭m", "Bm"];

const SKILL_META: { skill: string; label: string; branch: KeySkillSummary["branch"] }[] = [
  { skill: "run", label: "Scale run", branch: "foundation" },
  { skill: "thirds", label: "Thirds", branch: "melodic" },
  { skill: "triads", label: "Triads", branch: "melodic" },
  { skill: "sevenths", label: "7th arpeggios", branch: "melodic" },
  { skill: "run:triplets", label: "Triplets", branch: "rhythm" },
  { skill: "run:sixteenths", label: "Sixteenths", branch: "rhythm" },
];

/** Curated repertoire ideas per key so empty or sparse hubs inspire new tunes to import. */
const KEY_IDEAS: Record<string, KeyTuneIdea[]> = {
  M0: [{ title: "All of Me", note: "swing standard · ii–V–I" }, { title: "Fly Me to the Moon", note: "circle of fifths in C" }, { title: "Take the 'A' Train", note: "bright major melody" }],
  m9: [{ title: "Minor Swing", note: "gypsy jazz · i–iv–V" }, { title: "Black Orpheus", note: "bossa ballad in Am" }, { title: "So Nice (Summer Samba)", note: "minor-to-major turns" }],
  M7: [{ title: "Blackbird", note: "fingerstyle voice leading" }, { title: "Autumn Leaves (G)", note: "classic jazz cycles" }, { title: "Sweet Georgia Brown", note: "dominant chains" }],
  m4: [{ title: "Autumn Leaves", note: "real-book Em / G" }, { title: "Scarborough Fair", note: "Dorian folk melody" }, { title: "Breezin'", note: "soulful guitar groove" }],
  M2: [{ title: "Here Comes the Sun", note: "open-position motifs" }, { title: "Someday My Prince Will Come", note: "jazz waltz" }],
  m11: [{ title: "Hotel California", note: "descending Andalusian cycle" }, { title: "Tears in Heaven (rel)", note: "lyrical arpeggios" }],
  M9: [{ title: "Georgia on My Mind", note: "warm chord-melody" }, { title: "Don't Know Why", note: "modern acoustic changes" }],
  m6: [{ title: "Billie Jean", note: "tight pocket riff" }, { title: "Nardis (rel)", note: "modal tension" }],
  M4: [{ title: "Little Wing (rel)", note: "double-stop embellishments" }, { title: "Wind Cries Mary", note: "triad slides in E" }],
  m1: [{ title: "Equinox", note: "minor blues · C♯m" }, { title: "Moonlight Sonata (arr.)", note: "arpeggio study" }],
  M11: [{ title: "Giant Steps (B)", note: "Coltrane third cycles" }, { title: "Under the Bridge", note: "chordal intro" }],
  m8: [{ title: "G♯m Étude", note: "closed-position minor" }, { title: "Still Got the Blues (rel)", note: "expressive bends" }],
  M6: [{ title: "The Girl from Ipanema", note: "bossa nova in F / F♯" }, { title: "Wave (alt)", note: "chromatic bass lines" }],
  m3: [{ title: "Take Five", note: "5/4 vamp in E♭m" }, { title: "Round Midnight", note: "ballad harmony" }],
  M1: [{ title: "Body and Soul", note: "classic ballad changes" }, { title: "Lush Life", note: "chromatic modulations" }],
  m10: [{ title: "Footprints (alt)", note: "dark 6/8 minor blues" }, { title: "B♭m Blues", note: "upper-neck phrasing" }],
  M8: [{ title: "All the Things You Are", note: "essential jazz modulations" }, { title: "My One and Only Love", note: "ballad voicings" }],
  m5: [{ title: "Cantaloupe Island", note: "modal funk in Fm" }, { title: "Samba Pa Ti (rel)", note: "lyrical sustain" }],
  M3: [{ title: "Misty", note: "lush ballad in E♭" }, { title: "There Will Never Be Another You", note: "swing changes" }],
  m0: [{ title: "Blue Bossa", note: "bossa minor + D♭ modulation" }, { title: "Softly, as in a Morning Sunrise", note: "driving minor swing" }],
  M10: [{ title: "Blue Monk", note: "12-bar jazz blues in B♭" }, { title: "Stella by Starlight", note: "rich jazz harmony" }, { title: "Tenor Madness", note: "bebop phrasing" }],
  m7: [{ title: "Summertime", note: "bluesy minor standard" }, { title: "Mr. P.C.", note: "fast minor blues" }, { title: "Moondance", note: "Dorian groove" }],
  M5: [{ title: "Billie's Bounce", note: "bebop F blues" }, { title: "Honeysuckle Rose", note: "swing ii–V vocabulary" }, { title: "Doxy", note: "relaxed swing head" }],
  m2: [{ title: "So What", note: "D Dorian modal classic" }, { title: "Nature Boy", note: "haunting minor melody" }, { title: "Samba Pa Ti", note: "melodic guitar phrasing" }],
};

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

/** "D-minor" → "m2", "C-major" → "M0". */
export function hubIdForKey(key: string): string | null {
  const parsed = parseKey(key);
  return parsed ? `${parsed.minor ? "m" : "M"}${parsed.pc}` : null;
}

/** Inspect one key hub on the circle of fifths: its 6 skill exercises, relative partner, and tune ideas. */
export function keyDetail(hubId: string, map: PracticeMap): KeyDetail | null {
  const match = /^(M|m)(\d+)$/.exec(hubId);
  if (!match) return null;
  const minor = match[1] === "m";
  const pc = Number(match[2]);
  if (pc < 0 || pc > 11) return null;
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const hubNode = byId.get(hubId);
  const relPc = minor ? (pc + 3) % 12 : (pc + 9) % 12;
  const relativeHubId = `${minor ? "M" : "m"}${relPc}`;
  const skills: KeySkillSummary[] = SKILL_META.map(({ skill, label, branch }) => {
    const id = `${hubId}/${skill}`;
    const fill = byId.get(id)?.fill ?? 0;
    const box = fill >= 0.18 ? Math.min(BOXES, Math.max(1, Math.round(fill * BOXES))) : 0;
    const status: KeySkillSummary["status"] = fill >= 0.8 ? "mastered" : box > 0 ? "growing" : fill > 0 ? "kinship" : "unexplored";
    return { id, skill, label, branch, fill, box, status };
  });
  return {
    hubId,
    keyId: minor ? MINOR_ID_BY_PC[pc] : MAJOR_ID_BY_PC[pc],
    shortName: minor ? MINOR_SHORT_BY_PC[pc] : MAJOR_SHORT_BY_PC[pc],
    fullName: minor ? MINOR_FULL_BY_PC[pc] : MAJOR_FULL_BY_PC[pc],
    minor,
    pc,
    relativeHubId,
    relativeName: minor ? MAJOR_FULL_BY_PC[relPc] : MINOR_FULL_BY_PC[relPc],
    fill: hubNode?.fill ?? 0,
    skills,
    ideas: KEY_IDEAS[hubId] ?? [],
  };
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

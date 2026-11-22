import { makeScale } from "../song/harmony";
import { mod } from "../musicTheory";
import { seeded, shuffled } from "../song/rand";

// Triads by heart: "ii of C major", and four triads to choose from, each written out. The keys
// come round the circle of fifths from the top, both ways at once (C; G and F; D and B♭; ...), so
// the triads learned first are the ones every other key leans on. Spelling comes from the key's own
// scale (harmony.ts), so ii of B♭ is C E♭ G and vii° of F♯ is E♯ G♯ B. Pure and deterministic.
//
// The drill grows in layers, each opening a ring at a time behind the one before it: major keys,
// then the same triads the other way round (here is the triad: which degree?), minor keys (V and
// vii° from the harmonic minor), minor the other way round, then first and second inversions.

export type Quality = "major" | "minor" | "diminished";
export type Mode = "major" | "minor";
export type Ask = "name" | "degree"; // name the triad of a degree, or the degree of a triad
export type Inversion = 0 | 1 | 2;

export interface TriadKey {
  tonic: number; // pitch class
  name: string; // "B♭"
  ring: number; // steps from the top of the circle of fifths: C (or A minor) 0, a step each way 1, ...
  mode: Mode;
}

const key = (tonic: number, name: string, ring: number, mode: Mode): TriadKey => ({ tonic, name, ring, mode });

/** The major keys in the order they come: C, then a step each way round the circle at a time. */
export const TRIAD_KEYS: readonly TriadKey[] = [
  key(0, "C", 0, "major"), key(7, "G", 1, "major"), key(5, "F", 1, "major"), key(2, "D", 2, "major"), key(10, "B♭", 2, "major"),
  key(9, "A", 3, "major"), key(3, "E♭", 3, "major"), key(4, "E", 4, "major"), key(8, "A♭", 4, "major"), key(11, "B", 5, "major"),
  key(1, "D♭", 5, "major"), key(6, "F♯", 6, "major"), key(6, "G♭", 6, "major"),
];
/** Their relative minors, in the same order: A minor at the top. */
export const MINOR_KEYS: readonly TriadKey[] = [
  key(9, "A", 0, "minor"), key(4, "E", 1, "minor"), key(2, "D", 1, "minor"), key(11, "B", 2, "minor"), key(7, "G", 2, "minor"),
  key(6, "F♯", 3, "minor"), key(0, "C", 3, "minor"), key(1, "C♯", 4, "minor"), key(5, "F", 4, "minor"), key(8, "G♯", 5, "minor"),
  key(10, "B♭", 5, "minor"), key(3, "D♯", 6, "minor"), key(3, "E♭", 6, "minor"),
];
export const RINGS = 7;

const ROMAN: Record<Mode, string[]> = { major: ["I", "ii", "iii", "IV", "V", "vi", "vii°"], minor: ["i", "ii°", "III", "iv", "V", "VI", "vii°"] };
const QUALITY: Record<Mode, Quality[]> = {
  major: ["major", "minor", "minor", "major", "major", "minor", "diminished"],
  minor: ["minor", "diminished", "major", "minor", "major", "major", "diminished"],
};
export const FIGURE: Record<Inversion, string> = { 0: "", 1: "6", 2: "6/4" };

/** The layers, in the order they open. */
export const LAYERS: readonly { mode: Mode; ask: Ask; inversions: readonly Inversion[]; label: string }[] = [
  { mode: "major", ask: "name", inversions: [0], label: "Major" },
  { mode: "major", ask: "degree", inversions: [0], label: "Major, which degree" },
  { mode: "minor", ask: "name", inversions: [0], label: "Minor" },
  { mode: "minor", ask: "degree", inversions: [0], label: "Minor, which degree" },
  { mode: "major", ask: "name", inversions: [1, 2], label: "Major inversions" },
  { mode: "minor", ask: "name", inversions: [1, 2], label: "Minor inversions" },
];

export interface Triad {
  notes: string[]; // spelled, lowest first: ["C", "E♭", "G"]; an inversion starts on its bass
  octaves: number[]; // written octave of each note: close position, the lowest in the octave from middle C
  midis: number[]; // as they sound
  quality: Quality;
  root: string; // the root, whichever note is lowest
}

export interface TriadCard {
  id: string; // "triad:B♭:2", "triad:Am:4:degree", "triad:C:1:inv1"
  key: TriadKey;
  degree: number; // 0..6
  roman: string; // "ii"
  ask: Ask;
  inversion: Inversion;
  layer: number;
  triad: Triad; // as asked: in its inversion
}

export interface Choice {
  triad: Triad | null; // naming a triad: one to choose
  roman: string | null; // naming a degree: one to choose
}

const LETTERS = "CDEFGAB";
const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];

const shift = (note: string) => (note.match(/♯/g) ?? []).length - (note.match(/♭/g) ?? []).length;

/** A spelled note's pitch class: "E♯" is 5, "C♯♯" is 2. */
export function pcOf(note: string): number {
  return mod(LETTER_PCS[LETTERS.indexOf(note[0])] + shift(note));
}

function triad(notes: string[], quality: Quality, root = notes[0]): Triad {
  // close position: the letters climb, and they decide the octave, so B♯ is written above B
  let position = LETTERS.indexOf(notes[0][0]);
  const octaves = notes.map((n, i) => {
    if (i) position += (LETTERS.indexOf(n[0]) - (position % 7) + 7) % 7 || 7;
    return 4 + Math.floor(position / 7);
  });
  const midis = notes.map((n, i) => 12 * (octaves[i] + 1) + LETTER_PCS[LETTERS.indexOf(n[0])] + shift(n));
  return { notes, octaves, midis, quality, root };
}

/** The triad turned over: its 3rd (first inversion) or 5th (second) in the bass. */
export function invert(t: Triad, inversion: Inversion): Triad {
  if (!inversion) return t;
  const rootFirst = [...t.notes.slice(t.notes.indexOf(t.root)), ...t.notes.slice(0, t.notes.indexOf(t.root))];
  return triad([...rootFirst.slice(inversion), ...rootFirst.slice(0, inversion)], t.quality, t.root);
}

const wrap = (degree: number) => ((degree % 7) + 7) % 7;

/** The triad on a degree of a key in root position, spelled by the key's scale; minor takes V and vii° from the harmonic minor. */
export function degreeTriad(k: TriadKey, degree: number): Triad {
  const d = wrap(degree);
  if (k.mode === "major") {
    const names = makeScale(k.tonic, "major", k.name).names;
    return triad([names[d], names[(d + 2) % 7], names[(d + 4) % 7]], QUALITY.major[d]);
  }
  const names = makeScale(k.tonic, d === 4 || d === 6 ? "harmonicMinor" : "naturalMinor", k.name).names;
  return triad([names[d], names[(d + 2) % 7], names[(d + 4) % 7]], QUALITY.minor[d]);
}

/** The same root, the other quality: D F A becomes D F♯ A; a diminished triad's fifth comes up to perfect. */
function otherQuality(t: Triad): Triad {
  const kind = t.quality === "minor" ? "major" : "naturalMinor";
  const names = makeScale(pcOf(t.root), kind, t.root).names;
  return triad([names[0], names[2], names[4]], kind === "major" ? "major" : "minor");
}

export const romanOf = (k: TriadKey, degree: number) => ROMAN[k.mode][wrap(degree)];

function triadCard(k: TriadKey, degree: number, ask: Ask, inversion: Inversion, layer: number): TriadCard {
  const id = `triad:${k.name}${k.mode === "minor" ? "m" : ""}:${degree}${ask === "degree" ? ":degree" : ""}${inversion ? `:inv${inversion}` : ""}`;
  return { id, key: k, degree, roman: romanOf(k, degree), ask, inversion, layer, triad: invert(degreeTriad(k, degree), inversion) };
}

/** Every card, in the order they are introduced: by layer, key round the circle, degree, inversion. */
export const TRIAD_CARDS: readonly TriadCard[] = LAYERS.flatMap((layer, l) =>
  (layer.mode === "major" ? TRIAD_KEYS : MINOR_KEYS).flatMap((k) => ROMAN[k.mode].flatMap((_, d) => layer.inversions.map((inv) => triadCard(k, d, layer.ask, inv, l)))),
);
export const TRIAD_BY_ID: ReadonlyMap<string, TriadCard> = new Map(TRIAD_CARDS.map((c) => [c.id, c]));

const same = (a: Triad, b: Triad) => a.notes.join() === b.notes.join();

/**
 * Four to choose from, in an order that is the same for the same card and turn. Naming a triad:
 * the answer, its root in the other quality and the key's triads a degree either side (for an
 * inversion, the same triad turned another way too). Naming a degree: the degree and its neighbours.
 */
export function choicesFor(card: TriadCard, turn: number): { choices: Choice[]; answer: number } {
  const order = seeded(`${card.id}:${turn}`);
  if (card.ask === "degree") {
    const degrees = shuffled([card.degree, card.degree - 1, card.degree + 1, card.degree + 3].map(wrap), order);
    return { choices: degrees.map((d) => ({ triad: null, roman: romanOf(card.key, d) })), answer: degrees.indexOf(card.degree) };
  }
  const k = card.inversion;
  const turned = (t: Triad) => invert(t, k);
  const root = degreeTriad(card.key, card.degree);
  const pool = [
    ...(k ? [invert(root, k === 1 ? 2 : 1)] : []),
    turned(otherQuality(root)),
    turned(degreeTriad(card.key, card.degree - 1)),
    turned(degreeTriad(card.key, card.degree + 1)),
    ...(k ? [root] : []),
    turned(degreeTriad(card.key, card.degree + 3)),
  ];
  const wrong: Triad[] = [];
  for (const t of pool) if (wrong.length < 3 && !same(t, card.triad) && !wrong.some((w) => same(w, t))) wrong.push(t);
  const triads = shuffled([card.triad, ...wrong], order);
  return { choices: triads.map((t) => ({ triad: t, roman: null })), answer: triads.findIndex((t) => same(t, card.triad)) };
}

/** VexFlow keys and accidentals for a triad: "e/4" with "b". */
export function vexOf(t: Triad): { keys: string[]; accidentals: (string | null)[] } {
  return {
    keys: t.notes.map((n, i) => `${n[0].toLowerCase()}/${t.octaves[i]}`),
    accidentals: t.notes.map((n) => {
      const acc = n.slice(1).replace(/♯/g, "#").replace(/♭/g, "b");
      return acc || null;
    }),
  };
}

/** German note names: H for B, B for B♭, -is and -es for the rest (Fis, Es, As, Cisis). */
export function germanName(note: string): string {
  const letter = note[0];
  const sharps = (note.match(/♯/g) ?? []).length;
  const flats = (note.match(/♭/g) ?? []).length;
  if (letter === "B") return flats === 0 ? "H" + "is".repeat(sharps) : flats === 1 ? "B" : "Heses";
  if (sharps) return letter + "is".repeat(sharps);
  if (!flats) return letter;
  const vowel = letter === "E" || letter === "A"; // Es, As: no extra e
  return (vowel ? letter + "s" : letter + "es") + (flats > 1 ? (letter === "A" ? "as" : "es") : "");
}

export type { Naming } from "./model";
import type { Naming } from "./model";
export const noteName = (note: string, naming: Naming) => (naming === "german" ? germanName(note) : note);

/** "C major" / "C-Dur", "F♯ minor" / "fis-Moll". */
export function keyName(k: TriadKey, naming: Naming): string {
  if (naming === "english") return `${k.name} ${k.mode}`;
  const n = germanName(k.name);
  return k.mode === "major" ? `${n}-Dur` : `${n.toLowerCase()}-Moll`;
}

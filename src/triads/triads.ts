import { makeScale } from "../song/harmony";
import { mod } from "../musicTheory";
import { seeded, shuffled } from "../song/rand";

// Triads by heart: "ii of C major", and four triads to choose from, each written out. The keys
// come round the circle of fifths from the top, both ways at once (C; G and F; D and B♭; ...), so
// the triads learned first are the ones every other key leans on. Spelling comes from the key's own
// scale (harmony.ts), so ii of B♭ is C E♭ G and vii° of F♯ is E♯ G♯ B. Pure and deterministic.

export type Quality = "major" | "minor" | "diminished";

export interface TriadKey {
  tonic: number; // pitch class
  name: string; // "B♭"
  ring: number; // steps from C round the circle of fifths: C 0, G and F 1, ...
}

/** The keys in the order they come: C, then a step each way round the circle at a time. */
export const TRIAD_KEYS: readonly TriadKey[] = [
  { tonic: 0, name: "C", ring: 0 },
  { tonic: 7, name: "G", ring: 1 },
  { tonic: 5, name: "F", ring: 1 },
  { tonic: 2, name: "D", ring: 2 },
  { tonic: 10, name: "B♭", ring: 2 },
  { tonic: 9, name: "A", ring: 3 },
  { tonic: 3, name: "E♭", ring: 3 },
  { tonic: 4, name: "E", ring: 4 },
  { tonic: 8, name: "A♭", ring: 4 },
  { tonic: 11, name: "B", ring: 5 },
  { tonic: 1, name: "D♭", ring: 5 },
  { tonic: 6, name: "F♯", ring: 6 },
  { tonic: 6, name: "G♭", ring: 6 },
];
export const RINGS = 7;

const ROMAN = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const QUALITY: Quality[] = ["major", "minor", "minor", "major", "major", "minor", "diminished"];

export interface Triad {
  notes: string[]; // spelled, root first: ["C", "E♭", "G"]
  octaves: number[]; // written octave of each note: close position, root in the octave from middle C
  midis: number[]; // as they sound
  quality: Quality;
}

export interface TriadCard {
  id: string; // "triad:B♭:2"
  key: TriadKey;
  degree: number; // 0..6
  roman: string; // "ii"
  triad: Triad;
}

const LETTERS = "CDEFGAB";
const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];

const shift = (note: string) => (note.match(/♯/g) ?? []).length - (note.match(/♭/g) ?? []).length;

/** A spelled note's pitch class: "E♯" is 5, "C♯♯" is 2. */
export function pcOf(note: string): number {
  return mod(LETTER_PCS[LETTERS.indexOf(note[0])] + shift(note));
}

function triad(notes: string[], quality: Quality): Triad {
  // close position: the letters climb, and they decide the octave, so B♯ is written above B
  let position = LETTERS.indexOf(notes[0][0]);
  const octaves = notes.map((n, i) => {
    if (i) position += (LETTERS.indexOf(n[0]) - (position % 7) + 7) % 7 || 7;
    return 4 + Math.floor(position / 7);
  });
  const midis = notes.map((n, i) => 12 * (octaves[i] + 1) + LETTER_PCS[LETTERS.indexOf(n[0])] + shift(n));
  return { notes, octaves, midis, quality };
}

/** The triad on a degree of a key, spelled by the key's scale. */
export function degreeTriad(key: TriadKey, degree: number): Triad {
  const names = makeScale(key.tonic, "major", key.name).names;
  const d = ((degree % 7) + 7) % 7;
  return triad([names[d], names[(d + 2) % 7], names[(d + 4) % 7]], QUALITY[d]);
}

/** The same root, the other quality: D F A becomes D F♯ A; a diminished triad's fifth comes up to perfect. */
function otherQuality(t: Triad): Triad {
  const root = t.notes[0];
  const kind = t.quality === "minor" ? "major" : "naturalMinor";
  const names = makeScale(pcOf(root), kind, root).names;
  return triad([names[0], names[2], names[4]], kind === "major" ? "major" : "minor");
}

export function triadCard(key: TriadKey, degree: number): TriadCard {
  return { id: `triad:${key.name}:${degree}`, key, degree, roman: ROMAN[degree], triad: degreeTriad(key, degree) };
}

/** Every card, in the order they are introduced: by key round the circle, then I to vii°. */
export const TRIAD_CARDS: readonly TriadCard[] = TRIAD_KEYS.flatMap((key) => ROMAN.map((_, d) => triadCard(key, d)));
export const TRIAD_BY_ID: ReadonlyMap<string, TriadCard> = new Map(TRIAD_CARDS.map((c) => [c.id, c]));

const same = (a: Triad, b: Triad) => a.notes.join() === b.notes.join();

/**
 * Four triads to choose from, in an order that is the same for the same card and turn: the answer,
 * its root in the other quality, and the key's triads a degree either side (the ones it is mistaken for).
 */
export function choicesFor(card: TriadCard, turn: number): { choices: Triad[]; answer: number } {
  const pool = [otherQuality(card.triad), degreeTriad(card.key, card.degree - 1), degreeTriad(card.key, card.degree + 1), degreeTriad(card.key, card.degree + 3)];
  const wrong: Triad[] = [];
  for (const t of pool) if (wrong.length < 3 && !same(t, card.triad) && !wrong.some((w) => same(w, t))) wrong.push(t);
  const choices = shuffled([card.triad, ...wrong], seeded(`${card.id}:${turn}`));
  return { choices, answer: choices.findIndex((t) => same(t, card.triad)) };
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

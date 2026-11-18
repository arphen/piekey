import { mod } from "../musicTheory";
import type { KeyInfo, ParentScale, ParentScaleId, Position, PositionId } from "./contract";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

function accidental(pc: number, letterPc: number): string {
  const d = mod(pc - letterPc + 6) - 6; // -6..5
  if (d === 0) return "";
  return d > 0 ? "#".repeat(d) : "b".repeat(-d);
}

function nameFor(letterIdx: number, pc: number): string {
  const li = ((letterIdx % 7) + 7) % 7;
  return LETTERS[li] + accidental(pc, LETTER_PC[li]);
}

const TONICS: [string, number][] = [
  ["A", 9], ["E", 4], ["D", 2], ["G", 7], ["C", 0], ["F", 5],
  ["Bb", 10], ["Eb", 3], ["B", 11], ["F#", 6], ["C#", 1], ["G#", 8],
];

function offsetFromA(pc: number): number {
  let d = mod(pc - 9);
  if (d > 6) d -= 12;
  return d; // -5..6 (tritone goes up)
}

export const KEYS: KeyInfo[] = TONICS.map(([tonic, tonicPc]) => ({
  tonic, tonicPc, label: `${tonic} minor`, offset: offsetFromA(tonicPc),
}));

export function getKey(tonic: string): KeyInfo {
  return KEYS.find((k) => k.tonic === tonic) ?? KEYS[0];
}

// scale role: [semitones above tonic of scale root, letter steps above tonic letter, intervals, label template]
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARM = [0, 2, 3, 5, 7, 8, 11];
const ROLES: Record<ParentScaleId, { semis: number; letters: number; ints: number[] }> = {
  relMajor: { semis: 3, letters: 2, ints: MAJOR },
  harmMinor: { semis: 0, letters: 0, ints: HARM },
  bVIIMajor: { semis: 10, letters: 6, ints: MAJOR },
  bVIMajor: { semis: 8, letters: 5, ints: MAJOR },
};

interface Built {
  scales: Record<ParentScaleId, ParentScale>;
  names: Record<ParentScaleId, Map<number, string>>;
}
const cache = new Map<string, Built>();

function build(key: KeyInfo): Built {
  const hit = cache.get(key.tonic);
  if (hit) return hit;
  const tonicLetter = LETTERS.indexOf(key.tonic[0]);
  const scales = {} as Record<ParentScaleId, ParentScale>;
  const names = {} as Record<ParentScaleId, Map<number, string>>;
  for (const id of Object.keys(ROLES) as ParentScaleId[]) {
    const r = ROLES[id];
    const rootPc = mod(key.tonicPc + r.semis);
    const rootLetter = tonicLetter + r.letters;
    const pcs = r.ints.map((i) => mod(rootPc + i));
    const map = new Map<number, string>();
    pcs.forEach((pc, i) => map.set(pc, nameFor(rootLetter + i, pc)));
    const root = map.get(rootPc)!;
    const t = key.tonic;
    const label =
      id === "relMajor" ? `${root} major / ${t} natural minor`
      : id === "harmMinor" ? `${t} harmonic minor`
      : `${root} major`;
    const short =
      id === "relMajor" ? `${root} maj / ${t} min`
      : id === "harmMinor" ? `${t} harm min`
      : `${root} maj`;
    scales[id] = { id, name: id === "harmMinor" ? `${t} harmonic minor` : `${root} major`, label, short, rootPc, pcs };
    names[id] = map;
  }
  const b = { scales, names };
  cache.set(key.tonic, b);
  return b;
}

export function parentScales(key: KeyInfo): Record<ParentScaleId, ParentScale> {
  return build(key).scales;
}

/** Note name spelled diatonically in the given parent scale (chromatic notes fall back to key accidental). */
export function spell(pc: number, scale: ParentScaleId, key: KeyInfo): string {
  const hit = build(key).names[scale].get(mod(pc));
  if (hit) return hit;
  const flats = key.tonic.includes("b") || key.tonic === "F";
  return (flats ? ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])[mod(pc)];
}

/** Open-string MIDI notes, string 0 = high e. */
export const OPEN_MIDI = [64, 59, 55, 50, 45, 40];

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

/** Base windows as they sit in A minor, curriculum order. */
const BASE: { id: PositionId; from: number; to: number }[] = [
  { id: "V", from: 5, to: 8 },
  { id: "VII", from: 7, to: 10 },
  { id: "II", from: 2, to: 5 },
  { id: "IX", from: 9, to: 12 },
  { id: "XII", from: 12, to: 15 },
];

export function positionsFor(key: KeyInfo): Position[] {
  return BASE.map((b) => {
    let from = b.from + key.offset;
    let to = b.to + key.offset;
    if (from < 0) { from += 12; to += 12; }
    if (to > 15) { from -= 12; to -= 12; }
    return { id: b.id, label: from === 0 ? "Open position" : `Position ${ROMAN[from]}`, from, to };
  });
}

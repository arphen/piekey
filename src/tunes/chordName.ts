import { mod } from "../musicTheory";

// Names a voicing from its notes, for files that carry voicings but no chord symbols.
// The bass note is the likeliest root; the 5th may be left out.

const TEMPLATES: [string, number[]][] = [
  ["maj7", [0, 4, 7, 11]],
  ["7", [0, 4, 7, 10]],
  ["m7", [0, 3, 7, 10]],
  ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["m(maj7)", [0, 3, 7, 11]],
  ["m6", [0, 3, 7, 9]],
  ["6", [0, 4, 7, 9]],
  ["maj9", [0, 4, 7, 11, 2]],
  ["9", [0, 4, 7, 10, 2]],
  ["m9", [0, 3, 7, 10, 2]],
  ["7b9", [0, 4, 7, 10, 1]],
  ["13", [0, 4, 7, 10, 9]],
  ["7sus4", [0, 5, 7, 10]],
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["+", [0, 4, 8]],
  ["sus4", [0, 5, 7]],
];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function nameVoicing(midis: number[], flats: boolean): string | null {
  if (midis.length < 3) return null;
  const bass = mod(Math.min(...midis));
  const pcs = [...new Set(midis.map(mod))];
  if (pcs.length < 3) return null;
  let best: { name: string; score: number } | null = null;
  for (const root of pcs)
    for (const [suffix, ivs] of TEMPLATES) {
      const want = ivs.map((iv) => mod(root + iv));
      const extra = pcs.filter((pc) => !want.includes(pc)).length;
      const missing = want.filter((pc, i) => !pcs.includes(pc) && ivs[i] !== 7).length;
      if (missing > 0 || extra > 0) continue;
      const score = ivs.length * 2 + (root === bass ? 3 : 0) - (ivs.length > 4 ? 1 : 0);
      if (!best || score > best.score) {
        const names = flats ? FLAT_NAMES : SHARP_NAMES;
        best = { name: names[root] + suffix + (root === bass ? "" : `/${names[bass]}`), score };
      }
    }
  return best?.name ?? null;
}

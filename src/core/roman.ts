import { mod, noteNameToPitchClass } from "../musicTheory";

export interface RomanNumeral {
  numeral: string; // "♭VII", "ii"
  quality: string; // "7", "Δ7", "ø7", ""
}

// Accidentals are relative to the major scale on the tonic, the usual jazz convention, so in
// minor the relative major is ♭III and the subtonic ♭VII.
const DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♭V", "V", "♭VI", "VI", "♭VII", "VII"];

/** Roman numeral of a chord symbol ("Bm7b5", "F#maj7") relative to the key's tonic. */
export function romanNumeral(symbol: string, tonicPc: number): RomanNumeral | null {
  const m = symbol.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const pc = noteNameToPitchClass(m[1]);
  if (pc === null) return null;
  const suffix = m[2];
  const degree = DEGREES[mod(pc - tonicPc)];

  const minor = /^m(?!aj)/.test(suffix) || /^(dim|°)/.test(suffix);
  let quality = suffix;
  if (/^m7b5$/.test(suffix)) quality = "ø7";
  else if (/^(dim7|°7)$/.test(suffix)) quality = "°7";
  else if (/^(dim|°)$/.test(suffix)) quality = "°";
  else if (/^m\(?maj7\)?$/i.test(suffix)) quality = "Δ7";
  else if (minor) quality = suffix.slice(1);
  quality = quality.replace("maj7", "Δ7").replace(/b(\d)/g, "♭$1").replace(/#(\d)/g, "♯$1");

  return { numeral: minor ? lowerNumeral(degree) : degree, quality };
}

const lowerNumeral = (n: string) => n.replace(/[IV]+/, (s) => s.toLowerCase());

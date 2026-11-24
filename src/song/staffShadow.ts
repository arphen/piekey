import { mod } from "../musicTheory";
import { KEY_FIFTHS } from "./notation";

// Pure music-engraving geometry for wrong notes played against a written guitar staff.
// Treble clef staff positions (written pitch, an octave above guitar sounding pitch):
//   Bottom line E4 = 0, F4 = 1, G4 = 2, A4 = 3, B4 = 4, C5 = 5, D5 = 6, E5 = 7, Top line F5 = 8
//   Below staff: D4 = -1, C4 = -2 (1 ledger line), B3 = -3, A3 = -4 (2 ledger lines), ...
//   Above staff: G5 = 9, A5 = 10 (1 ledger line), B5 = 11, C6 = 12 (2 ledger lines), ...

const LETTERS = "cdefgab";
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const FLAT_LETTER = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
const TREBLE_BOTTOM_DIATONIC = 4 * 7 + 2; // E4 = 30

export interface StaffShadowInfo {
  /** Staff steps above (+) or below (-) the written target notehead. */
  steps: number;
  /** Accidental glyph needed in the active key signature: "♯", "♭", "♮", or "". */
  acc: string;
  /** Written staff position of the target note (E4 = 0, F5 = 8). */
  wantPos: number;
  /** Written staff position of the played ghost note (E4 = 0, F5 = 8). */
  ghostPos: number;
  /** True when the ghost note sits directly on a staff/ledger line (even staff position). */
  onLine: boolean;
  /** True when the ghost note sits inside or on the 5 main staff lines (0..8). */
  inStaff: boolean;
  /**
   * Ledger-line offsets in half-spaces relative to the ghost notehead's vertical center
   * (positive = downward in screen px, negative = upward in screen px).
   */
  ledgerHalfSpaces: number[];
  /** Signed semitone difference (played folded near target minus target). */
  semis: number;
  /** True when the player hit the right pitch class in the wrong octave. */
  octaveOff: boolean;
}

/** Fold `midi` into the nearest octave around `want` so staff comparison stays readable. */
export function foldNearTarget(midi: number, want: number): number {
  let m = midi;
  while (m - want > 6) m -= 12;
  while (want - m > 6) m += 12;
  return m;
}

/** Written treble-staff position of a VexFlow key like "c#/4" or "bb/5" (E4 = 0, F5 = 8). */
export function writtenStaffPos(vexKey: string): number {
  const m = /^([a-g])[^/]*\/(-?\d+)$/i.exec(vexKey.trim());
  if (!m) return 4; // B4 middle line fallback
  const letter = LETTERS.indexOf(m[1].toLowerCase());
  const octave = Number(m[2]);
  return octave * 7 + letter - TREBLE_BOTTOM_DIATONIC;
}

/**
 * Compute real staff-engraving geometry for a wrong pitch played against a written note:
 * exact relative staff steps, key-aware accidental, absolute staff position, and ledger-line offsets.
 */
export function analyzeWrongNote(midi: number, want: number, vexKey: string, keySignature: string): StaffShadowInfo {
  const fifths = KEY_FIFTHS[keySignature] ?? 0;
  const flats = fifths < 0;
  const altered = (flats ? [6, 2, 5, 1, 4, 0, 3] : [3, 0, 4, 1, 5, 2, 6]).slice(0, Math.abs(fifths));
  const folded = foldNearTarget(midi, want);
  const pc = mod(folded);
  const letter = (flats ? FLAT_LETTER : SHARP_LETTER)[pc];
  const black = pc !== NATURAL_PC[letter];
  const acc = black ? (altered.includes(letter) ? "" : flats ? "♭" : "♯") : altered.includes(letter) ? "♮" : "";

  const wantLetter = Math.max(0, LETTERS.indexOf((vexKey[0] ?? "b").toLowerCase()));
  const wantOctave = Math.round((want - NATURAL_PC[wantLetter]) / 12) - 1;
  const steps = (Math.floor(folded / 12) - 1) * 7 + letter - (wantOctave * 7 + wantLetter);

  const wantPos = writtenStaffPos(vexKey);
  const ghostPos = wantPos + steps;
  const onLine = Math.abs(ghostPos) % 2 === 0;
  const inStaff = ghostPos >= 0 && ghostPos <= 8;

  // Ledger lines exist at every even staff position <= -2 (below staff) or >= 10 (above staff).
  const ledgerHalfSpaces: number[] = [];
  if (ghostPos <= -2) {
    for (let linePos = -2; linePos >= ghostPos; linePos -= 2) {
      // Screen Y increases downward, so a line higher than ghostPos (linePos > ghostPos) is negative offset.
      ledgerHalfSpaces.push(ghostPos - linePos);
    }
  } else if (ghostPos >= 10) {
    for (let linePos = 10; linePos <= ghostPos; linePos += 2) {
      ledgerHalfSpaces.push(ghostPos - linePos);
    }
  }

  const semis = folded - want;
  const octaveOff = semis === 0 && midi !== want;
  return { steps, acc, wantPos, ghostPos, onLine, inStaff, ledgerHalfSpaces, semis, octaveOff };
}

/** Human-readable mechanical correction hint ("1 fret high ↓", "2 frets low ↑", "1 octave high ↓"). */
export function mistakeDeltaText(midi: number, want: number): string {
  const raw = midi - want;
  if (raw === 0) return "";
  const folded = foldNearTarget(midi, want);
  const semis = folded - want;
  if (semis === 0) {
    const octs = Math.round(Math.abs(raw) / 12);
    return `${octs} octave${octs === 1 ? "" : "s"} ${raw > 0 ? "high ↓" : "low ↑"}`;
  }
  const n = Math.abs(semis);
  return `${n} fret${n === 1 ? "" : "s"} ${semis > 0 ? "high ↓" : "low ↑"}`;
}

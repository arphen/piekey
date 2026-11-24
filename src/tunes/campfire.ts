import { mod, noteNameToPitchClass } from "../musicTheory";
import { windowAt } from "../song/fingering";
import { parseChord } from "../song/harmony";
import { voiceChords, type Voicing } from "../song/voicings";
import type { LeadSheet } from "./musicxml";

export interface CampfireBar {
  index: number;
  barNumber: string;
  chords: string[];
  repeatStart?: boolean;
  repeatEnd?: number;
  lyrics?: string;
}

export interface CampfireSection {
  title: string;
  startBar: number;
  bars: CampfireBar[];
}

export interface CampfireChord {
  symbol: string;
  voicing: Voicing;
}

export interface CampfireSheet {
  id: string;
  title: string;
  composer: string;
  key: string;
  tempo: number | null;
  transpose: number;
  hasChords: boolean;
  hasLyrics: boolean;
  palette: CampfireChord[];
  sections: CampfireSection[];
}

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEY_PCS = new Set([1, 3, 5, 8, 10]); // Db, Eb, F, Ab, Bb

function spellPc(pc: number, preferFlats: boolean): string {
  const n = mod(pc);
  return preferFlats ? FLATS[n] : SHARPS[n];
}

export function transposeKey(keySignature: string, semitones: number): string {
  const shift = mod(semitones);
  if (shift === 0) return keySignature;
  const m = keySignature.match(/^([A-G][#b]?)(m?)$/);
  if (!m) return keySignature;
  const pc = noteNameToPitchClass(m[1]);
  if (pc === null) return keySignature;
  const nextPc = mod(pc + shift);
  const isMinor = m[2] === "m";
  const preferFlats = isMinor ? [0, 2, 5, 7, 10].includes(nextPc) : FLAT_KEY_PCS.has(nextPc);
  return `${spellPc(nextPc, preferFlats)}${m[2]}`;
}

export function transposeChord(symbol: string, semitones: number, preferFlats = false): string {
  const shift = mod(semitones);
  if (shift === 0 || !symbol || symbol === "N.C.") return symbol;
  const m = symbol.replace(/♯/g, "#").replace(/♭/g, "b").match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return symbol;
  const [, root, quality, bass] = m;
  const rootPc = noteNameToPitchClass(root);
  if (rootPc === null) return symbol;
  const nextRoot = spellPc(rootPc + shift, preferFlats);
  if (!bass) return `${nextRoot}${quality}`;
  const bassPc = noteNameToPitchClass(bass);
  if (bassPc === null) return `${nextRoot}${quality}/${bass}`;
  return `${nextRoot}${quality}/${spellPc(bassPc + shift, preferFlats)}`;
}

/** Build a mobile-friendly section-grouped chord & lyric sheet for campfire / off-grid playing. */
export function buildCampfireSheet(sheet: LeadSheet, transpose = 0): CampfireSheet {
  const key = transposeKey(sheet.keySignature, transpose);
  const preferFlats = key.includes("b") || key === "F" || key === "Dm" || key === "Gm" || key === "Cm";

  const hasExplicitSections = sheet.bars.some((b) => Boolean(b.section));
  const sections: CampfireSection[] = [];
  const uniqueSymbols: string[] = [];
  const seen = new Set<string>();
  let hasChords = false;
  let hasLyrics = false;

  sheet.bars.forEach((bar, idx) => {
    const chords = bar.chordSymbols
      .filter((sym) => sym && sym !== "N.C.")
      .map((sym) => transposeChord(sym, transpose, preferFlats));
    if (chords.length) {
      hasChords = true;
      for (const sym of chords) {
        if (!seen.has(sym)) {
          seen.add(sym);
          uniqueSymbols.push(sym);
        }
      }
    }
    if (bar.lyrics) hasLyrics = true;

    const cBar: CampfireBar = {
      index: idx,
      barNumber: sheet.barNumbers[idx] ?? String(idx + 1),
      chords,
      ...(bar.repeatStart ? { repeatStart: true } : {}),
      ...(bar.repeatEnd ? { repeatEnd: bar.repeatEnd } : {}),
      ...(bar.lyrics ? { lyrics: bar.lyrics } : {}),
    };

    if (hasExplicitSections) {
      if (bar.section || !sections.length) {
        sections.push({
          title: bar.section ?? `Bars ${cBar.barNumber}–`,
          startBar: idx,
          bars: [cBar],
        });
      } else {
        sections[sections.length - 1].bars.push(cBar);
      }
    } else {
      const chunk = Math.floor(idx / 8);
      if (!sections[chunk]) {
        const end = Math.min(sheet.bars.length, (chunk + 1) * 8);
        sections[chunk] = {
          title: `Bars ${idx + 1}–${end}`,
          startBar: idx,
          bars: [],
        };
      }
      sections[chunk].bars.push(cBar);
    }
  });

  // Resolve open/low-neck campfire voicings for the unique chord palette
  const parsedChords: { symbol: string; chord: NonNullable<ReturnType<typeof parseChord>> }[] = [];
  for (const sym of uniqueSymbols) {
    const base = sym.split("/")[0]; // voiceChords voices root-position shells/triads
    const parsed = parseChord(base);
    if (parsed) parsedChords.push({ symbol: sym, chord: parsed });
  }
  const voicings = voiceChords(parsedChords.map((c) => c.chord), windowAt(0));
  const palette: CampfireChord[] = parsedChords.map((item, i) => ({
    symbol: item.symbol,
    voicing: voicings[i],
  }));

  return {
    id: sheet.id,
    title: sheet.title,
    composer: sheet.composer,
    key,
    tempo: sheet.tempo,
    transpose,
    hasChords,
    hasLyrics,
    palette,
    sections,
  };
}

import type { ReadingBar, ReadingExercise, ReadingNote } from "../core/contract";
import { noteName, type Card } from "./deck";
import { spellIn, type Scale } from "./harmony";

// Writes a practice line (a scale run, an arpeggio, a cadence line) as notation, so every
// exercise is read off the staff. Guitar notation: written an octave above where it sounds.

export const KEY_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
  Am: 0, Em: 1, Bm: 2, "F#m": 3, "C#m": 4, "G#m": 5, "D#m": 6, Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6,
};

const LETTERS = "cdefgab";
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ALTER: Record<string, number> = { "♭": -1, b: -1, "♯": 1, "#": 1, "𝄫": -2, "𝄪": 2 };
const DRAW: Record<number, ReadingNote["accidental"]> = { [-2]: "bb", [-1]: "b", 0: "n", 1: "#", 2: "##" };
const PLAIN = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/** Letters the key signature alters, as letter index → semitones. */
export function signatureOf(key: string): number[] {
  const fifths = KEY_FIFTHS[key] ?? 0;
  const out = [0, 0, 0, 0, 0, 0, 0];
  (fifths < 0 ? [6, 2, 5, 1, 4, 0, 3] : [3, 0, 4, 1, 5, 2, 6]).slice(0, Math.abs(fifths)).forEach((l) => (out[l] = fifths < 0 ? -1 : 1));
  return out;
}

function value(beats: number): Pick<ReadingNote, "duration" | "dotted" | "tuplet"> {
  if (near(beats, 1 / 3)) return { duration: "8", dotted: false, tuplet: { actual: 3, normal: 2 } };
  if (near(beats, 2 / 3)) return { duration: "q", dotted: false, tuplet: { actual: 3, normal: 2 } };
  const b = PLAIN.find((x) => x <= beats + 1e-3) ?? 0.25;
  const duration = (b >= 4 ? "w" : b >= 2 ? "h" : b >= 1 ? "q" : b >= 0.5 ? "8" : "16") as ReadingNote["duration"];
  return { duration, dotted: near(b, 3) || near(b, 1.5) || near(b, 0.75) };
}

function rests(from: number, to: number): ReadingNote[] {
  const out: ReadingNote[] = [];
  let t = from;
  while (to - t > 0.2) {
    const b = PLAIN.find((x) => x <= to - t + 1e-3 && !near(x, 3) && !near(x, 1.5) && !near(x, 0.75)) ?? 0.25;
    out.push({ rest: true, midi: 0, vexKey: "b/4", accidental: null, ...value(b), startBeat: t, durationBeats: b, string: 0, fret: 0 });
    t += b;
  }
  return out;
}

/** The card's notes as bars of notation in `keySignature`. Non-rest notes run parallel to the card's targets, first to last. */
export function lineSheet(card: Card, keySignature: string): Pick<ReadingExercise, "bars" | "keySignature" | "timeSignature"> {
  const signature = signatureOf(keySignature);
  const t0 = card.tl.slots[card.from].start;
  let lastChord = "";
  const bars: ReadingBar[] = [];
  for (let s = card.from; s <= card.to; s++) {
    const slot = card.tl.slots[s];
    const end = slot.start + slot.beats;
    const inBar = new Map<string, number>(); // accidentals already written in this bar
    const notes: ReadingNote[] = [];
    const chordSymbols: string[] = [];
    const chordBeats: number[] = [];
    let at = slot.start;
    for (let i = card.first; i <= card.last; i++) {
      const target = card.tl.targets[i];
      if (target.t < slot.start - 1e-6 || target.t >= end - 1e-6) continue;
      notes.push(...rests(at, target.t));
      const name = noteName(card, i);
      const letter = Math.max(0, LETTERS.indexOf(name[0].toLowerCase()));
      const alter = [...name.slice(1)].reduce((n, ch) => n + (ALTER[ch] ?? 0), 0);
      const written = target.midi + 12;
      const octave = Math.round((written - NATURAL_PC[letter] - alter) / 12) - 1;
      const place = `${letter}/${octave}`;
      const standing = inBar.get(place) ?? signature[letter];
      inBar.set(place, alter);
      const off = target.t - Math.floor(target.t + 1e-6);
      // a long last note that lands inside a triplet closes the triplet; the rest of the bar is rests
      const dur = near(off, 1 / 3) || near(off, 2 / 3) ? 1 / 3 : Math.min(target.dur, end - target.t);
      const v = value(dur);
      const shown = v.tuplet ? dur : PLAIN.find((x) => x <= dur + 1e-3) ?? dur; // an odd length is written short, then a rest
      const sym = card.context[i]?.chord?.symbol ?? "";
      if (card.family !== "scales" && card.family !== "technique" && sym && sym !== lastChord) {
        chordSymbols.push(sym);
        chordBeats.push(target.t - slot.start);
        lastChord = sym;
      }
      notes.push({
        rest: false,
        midi: target.midi,
        vexKey: `${LETTERS[letter]}${alter === 0 ? "" : DRAW[alter]}/${octave}`,
        accidental: alter === standing ? null : DRAW[alter] ?? null,
        ...v,
        startBeat: target.t - t0,
        durationBeats: shown,
        string: card.steps[i]?.string ?? 0,
        fret: card.steps[i]?.fret ?? 0,
      });
      at = target.t + shown;
    }
    notes.push(...rests(at, end));
    bars.push({ barIndex: s - card.from, chordSymbols, chordBeats, notes, beats: slot.beats });
  }
  const barBeats = card.tl.slots[card.from]?.beats ?? 4;
  return { bars, keySignature, timeSignature: barBeats === 3 ? "3/4" : "4/4" };
}

/** "Bb", "F#m": the key signature a scale is written in ("C" when it has none of its own). */
export function signatureFor(scale: Scale): string {
  const name = scale.names[0].replace("♭", "b").replace("♯", "#") + (scale.kind === "major" ? "" : "m");
  return name in KEY_FIFTHS ? name : "C";
}

/** Notes as they were played, written in the key they were heard in: each `noteBeats` long, four beats to the bar. */
export function playedSheet(midis: number[], scale: Scale, noteBeats: number): Pick<ReadingExercise, "bars" | "keySignature" | "timeSignature"> {
  const keySignature = signatureFor(scale);
  const signature = signatureOf(keySignature);
  const perBar = Math.max(1, Math.round(4 / noteBeats));
  const bars: ReadingBar[] = [];
  for (let from = 0; from < Math.max(1, midis.length); from += perBar) {
    const inBar = new Map<string, number>();
    const notes: ReadingNote[] = midis.slice(from, from + perBar).map((midi, k) => {
      const name = spellIn(scale, midi);
      const letter = Math.max(0, LETTERS.indexOf(name[0].toLowerCase()));
      const alter = [...name.slice(1)].reduce((n, ch) => n + (ALTER[ch] ?? 0), 0);
      const octave = Math.round((midi + 12 - NATURAL_PC[letter] - alter) / 12) - 1;
      const place = `${letter}/${octave}`;
      const standing = inBar.get(place) ?? signature[letter];
      inBar.set(place, alter);
      return {
        rest: false,
        midi,
        vexKey: `${LETTERS[letter]}${alter === 0 ? "" : DRAW[alter]}/${octave}`,
        accidental: alter === standing ? null : DRAW[alter] ?? null,
        ...value(noteBeats),
        startBeat: from * noteBeats + k * noteBeats,
        durationBeats: noteBeats,
        string: 0,
        fret: 0,
      };
    });
    const start = from * noteBeats;
    notes.push(...rests(start + notes.length * noteBeats, start + 4));
    bars.push({ barIndex: bars.length, chordSymbols: [], chordBeats: [], notes, beats: 4 });
  }
  return { bars, keySignature, timeSignature: "4/4" };
}

import { pitchClassToName } from "../musicTheory";
import type { LeadSheet } from "../tunes/musicxml";
import type { Timeline } from "../tunes/order";

/** Source attack times, tied chains, gaps and playing order stay exact; only the pitch changes. */
export function isolateRhythm(source: Timeline, midi: number): Timeline {
  return {
    slots: source.slots.map((slot) => ({ ...slot })),
    targets: source.targets.map((target) => ({ ...target, notes: [...target.notes], midi, any: undefined, chord: undefined })),
    comp: [],
    total: source.total,
  };
}

/** Keep the original rests, ties, tuplets and note indices for the isolated score display. */
export function rhythmSheet(source: LeadSheet, midi: number): LeadSheet {
  const name = pitchClassToName(midi).toLowerCase();
  const vexKey = `${name}/${Math.floor(midi / 12)}`; // guitar is written an octave above sounding
  return {
    ...source,
    keySignature: "C",
    comp: [],
    bars: source.bars.map((bar) => ({
      ...bar,
      keyChange: undefined,
      chordSymbols: [],
      chordBeats: [],
      notes: bar.notes.map((note) => note.rest ? { ...note } : { ...note, midi, vexKey, accidental: name.includes("#") ? "#" : null }),
    })),
  };
}

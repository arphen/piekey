import { intervalToDegree, mod } from "../musicTheory";
import type { ChordInBar, FretNote, KeyInfo, NoteRole, Position } from "./contract";
import { OPEN_MIDI, parentScales, spell } from "./scales";

export function fretboardNotes(args: {
  chord: ChordInBar;
  prevChord?: ChordInBar;
  nextChord?: ChordInBar;
  position: Position;
  fretCount: number;
  key: KeyInfo;
}): FretNote[] {
  const { chord, prevChord, nextChord, position, fretCount, key } = args;
  const PS = parentScales(key);
  const scale = PS[chord.parentScale];
  const prevScale = prevChord ? PS[prevChord.parentScale] : undefined;
  const changedPcs = new Set<number>();
  if (prevScale && prevScale.id !== scale.id) {
    for (const pc of scale.pcs) if (!prevScale.pcs.includes(pc)) changedPcs.add(pc);
  }
  const nextGuides = new Set(nextChord?.guideTones ?? []);
  const out: FretNote[] = [];
  for (let s = 0; s < 6; s++) {
    for (let fret = 0; fret <= fretCount; fret++) {
      const midi = OPEN_MIDI[s] + fret;
      const pc = mod(midi);
      if (!scale.pcs.includes(pc)) continue;
      let role: NoteRole = "scale";
      if (pc === chord.rootPc) role = "root";
      else if (chord.guideTones.includes(pc)) role = "guideTone";
      else if (chord.chordTones.includes(pc)) role = "chordTone";
      else if (changedPcs.has(pc)) role = "changed";
      out.push({
        string: s,
        fret,
        pc,
        midi,
        name: spell(pc, chord.parentScale, key),
        degree: intervalToDegree(pc - chord.rootPc),
        role,
        inWindow: fret >= position.from && fret <= position.to,
        isNextTarget: nextGuides.has(pc),
      });
    }
  }
  return out;
}

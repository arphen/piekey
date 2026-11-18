import type { TuneEntry } from "./library";

// An original eight-bar study: a useful first session without finding or uploading a score.
// Pitches use the reader's octave-clef convention, matching the sounding range in the study notes.
const bars: { chord: string; kind: string; notes: string[] }[] = [
  { chord: "C", kind: "major", notes: ["C4", "E4", "G4", "E4"] },
  { chord: "A", kind: "minor", notes: ["A4", "G4", "E4", "C4"] },
  { chord: "D", kind: "minor", notes: ["D4", "F4", "A4", "F4"] },
  { chord: "G", kind: "dominant", notes: ["G4", "F4", "D4", "B3"] },
  { chord: "C", kind: "major", notes: ["C4", "D4", "E4", "G4"] },
  { chord: "A", kind: "minor", notes: ["A4", "G4", "E4", "C4"] },
  { chord: "G", kind: "dominant", notes: ["D4", "F4", "D4", "B3"] },
  { chord: "C", kind: "major", notes: ["C4", "E4", "D4", "C4"] },
];

// Quiet, separated pulses below the melody; each three-note shape fits standard guitar tuning.
const chords = [
  ["C3", "E3", "G3"], ["A2", "C3", "E3"], ["D3", "F3", "A3"], ["G2", "B2", "F3"],
  ["C3", "E3", "G3"], ["A2", "C3", "E3"], ["G2", "B2", "F3"], ["C3", "E3", "G3"],
];
const chordPulse = (notes: string[]) => notes.map((note, index) => `<note>${index ? "<chord/>" : ""}<pitch><step>${note[0]}</step><octave>${note.slice(1)}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("");

export const STARTER_ENTRY: TuneEntry = {
  id: "starter-first-steps",
  name: "First Steps",
  xml: `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0"><work><work-title>First Steps</work-title></work>
<identification><creator type="composer">Fretboard Focus Lab</creator><rights>Original study and accompaniment for Fretboard Focus Lab. SPDX-License-Identifier: AGPL-3.0-only.</rights><miscellaneous><miscellaneous-field name="provenance">Original melody and arrangement created for this project; no third-party score or recording used.</miscellaneous-field><miscellaneous-field name="practice-notes">Keep four even melody notes over two quiet chord pulses per bar. Sounding melody B3–A4; use the open B and high E strings, frets 1 and 3, and a brief shift to fret 5 for A.</miscellaneous-field></miscellaneous></identification>
<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part><score-part id="P2"><part-name>Guitar chords</part-name></score-part></part-list><part id="P1">
${bars.map((bar, index) => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes><direction><direction-type><rehearsal>A</rehearsal></direction-type><sound tempo="72"/></direction>' : ""}<harmony><root><root-step>${bar.chord}</root-step></root><kind>${bar.kind}</kind></harmony>${bar.notes.map((note) => `<note><pitch><step>${note[0]}</step><octave>${note.slice(1)}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure>`).join("\n")}
</part><part id="P2">
${chords.map((notes, index) => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>' : ""}${chordPulse(notes)}<note><rest/><duration>1</duration><type>quarter</type></note>${chordPulse(notes)}<note><rest/><duration>1</duration><type>quarter</type></note></measure>`).join("\n")}
</part></score-partwise>`,
};

import type { TuneEntry } from "./library";

// An original eight-bar study: a useful first session without finding or uploading a score.
// Written guitar notes sound an octave lower, as with imported guitar lead sheets.
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

export const STARTER_ENTRY: TuneEntry = {
  id: "starter-first-steps",
  name: "First Steps",
  xml: `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0"><work><work-title>First Steps</work-title></work>
<identification><creator type="composer">Fretboard Focus Lab</creator></identification>
<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1">
${bars.map((bar, index) => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes><direction><direction-type><rehearsal>A</rehearsal></direction-type><sound tempo="72"/></direction>' : ""}<harmony><root><root-step>${bar.chord}</root-step></root><kind>${bar.kind}</kind></harmony>${bar.notes.map((note) => `<note><pitch><step>${note[0]}</step><octave>${note.slice(1)}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure>`).join("\n")}
</part></score-partwise>`,
};

import blueHourXml from "./demos/blue-hour.musicxml?raw";
import { sameTuneContent, type TuneEntry } from "./library";
import { STARTER_ENTRY } from "./starter";

export interface DemoStudy {
  purpose: string;
  startingPoint: string;
  fingering: string;
  listenFor: string;
  easier: {
    /** One-based inclusive printed bars, before repeat expansion. */
    bars: readonly [number, number];
    instruction: string;
  };
  transfer: string;
}

export interface DemoTune {
  entry: TuneEntry;
  title: string;
  description: string;
  label: string;
  study: DemoStudy;
}

export const BLUE_HOUR_ENTRY: TuneEntry = {
  id: "demo-blue-hour-v1",
  name: "Blue Hour",
  xml: blueHourXml,
};

/** Bundled original studies; their stable library IDs preserve practice and recordings. */
export const DEMO_TUNES: readonly DemoTune[] = [
  {
    entry: STARTER_ENTRY,
    title: "First Steps",
    description: "Eight bars in C at 72 BPM. Four steady notes a bar over soft chords.",
    label: "Original study",
    study: {
      purpose: "Keep four even notes moving through each chord change.",
      startingPoint: "You can pick single notes and make one short position shift.",
      fingering: "Optional melody route: open B and high E strings, frets 1 and 3, with a shift to fret 5 for A. Other exercises may use another position.",
      listenFor: "Two quiet chords per bar. Keep your four notes even against them.",
      easier: { bars: [1, 1], instruction: "Loop C–E–G–E at your own pace, then hold the same spacing against the chords." },
      transfer: "Keep bar 1's rhythm and write a different four-note answer from C, E and G.",
    },
  },
  {
    entry: BLUE_HOUR_ENTRY,
    title: "Blue Hour",
    description: "Twelve-bar blues in C at 76 BPM. Short phrases with room to breathe, over light chords.",
    label: "Original study",
    study: {
      purpose: "Play the rests as carefully as the notes, then carry the phrase through the Dm7–G7 turnaround.",
      startingPoint: "You are comfortable with eighth notes and flats, and can change chords twice in a bar.",
      fingering: "The melody fits frets 5–8 on strings 5, 4 and 3; use one finger per fret as a starting option.",
      listenFor: "The chords leave gaps. Count through your rests instead of filling them.",
      easier: { bars: [1, 2], instruction: "Echo the two-bar question and answer, silent first and last beats included." },
      transfer: "In bars 3–4, answer with a new short phrase from C, E, G and B♭. Leave one beat silent.",
    },
  },
];

/** Authored cues apply only to this arrangement, never a user's edited study or alternate part. */
export function getDemoStudy(entry: TuneEntry): DemoStudy | undefined {
  return DEMO_TUNES.find((demo) => demo.entry.id === entry.id && sameTuneContent(demo.entry, entry))?.study;
}

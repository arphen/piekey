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
    description: "Eight bars in C at 72 BPM: a steady quarter-note melody over gentle chord pulses.",
    label: "Original study",
    study: {
      purpose: "Keep four even notes moving through each chord change.",
      startingPoint: "For players comfortable picking single notes and making a short position shift.",
      fingering: "Optional melody route: open B and high E strings, frets 1 and 3, with a shift to fret 5 for A. Other exercises may use another position.",
      listenFor: "Hear two quiet chord pulses per bar while your four melody notes stay even.",
      easier: { bars: [1, 1], instruction: "Loop C–E–G–E at your own pace, then keep the same spacing with the pulse." },
      transfer: "Keep bar 1's rhythm and make a different four-note answer using C, E and G.",
    },
  },
  {
    entry: BLUE_HOUR_ENTRY,
    title: "Blue Hour",
    description: "A 12-bar C jazz blues at 76 BPM, with even eighths, breathing spaces and spare shell chords.",
    label: "Original study",
    study: {
      purpose: "Let the rests speak, then carry the phrase through the Dm7–G7 turnaround.",
      startingPoint: "For players ready for eighth notes, flats and two chord changes within a bar.",
      fingering: "The melody fits frets 5–8 on strings 5, 4 and 3; use one finger per fret as a starting option.",
      listenFor: "The chord attacks leave gaps; keep counting through your own rests instead of filling them.",
      easier: { bars: [1, 2], instruction: "Echo the two-bar question and answer, including the first and last silent beats." },
      transfer: "Over bars 3–4, answer with a new short phrase using C, E, G and B♭, leaving one beat silent.",
    },
  },
];

/** Authored cues apply only to this arrangement, never a user's edited study or alternate part. */
export function getDemoStudy(entry: TuneEntry): DemoStudy | undefined {
  return DEMO_TUNES.find((demo) => demo.entry.id === entry.id && sameTuneContent(demo.entry, entry))?.study;
}

import blueHourXml from "./demos/blue-hour.musicxml?raw";
import type { TuneEntry } from "./library";
import { STARTER_ENTRY } from "./starter";

export interface DemoTune {
  entry: TuneEntry;
  title: string;
  description: string;
  label: string;
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
    description: "An eight-bar C major melody at 72 BPM, with quarter notes throughout.",
    label: "Original study",
  },
  {
    entry: BLUE_HOUR_ENTRY,
    title: "Blue Hour",
    description: "A 12-bar C jazz blues at 76 BPM, with short phrases, rests and a Dm7–G7 turnaround.",
    label: "Original study",
  },
];

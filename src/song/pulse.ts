/** A beat being heard, rather than one scheduled ahead of the speakers. */
export interface BeatSignal {
  index: number; // 0 is the bar's first beat; -1 while stopped
  serial: number; // changes for each heard beat, including repeated bars
  active: boolean;
  beats: number;
  counting: boolean;
}

export const IDLE_BEAT: BeatSignal = { index: -1, serial: 0, active: false, beats: 4, counting: false };

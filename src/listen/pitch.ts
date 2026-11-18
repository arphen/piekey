import { detectPitchFromBuffer, midiOfFrequency } from "../pitchDetection";
import "./calibration"; // a saved calibration applies from the first frame
import type { InputFrame } from "./useInput";

// Several listeners can share one input; the pitch of a frame is worked out once.
const cache = new WeakMap<InputFrame, number | null>();

/** Nearest MIDI note sounding in this frame, or null. */
export function midiOf(frame: InputFrame): number | null {
  let m = cache.get(frame);
  if (m === undefined) {
    const r = detectPitchFromBuffer(frame.buf, frame.sampleRate);
    m = r.frequency === null ? null : midiOfFrequency(r.frequency);
    cache.set(frame, m);
  }
  return m;
}

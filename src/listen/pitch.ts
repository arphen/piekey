import { detectPitchFromBuffer, midiOfFrequency, type DetectionResult } from "../pitchDetection";
import "./calibration"; // a saved calibration applies from the first frame
import type { InputFrame } from "./useInput";

// Several listeners can share one input; the pitch of a frame is worked out once.
const cache = new WeakMap<InputFrame, DetectionResult>();

/** Frequency and confidence from the shared detector, computed once per input frame. */
export function pitchOf(frame: InputFrame): DetectionResult {
  let result = cache.get(frame);
  if (!result) {
    result = detectPitchFromBuffer(frame.buf, frame.sampleRate);
    cache.set(frame, result);
  }
  return result;
}

/** Nearest MIDI note sounding in this frame, or null. */
export function midiOf(frame: InputFrame): number | null {
  const result = pitchOf(frame);
  return result.frequency === null ? null : midiOfFrequency(result.frequency);
}

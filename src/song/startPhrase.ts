import { mod } from "../musicTheory";
import { OPEN_STRINGS } from "./notekeys";

// A short musical phrase to start a practice session from the guitar: play any 3 distinct
// fretted notes in succession. Unlike holding one single note (which collides with the option
// keys and loses sustain on acoustic strings), a quick 3-note motif is unmistakable, never
// triggers option holds, and leaves open strings completely free for tuning.

export const START_PHRASE_LENGTH = 3;
const STABLE_MS = 55; // a note must hold briefly so pick transients / fret buzz never count
const NOTE_GAP_MS = 1800; // max pause between consecutive notes of the phrase
const PHRASE_MAX_MS = 3500; // max total span from note 1 to note 3
const PRIME_QUIET_FRAMES = 3; // ignore a note already ringing when Ready first appears

export interface StartPhraseState {
  notes: number[];
  progress: number; // 0..1
  fired: boolean;
}

export interface StartPhraseTracker {
  step(midi: number | null, now: number): StartPhraseState;
  reset(): void;
}

export function createStartPhrase(): StartPhraseTracker {
  let primed = false;
  let quietFrames = 0;
  let initialMidi: number | null = null;
  let notes: number[] = [];
  let firstAt = 0;
  let lastAcceptedAt = 0;
  let candidateMidi: number | null = null;
  let candidateSince = 0;
  let candidateSeen = 0;
  let fired = false;

  const clearPhrase = () => {
    notes = [];
    firstAt = 0;
    lastAcceptedAt = 0;
  };

  const reset = () => {
    primed = false;
    quietFrames = 0;
    initialMidi = null;
    candidateMidi = null;
    candidateSince = 0;
    candidateSeen = 0;
    fired = false;
    clearPhrase();
  };

  const step = (heard: number | null, now: number): StartPhraseState => {
    if (fired) return { notes, progress: 1, fired: true };

    if (!primed) {
      if (heard === null) {
        quietFrames++;
      } else {
        quietFrames = 0;
        initialMidi ??= heard;
      }
      if (quietFrames >= PRIME_QUIET_FRAMES || (heard !== null && heard !== initialMidi)) {
        primed = true;
      } else {
        return { notes: [], progress: 0, fired: false };
      }
    }

    // Expire an unfinished phrase if the player pauses too long.
    if (notes.length > 0 && (now - lastAcceptedAt > NOTE_GAP_MS || now - firstAt > PHRASE_MAX_MS)) {
      clearPhrase();
    }

    // Exact open strings stay free for tuning.
    const fretted = heard !== null && !OPEN_STRINGS.includes(heard) ? heard : null;
    if (fretted !== null) {
      if (candidateMidi !== fretted) {
        candidateMidi = fretted;
        candidateSince = now;
      }
      candidateSeen = now;

      if (now - candidateSince >= STABLE_MS) {
        const prev = notes[notes.length - 1];
        // Ignore the same pitch class as the previous note (prevents octave detector slips from advancing).
        if (prev === undefined || mod(fretted) !== mod(prev)) {
          if (notes.length === 0) firstAt = now;
          notes = [...notes, fretted];
          lastAcceptedAt = now;
          if (notes.length >= START_PHRASE_LENGTH) {
            fired = true;
            return { notes, progress: 1, fired: true };
          }
        }
      }
    } else if (candidateMidi !== null && now - candidateSeen > 90) {
      candidateMidi = null;
    }

    return { notes, progress: notes.length / START_PHRASE_LENGTH, fired: false };
  };

  return { step, reset };
}

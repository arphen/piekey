// Shared contract between the logic layer (src/core, src/audio, src/tutor)
// and the UI layer (src/App.tsx, src/components, src/styles.css).
// Change only by agreement: UI code is written against these types.

// ---------- music data ----------

// Parent scales are roles relative to the minor key (examples for A minor):
// relMajor = C major / A natural minor, harmMinor = A harmonic minor,
// bVIIMajor = G major (level 2), bVIMajor = F major (level 2).
export type ParentScaleId = "relMajor" | "harmMinor" | "bVIIMajor" | "bVIMajor";

export interface ParentScale {
  id: ParentScaleId;
  name: string; // "C major" | "A harmonic minor"
  label: string; // "C major / A natural minor"
  short: string; // "C maj / A min"
  rootPc: number;
  pcs: number[]; // 7 pitch classes
}

// The tune is in a minor key; all 12 are supported.
export interface KeyInfo {
  tonic: string; // "A", "F#", "Bb" — conventional spelling
  tonicPc: number;
  label: string; // "A minor"
  offset: number; // semitones from A minor, -5..+6
}

export interface ChordInBar {
  symbol: string; // "Bm7b5"
  rootPc: number;
  beats: number; // 4, or 2 when two chords share a bar
  parentScale: ParentScaleId;
  modeName: string; // "B locrian ♮6"
  chordTones: number[]; // pcs, root first
  guideTones: number[]; // [3rd, 7th] pcs
  why: string; // one-line teaching note
}

export interface Bar {
  index: number; // 0-based
  section: string; // "A1" | "A2" | "B" | "C"
  chords: ChordInBar[];
}

export interface Tune {
  id: string;
  title: string;
  key: string; // "A minor"
  bars: Bar[];
}

export type HarmonyLevel = 1 | 2;

// Position ids name the SHAPE as it sits in A minor; for other keys the window
// shifts by the key offset so the shape (and fingering) stays identical.
export type PositionId = "II" | "V" | "VII" | "IX" | "XII";
export interface Position {
  id: PositionId;
  label: string; // actual frets in the current key: "Position III"
  from: number; // first fret of window (inclusive)
  to: number; // last fret (inclusive)
}

// ---------- fretboard ----------

// string 0 = high e, 5 = low E
export type NoteRole =
  | "root" // chord root
  | "guideTone" // 3rd / 7th of current chord
  | "chordTone" // 5th (and other chord tones)
  | "scale" // other parent-scale tones
  | "changed"; // scale tone that differs from previous bar's parent scale (G vs G#)

export interface FretNote {
  string: number;
  fret: number;
  pc: number;
  midi: number;
  name: string; // "G#"
  degree: string; // relative to chord root: "1", "b3", "5", "b7", ...
  role: NoteRole;
  inWindow: boolean; // inside the selected position window
  isNextTarget: boolean; // guide tone of the NEXT chord (voice-leading target)
}

export type PatternId = "scale" | "thirds" | "triads" | "sevenths" | "guideTones" | "arpChain";

export interface PatternStep {
  string: number;
  fret: number;
  pc: number;
  midi: number;
  startBeat: number; // beats from pattern start
  durationBeats: number;
}

// ---------- functions provided by src/core/index.ts ----------
// KEYS: KeyInfo[]                             (12 minor keys, A minor first)
// getKey(tonic: string): KeyInfo              (falls back to A minor)
// getTune(level: HarmonyLevel, key: KeyInfo): Tune   (chord symbols spelled for the key)
// parentScales(key: KeyInfo): Record<ParentScaleId, ParentScale>
// positionsFor(key: KeyInfo): Position[]      (curriculum order: V, VII, II, IX, XII; windows within frets 0..15)
// spell(pc: number, scale: ParentScaleId, key: KeyInfo): string
// fretboardNotes(args: { chord: ChordInBar; prevChord?: ChordInBar; nextChord?: ChordInBar;
//                        position: Position; fretCount: number; key: KeyInfo }): FretNote[]
//      -> every parent-scale note on frets 0..fretCount on all 6 strings
// buildPattern(id: PatternId, chord: ChordInBar, position: Position, key: KeyInfo): PatternStep[]
// landingMoves(from: ChordInBar, to: ChordInBar, key: KeyInfo): string[]
// PATTERN_LABELS: Record<PatternId, string>

// ---------- audio: src/audio/usePlayer.ts ----------

export interface Mix {
  click: number; // 0..1
  bass: number;
  comp: number;
  drums: number;
}

export interface PlayerState {
  ready: boolean; // samples loaded
  isPlaying: boolean;
  bpm: number;
  swing: number; // 0..1
  clickOn24: boolean; // jazz click on 2 & 4 instead of every beat
  countIn: boolean;
  loop: { start: number; end: number }; // bar indices inclusive
  currentBar: number; // -1 when stopped
  currentBeat: number; // 0..3
  patternStepIndex: number; // index into active pattern, -1 if none
  mix: Mix;
}

export interface PlayerApi extends PlayerState {
  play(): Promise<void>; // must be called from a user gesture (unlocks AudioContext)
  stop(): void;
  toggle(): Promise<void>;
  setBpm(bpm: number): void;
  setSwing(s: number): void;
  setClickOn24(on: boolean): void;
  setCountIn(on: boolean): void;
  setLoop(start: number, end: number): void;
  setMix(mix: Partial<Mix>): void;
  setPattern(steps: PatternStep[] | null, audible: boolean): void; // cursor + optional guide melody
}
// usePlayer(tune: Tune): PlayerApi

// ---------- tutor: src/tutor/useTutor.ts ----------

export type ExerciseKind = "warmup" | "pattern" | "connection" | "freeplay" | "reading";

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  title: string; // "Thirds over bars 1–8"
  instructions: string; // what to do, concretely
  why: string;
  minutes: number;
  patternId: PatternId | null;
  positionId: PositionId;
  loop: { start: number; end: number };
  bpm: number;
  result: "clean" | "sloppy" | null;
}

export interface Session {
  date: string; // YYYY-MM-DD
  unitLabel: string; // "Position V · A section · Thirds"
  exercises: Exercise[];
}

export interface TutorApi {
  session: Session;
  activeExerciseId: string | null;
  startExercise(id: string): void; // UI then applies loop/bpm/pattern to player
  markResult(id: string, result: "clean" | "sloppy"): void;
  streakDays: number;
  history: { date: string; unitLabel: string; clean: number; total: number }[];
  curriculumProgress: { done: number; total: number };
  harmonyLevel: HarmonyLevel;
  resetProgress(): void;
}
// useTutor(key: KeyInfo): TutorApi   (persists to localStorage, try/catch every access; progress kept per key)

// ---------- learning path (v3 tutor) ----------
// The tutor is a linear path of steps, each with a concrete "done when" criterion.
// The daily Session is derived from the path: review previous step, work current step, apply over backing.

export interface LandingMove {
  from: string; // chord symbol, "Dm7"
  to: string; // "G7"
  moves: string[]; // ["C → B (7th falls a half step to the 3rd)", "F stays (7th of G7)"]
}

export interface PathStep {
  id: string;
  stage: number; // 1-based
  stageTitle: string; // "Home shape"
  title: string; // "Learn A minor in position V"
  goal: string; // why this step matters, one or two sentences
  todo: string[]; // ordered concrete instructions
  doneWhen: string; // familiarity criterion the student self-checks
  loop: { start: number; end: number };
  positionId: PositionId;
  patternId: PatternId | null;
  bpm: number; // suggested working tempo
  goalBpm: number; // tempo for "done"
  memoryTest: boolean; // suggest hiding fretboard notes for the done check
  landings: LandingMove[]; // empty unless the step is about connecting chords
}

export interface PathApi {
  path: PathStep[];
  currentIndex: number;
  completeStep(): void; // "I've got it" → advance
  goToStep(index: number): void; // revisit any earlier/later step
}
// useTutor(key: KeyInfo): TutorApi & PathApi

// ---------- sight reading ----------
// Melodies generated over the tune's changes, written in treble clef an octave above sounding pitch
// (standard guitar notation). Every note also carries a fingering inside the position window.

export type ReadingLevel = 1 | 2 | 3 | 4;
// 1: quarter notes, stepwise, chord tone on beat 1
// 2: 8ths + quarters, steps and thirds
// 3: arpeggio leaps, dotted quarter + 8th, rests
// 4: syncopation / anticipations, chromatic approach notes (accidentals)

export interface ReadingNote {
  rest: boolean;
  midi: number; // sounding pitch (ignore when rest)
  vexKey: string; // WRITTEN pitch in VexFlow form, e.g. "f#/5"; rests use "b/4"
  accidental: "#" | "b" | "n" | "##" | "bb" | null; // to draw, given the key signature and earlier notes in the bar
  duration: "w" | "h" | "q" | "8" | "16" | "32"; // VexFlow duration (without "r")
  dotted: boolean;
  startBeat: number; // from exercise start
  durationBeats: number;
  string: number; // fingering (ignore when rest)
  fret: number;
  tieToNext?: boolean; // tied into the next note (loaded tunes)
  tuplet?: { actual: number; normal: number; edge?: "start" | "stop" }; // e.g. 3 in the time of 2
  slur?: { start?: number; stop?: number }; // slur numbers starting / ending on this note
  vibrato?: "start" | "stop" | "both"; // wavy line over a span of notes
}

// Navigation marks of loaded tunes. The playing order follows them (src/tunes/order.ts).
export type JumpKind = "segno" | "coda" | "toCoda" | "fine" | "dc" | "ds";

export interface ReadingBar {
  barIndex: number; // index into tune.bars
  chordSymbols: string[];
  chordBeats?: number[]; // beat in the bar where each chord starts; evenly spread when absent
  notes: ReadingNote[]; // durations fill exactly 4 beats (loaded tunes: the bar's own length)
  // loaded tunes only:
  beats?: number; // the bar's length in quarter beats
  repeatStart?: boolean;
  repeatEnd?: number; // play the repeat this many times in all
  volta?: { label: string; numbers: number[]; begin: boolean; end: boolean; closed: boolean };
  section?: string; // rehearsal mark
  tempo?: number; // quarter-note bpm marked here
  keyChange?: string; // VexFlow key spec, when the key changes at this bar
  timeChange?: string;
  barline?: "double" | "final";
  jumps?: { kind: JumpKind; text: string }[]; // "D.S. al Coda", "To Coda", "Fine", segno and coda signs
  lyrics?: string; // combined vocal lyric text for this bar when present in the score
}

export interface ReadingExercise {
  id: string; // stable for (key, level, loop, position, seed)
  level: ReadingLevel;
  keySignature: string; // VexFlow key spec, e.g. "Gm"
  timeSignature?: string; // "4/4"; drawn on the first bar when given
  bars: ReadingBar[];
  loop: { start: number; end: number };
  positionId: PositionId;
}

// src/reading/index.ts provides:
// READING_LEVELS: { level: ReadingLevel; label: string; description: string }[]
// generateReading(args: { tune: Tune; key: KeyInfo; level: ReadingLevel; loop: { start: number; end: number };
//                         position: Position; seed: number }): ReadingExercise   (deterministic per seed)
// readingToPattern(ex: ReadingExercise): PatternStep[]   (non-rest notes, startBeat from loop start; for player.setPattern)
// useNoteCheck(ex: ReadingExercise | null, player: PlayerApi, input: InputApi): NoteCheckApi   (input: src/listen/useInput.ts)

export type NoteResult = "hit" | "miss" | null;
export interface NoteCheckApi {
  status: "idle" | "starting" | "listening" | "error";
  error: string | null;
  start(): Promise<void>; // opens the shared guitar input
  stop(): void;
  results: NoteResult[]; // parallel to readingToPattern(ex) steps; reset on each loop pass
  score: { hit: number; total: number }; // for the latest finished pass
}

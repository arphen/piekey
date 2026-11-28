import { useSyncExternalStore } from "react";
import type { PatternStep, ReadingBar, ReadingExercise, ReadingNote } from "../core/contract";
import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import { getStoredItem, setStoredItem } from "../storage";
import type { Target, Timeline, Voice } from "../tunes/order";
import type { Card, Context } from "./deck";
import { fingerLine, fitWindow, windowAt } from "./fingering";
import { makeScale, nice, parseChord, spellIn, type Scale } from "./harmony";
import { parseHubId } from "./keyStudy";
import { KEY_FIFTHS, signatureOf } from "./notation";

// User-recorded and score-edited loopable exercises: e.g. custom scale-in-thirds shapes,
// position drills, or short licks. Persisted in `guitar-custom-exercises-v1` (synced & backed up)
// and played through the exact same `SongCoach` engine (pace -> in-time BPM climb -> Free ride ->
// Leitner boxes in `guitar-skills`).

export const CUSTOM_EXERCISES_KEY = "guitar-custom-exercises-v1";
export const MAX_CUSTOM_EXERCISES = 80;
export const MAX_CUSTOM_NOTES = 256;

export type CustomFamily = "scales" | "technique" | "melody";
export type CustomMeter = 3 | 4 | 6;
export type CaptureGrid = 0.25 | 0.333333 | 0.5 | 1;

export interface CustomNote {
  /** Sounding MIDI pitch (36..96), or null for a rest. */
  midi: number | null;
  /** Duration in quarter-note beats (0.25, 1/3, 0.5, 0.75, 1, 1.5, 2, 3, 4). */
  beats: number;
  /** Optional explicit guitar string (0 = high e .. 5 = low E) and fret (0..22). */
  string?: number;
  fret?: number;
}

export interface CustomExercise {
  id: string; // "custom:<family>:<slug>"
  title: string;
  family: CustomFamily;
  /** Circle-of-fifths key hub, e.g. "M0" (C major), "m9" (A minor). */
  hub: string;
  /** Optional CAGED or custom shape tag, e.g. "E", "A", "G", "C", "D", "3NPS". */
  shape?: string;
  /** First fret of the position window (0..15). */
  p: number;
  /** Beats per bar (3 = 3/4, 4 = 4/4, 6 = 6/8). */
  beatsPerBar: CustomMeter;
  bpm: number;
  goalBpm: number;
  notes: CustomNote[];
  createdAt: string; // YYYY-MM-DD
  updatedAt: string; // YYYY-MM-DD
}

export interface CustomExerciseBook {
  v: 1;
  exercises: CustomExercise[];
}

export const EMPTY_CUSTOM_BOOK: CustomExerciseBook = { v: 1, exercises: [] };

const LETTERS = "cdefgab";
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ALTER: Record<string, number> = { "♭": -1, b: -1, "♯": 1, "#": 1, "𝄫": -2, "𝄪": 2 };
const DRAW: Record<number, ReadingNote["accidental"]> = { [-2]: "bb", [-1]: "b", 0: "n", 1: "#", 2: "##" };
const PLAIN = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

const MAJOR_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_NAMES = ["Cm", "C♯m", "Dm", "E♭m", "Em", "Fm", "F♯m", "Gm", "G♯m", "Am", "B♭m", "Bm"];

export const HUB_OPTIONS: { hub: string; label: string; short: string; minor: boolean }[] = [
  ...[0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map((pc) => {
    const info = parseHubId(`M${pc}`)!;
    return { hub: `M${pc}`, label: info.fullName, short: info.shortName, minor: false };
  }),
  ...[9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2].map((pc) => {
    const info = parseHubId(`m${pc}`)!;
    return { hub: `m${pc}`, label: info.fullName, short: info.shortName, minor: true };
  }),
];

export const SHAPE_TAGS = ["", "C", "A", "G", "E", "D", "3NPS", "2NPS"] as const;

export const DURATION_CHOICES: { label: string; short: string; beats: number }[] = [
  { label: "16th", short: "1/16", beats: 0.25 },
  { label: "Triplet", short: "1/3", beats: 1 / 3 },
  { label: "8th", short: "1/8", beats: 0.5 },
  { label: "Dotted 8th", short: "3/16", beats: 0.75 },
  { label: "Quarter", short: "1/4", beats: 1 },
  { label: "Dotted ¼", short: "3/8", beats: 1.5 },
  { label: "Half", short: "1/2", beats: 2 },
  { label: "Whole", short: "1", beats: 4 },
];

export function isCustomExerciseId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith("custom:"));
}

export function newCustomExerciseId(family: CustomFamily = "scales"): string {
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `custom:${family}:${Date.now().toString(36)}-${rand}`;
}

export function scaleForHub(hub: string): Scale {
  const info = parseHubId(hub) ?? parseHubId("M0")!;
  return makeScale(info.pc, info.minor ? "naturalMinor" : "major");
}

export function keySignatureForHub(hub: string): string {
  const info = parseHubId(hub);
  if (!info) return "C";
  return info.vexKey in KEY_FIFTHS ? info.vexKey : "C";
}

export function formatCustomPitch(midi: number, hub: string): string {
  const scale = scaleForHub(hub);
  const name = spellIn(scale, midi);
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

/** All playable { string, fret } spots on a standard-tuned guitar for `midi`, nearest to `preferP` first. */
export function alternatePositions(midi: number, preferP = 5, maxFret = 20): { string: number; fret: number }[] {
  const spots: { string: number; fret: number; cost: number }[] = [];
  for (let s = 0; s < OPEN_MIDI.length; s++) {
    const fret = midi - OPEN_MIDI[s];
    if (fret < 0 || fret > maxFret) continue;
    const center = preferP + 1.5;
    const cost = Math.abs(fret - center) + (fret === 0 && preferP > 0 ? 1.2 : 0);
    spots.push({ string: s, fret, cost });
  }
  return spots.sort((a, b) => a.cost - b.cost || a.string - b.string).map(({ string, fret }) => ({ string, fret }));
}

export function isValidSpot(midi: number, string?: number, fret?: number): boolean {
  if (string === undefined || fret === undefined) return false;
  if (!Number.isInteger(string) || string < 0 || string > 5) return false;
  if (!Number.isInteger(fret) || fret < 0 || fret > 22) return false;
  return OPEN_MIDI[string] + fret === midi;
}

/** Resolve exact fingering for every non-rest note, preserving explicit string/fret choices. */
export function resolveExerciseSteps(ex: Pick<CustomExercise, "notes" | "p">): PatternStep[] {
  const pitched: { note: CustomNote; startBeat: number }[] = [];
  let t = 0;
  for (const n of ex.notes) {
    const dur = Math.max(0.125, n.beats);
    if (n.midi !== null) pitched.push({ note: n, startBeat: t });
    t += dur;
  }
  if (!pitched.length) return [];
  const auto = fingerLine(pitched.map((x) => x.note.midi!), windowAt(Math.max(0, Math.min(15, ex.p))));
  return pitched.map(({ note, startBeat }, i) => {
    const midi = note.midi!;
    const explicit = isValidSpot(midi, note.string, note.fret);
    const spot = explicit ? { string: note.string!, fret: note.fret! } : auto[i];
    return {
      string: spot.string,
      fret: spot.fret,
      pc: mod(midi),
      midi,
      startBeat,
      durationBeats: note.beats,
    };
  });
}

function durationProps(beats: number): Pick<ReadingNote, "duration" | "dotted" | "tuplet"> {
  if (near(beats, 1 / 3)) return { duration: "8", dotted: false, tuplet: { actual: 3, normal: 2 } };
  if (near(beats, 2 / 3)) return { duration: "q", dotted: false, tuplet: { actual: 3, normal: 2 } };
  const b = PLAIN.find((x) => x <= beats + 0.02) ?? 0.25;
  const duration = (b >= 4 ? "w" : b >= 2 ? "h" : b >= 1 ? "q" : b >= 0.5 ? "8" : "16") as ReadingNote["duration"];
  return { duration, dotted: near(b, 3) || near(b, 1.5) || near(b, 0.75) };
}

function fillRests(from: number, to: number): ReadingNote[] {
  const out: ReadingNote[] = [];
  let t = from;
  while (to - t > 0.12) {
    const b = PLAIN.find((x) => x <= to - t + 0.02 && !near(x, 3) && !near(x, 1.5) && !near(x, 0.75)) ?? 0.25;
    out.push({
      rest: true,
      midi: 0,
      vexKey: "b/4",
      accidental: null,
      ...durationProps(b),
      startBeat: t,
      durationBeats: b,
      string: 0,
      fret: 0,
    });
    t += b;
  }
  return out;
}

export interface CustomSheetResult {
  exercise: Pick<ReadingExercise, "bars" | "keySignature" | "timeSignature">;
  /** Maps rendered non-rest score index -> index in `ex.notes`. */
  scoreToNoteIndex: number[];
  /** Maps index in `ex.notes` -> rendered non-rest score index (-1 for rests). */
  noteToScoreIndex: number[];
}

/** Build VexFlow-ready bars for a custom exercise, keeping rests and exact durations intact. */
export function customExerciseToSheet(ex: Pick<CustomExercise, "notes" | "hub" | "beatsPerBar" | "p">): CustomSheetResult {
  const scale = scaleForHub(ex.hub);
  const keySignature = keySignatureForHub(ex.hub);
  const signature = signatureOf(keySignature);
  const barBeats = ex.beatsPerBar === 3 ? 3 : ex.beatsPerBar === 6 ? 3 : 4;
  const timeSignature = ex.beatsPerBar === 3 ? "3/4" : ex.beatsPerBar === 6 ? "6/8" : "4/4";
  const steps = resolveExerciseSteps(ex);
  const scoreToNoteIndex: number[] = [];
  const noteToScoreIndex: number[] = [];

  if (!ex.notes.length) {
    return {
      exercise: {
        bars: [{ barIndex: 0, chordSymbols: [], chordBeats: [], notes: fillRests(0, barBeats), beats: barBeats }],
        keySignature,
        timeSignature,
      },
      scoreToNoteIndex,
      noteToScoreIndex,
    };
  }

  const bars: ReadingBar[] = [];
  let barNotes: ReadingNote[] = [];
  let inBar = new Map<string, number>();
  let barPos = 0;
  let globalBeat = 0;
  let stepIdx = 0;

  const flushBar = () => {
    if (barPos < barBeats - 0.02) {
      barNotes.push(...fillRests(globalBeat, globalBeat + (barBeats - barPos)));
      globalBeat += barBeats - barPos;
    }
    bars.push({
      barIndex: bars.length,
      chordSymbols: [],
      chordBeats: [],
      notes: barNotes,
      beats: barBeats,
    });
    barNotes = [];
    inBar = new Map<string, number>();
    barPos = 0;
  };

  ex.notes.forEach((n, noteIdx) => {
    const dur = Math.max(0.25, Math.min(barBeats, n.beats));
    if (barPos > 0.02 && barPos + dur > barBeats + 0.02) {
      flushBar();
    }
    if (n.midi === null) {
      noteToScoreIndex.push(-1);
      barNotes.push({
        rest: true,
        midi: 0,
        vexKey: "b/4",
        accidental: null,
        ...durationProps(dur),
        startBeat: globalBeat,
        durationBeats: dur,
        string: 0,
        fret: 0,
      });
    } else {
      const scoreIdx = scoreToNoteIndex.length;
      scoreToNoteIndex.push(noteIdx);
      noteToScoreIndex.push(scoreIdx);
      const name = spellIn(scale, n.midi);
      const letter = Math.max(0, LETTERS.indexOf(name[0].toLowerCase()));
      const alter = [...name.slice(1)].reduce((acc, ch) => acc + (ALTER[ch] ?? 0), 0);
      const written = n.midi + 12;
      const octave = Math.round((written - NATURAL_PC[letter] - alter) / 12) - 1;
      const place = `${letter}/${octave}`;
      const standing = inBar.get(place) ?? signature[letter];
      inBar.set(place, alter);
      const step = steps[stepIdx++];
      barNotes.push({
        rest: false,
        midi: n.midi,
        vexKey: `${LETTERS[letter]}${alter === 0 ? "" : DRAW[alter]}/${octave}`,
        accidental: alter === standing ? null : DRAW[alter] ?? null,
        ...durationProps(dur),
        startBeat: globalBeat,
        durationBeats: dur,
        string: step?.string ?? 0,
        fret: step?.fret ?? 0,
      });
    }
    barPos += dur;
    globalBeat += dur;
    if (barPos >= barBeats - 0.02) {
      flushBar();
    }
  });

  if (barNotes.length > 0) flushBar();
  if (bars.length > 0) {
    bars[0] = { ...bars[0], repeatStart: true };
    bars[bars.length - 1] = { ...bars[bars.length - 1], repeatEnd: 2 };
  }

  return {
    exercise: { bars, keySignature, timeSignature },
    scoreToNoteIndex,
    noteToScoreIndex,
  };
}

/** Build a playable, scorable `Card` for `SongCoach` / `usePlayback` from a `CustomExercise`. */
export function customExerciseToCard(ex: CustomExercise): Card | null {
  const pitchedCount = ex.notes.filter((n) => n.midi !== null).length;
  if (pitchedCount === 0) return null;

  const info = parseHubId(ex.hub) ?? parseHubId("M0")!;
  const scale = scaleForHub(ex.hub);
  const barBeats = ex.beatsPerBar === 3 ? 3 : ex.beatsPerBar === 6 ? 3 : 4;
  const steps = resolveExerciseSteps(ex);

  // Place notes across bars the exact same way customExerciseToSheet does so cursor & playback align 1:1.
  const targets: Target[] = [];
  let barIdx = 0;
  let barPos = 0;
  let targetIdx = 0;

  for (const n of ex.notes) {
    const dur = Math.max(0.25, Math.min(barBeats, n.beats));
    if (barPos > 0.02 && barPos + dur > barBeats + 0.02) {
      barIdx++;
      barPos = 0;
    }
    const start = barIdx * barBeats + barPos;
    if (n.midi !== null) {
      targets.push({
        midi: n.midi,
        notes: [targetIdx],
        bar: barIdx,
        slot: barIdx,
        t: start,
        dur,
      });
      if (steps[targetIdx]) {
        steps[targetIdx] = { ...steps[targetIdx], startBeat: start, durationBeats: dur };
      }
      targetIdx++;
    }
    barPos += dur;
    if (barPos >= barBeats - 0.02) {
      barIdx++;
      barPos = 0;
    }
  }

  const totalBars = Math.max(1, barPos > 0.02 ? barIdx + 1 : barIdx);
  const total = totalBars * barBeats;
  const slots: Timeline["slots"] = Array.from({ length: totalBars }, (_, i) => ({
    bar: i,
    pass: 1,
    start: i * barBeats,
    beats: barBeats,
    run: 0,
  }));

  // Gentle tonic bass pulse on beat 1 of each bar so the exercise sits musically in its key.
  const rootMidi = 40 + mod(info.pc - 40);
  const bass: Voice[] = slots.map((s) => ({ t: s.start, dur: Math.min(2, s.beats), midi: rootMidi }));
  const tonicChord = parseChord(info.minor ? `${scale.names[0]}m7` : `${scale.names[0]}maj7`);
  const tl: Timeline = {
    slots,
    targets,
    comp: [],
    bass,
    total,
  };

  const ctx: Context = {
    chord: tonicChord,
    scale,
    next: tonicChord,
    roman: info.minor ? "i" : "I",
  };

  const frets = steps.map((s) => s.fret);
  const lo = Math.min(...frets);
  const hi = Math.max(...frets);
  const fretSpan = lo === hi ? `fret ${lo}` : `frets ${lo}–${hi}`;
  const shapeTag = ex.shape ? `${ex.shape} shape · ` : "";

  return {
    id: ex.id,
    tuneId: "curriculum:studio",
    tune: "My exercises",
    p: ex.p,
    family: ex.family,
    kind: ex.family === "melody" ? "melody" : ex.family === "technique" ? "shift" : "thirds",
    group: info.fullName,
    title: ex.title,
    detail: `Your custom loop (${shapeTag}${fretSpan}, ${targets.length} notes).`,
    why: "Recorded and shaped by you — loops cleanly from your pace into tempo climbs.",
    where: `${shapeTag}${fretSpan}`,
    bpm: Math.max(36, Math.min(220, Math.round(ex.bpm))),
    goalBpm: Math.max(Math.round(ex.bpm), Math.min(240, Math.round(ex.goalBpm))),
    pass: 0.85,
    listen: false,
    pace: true,
    memory: false,
    click: true,
    tl,
    from: 0,
    to: slots.length - 1,
    first: 0,
    last: targets.length - 1,
    view: "fretboard",
    steps,
    context: targets.map(() => ctx),
    voicings: [],
  };
}

/**
 * Transpose a custom exercise by `semitones` while preserving its exact geometric guitar shape
 * (explicit string/fret pairs move cleanly along the neck; octaves wrap if frets would leave 0..19).
 */
export function transposeCustomExercise(ex: CustomExercise, semitones: number, options?: { newId?: boolean; day?: string }): CustomExercise {
  const delta = Math.trunc(semitones);
  const info = parseHubId(ex.hub) ?? parseHubId("M0")!;
  const nextPc = mod(info.pc + delta);
  const nextHub = `${info.minor ? "m" : "M"}${nextPc}`;

  // Choose an octave shift (-12, 0, +12) so every explicit fret stays in playable bounds 0..19.
  const explicitFrets = ex.notes.filter((n) => n.midi !== null && n.fret !== undefined).map((n) => n.fret!);
  let shift = delta;
  if (explicitFrets.length) {
    const candidates = [delta, delta - 12, delta + 12];
    const valid = candidates.filter((d) => explicitFrets.every((f) => f + d >= 0 && f + d <= 19));
    if (valid.length) {
      shift = valid.sort((a, b) => Math.abs(ex.p + a - 5) - Math.abs(ex.p + b - 5))[0];
    }
  } else {
    const midis = ex.notes.filter((n) => n.midi !== null).map((n) => n.midi!);
    if (midis.length) {
      const lo = Math.min(...midis);
      const hi = Math.max(...midis);
      if (lo + shift < 40 && hi + shift + 12 <= 88) shift += 12;
      else if (hi + shift > 88 && lo + shift - 12 >= 40) shift -= 12;
    }
  }

  const notes: CustomNote[] = ex.notes.map((n) => {
    if (n.midi === null) return { ...n };
    const nextMidi = Math.max(36, Math.min(96, n.midi + shift));
    if (n.string !== undefined && n.fret !== undefined && isValidSpot(nextMidi, n.string, n.fret + shift)) {
      return { ...n, midi: nextMidi, string: n.string, fret: n.fret + shift };
    }
    return { midi: nextMidi, beats: n.beats };
  });

  const midis = notes.filter((n) => n.midi !== null).map((n) => n.midi!);
  const nextP = explicitFrets.length && ex.p + shift >= 0 && ex.p + shift <= 15
    ? ex.p + shift
    : midis.length
      ? fitWindow(midis, Math.max(0, Math.min(15, ex.p + shift)), 15).p
      : Math.max(0, Math.min(15, ex.p));

  const oldName = info.minor ? MINOR_NAMES[info.pc] : MAJOR_NAMES[info.pc];
  const newName = info.minor ? MINOR_NAMES[nextPc] : MAJOR_NAMES[nextPc];
  const oldFull = info.fullName;
  const newFull = parseHubId(nextHub)!.fullName;
  let title = ex.title;
  if (title.includes(oldFull)) title = title.replace(oldFull, newFull);
  else if (new RegExp(`^${oldName.replace("#", "\\#")}\\b`).test(title)) title = title.replace(oldName, newName);
  else if (options?.newId) title = `${ex.title} (${newName})`;

  const day = options?.day ?? ex.updatedAt;
  return {
    ...ex,
    id: options?.newId ? newCustomExerciseId(ex.family) : ex.id,
    title,
    hub: nextHub,
    p: nextP,
    notes,
    createdAt: options?.newId ? day : ex.createdAt,
    updatedAt: day,
  };
}

/** Quantize timed onset recordings (`{ midi, ms }` relative to beat 0) onto `grid` beats, inserting rests for gaps. */
export function quantizeRecordedOnsets(
  events: readonly { midi: number; ms: number }[],
  bpm: number,
  grid: number,
  beatsPerBar: CustomMeter,
  preferP = 5,
): CustomNote[] {
  if (!events.length) return [];
  const beatMs = 60_000 / Math.max(30, bpm);
  const step = Math.max(0.25, grid);
  const barBeats = beatsPerBar === 3 ? 3 : beatsPerBar === 6 ? 3 : 4;

  // Snap each onset to its nearest grid cell; shift so the first bar starts cleanly.
  const rawCells = events.map((e) => ({
    midi: e.midi,
    cell: Math.max(0, Math.round((e.ms / beatMs) / step)),
  }));
  const firstBarCell = Math.floor((rawCells[0].cell * step) / barBeats) * Math.round(barBeats / step);
  const snapped: { midi: number; cell: number }[] = [];
  for (const item of rawCells) {
    const c = Math.max(0, item.cell - firstBarCell);
    const prev = snapped[snapped.length - 1];
    if (prev && prev.cell === c) {
      // Two attacks snapped to the same cell: keep the later pitch or bump forward 1 cell if distinct.
      snapped.push({ midi: item.midi, cell: c + 1 });
    } else {
      snapped.push({ midi: item.midi, cell: c });
    }
  }

  const out: CustomNote[] = [];
  const w = windowAt(Math.max(0, Math.min(15, preferP)));
  const fingered = fingerLine(snapped.map((s) => s.midi), w);
  let cursorCell = 0;

  const pushRestCells = (cells: number) => {
    let rem = cells * step;
    while (rem > 0.05) {
      const chunk = PLAIN.find((x) => x <= rem + 0.02 && !near(x, 3) && !near(x, 1.5) && !near(x, 0.75)) ?? step;
      out.push({ midi: null, beats: chunk });
      rem -= chunk;
    }
  };

  for (let i = 0; i < snapped.length; i++) {
    const cur = snapped[i];
    if (cur.cell > cursorCell) {
      pushRestCells(cur.cell - cursorCell);
      cursorCell = cur.cell;
    }
    const next = snapped[i + 1];
    const gapCells = next ? Math.max(1, next.cell - cur.cell) : 1;
    // Cap sustained duration at 2 beats or gap to next note; turn long silences into a note + rests.
    const maxHoldCells = Math.max(1, Math.round(2 / step));
    const holdCells = Math.min(gapCells, maxHoldCells);
    const rawBeats = holdCells * step;
    const noteBeats = near(step, 1 / 3) && holdCells === 1
      ? 1 / 3
      : (PLAIN.find((x) => x <= rawBeats + 0.02) ?? step);
    const noteCells = Math.max(1, Math.round(noteBeats / step));
    out.push({
      midi: cur.midi,
      beats: noteBeats,
      string: fingered[i]?.string,
      fret: fingered[i]?.fret,
    });
    cursorCell += noteCells;
  }

  return out.slice(0, MAX_CUSTOM_NOTES);
}

// ---------- validation & synced browser storage ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validCustomNote(v: unknown): v is CustomNote {
  if (!isRecord(v)) return false;
  const midiOk = v.midi === null || (Number.isInteger(v.midi) && (v.midi as number) >= 24 && (v.midi as number) <= 108);
  const beatsOk = finite(v.beats) && v.beats >= 0.125 && v.beats <= 8;
  const stringOk = v.string === undefined || (Number.isInteger(v.string) && (v.string as number) >= 0 && (v.string as number) <= 5);
  const fretOk = v.fret === undefined || (Number.isInteger(v.fret) && (v.fret as number) >= 0 && (v.fret as number) <= 22);
  return midiOk && beatsOk && stringOk && fretOk;
}

export function validCustomExercise(v: unknown): v is CustomExercise {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || !v.id.startsWith("custom:") || v.id.length > 128) return false;
  if (typeof v.title !== "string" || v.title.length === 0 || v.title.length > 120) return false;
  if (v.family !== "scales" && v.family !== "technique" && v.family !== "melody") return false;
  if (typeof v.hub !== "string" || !parseHubId(v.hub)) return false;
  if (v.shape !== undefined && (typeof v.shape !== "string" || v.shape.length > 24)) return false;
  if (!Number.isInteger(v.p) || (v.p as number) < 0 || (v.p as number) > 15) return false;
  if (v.beatsPerBar !== 3 && v.beatsPerBar !== 4 && v.beatsPerBar !== 6) return false;
  if (!finite(v.bpm) || v.bpm < 30 || v.bpm > 240) return false;
  if (!finite(v.goalBpm) || v.goalBpm < 30 || v.goalBpm > 260) return false;
  if (!Array.isArray(v.notes) || v.notes.length === 0 || v.notes.length > MAX_CUSTOM_NOTES) return false;
  if (!v.notes.every(validCustomNote)) return false;
  return typeof v.createdAt === "string" && typeof v.updatedAt === "string";
}

export function validCustomExerciseBook(v: unknown): v is CustomExerciseBook {
  if (!isRecord(v) || v.v !== 1 || !Array.isArray(v.exercises) || v.exercises.length > MAX_CUSTOM_EXERCISES) return false;
  return v.exercises.every(validCustomExercise);
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: { raw: string | null; book: CustomExerciseBook } = { raw: null, book: EMPTY_CUSTOM_BOOK };

function read(): CustomExerciseBook {
  let raw: string | null = null;
  try { raw = getStoredItem(CUSTOM_EXERCISES_KEY); } catch { /* empty fallback */ }
  if (raw === snapshot.raw) return snapshot.book;
  let book = EMPTY_CUSTOM_BOOK;
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (validCustomExerciseBook(parsed)) book = parsed;
  } catch { /* empty fallback */ }
  snapshot = { raw, book };
  return book;
}

function write(book: CustomExerciseBook): void {
  try { setStoredItem(CUSTOM_EXERCISES_KEY, JSON.stringify(book)); } catch { /* storage reports its own failure */ }
  listeners.forEach((l) => l());
}

export function loadCustomExercises(): CustomExercise[] {
  return read().exercises;
}

export function getCustomExercise(id: string): CustomExercise | undefined {
  return read().exercises.find((e) => e.id === id);
}

export function subscribeCustomExercises(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCustomExercises(): CustomExercise[] {
  return useSyncExternalStore(subscribeCustomExercises, read, read).exercises;
}

export function saveCustomExercise(exercise: CustomExercise): void {
  const book = read();
  const idx = book.exercises.findIndex((e) => e.id === exercise.id);
  const next = idx >= 0
    ? book.exercises.map((e, i) => (i === idx ? exercise : e))
    : [exercise, ...book.exercises].slice(0, MAX_CUSTOM_EXERCISES);
  write({ v: 1, exercises: next });
}

export function deleteCustomExercise(id: string): void {
  const book = read();
  write({ v: 1, exercises: book.exercises.filter((e) => e.id !== id) });
}

export function suggestExerciseTitle(hub: string, shape?: string, family: CustomFamily = "scales"): string {
  const info = parseHubId(hub) ?? parseHubId("M0")!;
  const kind = family === "scales" ? "thirds" : family === "technique" ? "drill" : "phrase";
  const shapePart = shape ? ` · ${shape} shape` : "";
  return `${nice(info.fullName)} ${kind}${shapePart}`;
}

export function customNoteLabel(n: CustomNote, hub: string): string {
  if (n.midi === null) return "𝄾";
  return formatCustomPitch(n.midi, hub);
}

export function guessExerciseHub(midis: readonly number[]): string {
  if (!midis.length) return "M0";
  const counts = new Map<number, number>();
  for (const m of midis) counts.set(mod(m), (counts.get(mod(m)) ?? 0) + 1);
  let bestHub = "M0";
  let bestScore = -1;
  const firstPc = mod(midis[0]);
  const lastPc = mod(midis[midis.length - 1]);
  for (let pc = 0; pc < 12; pc++) {
    for (const minor of [false, true]) {
      const scale = makeScale(pc, minor ? "naturalMinor" : "major");
      let inScale = 0;
      for (const [notePc, c] of counts) if (scale.pcs.includes(notePc)) inScale += c;
      const tonicBonus = (firstPc === pc ? 1.5 : 0) + (lastPc === pc ? 1.5 : 0);
      const score = inScale + tonicBonus;
      if (score > bestScore) {
        bestScore = score;
        bestHub = `${minor ? "m" : "M"}${pc}`;
      }
    }
  }
  return bestHub;
}

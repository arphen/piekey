import { mod } from "../musicTheory";
import type { NoteResult } from "../core";

// Follows a player through a melody, note by note, at their own pace.
//
// Hearing notes: a pitch counts once it holds for a few frames. The note just played keeps
// ringing, so the same pitch only counts again after a fresh pick (a jump in level) or a gap.
// A pick restarts the count: at a note change the analysis window still shows the old pitch for
// a frame while the new attack is already in it, and that must not pass for a re-pick.
//
// Marking: the expected note goes green when played, red when a different note holds instead
// (it stays red for this take once it has been missed). Playing the note after the expected one
// marks the expected one red and moves on.
//
// Retries: when the last few notes played match an earlier passage, the player has gone back.
// The cursor jumps there and a new take starts from that note; red marks the retry notes left at
// the old spot are taken back. Backing up two notes for a run-up counts too.
//
// Starting: a take begins on a fresh attack. A string still ringing from before (the last note
// of the take just finished is often the first note of the next) is not its first note; it is
// kept as `carry`, and if the player then goes straight on to the second note, the first one
// counts as played rather than skipped.

const STABLE_FRAMES = 2; // two frames that agree: ~40 ms at 25 ms frames
const WRONG_FRAMES = 6; // ~150 ms: slides and fret noise pass by
const SILENT_FRAMES = 6;
const PICK_RATIO = 1.8;
const PICK_MIN_RMS = 0.004;
const LEVEL_WINDOW = 8;
const RETRY_NOTES = 3; // notes of an earlier passage that mean "going back"
const JUMP_NOTES = 4; // notes of a later passage that mean "skipping ahead"
const HISTORY = 8;

interface Mark {
  i: number;
  prev: NoteResult;
  counted: boolean; // added to misses
}

interface Played {
  midi: number;
  kind: "hit" | "skip" | "wrong";
  marks: Mark[];
}

export interface FollowState {
  index: number; // next note to play; = length when done
  results: NoteResult[];
  take: number; // 1 = first time through
  takeStart: number; // note the current take started on
  misses: number[]; // red marks per note over all takes
  retakes: number[]; // takes started per note
  wrong: number | null; // last wrong pitch, for the hint
  wrongAt: (number | null)[]; // the pitch held instead of each note, this take
  heard: number | null; // last steady pitch
  carry: number | null; // a pitch already ringing when the take began: not a note of it
  startedAt: number | null; // this take
  finishedAt: number | null;
  // listening internals
  run: number | null;
  runFrames: number;
  silent: number;
  fired: boolean;
  lastEvent: number | null;
  rearmed: boolean;
  levels: number[];
  loud: boolean; // the level stands well above its recent low (a pick counts on the rising edge)
  pendingWrong: boolean;
  played: Played[];
}

export function initFollow(n: number): FollowState {
  return {
    index: 0,
    results: Array(n).fill(null),
    take: 1,
    takeStart: 0,
    misses: Array(n).fill(0),
    retakes: Array(n).fill(0),
    wrong: null,
    wrongAt: Array(n).fill(null),
    heard: null,
    carry: null,
    startedAt: null,
    finishedAt: null,
    run: null,
    runFrames: 0,
    silent: 0,
    fired: false,
    lastEvent: null,
    rearmed: false,
    levels: [],
    loud: false,
    pendingWrong: false,
    played: [],
  };
}

const same = (a: number, b: number, anyOctave: boolean) => (anyOctave ? mod(a) === mod(b) : a === b);

function windowAt(targets: number[], end: number, seq: number[], anyOctave: boolean): boolean {
  const start = end - seq.length + 1;
  if (start < 0 || end >= targets.length) return false;
  return seq.every((m, k) => same(m, targets[start + k], anyOctave));
}

/**
 * Where the last notes played say the player is, when that isn't simply the next note.
 * With any octave allowed, a passage in the octave actually played wins over the same notes an
 * octave away: starting a two-octave scale over lands on its first notes, not its second octave.
 */
function findJump(s: FollowState, targets: number[], p: number, anyOctave: boolean): { end: number; len: number } | null {
  const recent = [...s.played.map((e) => e.midi), p];
  const back = recent.slice(-RETRY_NOTES);
  if (back.length < RETRY_NOTES || back.every((m) => same(m, back[0], anyOctave))) return null;
  const ahead = recent.slice(-JUMP_NOTES);
  for (const exact of anyOctave ? [true, false] : [true]) {
    for (let j = Math.min(s.index, targets.length - 1); j >= RETRY_NOTES - 1; j--)
      if (windowAt(targets, j, back, !exact)) return { end: j, len: RETRY_NOTES };
  }
  if (ahead.length < JUMP_NOTES) return null;
  for (const exact of anyOctave ? [true, false] : [true]) {
    for (let j = s.index + 1; j < targets.length; j++) if (windowAt(targets, j, ahead, !exact)) return { end: j, len: JUMP_NOTES };
  }
  return null;
}

function jump(s: FollowState, targets: number[], end: number, len: number, p: number, now: number): FollowState {
  const results = [...s.results];
  const misses = [...s.misses];
  const retakes = [...s.retakes];
  const wrongAt = [...s.wrongAt];
  const window = s.played.slice(-(len - 1));
  for (const e of [...window].reverse())
    for (const m of [...e.marks].reverse()) {
      results[m.i] = m.prev;
      if (m.counted) misses[m.i]--;
    }
  const start = end - len + 1;
  const last = Math.min(targets.length - 1, Math.max(s.index, end));
  for (let i = start; i <= last; i++) {
    results[i] = i <= end ? "hit" : null;
    wrongAt[i] = null;
  }
  retakes[start]++;
  const index = end + 1;
  return {
    ...s,
    index,
    results,
    misses,
    retakes,
    wrongAt,
    take: s.take + 1,
    takeStart: start,
    wrong: null,
    pendingWrong: false,
    played: [...window.map((e) => ({ midi: e.midi, kind: "hit" as const, marks: [] })), { midi: p, kind: "hit", marks: [] }],
    startedAt: now,
    finishedAt: index >= targets.length ? now : null,
  };
}

function onNote(s: FollowState, targets: number[], p: number, now: number, anyOctave: boolean): FollowState {
  const n = targets.length;
  const at = s.index;
  const hit = at < n && same(p, targets[at], anyOctave);
  const clean = s.played.slice(-(RETRY_NOTES - 1)).every((e) => e.kind === "hit");

  if (!(hit && clean)) {
    const j = findJump(s, targets, p, anyOctave);
    if (j) return jump(s, targets, j.end, j.len, p, now);
  }

  const results = [...s.results];
  const misses = [...s.misses];
  const marks: Mark[] = [];
  const set = (i: number, r: NoteResult) => {
    const counted = r === "miss" && results[i] !== "miss";
    marks.push({ i, prev: results[i], counted });
    if (counted) misses[i]++;
    results[i] = r;
  };
  const record = (kind: Played["kind"]) => [...s.played, { midi: p, kind, marks }].slice(-HISTORY);

  // the note after next counts as "skipped one" only when it's a new pitch, not the last note picked again
  const previous = s.played[s.played.length - 1]?.midi;
  const skip = !hit && at + 1 < n && same(p, targets[at + 1], anyOctave) && (previous === undefined || !same(p, previous, anyOctave));
  if (hit || skip) {
    // going on from a first note that was still ringing when the take began: it was played
    if (!hit) set(at, at === 0 && s.carry !== null && same(s.carry, targets[0], anyOctave) ? "hit" : "miss");
    const i = hit ? at : at + 1;
    set(i, results[i] === "miss" ? "miss" : "hit");
    const index = i + 1;
    return {
      ...s,
      index,
      results,
      misses,
      wrong: null,
      pendingWrong: false,
      played: record(hit ? "hit" : "skip"),
      startedAt: s.startedAt ?? now,
      finishedAt: index >= n ? now : null,
    };
  }
  // A different note: red once it has held for a moment.
  return { ...s, played: record("wrong"), pendingWrong: at < n };
}

function confirmWrong(s: FollowState, p: number): FollowState {
  const i = s.index;
  const last = s.played[s.played.length - 1];
  const wrongAt = [...s.wrongAt];
  wrongAt[i] = p;
  if (!last || s.results[i] === "miss") return { ...s, pendingWrong: false, wrong: p, wrongAt };
  const results = [...s.results];
  const misses = [...s.misses];
  const mark: Mark = { i, prev: results[i], counted: true };
  results[i] = "miss";
  misses[i]++;
  return {
    ...s,
    results,
    misses,
    wrong: p,
    wrongAt,
    pendingWrong: false,
    played: [...s.played.slice(0, -1), { ...last, marks: [...last.marks, mark] }],
  };
}

export function stepFollow(
  s: FollowState,
  targets: number[],
  frame: { midi: number | null; rms: number; now: number },
  anyOctave: boolean,
): FollowState {
  const p = frame.midi;
  const sameRun = p !== null && p === s.run;
  const floor = s.levels.length ? Math.min(...s.levels) : Infinity;
  const loud = frame.rms > PICK_MIN_RMS && frame.rms > floor * PICK_RATIO;
  const pick = loud && !s.loud;
  const runFrames = p === null ? 0 : sameRun && !pick ? s.runFrames + 1 : 1;
  const silent = p === null ? s.silent + 1 : 0;
  const next: FollowState = {
    ...s,
    run: p,
    runFrames,
    silent,
    levels: [...s.levels, frame.rms].slice(-LEVEL_WINDOW),
    loud,
    rearmed: s.rearmed || pick || silent >= SILENT_FRAMES,
    fired: sameRun && !pick ? s.fired : false,
    pendingWrong: sameRun ? s.pendingWrong : false,
  };
  if (p === null || runFrames < STABLE_FRAMES) return next;
  next.heard = p;
  // nothing played yet and no attack heard: this is sound left over from before the take
  if (s.lastEvent === null && !next.rearmed && (s.carry === null || s.carry === p)) return s.carry === p ? next : { ...next, carry: p };
  if (!next.fired && (p !== s.lastEvent || next.rearmed))
    return onNote({ ...next, fired: true, lastEvent: p, rearmed: false, levels: [frame.rms] }, targets, p, frame.now, anyOctave);
  if (next.pendingWrong && runFrames >= WRONG_FRAMES) return confirmWrong(next, p);
  return next;
}

/** Start a take at note `i` by hand. */
export function takeFrom(s: FollowState, i: number, now: number): FollowState {
  const results = [...s.results];
  const wrongAt = [...s.wrongAt];
  for (let k = i; k < results.length; k++) results[k] = wrongAt[k] = null;
  return { ...s, index: i, results, wrongAt, take: s.take + 1, takeStart: i, wrong: null, pendingWrong: false, played: [], startedAt: now, finishedAt: null };
}

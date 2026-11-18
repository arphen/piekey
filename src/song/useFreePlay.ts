import { inputLag } from "../audio/latency";
import { getStoredItem, setStoredItem } from "../storage";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { bassBuffer, clickBuffer, hatBuffer, keysBuffer, kickBuffer, OneShots } from "../audio/samples";
import { midiOf } from "../listen/pitch";
import { detectNotes, strongPitchClasses } from "../listen/spectrum";
import type { InputApi } from "../listen/useInput";
import { mod } from "../musicTheory";
import { glint } from "./cues";
import {
  CLICK_MAX,
  CLICK_MIN,
  clickFor,
  createOnsets,
  fitsClick,
  freeRecord,
  guessKey,
  guessPattern,
  held,
  loadFreePlay,
  logFreePlay,
  readGrid,
  restingLock,
  steadyGap,
  stepLock,
  toRise,
  vamp,
  type Division,
  type FreeEntry,
  type KeyGuess,
  type Lock,
  type Mood,
  type Onset,
  type Pattern,
  type VampChord,
} from "./freeplay";
import type { Chord } from "./harmony";
import { today } from "./leitner";
import { addChord, findLoop, nameChord } from "./progression";
import { IDLE_BEAT, type BeatSignal } from "./pulse";

// Free play, live: listens to whatever is played, works out the key and the pattern, and runs a
// click by the rules in freeplay.ts. In "follows" the click joins once the notes come evenly,
// a little under the player's tempo, moves up for clean playing, comes down when the player
// drifts behind it, steps out when the notes fall apart or stop, and moves over when the player
// settles on a tempo of their own. In "steady" it only moves by hand. Once the playing has sat
// on the click for a few bars, a band comes in under it, in the key that was heard.

export type ClickMode = "follows" | "steady" | "off";
type Pace = { bpm: number; division: Division };

export interface FreeView {
  count: number; // notes heard since free play began
  written: { count: number; midis: number[] }; // what is on the page: it follows at its own, slower pace
  key: KeyGuess | null;
  pattern: Pattern | null;
  division: Division; // notes to the click
  on: boolean; // the click is sounding
  bpm: number;
  mood: Mood | null;
  beat: number; // the beat sounding now, 0..3; −1 while the click is off
  n: number; // beats scheduled so far; use beatSignal.serial for the heard pulse
  beatSignal: BeatSignal; // the output clock; n also includes lookahead-scheduled beats
  change: "on" | "moved" | "up" | "down" | "off" | "rest" | null; // what the click did last
  mode: ClickMode;
  held: boolean; // the tempo stays where the player put it until the playing is very clean
  rise: { have: number; need: number }; // clean readings towards the next step up
  bars: number; // bars in a row on the click
  onGrid: number | null; // share of the last two bars' notes that sat on the grid
  timing: number[]; // where the last notes sat against the grid, in grid cells: − ahead, + behind
  alignment: number | null; // last reading's raw within-cell phase, ms; separate from steadiness
  spread: number | null; // scatter around that phase, ms
  trace: number[]; // the click's tempo, two bars at a time
  best: Pace | null; // the fastest click played to cleanly, this visit
  record: Pace | null; // and before it, for this key and pattern
  beaten: boolean;
  secs: number; // spent playing
  band: boolean; // the band is in
  bandOn: boolean; // and allowed to be
  chords: string[]; // its four bars
  bar: number; // the one sounding
  loop: string[] | null; // a progression the player is strumming round, once heard twice
}

const LOOKAHEAD_S = 0.2;
const TICK_MS = 25;
const READ_BEATS = 8; // two bars between looks at how the player sits on the click
const KEY_NOTES = 48;
const PATTERN_NOTES = 24;
const HISTORY = 128;
const FRESH_MS = 1500; // a tempo is the player's only while they are playing
const PLAYING_MS = 3000; // notes this close together count as time spent playing
const SHOW_MS = 90; // the numbers follow at this pace,
const WRITE_MS = 300; // the page at this one
const MIN_LOG_SECS = 20;
const START_BPM = 72;
const MOVE_MS = 2500; // a steady tempo that isn't the click's, for this long: the click moves to it
const TIMING_NOTES = 28;
const TRACE = 40;
const BAND_AFTER = 2; // readings on the click before the band comes in
const PREFS = "guitar-freeplay-prefs";
const STRUM_RATIO = 1.7; // louder than the quietest of the last frames by this much: a strum
const STRUM_SETTLE_MS = 40; // the pick's noise first
const STRUM_READ_MS = 180; // then what rings over this long is the chord
const STRUM_MIN_PCS = 3; // fewer is a note and its overtones

interface Beat {
  n: number;
  perf: number; // performance.now() when it is heard
  ms: number; // length of the beat it starts
}

interface State {
  onsets: Onset[];
  count: number;
  key: KeyGuess | null;
  pattern: Pattern | null;
  division: Division;
  lock: Lock;
  mode: ClickMode;
  change: FreeView["change"];
  beats: Beat[];
  nextTime: number; // context time of the next click to schedule
  n: number;
  readAt: number; // beat at which the next reading is taken
  beat: number;
  beatSignal: BeatSignal;
  steadyFrom: number; // only notes after this say what tempo the player is at
  misfit: number | null; // since when the player has been steady at a tempo that isn't the click's
  heard: boolean; // a note came since the last tick
  dirty: boolean;
  secs: number; // spent playing, for the log
  best: Pace | null;
  record: Pace | null;
  beaten: boolean;
  onGrid: number | null;
  timing: number[];
  alignment: number | null;
  spread: number | null;
  trace: number[];
  band: boolean;
  bandOn: boolean;
  vamp: VampChord[];
  bar: number;
  written: FreeView["written"];
  lastTick: number;
  strums: Chord[]; // chords heard, repeats folded
  maybe: string | null; // a chord heard once: it counts when the next strum agrees
  loop: Chord[] | null;
}

function bandPref(): boolean {
  try {
    return (JSON.parse(getStoredItem(PREFS) ?? "{}") as { band?: boolean }).band !== false;
  } catch {
    return true;
  }
}

const fresh = (): State => ({
  onsets: [],
  count: 0,
  key: null,
  pattern: null,
  division: 2,
  lock: restingLock(START_BPM),
  mode: "follows",
  change: null,
  beats: [],
  nextTime: 0,
  n: 0,
  readAt: 2 * READ_BEATS,
  beat: -1,
  beatSignal: IDLE_BEAT,
  steadyFrom: 0,
  misfit: null,
  heard: false,
  dirty: true,
  secs: 0,
  best: null,
  record: null,
  beaten: false,
  onGrid: null,
  timing: [],
  alignment: null,
  spread: null,
  trace: [],
  band: false,
  bandOn: bandPref(),
  vamp: [],
  bar: 0,
  written: { count: 0, midis: [] },
  lastTick: 0,
  strums: [],
  maybe: null,
  loop: null,
});

const snapshot = (s: State): FreeView => ({
  count: s.count,
  written: s.written,
  key: s.key,
  pattern: s.pattern,
  division: s.division,
  on: s.lock.on && s.beatSignal.active,
  bpm: s.lock.bpm,
  mood: s.lock.on ? s.lock.mood : null,
  beat: s.beat,
  n: s.n,
  beatSignal: s.beatSignal,
  change: s.change,
  mode: s.mode,
  held: s.mode === "steady" || held(s.lock),
  rise: toRise(s.lock),
  bars: s.lock.on ? s.lock.streak * 2 : 0,
  onGrid: s.lock.on ? s.onGrid : null,
  timing: s.timing,
  alignment: s.lock.on ? s.alignment : null,
  spread: s.lock.on ? s.spread : null,
  trace: s.trace,
  best: s.best,
  record: s.record,
  beaten: s.beaten,
  secs: Math.round(s.secs),
  band: s.band && s.beatSignal.active,
  bandOn: s.bandOn,
  chords: s.vamp.map((c) => c.name),
  bar: s.bar,
  loop: s.loop?.map((c) => c.symbol) ?? null,
});

const faster = (a: Pace, b: Pace | null) => !b || a.bpm * a.division > b.bpm * b.division;

function quietClock(s: State) {
  s.beats = [];
  s.nextTime = 0;
  s.beat = -1;
  s.beatSignal = { ...IDLE_BEAT, serial: s.beatSignal.serial };
  s.band = false;
  s.alignment = null;
  s.spread = null;
  s.timing = [];
}

/** `active`: false holds everything still (a menu is open). */
export function useFreePlay(input: InputApi, active: boolean) {
  const st = useRef<State>(fresh());
  const log = useRef<FreeEntry[] | null>(null);
  const [view, setView] = useState<FreeView>(() => snapshot(st.current));
  const listening = input.status === "listening" && !input.paused;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  const stopClick = useRef<() => void>(() => undefined);
  const { subscribe } = input;

  // the notes
  useEffect(() => {
    if (!active || !listening) return;
    const onset = createOnsets();
    return subscribe((f) => {
      const o = onset({ midi: midiOf(f), rms: f.rms, now: f.now });
      if (!o) return;
      const s = st.current;
      s.onsets.push(o);
      if (s.onsets.length > HISTORY) s.onsets.shift();
      s.count++;
      const midis = s.onsets.map((x) => x.midi);
      const keyBefore = s.key?.scale.id;
      const before = `${keyBefore}:${s.pattern}`;
      s.key = guessKey(midis.slice(-KEY_NOTES)) ?? s.key;
      s.pattern = s.key ? guessPattern(midis.slice(-PATTERN_NOTES), s.key.scale)?.pattern ?? s.pattern : null;
      if (s.key && s.key.scale.id !== keyBefore) s.vamp = vamp(s.key.scale);
      if (s.key && s.pattern && `${s.key.scale.id}:${s.pattern}` !== before) {
        // something else is being played now: its own record, its own best
        log.current ??= loadFreePlay();
        s.record = freeRecord(log.current, s.key.scale.id, s.pattern);
        s.best = null;
        s.beaten = false;
      }
      // where it sat against the grid: the nearest beat, then the nearest cell of it
      if (s.lock.on && s.beats.length) {
        const t = o.at - inputLag();
        const near = s.beats.reduce((a, b) => (Math.abs(b.perf - t) < Math.abs(a.perf - t) ? b : a));
        const x = ((t - near.perf) / near.ms) * s.division;
        s.timing = [...s.timing, x - Math.round(x)].slice(-TIMING_NOTES);
      }
      s.heard = true;
      s.dirty = true;
    });
  }, [active, listening, subscribe]);

  // chords: a strum, then what rings just after it; a chord counts once two strums agree
  useEffect(() => {
    if (!active || !listening) return;
    const levels: number[] = [];
    let read: { from: number; until: number; count: number[]; n: number } | null = null;
    return subscribe((f) => {
      const floor = levels.length ? Math.min(...levels) : Infinity;
      levels.push(f.rms);
      if (levels.length > 4) levels.shift();
      if (!read && f.rms > 0.006 && f.rms > floor * STRUM_RATIO) read = { from: f.now + STRUM_SETTLE_MS, until: f.now + STRUM_SETTLE_MS + STRUM_READ_MS, count: Array(12).fill(0), n: 0 };
      if (!read || f.now < read.from) return;
      for (const pc of strongPitchClasses(detectNotes(f.buf, f.sampleRate))) read.count[pc]++;
      read.n++;
      if (f.now < read.until) return;
      const ringing = read.count.flatMap((c, pc) => (c >= read!.n / 2 ? [pc] : []));
      read = null;
      const c = ringing.length >= STRUM_MIN_PCS ? nameChord(ringing) : null;
      const s = st.current;
      if (!c) return;
      if (s.maybe !== c.symbol) {
        s.maybe = c.symbol;
        return;
      }
      const before = s.loop?.map((x) => x.symbol).join(" ");
      s.strums = addChord(s.strums, c);
      s.loop = findLoop(s.strums) ?? s.loop;
      if (s.loop?.map((x) => x.symbol).join(" ") !== before) s.dirty = true;
    });
  }, [active, listening, subscribe]);

  // the click, and the band
  useEffect(() => {
    if (!active) return;
    ensureAudio();
    void Tone.start().catch(() => undefined);
    const out = new Tone.Volume(-6).toDestination();
    const shots = new OneShots();
    stopClick.current = () => shots.stopAll();
    const ctx = Tone.getContext().rawContext as AudioContext;
    const perfOf = (time: number) => {
      const stamp = ctx.getOutputTimestamp?.();
      return stamp && stamp.contextTime && stamp.performanceTime
        ? stamp.performanceTime + (time - stamp.contextTime) * 1000
        : performance.now() + (time - ctx.currentTime + (ctx.outputLatency ?? 0.05)) * 1000;
    };
    const s0 = st.current;
    // coming back from a menu: the clock starts over, the tempo stays
    quietClock(s0);
    s0.readAt = s0.n + 2 * READ_BEATS;
    s0.lastTick = performance.now();
    s0.steadyFrom = s0.lastTick;
    s0.misfit = null;
    s0.band = false;
    let shown = 0;
    let written = 0;
    let lastSounded = -1;
    let suspended = false;

    /** The click comes in (or moves over) a little under the tempo the notes are coming at. */
    const seat = (s: State, gap: number, change: FreeView["change"]) => {
      const c = clickFor(gap);
      s.lock = { ...restingLock(c.bpm), on: true };
      s.division = c.division;
      s.change = change;
      shots.stopAll();
      quietClock(s);
      s.n -= s.n % 4; // the bar starts over with it
      s.readAt = s.n + 2 * READ_BEATS;
      s.misfit = null;
      s.band = false;
      s.timing = [];
      s.trace = [...s.trace, c.bpm].slice(-TRACE);
      s.dirty = true;
    };

    const id = window.setInterval(() => {
      const s = st.current;
      const now = performance.now();
      const lastOnset = s.onsets[s.onsets.length - 1]?.at ?? -Infinity;
      if (listeningRef.current && now - lastOnset < PLAYING_MS) s.secs += Math.min(0.25, (now - s.lastTick) / 1000);
      s.lastTick = now;
      if (ctx.state !== "running") {
        if (!suspended) {
          shots.stopAll();
          quietClock(s);
          setView(snapshot(s));
        }
        suspended = true;
        return;
      }
      suspended = false;
      const heard = s.heard;
      s.heard = false;
      // the tempo the notes are coming at by themselves, while they are
      const own = () => (now - lastOnset < FRESH_MS ? steadyGap(s.onsets.filter((o) => o.at > s.steadyFrom).map((o) => o.at)) : null);

      if (s.lock.on) {
        const spb = 60 / s.lock.bpm;
        if (s.nextTime < ctx.currentTime) s.nextTime = ctx.currentTime + 0.08;
        while (s.nextTime < ctx.currentTime + LOOKAHEAD_S) {
          const inBar = s.n % 4;
          const t = s.nextTime;
          // the band comes in on a bar line, once the playing has sat on the click for a while
          if (inBar === 0 && !s.band && s.bandOn && s.vamp.length && s.lock.streak >= BAND_AFTER && s.lock.mood === "locked") s.band = true;
          const accent = inBar === 0;
          shots.play(clickBuffer(accent), out, t, s.band ? (accent ? 0.4 : 0.22) : accent ? 0.9 : 0.55);
          if (s.band) {
            const chord = s.vamp[Math.floor(s.n / 4) % s.vamp.length];
            if (inBar === 0) {
              for (const m of chord.pad) shots.play(keysBuffer(m), out, t, 0.15, spb * 3.8, 0.25);
              shots.play(kickBuffer(), out, t, 0.3);
            }
            if (inBar === 0 || inBar === 2) shots.play(bassBuffer(inBar === 0 ? chord.bass : chord.fifth), out, t, 0.6, spb * 1.8, 0.1);
            else shots.play(hatBuffer(), out, t, 0.22);
          }
          s.beats.push({ n: s.n, perf: perfOf(t), ms: spb * 1000 });
          if (s.beats.length > 48) s.beats.shift();
          s.nextTime += spb;
          s.n++;
        }
        let sounding: Beat | undefined;
        for (let i = s.beats.length - 1; i >= 0 && !sounding; i--) if (s.beats[i].perf <= now) sounding = s.beats[i];
        const beat = sounding ? sounding.n % 4 : -1;
        if (sounding && (!s.beatSignal.active || sounding.n !== lastSounded)) {
          lastSounded = sounding.n;
          s.beatSignal = { index: beat, serial: s.beatSignal.serial + 1, active: true, beats: 4, counting: false };
          s.beat = beat;
          s.bar = sounding ? Math.floor(sounding.n / 4) % 4 : 0;
          s.dirty = true;
          shown = 0; // a beat is shown on the beat
        }
        // every two bars: how the notes sat on the click, and what the click does about it
        if (sounding && sounding.n >= s.readAt) {
          const to = sounding;
          const from = s.beats.find((b) => b.n === to.n - READ_BEATS);
          s.readAt = to.n + READ_BEATS;
          if (from) {
            const played = s.onsets.filter((o) => o.at - inputLag() >= from.perf - from.ms * 0.3 && o.at - inputLag() < to.perf);
            const grid = readGrid(played.map((o) => o.at - inputLag()), from.perf, from.ms, READ_BEATS);
            const scale = s.key?.scale;
            const inKey = scale && played.length ? played.filter((o) => scale.pcs.includes(mod(o.midi))).length / played.length : 1;
            const r = stepLock(s.lock, { notes: played.length, grid, inKey, beatMs: from.ms });
            if (grid && grid.onGrid >= 0.75) {
              if (s.division !== grid.division) s.timing = [];
              s.division = grid.division;
            }
            const displayGrid = grid?.division === s.division && played.length >= 4 ? grid : null;
            s.onGrid = displayGrid?.onGrid ?? null;
            s.alignment = displayGrid?.offset ?? null;
            s.spread = displayGrid?.spread ?? null;
            const pace = { bpm: s.lock.bpm, division: s.division };
            if (r.lock.mood === "locked" && r.lock.on && faster(pace, s.best)) {
              s.best = pace;
              if (!s.beaten && s.record && faster(pace, s.record)) {
                s.beaten = true;
                glint();
              }
            }
            if (s.mode === "steady") {
              // a steady click only says how the player sits on it; it moves by hand
              s.lock = { ...s.lock, mood: r.change === "off" ? "loose" : r.change === "rest" ? null : r.lock.mood, streak: r.lock.on ? r.lock.streak : 0, quiet: 0, loose: 0, alignment: r.lock.alignment, division: r.lock.division };
              s.change = null;
            } else {
              s.lock = r.lock;
              s.change = r.change;
              if (!r.lock.on) s.steadyFrom = now;
            }
            if (!s.lock.on || s.lock.mood === "loose") s.band = false;
            s.trace = [...s.trace, s.lock.on ? s.lock.bpm : 0].slice(-TRACE);
            s.dirty = true;
          }
        }
        // settled on a tempo of their own (another exercise, or simply slower): the click goes there
        if (heard && s.mode === "follows" && s.lock.on) {
          const gap = own();
          if (gap && !fitsClick(gap, 60000 / s.lock.bpm)) {
            s.misfit ??= now;
            if (now - s.misfit >= MOVE_MS) seat(s, gap, "moved");
          } else if (gap) s.misfit = null;
        }
      } else {
        if (s.beatSignal.active) {
          shots.stopAll();
          quietClock(s);
          s.dirty = true;
        }
        // the click joins once the player has a tempo of their own, a little under it
        const gap = s.mode === "follows" && heard ? own() : null;
        if (gap) seat(s, gap, "on");
      }

      if (!s.lock.on && s.beatSignal.active) {
        shots.stopAll();
        quietClock(s);
      }

      if (s.dirty && now - written > WRITE_MS) {
        written = now;
        s.written = { count: s.count, midis: s.onsets.map((o) => o.midi) };
      }
      if (s.dirty && now - shown > SHOW_MS) {
        shown = now;
        s.dirty = s.written.count !== s.count; // the page still has to catch up
        setView(snapshot(s));
      }
    }, TICK_MS);
    return () => {
      window.clearInterval(id);
      shots.stopAll();
      quietClock(st.current);
      stopClick.current = () => undefined;
      window.setTimeout(() => out.dispose(), 200);
    };
  }, [active]);

  // what was practised goes into the log on the way out
  useEffect(
    () => () => {
      const s = st.current;
      if (s.key && s.pattern && s.secs >= MIN_LOG_SECS)
        logFreePlay({ day: today(), key: s.key.scale.id, pattern: s.pattern, bpm: s.best?.bpm ?? 0, division: s.best?.division ?? s.division, secs: Math.round(s.secs) });
    },
    [],
  );

  /** The tempo by hand; turns the click on if it was off. Slower stays slower: the click holds there until the playing is very clean. */
  const nudge = useCallback((by: number) => {
    const s = st.current;
    const bpm = Math.max(CLICK_MIN, Math.min(CLICK_MAX, s.lock.bpm + by));
    if (s.mode === "off") s.mode = "steady";
    s.lock = { ...s.lock, on: true, bpm, clean: 0, behind: 0, loose: 0, quiet: 0, rose: null, hold: by < 0 ? bpm : null, alignment: null, division: null };
    s.change = by > 0 ? "up" : "down";
    s.misfit = null;
    s.trace = [...s.trace, bpm].slice(-TRACE);
    setView(snapshot(s));
  }, []);

  /** follows → steady → off → follows. */
  const cycleMode = useCallback(() => {
    const s = st.current;
    s.mode = s.mode === "follows" ? "steady" : s.mode === "steady" ? "off" : "follows";
    if (s.mode === "steady") s.lock = { ...s.lock, on: true };
    if (s.mode === "off") {
      s.lock = { ...s.lock, on: false, mood: null };
      stopClick.current();
      quietClock(s);
    }
    if (s.mode === "follows") s.steadyFrom = performance.now();
    s.change = null;
    setView(snapshot(s));
  }, []);

  const toggleBand = useCallback(() => {
    const s = st.current;
    s.bandOn = !s.bandOn;
    if (!s.bandOn) s.band = false;
    try {
      setStoredItem(PREFS, JSON.stringify({ band: s.bandOn }));
    } catch {
      // for this visit only
    }
    setView(snapshot(s));
  }, []);

  return { view: active && st.current.beatSignal.active ? view : { ...view, on: false, beat: -1, band: false, mood: null, beatSignal: { ...view.beatSignal, index: -1, active: false } }, nudge, cycleMode, toggleBand };
}

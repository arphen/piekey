import { ctxToPerf, heardTime, inputLag, PAINT_LEAD_S } from "../audio/latency";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { pluckBuffer } from "../audio/pluck";
import { bassBuffer, clickBuffer, hatBuffer, keysBuffer, kickBuffer, OneShots } from "../audio/samples";
import type { NoteResult } from "../core/contract";
import { midiOf } from "../listen/pitch";
import { detectNotes, strongPitchClasses } from "../listen/spectrum";
import type { InputApi } from "../listen/useInput";
import type { Timeline } from "./order";
import type { Support } from "../song/support";
import { createOnsets } from "../song/freeplay";
import { createAttacks } from "../listen/attacks";
import { judgePitch } from "./scoring";
import { IDLE_BEAT, type BeatSignal } from "../song/pulse";

// Plays a lead sheet in playing order on the audio clock: melody (plucked string), the chords
// part (keys) and an optional click, with count-in and looping. A short lookahead loop schedules
// buffers a quarter second ahead, so tempo, loop and mix changes land on the next notes: the
// tempo can move while the band plays, without a restart. A looped phrase may breathe: a counted
// bar between passes, so the player has time to come back to its first note.
// While listening, each melody note is scored in time: green when its pitch sounds around it.
// The edges of the range are judged loosely: the first note may come in early, the last may land
// late, and a finished pass keeps its colours for a moment so its last note is seen too.
// Practice timelines may add a bass line and an unscored guide melody, and may ask for chords
// instead of notes: a chord counts when all its required pitch classes ring together in its span.

export interface PlaybackMix {
  bpm: number;
  melody: boolean;
  chords: boolean;
  click: boolean;
  countIn: boolean;
  clickSubdivision?: 1 | 2 | 3 | 4; // optional quiet divisions between quarter-note beats
  bass?: boolean; // the timeline's bass line, when it has one (default on)
  guide?: boolean; // the timeline's unscored guide melody (default on)
  fill?: boolean; // a quiet click on the beats where no chord sounds, so the time is never lost
  pulse?: boolean; // a felt kick and hat on every beat the click is not on (eighths when slow; the hat alone in gaps): the beat is never guessed
  breath?: boolean | number; // looping: a musical turnaround bar (or exact beat count) between passes; can tighten dynamically mid-loop
  shadow?: Support | null; // with `melody` off: the melody under the player, as loud as they need it
  gap?: { on: number; off: number } | null; // beats with the band, then beats without it (still scored): the player keeps the time
}

export interface PassScore {
  hit: number;
  total: number;
  heard: number; // frames with a pitch during the pass: 0 means the player sat it out
  offset: number | null; // how the notes sat against the beat, in ms: after it (+) or ahead of it (−)
  results: NoteResult[]; // the pass note by note, parallel to the timeline's targets
  wrong: (number | null)[]; // what sounded instead of a missed note, parallel to the targets
  at: (number | null)[]; // each landed note's offset from its beat, ms, parallel to the targets
  bpm?: number; // slowest tempo actually scheduled in this pass, never the current UI setting
  tempoStable?: boolean; // every scheduled part of this pass used the same tempo
}

const LOOKAHEAD_S = 0.25;
const TICK_MS = 25;
const LATE_MS = 80; // and still ring this long after its end
const EDGE_LATE_MS = 320; // and the last may land late: nothing follows it
const CHORD_EARLY_MS = 150; // a strum may land a little before the change
const CHORD_FRAMES = 2; // frames of the whole chord ringing that count as played
const CHORD_GATE_RMS = 0.002;
const STRIKE_RATIO = 1.7; // louder than the quietest of the last few frames by this much: a new attack
const HOLD_MS = 650; // a finished pass keeps its colours this long into the next one
const SLOW_SPB = 60 / 84; // beats slower than this get a quiet eighth between them: long silences lose the time

interface Seg {
  r: number; // from this beat past t0 on,
  time: number; // which sounds at this context time,
  spb: number; // a beat lasts this long
}

interface Pending {
  target: number;
  start: number; // perf-time window of the note
  end: number;
  iter: number;
  previousStart: number | null;
  nextStart: number | null;
}

interface Pass {
  iter: number;
  results: NoteResult[];
  wrong: (number | null)[];
  offsets: number[];
  at: (number | null)[];
  start: number; // performance.now() when it began to be heard
}

interface IterSpan {
  iter: number;
  r0: number; // beats past t0 where this pass begins
  len: number; // music beats in this pass
  breath: number; // live-band turnaround beats after this pass before the next
}

interface Session {
  out: Tone.Volume;
  shots: OneShots;
  t0: number; // context time of the range start (after count-in)
  from: number; // range in beats
  length: number;
  barBeats: number; // default turnaround bar length (beats of the opening bar)
  iters: IterSpan[]; // per-pass start offsets so turnaround can tighten seamlessly mid-loop
  loop: boolean;
  first: number; // targets at the edges of the range
  last: number;
  segs: Seg[]; // the tempo, piece by piece
  nextR: number; // beats past t0 scheduled so far
  timer: number;
  pending: Pending[];
  pass: Pass; // the pass being heard
  closing: Pass | null; // the one before, while its last note may still land
  held: { results: NoteResult[]; wrong: (number | null)[]; until: number } | null;
}

interface Sample {
  t: number;
  midi: number | null;
  pcs: number[] | null; // pitch classes ringing, when listening for chords
  strike: boolean; // the level jumped: something was just played
  onset: number | null;
}

const rawContext = () => Tone.getContext().rawContext as AudioContext;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : null;
};

/**
 * Beat subdivision needed to feel an off-beat phrase entry after an opening rest:
 * 2 for an 8th-note entry (e.g. 8th rest on beat 1), 3 for a triplet, 4 for a 16th-note entry.
 */
export function entrySubdivision(offsetBeats: number): 1 | 2 | 3 | 4 {
  if (!(offsetBeats > 1e-6)) return 1;
  const frac = offsetBeats - Math.floor(offsetBeats);
  if (frac <= 1e-6 || frac >= 1 - 1e-6) return 1;
  if (Math.abs(frac - 0.5) < 0.08) return 2;
  if (Math.abs(frac - 1 / 3) < 0.06 || Math.abs(frac - 2 / 3) < 0.06) return 3;
  if (Math.abs(frac - 0.25) < 0.08 || Math.abs(frac - 0.75) < 0.08) return 4;
  return 1;
}

export function usePlayback(tl: Timeline, mix: PlaybackMix, input: InputApi, scoring: boolean, anyOctave: boolean, ignore?: ReadonlySet<number>) {
  const [playing, setPlaying] = useState(false);
  const [counting, setCounting] = useState(0); // count-in beats left
  const [breathing, setBreathing] = useState(false); // true during a musical turnaround bar between passes
  const [reentry, setReentry] = useState(0); // beats left until bar 1 re-enters (turnaround OR post-final-note tail)
  const [active, setActive] = useState({ target: -1, slot: -1 });
  const [results, setResults] = useState<NoteResult[]>(() => tl.targets.map(() => null));
  const [wrong, setWrong] = useState<(number | null)[]>([]); // the pitch heard instead of each missed note
  const [lastPass, setLastPass] = useState<PassScore | null>(null);
  const [drift, setDrift] = useState<number | null>(null); // ms against the beat, lately: + behind, − ahead
  const [beat, setBeat] = useState<BeatSignal>(IDLE_BEAT);
  const beatRef = useRef(beat);
  const generation = useRef(0);

  const session = useRef<Session | null>(null);
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const tlRef = useRef(tl);
  const scoringRef = useRef(scoring);
  scoringRef.current = scoring;
  const anyOctaveRef = useRef(anyOctave);
  anyOctaveRef.current = anyOctave;
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;
  const samples = useRef<Sample[]>([]);
  const activeRef = useRef(active);
  const countRef = useRef(0);
  const breathRef = useRef(false);
  const reentryRef = useRef(0);
  const driftRef = useRef<number | null>(null);
  // The timeline beat being heard, while there is one. Through a gap the band is silent and there is
  // nothing heard to follow; a score that must keep moving may still ask where the music is.
  const position = useRef<((throughGaps?: boolean) => number | null) | null>(null);

  const clicks = useMemo(
    () => tl.slots.flatMap((s) => Array.from({ length: Math.max(1, Math.round(s.beats)) }, (_, b) => ({ t: s.start + b, accent: b === 0, index: b, beats: Math.max(1, Math.round(s.beats)) }))),
    [tl],
  );

  const stop = useCallback(() => {
    generation.current++;
    position.current = null;
    if (beatRef.current.active) {
      beatRef.current = { ...IDLE_BEAT, serial: beatRef.current.serial };
      setBeat(beatRef.current);
    }
    const s = session.current;
    if (!s) return;
    session.current = null;
    window.clearInterval(s.timer);
    s.shots.stopAll();
    s.out.volume.rampTo(-60, 0.05);
    window.setTimeout(() => s.out.dispose(), 200);
    setPlaying(false);
    countRef.current = 0;
    setCounting(0);
    breathRef.current = false;
    setBreathing(false);
    reentryRef.current = 0;
    setReentry(0);
    activeRef.current = { target: -1, slot: -1 };
    setActive(activeRef.current);
  }, []);

  useEffect(() => {
    tlRef.current = tl;
    stop();
    setResults(tl.targets.map(() => null));
    setWrong([]);
    setLastPass(null);
  }, [tl, stop]);

  const play = useCallback(
    async (fromSlot: number, toSlot?: number, loop = false) => {
      stop();
      const token = generation.current;
      ensureAudio();
      await Tone.start();
      if (generation.current !== token) return;
      const ctx = rawContext();
      const t = tlRef.current;
      if (!t.slots.length) return;
      const a = Math.max(0, Math.min(fromSlot, t.slots.length - 1));
      const b = Math.max(a, Math.min(toSlot ?? t.slots.length - 1, t.slots.length - 1));
      const from = t.slots[a].start;
      const length = t.slots[b].start + t.slots[b].beats - from;
      const spb0 = 60 / mixRef.current.bpm;
      const barBeats = Math.max(2, Math.round(t.slots[a].beats));
      const breathBeats = (b: PlaybackMix["breath"]) => (!loop || !b ? 0 : typeof b === "number" ? Math.max(0, Math.round(b)) : barBeats);
      const countBeats = mixRef.current.countIn ? barBeats : 0;
      const initialBreath = breathBeats(mixRef.current.breath);
      const t0 = ctx.currentTime + 0.15 + countBeats * spb0;
      const inRange = (x: number, lo: number, hi: number) => x >= lo - 1e-9 && x < hi - 1e-9;
      const ranged = t.targets.map((n, i) => (inRange(n.t, from, from + length) ? i : -1)).filter((i) => i >= 0);
      const firstRangedTarget = ranged.length ? t.targets[ranged[0]] : null;
      const entryOffset = firstRangedTarget ? Math.max(0, firstRangedTarget.t - from) : 0;
      const entrySub = entrySubdivision(entryOffset);
      const lastRangedTarget = ranged.length ? t.targets[ranged[ranged.length - 1]] : null;
      // When the final note is a long held resolution (e.g. a 4-beat whole note at the end of a scale),
      // its remaining hold beats after beat 1 act as the re-entry runway into Bar 1 in continuous loops.
      const tailStart = lastRangedTarget
        ? Math.max(0, lastRangedTarget.t + (lastRangedTarget.dur >= 2 ? 1 : lastRangedTarget.dur) - from)
        : length;
      const beatGrid = clicks.filter((c) => inRange(c.t, from, from + length));
      // Harmony & bass anchor for musical turnaround bars: resolve gently into Bar 1's opening chord.
      const turnaroundComp = t.comp.find((c) => c.t >= from - 1e-6 && c.t < from + length - 1e-6) ?? t.comp[0] ?? null;
      const turnaroundBass = (t.bass ?? []).find((v) => v.t >= from - 1e-6 && v.t < from + length - 1e-6) ?? t.bass?.[0] ?? null;
      let lastBeat = "";

      // render the notes ahead of time so the first bar doesn't stutter
      for (const i of ranged) for (const m of t.targets[i].chord?.voicing ?? [t.targets[i].midi]) pluckBuffer(m);
      for (const g of t.guide ?? []) if (g.t >= from && g.t < from + length) pluckBuffer(g.midi);

      const out = new Tone.Volume(-4).toDestination();
      const shots = new OneShots();
      const countDivision = mixRef.current.clickSubdivision ?? 1;
      for (let k = 0; k < countBeats; k++) {
        const beatTime = t0 - (countBeats - k) * spb0;
        if (mixRef.current.pulse) {
          shots.play(hatBuffer(), out, beatTime, k === 0 ? 0.65 : 0.45);
          if (k === 0) shots.play(kickBuffer(), out, beatTime, 0.42);
        }
        // When the phrase enters after an 8th/16th/triplet rest, subdivide the lead-in beats of the
        // count-in so the player feels the exact grid right into beat 1 (e.g. 1, 2, 3-&, 4-e-&-a).
        const leadDiv = entrySub > countDivision
          ? entrySub === 4
            ? (k === countBeats - 1 ? 4 : k === countBeats - 2 ? 2 : countDivision)
            : (k >= countBeats - 2 ? entrySub : countDivision)
          : countDivision;
        const beatDiv = Math.max(countDivision, leadDiv);
        for (let part = 0; part < beatDiv; part++) {
          const when = t0 - (countBeats - k - part / beatDiv) * spb0;
          if (part === 0) {
            shots.play(clickBuffer(k === 0), out, when, mixRef.current.pulse ? 0.44 : 0.6);
          } else {
            if (mixRef.current.pulse) shots.play(hatBuffer(), out, when, beatDiv === 4 && part % 2 === 1 ? 0.24 : 0.34);
            shots.play(clickBuffer(false), out, when, beatDiv === 4 && part % 2 === 1 ? 0.16 : 0.22);
          }
        }
      }

      const blank = () => t.targets.map((): NoteResult => null);
      const scheduledTempos = new Map<number, { min: number; max: number }>();
      const startPerf = performance.now() + (t0 - ctx.currentTime) * 1000;
      const s: Session = {
        out,
        shots,
        t0,
        from,
        length,
        barBeats,
        iters: [{ iter: 0, r0: 0, len: length, breath: initialBreath }],
        loop,
        first: ranged[0] ?? -1,
        last: ranged[ranged.length - 1] ?? -1,
        segs: [{ r: 0, time: t0, spb: spb0 }],
        nextR: 0,
        timer: 0,
        pending: [],
        pass: { iter: 0, results: blank(), wrong: [], offsets: [], at: t.targets.map(() => null), start: startPerf },
        closing: null,
        held: null,
      };
      session.current = s;
      setResults(s.pass.results);
      setWrong(s.pass.wrong);
      driftRef.current = null;
      setDrift(null);
      setPlaying(true);

      // Dynamic iteration spans: each pass reads the current `breath` setting when scheduled so
      // adaptive loop mode can tighten smoothly from a turnaround into a continuous loop without restarting.
      const iterAt = (r: number): IterSpan => {
        if (r <= 0) return s.iters[0];
        let last = s.iters[s.iters.length - 1];
        while (r >= last.r0 + last.len + last.breath - 1e-9) {
          const next: IterSpan = {
            iter: last.iter + 1,
            r0: last.r0 + last.len + last.breath,
            len: s.length,
            breath: breathBeats(mixRef.current.breath),
          };
          s.iters.push(next);
          last = next;
          if (s.iters.length > 16) s.iters.shift();
        }
        for (let k = s.iters.length - 1; k >= 0; k--) {
          if (s.iters[k].r0 <= r + 1e-9) return s.iters[k];
        }
        return s.iters[0];
      };
      const iterById = (id: number): IterSpan => {
        const found = s.iters.find((it) => it.iter === id);
        if (found) return found;
        let last = s.iters[s.iters.length - 1];
        while (last.iter < id) {
          const next: IterSpan = {
            iter: last.iter + 1,
            r0: last.r0 + last.len + last.breath,
            len: s.length,
            breath: breathBeats(mixRef.current.breath),
          };
          s.iters.push(next);
          last = next;
          if (s.iters.length > 16) s.iters.shift();
        }
        return last;
      };

      // beats past t0 ↔ context time, through every tempo change so far
      const segAt = (r: number) => {
        let k = s.segs.length - 1;
        while (k > 0 && s.segs[k].r > r) k--;
        return s.segs[k];
      };
      const timeOf = (r: number) => {
        const g = segAt(r);
        return g.time + (r - g.r) * g.spb;
      };
      const rOf = (time: number) => {
        let k = s.segs.length - 1;
        while (k > 0 && s.segs[k].time > time) k--;
        return s.segs[k].r + (time - s.segs[k].time) / s.segs[k].spb;
      };

      const schedule = (lo: number, hi: number, span: IterSpan) => {
        const m = mixRef.current;
        const iterStart = span.r0;
        const at = (beat: number) => timeOf(iterStart + beat - s.from);
        const spb = segAt(iterStart + lo - s.from).spb;
        const perfOf = (time: number) => ctxToPerf(ctx, time);
        const pass = span.iter;
        const end = s.from + s.length;
        // Musical turnaround bar: keep the band's groove, bass, and opening harmony breathing
        // instead of cutting to dead air; give only a gentle pickup click on the final two beats.
        if (span.breath > 0 && hi > end + 1e-9) {
          const tLo = Math.max(lo, end);
          if (m.chords && turnaroundComp && inRange(end, tLo, hi)) {
            for (const midi of turnaroundComp.midis) shots.play(keysBuffer(midi), out, at(end), 0.14, span.breath * spb * 0.92, 0.18);
          }
          if (m.bass !== false && turnaroundBass) {
            for (let k = 0; k < span.breath; k += 2) {
              const when = end + k;
              if (inRange(when, tLo, hi)) shots.play(bassBuffer(turnaroundBass.midi), out, at(when), k === 0 ? 0.56 : 0.42, Math.min(2, span.breath - k) * spb * 0.85, 0.1);
            }
          }
          const division = m.clickSubdivision ?? 1;
          const pickupFrom = Math.max(0, span.breath - 2);
          for (let k = 0; k < span.breath; k++) {
            const when = end + k;
            if (inRange(when, tLo, hi)) {
              if (m.pulse) {
                shots.play(kickBuffer(), out, at(when), k === 0 ? 0.48 : 0.28);
                shots.play(hatBuffer(), out, at(when), k === 0 ? 0.72 : 0.54);
              }
              if (m.click || k >= pickupFrom) {
                shots.play(clickBuffer(k === 0 && m.click), out, at(when), k >= pickupFrom ? 0.42 : 0.26);
              }
            }
            const off = when + 0.5;
            const leadDiv = entrySub > division
              ? entrySub === 4
                ? (k === span.breath - 1 ? 4 : k === span.breath - 2 ? 2 : division)
                : (k >= pickupFrom ? entrySub : division)
              : division;
            if (leadDiv > 1) {
              for (let part = 1; part < leadDiv; part++) {
                const sub = when + part / leadDiv;
                if (!inRange(sub, tLo, hi)) continue;
                if (m.pulse && (entrySub > 1 || (leadDiv === 2 && spb >= SLOW_SPB))) shots.play(hatBuffer(), out, at(sub), leadDiv === 4 && part % 2 === 1 ? 0.22 : 0.3);
                if (m.click || k >= pickupFrom) shots.play(clickBuffer(false), out, at(sub), leadDiv === 4 && part % 2 === 1 ? 0.14 : 0.18);
              }
            } else if (m.pulse && spb >= SLOW_SPB && inRange(off, tLo, hi)) {
              shots.play(hatBuffer(), out, at(off), 0.28);
            }
          }
        }
        hi = Math.min(hi, end);
        if (lo >= hi - 1e-9) return;
        // in a gap the band and the click leave the player alone; the notes are still judged
        const cycle = m.gap ? m.gap.on + m.gap.off : 0;
        const quiet = (beat: number) => cycle > 0 && ((((pass * s.length + beat - s.from) % cycle) + cycle) % cycle) >= m.gap!.on - 1e-9; // counted across loops, breaths left out
        const prevSpan = pass > 0 ? s.iters.find((it) => it.iter === pass - 1) : null;
        const prevPeriod = prevSpan ? prevSpan.len + prevSpan.breath : span.len + span.breath;
        const curPeriod = span.len + span.breath;
        t.targets.forEach((n, i) => {
          if (!inRange(n.t, lo, hi)) return;
          const time = at(n.t);
          const vol = quiet(n.t) ? 0 : m.melody ? 1 : m.shadow ? m.shadow.gain(i) : 0;
          if (vol > 0 && n.chord)
            [...n.chord.voicing].sort((x, y) => x - y).forEach((midi, k) => shots.play(pluckBuffer(midi), out, time + k * 0.03, 0.55 * vol, n.dur * spb * 0.95, 0.12));
          else if (vol > 0) shots.play(pluckBuffer(n.midi), out, time, 0.9 * vol, n.dur * spb * 0.95 + 0.04, 0.08);
          const before = i === s.first ? (s.loop ? t.targets[s.last] : null) : t.targets[i - 1];
          const previousStart = before ? perfOf(timeOf(iterStart + before.t - s.from - (i === s.first ? prevPeriod : 0))) : null;
          const after = i === s.last ? (s.loop ? t.targets[s.first] : null) : t.targets[i + 1];
          const nextStart = after ? perfOf(timeOf(iterStart + after.t - s.from + (i === s.last ? curPeriod : 0))) : null;
          s.pending.push({ target: i, start: perfOf(time), end: perfOf(time + n.dur * spb), iter: pass, previousStart, nextStart });
        });
        if (m.chords) for (const c of t.comp) if (inRange(c.t, lo, hi) && !quiet(c.t)) for (const midi of c.midis) shots.play(keysBuffer(midi), out, at(c.t), 0.2, c.dur * spb, 0.15);
        // the pulse: felt on every beat, and between them when they are far apart; in a gap only the hat stays.
        // Even when the click is on (scales/drills), keep a supportive felt kick + hat groove and slow 8th-note
        // subdivision underneath so the player always feels beat 1 and the pocket rather than a dry bare tick.
        const pulse = (c: (typeof clicks)[number], underClick = false) => {
          if (quiet(c.t)) return shots.play(hatBuffer(), out, at(c.t), c.accent ? 0.45 : 0.28);
          shots.play(kickBuffer(), out, at(c.t), underClick ? (c.accent ? 0.56 : 0.24) : (c.accent ? 0.6 : 0.4));
          shots.play(hatBuffer(), out, at(c.t), underClick ? (c.accent ? 0.52 : 0.36) : (c.accent ? 0.9 : 0.65));
        };
        const tailPickupFrom = s.loop && span.breath === 0 && s.length - tailStart >= 1.25 ? s.from + Math.max(tailStart, s.length - 2) : Infinity;
        if (m.click) {
          const division = m.clickSubdivision ?? 1;
          for (const c of clicks) {
            if (m.pulse && inRange(c.t, lo, hi)) {
              pulse(c, true);
              const off = c.t + 0.5;
              if (division === 1 && spb >= SLOW_SPB && inRange(off, lo, hi) && !quiet(off)) shots.play(hatBuffer(), out, at(off), 0.28);
            }
            for (let part = 0; part < division; part++) {
              const when = c.t + part / division;
              if (!inRange(when, lo, hi)) continue;
              const isPickup = part === 0 && when >= tailPickupFrom - 1e-9;
              if (!quiet(when)) shots.play(clickBuffer(part === 0 && (c.accent || isPickup)), out, at(when), part ? 0.18 : c.accent ? 0.56 : isPickup ? 0.48 : 0.36);
              else if (m.pulse && part === 0) pulse(c);
            }
          }
        } else if (m.pulse) {
          for (const c of clicks) {
            if (inRange(c.t, lo, hi)) {
              pulse(c);
              if (c.t >= tailPickupFrom - 1e-9 && !quiet(c.t)) shots.play(clickBuffer(false), out, at(c.t), 0.38);
            }
            const off = c.t + 0.5;
            if (spb >= SLOW_SPB && inRange(off, lo, hi) && !quiet(off)) shots.play(hatBuffer(), out, at(off), 0.35);
          }
        } else if (m.fill) {
          for (const c of clicks)
            if (inRange(c.t, lo, hi) && !quiet(c.t) && ![...t.comp, ...(t.bass ?? [])].some((x) => x.t <= c.t + 1e-9 && c.t < x.t + x.dur - 1e-9)) shots.play(clickBuffer(c.accent), out, at(c.t), c.accent ? 0.4 : 0.26);
        }
        if (m.bass !== false) for (const v of t.bass ?? []) if (inRange(v.t, lo, hi) && !quiet(v.t)) shots.play(bassBuffer(v.midi), out, at(v.t), 0.75, v.dur * spb * 0.9, 0.08);
        // For off-beat phrase entries (e.g. 8th or 16th rest on beat 1), tick the matching
        // subdivision gently across the opening rest and on the final beat before a continuous loop wrap.
        if (entrySub > 1 && (m.pulse || m.click)) {
          const baseDiv = m.click ? (m.clickSubdivision ?? 1) : 1;
          const hasSlowOff = m.pulse && spb >= SLOW_SPB;
          const tickEntrySub = (beatStart: number, limit: number) => {
            for (let part = 1; part < entrySub; part++) {
              const sub = beatStart + part / entrySub;
              if (sub >= limit - 1e-6 || !inRange(sub, lo, hi) || quiet(sub)) continue;
              if (baseDiv >= entrySub && Math.abs(part * baseDiv / entrySub - Math.round(part * baseDiv / entrySub)) < 1e-6) continue;
              const isHalf = Math.abs(part / entrySub - 0.5) < 1e-6;
              if (m.pulse && !(isHalf && hasSlowOff)) shots.play(hatBuffer(), out, at(sub), isHalf ? 0.34 : 0.24);
              if (m.click || !isHalf) shots.play(clickBuffer(false), out, at(sub), isHalf ? 0.2 : 0.16);
            }
          };
          for (let b = 0; b < Math.ceil(entryOffset); b++) tickEntrySub(s.from + b, s.from + entryOffset);
          if (s.loop && span.breath === 0 && s.length >= 1) tickEntrySub(end - 1, end);
        }
        if (m.guide !== false) for (const g of t.guide ?? []) if (inRange(g.t, lo, hi) && !quiet(g.t)) shots.play(pluckBuffer(g.midi), out, at(g.t), 0.7, g.dur * spb * 0.95 + 0.04, 0.08);
      };

      const show = () => {
        const held = s.held;
        setResults(held ? s.pass.results.map((r, i) => r ?? held.results[i] ?? null) : s.pass.results);
        setWrong(held ? held.wrong.map((m, i) => s.pass.wrong[i] ?? m ?? null) : s.pass.wrong);
      };

      const heardSince = (since: number) => samples.current.filter((x) => x.t >= since && (x.midi !== null || x.pcs?.length)).length;

      const tally = (pass: Pass, whole: boolean) => {
        const tempo = scheduledTempos.get(pass.iter);
        scheduledTempos.delete(pass.iter);
        if (!scoringRef.current) return;
        const counted = whole ? ranged : ranged.filter((i) => pass.results[i] !== null);
        setLastPass({ hit: counted.filter((i) => pass.results[i] === "hit").length, total: counted.length, heard: heardSince(pass.start), offset: median(pass.offsets), results: pass.results, wrong: pass.wrong, at: pass.at, bpm: tempo ? Math.round(tempo.min * 1e6) / 1e6 : undefined, tempoStable: Boolean(tempo && Math.abs(tempo.max - tempo.min) < 1e-6) });
      };

      /** Was this note played? And if not, what sounded instead; if so, how it sat against the beat. */
      const judge = (p: Pending): { hit: boolean; wrong: number | null; offset: number | null } => {
        const target = t.targets[p.target];
        const chord = target.chord;
        if (chord) {
          const lo = p.start - CHORD_EARLY_MS + inputLag();
          const hi = p.end + inputLag();
          const frames = samples.current.filter(
            (x) => x.t >= lo && x.t <= hi && x.pcs && chord.required.every((pc) => x.pcs!.includes(pc)) && !chord.clash.some((pc) => x.pcs!.includes(pc)),
          );
          // when it was struck: the change's timing, and for comping the proof it was played here
          const struck = samples.current.find((x) => x.strike && x.t >= lo && x.t <= hi && frames.some((fr) => fr.t >= x.t));
          const hit = frames.length >= CHORD_FRAMES && (!chord.strike || struck !== undefined);
          return { hit, wrong: null, offset: hit && struck ? struck.t - inputLag() - p.start : null };
        }
        const before = p.target === s.first ? (s.loop && p.iter > 0 ? s.last : -1) : p.target - 1; // the note still ringing from before
        const after = p.target === s.last ? (s.loop ? s.first : -1) : p.target + 1;
        return judgePitch(samples.current, {
          midi: target.midi, any: target.any, anyOctave: anyOctaveRef.current,
          start: p.start, end: p.end, first: p.target === s.first, last: p.target === s.last,
          before: before >= 0 ? t.targets[before].midi : null, previousStart: p.previousStart, lag: inputLag(),
          after: after >= 0 ? t.targets[after].midi : null, nextStart: p.nextStart,
        });
      };

      // Score the notes whose time has passed. `over`: the pass being heard has ended, so all of
      // it is scored now, except a last note that may still land. `final`: nothing may wait.
      const settle = (over: boolean, final = false) => {
        if (!scoringRef.current) {
          s.pending = [];
          s.closing = null;
          return;
        }
        const perfNow = performance.now();
        let changed = false;
        s.pending = s.pending.filter((p) => {
          if (p.iter > s.pass.iter) return true;
          const pass = p.iter === s.pass.iter ? s.pass : s.closing?.iter === p.iter ? s.closing : null;
          if (!pass) return false;
          const closing = pass !== s.pass;
          const isLast = p.target === s.last;
          const open = perfNow < p.end + (isLast ? EDGE_LATE_MS : LATE_MS) + inputLag();
          if (open && !final) {
            if (!over && !closing) return true;
            if (isLast && !judge(p).hit) return true;
          }
          const v = judge(p);
          pass.results = [...pass.results];
          pass.results[p.target] = v.hit ? "hit" : "miss";
          if (v.wrong !== null) {
            pass.wrong = [...pass.wrong];
            pass.wrong[p.target] = v.wrong;
          }
          if (v.offset !== null) {
            pass.offsets.push(v.offset);
            pass.at = [...pass.at];
            pass.at[p.target] = v.offset;
            driftRef.current = driftRef.current === null ? v.offset : driftRef.current * 0.7 + v.offset * 0.3;
          }
          if (closing && s.held) s.held = { ...s.held, results: pass.results };
          // sitting a pass out is not struggling
          if (v.hit || samples.current.some((x) => x.t >= p.start - 2500)) mixRef.current.shadow?.observe(p.target, v.hit);
          changed = true;
          return false;
        });
        const waiting = s.closing;
        if (waiting && !s.pending.some((p) => p.iter === waiting.iter)) {
          s.closing = null;
          tally(waiting, true);
        }
        if (changed) {
          show();
          setDrift(driftRef.current === null ? null : Math.round(driftRef.current / 5) * 5);
        }
      };

      const tick = () => {
        if (session.current !== s) return;
        const now = ctx.currentTime;

        // a tempo change lands on the next notes to be scheduled
        const spb = 60 / mixRef.current.bpm;
        const cur = s.segs[s.segs.length - 1];
        if (Math.abs(spb - cur.spb) > 1e-6) {
          if (cur.r >= s.nextR - 1e-9) cur.spb = spb;
          else s.segs.push({ r: s.nextR, time: timeOf(s.nextR), spb });
          if (s.segs.length > 12) s.segs.shift();
        }

        const horizon = rOf(now + LOOKAHEAD_S);
        while (s.nextR < horizon && (s.loop || s.nextR < s.length)) {
          const span = iterAt(s.nextR);
          const spanEnd = span.r0 + span.len + span.breath;
          const segEnd = Math.min(horizon, spanEnd);
          // a pass's tempo is the tempo of its notes; the breath after it may already count the next
          if (s.nextR < span.r0 + span.len - 1e-9) {
            const scheduledBpm = 60 / segAt(s.nextR).spb;
            const tempo = scheduledTempos.get(span.iter);
            scheduledTempos.set(span.iter, tempo ? { min: Math.min(tempo.min, scheduledBpm), max: Math.max(tempo.max, scheduledBpm) } : { min: scheduledBpm, max: scheduledBpm });
          }
          schedule(s.from + s.nextR - span.r0, s.from + segEnd - span.r0, span);
          s.nextR = segEnd;
        }

        // what is being heard right now (from the device's own clock), a paint ahead so it shows as it sounds
        const heard = heardTime(ctx) + PAINT_LEAD_S;
        const r = rOf(heard);
        // Count-in buffers were scheduled at the opening tempo, even if the player changes it.
        const countPosition = (heard - s.t0) / spb0;
        const curSpan = r < 0 ? s.iters[0] : iterAt(r);
        const iter = curSpan.iter;
        const pos = r < 0 ? 0 : r - curSpan.r0; // beats into this pass
        const inBreath = s.loop && curSpan.breath > 0 && r >= 0 && pos >= curSpan.len - 1e-9; // musical turnaround into the next pass
        if (inBreath !== breathRef.current) setBreathing((breathRef.current = inBreath));
        const count = inBreath
          ? Math.max(1, Math.min(curSpan.breath, Math.ceil(curSpan.len + curSpan.breath - pos - 1e-9)))
          : countBeats && countPosition < 0
            ? Math.min(countBeats, Math.ceil(-countPosition))
            : 0;
        if (count !== countRef.current) setCounting((countRef.current = count));
        // Beats remaining until Bar 1 re-enters: covers both turnaround bars AND any post-final-note tail
        // (e.g. a scale ending on beat 1.5 of bar 4 with 2.5 beats left before bar 1 loops back).
        const beatsLeftInPass = s.loop && r >= 0 ? curSpan.len + curSpan.breath - pos : 0;
        const inTail = s.loop && r >= 0 && !inBreath && pos >= tailStart - 1e-9 && curSpan.len - tailStart >= 0.75;
        const nextReentry = inBreath
          ? Math.max(1, Math.min(curSpan.breath, Math.ceil(beatsLeftInPass - 1e-9)))
          : inTail
            ? Math.max(1, Math.min(curSpan.breath + s.barBeats, Math.ceil(beatsLeftInPass - 1e-9)))
            : 0;
        if (nextReentry !== reentryRef.current) setReentry((reentryRef.current = nextReentry));
        const beat = s.from + (r < 0 ? 0 : s.loop ? Math.min(pos, curSpan.len - 1e-6) : Math.min(r, s.length - 1e-6));
        // Read the same output clock as the notation cursor; never pulse on lookahead scheduling.
        const gap = mixRef.current.gap;
        const gapCycle = gap ? gap.on + gap.off : 0;
        const quietBeat = r >= 0 && !inBreath && gapCycle > 0 && (iter * s.length + pos) % gapCycle >= gap!.on - 1e-9;
        let point: { id: string; index: number; beats: number; counting: boolean } | null = null;
        if (ctx.state === "running" && !quietBeat) {
          if (countPosition >= -countBeats && countPosition < 0) point = { id: `count:${Math.floor(countPosition)}`, index: countBeats + Math.floor(countPosition), beats: countBeats, counting: true };
          else if (inBreath) {
            const k = Math.min(curSpan.breath - 1, Math.floor(pos - curSpan.len + 1e-9));
            point = { id: `breath:${iter}:${k}`, index: k, beats: curSpan.breath, counting: true };
          } else if (r >= 0 && (s.loop || r < s.length)) {
            let lo = 0;
            let hi = beatGrid.length;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (beatGrid[mid].t <= beat + 1e-9) lo = mid + 1;
              else hi = mid;
            }
            const i = lo - 1;
            if (i >= 0) point = { id: `${iter}:${i}`, index: beatGrid[i].index, beats: beatGrid[i].beats, counting: false };
          }
        }
        if (point && point.id !== lastBeat) {
          lastBeat = point.id;
          beatRef.current = { index: point.index, beats: point.beats, counting: point.counting, active: true, serial: beatRef.current.serial + 1 };
          setBeat(beatRef.current);
        } else if (!point && beatRef.current.active) {
          beatRef.current = { ...IDLE_BEAT, serial: beatRef.current.serial };
          setBeat(beatRef.current);
        }
        // The note last struck stays current through the rest after it: falling back to "none"
        // in every rest sent the cursor (and a long score's scroll) to the top and back.
        let target = -1;
        if (!inBreath) for (let i = 0; i < t.targets.length; i++) {
          const n = t.targets[i];
          if (n.t > beat + 1e-9) break;
          if (n.t >= s.from - 1e-9) target = i;
        }
        const slot = r < 0 || inBreath ? -1 : t.slots.findIndex((sl) => beat >= sl.start - 1e-9 && beat < sl.start + sl.beats - 1e-9);
        if (target !== activeRef.current.target || slot !== activeRef.current.slot) {
          activeRef.current = { target, slot };
          setActive(activeRef.current);
        }

        const perfNow = performance.now();
        // a new loop pass: the finished one is scored and keeps its colours for a moment, or through
        // the turnaround before the next, which belongs to the pass it leads into
        const passIter = inBreath ? iter + 1 : iter;
        if (s.loop && passIter > s.pass.iter) {
          settle(true);
          const done = s.pass;
          const nextSpan = iterById(passIter);
          const begins = inBreath ? ctxToPerf(ctx, timeOf(nextSpan.r0)) : perfNow;
          s.pass = { iter: passIter, results: blank(), wrong: [], offsets: [], at: t.targets.map(() => null), start: begins };
          if (s.pending.some((p) => p.iter === done.iter)) s.closing = done;
          else tally(done, true);
          s.held = { results: done.results, wrong: done.wrong, until: Math.max(perfNow + HOLD_MS, begins) };
          show();
        }
        if (s.held && perfNow >= s.held.until) {
          s.held = null;
          show();
        }

        settle(false);

        if (!s.loop && r > s.length + 0.5) {
          settle(true, true);
          tally(s.pass, false);
          stop();
        }
      };

      // where the music is, read from the device's clock whenever it is asked (a ghost playhead);
      // nothing during a count-in, a turnaround or a gap, where there is no music to follow
      position.current = (throughGaps = false) => {
        if (session.current !== s || ctx.state !== "running") return null;
        const r = rOf(heardTime(ctx) + PAINT_LEAD_S);
        if (r < 0 || (!s.loop && r >= s.length)) return null;
        const curSpan = iterAt(r);
        const pos = r - curSpan.r0;
        if (pos >= curSpan.len) return null;
        const gap = mixRef.current.gap;
        const cycle = gap ? gap.on + gap.off : 0;
        if (!throughGaps && cycle > 0 && (curSpan.iter * s.length + pos) % cycle >= gap!.on - 1e-9) return null;
        return s.from + pos;
      };
      s.timer = window.setInterval(tick, TICK_MS);
      tick();
    },
    [stop, clicks],
  );

  // Pitches heard while playing, for scoring in time; pitch classes too when the timeline asks for chords.
  const { subscribe } = input;
  useEffect(() => {
    if (!scoring) return;
    const presence = new Float32Array(12);
    const levels: number[] = [];
    const onsets = createOnsets();
    const attacks = createAttacks();
    samples.current = [];
    return subscribe((f) => {
      const floor = levels.length ? Math.min(...levels) : Infinity;
      levels.push(f.rms);
      if (levels.length > 4) levels.shift();
      const struck = attacks(f);
      const strike = (f.rms > CHORD_GATE_RMS * 3 && f.rms > floor * STRIKE_RATIO) || struck.length > 0;
      const heard = midiOf(f);
      const midi = heard !== null && ignoreRef.current?.has(heard) ? null : heard;
      const onset = onsets({ midi, rms: f.rms, now: f.now, attacks: struck });
      let pcs: number[] | null = null;
      if (tlRef.current.targets.some((x) => x.chord)) {
        const frame = f.rms < CHORD_GATE_RMS ? [] : strongPitchClasses(detectNotes(f.buf, f.sampleRate));
        pcs = [];
        for (let pc = 0; pc < 12; pc++) {
          presence[pc] = presence[pc] * 0.6 + (frame.includes(pc) ? 0.4 : 0);
          if (presence[pc] >= 0.5) pcs.push(pc);
        }
      }
      if (midi !== null || pcs?.length || strike) samples.current.push({ t: f.now, midi, pcs, strike, onset: onset?.at ?? null });
      const cutoff = f.now - 16000;
      while (samples.current.length && samples.current[0].t < cutoff) samples.current.shift();
    });
  }, [scoring, subscribe]);

  useEffect(() => stop, [stop]);

  const beatAt = useCallback((throughGaps = false) => position.current?.(throughGaps) ?? null, []);

  return { playing, counting, breathing, reentry, beat, activeTarget: active.target, activeSlot: active.slot, results, wrong, lastPass, drift, play, stop, beatAt };
}

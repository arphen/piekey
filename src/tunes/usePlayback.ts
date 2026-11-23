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
  breath?: boolean; // looping: a counted bar between passes, to come back to the top of the phrase
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

interface Session {
  out: Tone.Volume;
  shots: OneShots;
  t0: number; // context time of the range start (after count-in)
  from: number; // range in beats
  length: number;
  breath: number; // counted beats between looped passes
  period: number; // beats from one pass to the next: the passage and its breath
  loop: boolean;
  first: number; // targets at the edges of the range
  last: number;
  segs: Seg[]; // the tempo, piece by piece
  nextR: number; // beats past t0 scheduled so far
  timer: number;
  pending: Pending[];
  pass: Pass; // the pass being heard
  closing: Pass | null; // the one before, while its last note may still land
  held: { results: NoteResult[]; until: number } | null;
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

export function usePlayback(tl: Timeline, mix: PlaybackMix, input: InputApi, scoring: boolean, anyOctave: boolean, ignore?: ReadonlySet<number>) {
  const [playing, setPlaying] = useState(false);
  const [counting, setCounting] = useState(0); // count-in beats left
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
  const driftRef = useRef<number | null>(null);
  const position = useRef<(() => number | null) | null>(null); // the timeline beat being heard, while there is one

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
      const countBeats = mixRef.current.countIn ? Math.max(2, Math.round(t.slots[a].beats)) : 0;
      const breath = loop && mixRef.current.breath ? Math.max(2, Math.round(t.slots[a].beats)) : 0;
      const t0 = ctx.currentTime + 0.15 + countBeats * spb0;
      const inRange = (x: number, lo: number, hi: number) => x >= lo - 1e-9 && x < hi - 1e-9;
      const ranged = t.targets.map((n, i) => (inRange(n.t, from, from + length) ? i : -1)).filter((i) => i >= 0);
      const beatGrid = clicks.filter((c) => inRange(c.t, from, from + length));
      let lastBeat = "";

      // render the notes ahead of time so the first bar doesn't stutter
      for (const i of ranged) for (const m of t.targets[i].chord?.voicing ?? [t.targets[i].midi]) pluckBuffer(m);
      for (const g of t.guide ?? []) if (g.t >= from && g.t < from + length) pluckBuffer(g.midi);

      const out = new Tone.Volume(-4).toDestination();
      const shots = new OneShots();
      const countDivision = mixRef.current.clickSubdivision ?? 1;
      for (let k = 0; k < countBeats; k++) for (let part = 0; part < countDivision; part++)
        shots.play(clickBuffer(k === 0 && part === 0), out, t0 - (countBeats - k - part / countDivision) * spb0, part === 0 ? 0.6 : 0.22);

      const blank = () => t.targets.map((): NoteResult => null);
      const scheduledTempos = new Map<number, { min: number; max: number }>();
      const startPerf = performance.now() + (t0 - ctx.currentTime) * 1000;
      const s: Session = {
        out,
        shots,
        t0,
        from,
        length,
        breath,
        period: length + breath,
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

      const schedule = (lo: number, hi: number, iterStart: number) => {
        const m = mixRef.current;
        const at = (beat: number) => timeOf(iterStart + beat - s.from);
        const spb = segAt(iterStart + lo - s.from).spb;
        const perfOf = (time: number) => ctxToPerf(ctx, time);
        const pass = Math.round(iterStart / Math.max(1e-9, s.period));
        const end = s.from + s.length;
        // the breath after a looped pass: a bar counted in to the next one, nothing else
        if (s.breath) {
          const division = m.clickSubdivision ?? 1;
          for (let k = 0; k < s.breath; k++) for (let part = 0; part < division; part++) {
            const when = end + k + part / division;
            if (inRange(when, Math.max(lo, end), hi)) shots.play(clickBuffer(k === 0 && part === 0), out, at(when), part === 0 ? 0.6 : 0.22);
          }
        }
        hi = Math.min(hi, end);
        if (lo >= hi - 1e-9) return;
        // in a gap the band and the click leave the player alone; the notes are still judged
        const cycle = m.gap ? m.gap.on + m.gap.off : 0;
        const quiet = (beat: number) => cycle > 0 && ((((pass * s.length + beat - s.from) % cycle) + cycle) % cycle) >= m.gap!.on - 1e-9; // counted across loops, breaths left out
        t.targets.forEach((n, i) => {
          if (!inRange(n.t, lo, hi)) return;
          const time = at(n.t);
          const vol = quiet(n.t) ? 0 : m.melody ? 1 : m.shadow ? m.shadow.gain(i) : 0;
          if (vol > 0 && n.chord)
            [...n.chord.voicing].sort((x, y) => x - y).forEach((midi, k) => shots.play(pluckBuffer(midi), out, time + k * 0.03, 0.55 * vol, n.dur * spb * 0.95, 0.12));
          else if (vol > 0) shots.play(pluckBuffer(n.midi), out, time, 0.9 * vol, n.dur * spb * 0.95 + 0.04, 0.08);
          const before = i === s.first ? (s.loop ? t.targets[s.last] : null) : t.targets[i - 1];
          const previousStart = before ? perfOf(timeOf(iterStart + before.t - s.from - (i === s.first ? s.period : 0))) : null;
          const after = i === s.last ? (s.loop ? t.targets[s.first] : null) : t.targets[i + 1];
          const nextStart = after ? perfOf(timeOf(iterStart + after.t - s.from + (i === s.last ? s.period : 0))) : null;
          s.pending.push({ target: i, start: perfOf(time), end: perfOf(time + n.dur * spb), iter: pass, previousStart, nextStart });
        });
        if (m.chords) for (const c of t.comp) if (inRange(c.t, lo, hi) && !quiet(c.t)) for (const midi of c.midis) shots.play(keysBuffer(midi), out, at(c.t), 0.2, c.dur * spb, 0.15);
        // the pulse: felt on every beat, and between them when they are far apart; in a gap only the hat stays
        const pulse = (c: (typeof clicks)[number]) => {
          if (quiet(c.t)) return shots.play(hatBuffer(), out, at(c.t), c.accent ? 0.45 : 0.28);
          shots.play(kickBuffer(), out, at(c.t), c.accent ? 0.6 : 0.4);
          shots.play(hatBuffer(), out, at(c.t), c.accent ? 0.9 : 0.65);
        };
        if (m.click) {
          const division = m.clickSubdivision ?? 1;
          for (const c of clicks) for (let part = 0; part < division; part++) {
            const when = c.t + part / division;
            if (!inRange(when, lo, hi)) continue;
            if (!quiet(when)) shots.play(clickBuffer(part === 0 && c.accent), out, at(when), part ? 0.18 : c.accent ? 0.5 : 0.35);
            else if (m.pulse && part === 0) pulse(c);
          }
        } else if (m.pulse) {
          for (const c of clicks) {
            if (inRange(c.t, lo, hi)) pulse(c);
            const off = c.t + 0.5;
            if (spb >= SLOW_SPB && inRange(off, lo, hi) && !quiet(off)) shots.play(hatBuffer(), out, at(off), 0.35);
          }
        } else if (m.fill) {
          for (const c of clicks)
            if (inRange(c.t, lo, hi) && !quiet(c.t) && ![...t.comp, ...(t.bass ?? [])].some((x) => x.t <= c.t + 1e-9 && c.t < x.t + x.dur - 1e-9)) shots.play(clickBuffer(c.accent), out, at(c.t), c.accent ? 0.4 : 0.26);
        }
        if (m.bass !== false) for (const v of t.bass ?? []) if (inRange(v.t, lo, hi) && !quiet(v.t)) shots.play(bassBuffer(v.midi), out, at(v.t), 0.75, v.dur * spb * 0.9, 0.08);
        if (m.guide !== false) for (const g of t.guide ?? []) if (inRange(g.t, lo, hi) && !quiet(g.t)) shots.play(pluckBuffer(g.midi), out, at(g.t), 0.7, g.dur * spb * 0.95 + 0.04, 0.08);
      };

      const show = () => {
        const held = s.held;
        setResults(held ? s.pass.results.map((r, i) => r ?? held.results[i] ?? null) : s.pass.results);
        setWrong(s.pass.wrong);
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
          const iterStart = Math.floor(s.nextR / s.period) * s.period;
          const segEnd = Math.min(horizon, iterStart + s.period);
          const iter = Math.round(iterStart / s.period);
          // a pass's tempo is the tempo of its notes; the breath after it may already count the next
          if (s.nextR < iterStart + s.length - 1e-9) {
            const scheduledBpm = 60 / segAt(s.nextR).spb;
            const tempo = scheduledTempos.get(iter);
            scheduledTempos.set(iter, tempo ? { min: Math.min(tempo.min, scheduledBpm), max: Math.max(tempo.max, scheduledBpm) } : { min: scheduledBpm, max: scheduledBpm });
          }
          schedule(s.from + s.nextR - iterStart, s.from + segEnd - iterStart, iterStart);
          s.nextR = segEnd;
        }

        // what is being heard right now (from the device's own clock), a paint ahead so it shows as it sounds
        const heard = heardTime(ctx) + PAINT_LEAD_S;
        const r = rOf(heard);
        // Count-in buffers were scheduled at the opening tempo, even if the player changes it.
        const countPosition = (heard - s.t0) / spb0;
        const iter = r < 0 ? 0 : Math.floor(r / s.period);
        const pos = r < 0 ? 0 : r - iter * s.period; // beats into this pass
        const breathing = s.loop && s.breath > 0 && r >= 0 && pos >= s.length - 1e-9; // counting in to the next pass
        const count = breathing ? Math.max(1, Math.min(s.breath, Math.ceil(s.period - pos - 1e-9))) : countBeats && countPosition < 0 ? Math.min(countBeats, Math.ceil(-countPosition)) : 0;
        if (count !== countRef.current) setCounting((countRef.current = count));
        const beat = s.from + (r < 0 ? 0 : s.loop ? Math.min(pos, s.length - 1e-6) : Math.min(r, s.length - 1e-6));
        // Read the same output clock as the notation cursor; never pulse on lookahead scheduling.
        const gap = mixRef.current.gap;
        const gapCycle = gap ? gap.on + gap.off : 0;
        const quietBeat = r >= 0 && !breathing && gapCycle > 0 && (iter * s.length + pos) % gapCycle >= gap!.on - 1e-9;
        let point: { id: string; index: number; beats: number; counting: boolean } | null = null;
        if (ctx.state === "running" && !quietBeat) {
          if (countPosition >= -countBeats && countPosition < 0) point = { id: `count:${Math.floor(countPosition)}`, index: countBeats + Math.floor(countPosition), beats: countBeats, counting: true };
          else if (breathing) {
            const k = Math.min(s.breath - 1, Math.floor(pos - s.length + 1e-9));
            point = { id: `breath:${iter}:${k}`, index: k, beats: s.breath, counting: true };
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
        if (!breathing) for (let i = 0; i < t.targets.length; i++) {
          const n = t.targets[i];
          if (n.t > beat + 1e-9) break;
          if (n.t >= s.from - 1e-9) target = i;
        }
        const slot = r < 0 || breathing ? -1 : t.slots.findIndex((sl) => beat >= sl.start - 1e-9 && beat < sl.start + sl.beats - 1e-9);
        if (target !== activeRef.current.target || slot !== activeRef.current.slot) {
          activeRef.current = { target, slot };
          setActive(activeRef.current);
        }

        const perfNow = performance.now();
        // a new loop pass: the finished one is scored and keeps its colours for a moment, or through
        // the breath before the next, which belongs to the pass it counts in
        const passIter = breathing ? iter + 1 : iter;
        if (s.loop && passIter > s.pass.iter) {
          settle(true);
          const done = s.pass;
          const begins = breathing ? ctxToPerf(ctx, timeOf(passIter * s.period)) : perfNow;
          s.pass = { iter: passIter, results: blank(), wrong: [], offsets: [], at: t.targets.map(() => null), start: begins };
          if (s.pending.some((p) => p.iter === done.iter)) s.closing = done;
          else tally(done, true);
          s.held = { results: done.results, until: Math.max(perfNow + HOLD_MS, begins) };
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
      // nothing during a count-in, a breath or a gap, where there is no music to follow
      position.current = () => {
        if (session.current !== s || ctx.state !== "running") return null;
        const r = rOf(heardTime(ctx) + PAINT_LEAD_S);
        if (r < 0 || (!s.loop && r >= s.length)) return null;
        const iter = Math.floor(r / s.period);
        const pos = r - iter * s.period;
        if (pos >= s.length) return null;
        const gap = mixRef.current.gap;
        const cycle = gap ? gap.on + gap.off : 0;
        if (cycle > 0 && (iter * s.length + pos) % cycle >= gap!.on - 1e-9) return null;
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

  const beatAt = useCallback(() => position.current?.() ?? null, []);

  return { playing, counting, beat, activeTarget: active.target, activeSlot: active.slot, results, wrong, lastPass, drift, play, stop, beatAt };
}

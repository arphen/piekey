import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFollower } from "../follow/useFollower";
import type { InputApi } from "../listen/useInput";
import type { NoteResult } from "../core/contract";
import type { Step } from "./learn";
import type { Timeline } from "./order";
import { usePlayback } from "./usePlayback";
import { getStoredItem, setStoredItem } from "../storage";

// Runs the learning plan hands-free: each step listens, reads and plays in time, and moves on by
// itself once its criterion is met, so the guitar never has to leave your hands.

export type Phase = "ready" | "listen" | "read" | "time" | "passed";

const CLEAN_TAKES = 2; // read it slowly: this many clean takes in a row
const RESTART_MS = 1200; // pause between takes
const START_TIME_MS = 1400; // pause before playing in time
const NEXT_STEP_MS = 1800; // time to enjoy the pass

interface Saved {
  step: number;
  done: number[];
}

const key = (id: string) => `guitar-learn:${id}`;
function load(id: string): Saved {
  try {
    const raw = getStoredItem(key(id));
    return raw ? (JSON.parse(raw) as Saved) : { step: 0, done: [] };
  } catch {
    return { step: 0, done: [] };
  }
}
function save(id: string, s: Saved) {
  try {
    setStoredItem(key(id), JSON.stringify(s));
  } catch {
    // progress lasts this visit only
  }
}

export function useCoach(args: { tuneId: string; tl: Timeline; plan: Step[]; input: InputApi; anyOctave: boolean; bpm: number; guide: boolean }) {
  const { tuneId, tl, plan, input, anyOctave, bpm, guide } = args;
  const [saved, setSaved] = useState<Saved>(() => load(tuneId));
  const [phase, setPhase] = useState<Phase>("ready");
  const [clean, setClean] = useState(0);
  const [passes, setPasses] = useState<number[]>([]); // in-time scores this step
  const started = useRef(false); // audio may only start after a click; then everything flows

  useEffect(() => {
    setSaved(load(tuneId));
    setPhase("ready");
    started.current = false;
  }, [tuneId]);

  const index = Math.min(saved.step, Math.max(0, plan.length - 1));
  const step = plan[index] as Step | undefined;
  const listening = input.status === "listening";

  // the step's notes: a contiguous run of targets
  const first = useMemo(() => (step ? tl.targets.findIndex((t) => t.slot >= step.from) : -1), [tl, step]);
  const last = useMemo(() => {
    if (!step) return -1;
    let l = -1;
    tl.targets.forEach((t, i) => {
      if (t.slot <= step.to) l = i;
    });
    return l;
  }, [tl, step]);
  const midis = useMemo(() => (first >= 0 && last >= first ? tl.targets.slice(first, last + 1).map((t) => t.midi) : []), [tl, first, last]);

  const follow = useFollower(midis, input, phase === "read", anyOctave);
  const mix = { bpm, melody: phase === "listen" || guide, chords: true, click: false, countIn: true };
  const playback = usePlayback(tl, mix, input, phase === "time" && listening, anyOctave);
  const { play, stop } = playback;

  const goTo = useCallback(
    (i: number) => {
      stop();
      const next = Math.max(0, Math.min(i, plan.length - 1));
      setSaved((s) => {
        const n = { ...s, step: next };
        save(tuneId, n);
        return n;
      });
    },
    [stop, plan.length, tuneId],
  );

  const begin = useCallback(
    (s: Step | undefined) => {
      setClean(0);
      setPasses([]);
      follow.restart();
      if (!s) return;
      if (!started.current) {
        setPhase("ready");
        return;
      }
      setPhase(s.listen ? "listen" : s.read ? "read" : "time");
    },
    [follow],
  );

  // a new step: start from its first phase
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    stop();
    beginRef.current(step);
  }, [step, stop]);

  /** The first click: unlocks audio and starts the flow. */
  const start = useCallback(() => {
    started.current = true;
    if (input.status === "idle") void input.start();
    begin(step);
  }, [begin, step, input]);

  // listen: play the step once, melody and chords; then read (or play in time).
  // The token makes sure it's this playback ending, not the previous one being stopped.
  const listenToken = useRef<{ step: number; heard: boolean } | null>(null);
  useEffect(() => {
    if (phase !== "listen" || !step) return;
    listenToken.current = { step: index, heard: false };
    void play(step.from, step.to, false);
  }, [phase, step, index, play]);
  useEffect(() => {
    const tok = listenToken.current;
    if (!tok || tok.step !== index || phase !== "listen" || !step) return;
    if (playback.playing) tok.heard = true;
    else if (tok.heard) {
      listenToken.current = null;
      setPhase(step.read ? "read" : "time");
    }
  }, [playback.playing, phase, step, index]);

  // read it slowly: a clean take has every note first time, with no going back
  useEffect(() => {
    if (phase !== "read" || !follow.done) return;
    const ok = follow.take === 1 && follow.misses.every((m) => m === 0);
    const streak = ok ? clean + 1 : 0;
    setClean(streak);
    const id = window.setTimeout(() => {
      if (streak >= CLEAN_TAKES) setPhase("time");
      else follow.restart();
    }, RESTART_MS);
    return () => window.clearTimeout(id);
  }, [phase, follow.done]); // eslint-disable-line react-hooks/exhaustive-deps

  // in time: loop with the backing until one pass is good enough
  useEffect(() => {
    if (phase !== "time" || !step) return;
    const id = window.setTimeout(() => void play(step.from, step.to, true), START_TIME_MS);
    return () => window.clearTimeout(id);
  }, [phase, step, play]);
  useEffect(() => {
    const p = playback.lastPass;
    if (phase !== "time" || !p || !step || !p.total) return;
    const score = p.hit / p.total;
    setPasses((ps) => [...ps, score]);
    if (score >= step.pass) {
      stop();
      setPhase("passed");
    }
  }, [playback.lastPass]); // eslint-disable-line react-hooks/exhaustive-deps

  // passed: tick the step off and move on
  useEffect(() => {
    if (phase !== "passed") return;
    setSaved((s) => {
      const n = { ...s, done: s.done.includes(index) ? s.done : [...s.done, index] };
      save(tuneId, n);
      return n;
    });
    const id = window.setTimeout(() => goTo(index + 1), NEXT_STEP_MS);
    return () => window.clearTimeout(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // what the score shows, in playing-order target indices
  const results = useMemo((): NoteResult[] => {
    if (phase === "read") {
      const out: NoteResult[] = tl.targets.map(() => null);
      follow.results.forEach((r, i) => (out[first + i] = r));
      return out;
    }
    return playback.results.map((r, i) => (i >= first && i <= last ? r : null));
  }, [phase, tl, follow.results, playback.results, first, last]);
  const active = phase === "read" ? (follow.done ? -1 : first + follow.index) : playback.activeTarget >= 0 ? playback.activeTarget : first;

  const replay = useCallback(() => {
    if (step) void play(step.from, step.to, phase === "time");
  }, [step, play, phase]);

  return {
    step,
    index,
    done: saved.done,
    phase,
    clean,
    cleanNeeded: CLEAN_TAKES,
    passes,
    follow,
    playback,
    results,
    active,
    first,
    start,
    goTo,
    replay,
    setPhase: (p: Phase) => {
      stop();
      setPhase(p);
    },
    reset: () => {
      const n = { step: 0, done: [] };
      save(tuneId, n);
      setSaved(n);
    },
  };
}

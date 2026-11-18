import { useCallback, useEffect, useRef, useState } from "react";
import type { InputApi } from "../listen/useInput";
import { detectNotes, strongPitchClasses } from "../listen/spectrum";

// Waits for each chord of a progression in turn: once all its required pitch classes ring together
// (and nothing that makes it another chord), it turns green and the next one is up. Strumming the
// first chord again partway through starts a new take from there.

export interface ChordGoal {
  required: number[];
  clash: number[];
}

const GATE_RMS = 0.002;
const HOLD_FRAMES = 3; // ~75 ms of the whole chord at 25 ms frames
const LOCK_MS = 350; // after a match, so the ringing chord can't also answer the next one
const PRESENT = 0.5;

const matches = (present: Set<number>, g: ChordGoal) => g.required.every((pc) => present.has(pc)) && !g.clash.some((pc) => present.has(pc));

export function useChordFollower(goals: ChordGoal[], input: InputApi, enabled: boolean) {
  const [index, setIndex] = useState(0);
  const [take, setTake] = useState(1);
  const [present, setPresent] = useState<number[]>([]);
  const indexRef = useRef(0);
  const goalsRef = useRef(goals);
  const presence = useRef(new Float32Array(12));
  const ok = useRef(0);
  const okFirst = useRef(0);
  const lockUntil = useRef(0);
  const lastKey = useRef("");

  const restart = useCallback(() => {
    indexRef.current = 0;
    setIndex(0);
    setTake(1);
    ok.current = 0;
  }, []);

  useEffect(() => {
    goalsRef.current = goals;
    restart();
  }, [goals, restart]);

  const { subscribe } = input;
  useEffect(() => {
    if (!enabled) return;
    return subscribe((f) => {
      const frame = f.rms < GATE_RMS ? [] : strongPitchClasses(detectNotes(f.buf, f.sampleRate));
      const p = presence.current;
      const now = new Set<number>();
      for (let pc = 0; pc < 12; pc++) {
        p[pc] = p[pc] * 0.6 + (frame.includes(pc) ? 0.4 : 0);
        if (p[pc] >= PRESENT) now.add(pc);
      }
      const key = [...now].sort((a, b) => a - b).join(",");
      if (key !== lastKey.current) {
        lastKey.current = key;
        setPresent([...now]);
      }
      const gs = goalsRef.current;
      const i = indexRef.current;
      if (i >= gs.length || f.now < lockUntil.current) return;
      ok.current = matches(now, gs[i]) ? ok.current + 1 : 0;
      // the first chord again, two or more chords in: starting over
      const first = gs[0];
      okFirst.current = i >= 2 && !matches(now, gs[i - 1]) && matches(now, first) && !matches(now, gs[i]) ? okFirst.current + 1 : 0;
      const advance = (to: number) => {
        indexRef.current = to;
        setIndex(to);
        ok.current = 0;
        okFirst.current = 0;
        lockUntil.current = f.now + LOCK_MS;
        p.fill(0);
      };
      if (ok.current >= HOLD_FRAMES) advance(i + 1);
      else if (okFirst.current >= HOLD_FRAMES) {
        setTake((t) => t + 1);
        advance(1);
      }
    });
  }, [enabled, subscribe]);

  return { index, take, present, done: goals.length > 0 && index >= goals.length, restart };
}

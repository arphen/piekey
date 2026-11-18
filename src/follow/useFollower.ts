import { useCallback, useEffect, useRef, useState } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { initFollow, stepFollow, takeFrom, type FollowState } from "./follower";

/** Follows the player through `targets` (sounding MIDI notes) while `enabled`. Notes in `ignore` are not heard: they work the app, not the exercise. */
export function useFollower(targets: number[], input: InputApi, enabled: boolean, anyOctave: boolean, ignore?: ReadonlySet<number>) {
  const [state, setState] = useState<FollowState>(() => initFollow(targets.length));
  const ref = useRef(state);
  const targetsRef = useRef(targets);
  const anyOctaveRef = useRef(anyOctave);
  anyOctaveRef.current = anyOctave;
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;

  const commit = useCallback((next: FollowState) => {
    ref.current = next;
    setState(next);
  }, []);

  const restart = useCallback(() => commit(initFollow(targetsRef.current.length)), [commit]);
  const startAt = useCallback((i: number) => commit(takeFrom(ref.current, i, performance.now())), [commit]);

  useEffect(() => {
    targetsRef.current = targets;
    restart();
  }, [targets, restart]);

  const { subscribe } = input;
  useEffect(() => {
    if (!enabled) return;
    return subscribe((f) => {
      const prev = ref.current;
      const heard = midiOf(f);
      const midi = heard !== null && ignoreRef.current?.has(heard) ? null : heard;
      const next = stepFollow(prev, targetsRef.current, { midi, rms: f.rms, now: f.now }, anyOctaveRef.current);
      ref.current = next;
      // Render only when something visible changed, not on every frame.
      if (next.results !== prev.results || next.index !== prev.index || next.take !== prev.take || next.wrong !== prev.wrong || next.wrongAt !== prev.wrongAt || next.heard !== prev.heard)
        setState(next);
    });
  }, [enabled, subscribe]);

  const total = targets.length;
  const done = total > 0 && state.index >= total;
  const firstTry = state.results.filter((r) => r === "hit").length;
  const seconds = state.startedAt !== null && state.finishedAt !== null ? (state.finishedAt - state.startedAt) / 1000 : null;
  return { ...state, total, done, firstTry, seconds, restart, startAt };
}

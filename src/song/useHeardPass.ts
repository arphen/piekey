import { useEffect, useRef, useState } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { findOwnPass } from "./scaleShapes";

const STEADY_FRAMES = 2; // a pitch heard this many frames running is a note
const QUIET_FRAMES = 3; // this much silence lets the same pitch count again
const KEEP = 96; // notes remembered

/**
 * The player's own way through a scale, heard while `enabled`: notes are read from the shared
 * input (no detector of its own), and the newest complete up-and-back pass of the scale is
 * returned (see `findOwnPass`). `reset` starts listening afresh (a new exercise, a kept version).
 * Notes in `ignore` work the app and are not heard.
 */
export function useHeardPass(input: InputApi, enabled: boolean, pcs: readonly number[] | null, ignore: ReadonlySet<number>, reset: string): number[] | null {
  const [pass, setPass] = useState<number[] | null>(null);
  const heard = useRef<number[]>([]);
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;
  const pcsKey = pcs ? pcs.join(",") : "";

  useEffect(() => {
    heard.current = [];
    setPass(null);
  }, [reset, pcsKey]);

  const { subscribe } = input;
  useEffect(() => {
    if (!enabled || !pcsKey) return;
    const scale = pcsKey.split(",").map(Number);
    let last: number | null = null; // the pitch of the last frame
    let steady = 0;
    let quiet = 0;
    let note: number | null = null; // the note being held, once counted
    return subscribe((f) => {
      const raw = midiOf(f);
      const midi = raw !== null && ignoreRef.current.has(raw) ? null : raw;
      if (midi === null) {
        if (++quiet >= QUIET_FRAMES) note = null;
        last = null;
        steady = 0;
        return;
      }
      quiet = 0;
      steady = midi === last ? steady + 1 : 1;
      last = midi;
      if (steady < STEADY_FRAMES || midi === note) return;
      note = midi;
      const list = heard.current;
      list.push(midi);
      if (list.length > KEEP) list.splice(0, list.length - KEEP);
      const found = findOwnPass(list, scale);
      if (found) setPass((prev) => (prev && prev.length === found.length && prev.every((m, i) => m === found[i]) ? prev : found));
    });
  }, [enabled, pcsKey, subscribe]);

  return pass;
}

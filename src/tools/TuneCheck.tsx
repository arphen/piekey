import { useEffect, useRef, useState } from "react";
import type { InputApi } from "../listen/useInput";
import { useTuner } from "./useTuner";

const STRINGS = [
  { note: "E", octave: 2, hz: 82.407 },
  { note: "A", octave: 2, hz: 110 },
  { note: "D", octave: 3, hz: 146.832 },
  { note: "G", octave: 3, hz: 195.998 },
  { note: "B", octave: 3, hz: 246.942 },
  { note: "E", octave: 4, hz: 329.628 },
];
const OK_CENTS = 6;
const FRESH_MS = 20 * 60 * 1000;
let tunedAt = 0; // the guitar stays tuned for the sitting, not forever

export const isTuned = () => performance.now() - tunedAt < FRESH_MS && tunedAt > 0;

/** Nearest open string and signed cents from it, within a semitone either way. */
function nearest(frequency: number): { index: number; cents: number } | null {
  let best = -1;
  let bestCents = Infinity;
  STRINGS.forEach((s, i) => {
    const c = 1200 * Math.log2(frequency / s.hz);
    if (Math.abs(c) < Math.abs(bestCents)) { best = i; bestCents = c; }
  });
  return best >= 0 && Math.abs(bestCents) <= 100 ? { index: best, cents: bestCents } : null;
}

type Mark = "none" | "first" | "confirmed";

/**
 * Tune before playing: every string in tune, then every string heard once more
 * (tuning one can pull another), and only then does the room let the player begin.
 */
export function TuneCheck({ input, onDone, onSkip }: { input: InputApi; onDone(): void; onSkip(): void }) {
  const reading = useTuner(input, true);
  const [marks, setMarks] = useState<Mark[]>(() => STRINGS.map(() => "none"));
  const [live, setLive] = useState<{ index: number; cents: number } | null>(null);
  const hold = useRef<{ index: number; since: number } | null>(null);
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (reading.state !== "pitch") { hold.current = null; setLive(null); return; }
    const found = nearest(reading.pitch.frequency);
    setLive(found);
    if (!found) { hold.current = null; return; }
    const inTune = Math.abs(found.cents) <= OK_CENTS;
    setMarks((prev) => {
      const next = [...prev];
      const here = prev[found.index];
      if (!inTune) {
        // heard out of tune again: it has to be tuned and confirmed afresh
        if (here !== "none" && Math.abs(found.cents) > OK_CENTS * 2) next[found.index] = "none";
        hold.current = null;
        return next;
      }
      const since = hold.current?.index === found.index ? hold.current.since : performance.now();
      hold.current = { index: found.index, since };
      if (performance.now() - since < 350) return prev;
      const allFirst = prev.every((m) => m !== "none");
      if (here === "none") next[found.index] = "first";
      else if (here === "first" && allFirst) next[found.index] = "confirmed";
      return next;
    });
  }, [reading]);

  const allFirst = marks.every((m) => m !== "none");
  const allConfirmed = marks.every((m) => m === "confirmed");
  useEffect(() => {
    if (allConfirmed && !done.current) {
      done.current = true;
      tunedAt = performance.now();
      onDoneRef.current();
    }
  }, [allConfirmed]);

  const say = reading.state === "quiet" ? (allFirst ? "Once more, every string" : "Pluck a string and let it ring") : reading.state === "uncertain" ? "One clear string at a time" : !live ? "Between strings" : Math.abs(live.cents) <= OK_CENTS ? "In tune" : live.cents < 0 ? "Tune up" : "Tune down";

  return (
    <section className="ss-tune" aria-label="Tune your guitar">
      <p className="ss-section-label">{allFirst ? "Check again · every string once more" : "Tune up before you play"}</p>
      <ol className="ss-tune-strings">
        {STRINGS.map((s, i) => {
          const here = live?.index === i;
          const off = here && Math.abs(live.cents) > OK_CENTS;
          return (
            <li key={i} className={`mark-${marks[i]} ${here ? "is-heard" : ""} ${off ? (live.cents < 0 ? "is-flat" : "is-sharp") : ""}`} aria-label={`${s.note}${s.octave}: ${marks[i] === "confirmed" ? "in tune" : marks[i] === "first" ? "tuned, check again" : "not yet"}`}>
              <b>{s.note}<small>{s.octave}</small></b>
              <i aria-hidden="true">{marks[i] === "confirmed" ? "✓" : here && off ? (live.cents < 0 ? "♭" : "♯") : marks[i] === "first" ? "·" : ""}</i>
            </li>
          );
        })}
      </ol>
      <p className="ss-tune-say" role="status">{say}{live ? ` · ${live.cents > 0 ? "+" : ""}${Math.round(live.cents)}¢` : ""}</p>
      <button type="button" className="ss-tune-skip" onClick={() => { tunedAt = performance.now(); onSkip(); }}>Alternate tuning or capo · skip</button>
    </section>
  );
}

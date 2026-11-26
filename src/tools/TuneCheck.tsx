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
const TUNED_KEY = "guitar-tuned-at";
let tunedAt = 0; // the guitar stays tuned for the sitting, not forever

function readTunedAt(): number {
  if (tunedAt > 0) return tunedAt;
  try {
    const raw = window.sessionStorage?.getItem(TUNED_KEY);
    const parsed = raw ? Number(raw) : 0;
    if (Number.isFinite(parsed) && parsed > 0) {
      const age = Date.now() - parsed;
      if (age >= 0 && age < FRESH_MS) return performance.now() - age;
    }
  } catch {
    // private/unavailable storage
  }
  return 0;
}

function markTuned() {
  tunedAt = performance.now();
  try {
    window.sessionStorage?.setItem(TUNED_KEY, String(Date.now()));
  } catch {
    // ignore storage failures
  }
}

export const isTuned = () => {
  const at = readTunedAt();
  return at > 0 && performance.now() - at < FRESH_MS;
};

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

type Mark = "none" | "confirmed";

/**
 * Quick non-blocking tune strip on Ready: pluck open strings to confirm each once in tune,
 * or play straight into the session at any time.
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
        if (here !== "none" && Math.abs(found.cents) > OK_CENTS * 2) next[found.index] = "none";
        hold.current = null;
        return next;
      }
      const since = hold.current?.index === found.index ? hold.current.since : performance.now();
      hold.current = { index: found.index, since };
      if (performance.now() - since < 280) return prev;
      if (here === "none") next[found.index] = "confirmed";
      return next;
    });
  }, [reading]);

  const allConfirmed = marks.every((m) => m === "confirmed");
  useEffect(() => {
    if (allConfirmed && !done.current) {
      done.current = true;
      markTuned();
      onDoneRef.current();
    }
  }, [allConfirmed]);

  const say = reading.state === "quiet" ? "Pluck open strings to check · or begin right away" : reading.state === "uncertain" ? "One clear string at a time" : !live ? "Between strings" : Math.abs(live.cents) <= OK_CENTS ? "In tune" : live.cents < 0 ? "Tune up" : "Tune down";

  return (
    <section className="ss-tune" aria-label="Tune your guitar">
      <p className="ss-section-label">Quick tune · optional</p>
      <ol className="ss-tune-strings">
        {STRINGS.map((s, i) => {
          const here = live?.index === i;
          const off = here && Math.abs(live.cents) > OK_CENTS;
          return (
            <li key={i} className={`mark-${marks[i]} ${here ? "is-heard" : ""} ${off ? (live.cents < 0 ? "is-flat" : "is-sharp") : ""}`} aria-label={`${s.note}${s.octave}: ${marks[i] === "confirmed" ? "in tune" : "not yet"}`}>
              <b>{s.note}<small>{s.octave}</small></b>
              <i aria-hidden="true">{marks[i] === "confirmed" ? "✓" : here && off ? (live.cents < 0 ? "♭" : "♯") : ""}</i>
            </li>
          );
        })}
      </ol>
      <p className="ss-tune-say" role="status">{say}{live ? ` · ${live.cents > 0 ? "+" : ""}${Math.round(live.cents)}¢` : ""}</p>
      <button type="button" className="ss-tune-skip" onClick={() => { markTuned(); onSkip(); }}>Already tuned · hide</button>
    </section>
  );
}

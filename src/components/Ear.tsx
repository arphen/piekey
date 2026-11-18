import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { noteName } from "./GuitarPad";

// ---------- the listening circle ----------

/** Tone detection as one thing to look at: glows with the input, names the note it hears; tap to turn listening on or off. */
export function Ear({ input, size, ring, tag }: { input: InputApi; size: "big" | "small"; ring?: RefObject<SVGCircleElement>; tag?: ReactNode }) {
  const disc = useRef<HTMLSpanElement>(null);
  const heardRef = useRef<{ midi: number; t: number } | null>(null);
  const [heard, setHeard] = useState<number | null>(null);
  const listening = input.status === "listening";
  const { subscribe } = input;
  useEffect(() => {
    if (!listening) return;
    return subscribe((f) => {
      const m = midiOf(f);
      if (m === null) return;
      // a new note shows at once; it clears on the slow poll below
      if (m !== heardRef.current?.midi || f.now - heardRef.current.t > 350) setHeard(m);
      heardRef.current = { midi: m, t: f.now };
    });
  }, [listening, subscribe]);
  // polled at 10 fps so listening never re-renders the exercise
  useEffect(() => {
    const id = window.setInterval(() => {
      if (disc.current) disc.current.style.transform = `scale(${(0.5 + 0.5 * Math.min(1, input.level.current * 1.6)).toFixed(3)})`;
      const h = heardRef.current;
      if (!h || performance.now() - h.t >= 350) setHeard(null);
    }, 100);
    return () => window.clearInterval(id);
  }, [input.level]);
  const on = listening && !input.paused;
  const label = input.status === "starting" ? "opening the input" : on ? "listening: tap to stop" : input.paused ? "tap to wake the input" : "not listening: tap to start";
  return (
    <button
      type="button"
      className={`ss-ear ss-ear--${size} ${on ? "is-on" : ""} ${on && heard !== null ? "is-hearing" : ""} ${input.status === "error" ? "is-error" : ""}`}
      onClick={() => (listening && !input.paused ? input.stop() : void input.start())}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ss-ear-track" cx="50" cy="50" r="46" />
        <circle className="ss-ear-hold" ref={ring} cx="50" cy="50" r="46" pathLength={1} />
      </svg>
      <span className="ss-ear-disc" ref={disc} />
      <span className="ss-ear-note">
        {on ? (
          heard !== null ? (
            noteName(heard)
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12 Q6 4 9 12 T15 12 T21 12" />
            </svg>
          )
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -6 0 v-5 a3 3 0 0 1 3 -3 M6 11 a6 6 0 0 0 12 0 M12 17 v3 M4 4 L20 20" />
          </svg>
        )}
      </span>
      {tag}
    </button>
  );
}

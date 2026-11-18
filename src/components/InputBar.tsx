import { useEffect, useRef, useState } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { pitchClassToName } from "../musicTheory";

interface InputBarProps {
  input: InputApi;
  prominent?: boolean; // the main control of the view: a bigger start button
}

const QUIET_LEVEL = 0.04; // meter level a played string easily passes
const QUIET_AFTER_MS = 4000;
const noteLabel = (midi: number) => `${pitchClassToName(midi).replace("#", "♯")}${Math.floor(midi / 12) - 1}`;

/** Start/stop, device choice, a level meter and the note being heard. */
export function InputBar({ input, prominent = false }: InputBarProps) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const heardRef = useRef<{ midi: number; t: number } | null>(null);
  const [heard, setHeard] = useState<number | null>(null);
  const [quiet, setQuiet] = useState(false);
  const listening = input.status === "listening";

  const { subscribe } = input;
  useEffect(() => {
    if (!listening) return;
    return subscribe((f) => {
      const midi = midiOf(f);
      if (midi !== null) heardRef.current = { midi, t: f.now };
    });
  }, [listening, subscribe]);

  // Meter, note readout and the no-signal hint poll refs at ~10 fps: no renders per audio frame.
  useEffect(() => {
    if (!listening) {
      if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
      setHeard(null);
      setQuiet(false);
      return;
    }
    const since = performance.now();
    let loudAt = 0;
    let shown: number | null = null;
    const id = window.setInterval(() => {
      const now = performance.now();
      const level = input.level.current;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${level.toFixed(3)})`;
      if (level > QUIET_LEVEL) loudAt = now;
      setQuiet(now - since > QUIET_AFTER_MS && now - loudAt > QUIET_AFTER_MS);
      const h = heardRef.current;
      const midi = h && now - h.t < 350 ? h.midi : null;
      if (midi !== shown) setHeard((shown = midi));
    }, 100);
    return () => window.clearInterval(id);
  }, [listening, input.level]);

  return (
    <div className={`input-bar ${prominent ? "is-prominent" : ""}`}>
      <button
        type="button"
        className={listening ? "pill is-on" : prominent ? "input-start" : "pill"}
        onClick={() => (listening ? input.stop() : void input.start())}
      >
        {input.status === "starting" ? "Opening input…" : listening ? "Listening" : "🎸 Start listening"}
      </button>
      {listening ? (
        <>
          <span className="input-meter is-on" aria-hidden="true">
            <span ref={fillRef} />
          </span>
          <span className={`input-heard ${heard !== null ? "is-on" : ""}`} aria-live="off" title="the note the app hears">
            {heard !== null ? noteLabel(heard) : "—"}
          </span>
        </>
      ) : null}
      {input.devices.length > 0 ? (
        <select
          className="input-select"
          value={input.deviceId ?? ""}
          onChange={(e) => input.setDeviceId(e.target.value)}
          aria-label="audio input"
        >
          {input.deviceId && !input.devices.some((d) => d.id === input.deviceId) ? <option value={input.deviceId}>Default input</option> : null}
          {input.devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      ) : null}
      {input.paused ? <span className="input-note">Click anywhere so the browser lets the app hear you</span> : null}
      {!input.paused && quiet ? (
        <span className="input-note">Play a string. If the meter stays still, turn up the input knob on the 2i2 or pick another input here.</span>
      ) : null}
      {input.error ? <span className="input-error">{input.error}</span> : null}
    </div>
  );
}

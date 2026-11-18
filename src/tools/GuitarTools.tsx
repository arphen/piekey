import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BeatPulse } from "../components/PracticeAtmosphere";
import { InputBar } from "../components/InputBar";
import type { InputApi } from "../listen/useInput";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import type { Timeline } from "../tunes/order";
import { usePlayback, type PlaybackMix } from "../tunes/usePlayback";
import { clampToolBpm, MAX_TOOL_BPM, MIN_TOOL_BPM, tapTempo } from "./timing";
import { useTuner } from "./useTuner";
import "./tools.css";

const METRONOME: Timeline = { slots: [{ bar: 0, pass: 1, run: 0, start: 0, beats: 4 }], targets: [], comp: [], total: 4 };

export function GuitarTools(props: { input: InputApi; onClose(): void }) {
  return <PracticeWindowBoundary onExit={props.onClose}><Tools {...props} /></PracticeWindowBoundary>;
}

function Tools({ input, onClose }: { input: InputApi; onClose(): void }) {
  const [tool, setTool] = useState<"tuner" | "metronome">("tuner");
  const [bpm, setBpm] = useState(80);
  const [division, setDivision] = useState<NonNullable<PlaybackMix["clickSubdivision"]>>(1);
  const [countIn, setCountIn] = useState(true);
  const [error, setError] = useState("");
  const taps = useRef<number[]>([]);
  const playback = usePlayback(METRONOME, { bpm, melody: false, chords: false, click: true, countIn, clickSubdivision: division }, input, false, false);
  const tuner = useTuner(input, tool === "tuner");
  const close = useCallback(() => { playback.stop(); onClose(); }, [playback.stop, onClose]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close]);
  const changeTempo = (value: number) => { setBpm(clampToolBpm(value)); taps.current = []; };
  const tap = () => {
    const result = tapTempo(taps.current, performance.now());
    taps.current = result.taps;
    if (result.bpm !== null) setBpm(result.bpm);
  };
  const pitch = tuner.state === "pitch" ? tuner.pitch : null;
  const listening = input.status === "listening" && !input.paused;
  const cents = pitch?.cents ?? 0;
  const tunerText = !listening ? "Enable the microphone to tune." : tuner.state === "quiet" ? "Quiet · pluck one string and let it ring." : tuner.state === "uncertain" ? "Pitch unclear · let one string ring on its own." : Math.abs(cents) <= 3 ? "Within 3 cents of concert pitch." : cents > 0 ? "Sharp · lower the pitch." : "Flat · raise the pitch.";
  return <main className="guitar-tools" aria-labelledby="guitar-tools-title">
    <header className="guitar-tools-head"><h1 id="guitar-tools-title">Guitar tools</h1><button type="button" onClick={close} aria-label="Close guitar tools">Close</button></header>
    <nav className="guitar-tools-tabs" aria-label="guitar tools">
      <button type="button" aria-pressed={tool === "tuner"} onClick={() => { playback.stop(); setTool("tuner"); }}>Tuner</button>
      <button type="button" aria-pressed={tool === "metronome"} onClick={() => setTool("metronome")}>Metronome</button>
    </nav>
    {tool === "tuner" ? <section className="guitar-tools-tuner" aria-label="chromatic tuner">
      <p className="guitar-tools-note" aria-live="off">{listening && pitch ? <>{pitch.noteName.replace("#", "♯")}<small>{pitch.octave}</small></> : "—"}</p>
      <p className="guitar-tools-cents">{listening && pitch ? `${cents > 0 ? "+" : ""}${cents} cents · ${pitch.frequency.toFixed(1)} Hz` : "Concert pitch · A4 = 440 Hz"}</p>
      <div className="guitar-tools-meter" aria-hidden="true" style={{ "--tuner-position": `${50 + cents}%` } as CSSProperties}><span>♭</span><i className={listening && pitch ? "is-reading" : ""} /><span>♯</span></div>
      <p role="status">{tunerText}</p>
      <p className="guitar-tools-hint">Standard tuning, low to high: E2 · A2 · D3 · G3 · B3 · E4</p>
      <InputBar input={input} prominent />
    </section> : <section className="guitar-tools-metronome" aria-label="metronome">
      <BeatPulse beat={playback.beat} bpm={bpm} />
      <div className="guitar-tools-tempo"><button type="button" aria-label="5 beats per minute slower" onClick={() => changeTempo(bpm - 5)}>−5</button><label>Tempo <input type="number" min={MIN_TOOL_BPM} max={MAX_TOOL_BPM} value={bpm} onChange={(event) => changeTempo(event.currentTarget.valueAsNumber)} /> bpm</label><button type="button" aria-label="5 beats per minute faster" onClick={() => changeTempo(bpm + 5)}>+5</button></div>
      <div className="guitar-tools-controls"><button type="button" onClick={tap}>Tap tempo</button><label>Subdivision <select value={division} onChange={(event) => setDivision(Number(event.target.value) as typeof division)}><option value={1}>Quarter notes</option><option value={2}>Eighth notes</option><option value={3}>Triplets</option><option value={4}>Sixteenth notes</option></select></label></div>
      <button type="button" className="guitar-tools-count" aria-pressed={countIn} onClick={() => setCountIn((value) => !value)}>One-bar count-in on start · {countIn ? "On" : "Off"}</button>
      <button type="button" className="guitar-tools-start" onClick={() => { setError(""); if (playback.playing) playback.stop(); else void playback.play(0, 0, true).catch(() => setError("Audio could not start. Try Start again.")); }}>{playback.playing ? "Stop" : "Start metronome"}</button>
      <p role="status">{error || (playback.playing ? playback.counting ? "Counting in…" : "Click playing · 4 beats per bar" : "Stopped · tap twice or choose a tempo")}</p>
    </section>}
  </main>;
}

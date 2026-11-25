import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BeatPulse, PracticeAtmosphere } from "../components/PracticeAtmosphere";
import { Glyph } from "../components/Glyph";
import { GuitarPad, SummonVisual, useSummon, type PadRow } from "../components/GuitarPad";
import { InputBar } from "../components/InputBar";
import type { InputApi } from "../listen/useInput";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import { PoolRoom, usePoolEmit } from "../pool/PoolRoom";
import { useRoomRender } from "../pool/mode";
import type { Timeline } from "../tunes/order";
import { usePlayback, type PlaybackMix } from "../tunes/usePlayback";
import { clampToolBpm, MAX_TOOL_BPM, MIN_TOOL_BPM, tapTempo } from "./timing";
import { useTuner } from "./useTuner";
import "../song/song.css";
import "./tools.css";

const METERS = [2, 3, 4, 5, 6, 7] as const;
type BeatsPerBar = typeof METERS[number];
const STRINGS = [{ midi: 40, note: "E", octave: 2 }, { midi: 45, note: "A", octave: 2 }, { midi: 50, note: "D", octave: 3 }, { midi: 55, note: "G", octave: 3 }, { midi: 59, note: "B", octave: 3 }, { midi: 64, note: "E", octave: 4 }];
const DIVISIONS = [1, 2, 3, 4] as const;
const DIVISION_LABEL = { 1: "Quarter notes", 2: "Eighth notes", 3: "Triplets", 4: "Sixteenth notes" };
type Tool = "tuner" | "metronome";
const TUNER_TICKS = Array.from({ length: 21 }, (_, i) => {
  const value = (i - 10) * 5; // -50 .. +50 cents
  return {
    value,
    angle: (value / 50) * 60,
    major: value % 25 === 0,
    medium: value % 10 === 0,
  };
});

function arcPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function tunerArcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = arcPoint(cx, cy, r, fromDeg);
  const [x2, y2] = arcPoint(cx, cy, r, toDeg);
  const sweep = toDeg >= fromDeg ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
interface GuitarToolsRoomProps {
  input: InputApi;
  onClose(): void;
  initialTool?: Tool;
  initialBpm?: number;
  onToolChange?(tool: Tool): void;
}

export function GuitarTools(props: GuitarToolsRoomProps) {
  return <PracticeWindowBoundary onExit={props.onClose}><PoolRoom input={props.input}><GuitarToolsRoom {...props} /></PoolRoom></PracticeWindowBoundary>;
}

/** The same instruments can open inside an already protected practice room. */
export function GuitarToolsRoom({ input, onClose, initialTool = "tuner", initialBpm = 80, onToolChange }: GuitarToolsRoomProps) {
  const [tool, setTool] = useState<Tool>(initialTool);
  const prevInitialTool = useRef(initialTool);
  const [bpm, setBpm] = useState(() => clampToolBpm(initialBpm));
  const [beats, setBeats] = useState<BeatsPerBar>(4);
  const [division, setDivision] = useState<NonNullable<PlaybackMix["clickSubdivision"]>>(1);
  const [countIn, setCountIn] = useState(true);
  const [tempoDraft, setTempoDraft] = useState<string | null>(null); // typed digits, until they make a tempo
  const [error, setError] = useState("");
  const [pad, setPad] = useState<0 | 1 | null>(null);
  const room = useRef<HTMLElement>(null);
  const padTrigger = useRef<HTMLElement | null>(null);
  const render = useRoomRender();
  const emitPool = usePoolEmit();
  const taps = useRef<number[]>([]);
  const timeline = useMemo<Timeline>(() => ({ slots: [{ bar: 0, pass: 1, run: 0, start: 0, beats }], targets: [], comp: [], total: beats }), [beats]);
  const playback = usePlayback(timeline, { bpm, melody: false, chords: false, click: true, countIn, clickSubdivision: division }, input, false, false);
  const beat = useMemo(() => ({ ...playback.beat, beats }), [playback.beat, beats]);
  const tuner = useTuner(input, tool === "tuner" && pad === null);
  const close = useCallback(() => { playback.stop(); onClose(); }, [playback.stop, onClose]);
  useEffect(() => {
    if (prevInitialTool.current !== initialTool) {
      prevInitialTool.current = initialTool;
      if (initialTool === "tuner") playback.stop();
      setTool(initialTool);
      setError("");
    }
  }, [initialTool, playback.stop]);
  const keyboard = useRef({ pad, close });
  keyboard.current = { pad, close };
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    room.current?.focus({ preventScroll: true });
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (pad !== null) {
      padTrigger.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
      room.current?.querySelector<HTMLButtonElement>(".ss-pad button:not(:disabled)")?.focus();
    } else if (padTrigger.current) {
      if (padTrigger.current.isConnected) padTrigger.current.focus({ preventScroll: true });
      padTrigger.current = null;
    }
  }, [pad]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        if (keyboard.current.pad !== null) setPad(null);
        else keyboard.current.close();
      } else if (event.key === "Tab") {
        const scope = keyboard.current.pad !== null ? room.current?.querySelector<HTMLElement>(".ss-pad") : room.current;
        const controls = [...scope?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="hidden"]), a[href], [tabindex]:not([tabindex="-1"])') ?? []].filter((element) => {
          const style = getComputedStyle(element);
          return !element.closest('[hidden], [aria-hidden="true"], [inert]') && style.display !== "none" && style.visibility !== "hidden";
        });
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); room.current?.focus(); return; }
        if (!scope?.contains(document.activeElement) || document.activeElement === room.current) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const ring = useSummon(input, pad === null, () => setPad(0));
  const changeTool = (next: Tool) => {
    if (next === "tuner") playback.stop();
    setTool(next);
    onToolChange?.(next);
    setError("");
  };
  const changeTempo = (value: number) => { setBpm(clampToolBpm(value)); setTempoDraft(null); taps.current = []; };
  // Typing 120 passes through 1 and 12: only a complete in-range tempo applies, the rest on leaving the field.
  const editTempo = (text: string) => {
    setTempoDraft(text);
    const value = Number(text);
    if (text.trim() && Number.isInteger(value) && value >= MIN_TOOL_BPM && value <= MAX_TOOL_BPM) { setBpm(value); taps.current = []; }
  };
  const commitTempo = () => {
    if (tempoDraft === null) return;
    if (tempoDraft.trim() && Number.isFinite(Number(tempoDraft))) changeTempo(Number(tempoDraft));
    else setTempoDraft(null);
  };
  const tap = () => {
    const result = tapTempo(taps.current, performance.now());
    taps.current = result.taps;
    if (result.bpm !== null) setBpm(result.bpm);
  };
  const toggleClick = () => {
    setError("");
    if (playback.playing) playback.stop();
    else {
      setTool("metronome");
      onToolChange?.("metronome");
      void playback.play(0, 0, true).catch(() => setError("Audio could not start. Try Start again."));
    }
  };
  const cycleDivision = () => setDivision(DIVISIONS[(DIVISIONS.indexOf(division) + 1) % DIVISIONS.length]);
  const changeMeter = (next: BeatsPerBar) => {
    if (next === beats || !METERS.includes(next)) return;
    playback.stop();
    setBeats(next);
    setError("");
  };
  const cycleMeter = () => changeMeter(METERS[(METERS.indexOf(beats) + 1) % METERS.length]);
  const pages: { title: string; rows: PadRow[]; fire: (() => void)[] }[] = [
    {
      title: `Instruments · ${bpm} bpm`,
      rows: [{ label: "Back to instrument" }, { label: "Slower", value: "−4 bpm" }, { label: "Faster", value: "+4 bpm" }, { label: tool === "tuner" ? "Metronome" : "Tuner" }, { label: playback.playing ? "Stop click" : "Start click" }, { label: "Rhythm & return" }],
      fire: [() => setPad(null), () => changeTempo(bpm - 4), () => changeTempo(bpm + 4), () => { changeTool(tool === "tuner" ? "metronome" : "tuner"); setPad(null); }, () => { toggleClick(); setPad(null); }, () => setPad(1)],
    },
    {
      title: "Rhythm & return",
      rows: [{ label: "Instrument controls" }, { label: "Subdivision", value: DIVISION_LABEL[division] }, { label: "Count-in", value: countIn ? "one bar" : "off" }, { label: "Room", value: render.value }, { label: "Beats per bar", value: `${beats}` }, { label: "Return to practice" }],
      fire: [() => setPad(0), cycleDivision, () => setCountIn((value) => !value), render.cycle, cycleMeter, close],
    },
  ];
  const pitch = tuner.state === "pitch" ? tuner.pitch : null;
  const listening = input.status === "listening" && !input.paused;
  const cents = pitch?.cents ?? 0;
  const clampedCents = Math.max(-50, Math.min(50, cents));
  const needleAngle = (clampedCents / 50) * 60;
  const reading = listening && pitch !== null;
  const settled = reading && Math.abs(cents) <= 3;
  // The pool shows the string's beating; at most ten readings a second, and nothing comes back.
  const tuned = useRef(0);
  useEffect(() => {
    if (!listening || !pitch || performance.now() - tuned.current < 100) return;
    tuned.current = performance.now();
    emitPool({ kind: "tune", cents: pitch.cents, frequency: pitch.frequency });
  }, [listening, pitch, emitPool]);
  const tunerText = !listening ? input.paused ? "Resume listening below." : "Enable listening below." : tuner.state === "quiet" ? "One string. Let it ring." : tuner.state === "uncertain" ? "One clear string at a time." : settled ? "In tune" : cents > 0 ? "A little lower" : "A little higher";
  const inputText = input.status === "starting" ? "Opening input…" : input.paused ? "Input paused" : listening ? "Guitar listening" : input.status === "error" ? "Reconnect guitar" : "Input off";

  return <main ref={room} tabIndex={-1} className={`ss guitar-tools instrument-room is-${tool} ${reading ? "is-reading" : ""} ${settled ? "is-in-tune" : ""}`} role="dialog" aria-modal="true" aria-label={tool === "tuner" ? "Tuner" : "Metronome"}>
    <PracticeAtmosphere input={input} warmth={settled ? 0.85 : reading ? 0.35 : 0} flow={settled ? 0.92 : reading ? 0.45 : 0} playing={listening && pad === null} beat={tool === "metronome" ? beat : undefined} bpm={bpm} />
    <div className="guitar-tools-flow" aria-hidden={pad !== null || undefined} style={{ visibility: pad !== null ? "hidden" : undefined }}>
      {tool === "tuner" ? <section className="guitar-tools-tuner" aria-label="chromatic tuner">
        <div className="guitar-tools-tuner-stage" data-pool="calm" data-pool-anchor="tuner" style={{ "--tuner-angle": `${needleAngle.toFixed(2)}deg`, "--tuner-position": `${50 + clampedCents}%` } as CSSProperties}>
          <p className="guitar-tools-overline">Chromatic · A 440 Hz</p>
          <div className="guitar-tools-dial" aria-hidden="true">
            <svg viewBox="0 0 360 185" className="guitar-tools-arc-svg">
              <defs>
                <radialGradient id="gt-lock-glow" cx="50%" cy="18%" r="55%">
                  <stop offset="0%" stopColor="#8eff58" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#6de64b" stopOpacity="0" />
                </radialGradient>
              </defs>
              {settled ? <circle cx="180" cy="180" r="158" fill="url(#gt-lock-glow)" /> : null}
              <path className="gt-arc-bg" d={tunerArcPath(180, 180, 144, -60, 60)} />
              <path className="gt-arc-inner" d={tunerArcPath(180, 180, 122, -60, 60)} />
              <path className="gt-arc-zone" d={tunerArcPath(180, 180, 144, -3.6, 3.6)} />
              {reading && Math.abs(needleAngle) > 0.5 ? (
                <path className={`gt-arc-active ${settled ? "is-locked" : ""}`} d={tunerArcPath(180, 180, 144, Math.min(0, needleAngle), Math.max(0, needleAngle))} />
              ) : null}
              {TUNER_TICKS.map((tick) => {
                const outer = tick.major ? 154 : tick.medium ? 150 : 147;
                const inner = tick.major ? 132 : tick.medium ? 136 : 140;
                const [x1, y1] = arcPoint(180, 180, inner, tick.angle);
                const [x2, y2] = arcPoint(180, 180, outer, tick.angle);
                return <line key={tick.value} className={`gt-tick ${tick.value === 0 ? "is-zero" : tick.major ? "is-major" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
              })}
              <g className={`gt-needle ${reading ? "is-reading" : ""}`} style={{ transform: `rotate(${needleAngle.toFixed(2)}deg)` }}>
                <line x1="180" y1="168" x2="180" y2="34" />
                <circle cx="180" cy="36" r="4.5" />
              </g>
              <text className="gt-arc-label" x="48" y="132">♭ −50</text>
              <text className="gt-arc-label is-zero" x="180" y="18" textAnchor="middle">0</text>
              <text className="gt-arc-label" x="312" y="132" textAnchor="end">+50 ♯</text>
            </svg>
            <div className="guitar-tools-pitch" aria-live="off">
              <p className="guitar-tools-note">{reading ? <>{pitch.noteName.replace("#", "♯")}<small>{pitch.octave}</small></> : "—"}</p>
            </div>
          </div>
          <p className="guitar-tools-cents">
            {reading ? (
              <>
                <span className="gt-cents-val">{cents > 0 ? `+${cents}` : cents} cents</span>
                <span className="gt-hz-val">{pitch.frequency.toFixed(1)} Hz</span>
              </>
            ) : (
              <span className="gt-idle-hint">Pluck a single string</span>
            )}
          </p>
          <p className="guitar-tools-status" role="status">{tunerText}</p>
        </div>
        <ol className="guitar-tools-strings" aria-label="Standard guitar tuning, low to high" data-pool="calm">
          {STRINGS.map((string, index) => {
            const heard = reading && pitch.midi === string.midi;
            return (
              <li key={string.midi} className={`${heard ? "is-heard" : ""} ${heard && settled ? "is-locked" : ""}`}>
                <span className="guitar-tools-string-number">{6 - index}</span>
                <span className="guitar-tools-string-note">{string.note}<small>{string.octave}</small></span>
                <i style={{ height: `${2.8 - index * 0.34}px` }} />
              </li>
            );
          })}
        </ol>
        <p className="guitar-tools-string-caption">Standard tuning · E A D G B E</p>
      </section> : <section className="guitar-tools-metronome" aria-label="metronome">
        <div className="guitar-tools-clock">
          <label className="guitar-tools-bar-length"><select aria-label="Beats per bar" value={beats} onChange={(event) => changeMeter(Number(event.target.value) as BeatsPerBar)}>{METERS.map((value) => <option key={value} value={value}>{value}</option>)}</select><span>beats / bar</span></label>
          <BeatPulse beat={beat} bpm={bpm} />
        </div>
        <div className="guitar-tools-settings" data-pool="calm">
        <div className="guitar-tools-tempo">
          <button type="button" className="guitar-tools-tempo-step" aria-label="4 beats per minute slower" onClick={() => changeTempo(bpm - 4)}>−<small>4</small></button>
          <label>Tempo <span><input aria-label="Tempo in beats per minute" type="number" min={MIN_TOOL_BPM} max={MAX_TOOL_BPM} value={tempoDraft ?? bpm} onChange={(event) => editTempo(event.currentTarget.value)} onBlur={commitTempo} /><small>bpm</small></span></label>
          <button type="button" className="guitar-tools-tempo-step" aria-label="4 beats per minute faster" onClick={() => changeTempo(bpm + 4)}>+<small>4</small></button>
        </div>
        <div className="guitar-tools-rhythm">
          <div className="guitar-tools-subdivision" role="group" aria-label="Subdivision">{DIVISIONS.map((value) => <button type="button" key={value} aria-label={DIVISION_LABEL[value]} aria-pressed={division === value} onClick={() => setDivision(value)}><span aria-hidden="true">{["♩", "♫", "3", "♬"][value - 1]}</span><small>{["Quarter", "Eighth", "Triplet", "Sixteenth"][value - 1]}</small></button>)}</div>
          <div className="guitar-tools-options"><button type="button" onClick={tap}>Tap tempo</button><button type="button" className="guitar-tools-count" aria-pressed={countIn} onClick={() => setCountIn((value) => !value)}><i aria-hidden="true" />Count in<span>{countIn ? "1 bar" : "Off"}</span></button></div>
        </div>
        <button type="button" className="guitar-tools-start" onClick={toggleClick}><Glyph name={playback.playing ? "close" : "play"} size={18} />{playback.playing ? "Stop click" : "Start metronome"}</button>
        <p className="guitar-tools-status" role="status">{error || (playback.playing ? playback.counting ? "Counting in…" : "Click playing" : "Ready when you are")}</p>
        </div>
      </section>}
      <footer className="guitar-tools-foot" data-pool="calm">
        <button type="button" className="guitar-tools-guitar" onClick={() => setPad(0)} aria-label="Open guitar instrument controls"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="17" /><circle ref={ring} className="guitar-tools-summon" cx="21" cy="21" r="17" pathLength="1" /><path d="M14 16h14M14 21h14M14 26h14" /></svg><span>Guitar controls<SummonVisual /></span></button>
        <div className="guitar-tools-room-options"><span className={`guitar-tools-input-state ${listening ? "is-listening" : ""}`}><i />{inputText}</span><button type="button" className="guitar-tools-render" aria-pressed={render.mode !== "still"} onClick={render.cycle}>Room<span>{render.value}</span></button></div>
        <div className="guitar-tools-input">{input.paused ? <button type="button" className="guitar-tools-resume" onClick={() => void input.start()}>Resume listening</button> : <InputBar input={input} prominent={!listening} />}</div>
      </footer>
    </div>
    {pad !== null ? <GuitarPad key={pad} input={input} title={pages[pad].title} rows={pages[pad].rows} onFire={(index) => pages[pad].fire[index]()} /> : null}
  </main>;
}

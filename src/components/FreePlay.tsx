import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { NoteResult } from "../core/contract";
import type { InputApi } from "../listen/useInput";
import type { Deck } from "../song/deck";
import { DIVISION_LABEL, PATTERN_LABEL, type Division } from "../song/freeplay";
import { makeScale, parseChord, pretty, type Chord } from "../song/harmony";
import { cardForLoop } from "../song/progression";
import { playedSheet } from "../song/notation";
import { useFreePlay, type ClickMode, type FreeView } from "../song/useFreePlay";
import { GuitarToolsRoom } from "../tools/GuitarTools";
import { Ear } from "./Ear";
import { GuitarPad, SUMMON_HINT, useSummon, type PadRow } from "./GuitarPad";
import { BeatPulse, PracticeAtmosphere } from "./PracticeAtmosphere";
import { Score } from "./Score";
import { Glyph } from "./Glyph";
import "../song/freeplay-room.css";

// Free play: nothing is asked. What is played is written down as it comes, the key and the kind of
// exercise are read off it, and a click joins in by itself (see useFreePlay). How it is going is on
// the screen as it happens: where each note sat against the grid, how long the playing has been on
// the click, how close the next step up is. Every note can be part of the playing here, so there
// are no note keys. The deliberate low-E hold/release/hold gesture calls the menu.

const C_MAJOR = makeScale(0, "major");
const NONE: NoteResult[] = [];
const MODE_LABEL: Record<ClickMode, string> = { follows: "follows me", steady: "steady", off: "off" };
const TIGHT = 0.12; // of a grid cell: closer than this is on it
const pace = (p: { bpm: number; division: Division }) => `♩ ${p.bpm} · ${DIVISION_LABEL[p.division]}`;

/** What the click is doing, said as a state, not as an order. */
function clickLine(v: FreeView): string {
  if (v.mode === "off") return "Click off";
  if (!v.on)
    return v.change === "off"
      ? "Waiting for steady notes"
      : v.change === "rest"
        ? "Click resting"
        : "Waiting for steady notes";
  if (v.change === "moved") return "Tempo matched";
  switch (v.mood) {
    case "locked":
      return v.change === "up" ? "Tempo up" : v.held && v.mode === "follows" ? `Holding ♩ ${v.bpm}` : "Steady";
    case "ahead":
      return "Moving earlier";
    case "behind":
      return v.change === "down" ? `Tempo eased · ♩ ${v.bpm}` : "Moving later";
    case "loose":
      return "Finding the beat";
    default:
      return v.change === "on" ? "Click on" : v.change === "down" && v.held ? `Holding ♩ ${v.bpm}` : "";
  }
}

/** Where each of the last notes sat against the grid: a trail, the newest at the bottom. Left of the line is ahead of the click. */
function Lane({ timing, alignment }: { timing: number[]; alignment: number }) {
  const w = 300;
  const h = 96;
  const row = (h - 26) / 28;
  return (
    <svg className="fp-lane" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="where the last notes sat against the click">
      <rect className="fp-lane-zone" x={w / 2 - TIGHT * w} y="2" width={2 * TIGHT * w} height={h - 18} rx="6" />
      <line className="fp-lane-mid" x1={w / 2} x2={w / 2} y1="0" y2={h - 14} />
      {timing.map((d, i) => {
        const age = timing.length - 1 - i;
        return <circle key={i} className={Math.abs(d - alignment) <= TIGHT ? "is-on" : "is-off"} cx={w / 2 + Math.max(-0.5, Math.min(0.5, d)) * w} cy={h - 20 - age * row} r={age === 0 ? 4.2 : 2.6} opacity={Math.max(0.12, 1 - age / 28)} />;
      })}
      <text x="6" y={h - 2}>
        earlier
      </text>
      <text x={w - 6} y={h - 2} textAnchor="end">
        later
      </text>
    </svg>
  );
}

/** The click's tempo over this visit, two bars a step; gaps where it stepped out. */
function Trace({ values }: { values: number[] }) {
  const on = values.filter((v) => v > 0);
  if (on.length < 3) return <span className="fp-trace" />;
  const w = 150;
  const h = 30;
  const lo = Math.min(...on) - 2;
  const hi = Math.max(...on) + 2;
  const x = (i: number) => 2 + (i * (w - 4)) / (values.length - 1);
  const y = (v: number) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  let pen = false;
  const d = values
    .map((v, i) => {
      if (v <= 0) {
        pen = false;
        return "";
      }
      const cmd = `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
      return cmd;
    })
    .join(" ");
  const last = values.length - 1;
  return (
    <svg className="fp-trace" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`the click's tempo so far, ${Math.min(...on)} to ${Math.max(...on)}`}>
      <path d={d} />
      {values[last] > 0 ? <circle cx={x(last)} cy={y(values[last])} r="2.6" /> : null}
    </svg>
  );
}

export function FreePlay({ input, deck, onClose, onPractise, active = true, onChooseTune, onToolsChange }: { input: InputApi; deck?: Deck; onClose(): void; onPractise(cardId: string): void; active?: boolean; onChooseTune?(): void; onToolsChange?(open: boolean): void }) {
  const [pad, setPad] = useState<number | null>(null);
  const [tool, setTool] = useState<"tuner" | "metronome" | null>(null);
  useEffect(() => {
    onToolsChange?.(tool !== null);
    return () => onToolsChange?.(false);
  }, [tool, onToolsChange]);
  const roomActive = active && tool === null;
  const { view: v, nudge, cycleMode, toggleBand } = useFreePlay(input, roomActive && pad === null);
  const ring = useSummon(input, roomActive && pad === null, () => setPad(0));
  const openTool = (next: "tuner" | "metronome") => { setPad(null); setTool(next); };

  const scale = v.key?.scale ?? null;
  // an exercise in the box for exactly this: one hold away
  const scaleCard = scale && v.pattern && v.pattern !== "melody" ? deck?.cards.find((c) => c.id === `scale:${scale.id}:${v.pattern}`) : undefined;
  // or for the chords being strummed round
  const loopKey = v.loop?.join(" ") ?? "";
  const loopCard = useMemo(() => {
    const loop = (v.loop ?? []).map((x) => parseChord(x)).filter((c): c is Chord => c !== null);
    return loop.length && deck ? cardForLoop(deck, loop) ?? undefined : undefined;
  }, [loopKey, deck]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = scaleCard ?? loopCard;

  // what was played, written out: the bar being filled and the one before it
  const scaleId = scale?.id ?? "";
  const sheet = useMemo(() => {
    const { count, midis } = v.written;
    const perBar = 4 * v.division;
    const from = Math.max(0, Math.floor(Math.max(0, count - 1) / perBar) * perBar - perBar);
    const shown = Math.min(midis.length, count - from);
    return playedSheet(shown > 0 ? midis.slice(-shown) : [], scale ?? C_MAJOR, 1 / v.division);
  }, [v.written, v.division, scaleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages: { rows: PadRow[]; fire: (() => void)[] }[] = [
    {
      rows: [
        { label: "Back to playing" },
        { label: "Slower, and stay there", value: v.on ? `♩ ${v.bpm}` : undefined },
        { label: "Faster" },
        { label: "Click", value: MODE_LABEL[v.mode] },
        { label: "Band", value: v.band ? "playing" : v.bandOn ? "waiting for steady playing" : "off" },
        { label: "Instruments & more" },
      ],
      fire: [() => setPad(null), () => nudge(-4), () => nudge(4), cycleMode, toggleBand, () => setPad(1)],
    },
    {
      rows: [{ label: "Back" }, { label: "Tuner" }, { label: "Metronome" }, { label: card ? `Practise ${card.title}` : "" }, { label: onChooseTune ? "Choose tune" : "" }, { label: "Leave free play" }],
      fire: [() => setPad(0), () => openTool("tuner"), () => openTool("metronome"), () => card && onPractise(card.id), () => { setPad(null); onChooseTune?.(); }, () => setPad(2)],
    },
    {
      rows: [{ label: "Keep playing" }, { label: "" }, { label: "" }, { label: "" }, { label: "" }, { label: "Confirm leave free play" }],
      fire: [() => setPad(null), () => undefined, () => undefined, () => undefined, () => undefined, onClose],
    },
  ];

  const facts = [v.pattern ? PATTERN_LABEL[v.pattern] : null, v.on ? DIVISION_LABEL[v.division] : null].filter(Boolean).join(" · ");
  const minutes = Math.floor(v.secs / 60);
  const arrived = v.count > 2 || v.on;
  const listening = input.status === "listening" && !input.paused;
  const flow = v.onGrid ?? 0;
  const arc = v.on && v.mode === "follows" ? Math.min(1, v.rise.have / v.rise.need) : 0; // how close the next step up is
  if (tool !== null) return <div className="ss-free fp-room has-tools"><div className="fp-tools-overlay"><GuitarToolsRoom input={input} onClose={() => setTool(null)} initialTool={tool} initialBpm={v.bpm} /></div></div>;
  return (
    <div className={`ss-free fp-room ${arrived ? "has-playing" : "is-arriving"} ${pad !== null ? "has-menu" : ""} ${v.on ? "is-on" : ""} ${v.mood ? `is-${v.mood}` : ""} ${v.band ? "has-band" : ""}`}>
      <PracticeAtmosphere input={input} warmth={Math.min(1, v.secs / 180)} flow={flow} playing={roomActive && listening && pad === null && arrived} beat={v.beatSignal} bpm={v.bpm} />
      <header className="fp-heading">
        {scale ? <p className="ss-kicker">Free play</p> : null}
        <h1 className="ss-display">{scale ? scale.name : "Free play"}</h1>
        {arrived && facts ? <p className="ss-sub">{facts}</p> : null}
        <nav className="fp-instruments" aria-label="Guitar instruments">
          <button type="button" onClick={() => openTool("tuner")} aria-label="Open tuner"><Glyph name="tools" size={19} /><span>Tuner</span></button>
          <button type="button" onClick={() => openTool("metronome")} aria-label="Open metronome"><Glyph name="free" size={19} /><span>Metronome</span></button>
        </nav>
      </header>

      {arrived ? (
        <div className="fp-session">
          {v.count > 2 ? <div className="ss-score ss-score--free"><Score exercise={sheet} activeStep={-1} results={NONE} showFingering={false} /></div> : null}
          <div className={`fp-deck ${v.onGrid === null ? "is-finding" : ""}`}>
            <div className="fp-side fp-timing">
              {v.onGrid !== null ? <><p className="fp-overline">Your timing</p><Lane timing={v.timing} alignment={(v.alignment ?? 0) / (60000 / v.bpm / v.division)} /><p className="fp-cap">{Math.round(v.onGrid * 100)}% near alignment{v.spread !== null ? ` · ±${Math.round(v.spread)} ms spread` : ""}{v.alignment !== null ? ` · ${v.alignment >= 0 ? "+" : ""}${Math.round(v.alignment)} ms alignment` : ""}</p></> : null}
            </div>
            <div className="fp-click">
              <BeatPulse beat={v.beatSignal} bpm={v.on ? v.bpm : undefined} />
              <p className="fp-mood" aria-live="polite">{clickLine(v)}</p>
              {v.on && v.mode === "follows" ? <div className="fp-settle" style={{ "--settle": arc } as CSSProperties} aria-label={v.held ? "tempo held" : "click follows your tempo"}><i /><span>{v.held ? "tempo held" : "following your tempo"}</span></div> : null}
            </div>
            <div className="fp-side fp-session-stats">
              <p className="fp-overline">This play</p>
              <dl className="fp-stats">
                {v.on ? <div><dd>{v.bars}</dd><dt>bars in a row</dt></div> : null}
                {v.best ? <div><dd>{v.best.bpm}</dd><dt>best tempo · {DIVISION_LABEL[v.best.division]}</dt></div> : null}
                {v.count ? <div><dd>{v.count}</dd><dt>notes{minutes ? ` · ${minutes} min` : ""}</dt></div> : null}
              </dl>
              {v.beaten || v.record ? <p className="fp-cap">{v.beaten ? "a new personal best" : `record ${pace(v.record!)}`}</p> : null}
            </div>
          </div>
          <div className="fp-under">
            <Trace values={v.trace} />
            {v.band ? <ol className="fp-vamp is-in" aria-label="what the band is playing">{v.chords.map((c, i) => <li key={i} className={v.bar === i ? "is-now" : ""}>{c}</li>)}</ol> : null}
            {v.loop || card ? <p className="fp-offer">{v.loop ? v.loop.map(pretty).join(" · ") : ""}{card ? `${v.loop ? " · " : ""}${card.title} · practise from the menu` : ""}</p> : null}
          </div>
        </div>
      ) : (
        <div className="fp-invitation">
          <div className="fp-arrival-ear"><Ear input={input} size="big" ring={ring} /></div>
          <p className="fp-listening-label"><i className={listening ? "is-live" : ""} />{input.status === "starting" ? "Connecting…" : listening ? "Listening" : input.paused ? "Tap to resume" : "Connect guitar"}</p>
          <div className="fp-arrival-settings" data-nav-skip><span><Glyph name="free" size={17} />Click <b>{MODE_LABEL[v.mode]}</b></span><span><Glyph name="harmony" size={18} />Band <b>{v.bandOn ? "auto" : "off"}</b></span></div>
          {input.error ? <p className="fp-input-error">{input.error}</p> : null}
        </div>
      )}

      <footer className="fp-room-foot">
        <div className="fp-input-anchor">{arrived ? <><Ear input={input} size="small" ring={ring} /><span>{listening ? "Listening" : "Reconnect"}</span></> : null}</div>
        <div className="fp-menu-anchor"><button type="button" onClick={() => setPad(0)} aria-label="Open free play menu"><span className="fp-menu-note">E<span>2</span></span>Menu<span aria-hidden="true">↗</span></button><span>{SUMMON_HINT}</span></div>
        <p className="fp-band-state"><i className={v.band ? "is-live" : ""} />Band {v.band ? "playing" : v.bandOn ? "listening" : "off"}</p>
      </footer>
      {roomActive && pad !== null ? <GuitarPad input={input} title={pad === 1 ? "Instruments & more" : v.on ? `Free play · ♩ ${v.bpm}` : "Free play"} rows={pages[pad].rows} onFire={(i) => pages[pad].fire[i]()} /> : null}
    </div>
  );
}

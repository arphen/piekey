import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { demoNow, playDemo, type DemoPlayback } from "../audio/demo";
import type { LegendDemo } from "../core/demos";
import { useKey } from "./keyContext";
import { ChordSymbol } from "./LeadSheet";

interface HoverDemoProps {
  /** the example, or a function that builds it when the card first opens */
  demo: LegendDemo | null | (() => LegendDemo | null);
  /** why there is no demo here (e.g. no scale switch into this bar) */
  emptyNote?: string;
  /** element to render: "li" for legend rows, "span" inside buttons (not focusable there) */
  as?: "li" | "span";
  className?: string;
  children: ReactNode;
}

const OPEN_DELAY = 220;
const CLOSE_DELAY = 140;
const BEATS = 8;
const CARD_W = 360;

/** Hover (or focus) an element to open a card that plays a short sax example of the idea. */
export function HoverDemo({ demo: demoProp, emptyNote, as: Tag = "span", className = "hd-inline", children }: HoverDemoProps) {
  const key = useKey();
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [beat, setBeat] = useState(-1);
  const anchor = useRef<HTMLElement>(null);
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();
  const playback = useRef<DemoPlayback | null>(null);
  const raf = useRef<number>();
  const open = pos !== null;
  const [demo, setDemo] = useState<LegendDemo | null>(null);
  const resolve = useCallback(() => (typeof demoProp === "function" ? demoProp() : demoProp), [demoProp]);

  const stopAudio = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    playback.current?.stop();
    playback.current = null;
    setBeat(-1);
  }, []);

  const play = useCallback(async (d: LegendDemo | null) => {
    if (!d) return;
    stopAudio();
    const pb = await playDemo(d, key);
    playback.current = pb;
    const tick = () => {
      if (playback.current !== pb) return;
      const b = (demoNow() - pb.startAt) / pb.secPerBeat;
      if (b > BEATS + 0.5) {
        setBeat(-1);
        return;
      }
      setBeat(b);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [key, stopAudio]);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    if (open) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const below = r.top < 300;
      const x = Math.max(12, Math.min(r.left - 8, window.innerWidth - CARD_W - 12));
      const d = resolve();
      setDemo(d);
      setPos({ x, y: below ? r.bottom + 10 : r.top - 10, below });
      // Browsers only allow sound after the page has been clicked once; until then the card offers a play button.
      const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
      if (activated) void play(d);
    }, OPEN_DELAY);
  };
  const hideNow = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setPos(null);
    stopAudio();
  }, [stopAudio]);
  const hide = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(hideNow, CLOSE_DELAY);
  };

  useEffect(() => hideNow, [hideNow]);

  // the card is fixed-positioned: close it rather than let it drift when the page scrolls
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hideNow, true);
    return () => window.removeEventListener("scroll", hideNow, true);
  }, [open, hideNow]);

  const focusable = Tag === "li";
  return (
    <Tag
      ref={anchor as never}
      className={`hover-demo ${className} ${open ? "is-open" : ""}`}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={focusable ? show : undefined}
      onBlur={focusable ? hideNow : undefined}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Escape") hideNow();
        if ((e.key === "Enter" || e.key === " ") && open) {
          e.preventDefault();
          void play(demo);
        }
      }}
    >
      {children}
      {pos
        ? createPortal(
            <div
              className={`ltip ${pos.below ? "is-below" : ""}`}
              style={{ left: pos.x, top: pos.y }}
              role="tooltip"
              onMouseEnter={show}
              onMouseLeave={hide}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
            >
              {demo ? <DemoCard demo={demo} beat={beat} onPlay={() => void play(demo)} onStop={stopAudio} /> : <p className="ltip-empty">{emptyNote}</p>}
            </div>,
            document.body,
          )
        : null}
    </Tag>
  );
}

function DemoCard({ demo, beat, onPlay, onStop }: { demo: LegendDemo; beat: number; onPlay: () => void; onStop: () => void }) {
  const lo = Math.min(...demo.notes.map((n) => n.midi)) - 1;
  const hi = Math.max(...demo.notes.map((n) => n.midi)) + 1;
  const playing = beat >= 0;
  return (
    <>
      <p className="ltip-title">{demo.title}</p>
      <p className="ltip-blurb">{demo.blurb}</p>

      <div className={`ltip-roll ${playing ? "is-playing" : ""}`}>
        {demo.chords.map((c, i) => (
          <span key={i} className={`ltip-bar scale-${c.parentScale}`} style={{ left: `${i * 50}%` }}>
            <ChordSymbol symbol={c.symbol} />
          </span>
        ))}
        <div className="ltip-lane">
          {[2, 4, 6].map((b) => (
            <i key={b} className={`ltip-grid ${b === 4 ? "is-bar" : ""}`} style={{ left: `${(b / BEATS) * 100}%` }} />
          ))}
          {demo.notes.map((n, i) => {
            const sounding = beat >= n.beat && beat < n.beat + n.dur;
            const scale = demo.chords[n.beat < 4 ? 0 : 1].parentScale;
            return (
              <span
                key={i}
                className={`ltip-note role-${n.role} scale-${scale} ${n.accent ? "is-accent" : ""} ${sounding ? "is-on" : ""} ${playing && beat >= n.beat + n.dur ? "is-past" : ""}`}
                style={{
                  left: `${(n.beat / BEATS) * 100}%`,
                  width: `calc(${(n.dur / BEATS) * 100}% - 2px)`,
                  bottom: `${((n.midi - lo) / (hi - lo)) * 78}%`,
                }}
              >
                <b>{n.name}</b>
                {n.accent ? <small>{n.tag ?? n.degree}</small> : null}
              </span>
            );
          })}
          {playing ? <i className="ltip-head" style={{ left: `${(Math.min(beat, BEATS) / BEATS) * 100}%` }} /> : null}
        </div>
      </div>

      <div className="ltip-foot">
        <button type="button" className="ltip-play" onClick={playing ? onStop : onPlay} aria-label={playing ? "stop example" : "play example"}>
          {playing ? "◼︎" : "▶"}
        </button>
        <p className="ltip-listen">{demo.listen}</p>
      </div>
    </>
  );
}

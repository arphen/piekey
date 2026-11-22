import { useEffect, useId, useRef, type CSSProperties } from "react";
import type { InputApi } from "../listen/useInput";
import type { BeatSignal } from "../song/pulse";
import { useRoomRender } from "../pool/mode";
import { usePoolPublisher } from "../pool/PoolRoom";
import { RenderedWater } from "./RenderedWater";
import "../song/atmosphere.css";

const unit = (n: number) => Math.max(0, Math.min(1, n));

/** A quiet room that opens with the player. Loudness moves it; steadiness earns the colour. */
export function PracticeAtmosphere({ input, warmth, flow, playing, beat, bpm }: { input: InputApi; warmth: number; flow: number; playing: boolean; beat?: BeatSignal; bpm?: number }) {
  const room = useRef<HTMLDivElement>(null);
  const state = useRef({ warmth, flow, playing });
  state.current = { warmth, flow, playing };
  const energy = useRef<{ level: number; heard: number; played: number; wake?: () => void }>({ level: 0, heard: -Infinity, played: 0 });
  const render = useRoomRender();
  const living = render.effective === "living";
  // Inside a pool room this atmosphere publishes to the shared pool, and its canvas moves in here.
  const pooled = usePoolPublisher(room, { playing, warmth, flow, beat, bpm });

  useEffect(() => {
    if (input.status !== "listening" || input.paused) {
      energy.current.level = 0;
      energy.current.heard = -Infinity;
      return;
    }
    return input.subscribe((frame) => {
      // Reuse the shared analyser; this decoration performs no pitch or spectrum analysis.
      energy.current.level = unit(Math.sqrt(frame.rms) * 2.5);
      if (frame.rms > 0.008) {
        energy.current.heard = performance.now();
        if (state.current.playing) energy.current.wake?.();
      }
    });
  }, [input.status, input.paused, input.subscribe]);

  useEffect(() => {
    const el = room.current;
    if (!el || living) return; // the living pool draws its own breath and bloom
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    let breath = 0;
    let bloom = 0;
    let drift = 0;
    const paint = (now: number) => {
      frame = requestAnimationFrame(paint);
      if (now - last < 50) return;
      const dt = Math.min(150, now - last);
      last = now;
      const s = state.current;
      const heard = s.playing && now - energy.current.heard < 900;
      if (heard) energy.current.played += dt;
      // Listening to a demo and leaving the room open cannot warm it up.
      const warm = Math.min(unit(s.warmth), unit(energy.current.played / 150000));
      const target = heard ? Math.pow(warm, 1.6) * unit((s.flow - 0.48) / 0.44) : 0;
      bloom += (target - bloom) * (1 - Math.exp(-dt / (target > bloom ? 11000 : 14000)));
      breath += ((heard ? energy.current.level : 0) - breath) * (1 - Math.exp(-dt / 600));
      if (!media?.matches && s.playing) drift += dt / 1000;
      el.style.setProperty("--bloom", bloom.toFixed(3));
      el.style.setProperty("--breath", (media?.matches ? 0 : breath).toFixed(3));
      el.style.setProperty("--drift-x", `${(Math.sin(drift / 23) * 2).toFixed(3)}%`);
      el.style.setProperty("--drift-y", `${(Math.cos(drift / 29) * 1.5).toFixed(3)}%`);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [living]);

  return (
    <div className="practice-atmosphere" ref={room} aria-hidden="true" data-nav-skip>
      <div className="pa-dawn" />
      <div className="pa-water" />
      <div className="pa-water pa-water-colour" />
      <div className="pa-leaf" />
      {render.effective === "water" ? <RenderedWater playing={playing} warmth={warmth} flow={flow} beat={beat} level={energy} /> : null}
      <svg className="pa-current" viewBox="0 0 1600 1000" preserveAspectRatio="none">
        <g>
          <path d="M-140 900 C200 420 440 1150 850 680 S1400 550 1730 40" />
          <path d="M-140 918 C210 450 460 1160 870 700 S1420 570 1730 70" />
          <path d="M-140 937 C220 480 480 1170 890 720 S1440 590 1730 100" />
          <path d="M-140 957 C230 510 500 1180 910 740 S1460 610 1730 130" />
          <path d="M-140 978 C240 540 520 1190 930 760 S1480 630 1730 160" />
          <path d="M-140 1000 C250 570 540 1200 950 780 S1500 650 1730 190" />
        </g>
      </svg>
      {pooled ? <div className="pa-pool-slot" /> : null}
      <div className="pa-shade" />
      {/* Above the shade, at the edges of sight: the beat is felt while the eyes stay on the music. */}
      {beat?.active ? <div key={beat.serial} className={`pa-beat-resonance ${beat.counting ? "is-counting" : beat.index === 0 ? "is-downbeat" : ""}`} style={{ "--beat-decay": `${Math.min(.85, 55 / (bpm || 80))}s` } as CSSProperties}><i /><i /></div> : null}
    </div>
  );
}

const DIAL_TICKS = Array.from({ length: 72 }, (_, i) => ({
  angle: i * 5,
  major: i % 6 === 0,
  medium: i % 3 === 0,
}));

const TEMPO_STEP = 4; // as the guitar menu and the keys move it

/** A weighted sweep and resonance begin on each heard beat. Nothing loops independently. `onTempo`: quiet slower/faster steps beside the dial. */
export function BeatPulse({ beat, bpm, compact = false, onTempo }: { beat: BeatSignal; bpm?: number; compact?: boolean; onTempo?: (delta: number) => void }) {
  const active = beat.active && beat.index >= 0;
  const id = useId().replace(/:/g, "");
  const duration = 60 / (bpm || 80);
  return (
    <div
      className={`beat-pulse ${compact ? "beat-pulse--compact" : ""} ${active ? "is-active" : ""} ${beat.index === 0 ? "is-downbeat" : ""}`}
      style={{ "--beat-decay": `${Math.min(.8, duration * .95)}s`, "--beat-duration": `${duration}s`, "--swing-from": `${beat.serial % 2 ? -58 : 58}deg`, "--swing-to": `${beat.serial % 2 ? 58 : -58}deg` } as CSSProperties}
    >
      <div className="beat-pulse-dialbox">
      <div
        className="beat-pulse-face"
        role="img"
        aria-label={`${bpm ? `${bpm} beats per minute` : "Waiting for a tempo"}${active ? `, ${beat.beats} beats per bar${beat.counting ? ", count-in" : ""}` : ", pulse resting"}`}
        data-pool={compact ? undefined : "glass rock calm"}
        data-pool-anchor={compact ? undefined : "metronome"}
      >
        <svg className="beat-pulse-dial" viewBox="0 0 320 320" fill="none">
          <defs>
            <linearGradient id={`${id}-metal`} x1="24" y1="14" x2="286" y2="306" gradientUnits="userSpaceOnUse"><stop stopColor="#dbd7bc" stopOpacity=".65" /><stop offset=".34" stopColor="#9cae94" stopOpacity=".1" /><stop offset=".7" stopColor="#a8b89b" stopOpacity=".28" /><stop offset="1" stopColor="#d3ae7a" stopOpacity=".5" /></linearGradient>
            <radialGradient id={`${id}-pool`}><stop stopColor="#afc49d" stopOpacity=".05" /><stop offset=".8" stopColor="#afc49d" stopOpacity=".01" /><stop offset="1" stopColor="#afc49d" stopOpacity=".06" /></radialGradient>
          </defs>
          <circle cx="160" cy="160" r="128" fill={`url(#${id}-pool)`} stroke={`url(#${id}-metal)`} strokeWidth=".65" />
          <circle cx="160" cy="160" r="147" stroke={`url(#${id}-metal)`} strokeWidth=".55" />
          <circle cx="160" cy="160" r="151" stroke={`url(#${id}-metal)`} strokeWidth=".3" opacity=".4" />
          <g className="beat-pulse-index">
            {DIAL_TICKS.map((tick) => <path key={tick.angle} transform={`rotate(${tick.angle} 160 160)`} d={`M160 17v${tick.major ? 11 : tick.medium ? 7 : 3}`} strokeWidth={tick.major ? .9 : .55} opacity={tick.major ? .7 : tick.medium ? .4 : .22} />)}
          </g>
          <path className="beat-pulse-arc" d="M42.1 86.3A139 139 0 0 1 277.9 86.3" strokeWidth="1.2" />
          <path className="beat-pulse-horizon" d="M72 220Q160 235 248 220M87 228Q160 240 233 228M105 236Q160 243 215 236" stroke={`url(#${id}-metal)`} strokeWidth=".55" />
          <path d="M156 259h8M160 255v8" stroke={`url(#${id}-metal)`} strokeWidth=".7" />
        </svg>
        {active ? <span className="beat-pulse-resonance" key={`r${beat.serial}`}><i /><i /><i /></span> : null}
        <span className={`beat-pulse-swing ${active ? "is-moving" : ""}`} key={active ? `s${beat.serial}` : "rest"}><i /><b /></span>
        <span className="beat-pulse-position">{active ? beat.counting ? "COUNT IN" : String(beat.index + 1).padStart(2, "0") : "TEMPO"}</span>
        <span className="beat-pulse-number">{bpm || "—"}</span>
        <span className="beat-pulse-unit">beats / min</span>
      </div>
      {onTempo ? (
        <>
          <button type="button" className="beat-pulse-step is-slower" aria-label={`${TEMPO_STEP} beats per minute slower`} title="Slower" onClick={() => onTempo(-TEMPO_STEP)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
          </button>
          <button type="button" className="beat-pulse-step is-faster" aria-label={`${TEMPO_STEP} beats per minute faster`} title="Faster" onClick={() => onTempo(TEMPO_STEP)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8M8 4v8" /></svg>
          </button>
        </>
      ) : null}
      </div>
      <ol className="beat-pulse-dots" aria-hidden="true" data-pool="calm">
        {Array.from({ length: beat.beats }, (_, i) => <li key={i} className={`${active && i === beat.index ? "is-now" : ""} ${i === 0 ? "is-accent" : ""}`}><i key={active && i === beat.index ? beat.serial : "rest"} /><span>{i + 1}</span></li>)}
      </ol>
    </div>
  );
}

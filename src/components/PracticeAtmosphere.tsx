import { useEffect, useRef, type CSSProperties } from "react";
import type { InputApi } from "../listen/useInput";
import type { BeatSignal } from "../song/pulse";
import "../song/atmosphere.css";

const unit = (n: number) => Math.max(0, Math.min(1, n));

/** A quiet room that opens with the player. Loudness moves it; steadiness earns the colour. */
export function PracticeAtmosphere({ input, warmth, flow, playing }: { input: InputApi; warmth: number; flow: number; playing: boolean }) {
  const room = useRef<HTMLDivElement>(null);
  const state = useRef({ warmth, flow, playing });
  state.current = { warmth, flow, playing };
  const energy = useRef({ level: 0, heard: -Infinity, played: 0 });

  useEffect(() => {
    if (input.status !== "listening" || input.paused) {
      energy.current.level = 0;
      energy.current.heard = -Infinity;
      return;
    }
    return input.subscribe((frame) => {
      // Reuse the shared analyser; this decoration performs no pitch or spectrum analysis.
      energy.current.level = unit(Math.sqrt(frame.rms) * 2.5);
      if (frame.rms > 0.008) energy.current.heard = performance.now();
    });
  }, [input.status, input.paused, input.subscribe]);

  useEffect(() => {
    const el = room.current;
    if (!el) return;
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
  }, []);

  return (
    <div className="practice-atmosphere" ref={room} aria-hidden="true" data-nav-skip>
      <div className="pa-dawn" />
      <div className="pa-water" />
      <div className="pa-water pa-water-colour" />
      <div className="pa-leaf" />
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
      <div className="pa-shade" />
    </div>
  );
}

/** Each ripple starts on a heard beat; CSS never runs an independent metronome. */
export function BeatPulse({ beat, bpm, compact = false }: { beat: BeatSignal; bpm?: number; compact?: boolean }) {
  const active = beat.active && beat.index >= 0;
  return (
    <div
      className={`beat-pulse ${compact ? "beat-pulse--compact" : ""} ${active ? "is-active" : ""} ${beat.index === 0 ? "is-downbeat" : ""}`}
      style={{ "--beat-decay": `${Math.min(0.55, 48 / (bpm || 80))}s` } as CSSProperties}
      role="img"
      aria-label={`${bpm ? `${bpm} beats per minute` : "Waiting for a tempo"}${active ? `, ${beat.beats} beats per bar${beat.counting ? ", count-in" : ""}` : ", pulse resting"}`}
    >
      <div className="beat-pulse-face" aria-hidden="true">
        {active ? <i className="beat-pulse-wave" key={beat.serial} /> : null}
        <span className="beat-pulse-number">{bpm || "—"}</span>
        <span className="beat-pulse-unit">{beat.counting && active ? "count in" : "bpm"}</span>
      </div>
      <ol className="beat-pulse-dots" aria-hidden="true">
        {Array.from({ length: beat.beats }, (_, i) => <li key={i} className={active && i === beat.index ? "is-now" : ""}><span>{i + 1}</span></li>)}
      </ol>
    </div>
  );
}

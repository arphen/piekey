import { useEffect, useId, useRef, type CSSProperties } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { createOnsets } from "../song/freeplay";
import type { BeatSignal } from "../song/pulse";
import { useRoomRender } from "../pool/mode";
import { usePoolPublisher } from "../pool/PoolRoom";
import { publishWaterDrive, useLiveAbyssalWater, wakeWaterDrive, type WaterDrive } from "./AbyssalWater";
import { RenderedWater } from "./RenderedWater";
import "../song/atmosphere.css";

const unit = (n: number) => Math.max(0, Math.min(1, n));

/** A quiet harbor room that opens with the player. Loudness, live pitch and landed notes awaken its poison-green algae; mistakes scar localized spots that clean playing heals back into bloom. */
export function PracticeAtmosphere({ input, warmth, flow, playing, hitSerial = 0, beat, bpm, decay = 0, missSerial = 0 }: { input: InputApi; warmth: number; flow?: number; playing: boolean; hitSerial?: number; beat?: BeatSignal; bpm?: number; decay?: number; missSerial?: number }) {
  const room = useRef<HTMLDivElement>(null);
  const state = useRef({ warmth, flow, playing, hitSerial, decay, missSerial });
  state.current = { warmth, flow, playing, hitSerial, decay, missSerial };
  const energy = useRef<{ level: number; heard: number; played: number; hit: number; lastHit: number; miss: number; lastMiss: number; noteX: number; noteY: number; noteHue: number; noteAt: number; wake?: () => void }>({
    level: 0, heard: -Infinity, played: 0, hit: 0, lastHit: hitSerial, miss: 0, lastMiss: missSerial, noteX: 0, noteY: 0, noteHue: 0.5, noteAt: -Infinity,
  });
  const render = useRoomRender();
  const living = render.effective === "living";
  const sharedWater = useLiveAbyssalWater();
  const drive = useRef<WaterDrive>({
    playing: playing && render.mode !== "still", level: 0, heardAt: -Infinity, flow, hitSerial, onsetSerial: 0, noteX: 0, noteY: 0, noteHue: 0.5, noteAt: -Infinity,
    beatSerial: beat?.serial ?? -1, beatIndex: beat?.index ?? -1, beatActive: Boolean(beat?.active), beatCounting: Boolean(beat?.counting),
    decay, missSerial,
  });
  drive.current.playing = playing && render.mode !== "still";
  drive.current.flow = flow;
  drive.current.hitSerial = hitSerial;
  drive.current.beatSerial = beat?.serial ?? -1;
  drive.current.beatIndex = beat?.index ?? -1;
  drive.current.beatActive = Boolean(beat?.active);
  drive.current.beatCounting = Boolean(beat?.counting);
  drive.current.decay = decay;
  drive.current.missSerial = missSerial;
  useEffect(() => publishWaterDrive(drive), []);
  useEffect(() => { if (beat?.active) wakeWaterDrive(); }, [beat?.active, beat?.serial]);
  useEffect(() => { if (decay > 0) wakeWaterDrive(); }, [decay]);
  // Inside a pool room this atmosphere publishes to the shared pool, and its canvas moves in here.
  const pooled = usePoolPublisher(room, { playing, warmth, flow, beat, bpm, decay });

  useEffect(() => {
    if (hitSerial !== energy.current.lastHit) {
      energy.current.lastHit = hitSerial;
      energy.current.hit = Math.min(1, energy.current.hit + 0.14);
      energy.current.wake?.();
      wakeWaterDrive();
    }
  }, [hitSerial]);

  useEffect(() => {
    if (missSerial !== energy.current.lastMiss) {
      energy.current.lastMiss = missSerial;
      energy.current.miss = Math.min(1, energy.current.miss * 0.35 + 0.85);
      energy.current.wake?.();
      wakeWaterDrive();
    }
  }, [missSerial]);

  useEffect(() => {
    if (input.status !== "listening" || input.paused) {
      energy.current.level = 0;
      energy.current.heard = -Infinity;
      drive.current.level = 0;
      drive.current.heardAt = -Infinity;
      return;
    }
    const detectOnset = createOnsets();
    return input.subscribe((frame) => {
      // Reuse the shared analyser & per-frame pitch cache; no extra detector runs here.
      const lvl = unit(Math.sqrt(frame.rms) * 2.5);
      energy.current.level = lvl;
      drive.current.level = lvl;
      const midi = frame.rms > 0.008 ? midiOf(frame) : null;
      const found = detectOnset({ midi, rms: frame.rms, now: frame.now });
      if (midi !== null) {
        const now = performance.now();
        energy.current.heard = now;
        drive.current.heardAt = now;
        const norm = unit((midi - 40) / 36); // E2 (0) .. E5 (1)
        const fifths = ((midi * 7) % 12) / 11; // harmonic position 0..1
        const nx = (fifths - 0.5) * 1.15;
        const ny = (norm - 0.5) * 0.72;
        energy.current.noteX = nx;
        energy.current.noteY = ny;
        energy.current.noteHue = norm;
        energy.current.noteAt = now;
        drive.current.noteX = nx;
        drive.current.noteY = ny;
        drive.current.noteHue = norm;
        drive.current.noteAt = now;
        if (found && state.current.playing) {
          drive.current.onsetSerial = (drive.current.onsetSerial ?? 0) + 1;
        }
        if (state.current.playing) {
          energy.current.wake?.();
          wakeWaterDrive();
        }
      }
    });
  }, [input.status, input.paused, input.subscribe]);

  useEffect(() => {
    const el = room.current;
    if (!el || living || (sharedWater && render.effective === "water")) {
      el?.style.setProperty("--decay", "0");
      el?.style.setProperty("--miss", "0");
      return; // WebGL water/pool draws its own breath, bloom and decay
    }
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = performance.now();
    let breath = 0;
    let bloom = 0;
    let decayLevel = 0;
    let drift = 0;
    const paint = (now: number) => {
      frame = requestAnimationFrame(paint);
      if (now - last < 50) return;
      const dt = Math.min(150, now - last);
      last = now;
      const s = state.current;
      const heard = s.playing && now - energy.current.heard < 2000;
      if (heard) energy.current.played = Math.min(45000, energy.current.played + dt);
      else energy.current.played = Math.max(0, energy.current.played - dt * 0.25);
      energy.current.hit *= Math.exp(-dt / 2400);
      energy.current.miss *= Math.exp(-dt / 1800);
      // Responsive warm-up: calm start, soaring bloom in the zone; unscored rooms (flow === undefined) reach full peak.
      const warm = Math.pow(unit(energy.current.played / 22000), 1.18);
      const quality = s.flow === undefined ? 1 : 0.52 + 0.48 * unit((s.flow - 0.25) / 0.65);
      const target = heard ? Math.min(1, warm * quality) : 0;
      bloom += (target - bloom) * (1 - Math.exp(-dt / (target > bloom ? 3400 : 11500)));
      breath += ((heard ? energy.current.level : 0) - breath) * (1 - Math.exp(-dt / 550));
      const decayTarget = unit(s.decay);
      decayLevel += (decayTarget - decayLevel) * (1 - Math.exp(-dt / (decayTarget > decayLevel ? 550 : 2800)));
      if (!media?.matches) drift += (dt / 1000) * (s.playing ? 0.45 + bloom * 1.15 : 0.25);
      const zone = Math.pow(unit(bloom), 1.55);
      el.style.setProperty("--bloom", zone.toFixed(3));
      el.style.setProperty("--breath", (media?.matches ? 0 : breath * (0.25 + 0.75 * bloom)).toFixed(3));
      el.style.setProperty("--hit", (media?.matches ? 0 : energy.current.hit * bloom).toFixed(3));
      el.style.setProperty("--decay", decayLevel.toFixed(3));
      el.style.setProperty("--miss", (media?.matches ? 0 : energy.current.miss).toFixed(3));
      el.style.setProperty("--drift-x", `${(Math.sin(drift / 22) * 2.2).toFixed(3)}%`);
      el.style.setProperty("--drift-y", `${(Math.cos(drift / 27) * 1.8).toFixed(3)}%`);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [living, sharedWater, render.effective]);

  return (
    <div className="practice-atmosphere" ref={room} aria-hidden="true" data-nav-skip>
      <div className="pa-dawn" />
      <div className="pa-water" />
      <div className="pa-water pa-water-colour" />
      <div className="pa-decay" />
      <div className="pa-leaf" />
      {render.effective === "water" && !sharedWater ? <RenderedWater playing={playing} warmth={warmth} flow={flow} hitSerial={hitSerial} beat={beat} level={energy} /> : null}
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
      {beat?.active ? <div key={beat.serial} className={`pa-beat-resonance ${beat.counting ? "is-counting" : beat.index === 0 ? "is-downbeat" : ""}`} style={{ "--beat-decay": `${Math.min(.85, 55 / (bpm || 80))}s` } as CSSProperties}><b /><i /><i /></div> : null}
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

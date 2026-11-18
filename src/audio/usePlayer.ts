import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import type { Mix, PatternStep, PlayerApi, PlayerState, Tune } from "../core/contract";
import { generateBacking } from "./backing";
import { ensureAudio } from "./context";
import { BufferPluck } from "./pluck";
import { bassBuffer, clickBuffer, hatBuffer, keysBuffer, kickBuffer, OneShots, rideBuffer } from "./samples";

const clampBpm = (n: number) => Math.max(40, Math.min(200, Math.round(n)));
const db = (g: number, offset = 0) => (g <= 0.001 ? -Infinity : 20 * Math.log10(g) + offset);

interface Engine {
  vol: Record<keyof Mix, Tone.Volume>;
  shots: OneShots;
  pluck: BufferPluck;
  pluckVol: Tone.Volume;
  dispose(): void;
}

const MIX_OFFSET: Record<keyof Mix, number> = { click: -6, bass: -4, comp: -12, drums: -14 };

// Every instrument is a pre-rendered buffer (see samples.ts): between notes the audio graph is
// just these five volume buses, so a looping backing costs almost nothing when it's quiet.
function createEngine(mix: Mix): Engine {
  const vol = {
    click: new Tone.Volume(db(mix.click, MIX_OFFSET.click)).toDestination(),
    bass: new Tone.Volume(db(mix.bass, MIX_OFFSET.bass)).toDestination(),
    comp: new Tone.Volume(db(mix.comp, MIX_OFFSET.comp)).toDestination(),
    drums: new Tone.Volume(db(mix.drums, MIX_OFFSET.drums)).toDestination(),
  };
  const pluckVol = new Tone.Volume(-8).toDestination();
  const shots = new OneShots();
  const nodes: Tone.ToneAudioNode[] = [...Object.values(vol), pluckVol];
  return {
    vol, shots, pluck: new BufferPluck(pluckVol), pluckVol,
    dispose() {
      shots.stopAll();
      for (const n of nodes) {
        try {
          n.dispose();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function usePlayer(tune: Tune): PlayerApi {
  const [state, setState] = useState<PlayerState>({
    ready: true, // synth-based: nothing to download
    isPlaying: false,
    bpm: 70,
    swing: 0.6,
    clickOn24: false,
    countIn: true,
    loop: { start: 0, end: Math.min(7, tune.bars.length - 1) },
    currentBar: -1,
    currentBeat: 0,
    patternStepIndex: -1,
    mix: { click: 0.7, bass: 0.8, comp: 0.7, drums: 0.7 },
  });
  const st = useRef(state);
  st.current = state;
  const tuneRef = useRef(tune);
  tuneRef.current = tune;
  const engine = useRef<Engine | null>(null);
  const pattern = useRef<{ steps: PatternStep[]; audible: boolean } | null>(null);
  const playingRef = useRef(false);
  const uiTimers = useRef(new Set<number>());

  // Run a UI update when the note at audio-clock `time` is actually heard. Plain timers, not
  // Tone.Draw: Draw keeps a requestAnimationFrame loop alive for the whole playback (there is
  // always a note inside the look-ahead), which makes the page render 60-120 frames/s nonstop.
  const uiAt = useCallback((time: number, fn: () => void) => {
    const ctx = Tone.getContext().rawContext as AudioContext;
    const ms = (time + (ctx.outputLatency || ctx.baseLatency || 0) - ctx.currentTime) * 1000;
    const id = window.setTimeout(() => {
      uiTimers.current.delete(id);
      fn();
    }, Math.max(0, ms));
    uiTimers.current.add(id);
  }, []);
  const clearUi = useCallback(() => {
    for (const id of uiTimers.current) window.clearTimeout(id);
    uiTimers.current.clear();
  }, []);

  const patch = useCallback((p: Partial<PlayerState>) => {
    st.current = { ...st.current, ...p };
    setState((s) => ({ ...s, ...p }));
  }, []);

  const schedule = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    const tr = Tone.getTransport();
    const ppq = tr.PPQ;
    const t = (beats: number) => `${Math.round(beats * ppq)}i`;
    tr.cancel(0);
    const tn = tuneRef.current;
    const loop = {
      start: Math.max(0, Math.min(st.current.loop.start, tn.bars.length - 1)),
      end: Math.max(0, Math.min(st.current.loop.end, tn.bars.length - 1)),
    };
    if (loop.end < loop.start) loop.end = loop.start;
    const nBeats = (loop.end - loop.start + 1) * 4;
    const swingSec = () => (st.current.swing * (60 / tr.bpm.value)) / 6;

    // beats 0..3 = count-in bar; loop region starts at beat 4
    for (let i = 0; i < nBeats + 4; i++) {
      const inCount = i < 4;
      const k = i % 4;
      const bar = inCount ? loop.start : loop.start + Math.floor((i - 4) / 4);
      tr.schedule((time) => {
        const s = st.current;
        const audible = inCount || !s.clickOn24 || k === 1 || k === 3;
        if (audible) e.shots.play(clickBuffer(k === 0), e.vol.click, time, k === 0 ? 0.9 : 0.55);
        uiAt(time, () => patch({ currentBar: bar, currentBeat: k }));
      }, t(i));
    }

    const backing = generateBacking(tn, loop);
    // render the buffers this loop needs now, not inside the audio callbacks
    for (const ev of backing) {
      if (ev.kind === "bass") bassBuffer(ev.midis[0]);
      if (ev.kind === "comp") ev.midis.forEach(keysBuffer);
    }
    for (const step of pattern.current?.steps ?? []) e.pluck.prepare(step.midi);

    for (const ev of backing) {
      const at = t(ev.beat + 4);
      tr.schedule((time) => {
        const tt = time + (ev.off ? swingSec() : 0);
        const dur = ev.durBeats * (60 / tr.bpm.value);
        switch (ev.kind) {
          case "bass":
            e.shots.play(bassBuffer(ev.midis[0]), e.vol.bass, tt, ev.vel, dur, 0.15);
            break;
          case "comp":
            for (const m of ev.midis) e.shots.play(keysBuffer(m), e.vol.comp, tt, ev.vel, dur * 0.8, 0.3);
            break;
          case "ride":
            e.shots.play(rideBuffer(), e.vol.drums, tt, ev.vel * 0.5);
            break;
          case "hat":
            e.shots.play(hatBuffer(), e.vol.drums, tt, ev.vel);
            break;
          case "kick":
            e.shots.play(kickBuffer(), e.vol.drums, tt, ev.vel);
            break;
        }
      }, at);
    }

    const pat = pattern.current;
    if (pat) {
      pat.steps.forEach((step, idx) => {
        if (step.startBeat >= nBeats) return;
        const off = Math.abs((step.startBeat % 1) - 0.5) < 1e-6;
        tr.schedule((time) => {
          const tt = time + (off ? swingSec() : 0);
          if (pat.audible) {
            try {
              e.pluck.trigger(step.midi, tt);
            } catch {
              /* ignore */
            }
          }
          uiAt(tt, () => patch({ patternStepIndex: idx }));
        }, t(step.startBeat + 4));
      });
    }

    tr.loop = true;
    tr.loopStart = t(4);
    tr.loopEnd = t(nBeats + 4);
  }, [patch, uiAt]);

  const stop = useCallback(() => {
    if (!playingRef.current && !engine.current) return;
    playingRef.current = false;
    const tr = Tone.getTransport();
    tr.stop();
    tr.cancel(0);
    clearUi();
    engine.current?.shots.stopAll();
    patch({ isPlaying: false, currentBar: -1, currentBeat: 0, patternStepIndex: -1 });
  }, [patch, clearUi]);

  const play = useCallback(async () => {
    if (playingRef.current) return;
    ensureAudio();
    await Tone.start();
    if (!engine.current) engine.current = createEngine(st.current.mix);
    const tr = Tone.getTransport();
    tr.bpm.value = st.current.bpm;
    schedule();
    tr.position = st.current.countIn ? "0i" : `${4 * tr.PPQ}i`;
    playingRef.current = true;
    patch({ isPlaying: true, patternStepIndex: -1 });
    tr.start();
  }, [patch, schedule]);

  const toggle = useCallback(async () => {
    if (playingRef.current) stop();
    else await play();
  }, [play, stop]);

  const restartIfPlaying = useCallback(() => {
    if (!playingRef.current) return;
    schedule();
    Tone.getTransport().position = `${4 * Tone.getTransport().PPQ}i`;
  }, [schedule]);

  const setBpm = useCallback((bpm: number) => {
    const b = clampBpm(bpm);
    patch({ bpm: b });
    if (engine.current) Tone.getTransport().bpm.value = b;
  }, [patch]);
  const setSwing = useCallback((swing: number) => patch({ swing: Math.max(0, Math.min(1, swing)) }), [patch]);
  const setClickOn24 = useCallback((clickOn24: boolean) => patch({ clickOn24 }), [patch]);
  const setCountIn = useCallback((countIn: boolean) => patch({ countIn }), [patch]);
  const setLoop = useCallback((start: number, end: number) => {
    const max = tuneRef.current.bars.length - 1;
    const s = Math.max(0, Math.min(start, max));
    const e = Math.max(s, Math.min(end, max));
    patch({ loop: { start: s, end: e } });
    restartIfPlaying();
  }, [patch, restartIfPlaying]);
  const setMix = useCallback((m: Partial<Mix>) => {
    const mix = { ...st.current.mix, ...m };
    patch({ mix });
    const e = engine.current;
    if (e) for (const k of Object.keys(m) as (keyof Mix)[]) e.vol[k].volume.value = db(mix[k], MIX_OFFSET[k]);
  }, [patch]);
  const setPattern = useCallback((steps: PatternStep[] | null, audible: boolean) => {
    pattern.current = steps && steps.length ? { steps, audible } : null;
    patch({ patternStepIndex: -1 });
    if (playingRef.current) schedule();
  }, [patch, schedule]);

  // a different tune (key or harmony level): stop; the next play() rebuilds the schedule
  const lastTune = useRef(tune);
  useEffect(() => {
    if (lastTune.current === tune) return;
    lastTune.current = tune;
    if (playingRef.current) stop();
    const max = tune.bars.length - 1;
    const l = st.current.loop;
    if (l.end > max) patch({ loop: { start: Math.min(l.start, max), end: max } });
  }, [tune, stop, patch]);

  useEffect(
    () => () => {
      playingRef.current = false;
      const tr = Tone.getTransport();
      tr.stop();
      tr.cancel(0);
      clearUi();
      engine.current?.dispose();
      engine.current = null;
    },
    [clearUi],
  );

  return useMemo(
    () => ({ ...state, play, stop, toggle, setBpm, setSwing, setClickOn24, setCountIn, setLoop, setMix, setPattern }),
    [state, play, stop, toggle, setBpm, setSwing, setClickOn24, setCountIn, setLoop, setMix, setPattern],
  );
}

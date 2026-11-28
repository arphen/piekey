import * as Tone from "tone";
import type { KeyInfo } from "../core/contract";
import type { LegendDemo } from "../core/demos";
import { compVoicing } from "./backing";
import { ensureAudio } from "./context";
import { attachRoomBus } from "./room";
import { bassBuffer, keysBuffer, OneShots, rideBuffer } from "./samples";

// One-shot "warm horn over a studio trio" for legend demos. Runs on raw context time, not the
// Transport, so it never disturbs the practice player's schedule.

export const DEMO_BPM = 112;

interface DemoEngine {
  horn: Tone.MonoSynth;
  shots: OneShots;
  out: Tone.Volume;
  nodes: Tone.ToneAudioNode[];
  detachRoom(): void;
}

let engine: DemoEngine | null = null;

function getEngine(): DemoEngine {
  if (engine) return engine;
  const out = new Tone.Volume(-5).toDestination();
  const detachRoom = attachRoomBus(out, 0.24);
  const vibrato = new Tone.Vibrato({ frequency: 5.0, depth: 0.042 }).connect(out);
  const formant = new Tone.Filter({ frequency: 1250, type: "peaking", Q: 1.4, gain: 3.5 }).connect(vibrato);
  const warmth = new Tone.Filter({ frequency: 2150, type: "lowpass", rolloff: -24 }).connect(formant);
  const horn = new Tone.MonoSynth({
    portamento: 0.03,
    oscillator: { type: "fatsawtooth", count: 2, spread: 8 },
    filter: { Q: 1.8, type: "lowpass", rolloff: -24 },
    envelope: { attack: 0.055, decay: 0.24, sustain: 0.72, release: 0.16 },
    filterEnvelope: { attack: 0.06, decay: 0.28, sustain: 0.52, release: 0.22, baseFrequency: 340, octaves: 2.3 },
    volume: -11,
  }).connect(warmth);
  const shots = new OneShots();
  engine = { horn, shots, out, nodes: [horn, warmth, formant, vibrato, out], detachRoom };
  return engine;
}

export interface DemoPlayback {
  /** context time of beat 0 */
  startAt: number;
  secPerBeat: number;
  stop(): void;
}

const note = (m: number) => Tone.Frequency(m, "midi").toNote();

export async function playDemo(demo: LegendDemo, key: KeyInfo): Promise<DemoPlayback> {
  ensureAudio();
  await Tone.start();
  const e = getEngine();
  const spb = 60 / DEMO_BPM;
  const swing = spb / 6;
  const t0 = Tone.now() + 0.12;
  const at = (beat: number) => t0 + beat * spb + (beat % 1 === 0.5 ? swing : 0);

  // Pre-warm trio buffers before scheduling
  rideBuffer();
  for (const chord of demo.chords) {
    for (const m of compVoicing(chord, key)) keysBuffer(m);
    for (const pc of [chord.rootPc, chord.chordTones[2] ?? chord.rootPc, chord.guideTones[0]]) {
      bassBuffer(36 + ((pc - 36) % 12 + 12) % 12);
    }
  }

  demo.chords.forEach((chord, bar) => {
    const base = bar * 4;
    const voicing = compVoicing(chord, key);
    voicing.forEach((m, idx) => {
      e.shots.play(keysBuffer(m), e.out, at(base) + idx * 0.014, 0.24, spb * 0.85, 0.24);
      e.shots.play(keysBuffer(m), e.out, at(base + 1.5) + idx * 0.012, 0.19, spb * 0.48, 0.22);
    });
    const bassPcs = [chord.rootPc, chord.chordTones[2] ?? chord.rootPc, chord.guideTones[0], chord.rootPc];
    bassPcs.forEach((pc, k) => {
      const m = 36 + ((pc - 36) % 12 + 12) % 12;
      e.shots.play(bassBuffer(m), e.out, at(base + k), k === 0 ? 0.62 : 0.48, spb * 0.88, 0.14);
    });
    for (let k = 0; k < 4; k++) {
      e.shots.play(rideBuffer(), e.out, at(base + k), k % 2 ? 0.34 : 0.26, undefined, 0.08, { pan: 0.2 });
      if (k % 2) e.shots.play(rideBuffer(), e.out, at(base + k + 0.5), 0.18, undefined, 0.08, { pan: 0.22 });
    }
  });

  for (const n of demo.notes) {
    const start = at(n.beat);
    const end = at(n.beat + n.dur);
    e.horn.triggerAttackRelease(note(n.midi), Math.max(0.08, end - start - 0.03), start, n.accent ? 0.92 : 0.68);
  }

  return {
    startAt: t0,
    secPerBeat: spb,
    stop() {
      // Scheduled notes live on this engine's nodes: fade out and throw the engine away.
      if (engine === e) engine = null;
      e.shots.stopAll(0.04);
      e.out.volume.rampTo(-60, 0.06);
      window.setTimeout(() => {
        e.detachRoom();
        for (const n of e.nodes) {
          try {
            n.dispose();
          } catch {
            /* ignore */
          }
        }
      }, 120);
    },
  };
}

export const demoNow = () => Tone.now();

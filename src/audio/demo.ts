import * as Tone from "tone";
import type { KeyInfo } from "../core/contract";
import type { LegendDemo } from "../core/demos";
import { compVoicing } from "./backing";
import { ensureAudio } from "./context";

// One-shot "sax over a trio" for legend demos. Runs on raw context time, not the
// Transport, so it never disturbs the practice player's schedule.

export const DEMO_BPM = 112;

interface DemoEngine {
  sax: Tone.MonoSynth;
  bass: Tone.MonoSynth;
  comp: Tone.PolySynth;
  ride: Tone.NoiseSynth;
  out: Tone.Volume;
  nodes: Tone.ToneAudioNode[];
}

let engine: DemoEngine | null = null;

function getEngine(): DemoEngine {
  if (engine) return engine;
  const out = new Tone.Volume(-6).toDestination();
  const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.22 }).connect(out);
  const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.07 }).connect(reverb);
  const breath = new Tone.Filter({ frequency: 3200, type: "lowpass", rolloff: -24 }).connect(vibrato);
  const sax = new Tone.MonoSynth({
    portamento: 0.025,
    oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
    filter: { Q: 2.5, type: "lowpass", rolloff: -24 },
    envelope: { attack: 0.04, decay: 0.2, sustain: 0.75, release: 0.12 },
    filterEnvelope: { attack: 0.05, decay: 0.25, sustain: 0.55, release: 0.2, baseFrequency: 380, octaves: 2.8 },
    volume: -10,
  }).connect(breath);
  const bass = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    filter: { Q: 1, type: "lowpass", rolloff: -12 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.15 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.2, baseFrequency: 150, octaves: 2.5 },
    volume: -6,
  }).connect(out);
  const comp = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 1.5,
    envelope: { attack: 0.005, decay: 0.5, sustain: 0.1, release: 0.3 },
    modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.3 },
    volume: -20,
  }).connect(reverb);
  const rideBand = new Tone.Filter({ frequency: 6500, type: "bandpass", Q: 0.8 }).connect(out);
  const ride = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.1 }, volume: -24 }).connect(rideBand);
  engine = { sax, bass, comp, ride, out, nodes: [sax, bass, comp, ride, rideBand, breath, vibrato, reverb, out] };
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

  demo.chords.forEach((chord, bar) => {
    const base = bar * 4;
    const v = compVoicing(chord, key).map(note);
    e.comp.triggerAttackRelease(v, spb * 0.8, at(base), 0.5);
    e.comp.triggerAttackRelease(v, spb * 0.4, at(base + 1.5), 0.42);
    const bassPcs = [chord.rootPc, chord.chordTones[2] ?? chord.rootPc, chord.guideTones[0], chord.rootPc];
    bassPcs.forEach((pc, k) => {
      const m = 36 + ((pc - 36) % 12 + 12) % 12;
      e.bass.triggerAttackRelease(note(m), spb * 0.85, at(base + k), k === 0 ? 0.9 : 0.7);
    });
    for (let k = 0; k < 4; k++) {
      e.ride.triggerAttackRelease(0.2, at(base + k), k % 2 ? 0.35 : 0.28);
      if (k % 2) e.ride.triggerAttackRelease(0.15, at(base + k + 0.5), 0.18);
    }
  });

  for (const n of demo.notes) {
    const start = at(n.beat);
    const end = at(n.beat + n.dur);
    e.sax.triggerAttackRelease(note(n.midi), Math.max(0.08, end - start - 0.03), start, n.accent ? 0.95 : 0.7);
  }

  return {
    startAt: t0,
    secPerBeat: spb,
    stop() {
      // Scheduled notes live on this engine's nodes: fade out and throw the engine away.
      if (engine === e) engine = null;
      e.out.volume.rampTo(-60, 0.06);
      window.setTimeout(() => {
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

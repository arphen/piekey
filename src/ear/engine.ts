import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { BufferPluck } from "../audio/pluck";
import { voiceProgression, type Voicing } from "./theory";

export type Instrument = "keys" | "guitar";

export interface PlayEvent {
  /** seconds from start */
  at: number;
  dur: number;
  voicing: Voicing;
  /** answer slot this chord belongs to, -1 for context (cadence, home reference) */
  slot: number;
  bassOnly?: boolean;
}

export interface Phrase {
  ids: string[];
  /** slot index of ids[0]; -1 marks the phrase as context */
  slotBase: number;
  /** relative chord length (1 = one chord at the current tempo) */
  len?: number;
  bassOnly?: boolean;
  /** silence after the phrase, in chord lengths */
  gap?: number;
}

/** Lay phrases end to end with continuous voice leading across them. */
export function buildEvents(phrases: Phrase[], keyPc: number, secPerChord: number): PlayEvent[] {
  const out: PlayEvent[] = [];
  let t = 0;
  let prev: Voicing | undefined;
  for (const p of phrases) {
    const len = (p.len ?? 1) * secPerChord;
    const voicings = voiceProgression(p.ids, keyPc, prev);
    voicings.forEach((v, i) => {
      out.push({ at: t, dur: len, voicing: v, slot: p.slotBase < 0 ? -1 : p.slotBase + i, bassOnly: p.bassOnly });
      t += len;
    });
    prev = voicings[voicings.length - 1];
    t += (p.gap ?? 0) * secPerChord;
  }
  return out;
}

export function totalDuration(events: PlayEvent[]): number {
  return events.reduce((m, e) => Math.max(m, e.at + e.dur), 0);
}

const freq = (m: number) => Tone.Frequency(m, "midi").toFrequency();

class Voices {
  out = new Tone.Volume(-4);
  // convolution reverb: Freeverb is 8 AudioWorklet comb filters that run nonstop
  reverb = new Tone.Reverb({ decay: 2.4, wet: 0.18 });
  bass: Tone.MonoSynth;
  keys: Tone.PolySynth;
  pluckVol = new Tone.Volume(-4);
  pluck: BufferPluck;

  constructor() {
    this.out.chain(this.reverb, Tone.getDestination());
    this.bass = new Tone.MonoSynth({
      oscillator: { type: "triangle" },
      filter: { Q: 1, type: "lowpass", rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.6, release: 0.3 },
      filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.5, release: 0.3, baseFrequency: 180, octaves: 2.2 },
      volume: -3,
    }).connect(this.out);
    this.keys = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 1.6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.008, decay: 1.4, sustain: 0.32, release: 0.9 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.004, decay: 0.5, sustain: 0.15, release: 0.6 },
      volume: -14,
    }).connect(this.out);
    this.keys.maxPolyphony = 24;
    this.pluckVol.connect(this.out);
    this.pluck = new BufferPluck(this.pluckVol, false);
  }

  strum(notes: number[], time: number, spread: number, vel: number) {
    notes.forEach((m, i) => this.pluck.trigger(m, time + i * spread, vel));
  }

  dispose() {
    for (const n of [this.bass, this.keys, this.pluckVol, this.reverb, this.out]) n.dispose();
  }
}

/**
 * Small lookahead scheduler on top of the audio clock, so playback can be stopped instantly
 * without touching the shared Tone transport the practice player uses.
 */
export class EarEngine {
  private v: Voices | null = null;
  private timer: number | null = null;
  private uiTimers: number[] = [];
  private finish: (() => void) | null = null;
  instrument: Instrument = "keys";

  private async ready(): Promise<Voices> {
    ensureAudio();
    await Tone.start();
    if (!this.v) this.v = new Voices();
    return this.v;
  }

  async play(events: PlayEvent[], onSlot?: (slot: number | null) => void): Promise<void> {
    this.stop();
    const v = await this.ready();
    const t0 = Tone.now() + 0.08;
    let i = 0;
    const tick = () => {
      const horizon = Tone.now() + 0.2;
      while (i < events.length && t0 + events[i].at < horizon) {
        this.sound(v, events[i], t0 + events[i].at);
        i++;
      }
      if (i >= events.length && this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    };
    this.timer = window.setInterval(tick, 40);
    tick();
    const startMs = (t0 - Tone.now()) * 1000;
    for (const e of events) {
      this.uiTimers.push(window.setTimeout(() => onSlot?.(e.slot), startMs + e.at * 1000));
    }
    return new Promise((resolve) => {
      this.finish = () => {
        onSlot?.(null);
        resolve();
      };
      this.uiTimers.push(window.setTimeout(() => this.done(), startMs + totalDuration(events) * 1000 + 150));
    });
  }

  private done() {
    const f = this.finish;
    this.finish = null;
    f?.();
  }

  private sound(v: Voices, e: PlayEvent, time: number) {
    const hold = Math.max(0.2, e.dur - 0.06);
    v.bass.triggerAttackRelease(freq(e.voicing.bass), hold, time, 0.85);
    if (e.bassOnly) return;
    if (this.instrument === "keys") {
      e.voicing.upper.forEach((m, k) => v.keys.triggerAttackRelease(freq(m), hold, time + k * 0.009, 0.7));
    } else {
      // down-strum on the chord, a lighter up-strum halfway through longer chords
      const strings = [e.voicing.bass + 12, ...e.voicing.upper];
      v.strum(strings, time, 0.022, 0.9);
      if (e.dur >= 1) v.strum([...e.voicing.upper].reverse(), time + e.dur / 2, 0.014, 0.55);
    }
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const t of this.uiTimers) window.clearTimeout(t);
    this.uiTimers = [];
    if (this.v) {
      const now = Tone.now();
      this.v.keys.releaseAll(now);
      this.v.bass.triggerRelease(now);
    }
    this.done();
  }

  dispose() {
    this.stop();
    this.v?.dispose();
    this.v = null;
  }
}

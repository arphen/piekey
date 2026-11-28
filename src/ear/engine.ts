import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { pluckBuffer } from "../audio/pluck";
import { bassBuffer, keysBuffer, OneShots } from "../audio/samples";
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

class Voices {
  out = new Tone.Volume(-4).toDestination();
  shots = new OneShots();

  prepare(events: PlayEvent[], instrument: Instrument) {
    for (const e of events) {
      bassBuffer(e.voicing.bass);
      if (e.bassOnly) continue;
      if (instrument === "keys") {
        for (const m of e.voicing.upper) keysBuffer(m);
      } else {
        pluckBuffer(e.voicing.bass + 12);
        for (const m of e.voicing.upper) pluckBuffer(m);
      }
    }
  }

  strum(notes: number[], time: number, spread: number, vel: number, dur: number) {
    const mid = (notes.length - 1) / 2;
    notes.forEach((m, i) => {
      const pan = notes.length > 1 ? ((i - mid) / Math.max(1, mid)) * 0.16 : 0;
      this.shots.play(pluckBuffer(m), this.out, time + i * spread, vel, dur, 0.28, { pan, room: 0.26 });
    });
  }

  stop() {
    this.shots.stopAll(0.03);
  }

  dispose() {
    this.shots.stopAll(0.02);
    this.out.dispose();
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
    v.prepare(events, this.instrument);
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
    const hold = Math.max(0.24, e.dur - 0.05);
    v.shots.play(bassBuffer(e.voicing.bass), v.out, time, 0.72, hold, 0.16, { room: 0.08 });
    if (e.bassOnly) return;
    if (this.instrument === "keys") {
      const mid = (e.voicing.upper.length - 1) / 2;
      e.voicing.upper.forEach((m, k) => {
        const pan = e.voicing.upper.length > 1 ? ((k - mid) / Math.max(1, mid)) * 0.18 : 0;
        v.shots.play(keysBuffer(m), v.out, time + k * 0.014, 0.34, hold, 0.28, { pan, room: 0.28 });
      });
    } else {
      // down-strum on the chord, a lighter up-strum halfway through longer chords
      const strings = [e.voicing.bass + 12, ...e.voicing.upper];
      v.strum(strings, time, 0.022, 0.62, hold + 0.1);
      if (e.dur >= 1) v.strum([...e.voicing.upper].reverse(), time + e.dur / 2, 0.014, 0.38, hold * 0.55);
    }
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const t of this.uiTimers) window.clearTimeout(t);
    this.uiTimers = [];
    this.v?.stop();
    this.done();
  }

  dispose() {
    this.stop();
    this.v?.dispose();
    this.v = null;
  }
}

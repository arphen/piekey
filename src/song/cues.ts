import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { pluckBuffer } from "../audio/pluck";
import { bassBuffer, clickBuffer, keysBuffer, OneShots } from "../audio/samples";
import { mod } from "../musicTheory";

// Small sounds around the exercises: a soft chord under your own-pace playing, a bass note for the
// chord you're looking for, the next note when the player has gone quiet, a chime for a pass, a few
// bars of air between sessions, and (opt-in) a spoken cue for the next card.

let shots: OneShots | null = null;
let pads: OneShots | null = null; // the harmony pad, on its own so one chord can make way for the next
let out: Tone.Volume | null = null;

function ready(): { shots: OneShots; pads: OneShots; out: Tone.Volume; now: number } | null {
  try {
    ensureAudio();
    if (Tone.getContext().state !== "running") return null; // only after a click has unlocked audio
    shots ??= new OneShots();
    pads ??= new OneShots();
    out ??= new Tone.Volume(-10).toDestination();
    return { shots, pads, out, now: Tone.now() + 0.03 };
  } catch {
    return null;
  }
}

/** A quiet sustained chord: the harmony under notes played at your own pace. The chord before it dies away first, so two never ring into each other. */
export function padChord(midis: number[]) {
  const a = ready();
  if (!a) return;
  a.pads.stopAll(0.06);
  midis.forEach((m) => a.pads.play(keysBuffer(m), a.out, a.now + 0.05, 0.18));
}

export function bassHint(midi: number) {
  const a = ready();
  if (a) a.shots.play(bassBuffer(midi), a.out, a.now, 0.6, 1.6, 0.2);
}

/** The note that is waited for, quietly: for a player who has stopped. */
export function hintNote(midi: number) {
  const a = ready();
  if (a) a.shots.play(pluckBuffer(midi), a.out, a.now, 0.45, 1.4, 0.3);
}

/** A soft click to be heard `ms` from now (the output's own delay is taken off). False when that is too soon. */
export function tickIn(ms: number): boolean {
  const a = ready();
  if (!a) return false;
  const ctx = Tone.getContext().rawContext as AudioContext;
  const lead = ms / 1000 - (ctx.outputLatency ?? 0.02);
  if (lead < 0.01) return false;
  a.shots.play(clickBuffer(false), a.out, ctx.currentTime + lead, 0.5);
  return true;
}

export function chime(good: boolean) {
  const a = ready();
  if (!a) return;
  const notes = good ? [76, 79, 84] : [64, 60];
  notes.forEach((m, i) => a.shots.play(pluckBuffer(m), a.out, a.now + i * 0.09, good ? 0.5 : 0.3, 1.2, 0.3));
}

/** Two high notes, barely there: a take that came out clean. */
export function glint() {
  const a = ready();
  if (a) [84, 91].forEach((m, i) => a.shots.play(pluckBuffer(m), a.out, a.now + i * 0.07, 0.22, 0.9, 0.3));
}

/** A quiet rising fifth when a clean pass lifts the tempo a notch. */
export function lift() {
  const a = ready();
  if (a) [79, 86].forEach((m, i) => a.shots.play(pluckBuffer(m), a.out, a.now + i * 0.065, 0.2, 0.7, 0.25));
}

/**
 * A few bars of air between sessions: the home chord opened out slowly, then its fourth and
 * back. Returns how long it lasts, in ms (0 when audio isn't running).
 */
export function interlude(tonic: number, minor: boolean): number {
  const a = ready();
  if (!a) return 0;
  const root = 48 + mod(tonic - 48); // C3..B3
  const third = minor ? 3 : 4;
  const home = [0, 7, 12 + third, 19, 24 + 2];
  const away = minor ? [-4, 3, 12, 15 + 4] : [5, 12, 17 + 4, 24];
  const step = 0.16;
  let t = a.now + 0.2;
  const strum = (ivs: number[], gain: number) => {
    ivs.forEach((iv, i) => a.shots.play(pluckBuffer(root + iv), a.out, t + i * step, gain, 3.2, 0.9));
    a.shots.play(keysBuffer(root + ivs[0]), a.out, t, 0.1, 2.6, 0.8);
    t += ivs.length * step + 0.35;
  };
  strum(home, 0.34);
  strum(away, 0.26);
  strum([0, 7, 12 + third, 19, 24], 0.3);
  return Math.round((t - a.now) * 1000 + 900);
}

export function hush() {
  shots?.stopAll();
  pads?.stopAll();
}

/** Speaks a card title, chord symbols read the way a musician says them. */
export function say(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const spoken = text
      .replace(/iiø?–V–[Ii]/g, "two five one")
      .replace(/V–[Ii]/g, "five one")
      .replace(/(\d)–(\d)/g, "$1 to $2")
      .replace(/([A-G])♭/g, "$1 flat")
      .replace(/([A-G])♯/g, "$1 sharp")
      .replace(/Δ7/g, " major seven")
      .replace(/ø7/g, " half diminished")
      .replace(/m7/g, " minor seven")
      .replace(/·/g, ",")
      .replace(/–/g, " ");
    const u = new SpeechSynthesisUtterance(spoken);
    u.rate = 1.02;
    u.volume = 0.9;
    synth.speak(u);
  } catch {
    // no speech here
  }
}

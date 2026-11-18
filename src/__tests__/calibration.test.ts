import { describe, expect, it } from "vitest";
import { fitProfile, soundsLike, type StringTake } from "../listen/calibration";
import { analysePitch, choosePitch, DEFAULT_TUNING } from "../pitchDetection";

const RATE = 48000;
const OPEN = [40, 45, 50, 55, 59, 64];

/** A plucked string with a strong octave overtone, `cents` off concert pitch, `ms` after the pick. */
function frame(midi: number, cents: number, ms: number, overtone: number): Float32Array {
  const hz = 440 * 2 ** ((midi - 69 + cents / 100) / 12);
  const buf = new Float32Array(4096);
  const onset = buf.length - Math.round((ms / 1000) * RATE);
  for (let i = Math.max(0, onset); i < buf.length; i++) {
    const t = (i - onset) / RATE;
    buf[i] = 0.2 * Math.exp(-t * 2) * (Math.sin(2 * Math.PI * hz * t) + overtone * Math.sin(2 * Math.PI * 2 * hz * t + 0.6) + 0.3 * Math.sin(2 * Math.PI * 3 * hz * t));
  }
  return buf;
}

const take = (midi: number, cents: number, overtone: number): StringTake => ({
  midi,
  frames: Array.from({ length: 40 }, (_, k) => analysePitch(frame(midi, cents, 25 * (k + 1), overtone), RATE)),
});

describe("calibration", () => {
  it("measures how far the guitar sits from concert pitch", () => {
    const p = fitProfile(0.0005, OPEN.map((m) => take(m, -28, 0.4)), "2026-11-14");
    expect(p.cents).toBeGreaterThan(-34);
    expect(p.cents).toBeLessThan(-22);
    expect(p.strings.every((s) => s.cents !== null && Math.abs(s.cents + 28) < 6)).toBe(true);
    expect(p.tuning.minRms).toBeGreaterThanOrEqual(0.0015);
  });

  it("fits the detector to strings with loud overtones, and never does worse than stock", () => {
    const takes = OPEN.map((m) => take(m, 0, 1.6));
    const p = fitProfile(0.0005, takes, "2026-11-14");
    expect(p.clean).toBeGreaterThanOrEqual(p.cleanBefore);
    expect(p.clean).toBeGreaterThan(0.8);
  });

  it("knows the wrong string from the right one", () => {
    expect(soundsLike(take(45, 10, 0.4))).toBe(true);
    expect(soundsLike({ midi: 45, frames: take(50, 0, 0.4).frames })).toBe(false);
    expect(choosePitch(analysePitch(new Float32Array(4096), RATE), DEFAULT_TUNING).frequency).toBeNull();
  });
});

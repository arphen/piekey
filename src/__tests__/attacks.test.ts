import { describe, expect, it } from "vitest";
import { createAttacks, type Attack } from "../listen/attacks";
import { createOnsets } from "../song/freeplay";

const SR = 48000;
const HOP = 1200; // 25 ms frames, as the input delivers them
const WINDOW = 4096;

/** Plucked notes: a few ms of pick noise, then a ringing tone with overtones that decays. */
function render(notes: { ms: number; hz: number; gain?: number }[], totalMs: number, seed = 7): Float32Array {
  const out = new Float32Array(Math.ceil((totalMs / 1000) * SR));
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rand() * 0.0003; // the input's hiss
  for (const n of notes) {
    const start = Math.round((n.ms / 1000) * SR);
    const g = n.gain ?? 0.2;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR;
      const ring = Math.exp(-t / 0.6) * (Math.sin(2 * Math.PI * n.hz * t) + 0.5 * Math.sin(4 * Math.PI * n.hz * t) + 0.25 * Math.sin(6 * Math.PI * n.hz * t));
      const pick = t < 0.004 ? rand() * (1 - t / 0.004) : 0;
      out[i] += g * (ring * Math.min(1, t / 0.002) + pick);
    }
  }
  return out;
}

function run(signal: Float32Array): Attack[] {
  const detect = createAttacks();
  const found: Attack[] = [];
  for (let end = WINDOW; end <= signal.length; end += HOP) found.push(...detect({ buf: signal.slice(end - WINDOW, end), sampleRate: SR, now: (end / SR) * 1000 }));
  return found;
}

describe("attacks", () => {
  it("places each pick within a few ms, through triplets and repeated notes that still ring", () => {
    const beat = 500; // 120 bpm
    const notes = [
      { ms: 400, hz: 110 },
      ...[0, 1, 2].map((k) => ({ ms: 400 + beat + (k * beat) / 3, hz: 196 })), // triplets, one pitch
      ...[0, 1, 2].map((k) => ({ ms: 400 + 2 * beat + (k * beat) / 3, hz: [220, 247, 262][k] })),
      { ms: 400 + 3 * beat, hz: 82, gain: 0.08 }, // a softer low string
    ];
    const found = run(render(notes, 2600));
    expect(found).toHaveLength(notes.length);
    found.forEach((a, i) => expect(Math.abs(a.at - notes[i].ms)).toBeLessThan(5));
  });

  it("hears nothing in a sustained note or the input's hiss", () => {
    expect(run(render([], 1500))).toHaveLength(0);
    expect(run(render([{ ms: 300, hz: 147 }], 2500))).toHaveLength(1);
  });

  it("gives each note its attack, and the same pitch struck again in a triplet a beginning of its own", () => {
    const onsets = createOnsets();
    const attack = (at: number): Attack => ({ at, strength: 100, rise: 1 });
    const heard: { midi: number; at: number }[] = [];
    // frames every 25 ms: G struck at 1003, again at 1170 and 1336 at an even level, then A struck at
    // 1497 that the detector only hears from 1550 (the window still holds the G)
    const strikes = new Map([[1025, 1003], [1175, 1170], [1350, 1336], [1500, 1497]]);
    for (let now = 1000; now <= 1700; now += 25) {
      const midi = now < 1550 ? 55 : 57;
      const found = onsets({ midi, rms: 0.05, now, attacks: strikes.has(now) ? [attack(strikes.get(now)!)] : [] });
      if (found) heard.push(found);
    }
    expect(heard).toEqual([{ midi: 55, at: 1003 }, { midi: 55, at: 1170 }, { midi: 55, at: 1336 }, { midi: 57, at: 1497 }]);
  });
});

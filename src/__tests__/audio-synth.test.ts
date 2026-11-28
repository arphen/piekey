import { describe, expect, it } from "vitest";
import { renderPluckBuffer } from "../audio/pluck";
import { roomIrBuffer } from "../audio/room";
import {
  renderBassBuffer,
  renderClickBuffer,
  renderHarmonicBuffer,
  renderHatBuffer,
  renderKeysBuffer,
  renderKickBuffer,
  renderRideBuffer,
} from "../audio/samples";
import { detectPitchFromBuffer, frequencyToDetectedPitch } from "../pitchDetection";

function makeContext(sampleRate = 48000): BaseAudioContext {
  return {
    sampleRate,
    createBuffer(channels: number, length: number, sr: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: sr,
        duration: length / sr,
        getChannelData: (c: number) => data[c],
      } as unknown as AudioBuffer;
    },
  } as unknown as BaseAudioContext;
}

function rms(buf: Float32Array, from = 0, to = buf.length): number {
  let sum = 0;
  const lo = Math.max(0, from);
  const hi = Math.min(buf.length, to);
  for (let i = lo; i < hi; i++) sum += buf[i] * buf[i];
  return hi > lo ? Math.sqrt(sum / (hi - lo)) : 0;
}

function detectMidi(buf: Float32Array, sr: number) {
  const res = detectPitchFromBuffer(buf, sr);
  return res.frequency ? frequencyToDetectedPitch(res.frequency, res.clarity) : null;
}

function dftMagnitude(buf: Float32Array, sr: number, hz: number): number {
  let re = 0;
  let im = 0;
  const w = (Math.PI * 2 * hz) / sr;
  for (let i = 0; i < buf.length; i++) {
    const win = 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / buf.length);
    const v = buf[i] * win;
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return Math.hypot(re, im) / buf.length;
}

function assertCleanBuffer(buf: AudioBuffer, expectedChannels: number) {
  expect(buf.numberOfChannels).toBe(expectedChannels);
  let peak = 0;
  let nonFinite = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (!Number.isFinite(v)) nonFinite++;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    expect(Math.abs(ch[0])).toBeLessThan(0.01);
    expect(Math.abs(ch[ch.length - 1])).toBeLessThan(0.01);
  }
  expect(nonFinite).toBe(0);
  expect(peak).toBeGreaterThan(0.15);
  expect(peak).toBeLessThanOrEqual(1.0);
}

describe("audio synthesis buffers", () => {
  const sr = 48000;

  it("pluck stays accurately tuned across the fretboard and sustains high notes", () => {
    const ctx = makeContext(sr);
    for (const midi of [40, 45, 50, 55, 59, 64, 71, 76, 84]) {
      const buf = renderPluckBuffer(ctx, midi);
      assertCleanBuffer(buf, 2);
      const slice = buf.getChannelData(0).subarray(Math.floor(sr * 0.08), Math.floor(sr * 0.08) + 4096);
      const pitch = detectMidi(slice, sr);
      expect(pitch, `midi ${midi}`).not.toBeNull();
      expect(pitch!.midi, `midi ${midi}`).toBe(midi);
      expect(Math.abs(pitch!.cents), `cents for midi ${midi}`).toBeLessThanOrEqual(8);
    }

    // High notes should sing sweetly rather than dying out in 40 ms
    const high = renderPluckBuffer(ctx, 76).getChannelData(0);
    const early = rms(high, 0, Math.floor(sr * 0.1));
    const tail = rms(high, Math.floor(sr * 0.6), Math.floor(sr * 0.8));
    expect(tail / early).toBeGreaterThan(0.04);

    // Deterministic across renders
    const a = renderPluckBuffer(makeContext(sr), 60).getChannelData(0);
    const b = renderPluckBuffer(makeContext(sr), 60).getChannelData(0);
    expect(a[1000]).toBe(b[1000]);
  });

  it("keys and pads render warm stereo chords with organic decay", () => {
    const ctx = makeContext(sr);
    for (const midi of [48, 55, 64, 72]) {
      const keys = renderKeysBuffer(ctx, midi, false);
      assertCleanBuffer(keys, 2);
      const l = keys.getChannelData(0);
      const r = keys.getChannelData(1);
      // Stereo chorus creates genuine L/R width
      let diff = 0;
      for (let i = 2000; i < 6000; i++) diff += Math.abs(l[i] - r[i]);
      expect(diff).toBeGreaterThan(5);
      // Pitch tracks concert pitch accurately
      const pitch = detectMidi(l.subarray(Math.floor(sr * 0.08), Math.floor(sr * 0.08) + 4096), sr);
      expect(pitch?.midi).toBe(midi);
      expect(Math.abs(pitch?.cents ?? 99)).toBeLessThanOrEqual(10);
      // Decays organically instead of buzzing flat forever
      const attackRms = rms(l, Math.floor(sr * 0.02), Math.floor(sr * 0.25));
      const endRms = rms(l, Math.floor(sr * 3.1), Math.floor(sr * 3.5));
      expect(endRms).toBeLessThan(attackRms * 0.35);
    }

    // Pad swells more gently than comp keys
    const keys = renderKeysBuffer(ctx, 60, false).getChannelData(0);
    const pad = renderKeysBuffer(ctx, 60, true).getChannelData(0);
    expect(rms(pad, 0, Math.floor(sr * 0.015))).toBeLessThan(rms(keys, 0, Math.floor(sr * 0.015)));
  });

  it("upright bass tracks pitch cleanly and decays naturally", () => {
    const ctx = makeContext(sr);
    for (const midi of [38, 43, 48]) {
      const bass = renderBassBuffer(ctx, midi);
      assertCleanBuffer(bass, 1);
      const ch = bass.getChannelData(0);
      // Read steady tone after initial 60 ms finger-pluck bloom
      const pitch = detectMidi(ch.subarray(Math.floor(sr * 0.09), Math.floor(sr * 0.09) + 4096), sr);
      expect(pitch?.midi, `bass midi ${midi}`).toBe(midi);
      expect(Math.abs(pitch?.cents ?? 99), `bass cents ${midi}`).toBeLessThanOrEqual(10);
      expect(rms(ch, Math.floor(sr * 2.2), Math.floor(sr * 2.6))).toBeLessThan(rms(ch, Math.floor(sr * 0.05), Math.floor(sr * 0.3)) * 0.35);
    }
    // Lower bass strings also render cleanly
    assertCleanBuffer(renderBassBuffer(ctx, 28), 1);
    assertCleanBuffer(renderBassBuffer(ctx, 33), 1);
  });

  it("drums, woodblock click, harmonics, and studio room IR render cleanly", () => {
    const ctx = makeContext(sr);
    assertCleanBuffer(renderRideBuffer(ctx), 2);
    assertCleanBuffer(renderHatBuffer(ctx), 2);
    assertCleanBuffer(renderKickBuffer(ctx), 1);
    assertCleanBuffer(renderClickBuffer(ctx, true), 1);
    assertCleanBuffer(renderClickBuffer(ctx, false), 1);

    // Kick has strong audible punch around 55-120 Hz rather than sub-audible 32 Hz only
    const kick = renderKickBuffer(ctx).getChannelData(0);
    const kickBody = kick.subarray(Math.floor(sr * 0.01), Math.floor(sr * 0.14));
    expect(dftMagnitude(kickBody, sr, 60)).toBeGreaterThan(dftMagnitude(kickBody, sr, 32) * 2);

    // Harmonics sing accurately at high cue pitches (E5, C6, G6)
    for (const midi of [76, 84]) {
      const harm = renderHarmonicBuffer(ctx, midi);
      assertCleanBuffer(harm, 2);
      const ch = harm.getChannelData(0);
      const pitch = detectMidi(ch.subarray(Math.floor(sr * 0.05), Math.floor(sr * 0.05) + 4096), sr);
      expect(pitch?.midi, `harmonic ${midi}`).toBe(midi);
      expect(rms(ch, Math.floor(sr * 0.5), Math.floor(sr * 0.7))).toBeGreaterThan(rms(ch, 0, Math.floor(sr * 0.1)) * 0.2);
    }
    const g6 = renderHarmonicBuffer(ctx, 91);
    assertCleanBuffer(g6, 2);
    expect(dftMagnitude(g6.getChannelData(0).subarray(Math.floor(sr * 0.05), Math.floor(sr * 0.15)), sr, 1568)).toBeGreaterThan(0.05);

    // Room IR is deterministic stereo and decays cleanly
    const ir = roomIrBuffer(ctx);
    expect(ir.numberOfChannels).toBe(2);
    const irL = ir.getChannelData(0);
    const irR = ir.getChannelData(1);
    expect(rms(irL, 0, Math.floor(sr * 0.2))).toBeGreaterThan(rms(irL, Math.floor(sr * 0.9), irL.length) * 3);
    expect(irL[Math.floor(sr * 0.05)]).not.toBe(irR[Math.floor(sr * 0.05)]);
  });
});

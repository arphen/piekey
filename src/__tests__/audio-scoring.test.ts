// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inputLag, loadLatency, saveLatency } from "../audio/latency";
import { setInputSetup, setOutputSetup } from "../audio/setup";
import { loadProfile, saveProfile, type Profile } from "../listen/calibration";
import { DEFAULT_TUNING } from "../pitchDetection";
import { createOnsets } from "../song/freeplay";
import { judgePitch, timingReady, type PitchSample, type PitchWindow } from "../tunes/scoring";

const windowOf = (patch: Partial<PitchWindow> = {}): PitchWindow => ({
  midi: 60, anyOctave: false, start: 1000, end: 1500, first: false, last: false,
  before: null, lag: 50, ...patch,
});
const sample = (t: number, midi = 60, onset: number | null = null): PitchSample => ({ t, midi, onset });

describe("timed pitch scoring", () => {
  it("uses exact pitch unless any octave was explicitly selected", () => {
    expect(judgePitch([sample(1100, 72), sample(1125, 72)], windowOf()).hit).toBe(false);
    expect(judgePitch([sample(1100, 72)], windowOf({ anyOctave: true })).hit).toBe(true);
  });

  it("does not turn a sustained note into repeated untied notes", () => {
    const onsets = createOnsets();
    const samples = Array.from({ length: 60 }, (_, i) => {
      const t = i * 25;
      const onset = onsets({ midi: 60, rms: 0.04, now: t });
      return sample(t, 60, onset?.at ?? null);
    });
    expect(judgePitch(samples, windowOf({ before: 60, previousStart: 500 })).hit).toBe(false);
    expect(judgePitch([...samples, sample(1125, 60, 1100)], windowOf({ before: 60, previousStart: 500 }))).toMatchObject({ hit: true, offset: 50 });
  });

  it("assigns a fast repeated note's pick to one target despite overlapping tolerance windows", () => {
    const samples = [sample(1075, 60, 1050)];
    const first = windowOf({ end: 1062.5, after: 60, nextStart: 1062.5 });
    const next = windowOf({ start: 1062.5, end: 1125, before: 60, previousStart: 1000 });
    expect(judgePitch(samples, first).hit).toBe(true);
    expect(judgePitch(samples, next).hit).toBe(false);
    const boundaryPick = [sample(1100, 60, 1081.25)];
    expect(judgePitch(boundaryPick, first).hit).toBe(false);
    expect(judgePitch(boundaryPick, next).hit).toBe(true);
  });

  it("keeps phrase-edge leniency and allows a ringing improvisation chord tone", () => {
    expect(judgePitch([sample(775, 60, 750)], windowOf({ first: true })).hit).toBe(true);
    expect(judgePitch([sample(1850, 60, 1825)], windowOf({ last: true })).hit).toBe(true);
    expect(judgePitch([sample(1100)], windowOf({ any: [0, 4, 7], before: 60 })).hit).toBe(true);
  });
});

describe("earning a faster tempo", () => {
  it("requires enough measured onsets, a centred pulse and a consistent spread", () => {
    expect(timingReady([-250, -15, 0, 20, 300], 120, true)).toBe(true);
    expect(timingReady([-90, -90, -90, -90, -90], 120, true)).toBe(false);
    expect(timingReady([0, -100, 100, -100, 0], 120, true)).toBe(false);
    expect(timingReady([0, 0, 0, 0, null, null, null, null], 120, true)).toBe(false);
  });

  it("allows an unknown input lag until calibration measures it", () => {
    expect(timingReady([90, 90, 90, 90], 120, false)).toBe(true);
    expect(timingReady([90, 90, 90, 90], 120, true)).toBe(false);
  });
});

describe("calibration belongs to the opened hardware", () => {
  beforeEach(() => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    setInputSetup({ deviceId: "guitar", sampleRate: 48000 });
    setOutputSetup("speakers");
  });
  afterEach(() => vi.unstubAllGlobals());

  const profile: Profile = {
    v: 1, at: "2026-11-18", cents: -12, noise: 0.001, tuning: DEFAULT_TUNING,
    strings: [], cleanBefore: 0.8, clean: 0.9,
  };

  it("invalidates lag on input, output or sample-rate changes and restores it for the same path", () => {
    saveLatency(85);
    expect(inputLag()).toBe(85);
    setInputSetup({ deviceId: "built-in", sampleRate: 48000 });
    expect(inputLag()).toBe(50);
    setInputSetup({ deviceId: "guitar", sampleRate: 44100 });
    expect(loadLatency()).toBeNull();
    setInputSetup({ deviceId: "guitar", sampleRate: 48000 });
    setOutputSetup("headphones");
    expect(inputLag()).toBe(50);
    setOutputSetup("speakers");
    expect(inputLag()).toBe(85);
    const restored = JSON.parse(localStorage.getItem("guitar-latency")!);
    localStorage.setItem("guitar-latency", JSON.stringify({ ...restored, ms: 65 }));
    expect(inputLag()).toBe(65); // restoring a backup in this tab must not leave a cached old lag
  });

  it("uses the guitar's detector fit only for that input and sample rate", () => {
    saveProfile(profile);
    setInputSetup({ deviceId: "built-in", sampleRate: 48000 });
    expect(loadProfile()).toBeNull();
    setInputSetup({ deviceId: "guitar", sampleRate: 44100 });
    expect(loadProfile()).toBeNull();
    setInputSetup({ deviceId: "guitar", sampleRate: 48000 });
    expect(loadProfile()?.cents).toBe(-12);
  });

  it("does not certify legacy records without a hardware identity", () => {
    localStorage.setItem("guitar-latency", JSON.stringify({ ms: 80, at: "2026-11-15" }));
    localStorage.setItem("guitar-calibration", JSON.stringify(profile));
    expect(loadLatency()).toBeNull();
    expect(loadProfile()).toBeNull();
  });
});

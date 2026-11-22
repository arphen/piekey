// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heardTime, inputLag, loadLatency, saveLatency } from "../audio/latency";
import { setInputSetup, setOutputSetup } from "../audio/setup";
import { loadProfile, saveProfile, type Profile } from "../listen/calibration";
import { DEFAULT_TUNING } from "../pitchDetection";
import { createOnsets } from "../song/freeplay";
import { createEstimator } from "../song/estimator";
import { assessTiming, judgePitch, timingReady, type PitchSample, type PitchWindow } from "../tunes/scoring";

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
    for (const offset of [-150, 150])
      expect(judgePitch([sample(1050 + offset, 60, 1050 + offset)], windowOf({ previousStart: 250, nextStart: 1750 })).offset).toBe(offset);
  });
});

describe("earning a faster tempo", () => {
  it("lets a steady early or late alignment progress and warm equally, without changing its raw evidence", () => {
    expect(timingReady([-250, -15, 0, 20, 300], 120, true)).toBe(true);
    const warmth = (offset: number) => {
      const offsets = Array<number>(8).fill(offset);
      const timing = assessTiming(offsets, 80);
      expect(timing.ready).toBe(true);
      expect(timing.fit?.offset).toBe(offset);
      expect(timingReady(offsets, 80, false)).toBe(timingReady(offsets, 80, true));
      const estimator = createEstimator("scale");
      offsets.forEach(() => estimator.note(true));
      estimator.pass(1, Math.max(timing.fit!.spread, Math.abs(timing.fit!.drift)), 750);
      return estimator.value();
    };
    expect(warmth(-150)).toBe(warmth(0));
    expect(warmth(150)).toBe(warmth(0));
  });

  it("rejects unevenness, drift, missing attacks and ambiguous offsets despite a small average", () => {
    expect(timingReady([0, -100, 100, -100, 0], 120, true)).toBe(false);
    expect(timingReady([0, 0, 0, 0, null, null, null, null], 120, true)).toBe(false);
    expect(timingReady([-100, -70, -40, -10, 20, 50, 80, 110], 80)).toBe(false);
    for (const offset of [-750, 750]) expect(timingReady(Array<number>(8).fill(offset), 80)).toBe(false);
    expect(timingReady(Array<number>(8).fill(150), 80, true, 187.5)).toBe(false);
    expect(timingReady([150, 150], 80)).toBe(false); // too short to establish an offset
    // uneven playing is measured; attacks the detector missed are not held against the player
    expect(assessTiming([0, -100, 100, -100, 0], 120).measured).toBe(true);
    expect(assessTiming([0, 0, 0, 0, null, null, null, null], 120).measured).toBe(false);
  });

  it("reads what is heard from the native context behind Tone's wrapper, which reports no output clock", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const native = { currentTime: 10, outputLatency: 0.02, baseLatency: 0.04, getOutputTimestamp: () => ({ contextTime: 9.8, performanceTime: 950 }) };
    const wrapper = { currentTime: 10, baseLatency: 0.04, _nativeAudioContext: native } as unknown as AudioContext;
    expect(heardTime(wrapper)).toBeCloseTo(9.85); // the device's own stamp, not a 50 ms guess
    const early = { currentTime: 10, _nativeAudioContext: { ...native, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) } } as unknown as AudioContext;
    expect(heardTime(early)).toBeCloseTo(9.94); // before the stamp runs: both reported latencies
    vi.restoreAllMocks();
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
    expect(inputLag()).toBe(30);
    setInputSetup({ deviceId: "guitar", sampleRate: 44100 });
    expect(loadLatency()).toBeNull();
    setInputSetup({ deviceId: "guitar", sampleRate: 48000 });
    setOutputSetup("headphones");
    expect(inputLag()).toBe(30);
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

  it("no longer trusts a lag measured before notes were timed at their attack", () => {
    saveLatency(85);
    const measured = JSON.parse(localStorage.getItem("guitar-latency")!);
    localStorage.setItem("guitar-latency", JSON.stringify({ ...measured, method: undefined }));
    expect(loadLatency()).toBeNull();
  });
});

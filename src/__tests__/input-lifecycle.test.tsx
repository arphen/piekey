// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Tone from "tone";
import { currentInputSetup } from "../audio/setup";
import { useInput, type InputApi } from "../listen/useInput";
import { usePlayback } from "../tunes/usePlayback";
import type { Timeline } from "../tunes/order";

vi.mock("tone", () => ({
  start: vi.fn(async () => undefined),
  getContext: () => ({ rawContext: FakeContext.instances[FakeContext.instances.length - 1] }),
  Volume: class {
    volume = { rampTo() {} };
    toDestination() { return this; }
    dispose() {}
  },
}));
vi.mock("../audio/context", () => ({ ensureAudio() {} }));
vi.mock("../audio/samples", () => ({ clickBuffer() {}, OneShots: class { play() {} stopAll() {} } }));

class FakeContext {
  static instances: FakeContext[] = [];
  state: AudioContextState = "suspended";
  sampleRate = 48000;
  currentTime = 10;
  outputLatency = 0.1;
  stamp: { contextTime: number; performanceTime: number } | undefined;
  getOutputTimestamp() { return this.stamp; }
  onstatechange: (() => void) | null = null;
  // Browser resume can remain pending until a trusted gesture.
  resume() { return new Promise<void>(() => undefined); }
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() { FakeContext.instances.push(this); }
  createMediaStreamSource() { return this.node(); }
  createBiquadFilter() { return { ...this.node(), frequency: { value: 0 }, type: "highpass" }; }
  createChannelSplitter() { return this.node(); }
  createAnalyser() {
    return { ...this.node(), fftSize: 0, smoothingTimeConstant: 0, getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0.02) };
  }
  private node() { return { connect() {}, disconnect() {} }; }
}

function stream(deviceId = "guitar") {
  const track = { stop: vi.fn(), onended: null as (() => void) | null, readyState: "live", getSettings: () => ({ deviceId }) };
  return { track, value: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}

let root: Root;
let host: HTMLDivElement;
let input: InputApi;
let getUserMedia: ReturnType<typeof vi.fn>;
let playback: ReturnType<typeof usePlayback>;
const timeline: Timeline = { slots: [{ bar: 0, pass: 1, run: 0, start: 0, beats: 4 }], targets: [], comp: [], total: 4 };

function PlaybackHarness({ bpm = 120 }: { bpm?: number }) {
  playback = usePlayback(timeline, { bpm, melody: false, chords: false, click: true, countIn: true }, input, false, false);
  return null;
}

function Harness() {
  input = useInput({ fftSize: 4096, intervalMs: 25 });
  return null;
}

describe("input lifecycle", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", { getItem: () => null });
    FakeContext.instances = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("AudioContext", FakeContext);
    getUserMedia = vi.fn(async () => stream().value);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia,
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "guitar", label: "Guitar" }],
      addEventListener() {}, removeEventListener() {},
    } });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("opens without waiting forever for resume, and emits no stale frames while suspended", async () => {
    const hear = vi.fn();
    input.subscribe(hear);
    await act(async () => input.start());
    expect(input.status).toBe("listening");
    expect(input.paused).toBe(true);
    expect(currentInputSetup()).toEqual({ deviceId: "guitar", sampleRate: 48000 });
    await act(async () => vi.advanceTimersByTime(100));
    expect(hear).not.toHaveBeenCalled();
    const ctx = FakeContext.instances[0];
    await act(async () => { ctx.state = "running"; ctx.onstatechange?.(); });
    await act(async () => vi.advanceTimersByTime(50));
    expect(input.paused).toBe(false);
    expect(hear).toHaveBeenCalled();
    hear.mockClear();
    await act(async () => { ctx.state = "suspended"; ctx.onstatechange?.(); });
    await act(async () => vi.advanceTimersByTime(100));
    expect(hear).not.toHaveBeenCalled();
    expect(input.paused).toBe(true);
  });

  it("does not let an old rejected request tear down a newer open", async () => {
    let rejectFirst!: (reason: Error) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((_resolve, reject) => { rejectFirst = reject; }));
    let first!: Promise<void>;
    await act(async () => { first = input.start(); });
    await act(async () => input.start());
    const active = FakeContext.instances[1];
    await act(async () => { rejectFirst(new Error("old permission request failed")); await first; });
    expect(input.status).toBe("listening");
    expect(active.close).not.toHaveBeenCalled();
  });

  it("closes a late stream after the input was stopped", async () => {
    const late = stream();
    let resolveOpen!: (value: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((resolve) => { resolveOpen = resolve; }));
    let opening!: Promise<void>;
    await act(async () => { opening = input.start(); });
    await act(async () => input.stop());
    await act(async () => { resolveOpen(late.value); await opening; });
    expect(late.track.stop).toHaveBeenCalled();
    expect(input.status).toBe("idle");
    expect(currentInputSetup()).toBeNull();
  });

  it("keeps visual beats on the heard clock through count-in, tempo changes, loops and stop", async () => {
    const ctx = new FakeContext();
    ctx.state = "running";
    await act(async () => root.render(<PlaybackHarness />));
    await act(async () => playback.play(0, 0, true));
    const hearAt = async (time: number) => {
      await act(async () => { ctx.currentTime = time; vi.advanceTimersByTime(25); });
    };
    await hearAt(10.24); // the first scheduled click has not reached the speakers
    expect(playback.beat.active).toBe(false);
    await hearAt(10.26);
    expect(playback.beat).toMatchObject({ index: 0, active: true, counting: true });
    await act(async () => root.render(<PlaybackHarness bpm={60} />));
    ctx.stamp = { contextTime: 10.56, performanceTime: performance.now() - 100 };
    await hearAt(10.76);
    expect(playback.beat).toMatchObject({ index: 1, counting: true }); // scheduled count-in tempo stays put
    ctx.stamp = undefined;
    await act(async () => root.render(<PlaybackHarness />));
    await hearAt(12.26);
    expect(playback.beat).toMatchObject({ index: 0, active: true, counting: false });
    const first = playback.beat.serial;
    await hearAt(14.26);
    expect(playback.beat.index).toBe(0);
    expect(playback.beat.serial).toBeGreaterThan(first);
    await act(async () => root.render(<PlaybackHarness bpm={60} />));
    await hearAt(14.3);
    await hearAt(14.76);
    expect(playback.beat.index).toBe(0); // the slower beat has not sounded yet
    await hearAt(14.91);
    expect(playback.beat.index).toBe(1);
    ctx.state = "suspended";
    await hearAt(14.91);
    expect(playback.beat.active).toBe(false);
    ctx.state = "running";
    await hearAt(14.91);
    expect(playback.beat.active).toBe(false); // resuming mid-beat waits for the next beat
    await act(async () => playback.stop());
    expect(playback.beat.active).toBe(false);

    let wake!: () => void;
    vi.mocked(Tone.start).mockImplementationOnce(() => new Promise<void>((resolve) => { wake = resolve; }));
    let opening!: Promise<void>;
    await act(async () => { opening = playback.play(0, 0, true); });
    await act(async () => playback.stop());
    await act(async () => { wake(); await opening; });
    expect(playback.playing).toBe(false);
  });
});

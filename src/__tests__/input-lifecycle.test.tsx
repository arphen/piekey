// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Tone from "tone";
import { currentInputSetup } from "../audio/setup";
import { useInput, type InputApi, type InputFrame } from "../listen/useInput";
import * as sharedPitch from "../listen/pitch";
import { buildThemeCatalog } from "../song/theme";
import { useThemePicker } from "../song/useThemePicker";
import { FreePlay } from "../components/FreePlay";
import { FreePlayView } from "../components/FreePlayView";
import type { FreeView } from "../song/useFreePlay";
import * as guitarTools from "../tools/GuitarTools";
import { usePlayback } from "../tunes/usePlayback";
import type { Timeline } from "../tunes/order";

const { scheduledClicks } = vi.hoisted(() => ({ scheduledClicks: [] as { at: number; gain: number }[] }));
const { freeRoom } = vi.hoisted(() => ({ freeRoom: { view: undefined as unknown as FreeView, active: [] as boolean[] } }));

vi.mock("../song/useFreePlay", () => ({ useFreePlay: (_input: unknown, active: boolean) => {
  freeRoom.active.push(active);
  return { view: freeRoom.view, nudge() {}, cycleMode() {}, toggleBand() {} };
} }));
vi.mock("../components/Score", () => ({ Score: () => null }));
vi.mock("../components/SongCoach", () => ({ SongCoachRoom: () => null }));
vi.mock("../platform/PracticeWindowBoundary", () => ({ PracticeWindowBoundary: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../tools/GuitarTools", () => ({ GuitarToolsRoom: ({ onClose, initialTool, initialBpm }: { onClose(): void; initialTool: string; initialBpm: number }) => <div data-tool={initialTool} data-bpm={initialBpm}><button type="button" onClick={onClose}>Return to playing</button></div> }));

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
vi.mock("../audio/samples", () => ({ clickBuffer() {}, OneShots: class {
  play(_buffer: unknown, _out: unknown, at: number, gain: number) { scheduledClicks.push({ at, gain }); }
  stopAll() {}
} }));

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

function PlaybackHarness({ bpm = 120, division = 1, countIn = true, scoring = false }: { bpm?: number; division?: 1 | 2 | 3 | 4; countIn?: boolean; scoring?: boolean }) {
  playback = usePlayback(timeline, { bpm, melody: false, chords: false, click: true, countIn, clickSubdivision: division }, input, scoring, false);
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
    scheduledClicks.length = 0;
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

  it("schedules quiet subdivisions on the audio clock while the pulse follows heard quarter notes", async () => {
    const ctx = new FakeContext();
    ctx.state = "running";
    await act(async () => root.render(<PlaybackHarness division={2} countIn={false} />));
    await act(async () => playback.play(0, 0, true));
    await act(async () => { ctx.currentTime = 10.35; vi.advanceTimersByTime(25); });
    const firstBeat = playback.beat.serial;
    expect(playback.beat.index).toBe(0);
    expect(scheduledClicks.some((click) => Math.abs(click.at - 10.4) < 1e-6 && click.gain < 0.3)).toBe(true);
    await act(async () => { ctx.currentTime = 10.55; vi.advanceTimersByTime(25); });
    expect(playback.beat.serial).toBe(firstBeat); // the heard eighth-note click is between visual beats
    await act(async () => { ctx.currentTime = 10.8; vi.advanceTimersByTime(25); });
    expect(playback.beat.index).toBe(1);
    await act(async () => playback.stop());
  });

  it("reports the completed pass tempo rather than the latest playback setting", async () => {
    const ctx = new FakeContext();
    ctx.state = "running";
    await act(async () => root.render(<PlaybackHarness bpm={60} countIn={false} scoring />));
    await act(async () => playback.play(0, 0, true));
    const hearAt = async (time: number) => { await act(async () => { ctx.currentTime = time; vi.advanceTimersByTime(25); }); };
    for (const time of [10.5, 11, 11.5, 12, 12.5, 13, 13.5]) await hearAt(time);
    await act(async () => root.render(<PlaybackHarness bpm={120} countIn={false} scoring />));
    await hearAt(13.6);
    await hearAt(14.1);
    expect(playback.lastPass).toMatchObject({ bpm: 60, tempoStable: false });
    for (const time of [14.6, 15.1, 15.6, 16.1]) await hearAt(time);
    expect(playback.lastPass).toMatchObject({ bpm: 120, tempoStable: true });
  });
});

describe("explicit opening-theme input", () => {
  const opening = [60, 62, 64, 65, 67, 69, 71];
  const catalog = buildThemeCatalog([{ id: "theme", title: "Opening", tl: { slots: [], comp: [], total: 7, targets: opening.map((midi, i) => ({ midi, t: i, dur: 1, notes: [i], slot: 0, bar: 0 })) } }]);
  let picker: ReturnType<typeof useThemePicker>;
  let controlled: InputApi;
  let armed: boolean;
  let detection: number | null;
  let now: number;
  let currentStream: MediaStream;
  let mounted: boolean;
  const listeners = new Set<(frame: InputFrame) => void>();
  function ThemeHarness() { picker = useThemePicker(controlled, catalog, armed); return null; }
  const render = async () => { await act(async () => root.render(<ThemeHarness />)); };
  const feed = async (midi: number | null, frames = 3, sampleRate = 48000) => {
    detection = midi;
    await act(async () => {
      for (let i = 0; i < frames; i++) {
        const frame = { buf: new Float32Array(0), sampleRate, now: (now += 25), rms: midi === null ? 0 : 0.02 };
        for (const listener of [...listeners]) listener(frame);
      }
    });
  };
  const playOpening = async () => {
    await feed(null, 6);
    for (const midi of opening) await feed(midi);
  };

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(sharedPitch, "midiOf").mockImplementation(() => detection);
    armed = false;
    detection = null;
    now = 0;
    mounted = true;
    listeners.clear();
    currentStream = {} as MediaStream;
    controlled = {
      status: "listening", error: null, devices: [], deviceId: "guitar", paused: false,
      setDeviceId() {}, start: vi.fn(async () => undefined), stop() {}, autoStart() {}, level: { current: 0 },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      stream: () => currentStream,
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await render();
  });
  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("subscribes only when explicitly armed, ignores carry-over sustain, and retains a confirmed opening until reset", async () => {
    expect(picker.status).toBe("off");
    expect(listeners.size).toBe(0);
    armed = true;
    await render();
    expect(picker.status).toBe("listening");
    expect(controlled.start).not.toHaveBeenCalled();
    await feed(60, 30);
    expect(picker.heard).toEqual([]);
    await playOpening();
    expect(picker.candidates).toMatchObject([{ id: "theme", matchedNotes: 7 }]);
    await feed(71, 100);
    expect(picker.heard).toHaveLength(7);
    await feed(63);
    expect(picker.candidates[0].id).toBe("theme");
    await act(async () => picker.reset());
    expect(picker.heard).toEqual([]);
    expect(picker.candidates).toEqual([]);
    const stale = [...listeners][0];
    armed = false;
    await render();
    expect(listeners.size).toBe(0);
    await act(async () => stale({ buf: new Float32Array(0), sampleRate: 48000, now: ++now, rms: 0.02 }));
    expect(picker.heard).toEqual([]);
  });

  it("clears evidence on pause, device/stream/rate changes, stop and unmount", async () => {
    armed = true;
    await render();
    await playOpening();
    expect(picker.candidates).toHaveLength(1);
    controlled.paused = true;
    await render();
    expect(picker.status).toBe("waiting");
    expect(listeners.size).toBe(0);
    expect(picker.candidates).toEqual([]);
    controlled.paused = false;
    await render();
    await playOpening();
    controlled.deviceId = "other";
    await render();
    expect(picker.heard).toEqual([]);
    expect(picker.candidates).toEqual([]);
    await playOpening();
    currentStream = {} as MediaStream;
    await feed(71);
    expect(picker.heard).toEqual([]);
    expect(picker.candidates).toEqual([]);
    await playOpening();
    await feed(71, 3, 96000);
    expect(picker.heard).toEqual([]);
    expect(picker.candidates).toEqual([]);
    controlled.status = "idle";
    await render();
    expect(listeners.size).toBe(0);
    controlled.status = "listening";
    await render();
    await playOpening();
    const stale = [...listeners][0];
    await act(async () => root.unmount());
    mounted = false;
    expect(listeners.size).toBe(0);
    expect(() => stale({ buf: new Float32Array(0), sampleRate: 48000, now: ++now, rms: 0.02 })).not.toThrow();
  });
});

describe("Free play instruments boundary", () => {
  const listeners = new Set<(frame: InputFrame) => void>();
  let close: ReturnType<typeof vi.fn>;
  const render = async () => { await act(async () => root.render(<FreePlay input={input} onClose={close} onPractise={() => undefined} />)); };
  const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLButtonElement).click()); };
  const row = async (label: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes(label))!;
    await act(async () => button.click());
  };
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
    freeRoom.active.length = 0;
    freeRoom.view = {
      count: 0, written: { count: 0, midis: [] }, key: null, pattern: null, division: 2,
      on: false, bpm: 92, mood: null, beat: -1, n: 0, beatSignal: { index: -1, serial: 0, active: false, beats: 4, counting: false },
      change: null, mode: "follows", held: false, rise: { have: 0, need: 1 }, bars: 0, onGrid: null,
      timing: [], alignment: null, spread: null, trace: [], best: null, record: null, beaten: false, secs: 0,
      band: false, bandOn: true, chords: [], bar: 0, loop: null,
    };
    listeners.clear();
    close = vi.fn();
    input = {
      status: "listening", deviceId: "guitar", paused: false, error: null, devices: [], level: { current: 0 },
      subscribe(receive) { listeners.add(receive); return () => { listeners.delete(receive); }; },
      setDeviceId() {}, start: vi.fn(async () => undefined), stop() {}, autoStart() {},
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await render();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens either instrument before or during playing, suspends background input, and resumes the same room", async () => {
    expect(freeRoom.active.at(-1)).toBe(true);
    await click('[aria-label="Open tuner"]');
    expect(host.querySelector('[data-tool="tuner"]')).not.toBeNull();
    expect(freeRoom.active.at(-1)).toBe(false);
    expect(listeners.size).toBe(0);
    expect(host.querySelector('[aria-label="Open free play menu"]')).toBeNull();
    await click('[data-tool] button');
    expect(freeRoom.active.at(-1)).toBe(true);
    freeRoom.view = { ...freeRoom.view, count: 6, secs: 42 };
    await render();
    await click('[aria-label="Open metronome"]');
    expect(host.querySelector('[data-tool="metronome"]')?.getAttribute("data-bpm")).toBe("92");
    expect(freeRoom.active.at(-1)).toBe(false);
    await click('[data-tool] button');
    expect(freeRoom.active.at(-1)).toBe(true);
    expect(freeRoom.view.count).toBe(6);
    expect(close).not.toHaveBeenCalled();
    expect(input.start).not.toHaveBeenCalled();
  });

  it("removes standalone host controls while instruments own the modal and restores them on return", async () => {
    await act(async () => root.render(<FreePlayView input={input} onClose={close} />));
    expect(host.querySelector(".fp-standalone-input")).not.toBeNull();
    expect(host.querySelector('[aria-label="leave free play"]')).not.toBeNull();
    await click('[aria-label="Open metronome"]');
    expect(host.querySelector(".fp-standalone-input")).toBeNull();
    expect(host.querySelector('[aria-label="leave free play"]')).toBeNull();
    await click('[data-tool] button');
    expect(host.querySelector(".fp-standalone-input")).not.toBeNull();
    expect(host.querySelector('[aria-label="leave free play"]')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("reaches tuner and metronome through the six-string menu without leaving Free play", async () => {
    await click('[aria-label="Open free play menu"]');
    await row("Instruments & more");
    await row("Tuner");
    expect(host.querySelector('[data-tool="tuner"]')).not.toBeNull();
    await click('[data-tool] button');
    await click('[aria-label="Open free play menu"]');
    await row("Instruments & more");
    await row("Metronome");
    expect(host.querySelector('[data-tool="metronome"]')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("contains focus in the real instrument room and menu, and consumes Escape before the outer room can leave", async () => {
    const actual = await vi.importActual<typeof import("../tools/GuitarTools")>("../tools/GuitarTools");
    vi.spyOn(guitarTools, "GuitarToolsRoom").mockImplementation(actual.GuitarToolsRoom);
    const parentExit = vi.fn();
    window.addEventListener("keydown", parentExit);
    try {
      await click('[aria-label="Open metronome"]');
      expect(host.querySelector(".guitar-tools-metronome")).not.toBeNull();
      const controls = [...host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(".guitar-tools button, .guitar-tools input, .guitar-tools select")].filter((control) => !control.disabled);
      controls[0].focus();
      await act(async () => controls[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(controls.at(-1));
      await click('[aria-label="Open guitar instrument controls"]');
      const pad = host.querySelector(".ss-pad")!;
      expect(pad.contains(document.activeElement)).toBe(true);
      const rows = [...pad.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.disabled);
      rows.at(-1)!.focus();
      await act(async () => rows.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(rows[0]);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      expect(host.querySelector(".ss-pad")).toBeNull();
      expect(host.querySelector(".guitar-tools-metronome")).not.toBeNull();
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      await act(async () => window.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(host.querySelector(".guitar-tools-metronome")).toBeNull();
      expect(freeRoom.active.at(-1)).toBe(true);
      expect(parentExit).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    } finally { window.removeEventListener("keydown", parentExit); }
  });

  it("stops the real metronome on a meter change and uses the chosen count-in on the next explicit start", async () => {
    const actual = await vi.importActual<typeof import("../tools/GuitarTools")>("../tools/GuitarTools");
    vi.spyOn(guitarTools, "GuitarToolsRoom").mockImplementation(actual.GuitarToolsRoom);
    const context = new FakeContext();
    context.state = "running";
    scheduledClicks.length = 0;
    await click('[aria-label="Open metronome"]');
    await click(".guitar-tools-start");
    expect(host.querySelector(".guitar-tools-start")?.textContent).toContain("Stop click");
    expect(scheduledClicks).toHaveLength(4);
    const meter = host.querySelector<HTMLSelectElement>('[aria-label="Beats per bar"]')!;
    await act(async () => { meter.value = "3"; meter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector(".guitar-tools-start")?.textContent).toContain("Start metronome");
    expect(scheduledClicks).toHaveLength(4);
    await click(".guitar-tools-start");
    expect(scheduledClicks).toHaveLength(7); // exactly three new count-in clicks from the new timeline
    expect(freeRoom.active.at(-1)).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});

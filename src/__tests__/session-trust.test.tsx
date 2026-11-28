// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputApi, InputFrame } from "../listen/useInput";
import * as sharedPitch from "../listen/pitch";
import { buildDeck } from "../song/deck";
import { useSession, type SessionApi, type SessionOptions } from "../song/useSession";
import { parseTuneEntry } from "../tunes/library";
import { buildTimeline } from "../tunes/order";
import { STARTER_ENTRY } from "../tunes/starter";
import type { PassScore } from "../tunes/usePlayback";
import { loadStore, today } from "../song/leitner";
import * as followerHook from "../follow/useFollower";

const playback = vi.hoisted(() => ({
  playing: false, counting: 0, breathing: false, beat: null, activeTarget: -1, activeSlot: -1,
  results: [], wrong: [], lastPass: null as PassScore | null, drift: null,
  play: vi.fn(async () => undefined), stop: vi.fn(),
}));
const playbackMix = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("tone", () => ({ start: async () => undefined }));
vi.mock("../audio/context", () => ({ ensureAudio: () => undefined }));
vi.mock("../tunes/usePlayback", () => ({ usePlayback: (_tl: unknown, mix: Record<string, unknown>) => { playbackMix.current = mix; return playback; } }));
vi.mock("../song/cues", () => ({ bassHint() {}, chime() {}, glint() {}, hintNote() {}, hush() {}, lift() {}, padChord() {}, say() {} }));

describe("session assessment trust", () => {
  let root: Root;
  let host: HTMLDivElement;
  let session: SessionApi;
  let input: InputApi;
  let options: SessionOptions;
  const listeners = new Set<(frame: InputFrame) => void>();
  const sheet = parseTuneEntry(STARTER_ENTRY);
  const tl = buildTimeline(sheet);
  const deck = buildDeck(sheet, tl);
  const card = deck.cards.find((candidate) => candidate.family === "scales" && !candidate.run)!;
  const run = deck.cards.find((candidate) => candidate.run)!;
  const memory = deck.cards.find((candidate) => candidate.memory && candidate.family === "melody")!;
  function Harness() {
    session = useSession(deck, [sheet.id], input, options);
    return null;
  }
  const render = async () => { await act(async () => root.render(<Harness />)); };
  const pass = async (selected = card, details: Partial<PassScore> = {}) => {
    playback.lastPass = {
      hit: selected.last - selected.first + 1, total: selected.last - selected.first + 1, heard: 20, offset: 0,
      results: selected.tl.targets.map(() => "hit"), wrong: selected.tl.targets.map(() => null), at: selected.tl.targets.map(() => 0),
      bpm: session.bpm, tempoStable: true, ...details,
    };
    await render();
  };
  const dueMemory = async (rehearsed = false) => {
    const day = today();
    const earlier = today(new Date(Date.now() - 2 * 86400000));
    const store = loadStore(sheet.id);
    store.cards[memory.id] = { box: 2, due: day, bpm: memory.bpm, seen: 1, clean: 1, last: "clean" };
    const previous = { id: memory.id, day: earlier, result: "clean" as const, bpm: memory.bpm, share: 1, secs: 60, from: 0, to: 2, arrangementFingerprint: "memory-score" };
    store.history = rehearsed ? [previous, { ...previous, id: "mel:section:0-7", day }] : [previous];
    localStorage.setItem(`guitar-song-deck:${sheet.id}`, JSON.stringify(store));
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    input.status = "listening";
    await act(async () => session.begin([memory.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
      key: (index: number) => [...saved.keys()][index] ?? null,
      get length() { return saved.size; },
    });
    playback.lastPass = null;
    playback.playing = false;
    playback.play.mockClear();
    playback.stop.mockClear();
    listeners.clear();
    options = { arrangementFingerprint: "memory-score" };
    input = {
      status: "idle", deviceId: null, error: null, devices: [], paused: false,
      level: { current: 0 }, subscribe: (receive) => { listeners.add(receive); return () => { listeners.delete(receive); }; },
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("records self-guided activity without opening a mic, scoring or changing the card box", async () => {
    await act(async () => session.begin([card.id], true));
    expect(session.selfGuided).toBe(true);
    expect(session.paused).toBe(false);
    expect(input.start).not.toHaveBeenCalled();
    await act(async () => session.next());
    expect(session.store.cards[card.id]).toBeUndefined();
    expect(session.store.credit).toEqual({});
    expect(session.store.history).toHaveLength(1);
    expect(session.store.history![0]).toMatchObject({ conditions: { source: "self", confidence: "unknown" }, share: null, from: 0, to: 0 });
    expect(session.store.history![0].ev).toBeUndefined();
  });

  it("hears every note when direct shortcuts are disabled for either whole-tune form or improvisation", async () => {
    const whole = deck.cards.find((candidate) => candidate.step?.kind === "tune")!;
    const improv = deck.cards.find((candidate) => candidate.kind === "improv")!;
    expect(whole.run).not.toBe(true);
    let heard: number | null = null;
    let now = 0;
    vi.spyOn(sharedPitch, "midiOf").mockImplementation(() => heard);
    const feed = async (midi: number | null, frames: number) => {
      heard = midi;
      await act(async () => {
        for (let i = 0; i < frames; i++) for (const receive of [...listeners]) receive({ buf: new Float32Array(0), sampleRate: 48000, now: (now += 25), rms: midi === null ? 0 : 0.02 });
      });
    };
    input.status = "listening";
    for (const selected of [whole, run, improv, card]) {
      await act(async () => session.begin([selected.id]));
      await act(async () => session.go("pace"));
      const command = Object.values(session.keys).find((midi): midi is number => midi !== null);
      expect(command, selected.title).toBeDefined();
      await feed(null, 6);
      await feed(command!, 8);
      // Ordinary exercises still reserve shown command notes; whole tunes and improv hear them.
      expect(session.follow.heard, selected.title).toBe(selected === card ? null : command);
    }
  });

  it("keeps an away session asleep while a modal owns input, including already queued note callbacks", async () => {
    let practiceNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => practiceNow);
    input.status = "listening";
    await act(async () => session.begin([run.id]));
    await act(async () => session.go("time"));
    await act(async () => { practiceNow += 77000; vi.advanceTimersByTime(77000); });
    expect(session.away).toBe(true);
    expect(session.paused).toBe(true);
    const queued = [...listeners];
    const pitch = vi.spyOn(sharedPitch, "midiOf").mockReturnValue(60);
    options = { ...options, suspended: true };
    await render();
    const elapsed = session.elapsed();
    playback.play.mockClear();
    await act(async () => {
      for (let i = 0; i < 6; i++) {
        const frame = { buf: new Float32Array(0), sampleRate: 48000, now: performance.now() + i * 25, rms: 0.02 };
        for (const receive of [...queued, ...listeners]) receive(frame);
      }
      practiceNow += 3000;
      vi.advanceTimersByTime(3000);
    });
    expect(pitch).not.toHaveBeenCalled();
    expect(session.away).toBe(true);
    expect(session.paused).toBe(true);
    expect(session.elapsed()).toBe(elapsed);
    expect(playback.play).not.toHaveBeenCalled();
    options = { ...options, suspended: false };
    await render();
    await act(async () => {
      for (let i = 0; i < 4; i++) for (const receive of [...listeners]) receive({ buf: new Float32Array(0), sampleRate: 48000, now: performance.now() + i * 25, rms: 0.02 });
    });
    expect(session.away).toBe(false);
    expect(session.paused).toBe(false);
  });

  it("defers reconnect recovery until the modal closes and preserves an explicit pause", async () => {
    input.status = "listening";
    await act(async () => session.begin([run.id]));
    await act(async () => session.go("time"));
    input.status = "error";
    await render();
    expect(session.paused).toBe(true);
    options = { ...options, suspended: true };
    await render();
    input.status = "listening";
    await render();
    expect(session.paused).toBe(true);
    options = { ...options, suspended: false };
    await render();
    expect(session.paused).toBe(false);
    await act(async () => session.togglePause());
    options = { ...options, suspended: true };
    input.status = "error";
    await render();
    input.status = "listening";
    await render();
    options = { ...options, suspended: false };
    await render();
    expect(session.paused).toBe(true);
  });

  it("defers a completed own-pace take's transition without counting it twice", async () => {
    const results = card.tl.targets.slice(card.first, card.last + 1).map(() => "hit" as const);
    const follower = { ...session.follow, done: false, results, wrongAt: results.map(() => null), total: results.length, takeStart: 0, take: 1, restart() {} };
    await act(async () => root.unmount());
    vi.spyOn(followerHook, "useFollower").mockReturnValue(follower);
    root = createRoot(host);
    await render();
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("pace"));
    follower.done = true;
    await render();
    expect(session.takes.clean).toBe(1);
    options = { ...options, suspended: true };
    await render();
    await act(async () => vi.advanceTimersByTime(2000));
    expect(session.phase).toBe("pace");
    expect(session.takes.clean).toBe(1);
    options = { ...options, suspended: false };
    await render();
    await act(async () => vi.advanceTimersByTime(1200));
    expect(session.phase).toBe("time");
  });

  it("records measured conditions conservatively and keeps pauses distinct from an uninterrupted pass", async () => {
    options = { arrangementFingerprint: "main-score", arrangementFingerprints: new Map([[card.tuneId, "assessed-score"]]) };
    input.status = "listening";
    await render();
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    await act(async () => session.togglePause());
    await act(async () => session.togglePause());
    await pass();
    // Free Ride keeps the loop climbing; tapping Next banks the clean pass with its exact measured conditions.
    expect(session.freeRide).toBe(true);
    await act(async () => session.next());
    expect(session.store.history![0].conditions).toMatchObject({
      v: 1, source: "measured", confidence: "unknown", support: "adaptive", tempo: "adaptive", uninterrupted: false,
    });
    expect(session.store.history![0].arrangementFingerprint).toBe("assessed-score");
  });

  it("queues a finish until the current measured pass completes", async () => {
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    await act(async () => session.finishAfterPass());
    expect(session.ending).toBe(true);
    expect(session.finished).toBe(false);
    await pass();
    expect(session.phase).toBe("result");
    expect(session.outcome?.result).toBe("ok");
    await act(async () => vi.advanceTimersByTime(2700));
    expect(session.finished).toBe(true);
  });

  it("uses the learner's tempo range when restoring and adjusting an exercise", async () => {
    options = { tempoBounds: { minBpm: 30, targetBpm: 35 } };
    input.status = "listening";
    await render();
    await act(async () => session.begin([card.id]));
    expect(session.bpm).toBe(35);
    await act(async () => session.tempo(-100));
    expect(session.bpm).toBe(30);
    await act(async () => session.go("time"));
    expect(session.bpm).toBe(30);
    await act(async () => session.tempo(100));
    expect(session.bpm).toBe(35);
  });

  it("cannot turn a slow run into a clean target-tempo proof with a final tempo nudge", async () => {
    input.status = "listening";
    await act(async () => session.begin([run.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    const playedBpm = session.bpm;
    await act(async () => session.tempo(40));
    expect(session.bpm).toBeGreaterThan(playedBpm);
    // The last UI change can even arrive before the transport has scheduled a new tempo.
    await pass(run, { bpm: playedBpm, tempoStable: true });
    expect(session.outcome).toMatchObject({ result: "ok", bpm: playedBpm, conditions: { tempo: "adaptive", uninterrupted: false } });
    expect(session.store.history!.at(-1)).toMatchObject({ result: "ok", bpm: playedBpm });
    expect(session.store.cards[run.id].bestCleanBpm).toBeUndefined();
  });

  it("requires a fresh complete pass after a live lesson tempo change", async () => {
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    const before = session.bpm;
    await act(async () => session.tempo(4));
    await pass(card, { bpm: before, tempoStable: false });
    expect(session.phase).toBe("time");
    expect(session.store.history ?? []).toHaveLength(0);
    await pass(card, { bpm: before + 4, tempoStable: true });
    expect(session.bankedBpm).toBe(before + 4);
    expect(session.bpm).toBe(before + 8); // lifts into Free Ride instead of kicking the player out
    await act(async () => session.next());
    expect(session.outcome).toMatchObject({ result: "clean", bpm: before + 4 });
    expect(session.store.cards[card.id].bestCleanBpm).toBe(before + 4);
  });

  it("plays a new melody in time straight after hearing it", async () => {
    const melody = deck.cards.find((candidate) => candidate.family === "melody" && candidate.listen && candidate.pace && !candidate.fresh && !candidate.memory)!;
    input.status = "listening";
    await act(async () => session.begin([melody.id]));
    await act(async () => vi.advanceTimersByTime(1600));
    expect(session.phase).toBe("listen");
    playback.playing = true;
    await render();
    playback.playing = false;
    await render();
    expect(session.phase).toBe("time");
  });

  it("forgives a rough Pass 1 as a settle-in pass without blocking clean, slowing, or polluting evidence", async () => {
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    const start = session.bpm;
    // Pass 1 stumble: forgiven settle-in pass
    await pass(card, { hit: 4, total: 10 });
    expect(session.settling).toBe(true);
    expect(session.passes).toHaveLength(0);
    expect(session.passLog).toEqual([{ share: 0.4, settle: true, reason: "settle", bpm: start }]);
    expect(session.bpm).toBe(start);
    // Pass 2 clean: banks clean at start and climbs into Free Ride; stopping or tapping Next concludes "clean"
    await pass(card);
    expect(session.settling).toBe(false);
    expect(session.bankedBpm).toBe(start);
    await act(async () => session.next());
    expect(session.outcome).toMatchObject({ result: "clean", bpm: start });
  });

  it("warms in below prior best, climbs through it into Free Ride, and banks peak BPM safely on silence or 2 misses", async () => {
    const store = loadStore(sheet.id);
    store.cards[card.id] = { box: 2, due: today(), bpm: 104, bestCleanBpm: 100, seen: 2, clean: 2, last: "clean" };
    localStorage.setItem(`guitar-song-deck:${sheet.id}`, JSON.stringify(store));
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    expect(session.priorBest).toBe(100);
    expect(session.bpm).toBe(92); // ~8% warm-in under prior best 100
    expect(session.target).toBe(104);
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(500));
    // Clean warm-in pass climbs smoothly without kicking out
    await pass(card, { bpm: 92 });
    expect(session.phase).toBe("time");
    expect(session.bankedBpm).toBe(92);
    expect(session.bpm).toBe(96);
    // Push past prior best
    await pass(card, { bpm: 104 });
    expect(session.bankedBpm).toBe(104);
    expect(session.freeRide).toBe(true);
    expect(session.bpm).toBe(108);
    // Missing twice at the faster 108 bpm banks the 104 bpm peak as clean (zero downside to pushing!)
    await pass(card, { hit: 4, total: 10, bpm: 108 });
    expect(session.phase).toBe("time");
    expect(session.decay).toBeGreaterThan(0);
    await pass(card, { hit: 4, total: 10, bpm: 108 });
    expect(session.phase).toBe("result");
    expect(session.outcome).toMatchObject({ result: "clean", bpm: 104, priorBest: 100, newBest: true });
  });

  it("banks a Free Ride clean pass immediately on 1 silent pass and lets a fresh note dismiss intro", async () => {
    let heard: number | null = null;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(sharedPitch, "midiOf").mockImplementation(() => heard);
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    expect(session.phase).toBe("intro");
    // Feed quiet, advance past wake guard, then play a fresh steady note -> immediately leaves intro
    const send = async (midi: number | null, dt = 40) => {
      heard = midi;
      now += dt;
      await act(async () => {
        for (const receive of [...listeners]) receive({ buf: new Float32Array(0), sampleRate: 48000, now, rms: midi === null ? 0 : 0.04 });
      });
    };
    await send(null, 300);
    await send(60, 30);
    await send(60, 30);
    await send(60, 30);
    expect(session.phase).not.toBe("intro");
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(500));
    const start = session.bpm;
    await pass(card, { bpm: start });
    expect(session.bankedBpm).toBe(start);
    // One silent pass after banking concludes cleanly instead of waiting 3 passes
    await pass(card, { heard: 0 });
    expect(session.phase).toBe("result");
    expect(session.outcome).toMatchObject({ result: "clean", bpm: start });
    // Real exercise results stay visible (no 1.5 s auto-vanish or stray-note dismissal) until the player advances.
    await act(async () => vi.advanceTimersByTime(10000));
    await send(null, 400);
    await send(64, 30);
    await send(64, 30);
    await send(64, 30);
    expect(session.phase).toBe("result");
    expect(session.finished).toBe(false);
    await act(async () => session.next());
    expect(session.finished).toBe(true);
  });

  it("keeps the full band on for scale drills by default and only enables band dropouts when opted in", async () => {
    const store = loadStore(sheet.id);
    store.cards[card.id] = { box: 5, due: today(), bpm: card.goalBpm, bestCleanBpm: card.goalBpm, seen: 6, clean: 6, last: "clean" };
    localStorage.setItem(`guitar-song-deck:${sheet.id}`, JSON.stringify(store));
    options = { ...options, gap: new Set([card.id]) };
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    expect(session.gapped).toBe(false);
    expect(playbackMix.current.gap).toBeNull();

    await act(async () => session.updateSettings({ gapClick: true }));
    expect(session.gapped).toBe(true);
    expect(playbackMix.current.gap).toMatchObject({ on: 8, off: 16 });
  });

  it("accepts and excludes a blocking piece without fabricating measured attempts, and restores it cleanly", async () => {
    const blocked = deck.cards.find((c) => c.family === "melody" && c.needs)!;
    const blocker = deck.cards.find((c) => c.id === blocked.needs)!;
    input.status = "listening";
    await act(async () => session.begin([blocker.id, card.id]));
    await act(async () => session.accept());
    expect(session.phase).toBe("result");
    expect(session.outcome?.excluded).toBe(true);
    expect(session.outcome?.unlocked).toContain(blocked.title);
    expect(session.store.cards[blocker.id]).toMatchObject({ excluded: true, due: "9999-12-31", seen: 0, clean: 0 });
    expect(session.store.history ?? []).toHaveLength(0);
    // Stays on Result so the player sees what was accepted and unlocked
    await act(async () => vi.advanceTimersByTime(5000));
    expect(session.phase).toBe("result");
    await act(async () => session.next());
    expect(session.card?.id).toBe(card.id);

    await act(async () => session.restoreExcluded(blocker.id));
    expect(session.store.cards[blocker.id].excluded).toBeUndefined();
    expect(session.store.cards[blocker.id].due).toBe(today());
  });

  it("finds more exercises on keepGoing instead of saying nothing more for today when the opening is still below Box 2", async () => {
    const opening = deck.cards.find((c) => c.family === "melody" && !c.once && !c.needs)!;
    input.status = "listening";
    await act(async () => session.begin([opening.id]));
    await act(async () => session.go("time"));
    await pass(opening);
    await act(async () => session.next());
    await act(async () => session.next());
    expect(session.finished).toBe(true);
    let kept = false;
    await act(async () => { kept = session.keepGoing(); });
    expect(kept).toBe(true);
    expect(session.finished).toBe(false);
    expect(session.queue.length).toBeGreaterThan(2);
    expect(session.card?.id).not.toBe(opening.id);
  });

  it("tightens adaptive loop turnaround to continuous once a clean pass lands and supports loop override", async () => {
    const melody = deck.cards.find((candidate) => candidate.family === "melody" && !candidate.memory && !candidate.run)!;
    input.status = "listening";
    await act(async () => session.begin([melody.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    expect(session.loopMode).toBe("adaptive");
    expect(playbackMix.current.breath).toBe(true); // Box 0 starts with live-band turnaround
    await act(async () => session.setLoopMode("continuous"));
    expect(playbackMix.current.breath).toBe(false);
    await act(async () => session.setLoopMode("turnaround"));
    expect(playbackMix.current.breath).toBe(true);
    await act(async () => session.setLoopMode("adaptive"));
    // Lower bpm below target; first pass after manual tempo change establishes the new tempo,
    // then the next clean pass locks adaptive loop into continuous mode while climbing.
    await act(async () => session.tempo(-8));
    await pass(melody, { bpm: session.bpm, tempoStable: false });
    await pass(melody, { bpm: session.bpm, tempoStable: true });
    expect(session.loopLocked).toBe(true);
    expect(playbackMix.current.breath).toBe(false);
  });

  it("slows a step without lowering the first time's goal, and holds the tempo when the timing was not caught", async () => {
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    const start = session.bpm;
    const goal = session.target;
    await pass(card, { hit: 6, total: 10 }); // Pass 1 settle-in (forgiven)
    await pass(card, { hit: 6, total: 10 }); // scored miss 1
    await pass(card, { hit: 6, total: 10 }); // scored miss 2 → slows
    expect(session.bpm).toBe(start - 4);
    expect(session.target).toBe(goal); // a clean pass earns the way back
    await pass(card);
    expect(session.bpm).toBe(start);
    expect(session.outcome).toBeFalsy();
    const untimed = { at: card.tl.targets.map(() => null) };
    await pass(card, untimed);
    await pass(card, untimed);
    expect(session.bpm).toBe(start); // right notes, too few attacks caught: neither up nor down
    expect(session.outcome).toBeFalsy();
    await pass(card, untimed);
    expect(session.outcome).toMatchObject({ result: "ok" });
  });

  it("holds a tune's tempo when its notes are right but the time is uneven", async () => {
    const tune = deck.cards.find((candidate) => candidate.step?.kind === "tune")!;
    const uneven = (c: typeof card) => ({ at: c.tl.targets.map((_, i) => (i % 2 ? 140 : -140)) });
    input.status = "listening";
    await act(async () => session.begin([tune.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    const start = session.bpm;
    await pass(tune, uneven(tune)); // Pass 1 settle-in
    await pass(tune, uneven(tune));
    await pass(tune, uneven(tune));
    expect(session.bpm).toBe(start); // the notes are there: neither slower nor faster
    expect(session.outcome).toBeFalsy();
    await pass(tune, uneven(tune));
    expect(session.outcome).toMatchObject({ result: "ok" }); // and it moves on, kept in its box
  });

  it("slows a drill whose notes are right but whose time is uneven", async () => {
    input.status = "listening";
    await act(async () => session.begin([card.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    const start = session.bpm;
    const uneven = { at: card.tl.targets.map((_, i) => (i % 2 ? 140 : -140)) };
    await pass(card, uneven); // Pass 1 settle-in
    await pass(card, uneven);
    await pass(card, uneven);
    expect(session.bpm).toBe(start - 4);
  });

  it("fades new memory work only after full steady passes and schedules its later review", async () => {
    input.status = "listening";
    await act(async () => session.updateSettings({ guide: true }));
    await act(async () => session.begin([memory.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    expect(session.memoryStage).toBe("page");
    expect(playbackMix.current).toMatchObject({ melody: false, shadow: null, guide: false });
    await pass(memory, { at: memory.tl.targets.map(() => null) });
    expect(session.memoryStage).toBe("page");
    await pass(memory);
    expect(session.memoryStage).toBe("landmarks");
    expect(session.store.history ?? []).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(300));
    await pass(memory);
    expect(session.memoryStage).toBe("hidden");
    expect(session.store.history ?? []).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(300));
    await pass(memory);
    expect(session.outcome?.conditions).toMatchObject({ notation: "faded", exposure: "repeated", support: "none" });
    expect(session.store.cards[memory.id]).toMatchObject({ box: 2, due: today(new Date(Date.now() + 86400000)) });
  });

  for (const rehearsed of [false, true]) {
    it(`starts a due memory review hidden and records ${rehearsed ? "same-day rehearsal" : "its first attempt"}`, async () => {
      await dueMemory(rehearsed);
      expect(session.memoryReview).toBe(true);
      expect(session.memoryStage).toBe("hidden");
      await pass(memory);
      expect(session.outcome?.conditions).toMatchObject({ notation: "hidden", exposure: rehearsed ? "repeated" : "first", support: "none" });
    });
  }

  for (const arrangementFingerprint of [undefined, "changed-arrangement"]) {
    it(`starts with the page when the current arrangement is ${arrangementFingerprint ? "changed" : "unknown"}`, async () => {
      options = { arrangementFingerprint };
      await dueMemory();
      expect(session.memoryReview).toBe(false);
      expect(session.memoryStage).toBe("page");
    });
  }

  it("counts a heard then skipped card as rehearsal before a later review", async () => {
    await dueMemory();
    await act(async () => session.exit());
    const source = deck.cards.find((candidate) => candidate.family === "melody" && !candidate.memory)!;
    await act(async () => session.begin([source.id, memory.id]));
    await act(async () => session.hear());
    await act(async () => session.next());
    await act(async () => session.next());
    expect(session.card?.id).toBe(memory.id);
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    await pass(memory);
    expect(session.outcome?.conditions).toMatchObject({ notation: "hidden", exposure: "repeated" });
  });

  it("keeps a revealed memory review assisted even after the page is hidden again", async () => {
    await dueMemory();
    await act(async () => session.toggleMemoryPage());
    expect(session.memoryStage).toBe("page");
    await act(async () => session.toggleMemoryPage());
    expect(session.memoryStage).toBe("landmarks");
    await act(async () => vi.advanceTimersByTime(300));
    await pass(memory);
    expect(session.memoryStage).toBe("hidden");
    await act(async () => vi.advanceTimersByTime(300));
    await pass(memory);
    expect(session.outcome?.conditions).toMatchObject({ notation: "faded", exposure: "repeated", uninterrupted: false });
  });

  it("does not schedule a new memory card when finishing after its visible pass", async () => {
    input.status = "listening";
    await act(async () => session.begin([memory.id]));
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    await act(async () => session.finishAfterPass());
    await pass(memory);
    expect(session.outcome?.result).toBe("skip");
    expect(session.store.cards[memory.id]).toBeUndefined();
    expect(session.store.history ?? []).toHaveLength(0);
  });

  it("keeps a due memory review due when finishing after a revealed pass", async () => {
    await dueMemory();
    const before = { ...session.store.cards[memory.id] };
    const history = session.store.history;
    await act(async () => session.toggleMemoryPage());
    await act(async () => vi.advanceTimersByTime(300));
    await act(async () => session.finishAfterPass());
    await pass(memory);
    expect(session.outcome?.result).toBe("skip");
    expect(session.store.cards[memory.id]).toEqual(before);
    expect(session.store.history).toEqual(history);
  });

  it("does not reschedule memory when finishing an own-pace take", async () => {
    await dueMemory();
    const before = { ...session.store.cards[memory.id] };
    const follower = { ...session.follow, done: false, results: memory.tl.targets.slice(memory.first, memory.last + 1).map(() => "hit" as const), restart() {} };
    await act(async () => root.unmount());
    vi.spyOn(followerHook, "useFollower").mockReturnValue(follower);
    root = createRoot(host);
    await render();
    await act(async () => session.begin([memory.id]));
    await act(async () => session.go("pace"));
    await act(async () => session.finishAfterPass());
    follower.done = true;
    await render();
    await act(async () => vi.advanceTimersByTime(1200));
    expect(session.outcome?.result).toBe("skip");
    expect(session.store.cards[memory.id]).toEqual(before);
  });

  for (const leave of ["next", "finish"] as const) {
    it(`does not certify a hidden review when using ${leave} before completing it`, async () => {
      await dueMemory();
      const before = { ...session.store.cards[memory.id] };
      const history = session.store.history;
      await act(async () => session[leave]());
      expect(session.store.cards[memory.id]).toEqual(before);
      expect(session.store.history).toEqual(history);
    });
  }

  it("steps back between exercises with prev() and resumes partial sessions without double-counting", async () => {
    input.status = "listening";
    const cards = deck.cards.filter((c) => !c.memory && !c.run && c.family !== "ear").slice(0, 3);
    expect(cards).toHaveLength(3);
    await act(async () => session.begin(cards.map((c) => c.id)));
    expect(session.pos).toBe(0);
    expect(session.keys.prev).toBeUndefined();
    // prev at pos 0 is a no-op
    await act(async () => session.prev());
    expect(session.pos).toBe(0);

    // Move to exercise 2 via next() (conclude skip -> advance)
    await act(async () => session.next());
    await act(async () => session.next());
    expect(session.pos).toBe(1);
    expect(session.card?.id).toBe(cards[1].id);
    expect(session.keys.prev).toBeTypeOf("number");

    // Step back to exercise 1 cleanly
    await act(async () => session.prev());
    expect(session.pos).toBe(0);
    expect(session.card?.id).toBe(cards[0].id);

    // Complete exercise 1 cleanly (banks in Free Ride), bank & advance to exercise 2
    await act(async () => session.go("time"));
    await act(async () => vi.advanceTimersByTime(950));
    await pass(cards[0]);
    await act(async () => session.next());
    await act(async () => session.next());
    expect(session.pos).toBe(1);
    expect(session.remaining).toBe(2);

    // Stop early on exercise 2 -> summary shows 2 remaining, resume() picks up at exercise 2
    await act(async () => session.finish());
    expect(session.finished).toBe(true);
    expect(session.remaining).toBe(2);
    expect(session.store.sessions).toHaveLength(1);
    await act(async () => { expect(session.resume()).toBe(true); });
    expect(session.finished).toBe(false);
    expect(session.pos).toBe(1);
    expect(session.card?.id).toBe(cards[1].id);

    // Exit mid-session -> returns resumable snapshot with recordedOutcomes=2 (skip + clean)
    let saved: ReturnType<typeof session.exit> = null;
    await act(async () => { saved = session.exit(); });
    expect(saved).not.toBeNull();
    expect(saved!.pos).toBe(1);
    expect(saved!.queue).toEqual(cards.map((c) => c.id));
    expect(saved!.recordedOutcomes).toBe(saved!.log.length);

    // Restoring the snapshot resumes at exercise 2 and finishing without new cards doesn't double-record
    await act(async () => session.resumeFrom(saved!));
    expect(session.running).toBe(true);
    expect(session.pos).toBe(1);
    expect(session.card?.id).toBe(cards[1].id);
    await act(async () => session.finish());
    expect(session.store.sessions).toHaveLength(1);
  });
});

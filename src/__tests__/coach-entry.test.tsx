// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInputSetup } from "../audio/setup";
import { SongCoach } from "../components/SongCoach";
import { TunePicker } from "../components/TunePicker";
import { GoalChooser } from "../components/GoalChooser";
import * as freeRoom from "../components/FreePlay";
import type { InputApi, InputFrame } from "../listen/useInput";
import * as pitch from "../listen/pitch";
import { keepPracticeWrite } from "../platform/practiceWindow";
import { buildDeck } from "../song/deck";
import { createGoal, getGoals, GOALS_KEY } from "../song/goals";
import { loadStore } from "../song/leitner";
import { IDLE_BEAT } from "../song/pulse";
import * as cues from "../song/cues";
import type { SessionApi } from "../song/useSession";
import { parseTuneEntry } from "../tunes/library";
import { buildTimeline } from "../tunes/order";
import { STARTER_ENTRY } from "../tunes/starter";
import { passageId } from "../tunes/passage";
import type { ReactNode } from "react";

const mocked = vi.hoisted(() => ({ session: undefined as unknown as SessionApi, calibrated: false, suspended: false, initialQueue: undefined as readonly string[] | undefined }));

vi.mock("../song/useSession", () => ({
  useSession: (_deck: unknown, _ids: unknown, _input: unknown, options?: { suspended?: boolean; initialQueue?: readonly string[] }) => {
    mocked.suspended = Boolean(options?.suspended);
    mocked.initialQueue = options?.initialQueue;
    return mocked.session;
  },
}));
vi.mock("../components/Score", () => ({ Score: () => null }));
vi.mock("../platform/PracticeWindowBoundary", () => ({ PracticeWindowBoundary: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../listen/calibration", () => ({ loadProfile: () => mocked.calibrated ? {} : null }));
vi.mock("../components/Calibrate", () => ({
  Calibrate: ({ onDone }: { onDone(): void }) => (
    <div role="dialog" aria-label="calibration">
      <button type="button" onClick={onDone}>skip calibration</button>
    </div>
  ),
}));

function inputAt(status: InputApi["status"], deviceId: string | null = null): InputApi {
  return {
    status, deviceId, error: null, devices: [], paused: false,
    level: { current: 0 }, subscribe: () => () => undefined,
    setDeviceId() {}, async start() {}, stop() {}, autoStart() {},
  };
}

describe("coach entry", () => {
  let root: Root;
  let host: HTMLDivElement;
  let sheet: ReturnType<typeof parseTuneEntry>;
  let tl: ReturnType<typeof buildTimeline>;

  beforeEach(() => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
      key: (index: number) => [...saved.keys()][index] ?? null,
      get length() { return saved.size; },
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setInputSetup(null);
    mocked.calibrated = false;
    mocked.suspended = false;
    mocked.initialQueue = undefined;
    sheet = parseTuneEntry(STARTER_ENTRY);
    tl = buildTimeline(sheet);
    const store = loadStore(sheet.id);
    const ready: Partial<SessionApi> = {
      store, settings: store.settings, running: false, finished: false, paused: false,
      card: undefined, active: -1, keys: { hear: 76, pace: 41, time: 43, next: 44 },
      setMeta() {}, updateSettings() {}, begin: vi.fn(), exit: vi.fn(), elapsed: () => 0,
    };
    mocked.session = ready as SessionApi;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    setInputSetup(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plans and begins the exact exercise selected before entering the coach", async () => {
    mocked.calibrated = true;
    const deck = buildDeck(sheet, tl);
    const selected = deck.cards.find((card, index) => index > 0 && card.family === "melody");
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} initialCardId={selected!.id} onClose={() => undefined} />));

    expect(host.querySelectorAll(".ss-ready-queue li")).toHaveLength(1);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(mocked.session.begin).toHaveBeenCalledTimes(1);
    expect(mocked.session.begin).toHaveBeenCalledWith([selected!.id]);
  });

  it("keeps an unchanged saved goal's identity and frozen route at the local creation limit", async () => {
    const deck = buildDeck(sheet, tl);
    const goal = createGoal(sheet, deck, { kind: "melody", minBpm: 50, targetBpm: 80 });
    const goals = Object.fromEntries([goal, ...Array.from({ length: 11 }, (_, index) => ({ ...goal, id: `${goal.id}-${index}` }))].map((entry) => [entry.id, entry]));
    localStorage.setItem(GOALS_KEY, JSON.stringify({ v: 1, byTune: { [sheet.id]: { activeId: goal.id, goals } } }));
    await act(async () => root.render(<GoalChooser sheet={sheet} deck={deck} />));
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Change goal")!.click(); });
    const use = [...host.querySelectorAll("button")].find((button) => button.textContent === "Use this goal")!;
    expect(use.disabled).toBe(false);
    await act(async () => { use.click(); });
    expect(getGoals().byTune[sheet.id].activeId).toBe(goal.id);
    expect(getGoals().byTune[sheet.id].goals[goal.id]).toEqual(goal);
    expect(Object.keys(getGoals().byTune[sheet.id].goals)).toHaveLength(12);
  });

  it("can begin self-guided practice without opening or scoring an input", async () => {
    const input = inputAt("error");
    input.start = vi.fn(async () => undefined);
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} onClose={() => undefined} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Practise without scoring"));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(mocked.session.begin).toHaveBeenCalledWith(expect.any(Array), true);
    expect(input.start).not.toHaveBeenCalled();
  });

  it("holds a parked room still and releases only the pause parking took", async () => {
    const togglePause = vi.fn();
    const frames: ((frame: never) => void)[] = [];
    const input = inputAt("listening", "guitar");
    input.subscribe = (fn) => { frames.push(fn as (frame: never) => void); return () => undefined; };
    mocked.calibrated = true;
    mocked.session = { ...mocked.session, running: true, paused: false, togglePause } as SessionApi;
    const render = (parked: boolean) => act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} parked={parked} onClose={() => undefined} />));
    await render(true);
    expect(mocked.suspended).toBe(true);
    expect(togglePause).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".ss")?.classList.contains("is-parked")).toBe(true);
    mocked.session = { ...mocked.session, paused: true } as SessionApi;
    await render(false);
    expect(togglePause).toHaveBeenCalledTimes(2); // its own pause, released on return
    expect(mocked.suspended).toBe(false);
  });

  it("returns from rhythm isolation to its original phrase in the selected route", async () => {
    mocked.calibrated = true;
    const source = buildDeck(sheet, tl).cards.find((card) => card.family === "melody" && card.view === "score" && !card.run)!;
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} initialCardId={`rhythm:${source.id}`} onClose={() => undefined} />));
    expect(host.querySelectorAll(".ss-ready-queue li")).toHaveLength(2);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(mocked.session.begin).toHaveBeenCalledWith([`rhythm:${source.id}`, `rhythm-context:${source.id}`]);
  });

  it("regenerates an exact custom passage and refuses its stale arrangement instead of planning other work", async () => {
    mocked.calibrated = true;
    const id = passageId(sheet, { start: 2, end: 4 });
    await act(async () => root.render(<SongCoach key="current" sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} initialCardId={id} onClose={() => undefined} />));
    expect(host.querySelectorAll(".ss-ready-queue li")).toHaveLength(1);
    expect(host.querySelector(".ss-ready-queue")?.textContent).toContain("playing order 3–5");
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(mocked.session.begin).toHaveBeenCalledWith([id]);
    vi.mocked(mocked.session.begin).mockClear();
    const changed = { ...sheet, tempo: (sheet.tempo ?? 80) + 1 };
    await act(async () => root.render(<SongCoach key="changed" sheet={changed} tl={tl} input={inputAt("listening", "guitar")} initialCardId={id} onClose={() => undefined} />));
    expect(host.querySelectorAll(".ss-ready-queue li")).toHaveLength(0);
    expect(host.textContent).toContain("This passage is unavailable in the current arrangement");
    expect(host.querySelector<HTMLButtonElement>(".ss-begin")?.disabled).toBe(true);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(mocked.session.begin).not.toHaveBeenCalled();
  });

  it("offers the same memory reveal on the page and the guitar menu's D row", async () => {
    mocked.calibrated = true;
    const card = buildDeck(sheet, tl).cards.find((candidate) => candidate.memory && candidate.family === "melody")!;
    const reveal = vi.fn();
    Object.assign(mocked.session, {
      running: true, card, whole: card, active: -1, queue: [card.id], pos: 0, box: 2,
      phase: "time", memoryStage: "hidden", memoryReview: true, toggleMemoryPage: reveal,
      passes: [], passLog: [], settling: false, loopMode: "adaptive", setLoopMode() {}, loopLocked: false, tempoLift: null, breathing: false, reentry: 0,
      log: [], results: [], shadows: [], takes: { clean: 0, unclean: 0 }, flow: 0.5, run: 0, needClean: 0, pulse: null, beat: IDLE_BEAT,
      bpm: card.bpm, target: card.bpm, click: true,
      playback: { playing: false, counting: 0, breathing: false, reentry: 0, beat: IDLE_BEAT, activeTarget: -1, activeSlot: -1, lastPass: null, drift: null, results: [], wrong: [], async play() {}, stop() {}, beatAt: () => null },
      togglePause() {}, hear() {}, go() {}, next() {},
    } satisfies Partial<SessionApi>);
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} onClose={() => undefined} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Reveal page")!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(reveal).toHaveBeenCalledTimes(1);
    await act(async () => { [...host.querySelectorAll("button")].find((item) => item.textContent === "Guitar menu")!.click(); });
    const row = [...host.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes("Reveal page"))!;
    expect(row.querySelector(".ss-pad-note")?.textContent).toBe("D♯3");
    await act(async () => (row as HTMLButtonElement).click());
    expect(reveal).toHaveBeenCalledTimes(2);
  });

  it("honours a calibration skip while opening, then offers calibration for a different device", async () => {
    const render = async (input: InputApi) => {
      await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} onClose={() => undefined} />));
    };
    const calibration = () => host.querySelector('[aria-label="calibration"]');
    await render(inputAt("starting"));
    expect(host.querySelectorAll(".ss-ready-queue li").length).toBeGreaterThan(0);
    await act(async () => { calibration()!.querySelector("button")!.click(); });
    expect(calibration()).toBeNull();

    setInputSetup({ deviceId: "guitar", sampleRate: 48000 });
    await render(inputAt("listening", "guitar"));
    expect(calibration()).toBeNull();

    setInputSetup({ deviceId: "another-guitar", sampleRate: 48000 });
    await render(inputAt("listening", "another-guitar"));
    expect(calibration()).not.toBeNull();
  });

  it("requires review and confirmation, drains saves before switching, and retains a failed choice for retry", async () => {
    mocked.calibrated = true;
    const other = { ...sheet, id: "another-tune", title: "Another tune" };
    const onTune = vi.fn().mockRejectedValueOnce(new Error("Save has not completed")).mockResolvedValue(undefined);
    let complete!: () => void;
    keepPracticeWrite(new Promise<void>((resolve) => { complete = resolve; }));
    const click = async (label: string) => {
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!;
      expect(button).toBeDefined();
      await act(async () => button.click());
    };
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening")} others={[{ sheet: other, tl }]} onClose={() => undefined} onTune={onTune} />));
    await click("Choose tune");
    expect(host.querySelector('[aria-label="Tune to practise"]')?.textContent).toContain(other.title);
    await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(mocked.session.begin).not.toHaveBeenCalled();
    expect(onTune).not.toHaveBeenCalled();
    await click("Review choice");
    expect(onTune).not.toHaveBeenCalled();
    await click("Change tune");
    expect(mocked.session.exit).toHaveBeenCalledTimes(1);
    expect(onTune).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Saving practice");
    await act(async () => { complete(); });
    expect(onTune).toHaveBeenCalledWith(other.id);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Save has not completed");
    expect(host.querySelector('[aria-label="Choose tune"]')).not.toBeNull();
    await click("Retry change");
    expect(onTune).toHaveBeenCalledTimes(2);
    expect(mocked.session.exit).toHaveBeenCalledTimes(1);
  });

  it("keeps opening matches as suggestions and requires a newly played confirmation note", async () => {
    const listeners = new Set<(frame: InputFrame) => void>();
    const input = inputAt("listening", "guitar");
    input.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    let midi: number | null = null;
    vi.spyOn(pitch, "midiOf").mockImplementation(() => midi);
    let now = 0;
    const frame = (note: number | null, advance = 30) => {
      midi = note; now += advance;
      const value: InputFrame = { now, rms: note === null ? 0 : 0.05, buf: new Float32Array(16), sampleRate: 48000 };
      [...listeners].forEach((listener) => listener(value));
    };
    const quiet = () => { for (let index = 0; index < 6; index++) frame(null); };
    const onChoose = vi.fn();
    const sources = [{ id: sheet.id, title: sheet.title, tl }, { id: "other-opening", title: "Other opening", tl }];
    await act(async () => root.render(<TunePicker input={input} sources={sources} currentTuneId={sheet.id} onCancel={() => undefined} onChoose={onChoose} />));
    const click = async (label: string) => { await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!.click()); };
    await click("Listen to opening");
    await act(async () => {
      quiet();
      tl.targets.slice(0, 8).forEach((target) => { quiet(); for (let index = 0; index < 3; index++) frame(target.midi); });
    });
    expect(host.querySelector(".ss-tune-matches")?.textContent).toContain("Other opening");
    expect(onChoose).not.toHaveBeenCalled();
    await click("Review matches");
    expect(onChoose).not.toHaveBeenCalled();
    await click("Review choice");
    await act(async () => { frame(65); frame(65, 700); });
    expect(onChoose).not.toHaveBeenCalled();
    await act(async () => { quiet(); frame(65); frame(65, 700); });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith("other-opening");
  });

  it("opens the chooser from the summary's F gesture without changing tune", async () => {
    vi.useFakeTimers();
    mocked.calibrated = true;
    const card = buildDeck(sheet, tl).cards[0];
    Object.assign(mocked.session, { running: true, finished: true, log: [{ id: card.id, at: 0, result: "clean", from: 0, to: 1, bpm: 80, share: 1, secs: 20, also: [], spots: 0 }], keepGoing: () => false } satisfies Partial<SessionApi>);
    const interlude = vi.spyOn(cues, "interlude").mockReturnValue(0);
    const listeners = new Set<(frame: InputFrame) => void>();
    const input = inputAt("listening", "guitar");
    input.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    let midi: number | null = null;
    vi.spyOn(pitch, "midiOf").mockImplementation(() => midi);
    const onTune = vi.fn();
    const other = { ...sheet, id: "summary-other", title: "Summary other" };
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} others={[{ sheet: other, tl }]} onClose={() => undefined} onTune={onTune} />));
    await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Choose tune"))!.click());
    await act(async () => vi.advanceTimersByTime(700));
    expect(interlude).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Return to practice"))!.click());
    await act(async () => vi.advanceTimersByTime(3000));
    expect(interlude).not.toHaveBeenCalled();
    await act(async () => {
      for (const now of [0, 30, 60, 90, 120, 150, 180]) [...listeners].forEach((listener) => listener({ now, rms: 0, buf: new Float32Array(16), sampleRate: 48000 }));
      midi = 53;
      for (const now of [200, 800]) [...listeners].forEach((listener) => listener({ now, rms: 0.05, buf: new Float32Array(16), sampleRate: 48000 }));
    });
    expect(host.querySelector('[aria-label="Choose tune"]')).not.toBeNull();
    expect(onTune).not.toHaveBeenCalled();
    expect(mocked.session.exit).not.toHaveBeenCalled();
  });

  it("reserves the actual whole-tune card for music and returns from chooser and instruments to the same card", async () => {
    mocked.calibrated = true;
    const card = buildDeck(sheet, tl).cards.find((candidate) => candidate.step?.kind === "tune" && !candidate.run)!;
    expect(card).toBeDefined();
    const togglePause = vi.fn(() => { mocked.session.paused = !mocked.session.paused; });
    Object.assign(mocked.session, {
      running: true, card, whole: card, active: -1, queue: [card.id], pos: 0, box: 2,
      phase: "time", passes: [], passLog: [], settling: false, loopMode: "adaptive", setLoopMode() {}, loopLocked: false, tempoLift: null, breathing: false, reentry: 0,
      log: [], results: [], shadows: [], takes: { clean: 0, unclean: 0 },
      flow: 0.5, run: 0, needClean: 0, pulse: null, beat: IDLE_BEAT,
      bpm: card.bpm, target: card.bpm, click: true,
      playback: { playing: false, counting: 0, breathing: false, reentry: 0, beat: IDLE_BEAT, activeTarget: -1, activeSlot: -1, lastPass: null, drift: null, results: [], wrong: [], async play() {}, stop() {}, beatAt: () => null },
      togglePause, hear: vi.fn(), go: vi.fn(), next: vi.fn(),
    } satisfies Partial<SessionApi>);
    const listeners = new Set<(frame: InputFrame) => void>();
    const input = inputAt("listening", "guitar");
    input.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    let midi: number | null = null;
    vi.spyOn(pitch, "midiOf").mockImplementation(() => midi);
    const other = { ...sheet, id: "run-other", title: "Run other" };
    const onTune = vi.fn();
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} others={[{ sheet: other, tl }]} onClose={() => undefined} onTune={onTune} />));
    expect(host.querySelectorAll(".ss-trail .ss-nk")).toHaveLength(0);
    await act(async () => {
      let now = 0;
      for (const note of [null, null, null, null, null, null, 76, 76, null, null, null, null, null, null, 44, 44]) {
        midi = note; now += 600;
        [...listeners].forEach((listener) => listener({ now, rms: note === null ? 0 : 0.05, buf: new Float32Array(16), sampleRate: 48000 }));
      }
    });
    expect(mocked.session.hear).not.toHaveBeenCalled();
    expect(mocked.session.next).not.toHaveBeenCalled();
    expect(togglePause).not.toHaveBeenCalled();
    const click = async (label: string) => { await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!.click()); };
    await click("Guitar menu");
    await click("Session controls");
    await click("Sound & setup");
    await click("Tune & session");
    await click("Choose tune");
    expect(mocked.session.paused).toBe(true);
    expect(togglePause).toHaveBeenCalledTimes(1);
    await click("Return to practice");
    expect(mocked.session.paused).toBe(false);
    expect(togglePause).toHaveBeenCalledTimes(2);
    expect(mocked.session.card).toBe(card);
    expect(mocked.session.exit).not.toHaveBeenCalled();
    expect(onTune).not.toHaveBeenCalled();
    await click("Tuner");
    expect(host.querySelector('[aria-label="chromatic tuner"]')).not.toBeNull();
    expect(mocked.suspended).toBe(true);
    expect(mocked.session.paused).toBe(true);
    await act(async () => {
      for (const key of ["Enter", "h", "n", "s", " "]) document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    expect(mocked.session.hear).not.toHaveBeenCalled();
    expect(mocked.session.next).not.toHaveBeenCalled();
    expect(mocked.session.begin).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Return to practice"]')!.click());
    expect(mocked.session.paused).toBe(false);
    expect(mocked.suspended).toBe(false);
    expect(togglePause).toHaveBeenCalledTimes(4);

    await click("Guitar menu");
    await click("Session controls");
    await click("Sound & setup");
    await click("Tune & session");
    const metronomeRow = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Metronome"))!;
    expect(metronomeRow.querySelector(".ss-pad-note")?.textContent).toBe("C4");
    await act(async () => metronomeRow.click());
    expect(host.querySelector('[aria-label="metronome"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('[aria-label="Tempo in beats per minute"]')?.value).toBe(String(card.bpm));
    expect(togglePause).toHaveBeenCalledTimes(5);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Return to practice"]')!.click());
    expect(mocked.session.paused).toBe(false);
    expect(togglePause).toHaveBeenCalledTimes(6);
    mocked.session.paused = true;
    await click("Tuner");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Return to practice"]')!.click());
    expect(mocked.session.paused).toBe(true);
    expect(togglePause).toHaveBeenCalledTimes(6);
    expect(mocked.session.card).toBe(card);
    expect(mocked.session.exit).not.toHaveBeenCalled();
  });

  it("opens instruments from Ready and blocks its held-note start until returning", async () => {
    mocked.calibrated = true;
    const listeners = new Set<(frame: InputFrame) => void>();
    const input = inputAt("listening", "guitar");
    input.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    let midi: number | null = null;
    vi.spyOn(pitch, "midiOf").mockImplementation(() => midi);
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} onClose={() => undefined} />));
    const metronome = host.querySelector<HTMLButtonElement>('.ss-instruments--ready button[title="Hold C for the instruments, then switch with the guitar menu"]')!;
    await act(async () => metronome.click());
    expect(mocked.suspended).toBe(true);
    await act(async () => {
      for (const now of [0, 30, 60, 90, 120, 150]) [...listeners].forEach((listener) => listener({ now, rms: 0, buf: new Float32Array(16), sampleRate: 48000 }));
      midi = 60;
      for (const now of [200, 1200, 2200]) [...listeners].forEach((listener) => listener({ now, rms: 0.05, buf: new Float32Array(16), sampleRate: 48000 }));
    });
    expect(mocked.session.begin).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Return to practice"]')!.click());
    expect(mocked.suspended).toBe(false);
    expect(host.querySelector(".ss-ready")?.closest('[aria-hidden="true"]')).toBeNull();

    vi.spyOn(freeRoom, "FreePlay").mockImplementation(({ onToolsChange }) => <div className="mock-free-room"><button type="button" onClick={() => onToolsChange?.(true)}>Open free instruments</button><button type="button" onClick={() => onToolsChange?.(false)}>Close free instruments</button></div>);
    await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Free play"))!.click());
    await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent === "Open free instruments")!.click());
    expect(host.querySelector(".ss-chrome")).toBeNull();
    await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector(".mock-free-room")).not.toBeNull();
    await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent === "Close free instruments")!.click());
    expect(host.querySelector(".ss-chrome")).not.toBeNull();
  });

  it("begins Ready on a 3-note fretted phrase while ignoring open strings and single held notes", async () => {
    mocked.calibrated = true;
    const listeners = new Set<(frame: InputFrame) => void>();
    const input = inputAt("listening", "guitar");
    input.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
    let midi: number | null = null;
    vi.spyOn(pitch, "midiOf").mockImplementation(() => midi);
    let now = 0;
    const send = (note: number | null, advance = 35) => {
      midi = note; now += advance;
      const frame: InputFrame = { now, rms: note === null ? 0 : 0.05, buf: new Float32Array(16), sampleRate: 48000 };
      [...listeners].forEach((listener) => listener(frame));
    };
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={input} onClose={() => undefined} />));
    // Prime with quiet, then tune open strings (E2, A2, D3): must never begin.
    await act(async () => {
      for (let i = 0; i < 4; i++) send(null);
      for (const open of [40, 45, 50, 55]) { send(open); send(open, 70); send(null, 120); }
    });
    expect(mocked.session.begin).not.toHaveBeenCalled();

    // Holding a single fretted note (even long) must not begin on its own.
    await act(async () => {
      send(57); send(57, 70); send(57, 300); send(57, 500);
      send(null, 2000); // pause resets phrase
    });
    expect(mocked.session.begin).not.toHaveBeenCalled();

    // Play a short 3-note fretted phrase (A3 → C4 → D4): begins cleanly.
    await act(async () => {
      for (const note of [57, 60, 62]) { send(note); send(note, 70); }
    });
    expect(mocked.session.begin).toHaveBeenCalledTimes(1);
  });

  it("lets the player jump straight into the whole tune from Ready", async () => {
    mocked.calibrated = true;
    const deck = buildDeck(sheet, tl);
    const whole = deck.cards.find((c) => c.step?.kind === "tune")!;
    expect(whole).toBeDefined();
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} onClose={() => undefined} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Play the whole tune"));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(mocked.session.begin).toHaveBeenCalledWith([whole.id]);
  });

  it("starts directly into the requested exercise when autoStart is set and falls back cleanly when missing", async () => {
    mocked.calibrated = true;
    const deck = buildDeck(sheet, tl);
    const selected = deck.cards.find((card) => card.family === "scales")!;
    await act(async () => root.render(<SongCoach key="direct" sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} initialCardId={selected.id} autoStart onClose={() => undefined} />));
    expect(mocked.initialQueue).toEqual([selected.id]);

    mocked.initialQueue = undefined;
    await act(async () => root.render(<SongCoach key="missing" sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} initialCardId="scale:missing:thirds" autoStart onClose={() => undefined} />));
    expect(mocked.initialQueue).toBeUndefined();
    expect(host.querySelector(".ss-ready")).not.toBeNull();
  });
});

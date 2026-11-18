// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInputSetup } from "../audio/setup";
import { SongCoach } from "../components/SongCoach";
import { GoalChooser } from "../components/GoalChooser";
import type { InputApi } from "../listen/useInput";
import { buildDeck } from "../song/deck";
import { createGoal, getGoals, GOALS_KEY } from "../song/goals";
import { loadStore } from "../song/leitner";
import { IDLE_BEAT } from "../song/pulse";
import type { SessionApi } from "../song/useSession";
import { parseTuneEntry } from "../tunes/library";
import { buildTimeline } from "../tunes/order";
import { STARTER_ENTRY } from "../tunes/starter";
import type { ReactNode } from "react";

const mocked = vi.hoisted(() => ({ session: undefined as unknown as SessionApi, calibrated: false }));

vi.mock("../song/useSession", () => ({ useSession: () => mocked.session }));
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
    sheet = parseTuneEntry(STARTER_ENTRY);
    tl = buildTimeline(sheet);
    const store = loadStore(sheet.id);
    const ready: Partial<SessionApi> = {
      store, settings: store.settings, running: false, finished: false, paused: false,
      card: undefined, active: -1, keys: { hear: 76, pace: 41, time: 43, next: 44 },
      setMeta() {}, updateSettings() {}, begin: vi.fn(), elapsed: () => 0,
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

  it("returns from rhythm isolation to its original phrase in the selected route", async () => {
    mocked.calibrated = true;
    const source = buildDeck(sheet, tl).cards.find((card) => card.family === "melody" && card.view === "score" && !card.run)!;
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} initialCardId={`rhythm:${source.id}`} onClose={() => undefined} />));
    expect(host.querySelectorAll(".ss-ready-queue li")).toHaveLength(2);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(mocked.session.begin).toHaveBeenCalledWith([`rhythm:${source.id}`, `rhythm-context:${source.id}`]);
  });

  it("offers the same memory reveal on the page and the guitar menu's D row", async () => {
    mocked.calibrated = true;
    const card = buildDeck(sheet, tl).cards.find((candidate) => candidate.memory && candidate.family === "melody")!;
    const reveal = vi.fn();
    Object.assign(mocked.session, {
      running: true, card, whole: card, active: -1, queue: [card.id], pos: 0, box: 2,
      phase: "time", memoryStage: "hidden", memoryReview: true, toggleMemoryPage: reveal,
      passes: [], log: [], results: [], shadows: [], takes: { clean: 0, unclean: 0 }, flow: 0.5, run: 0, needClean: 0, pulse: null, beat: IDLE_BEAT,
      bpm: card.bpm, target: card.bpm, click: true,
      playback: { playing: false, counting: 0, beat: IDLE_BEAT, activeTarget: -1, activeSlot: -1, lastPass: null, drift: null, results: [], wrong: [], async play() {}, stop() {} },
      togglePause() {}, hear() {}, go() {}, next() {},
    } satisfies Partial<SessionApi>);
    await act(async () => root.render(<SongCoach sheet={sheet} tl={tl} input={inputAt("listening", "guitar")} onClose={() => undefined} />));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Reveal page")!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(reveal).toHaveBeenCalledTimes(1);
    await act(async () => { [...host.querySelectorAll("button")].find((item) => item.textContent === "Guitar menu")!.click(); });
    const row = [...host.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes("Reveal page"))!;
    expect(row.querySelector(".ss-pad-note")?.textContent).toBe("D");
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
});

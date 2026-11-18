// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InputApi } from "../listen/useInput";
import type { TuneEntry } from "../tunes/library";
import type { LeadSheet } from "../tunes/musicxml";
import { STARTER_ENTRY } from "../tunes/starter";
import { BLUE_HOUR_ENTRY } from "../tunes/demos";
import { TuneView } from "../components/TuneView";

const browser = vi.hoisted(() => ({
  library: [] as TuneEntry[],
  load: vi.fn<() => Promise<TuneEntry[]>>(),
  save: vi.fn<(entries: TuneEntry[]) => Promise<boolean>>(),
  play: vi.fn(async (_from?: number, _to?: number, _loop?: boolean) => undefined),
  stop: vi.fn(),
  audioStart: vi.fn(async () => undefined),
  openPractice: vi.fn(),
}));

vi.mock("tone", () => ({ start: browser.audioStart }));
vi.mock("../audio/context", () => ({ ensureAudio: vi.fn() }));
vi.mock("../nav/useGuitarNav", () => ({ setNavMuted: vi.fn() }));
vi.mock("../tunes/library", async (importOriginal) => ({
  ...await importOriginal<typeof import("../tunes/library")>(),
  loadLibrary: () => browser.library,
  loadLibraryAsync: () => browser.load(),
  loadCurrentTuneId: () => browser.library[0]?.id ?? null,
  saveCurrentTuneId: vi.fn(),
  saveLibrary: (entries: TuneEntry[]) => browser.save(entries),
}));
vi.mock("../tunes/usePlayback", () => ({
  usePlayback: () => ({
    play: browser.play, stop: browser.stop,
    playing: false, activeSlot: -1, activeTarget: -1, counting: 0,
  }),
}));
vi.mock("../components/GoalChooser", () => ({ GoalChooser: () => null }));
vi.mock("../components/Score", () => ({
  Score: ({ exercise, onBarClick, marked }: {
    exercise: LeadSheet;
    onBarClick: (bar: number, extend: boolean) => void;
    marked: { start: number; end: number } | null;
  }) => (
    <div data-score={exercise.id} data-marked={JSON.stringify(marked)}>
      {exercise.bars.map((_, bar) => <button key={bar} onClick={() => onBarClick(bar, false)}>Score bar {bar + 1}</button>)}
    </div>
  ),
}));
vi.mock("../components/SongCoach", () => ({
  openPractice: browser.openPractice,
  SongCoach: ({ sheet, initialCardId }: { sheet: LeadSheet; initialCardId?: string }) => (
    <div data-coach={sheet.id} data-card={initialCardId} />
  ),
}));

const input: InputApi = {
  status: "idle", error: null, devices: [], deviceId: null, paused: false,
  setDeviceId: vi.fn(), start: vi.fn(async () => undefined), stop: vi.fn(),
  autoStart: vi.fn(), level: { current: 0 }, subscribe: () => () => undefined,
};
let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  browser.library = [];
  browser.load.mockImplementation(async () => browser.library);
  browser.save.mockResolvedValue(true);
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(launch?: { kind: "listen"; tuneId: string }) {
  root = createRoot(host);
  await act(async () => root!.render(<TuneView input={input} launch={launch} />));
}

async function press(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => (item.getAttribute("aria-label") ?? item.textContent)?.trim() === label);
  expect(button, `Button ${label} is available`).toBeTruthy();
  await act(async () => button!.click());
}

it("selects a score phrase without autoplay, listens to its range, and launches that exact phrase", async () => {
  browser.library = [STARTER_ENTRY];
  await mount();
  await press("Score bar 3");
  expect(browser.play).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Selected phrase"]')?.textContent).toContain("bars 3–4");
  expect(host.querySelector("[data-score]")?.getAttribute("data-marked")).toBe('{"start":2,"end":3}');

  await press("Listen to phrase");
  expect(browser.play).toHaveBeenLastCalledWith(2, 3, false);
  await press("Loop");
  await press("Listen to phrase");
  expect(browser.play).toHaveBeenLastCalledWith(2, 3, true);

  await press("Clear phrase selection");
  await press("Listen to piece");
  expect(browser.play).toHaveBeenLastCalledWith(0, undefined, false);
  await press("Score bar 3");
  await press("Practise phrase");
  expect(browser.openPractice).toHaveBeenCalledWith(input);
  expect(host.querySelector<HTMLElement>("[data-coach]")?.dataset).toMatchObject({
    coach: STARTER_ENTRY.id, card: "mel:new:2-3",
  });
});

it("listens to a bundled demo when the library cannot save it", async () => {
  browser.save.mockResolvedValue(false);
  await mount();
  await press("Listen to Blue Hour");
  expect(browser.save).toHaveBeenCalledWith([BLUE_HOUR_ENTRY]);
  expect(host.querySelector("[data-score]")?.getAttribute("data-score")).toBe(BLUE_HOUR_ENTRY.id);
  expect(browser.audioStart).toHaveBeenCalled();
  expect(browser.play).toHaveBeenCalledWith(0, undefined, false);
  expect(host.querySelector('[role="status"]')?.textContent).toMatch(/not been saved/i);
  expect(host.querySelector("[data-coach]")).toBeNull();
});

it("honors a demo Listen launch even when the saved library cannot be opened", async () => {
  browser.load.mockRejectedValue(new Error("Library unavailable"));
  await mount({ kind: "listen", tuneId: BLUE_HOUR_ENTRY.id });
  expect(host.querySelector("[data-score]")?.getAttribute("data-score")).toBe(BLUE_HOUR_ENTRY.id);
  expect(browser.play).toHaveBeenCalledWith(0, undefined, false);
  expect(host.querySelector('[role="status"]')?.textContent).toMatch(/not been saved/i);
  expect(host.querySelector("[data-coach]")).toBeNull();
});

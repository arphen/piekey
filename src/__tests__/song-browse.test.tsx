// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InputApi } from "../listen/useInput";
import type { TuneEntry } from "../tunes/library";
import type { LeadSheet } from "../tunes/musicxml";
import { STARTER_ENTRY } from "../tunes/starter";
import { BLUE_HOUR_ENTRY } from "../tunes/demos";
import { parsePassageId } from "../tunes/passage";
import { TuneView } from "../components/TuneView";
import { PracticeRoom } from "../components/PracticeRoom";

const browser = vi.hoisted(() => ({
  library: [] as TuneEntry[],
  load: vi.fn<() => Promise<TuneEntry[]>>(),
  save: vi.fn<(entries: TuneEntry[]) => Promise<boolean>>(),
  play: vi.fn(async (_from?: number, _to?: number, _loop?: boolean) => undefined),
  stop: vi.fn(),
  audioStart: vi.fn(async () => undefined),
  openPractice: vi.fn(),
  startPractice: vi.fn(),
  nextTune: "",
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
    onBarClick?: (bar: number, extend: boolean) => void;
    marked: { start: number; end: number } | null;
  }) => (
    <div data-score={exercise.id} data-marked={JSON.stringify(marked)}>
      {exercise.bars.map((_, bar) => <button key={bar} onClick={() => onBarClick?.(bar, false)}>Score bar {bar + 1}</button>)}
    </div>
  ),
}));
vi.mock("../components/SongCoach", () => ({
  openPractice: browser.openPractice,
  SongCoach: ({ sheet, initialCardId, onClose, onTune }: { sheet: LeadSheet; initialCardId?: string; onClose(): void; onTune?(id: string): void }) => (
    <div data-coach={sheet.id} data-card={initialCardId}><button onClick={onClose}>Return to Songs</button><button onClick={() => onTune?.(browser.nextTune)}>Choose another tune</button></div>
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
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
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
  await act(async () => root!.render(<TuneView input={input} launch={launch} onStartPractice={browser.startPractice} />));
}

async function press(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => (item.getAttribute("aria-label") ?? item.textContent)?.trim() === label);
  expect(button, `Button ${label} is available`).toBeTruthy();
  await act(async () => button!.click());
}

async function choose(label: string, value: number) {
  const field = [...host.querySelectorAll("label")].find((item) => item.firstChild?.textContent === label)?.querySelector("select");
  expect(field, `Select ${label} is available`).toBeTruthy();
  await act(async () => {
    field!.value = String(value);
    field!.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
  expect(browser.startPractice).toHaveBeenLastCalledWith(STARTER_ENTRY.id, "mel:new:2-3");
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
  expect(browser.startPractice).not.toHaveBeenCalled();
});

it("keeps the Play room's coach mounted when choosing another tune, and opens the next session's lead", async () => {
  browser.library = [STARTER_ENTRY, BLUE_HOUR_ENTRY];
  browser.nextTune = BLUE_HOUR_ENTRY.id;
  root = createRoot(host);
  const handle = { current: null };
  await act(async () => root!.render(<PracticeRoom input={input} launch={{ serial: 1, tuneId: null }} parked={false} handle={handle} onClose={vi.fn()} onLive={vi.fn()} onOpenLibrary={vi.fn()} />));
  const coach = host.querySelector("[data-coach]");
  expect(coach?.getAttribute("data-coach")).toBe(STARTER_ENTRY.id); // no tune named: the current tune leads
  await press("Choose another tune");
  expect(host.querySelector("[data-coach]")).toBe(coach);
  expect(coach?.getAttribute("data-coach")).toBe(BLUE_HOUR_ENTRY.id);
});

it("selects exact repeat occurrences, cancels edits, and preserves the range after practice", async () => {
  browser.library = [BLUE_HOUR_ENTRY];
  await mount();
  await press("Select passage");
  await choose("Start", 10);
  await choose("End", 13);
  expect(host.querySelector('[aria-label="Choose passage"]')?.textContent).toContain("Bar 2 · occurrence 2 · playing order 14");
  expect(browser.play).not.toHaveBeenCalled();
  await press("Use passage");
  const description = "Bar 11 · occurrence 1 → bar 2 · occurrence 2 · playing order 11–14";
  expect(host.querySelector('[aria-label="Selected passage"]')?.textContent).toContain(description);
  expect(host.querySelector("[data-score]")?.getAttribute("data-marked")).toBe("null"); // no false contiguous highlight across the return
  await press("Listen to passage");
  expect(browser.play).toHaveBeenLastCalledWith(10, 13, false);
  await press("Loop");
  await press("Listen to passage");
  expect(browser.play).toHaveBeenLastCalledWith(10, 13, true);
  await press("Select passage");
  await choose("Start", 14);
  await press("Cancel");
  expect(document.activeElement?.getAttribute("aria-controls")).toBe("song-passage-picker");
  expect(host.querySelector('[aria-label="Selected passage"]')?.textContent).toContain(description);
  await press("Practise passage");
  expect(parsePassageId(browser.startPractice.mock.lastCall?.[1])).toMatchObject({ start: 10, end: 13 });
  expect(host.querySelector('[aria-label="Selected passage"]')?.textContent).toContain(description);
  await press("Listen to passage");
  expect(browser.play).toHaveBeenLastCalledWith(10, 13, true);
  await press("Clear passage selection");
  await press("Listen to piece");
  expect(browser.play).toHaveBeenLastCalledWith(0, undefined, false);
});

it("allows listening to an all-rest passage without launching an unrelated practice session", async () => {
  browser.library = [{ ...STARTER_ENTRY, xml: STARTER_ENTRY.xml.replace(/<measure number="2">[\s\S]*?<\/measure>/, '<measure number="2"><note><rest/><duration>4</duration><type>whole</type></note></measure>') }];
  await mount();
  await press("Select passage");
  await choose("Start", 1);
  await press("Use passage");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Practise passage")?.disabled).toBe(true);
  expect(host.querySelector('[aria-label="Selected passage"]')?.textContent).toContain("no melody notes");
  await press("Listen to passage");
  expect(browser.play).toHaveBeenLastCalledWith(1, 1, false);
  expect(browser.startPractice).not.toHaveBeenCalled();
});

it("honors a demo Listen launch even when the saved library cannot be opened", async () => {
  browser.load.mockRejectedValue(new Error("Library unavailable"));
  await mount({ kind: "listen", tuneId: BLUE_HOUR_ENTRY.id });
  expect(host.querySelector("[data-score]")?.getAttribute("data-score")).toBe(BLUE_HOUR_ENTRY.id);
  expect(browser.play).toHaveBeenCalledWith(0, undefined, false);
  expect(host.querySelector('[role="status"]')?.textContent).toMatch(/not been saved/i);
  expect(browser.startPractice).not.toHaveBeenCalled();
});

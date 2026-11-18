// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SongSummary } from "../overview/summary";
import type { InputApi } from "../listen/useInput";
import { retryStorageWrites } from "../storage";
import { PracticeHistory } from "../components/PracticeHistory";
import { groupPracticeHistory, type PracticeHistoryResult } from "../song/practiceHistory";
import type { Attempt, Store } from "../song/leitner";
vi.mock("../practice.css", () => ({}));
vi.mock("../overview/overview.css", () => ({}));
import App from "../App";

const shell = vi.hoisted(() => ({
  overview: { songs: [] as SongSummary[], currentTuneId: null as string | null, loading: true, error: null as string | null },
  input: {
    status: "idle", error: null, devices: [], deviceId: null, paused: false,
    setDeviceId: vi.fn(), start: vi.fn(async () => undefined), stop: vi.fn(),
    autoStart: vi.fn(), level: { current: 0 }, subscribe: () => () => undefined,
  } as InputApi,
}));
const archive = vi.hoisted(() => ({ result: { status: "unavailable" } as PracticeHistoryResult, retry: vi.fn() }));
vi.mock("../song/usePracticeHistory", () => ({ usePracticeHistory: () => archive }));
vi.mock("../listen/useInput", () => ({ useInput: () => shell.input }));
vi.mock("../overview/useSongSummaries", () => ({ useSongSummaries: () => shell.overview, cachedSong: () => undefined }));
vi.mock("../components/SongCoach", () => ({ openPractice: () => undefined }));
vi.mock("../components/GuitarNav", () => ({ GuitarNav: () => null }));
vi.mock("../components/Score", () => ({ Score: () => null }));
vi.mock("../components/FreePlay", () => ({ FreePlay: () => <div>standalone metronome</div> }));
vi.mock("../platform/PracticeWindowBoundary", () => ({ PracticeWindowBoundary: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../components/TuneView", () => ({
  TuneView: ({ launch }: { launch?: { kind: string; tuneId?: string; cardId?: string } }) => (
    <main data-tune={launch?.tuneId} data-launch={launch?.kind} data-card={launch?.cardId} />
  ),
}));

// Shell tests keep the real overview and routing; audio/session engines are separate boundaries.
const saved = new Map<string, string>();
let root: Root | undefined;
let host: HTMLDivElement | undefined;
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  shell.overview = { songs: [], currentTuneId: null, loading: true, error: null };
  archive.result = { status: "unavailable" };
  archive.retry.mockClear();
  // Exercise the browser compatibility regression during actual route changes below.
  vi.spyOn(window, "scrollTo").mockImplementation(() => Promise.resolve() as unknown as void);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.restoreAllMocks();
  retryStorageWrites();
  vi.unstubAllGlobals();
});

async function mountShell() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  return host;
}

async function press(label: string) {
  const button = [...host!.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  await act(async () => button!.click());
}

it("opens free play from the real overview without an imported tune and returns home", async () => {
  shell.overview.loading = false;
  const element = await mountShell();
  await press("Free play");
  expect(element.querySelector('[role="dialog"][aria-label="free play"]')).toBeTruthy();
  await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="leave free play"]')!.click());
  expect(element.querySelector(".tutor-actions")).toBeTruthy();
});

it("launches the selected song and exercise even when saving the selection fails", async () => {
  shell.overview = {
    loading: false, error: null, currentTuneId: "study-one",
    songs: [{
      tuneId: "study-one", title: "One Study", composer: "", key: "C", lastPlayed: null,
      boxes: [0, 0, 0, 0, 0], fresh: 1, due: 0, mastered: 0, total: 1,
      path: { ready: 0, total: 0, share: 0, milestones: [] },
      next: [{ id: "mel:new:2-3", family: "melody", title: "A particular passage", detail: "", group: "A", where: "bars 3–4", bpm: 72, box: 0, status: "next" }],
    }],
  };
  localStorage.setItem("guitar-tune", JSON.stringify("previous-song"));
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  const element = await mountShell();
  await press("A particular passage");
  expect(element.querySelector<HTMLElement>("main[data-launch]")?.dataset).toMatchObject({
    launch: "card", tune: "study-one", card: "mel:new:2-3",
  });
  expect(localStorage.getItem("guitar-tune")).toBe(JSON.stringify("previous-song"));
  expect(element.querySelector('[role="alert"]')).toBeTruthy();
});

it("keeps archive failures unknown with retry and resets history choices for another tune", async () => {
  const attempt: Attempt = { id: "mel:new:0-1", uid: "one", day: "2026-11-18", result: "clean", bpm: 80, share: 1, secs: 30, from: 0, to: 2 };
  const timed: Attempt = { ...attempt, arrangementFingerprint: "score-one", conditions: { v: 1, source: "measured", confidence: "unknown", tempo: "fixed", support: "none", notation: "visible", exposure: "repeated", uninterrupted: true }, ev: { notes: [4, 0], leap: [0, 0], cross: [0, 0], shift: [0, 0], restarts: 0, hears: 0, wrong: [], time: { n: 4, mean: 10, spread: 8, rush: 0, drag: 0 } } };
  const store: Store = { v: 1, cards: {}, sessions: [], settings: { newPerSession: 4, guide: false, voice: false, window: null }, history: [timed, { ...timed, uid: "changed", day: "2026-11-19", arrangementFingerprint: "score-two", bpm: 84 }, { ...attempt, uid: "two", id: "ear:1", conditions: { v: 1, source: "self", tempo: "own-pace", confidence: "unknown" } }] };
  archive.result = { status: "ready", tuneId: "one", excludesSharedSkills: true, store, exercises: groupPracticeHistory(store) };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<PracticeHistory tuneId="one" />));
  expect(host.querySelector('svg[role="img"] desc')?.textContent).toContain("2 observations");
  const filter = host.querySelectorAll("select")[1];
  await act(async () => { filter.value = filter.options[1].value; filter.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('svg[role="img"] desc')?.textContent).toContain("1 observation");
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "ear:1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector("select")?.value).toBe("ear:1");
  await act(async () => { [...host!.querySelectorAll("button")].find((button) => button.textContent?.includes("Show attempt log"))!.click(); });
  expect(host.querySelector("tbody")?.textContent).toContain("80 bpm reference");
  expect(host.querySelector('svg[role="img"]')).toBeNull();

  archive.result = { status: "too-large" };
  await act(async () => root!.render(<PracticeHistory tuneId="one" />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("unknown");
  expect(host.querySelector("select")).toBeNull();
  await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
  expect(archive.retry).toHaveBeenCalledOnce();

  const other = { ...store, history: [{ ...attempt, id: "mel:memory:4-7", uid: "other" }] };
  archive.result = { status: "ready", tuneId: "other", excludesSharedSkills: true, store: other, exercises: groupPracticeHistory(other) };
  await act(async () => root!.render(<PracticeHistory tuneId="other" />));
  expect(host.querySelector("select")?.value).toBe("mel:memory:4-7");
  expect(host.querySelector("table")).toBeNull();
});

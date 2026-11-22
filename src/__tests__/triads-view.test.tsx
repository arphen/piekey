// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InputApi } from "../listen/useInput";
import { TRIADS_KEY } from "../triads/box";

vi.mock("tone", () => ({ start: async () => undefined }));
vi.mock("../audio/context", () => ({ ensureAudio: () => undefined }));
vi.mock("../song/cues", () => ({ padChord: vi.fn() }));
vi.mock("../platform/PracticeWindowBoundary", () => ({ PracticeWindowBoundary: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { TriadsView } from "../components/TriadsView";

const input = { status: "idle", error: null, devices: [], deviceId: null, paused: false, setDeviceId() {}, start: async () => undefined, stop() {}, autoStart() {}, level: { current: 0 }, subscribe: () => () => undefined } as unknown as InputApi;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); }, removeItem: (k: string) => { kept.delete(k); }, key: () => null, length: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("asks I of C first, files a quick right answer a box up, and moves on to ii", async () => {
  await act(async () => root.render(<TriadsView input={input} />));
  expect(host.querySelector(".triads-roman")?.textContent).toBe("I");
  expect(host.querySelector(".triads-of")?.textContent).toBe("in C-Dur");
  const right = [...host.querySelectorAll<HTMLButtonElement>(".triads-choice")].find((b) => b.getAttribute("aria-label")?.endsWith("C · E · G"))!;
  await act(async () => right.click());
  expect(right.classList.contains("is-right")).toBe(true);
  expect(JSON.parse(localStorage.getItem(TRIADS_KEY)!).cards["triad:C:0"]).toMatchObject({ box: 2, seen: 1, right: 1 });
  await act(async () => { vi.advanceTimersByTime(700); });
  expect(host.querySelector(".triads-roman")?.textContent).toBe("ii");
  const wrong = [...host.querySelectorAll<HTMLButtonElement>(".triads-choice")].find((b) => !b.getAttribute("aria-label")?.endsWith("D · F · A"))!;
  await act(async () => wrong.click());
  expect(wrong.classList.contains("is-wrong")).toBe(true);
  expect(host.querySelector(".triads-result")?.textContent).toBe("D · F · A");
  expect(JSON.parse(localStorage.getItem(TRIADS_KEY)!).cards["triad:C:1"]).toMatchObject({ box: 1, right: 0 });
});

it("asks a well-known triad without choices at the guitar, and gives them back on request", async () => {
  localStorage.setItem(TRIADS_KEY, JSON.stringify({ v: 1, cards: { "triad:C:4": { box: 4, due: "2000-01-01", seen: 6, right: 6 } } }));
  const guitar = { ...input, status: "listening" } as InputApi;
  await act(async () => root.render(<TriadsView input={guitar} />));
  expect(host.querySelector(".triads-roman")?.textContent).toBe("V");
  expect(host.querySelector(".triads-play")?.textContent).toContain("Play it");
  expect(host.querySelectorAll(".triads-choice")).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>(".triads-play button")!.click());
  expect(host.querySelectorAll(".triads-choice")).toHaveLength(4);
});

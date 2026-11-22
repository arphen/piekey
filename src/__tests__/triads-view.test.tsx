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

const click = async (el: Element | null | undefined) => { await act(async () => (el as HTMLButtonElement).click()); };

it("asks I of C first, files a quick right answer a box up, and moves on to ii", async () => {
  await act(async () => root.render(<TriadsView input={input} />));
  await click(host.querySelector(".wheel-center"));
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
  await click(host.querySelector(".wheel-center"));
  expect(host.querySelector(".triads-roman")?.textContent).toBe("V");
  expect(host.querySelector(".triads-play")?.textContent).toContain("Play it");
  expect(host.querySelectorAll(".triads-choice")).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>(".triads-play button")!.click());
  expect(host.querySelectorAll(".triads-choice")).toHaveLength(4);
});

it("turns to a chosen key on the circle, unfolds its triads, and drills that key from the one chosen", async () => {
  await act(async () => root.render(<TriadsView input={input} />));
  expect(host.querySelectorAll(".wheel-key")).toHaveLength(26); // 13 major, 13 minor
  await click([...host.querySelectorAll(".wheel-key")].find((b) => b.getAttribute("aria-label")?.startsWith("e-Moll")));
  const degrees = [...host.querySelectorAll(".wheel-degree")];
  expect(degrees.map((b) => b.querySelector("b")?.textContent)).toEqual(["i", "ii°", "III", "iv", "V", "VI", "vii°"]);
  expect(degrees[4].querySelector("small")?.textContent).toBe("H Dis Fis");
  expect(host.querySelector(".wheel-panel-actions")?.textContent).toContain("G-Dur");
  await click(degrees[4]);
  expect(host.querySelector(".triads-focus")?.textContent).toBe("e-Moll");
  expect(host.querySelector(".triads-roman")?.textContent).toBe("V");
  expect(host.querySelector(".triads-of")?.textContent).toBe("in e-Moll");
  await click(host.querySelector(".triads-circle"));
  expect(host.querySelector(".wheel-center")?.textContent).toContain("Drill");
});

it("answers the pointer anywhere on a wedge, not only on its label", async () => {
  await act(async () => root.render(<TriadsView input={input} />));
  const wedges = host.querySelectorAll(".wheel-wedge");
  await act(async () => { wedges[3].dispatchEvent(new MouseEvent("click", { bubbles: true })); }); // the fourth major key, D
  expect(host.querySelector(".wheel-panel-key")?.textContent).toContain("D-Dur");
  await act(async () => { host.querySelectorAll(".wheel-degree-wedge")[4].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(host.querySelector(".triads-of")?.textContent).toBe("in D-Dur");
  expect(host.querySelector(".triads-roman")?.textContent).toBe("V");
});

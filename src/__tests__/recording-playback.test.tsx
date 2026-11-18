// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SongSummary } from "../overview/summary";
import { ProgressView } from "../components/ProgressView";

const sound = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(async () => undefined),
  source: { disconnect: vi.fn() },
  createSource: vi.fn(),
  connect: vi.fn(),
  destination: {},
}));
vi.mock("tone", () => ({
  start: sound.start,
  getContext: () => ({ rawContext: { createMediaElementSource: sound.createSource } }),
  getDestination: () => sound.destination,
  connect: sound.connect,
}));
vi.mock("../audio/context", () => ({ ensureAudio: vi.fn() }));
vi.mock("../audio/recorder", () => ({
  listTakes: async () => [
    { id: "first", tuneId: "study", cardId: "run", day: "2026-11-17", at: 1, bpm: 72, share: 1 },
    { id: "latest", tuneId: "study", cardId: "run", day: "2026-11-18", at: 2, bpm: 80, share: 1 },
  ],
  takeAudio: async () => new Blob(["recording"], { type: "audio/webm" }),
}));
vi.mock("../overview/useSongSummaries", () => ({
  useSongSummaries: () => ({
    songs: [{ tuneId: "study", title: "Study", lastPlayed: null, path: { ready: 0, total: 0, milestones: [] } } as unknown as SongSummary],
    currentTuneId: "study", loading: false, error: null,
  }),
  cachedSong: () => undefined,
}));
vi.mock("../components/GoalChooser", () => ({ GoalChooser: () => null }));

let root: Root | undefined;
let host: HTMLDivElement;
let media: HTMLAudioElement[];
let play: ReturnType<typeof vi.fn<() => Promise<void>>>;
let pause: ReturnType<typeof vi.fn>;
let created: ReturnType<typeof vi.fn>;
let revoked: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  sound.start.mockResolvedValue(undefined);
  sound.createSource.mockReturnValue(sound.source);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  let counter = 0;
  created = vi.fn(() => `blob:take-${++counter}`);
  revoked = vi.fn();
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = created; static revokeObjectURL = revoked; });
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  media = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options);
    if (tag === "audio") {
      const audio = element as HTMLAudioElement;
      Object.defineProperties(audio, {
        duration: { configurable: true, value: 120 },
        play: { configurable: true, value: play },
        pause: { configurable: true, value: pause },
        load: { configurable: true, value: vi.fn() },
      });
      media.push(audio);
    }
    return element;
  });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  root = createRoot(host);
  await act(async () => root!.render(<ProgressView onOpenSong={() => undefined} onStartPractice={() => undefined} />));
}
async function press(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}

it("plays and compares through one shared output with reachable pause, restart and seeking controls", async () => {
  await mount();
  await press("Play reference recording");
  expect(media).toHaveLength(1);
  expect(sound.connect).toHaveBeenCalledWith(sound.source, sound.destination);
  const audio = media[0];
  await act(async () => { audio.currentTime = 24; audio.dispatchEvent(new Event("timeupdate")); });
  await press("Pause reference recording");
  expect(pause).toHaveBeenCalled();
  expect(audio.currentTime).toBe(24);
  await press("Play reference recording");
  expect(audio.currentTime).toBe(24);
  await press("Reference: forward 10 seconds");
  expect(audio.currentTime).toBe(34);
  expect(host.querySelector('[aria-label="Reference playback position"]')?.textContent).toBe("0:34 / 2:00");
  Object.defineProperty(audio, "duration", { configurable: true, value: Infinity });
  await act(async () => audio.dispatchEvent(new Event("durationchange")));
  await press("Reference: back 10 seconds");
  expect(audio.currentTime).toBe(24);
  expect(host.querySelector('[aria-label="Reference playback position"]')?.textContent).toBe("0:24 / —");
  Object.defineProperty(audio, "seekable", { configurable: true, value: { length: 1, end: () => 30 } });
  await act(async () => audio.dispatchEvent(new Event("durationchange")));
  await press("Reference: forward 10 seconds");
  expect(audio.currentTime).toBe(30);
  expect(host.querySelector('[aria-label="Reference playback position"]')?.textContent).toBe("0:30 / —");
  await press("Play comparison recording");
  expect(media).toHaveLength(1);
  expect(audio.getAttribute("src")).toBe("blob:take-2");
  expect(host.querySelector('[aria-label="Play reference recording"]')).toBeTruthy();
  await press("Restart comparison recording");
  expect(audio.currentTime).toBe(0);
  await act(async () => audio.dispatchEvent(new Event("ended")));
  expect(host.querySelector('[aria-label="Play comparison recording"]')).toBeTruthy();
});

it("stops on comparison changes, ignores a stale start, and releases media and Blob URLs on exit", async () => {
  let resume!: () => void;
  sound.start.mockReturnValueOnce(new Promise<void>((resolve) => { resume = resolve; }));
  await mount();
  await press("Play reference recording");
  const audio = media[0];
  const compare = host.querySelectorAll<HTMLSelectElement>(".progress-take-choices select")[1];
  await act(async () => { compare.value = "first"; compare.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(audio.hasAttribute("src")).toBe(false);
  await act(async () => resume());
  expect(host.querySelector('[aria-label="Pause reference recording"]')).toBeNull();
  expect(revoked).toHaveBeenCalledWith("blob:take-2");
  play.mockRejectedValueOnce(new Error("blocked"));
  await press("Play reference recording");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Audio could not start");
  await act(async () => root!.unmount());
  root = undefined;
  expect(sound.source.disconnect).toHaveBeenCalled();
  expect(revoked).toHaveBeenCalledWith("blob:take-1");
  expect(audio.hasAttribute("src")).toBe(false);
});

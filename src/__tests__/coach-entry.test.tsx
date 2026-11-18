// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setInputSetup } from "../audio/setup";
import { SongCoach } from "../components/SongCoach";
import type { InputApi } from "../listen/useInput";
import { buildDeck } from "../song/deck";
import { loadStore } from "../song/leitner";
import type { SessionApi } from "../song/useSession";
import { parseTuneEntry } from "../tunes/library";
import { buildTimeline } from "../tunes/order";
import { STARTER_ENTRY } from "../tunes/starter";

const mocked = vi.hoisted(() => ({ session: undefined as unknown as SessionApi, calibrated: false }));

vi.mock("../song/useSession", () => ({ useSession: () => mocked.session }));
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

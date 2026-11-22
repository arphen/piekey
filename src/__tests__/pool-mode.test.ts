// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cycleRoomMode, nextRoomMode, parseRoomMode, resetRoomForTests, resolveRoom, ROOM_MODES } from "../pool/mode";
import { readPower, resetPowerForTests, subscribePower } from "../pool/power";

const base = { power: "unknown" as const, capable: true, degraded: false, reducedMotion: false };

describe("room render mode", () => {
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); resetRoomForTests(); resetPowerForTests(); });

  it("carries an earlier rendered-water switch over until a mode is chosen, and otherwise lives on power", () => {
    expect(parseRoomMode(null, null)).toBe("living-power");
    expect(parseRoomMode(null, "on")).toBe("water");
    expect(parseRoomMode(null, "off")).toBe("still");
    expect(parseRoomMode("living", "on")).toBe("living");
    expect(parseRoomMode("garbage", "on")).toBe("living-power");
  });

  it("cycles still, water, living, living on power, and stores the choice beside the legacy key", () => {
    expect(ROOM_MODES.map(nextRoomMode)).toEqual(["water", "living", "living-power", "still"]);
    localStorage.setItem("guitar-rendered-room", "on");
    cycleRoomMode();
    expect(localStorage.getItem("guitar-room-render")).toBe("living");
    expect(localStorage.getItem("guitar-rendered-room")).toBe("on");
  });

  it("runs Living on power only while plugged in and says why it rests as water", () => {
    expect(resolveRoom({ ...base, mode: "living-power", power: "plugged" })).toMatchObject({ effective: "living", value: "Living on power" });
    expect(resolveRoom({ ...base, mode: "living-power", power: "battery" })).toMatchObject({ effective: "water", value: "Living on power · water on battery" });
    expect(resolveRoom({ ...base, mode: "living-power", power: "unknown" })).toMatchObject({ effective: "water", value: "Living on power · not detectable here" });
    expect(resolveRoom({ ...base, mode: "living", power: "battery" }).effective).toBe("living");
    expect(resolveRoom({ ...base, mode: "living", capable: false })).toMatchObject({ effective: "water", value: "Living · unavailable on this GPU" });
    expect(resolveRoom({ ...base, mode: "living", degraded: true }).effective).toBe("water");
  });

  it("keeps the chosen room for reduced motion but stops its animation", () => {
    expect(resolveRoom({ ...base, mode: "living", reducedMotion: true })).toMatchObject({ effective: "living", animate: false });
    expect(resolveRoom({ ...base, mode: "still", reducedMotion: true })).toMatchObject({ effective: "still", animate: false });
  });
});

describe("power source", () => {
  afterEach(() => { resetPowerForTests(); delete (navigator as { getBattery?: unknown }).getBattery; });

  const battery = (charging: boolean) => {
    const target = new EventTarget() as EventTarget & { charging: boolean };
    target.charging = charging;
    (navigator as { getBattery?: unknown }).getBattery = () => Promise.resolve(target);
    return target;
  };

  it("follows the charger through the Battery Status API", async () => {
    const b = battery(true);
    const stop = subscribePower(() => undefined);
    await Promise.resolve(); await Promise.resolve();
    expect(readPower()).toBe("plugged");
    b.charging = false;
    b.dispatchEvent(new Event("chargingchange"));
    expect(readPower()).toBe("battery");
    stop();
  });

  it("stays unknown where the API does not exist", async () => {
    const stop = subscribePower(() => undefined);
    await Promise.resolve();
    expect(readPower()).toBe("unknown");
    stop();
  });
});

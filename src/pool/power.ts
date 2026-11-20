import { useSyncExternalStore } from "react";

// Whether this laptop is on mains power. Only Chromium exposes the Battery Status API; elsewhere
// the source stays "unknown" and "Living on power" behaves like Water.
export type PowerSource = "plugged" | "battery" | "unknown";

interface BatteryLike extends EventTarget { charging: boolean }
type BatteryNavigator = { getBattery?: () => Promise<BatteryLike> };

let source: PowerSource = "unknown";
let started = false;
const listeners = new Set<() => void>();

function set(next: PowerSource) {
  if (next === source) return;
  source = next;
  listeners.forEach((listener) => listener());
}

function start() {
  if (started) return;
  started = true;
  const nav = typeof navigator === "undefined" ? undefined : (navigator as unknown as BatteryNavigator);
  if (typeof nav?.getBattery !== "function") return;
  void nav.getBattery().then((battery) => {
    const update = () => set(battery.charging ? "plugged" : "battery");
    update();
    battery.addEventListener("chargingchange", update);
  }).catch(() => undefined);
}

export function readPower(): PowerSource { return source; }

export function subscribePower(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePowerSource(): PowerSource {
  return useSyncExternalStore(subscribePower, readPower, () => "unknown");
}

/** Tests replace navigator.getBattery between cases. */
export function resetPowerForTests(): void {
  source = "unknown";
  started = false;
  listeners.clear();
}

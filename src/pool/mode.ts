import { useSyncExternalStore } from "react";
import { subscribePower, readPower, type PowerSource } from "./power";

// How the practice room is drawn is a preference for this device, like its audio route. It is
// not one of the syncable keys (src/sync/model.ts), so it stays out of exchange and backup.
export type RoomMode = "still" | "water" | "living" | "living-power";
export type RoomEffective = "still" | "water" | "living";
export const ROOM_MODES: readonly RoomMode[] = ["still", "water", "living", "living-power"];

const KEY = "guitar-room-render";
const LEGACY = "guitar-rendered-room"; // the earlier on/off switch, read only to carry it over
const CHANGE = "guitar-room-render-change";
const VALUE: Record<RoomMode, string> = { still: "Still", water: "Water", living: "Living", "living-power": "Living on power" };

let transient: RoomMode | undefined;
let capability: boolean | undefined;
let degraded = false;
const degradedListeners = new Set<() => void>();

const isMode = (value: string | null): value is RoomMode => ROOM_MODES.includes(value as RoomMode);

/**
 * The stored mode; an earlier "Rendered water: on" reads as Water until a mode is chosen. With
 * nothing chosen the pool lives while the laptop is plugged in (water on battery, or where the
 * GPU cannot), so the room can dance without asking for it.
 */
export function parseRoomMode(stored: string | null, legacy: string | null): RoomMode {
  if (isMode(stored)) return stored;
  return stored === null && legacy === "on" ? "water" : stored === null && legacy === "off" ? "still" : "living-power";
}

export const nextRoomMode = (mode: RoomMode): RoomMode => ROOM_MODES[(ROOM_MODES.indexOf(mode) + 1) % ROOM_MODES.length];

function readMode(): RoomMode {
  if (transient !== undefined) return transient;
  try { return parseRoomMode(localStorage.getItem(KEY), localStorage.getItem(LEGACY)); } catch { return "living-power"; }
}

function subscribeMode(listener: () => void): () => void {
  const changed = (event: StorageEvent) => { if (event.key === KEY || event.key === LEGACY || event.key === null) { transient = undefined; listener(); } };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", changed);
  return () => { window.removeEventListener(CHANGE, listener); window.removeEventListener("storage", changed); };
}

export function setRoomMode(mode: RoomMode): void {
  try { localStorage.setItem(KEY, mode); transient = undefined; }
  catch { transient = mode; }
  window.dispatchEvent(new Event(CHANGE));
}

export const cycleRoomMode = (): void => setRoomMode(nextRoomMode(readMode()));

/** WebGL2 with a renderable half-float colour buffer, and not a software rasteriser. Probed once. */
export function probeLiving(): boolean {
  if (capability !== undefined) return capability;
  capability = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (gl) {
      capability = Boolean(gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("EXT_color_buffer_float"));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch { /* no GPU access: the lighter rooms remain */ }
  return capability;
}

/** A second context loss, or a GPU too slow even at the lowest tier, rests the pool as Water for this visit. */
export function markLivingDegraded(): void {
  if (degraded) return;
  degraded = true;
  degradedListeners.forEach((listener) => listener());
}

function subscribeDegraded(listener: () => void): () => void {
  degradedListeners.add(listener);
  return () => { degradedListeners.delete(listener); };
}

export interface RoomInputs { mode: RoomMode; power: PowerSource; capable: boolean; degraded: boolean; reducedMotion: boolean }
export interface RoomResolution { effective: RoomEffective; animate: boolean; value: string }

export function resolveRoom({ mode, power, capable, degraded: rested, reducedMotion }: RoomInputs): RoomResolution {
  const animate = !reducedMotion;
  if (mode === "still" || mode === "water") return { effective: mode, animate, value: VALUE[mode] };
  let reason = "";
  if (!capable) reason = "unavailable on this GPU";
  else if (rested) reason = "resting as water";
  else if (mode === "living-power" && power === "unknown") reason = "not detectable here";
  else if (mode === "living-power" && power === "battery") reason = "water on battery";
  return { effective: reason ? "water" : "living", animate, value: reason ? `${VALUE[mode]} · ${reason}` : VALUE[mode] };
}

const motionQuery = () => typeof window === "undefined" ? undefined : window.matchMedia?.("(prefers-reduced-motion: reduce)");
function subscribeMotion(listener: () => void): () => void {
  const query = motionQuery();
  query?.addEventListener?.("change", listener);
  return () => query?.removeEventListener?.("change", listener);
}
const readMotion = () => Boolean(motionQuery()?.matches);
const quiet = () => () => undefined;
const unknownPower = (): PowerSource => "unknown";
const readDegraded = () => degraded;

export function useRoomRender(): RoomResolution & { mode: RoomMode; cycle(): void; set(mode: RoomMode): void } {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => "still" as RoomMode);
  // The battery is asked only when the chosen mode depends on it.
  const power = useSyncExternalStore(mode === "living-power" ? subscribePower : quiet, mode === "living-power" ? readPower : unknownPower, unknownPower);
  const rested = useSyncExternalStore(subscribeDegraded, readDegraded, () => false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, () => false);
  const living = mode === "living" || mode === "living-power";
  return { mode, cycle: cycleRoomMode, set: setRoomMode, ...resolveRoom({ mode, power, capable: living ? probeLiving() : true, degraded: rested, reducedMotion }) };
}

/** Tests reset module state between cases. */
export function resetRoomForTests(): void {
  transient = undefined;
  capability = undefined;
  degraded = false;
}

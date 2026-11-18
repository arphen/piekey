import type { PairedDevice } from "./transport";

export interface RememberedDevice extends PairedDevice { lastSynced: number }
export interface DevicePreferences { name: string; peers: RememberedDevice[]; appUrl: string }
const KEY = "fretboard-focus-devices-v1";

export function loadDevicePreferences(): DevicePreferences {
  const name = /iPhone|Android.*Mobile/.test(navigator.userAgent) ? "Phone" : /iPad/.test(navigator.userAgent) ? "Tablet" : /Macintosh/.test(navigator.userAgent) ? "Mac" : "Computer";
  const appUrl = /^(localhost|127\..*|\[::1\])$/.test(location.hostname) ? "" : `${location.origin}${location.pathname}`;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DevicePreferences> | null;
    return { name: typeof saved?.name === "string" && saved.name.trim() ? saved.name.slice(0, 60) : name, appUrl: typeof saved?.appUrl === "string" ? saved.appUrl : appUrl,
      peers: Array.isArray(saved?.peers) ? saved.peers.filter((peer) => peer && typeof peer.deviceId === "string"
        && typeof peer.name === "string" && typeof peer.peerId === "string" && typeof peer.secret === "string"
        && typeof peer.lastSynced === "number") : [] };
  } catch { return { name, peers: [], appUrl }; }
}

/** Pairing keys belong to this browser and are intentionally outside portable practice data. */
export function saveDevicePreferences(preferences: DevicePreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); }
  catch { throw new Error("This browser could not remember the pairing. Free browser storage and pair again."); }
}

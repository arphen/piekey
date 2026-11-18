/// <reference types="vite/client" />
import { whilePracticeIdle } from "./platform/practiceWindow";

export type OfflineState = "unavailable" | "development" | "preparing" | "ready" | "error" | "update-ready";
export interface OfflineSnapshot { state: OfflineState; message: string; checking: boolean }
let snapshot: OfflineSnapshot = { state: import.meta.env.PROD ? "preparing" : "development", message: import.meta.env.PROD ? "Preparing offline shell…" : "Development server · offline shell is not installed here.", checking: false };
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let started = false;
const set = (state: OfflineState, message: string, checking = false) => {
  snapshot = { state, message, checking };
  listeners.forEach((listener) => listener());
};
export const getOfflineSnapshot = (): OfflineSnapshot => snapshot;
export function subscribeOffline(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

function readRegistration(): void {
  if (!registration) return;
  if (registration.waiting && registration.active) set("update-ready", "Update downloaded. Close every app window, then reopen to use it.");
  else if (registration.active?.state === "activated") set("ready", "App shell available offline on this browser.");
  else set("preparing", "Preparing offline shell… Keep this window open until it is ready.");
}
function watchWorker(worker: ServiceWorker | null): void {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "redundant" && !registration?.active) set("error", "Offline shell installation failed. Keep an online connection and retry.");
    else readRegistration();
  });
}

async function installShell(): Promise<void> {
  set("preparing", "Preparing offline shell…");
  try {
    const value = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" });
    registration = value;
    watchWorker(value.installing);
    value.addEventListener("updatefound", () => { watchWorker(value.installing); readRegistration(); });
    navigator.serviceWorker.addEventListener("controllerchange", readRegistration);
    readRegistration();
  } catch {
    set("error", "Offline shell could not be installed. The app can still be used online; retry when connected.");
  }
}

/** Installation never calls skipWaiting or reload. Updates activate after all old clients close. */
export function registerOfflineShell(): void {
  if (started) return;
  started = true;
  if (!import.meta.env.PROD) return;
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    set("unavailable", "Offline shell unavailable here. Use a supported browser over HTTPS.");
    return;
  }
  const register = () => { void installShell(); };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

export async function checkForOfflineUpdate(): Promise<void> {
  if (snapshot.checking || snapshot.state === "development" || snapshot.state === "unavailable") return;
  const previous = snapshot;
  set(snapshot.state, "Checking for an app update…", true);
  try {
    const idle = await whilePracticeIdle(() => registration ? registration.update().then(() => undefined) : installShell());
    if (!idle) set(previous.state, navigator.locks ? "Finish practice in every app window before checking for updates." : "This browser cannot verify idle practice windows for an update check.");
    else if (registration) readRegistration();
  } catch {
    set(previous.state === "ready" || previous.state === "update-ready" ? previous.state : "error", "Update check failed. Try again with an online connection.");
  }
}

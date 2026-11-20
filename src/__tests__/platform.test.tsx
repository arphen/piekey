// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import { createPracticeWindow, keepPracticeWrite, settlePracticeWrites, subscribePracticeRecovery, whilePracticeIdle, type PracticeWindowOptions } from "../platform/practiceWindow";
import { retryPendingTakes, saveTake } from "../audio/recorder";
import { retryStorageWrites, setStoredItem } from "../storage";
import { EarHub } from "../components/EarHub";
import type { InputApi } from "../listen/useInput";

const { quizMounted } = vi.hoisted(() => ({ quizMounted: vi.fn() }));
vi.mock("../components/EarView", () => ({ EarView: () => { quizMounted(); return <span>Quiz writer</span>; } }));
vi.mock("../components/FocusView", () => ({ FocusView: ({ extra }: { extra: { label: string; onOpen(): void } }) => <button type="button" onClick={extra.onOpen}>{extra.label}</button> }));

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
class Locks {
  held = false;
  async request(_name: string, _options: { ifAvailable: true }, callback: (lock: unknown | null) => Promise<void>) {
    await Promise.resolve();
    if (this.held) return callback(null);
    this.held = true;
    try { return await callback({}); } finally { this.held = false; }
  }
}
type Message = Parameters<Parameters<PracticeWindowOptions["listen"]>[0]>[0];
function messaging() {
  const listeners = new Set<(message: Message) => void>();
  return (receive: (message: Message) => void) => {
    listeners.add(receive);
    return {
      send(message: Message) { for (const listener of listeners) queueMicrotask(() => { if (listeners.has(listener)) listener(message); }); },
      close() { listeners.delete(receive); },
    };
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); Reflect.deleteProperty(navigator, "locks"); Reflect.deleteProperty(navigator, "serviceWorker"); });

describe("one practice window", () => {
  it("keeps an unconfirmed initial busy claim in checking while an old local lock releases", async () => {
    const locks = new Locks(); locks.held = true;
    const changed = vi.fn();
    const practice = createPracticeWindow({ locks, listen: messaging(), id: "remounted", changed, beforeRelease: async () => undefined });
    practice.start(); await flush();
    expect(practice.getSnapshot().state).toBe("checking");
    expect(locks.held).toBe(true);
    locks.held = false;
    practice.poll(); await flush();
    expect(practice.getSnapshot().state).toBe("active");
    expect(changed.mock.calls.map(([snapshot]) => snapshot.state)).not.toContain("blocked");
    practice.stop(); await flush();
  });

  it("keeps the Ear quiz writer unmounted until ownership and preserves the echo-card exit", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const locks = new Locks(); locks.held = true;
    Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
    quizMounted.mockClear();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<EarHub input={{} as InputApi} />); });
      await act(async () => { host.querySelector("button")!.click(); await flush(); });
      expect(quizMounted).not.toHaveBeenCalled();
      const back = [...host.querySelectorAll("button")].find((button) => button.textContent === "Back to browsing")!;
      await act(async () => { back.click(); await flush(); });
      expect(host.textContent).toContain("Chord quiz");
      locks.held = false;
      await act(async () => { host.querySelector("button")!.click(); await flush(); });
      expect(host.textContent).toContain("Quiz writer");
      await act(async () => { host.querySelector("button")!.click(); await flush(); });
      expect(host.textContent).toContain("Chord quiz");
    } finally { await act(async () => { root.unmount(); await flush(); }); }
  });

  it("admits one simultaneous claimant and waits for teardown and saves before explicit handoff", async () => {
    const locks = new Locks();
    const listen = messaging();
    const saved = deferred();
    const first = createPracticeWindow({ locks, listen, id: "first", changed() {}, beforeRelease: () => saved.promise });
    const second = createPracticeWindow({ locks, listen, id: "second", changed() {}, beforeRelease: async () => undefined });
    first.start(); second.start();
    await flush();
    expect([first.getSnapshot().state, second.getSnapshot().state]).toEqual(["active", "blocked"]);
    second.retry();
    await flush();
    expect(first.getSnapshot().state).toBe("yielding");
    second.poll(); await flush();
    expect(second.getSnapshot().state).toBe("blocked");
    saved.resolve(); await flush();
    second.poll(); await flush();
    expect(second.getSnapshot().state).toBe("active");
    first.poll(); await flush();
    expect(first.getSnapshot().state).toBe("blocked");
    first.stop(); second.stop(); await flush();
  });

  it("recovers a released owner and cancels an acquisition that completed after unmount", async () => {
    const locks = new Locks();
    const listen = messaging();
    const options = { locks, listen, changed() {}, beforeRelease: async () => undefined };
    const gone = createPracticeWindow({ ...options, id: "gone" });
    gone.start(); gone.stop(); await flush();
    expect(locks.held).toBe(false);
    const owner = createPracticeWindow({ ...options, id: "owner" });
    const waiting = createPracticeWindow({ ...options, id: "waiting" });
    owner.start(); waiting.start(); await flush();
    owner.stop(); await flush(); waiting.poll(); await flush();
    expect(waiting.getSnapshot().state).toBe("active");
    waiting.stop(); await flush();
  });

  it("keeps ownership when teardown cannot save, and never treats missing Web Locks as exclusive", async () => {
    const locks = new Locks();
    const listen = messaging();
    let failed = true;
    const first = createPracticeWindow({ locks, listen, id: "first", changed() {}, beforeRelease: async () => { if (failed) throw new Error("not saved"); } });
    const second = createPracticeWindow({ locks, listen, id: "second", changed() {}, beforeRelease: async () => undefined });
    first.start(); second.start(); await flush(); second.retry(); await flush();
    expect(first.getSnapshot()).toEqual({ state: "error", message: "not saved" });
    second.poll(); await flush(); expect(second.getSnapshot().state).toBe("blocked");
    failed = false; first.retry(); await flush(); second.poll(); await flush();
    expect(second.getSnapshot().state).toBe("active");
    const unsupported = createPracticeWindow({ listen, id: "unsupported", changed() {}, beforeRelease: async () => undefined });
    unsupported.start(); unsupported.retry(); await flush();
    expect(unsupported.getSnapshot().state).toBe("unsupported");
    unsupported.stop(); first.stop(); second.stop(); await flush();
  });

  it("holds the same writer lock throughout an idle restore and refuses mutation during practice", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: new Locks() });
    const commit = deferred();
    const writing = whilePracticeIdle(() => commit.promise);
    await flush();
    const mutate = vi.fn(async () => undefined);
    expect(await whilePracticeIdle(mutate)).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    const owner = createPracticeWindow({ locks: navigator.locks, listen: messaging(), id: "practice", changed() {}, beforeRelease: async () => undefined });
    owner.start(); await flush();
    expect(owner.getSnapshot().state).toBe("checking"); // an idle save has not announced a practice owner
    commit.resolve(); expect(await writing).toBe(true);
    owner.poll(); await flush();
    expect(owner.getSnapshot().state).toBe("active");
    expect(await whilePracticeIdle(mutate)).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    owner.stop(); await flush();
  });

  it("retains a detached owner's lock for failed audio and progress, then releases when recovery succeeds", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("indexedDB", { open() { throw new Error("full"); } });
    const storageWrite = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(setStoredItem("platform-recovery-test", "progress", false)).toBe(false);
    storageWrite.mockRestore();
    await saveTake({ id: "platform-pending", tuneId: "tune", cardId: "run", day: "2026-11-18", at: 1, bpm: 80, share: 1 }, new Blob(["audio"]));
    const locks = new Locks();
    const listen = messaging();
    const owner = createPracticeWindow({ locks, listen, id: "closed", changed() {}, beforeRelease: settlePracticeWrites, subscribeRecovery: subscribePracticeRecovery });
    const waiting = createPracticeWindow({ locks, listen, id: "waiting", changed() {}, beforeRelease: async () => undefined });
    owner.start(); waiting.start(); await flush(); owner.stop(); await flush();
    expect(owner.getSnapshot().state).toBe("error");
    expect(locks.held).toBe(true);
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await retryPendingTakes()).toBe(true);
    await flush(); waiting.poll(); await flush();
    expect(waiting.getSnapshot().state).toBe("blocked"); // progress is still unsaved
    expect(retryStorageWrites()).toBe(true);
    await flush(); waiting.poll(); await flush();
    expect(waiting.getSnapshot().state).toBe("active");
    waiting.stop(); await flush(); localStorage.removeItem("platform-recovery-test");
  });

  it("unmounts the old engine before releasing its lock and waits for cleanup recording saves", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(navigator, "locks", { configurable: true, value: new Locks() });
    const listen = messaging();
    vi.stubGlobal("BroadcastChannel", class {
      onmessage: ((event: { data: Message }) => void) | null = null;
      bus = listen((data) => this.onmessage?.({ data }));
      postMessage(message: Message) { this.bus.send(message); }
      close() { this.bus.close(); }
    });
    const save = deferred();
    function Engine({ name }: { name: string }) {
      useEffect(() => () => { if (name === "first") keepPracticeWrite(save.promise); }, [name]);
      return <span>{name} engine</span>;
    }
    const hosts = [document.createElement("div"), document.createElement("div")];
    const roots = hosts.map((host) => createRoot(host));
    try {
      await act(async () => { roots[0].render(<PracticeWindowBoundary onExit={() => undefined}><Engine name="first" /></PracticeWindowBoundary>); await flush(); });
      await act(async () => { roots[1].render(<PracticeWindowBoundary onExit={() => undefined}><Engine name="second" /></PracticeWindowBoundary>); await flush(); });
      expect(hosts[0].textContent).toContain("first engine");
      expect(hosts[1].textContent).not.toContain("second engine");
      await act(async () => { hosts[1].querySelector("button")!.click(); await flush(); });
      expect(hosts[0].textContent).not.toContain("first engine");
      expect(hosts[1].textContent).not.toContain("second engine");
      await act(async () => { save.resolve(); await flush(); });
      // Release messaging wakes the claimant; a poll also recovers a closed/crashed owner.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1050)); });
      expect(hosts[1].textContent).toContain("second engine");
    } finally {
      save.resolve();
      await act(async () => { roots.forEach((root) => root.unmount()); await flush(); });
    }
  });
});

describe("offline shell visibility", () => {
  it("reports development honestly and does not register a worker", async () => {
    vi.resetModules(); vi.stubEnv("PROD", false);
    const pwa = await import("../pwa");
    pwa.registerOfflineShell();
    expect(pwa.getOfflineSnapshot().state).toBe("development");
  });

  it("observes installed/update-waiting workers and refuses update checks while practice owns the lock", async () => {
    vi.resetModules(); vi.stubEnv("PROD", true); vi.stubGlobal("isSecureContext", true);
    const locks = new Locks();
    Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
    const active = new EventTarget() as ServiceWorker;
    Object.defineProperty(active, "state", { configurable: true, value: "activated" });
    const registration = Object.assign(new EventTarget(), { active, waiting: null as ServiceWorker | null, installing: null, update: vi.fn(async () => undefined) });
    const serviceWorker = Object.assign(new EventTarget(), { register: vi.fn(async () => registration) });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    const pwa = await import("../pwa");
    pwa.registerOfflineShell(); window.dispatchEvent(new Event("load")); await flush();
    expect(pwa.getOfflineSnapshot().state).toBe("ready");
    locks.held = true; await pwa.checkForOfflineUpdate();
    expect(registration.update).not.toHaveBeenCalled();
    locks.held = false;
    registration.waiting = active;
    await pwa.checkForOfflineUpdate();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(pwa.getOfflineSnapshot().state).toBe("update-ready");
    expect(pwa.getOfflineSnapshot().message).toContain("Close all windows");
  });

  it("makes registration failures visible and lets an idle user retry installation", async () => {
    vi.resetModules(); vi.stubEnv("PROD", true); vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "locks", { configurable: true, value: new Locks() });
    const registration = Object.assign(new EventTarget(), { active: { state: "activated" }, waiting: null, installing: null });
    const register = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(registration);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: Object.assign(new EventTarget(), { register }) });
    const pwa = await import("../pwa");
    pwa.registerOfflineShell(); window.dispatchEvent(new Event("load")); await flush();
    expect(pwa.getOfflineSnapshot().state).toBe("error");
    await pwa.checkForOfflineUpdate();
    expect(register).toHaveBeenCalledTimes(2);
    expect(pwa.getOfflineSnapshot().state).toBe("ready");
  });
});

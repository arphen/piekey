import { pendingStorageWrites, retryStorageWrites, subscribeStorageIssues } from "../storage";
import { getPendingTakes, retryPendingTakes, subscribeRecordingSaves } from "../audio/recorder";

/** Origin-scoped: installed and ordinary browser windows share this browser-managed lock. */
export const PRACTICE_LOCK = "fretboard-focus:practice";
const MESSAGE_KEY = "fretboard-focus:practice-message";

export type PracticeWindowState = "checking" | "active" | "blocked" | "yielding" | "unsupported" | "error";
export interface PracticeWindowSnapshot { state: PracticeWindowState; message: string }
type Message = { type: "query" | "owner" | "handoff" | "released"; from: string; to?: string };
interface Messenger { send(message: Message): void; close(): void }
interface LockSource {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown | null) => Promise<void>): Promise<unknown>;
}
export interface PracticeWindowOptions {
  locks?: LockSource;
  id: string;
  listen(receive: (message: Message) => void): Messenger;
  changed(snapshot: PracticeWindowSnapshot): void;
  /** Resolve after the protected React subtree has unmounted and its writes have settled. */
  beforeRelease(): Promise<void>;
  /** Notify only when an earlier failed save has actually recovered; do not retry failed writes in a loop. */
  subscribeRecovery?(listener: () => void): () => void;
}

const writes = new Set<Promise<unknown>>();
let localOwners = 0;
const presenceListeners = new Set<() => void>();
export const getLocalPracticeActive = (): boolean => localOwners > 0;
export function subscribeLocalPractice(listener: () => void): () => void {
  presenceListeners.add(listener);
  return () => { presenceListeners.delete(listener); };
}
function presence(change: 1 | -1): void {
  localOwners += change;
  presenceListeners.forEach((listener) => listener());
}

/** Track the entire stop-and-save promise; ownership waits for these writes before handoff. */
export function keepPracticeWrite<T>(write: Promise<T>): Promise<T> {
  writes.add(write);
  void write.then(() => writes.delete(write), () => writes.delete(write));
  return write;
}
export async function settlePracticeWrites(): Promise<void> {
  while (writes.size) await Promise.allSettled([...writes]);
  if (getPendingTakes().length && !await retryPendingTakes()) throw new Error("A recording is still waiting to save. Keep this window open and retry its recording before continuing elsewhere.");
  if (pendingStorageWrites().size && !retryStorageWrites()) throw new Error("Practice changes are still waiting to save. Retry saving in this window before continuing elsewhere.");
}

/** A detached owner can finish releasing after SaveNotice succeeds, without repeatedly writing into full storage. */
export function subscribePracticeRecovery(listener: () => void): () => void {
  let closed = false;
  const check = () => { if (!closed && !getPendingTakes().length && !pendingStorageWrites().size) listener(); };
  const storage = subscribeStorageIssues(check);
  const recordings = subscribeRecordingSaves(check);
  queueMicrotask(check); // also cover a save that recovered just before the subscriptions attached
  return () => { closed = true; storage(); recordings(); };
}

/** Expiring leases cannot protect against a suspended owner resuming after expiry. Without
 * atomic Web Locks, practice stays closed and browsing remains available. BroadcastChannel
 * (or storage events) carries handoff requests only; it never decides ownership.
 */
export function createPracticeWindow(options: PracticeWindowOptions) {
  let snapshot: PracticeWindowSnapshot = { state: "checking", message: "Checking practice windows…" };
  let stopped = false;
  let desired = true;
  let requesting = false;
  let owner = "";
  let handoff = false;
  let held = false;
  let releasing = false;
  let unlock: (() => void) | undefined;
  let recovered: (() => void) | undefined;
  const set = (state: PracticeWindowState, message: string) => {
    snapshot = { state, message };
    if (!stopped) options.changed(snapshot);
  };
  const messenger = options.listen((message) => {
    if (message.from === options.id) return;
    if (message.type === "query" && held && !releasing) messenger.send({ type: "owner", from: options.id, to: message.from });
    if (message.type === "owner" && (!message.to || message.to === options.id)) {
      owner = message.from;
      if (handoff) {
        handoff = false;
        messenger.send({ type: "handoff", from: options.id, to: owner });
      }
    }
    if (message.type === "handoff" && message.to === options.id && held) {
      desired = false;
      void release();
    }
    if (message.type === "released" && desired) void attempt();
  });
  async function release(): Promise<void> {
    if (!held || releasing) return;
    releasing = true;
    set("yielding", "Finishing saves before releasing practice…");
    try {
      await options.beforeRelease();
      recovered?.(); recovered = undefined;
      unlock?.();
    } catch (error) {
      releasing = false;
      set("error", error instanceof Error ? error.message : "Practice could not finish saving. Keep this window open and retry.");
      recovered ??= options.subscribeRecovery?.(() => {
        recovered?.(); recovered = undefined;
        void release();
      });
    }
  }
  async function attempt(): Promise<void> {
    if (stopped || !desired || held || requesting || !options.locks) return;
    requesting = true;
    try {
      await options.locks.request(PRACTICE_LOCK, { ifAvailable: true }, async (lock) => {
        requesting = false;
        if (stopped || !desired) return;
        if (!lock) {
          set("blocked", "Practice is open in another window. Continue here to move it to this window.");
          messenger.send({ type: "query", from: options.id });
          return;
        }
        held = true;
        presence(1);
        const hold = new Promise<void>((resolve) => { unlock = resolve; });
        set("active", "Practice is active in this window.");
        messenger.send({ type: "owner", from: options.id });
        await hold;
        held = false;
        presence(-1);
        unlock = undefined;
        releasing = false;
        if (!stopped) set("blocked", "Practice continued in another window. Continue here to move it back.");
        messenger.send({ type: "released", from: options.id });
        if (stopped) messenger.close();
      });
    } catch {
      requesting = false;
      set("error", "This browser could not protect practice across windows. Close other app windows and try a browser with Web Locks.");
    }
  }
  return {
    getSnapshot: () => snapshot,
    start() {
      if (!options.locks) set("unsupported", "This browser cannot safely reserve one practice window. Use a browser with Web Locks; browsing is still available.");
      else void attempt();
    },
    retry() {
      if (held) { void release(); return; }
      desired = true;
      handoff = true;
      if (owner) { messenger.send({ type: "handoff", from: options.id, to: owner }); handoff = false; }
      else messenger.send({ type: "query", from: options.id });
      void attempt();
    },
    poll() { void attempt(); },
    pause() { desired = false; void release(); },
    stop() {
      stopped = true;
      desired = false;
      if (held) void release();
      else { recovered?.(); messenger.close(); }
    },
  };
}

function validMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<Message>;
  return ["query", "owner", "handoff", "released"].includes(message.type ?? "") && typeof message.from === "string" && (message.to === undefined || typeof message.to === "string");
}
export function practiceMessenger(receive: (message: Message) => void): Messenger {
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(PRACTICE_LOCK);
      channel.onmessage = (event: MessageEvent<unknown>) => { if (validMessage(event.data)) receive(event.data); };
      return { send: (message) => channel.postMessage(message), close: () => channel.close() };
    } catch { /* Storage events below can still deliver explicit handoff requests. */ }
  }
  const listener = (event: StorageEvent) => {
    if (event.key !== MESSAGE_KEY || !event.newValue) return;
    try { const message: unknown = JSON.parse(event.newValue); if (validMessage(message)) receive(message); } catch { /* Ignore malformed local messages. */ }
  };
  window.addEventListener("storage", listener);
  return {
    send(message) { try { localStorage.setItem(MESSAGE_KEY, JSON.stringify({ ...message, nonce: crypto.randomUUID() })); } catch { /* The Web Lock still protects practice; close the old window to move it. */ } },
    close() { window.removeEventListener("storage", listener); },
  };
}

/** User-requested update checks share the lock, so another window cannot start practice midway. */
export async function whilePracticeIdle(action: () => Promise<void>): Promise<boolean> {
  if (!navigator.locks) return false;
  return navigator.locks.request(PRACTICE_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await action();
    return true;
  });
}

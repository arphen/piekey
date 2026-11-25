import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createPracticeWindow, practiceMessenger, settlePracticeWrites, subscribePracticeRecovery, type PracticeWindowSnapshot } from "./practiceWindow";
import "./platform.css";

/** Wrap the component owning engine hooks, rather than content returned after those hooks ran. */
export function PracticeWindowBoundary({ children, onExit }: { children: ReactNode; onExit(): void }) {
  const [snapshot, setSnapshot] = useState<PracticeWindowSnapshot>({ state: "checking", message: "Checking practice windows…" });
  const control = useRef<ReturnType<typeof createPracticeWindow>>();
  const unmounted = useRef<(() => void) | null>(null);
  useEffect(() => {
    let disposed = false;
    const manager = createPracticeWindow({
      locks: navigator.locks,
      id: crypto.randomUUID(),
      listen: practiceMessenger,
      changed: setSnapshot,
      subscribeRecovery: subscribePracticeRecovery,
      beforeRelease: async () => {
        // Passive cleanup stops children before another window can acquire the lock.
        if (!disposed) await new Promise<void>((resolve) => { unmounted.current = resolve; setSnapshot({ state: "yielding", message: "Finishing saves before releasing practice…" }); });
        else await new Promise<void>((resolve) => queueMicrotask(resolve));
        await settlePracticeWrites();
      },
    });
    control.current = manager;
    manager.start();
    const poll = window.setInterval(() => manager.poll(), 1000);
    const pagehide = () => { flushSync(() => manager.pause()); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) manager.retry(); };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      manager.stop();
      queueMicrotask(() => { unmounted.current?.(); unmounted.current = null; });
    };
  }, []);
  useEffect(() => {
    if (snapshot.state !== "active") { unmounted.current?.(); unmounted.current = null; }
  }, [snapshot.state]);
  if (snapshot.state === "active") return <>{children}</>;
  return <main className="platform-practice" data-state={snapshot.state} aria-label="practice window">
    <h1>{snapshot.state === "checking" ? "Opening practice" : snapshot.state === "yielding" ? "Moving practice" : "Practice window"}</h1>
    <p role="status">{snapshot.message}</p>
    <div className="platform-actions">
      {snapshot.state === "blocked" || snapshot.state === "error" ? <button type="button" onClick={() => control.current?.retry()}>{snapshot.state === "error" ? "Retry" : "Continue here"}</button> : null}
      <button type="button" onClick={onExit}>Back to browsing</button>
    </div>
  </main>;
}

import { useEffect } from "react";
import type { InputApi } from "../listen/useInput";
import { FreePlay } from "./FreePlay";
import { InputBar } from "./InputBar";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import "../song/song.css";

/** The existing free-play engine, reachable without importing a tune or opening a card box. */
export function FreePlayView({ input, onClose }: { input: InputApi; onClose(): void }) {
  return <PracticeWindowBoundary onExit={onClose}><FreePlayRoom input={input} onClose={onClose} /></PracticeWindowBoundary>;
}

function FreePlayRoom({ input, onClose }: { input: InputApi; onClose(): void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <main className="ss fp-standalone" role="dialog" aria-label="free play">
      <FreePlay input={input} onClose={onClose} onPractise={() => undefined} />
      <div className="fp-standalone-input"><InputBar input={input} /></div>
      <div className="ss-chrome">
        <button type="button" className="ss-icon" onClick={onClose} aria-label="leave free play" title="Leave (Esc)">×</button>
      </div>
    </main>
  );
}

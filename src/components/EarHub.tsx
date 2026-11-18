import { useState } from "react";
import type { InputApi } from "../listen/useInput";
import { EarView } from "./EarView";
import { FocusView } from "./FocusView";

/**
 * Ear mode: echo cards (hear a phrase, play it back) from the current tune, with the chord quiz
 * one step behind a button.
 */
export function EarHub({ input, onOpenTunes }: { input: InputApi; onOpenTunes?: () => void }) {
  const [quiz, setQuiz] = useState(false);
  if (!quiz) return <FocusView focus="ear" input={input} onOpenTunes={onOpenTunes} extra={{ label: "Chord quiz", onOpen: () => setQuiz(true) }} />;
  return (
    <>
      <div className="scales-bar">
        <button type="button" className="focus-song-secondary" onClick={() => setQuiz(false)}>
          ← Echo cards
        </button>
      </div>
      <EarView input={input} />
    </>
  );
}

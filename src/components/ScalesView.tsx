import { useState } from "react";
import { KEYS } from "../core";
import type { KeyInfo } from "../core/contract";
import type { InputApi } from "../listen/useInput";
import { FocusView } from "./FocusView";
import { ShapesView } from "./ShapesView";

/**
 * Scales mode: the tune's scale cards as a focused session, with the harmonic-minor shape explorer
 * (drilled over a vamp, in a key of your choice) one step behind it.
 */
export function ScalesView({ keyInfo, input, onKey, onOpenTunes }: { keyInfo: KeyInfo; input: InputApi; onKey(tonic: string): void; onOpenTunes?: () => void }) {
  const [explorer, setExplorer] = useState(false);
  if (!explorer) return <FocusView focus="scales" input={input} onOpenTunes={onOpenTunes} extra={{ label: "Shape explorer", onOpen: () => setExplorer(true) }} />;
  return (
    <>
      <div className="scales-bar">
        <button type="button" className="focus-song-secondary" onClick={() => setExplorer(false)}>
          ← Scale cards
        </button>
        <label className="key-select">
          <span>Key</span>
          <select value={keyInfo.tonic} onChange={(e) => onKey(e.target.value)} aria-label="key">
            {KEYS.map((k) => (
              <option key={k.tonic} value={k.tonic}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ShapesView />
    </>
  );
}

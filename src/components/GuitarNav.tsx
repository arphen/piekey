import type { InputApi } from "../listen/useInput";
import { NAV_KEYS, useGuitarNav } from "../nav/useGuitarNav";
import { noteName } from "./GuitarPad";
import "../nav/nav.css";

const ACTIONS = {
  prev: { label: "Previous control", path: "M19 12H5m6-6-6 6 6 6" },
  next: { label: "Next control", path: "M5 12h14m-6-6 6 6-6 6" },
  press: { label: "Select", path: "M19 5v7H5m6-6-6 6 6 6" },
  home: { label: "Tutor", path: "m3 11 9-8 9 8M5 9v11h14V9M9 20v-7h6v7" },
  tabLeft: { label: "Previous mode", path: "m11 6-6 6 6 6m8-12-6 6 6 6" },
  tabRight: { label: "Next mode", path: "m5 6 6 6-6 6m8-12 6 6-6 6" },
};

/** The shell's note keys, shown at the foot of the page; held notes light up. With the guitar off it offers to turn it on. */
export function GuitarNav({ input, onHome, onTab }: { input: InputApi; onHome(): void; onTab(dir: 1 | -1): void }) {
  const held = useGuitarNav(input, { home: onHome, tab: onTab });
  const on = input.status === "listening";
  return (
    <div className="gnav" data-nav-skip={on ? "" : undefined} aria-label="guitar navigation">
      {on ? (
        <>
          <span className="gnav-mark" title="Guitar controls · hold a note for 0.4 seconds" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 3v18m4-18v18m4-18v18M5 7h14M5 13h14M5 19h14" /></svg>
          </span>
          <ul className="gnav-keys" aria-label="Hold a note for 0.4 seconds">
            {NAV_KEYS.map((k, i) => (
              <li key={k.id} className={held === i ? "is-held" : ""} title={`${noteName(k.midi)} · ${ACTIONS[k.id].label}`} aria-label={`${noteName(k.midi)}: ${ACTIONS[k.id].label}`}>
                <b aria-hidden="true">{noteName(k.midi)}</b>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ACTIONS[k.id].path} /></svg>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <button type="button" className="gnav-on" onClick={() => void input.start()} disabled={input.status === "starting"} title="Guitar controls · E5–A5">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v9a3 3 0 0 0 6 0V3a3 3 0 0 0-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg>
          {input.status === "starting" ? "Connecting…" : input.status === "error" ? "Retry input" : "Connect guitar"}
        </button>
      )}
    </div>
  );
}

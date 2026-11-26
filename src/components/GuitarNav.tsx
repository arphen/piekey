import type { InputApi } from "../listen/useInput";
import { NAV_SILENCE_PRESETS, useNavSilence } from "../nav/silence";
import { NAV_KEYS, NAV_LEAD, useGuitarNav } from "../nav/useGuitarNav";
import { noteName } from "./GuitarPad";
import "../nav/nav.css";

const ACTIONS = {
  prev: { label: "Previous control", path: "M19 12H5m6-6-6 6 6 6" },
  next: { label: "Next control", path: "M5 12h14m-6-6 6 6-6 6" },
  press: { label: "Select", path: "M19 5v7H5m6-6-6 6 6 6" },
  home: { label: "Back", path: "M20 12H5m6-7-7 7 7 7" },
  tabLeft: { label: "Previous mode", path: "m11 6-6 6 6 6m8-12-6 6 6 6" },
  tabRight: { label: "Next mode", path: "m5 6 6 6-6 6m8-12 6 6-6 6" },
};

/** The shell's note keys, shown at the foot of the page; held notes light up. With the guitar off it offers to turn it on. */
export function GuitarNav({ input, onHome, onTab }: { input: InputApi; onHome(): void; onTab(dir: 1 | -1): void }) {
  const silence = useNavSilence();
  const { armed, held, ready, waitMs } = useGuitarNav(input, { home: onHome, tab: onTab }, silence.ms);
  const on = input.status === "listening";
  const waiting = on && silence.seconds > 0 && !ready;
  const waitSec = Math.ceil(waitMs / 1000);
  const options = NAV_SILENCE_PRESETS.includes(silence.seconds as (typeof NAV_SILENCE_PRESETS)[number])
    ? [...NAV_SILENCE_PRESETS]
    : [...NAV_SILENCE_PRESETS, silence.seconds].sort((a, b) => a - b);
  const markTitle = silence.seconds > 0
    ? `Guitar controls · after ${silence.seconds}s of silence, play ${noteName(NAV_LEAD)} then the action's note`
    : `Guitar controls · play ${noteName(NAV_LEAD)}, then the action's note`;
  return (
    <div className={`gnav ${waiting ? "is-waiting" : ""}`} data-nav-skip={on ? "" : undefined} aria-label="guitar navigation">
      {on ? (
        <>
          <span className="gnav-mark" title={markTitle} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 3v18m4-18v18m4-18v18M5 7h14M5 13h14M5 19h14" /></svg>
          </span>
          <span className={`gnav-lead ${armed ? "is-armed" : ""}`} aria-hidden="true">
            <b>{noteName(NAV_LEAD)}</b>
            <svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
          </span>
          <ul className={`gnav-keys ${armed ? "is-armed" : ""}`} aria-label={`Play ${noteName(NAV_LEAD)}, then one of these notes`}>
            {NAV_KEYS.map((k, i) => (
              <li key={k.id} className={held === i ? "is-held" : ""} title={`${noteName(k.midi)} · ${ACTIONS[k.id].label}`} aria-label={`${noteName(k.midi)}: ${ACTIONS[k.id].label}`}>
                <b aria-hidden="true">{noteName(k.midi)}</b>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ACTIONS[k.id].path} /></svg>
              </li>
            ))}
          </ul>
          <span className="gnav-quiet" title="Silence needed before guitar navigation arms">
            {silence.seconds > 0 ? (
              <span className={`gnav-wait ${waiting ? "is-counting" : "is-ready"}`} aria-hidden="true">
                {waiting ? waitSec : ""}
              </span>
            ) : null}
            <select
              className="gnav-quiet-select"
              value={silence.seconds}
              onChange={(e) => silence.set(Number(e.target.value))}
              aria-label="Silence before guitar navigation"
            >
              {options.map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? "always" : `${s}s quiet`}
                </option>
              ))}
            </select>
          </span>
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

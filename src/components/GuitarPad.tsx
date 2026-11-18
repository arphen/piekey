import { useEffect, useRef, useState, type RefObject } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { mod, pitchClassToName } from "../musicTheory";

// The guitar as the controller. Six open strings are six buttons: hold one and its action
// fires. Low E always goes back, high e always goes on, so the two outer strings are the way in
// and out of everything. During an exercise the pad is asleep; holding the open low E calls it.

const LOW_E = 40;
const SUMMON_MS = 1300; // low E held this long calls the pad: longer than any note in an exercise
const PRESS_MS = 600; // a string held this long is a press
const GAP_MS = 160; // dropouts shorter than this don't break a hold
const PRIME_FRAMES = 4; // a note already ringing when controls appear is not a fresh press
const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const OPEN_PCS = [4, 9, 2, 7, 11]; // E A D G B: strings are played all the time, never a key
const TAP_MS = 110; // a note sounding this long is a tap
const TAP_GAP_MS = 100; // silence this long between two notes makes the second one a new tap
const TWICE_MS = 900; // a second tap this soon after the first is a double tap

/** Which of the six buttons a pitch presses: the open strings, in any octave (E low or high by register). */
function stringOf(midi: number): number | null {
  switch (mod(midi)) {
    case 4:
      return midi >= 60 ? 5 : 0;
    case 9:
      return 1;
    case 2:
      return 2;
    case 7:
      return 3;
    case 11:
      return 4;
    default:
      return null;
  }
}

/** Follows a hold; `fresh` first waits for a note already ringing to stop or change. */
function useHeld(input: InputApi, enabled: boolean, ms: number, read: (midi: number | null) => number | null, show: (what: number | null, p: number) => void, onHold: (what: number) => void, fresh = false) {
  const fns = useRef({ read, show, onHold });
  fns.current = { read, show, onHold };
  const listening = input.status === "listening";
  const { subscribe } = input;
  useEffect(() => {
    fns.current.show(null, 0);
    if (!enabled || !listening) return;
    let what: number | null = null;
    let since = 0;
    let seen = 0;
    let spent = false; // fired: let go before the next press
    let primed = !fresh;
    let first: number | null = null;
    let quiet = 0;
    return subscribe((f) => {
      const now = fns.current.read(midiOf(f));
      if (!primed) {
        // The note that summoned the menu must stop or change before it can choose a row.
        if (now === null) quiet++;
        else {
          quiet = 0;
          first ??= now;
        }
        if (quiet >= PRIME_FRAMES || (now !== null && now !== first)) primed = true;
        else return;
      }
      if (now !== null) {
        if (now !== what) {
          what = now;
          since = f.now;
          spent = false;
        }
        seen = f.now;
      } else if (what !== null && f.now - seen > GAP_MS) {
        what = null;
        spent = false;
      }
      const p = what === null || spent ? 0 : Math.min(1, (f.now - since) / ms);
      fns.current.show(what, p);
      if (p >= 1 && what !== null) {
        spent = true;
        fns.current.onHold(what);
      }
    });
  }, [enabled, listening, subscribe, ms, fresh]);
}

export const SUMMON_HINT = "hold low E · release · hold low E again";

/** A held musical note only arms the menu. Actual silence and a second hold confirm intent. */
export function useSummon(input: InputApi, enabled: boolean, onSummon: () => void): RefObject<SVGCircleElement> {
  const ring = useRef<SVGCircleElement>(null);
  const action = useRef(onSummon);
  action.current = onSummon;
  const { subscribe, status, paused, deviceId } = input;
  useEffect(() => {
    const progress = (value: number) => { if (ring.current) ring.current.style.strokeDashoffset = String(1 - value); };
    progress(0);
    if (!enabled || status !== "listening" || paused) return;
    let phase: "hold" | "release" | "confirm" = "hold";
    let since: number | null = null;
    let quiet: number | null = null;
    let seen = 0;
    let deadline = 0;
    let rate: number | null = null;
    const reset = () => { phase = "hold"; since = null; quiet = null; progress(0); };
    return subscribe((frame) => {
      if (rate !== null && rate !== frame.sampleRate) reset();
      rate = frame.sampleRate;
      const midi = midiOf(frame);
      if (phase !== "hold" && frame.now > deadline) reset();
      if (phase === "release") {
        if (midi === null) {
          quiet ??= frame.now;
          if (frame.now - quiet >= 150) { phase = "confirm"; since = null; }
        } else if (midi !== LOW_E) reset();
        else quiet = null;
        return;
      }
      if (midi === LOW_E) {
        since ??= frame.now;
        seen = frame.now;
        const held = frame.now - since;
        if (phase === "hold") {
          progress(Math.min(0.5, held / SUMMON_MS * 0.5));
          if (held >= SUMMON_MS) { phase = "release"; deadline = frame.now + 5000; quiet = null; }
        } else {
          progress(0.5 + Math.min(0.5, held / PRESS_MS * 0.5));
          if (held >= PRESS_MS) { reset(); action.current(); }
        }
      } else if (midi !== null || (since !== null && frame.now - seen > GAP_MS)) reset();
    });
  }, [enabled, status, paused, deviceId, subscribe]);
  return ring;
}

/** Pitch classes for tone keys: the ones the exercise never plays, nor the open strings. `null` where there are too few. */
export function toneKeysFor(used: number[], count: number): (number | null)[] {
  const busy = new Set([...used, ...OPEN_PCS].map(mod));
  const free = Array.from({ length: 12 }, (_, pc) => pc).filter((pc) => !busy.has(pc));
  return Array.from({ length: count }, (_, i) => free[i] ?? null);
}

/**
 * Tone keys for the settings drawer, which pauses the exercise. Still prefers notes the card never
 * plays, off the open strings, then falls back to the open strings and finally the card's own notes.
 * `taken` holds the keys already in use (settings, calibration) so none of them repeats.
 */
export function drawerToneKeys(used: number[], count: number, taken: (number | null)[]): number[] {
  const busy = new Set(used.map(mod));
  const open = new Set(OPEN_PCS.map(mod));
  const held = new Set(taken.filter((pc): pc is number => pc !== null));
  const all = Array.from({ length: 12 }, (_, pc) => pc).filter((pc) => !held.has(pc));
  const rank = [
    ...all.filter((pc) => !busy.has(pc) && !open.has(pc)),
    ...all.filter((pc) => !busy.has(pc) && open.has(pc)),
    ...all.filter((pc) => busy.has(pc)),
  ];
  return rank.slice(0, count);
}

/**
 * Tone keys: a note the exercise doesn't use, played twice quickly, fires its action without the
 * hands leaving the strings. Returns the index of the key being tapped, lit for the length of the double.
 */
export function useToneKeys(input: InputApi, enabled: boolean, keys: (number | null)[], onFire: (key: number) => void): number | null {
  const [tapping, setTapping] = useState<number | null>(null);
  const fns = useRef({ keys, onFire });
  fns.current = { keys, onFire };
  const timer = useRef(0);
  const listening = input.status === "listening";
  const { subscribe } = input;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!enabled || !listening) return;
    let pc: number | null = null; // what is sounding now
    let since = 0;
    let seen = 0;
    let tapped = false; // this sounding has already counted as a tap
    let last: { key: number; at: number } | null = null; // the tap waiting for its pair
    return subscribe((f) => {
      const m = midiOf(f);
      if (m !== null) {
        if (mod(m) !== pc) {
          pc = mod(m);
          since = f.now;
          tapped = false;
        }
        seen = f.now;
      } else if (pc !== null && f.now - seen > TAP_GAP_MS) {
        pc = null;
        tapped = false;
      }
      if (pc === null || tapped || f.now - since < TAP_MS) return;
      tapped = true;
      const key = fns.current.keys.indexOf(pc);
      if (key < 0) return;
      if (last?.key === key && since - last.at <= TWICE_MS) {
        last = null;
        setTapping(null);
        fns.current.onFire(key);
        return;
      }
      last = { key, at: since };
      setTapping(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setTapping(null), TWICE_MS);
    });
  }, [enabled, listening, subscribe]);
  return tapping;
}

const KEY_HOLD_MS = 420; // a note key held this long fires: longer than a slip of the finger
const KEY_GAP_MS = 120;
const SLIP_MS = 300; // the same note an octave away this recently: the detector slipping, not a key

export const noteName = (midi: number) => `${pitchClassToName(midi).replace("#", "♯")}${Math.floor(midi / 12) - 1}`;

/**
 * Note keys: each action has one note, shown on screen; holding that note for a moment fires it.
 * During an exercise the note is exact (E5 is not E4); on the screens between exercises
 * `anyOctave` takes the note in whatever octave it is played. Returns the key being held.
 */
export function useNoteKeys(input: InputApi, enabled: boolean, keys: (number | null)[], onFire: (key: number) => void, anyOctave = false): number | null {
  const [held, setHeld] = useState<number | null>(null);
  const fns = useRef({ keys, onFire, anyOctave });
  fns.current = { keys, onFire, anyOctave };
  const listening = input.status === "listening";
  const { subscribe } = input;
  useEffect(() => {
    setHeld(null);
    if (!enabled || !listening) return;
    let primed = false;
    let quiet = 0;
    let first: number | null = null;
    let cur: number | null = null;
    let since = 0;
    let seen = 0;
    let spent = false; // fired: let go before the next press
    let other: { pc: number; at: number } | null = null; // the last note heard that is no key
    return subscribe((f) => {
      const m = midiOf(f);
      if (!primed) {
        // whatever was sounding when the keys came up has to stop, or change, first
        if (m === null) quiet++;
        else {
          quiet = 0;
          first ??= m;
        }
        if (quiet >= PRIME_FRAMES || (m !== null && m !== first)) primed = true;
        else return;
      }
      const { keys: ks, anyOctave: any } = fns.current;
      const k = m === null ? -1 : ks.findIndex((key) => key !== null && (any ? mod(key) === mod(m) : key === m));
      if (m !== null && k < 0) other = { pc: mod(m), at: f.now };
      if (k >= 0) {
        if (k !== cur) {
          // a held note read an octave off for a moment must not press the key that lives there
          const slip = !any && other !== null && other.pc === mod(m!) && f.now - other.at < SLIP_MS;
          cur = k;
          since = f.now;
          spent = slip;
          setHeld(slip ? null : k);
        }
        seen = f.now;
      } else if (cur !== null && f.now - seen > KEY_GAP_MS) {
        cur = null;
        spent = false;
        setHeld(null);
      }
      if (cur !== null && !spent && f.now - since >= KEY_HOLD_MS) {
        spent = true;
        setHeld(null);
        fns.current.onFire(cur);
      }
    });
  }, [enabled, listening, subscribe]);
  return held;
}

/** A note key's name beside the thing it works; fills while the note is held. */
export function NoteTag({ midi, held, octave = true }: { midi: number | null | undefined; held: boolean; octave?: boolean }) {
  if (midi === null || midi === undefined) return null;
  return (
    <span className={`ss-nk ${held ? "is-held" : ""}`} aria-hidden="true">
      {octave ? noteName(midi) : pitchClassToName(midi).replace("#", "♯")}
    </span>
  );
}

/** A tone key's name, small beside the element it works: lit while that key is being tapped. */
export function ToneTag({ pc, lit }: { pc: number | null | undefined; lit: boolean }) {
  if (pc === null || pc === undefined) return null;
  return (
    <span className={`ss-tone ${lit ? "is-lit" : ""}`} aria-hidden="true">
      {pitchClassToName(pc).replace("#", "♯")}
      <sup>×2</sup>
    </span>
  );
}

export interface PadRow {
  label: string;
  value?: string;
}

/** Six strings, six actions: `rows[0]` is the low E. Hold a string (or click its row) to fire it. */
export function GuitarPad({ input, title, rows, onFire }: { input: InputApi; title: string; rows: PadRow[]; onFire(string: number): void }) {
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  useHeld(
    input,
    true,
    PRESS_MS,
    (m) => (m === null ? null : stringOf(m)),
    (what, p) => els.current.forEach((el, i) => el?.style.setProperty("--p", i === what ? p.toFixed(3) : "0")),
    onFire,
    true,
  );
  return (
    <div className="ss-pad" role="menu" aria-label={title}>
      <p className="ss-pad-title">{title}</p>
      <div className="ss-pad-strings">
        {[5, 4, 3, 2, 1, 0].map((i) => (
          <button key={i} type="button" role="menuitem" className={`ss-pad-row ${rows[i].label ? "" : "is-empty"}`} ref={(el) => (els.current[i] = el)} onClick={() => onFire(i)} disabled={!rows[i].label}>
            <span className="ss-pad-note">{STRING_NAMES[i]}</span>
            <span className="ss-pad-string" style={{ height: 1 + i * 0.5 }} />
            <span className="ss-pad-label">
              {rows[i].label}
              {rows[i].value ? <em>{rows[i].value}</em> : null}
            </span>
          </button>
        ))}
      </div>
      <p className="ss-pad-hint">hold a string</p>
    </div>
  );
}

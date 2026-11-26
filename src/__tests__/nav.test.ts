// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { GuitarNav } from "../components/GuitarNav";
import { GuitarPad, useSummon } from "../components/GuitarPad";
import { SUMMON_NOTE } from "../song/notekeys";
import * as pitch from "../listen/pitch";
import type { InputApi, InputFrame } from "../listen/useInput";
import { NAV_KEYS, NAV_LEAD, press, pressables, step } from "../nav/useGuitarNav";
import { ARM_MS, createLeadKeys } from "../nav/leadKeys";
import {
  DEFAULT_NAV_SILENCE_S,
  MAX_NAV_SILENCE_S,
  parseNavSilence,
  readNavSilence,
  resetNavSilenceForTests,
  setNavSilence,
} from "../nav/silence";
import { syncableStorageKey } from "../sync/model";

/** Plays [midi | null, ms] steps into a lead-key machine at 10 ms frames; returns the keys fired. */
function play(steps: [number | null, number][], silenceMs = 0) {
  const keys = createLeadKeys(NAV_LEAD, NAV_KEYS.map((k) => k.midi), silenceMs);
  const fired: number[] = [];
  let now = 0;
  for (const [m, ms] of steps)
    for (let t = 0; t < ms; t += 10) {
      const k = keys.feed(m, (now += 10));
      if (k !== null) fired.push(k);
    }
  return { fired, keys };
}

// jsdom has no layout: every element reports a client rect unless a test says otherwise.
const shown = (el: Element) => vi.spyOn(el, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);

function page(html: string) {
  document.body.innerHTML = html;
  document.body.querySelectorAll("*").forEach(shown);
  return pressables();
}

beforeEach(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => { kept.set(key, value); },
    removeItem: (key: string) => { kept.delete(key); },
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  resetNavSilenceForTests();
});

describe("guitar navigation", () => {
  it("keeps every key above the 12th fret of the high e, one note each", () => {
    const midis = NAV_KEYS.map((k) => k.midi);
    expect(Math.min(...midis)).toBeGreaterThanOrEqual(76); // E5: fret 12 of the high e
    expect(new Set(midis).size).toBe(midis.length);
  });

  it("fires only on the lead and then a clear action note", () => {
    const [E5, F5, C3] = [76, 77, 48];
    expect(play([[null, 50], [F5, 600]]).fired).toEqual([]); // one note, however long
    expect(play([[null, 50], [NAV_LEAD, 200], [F5, 200]]).fired).toEqual([1]);
    expect(play([[null, 50], [NAV_LEAD, 200], [F5, 60], [null, 300]]).fired).toEqual([]); // not clear
    expect(play([[null, 50], [NAV_LEAD, 60], [F5, 200]]).fired).toEqual([]); // lead not clear
    expect(play([[null, 50], [NAV_LEAD, 200], [C3, 150], [F5, 200]]).fired).toEqual([]); // stray note cancels
    expect(play([[null, 50], [NAV_LEAD, 200], [null, ARM_MS + 100], [F5, 200]]).fired).toEqual([]); // too late
    // a lead ringing when the keys came up does not arm them
    expect(play([[NAV_LEAD, 400], [F5, 200]]).fired).toEqual([]);
    // armed after an action: fresh strikes walk on, one fire per strike
    expect(play([[null, 50], [NAV_LEAD, 200], [F5, 200], [null, 200], [F5, 200], [E5, 200]]).fired).toEqual([1, 1, 0]);
  });

  it("gates navigation behind the configured silence window while staying smooth once armed", () => {
    const [E5, F5, C4, D4] = [76, 77, 60, 62];
    const S = 3000;
    // Active playing right into lead + action never arms
    expect(play([[null, S + 100], [C4, 200], [NAV_LEAD, 200], [F5, 200]], S).fired).toEqual([]);
    // Fast legato playing across pitch changes (>= 80 ms total) also breaks silence
    expect(play([[null, S + 100], [C4, 50], [D4, 50], [NAV_LEAD, 200], [F5, 200]], S).fired).toEqual([]);
    // Playing before the silence window elapses does not arm and resets the silence timer
    expect(play([[null, 2000], [NAV_LEAD, 200], [F5, 200], [null, 2000], [NAV_LEAD, 200], [F5, 200]], S).fired).toEqual([]);
    // After 3 s of silence, lead arms and chained action strikes fire without waiting again
    expect(play([[C4, 300], [null, S + 200], [NAV_LEAD, 200], [F5, 200], [null, 200], [F5, 200], [E5, 200]], S).fired).toEqual([1, 1, 0]);
    // Brief detector blip (< 80 ms) during silence or attack transient before lead does not block arming
    expect(play([[null, 1500], [C4, 30], [null, 1700], [C4, 30], [NAV_LEAD, 200], [F5, 200]], S).fired).toEqual([1]);
    // After disarming via stray note, silence is required again before re-arming
    expect(
      play(
        [[null, S + 100], [NAV_LEAD, 200], [F5, 200], [C4, 150], [null, 1000], [NAV_LEAD, 200], [E5, 200]],
        S,
      ).fired,
    ).toEqual([1]);
    // After disarming via timeout, full silence since last sound re-enables arming
    expect(
      play(
        [[null, S + 100], [NAV_LEAD, 200], [F5, 200], [null, ARM_MS + 200], [NAV_LEAD, 200], [E5, 200]],
        S,
      ).fired,
    ).toEqual([1]);
    expect(
      play(
        [[null, S + 100], [NAV_LEAD, 200], [F5, 200], [null, S + 200], [NAV_LEAD, 200], [E5, 200]],
        S,
      ).fired,
    ).toEqual([1, 0]);
  });

  it("persists the silence delay as a bounded device-local preference defaulting to 3 seconds", () => {
    expect(DEFAULT_NAV_SILENCE_S).toBe(3);
    expect(readNavSilence()).toBe(3);
    expect(parseNavSilence(null)).toBe(3);
    expect(parseNavSilence("")).toBe(3);
    expect(parseNavSilence("bad")).toBe(3);
    expect(parseNavSilence("-5")).toBe(0);
    expect(parseNavSilence("99")).toBe(MAX_NAV_SILENCE_S);
    expect(parseNavSilence("0")).toBe(0);
    expect(parseNavSilence("4.6")).toBe(5);
    setNavSilence(5);
    expect(readNavSilence()).toBe(5);
    expect(localStorage.getItem("guitar-nav-silence")).toBe("5");
    expect(syncableStorageKey("guitar-nav-silence")).toBe(false);
  });

  it("shows waiting state in GuitarNav until silence elapses and lets the user adjust the delay", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const read = vi.spyOn(pitch, "midiOf").mockImplementation((frame) => (frame.buf[0] < 0 ? null : frame.buf[0]));
    const listeners = new Set<(frame: InputFrame) => void>();
    const input: InputApi = {
      status: "listening", error: null, devices: [], deviceId: null, paused: false,
      level: { current: 0 }, setDeviceId() {}, async start() {}, stop() {}, autoStart() {},
      subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
    const onHome = vi.fn();
    const onTab = vi.fn();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    const emit = (midi: number | null, now: number) =>
      listeners.forEach((hear) => hear({ buf: Float32Array.of(midi ?? -1), sampleRate: 48000, rms: midi === null ? 0 : 0.1, now }));
    try {
      await act(async () => root.render(createElement(GuitarNav, { input, onHome, onTab })));
      const bar = document.querySelector(".gnav")!;
      const select = document.querySelector<HTMLSelectElement>(".gnav-quiet-select")!;
      expect(select.value).toBe("3");
      expect(bar.classList.contains("is-waiting")).toBe(true);

      // Lead + Back (G5 = 79) before 3 s silence does nothing
      await act(async () => {
        emit(null, 100);
        emit(NAV_LEAD, 200);
        emit(NAV_LEAD, 400);
        emit(79, 450);
        emit(79, 650);
      });
      expect(onHome).not.toHaveBeenCalled();

      // After 3 s of silence, waiting clears and Lead + Back triggers onHome
      await act(async () => {
        emit(null, 800);
        emit(null, 3900);
      });
      expect(bar.classList.contains("is-waiting")).toBe(false);
      await act(async () => {
        emit(NAV_LEAD, 4000);
        emit(NAV_LEAD, 4200);
        emit(79, 4250);
        emit(79, 4450);
      });
      expect(onHome).toHaveBeenCalledTimes(1);

      // Switching to 0 ("always") immediately removes the waiting gate
      await act(async () => {
        emit(60, 4600);
        emit(60, 4800);
      });
      expect(bar.classList.contains("is-waiting")).toBe(true);
      await act(async () => {
        setNavSilence(0);
      });
      expect(select.value).toBe("0");
      expect(bar.classList.contains("is-waiting")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      read.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("lists what can be pressed in reading order, leaving out disabled and skipped things", () => {
    const list = page(`<header><button id="a">a</button></header><main><button id="b">b</button><button id="c" disabled>c</button>
      <div data-nav-skip><button id="d">d</button></div><select id="e"><option>1</option></select></main>`);
    expect(list.map((el) => el.id)).toEqual(["a", "b", "e"]);
  });

  it("steps on and back round the ends; the first step from nowhere lands in the page (its own header included), not the tab bar", () => {
    const list = page(`<header class="topbar"><button id="a"></button></header><main><header><button id="b"></button></header><button id="c"></button></main>`);
    const [a, b, c] = list;
    expect(step(list, null, 1)).toBe(b);
    expect(step(list, null, -1)).toBe(c);
    expect(step(list, c, 1)).toBe(a);
    expect(step(list, a, -1)).toBe(c);
    expect(step([], null, 1)).toBeNull();
  });

  it("presses a button by clicking it and turns a select like a dial", () => {
    const list = page(`<button id="b"></button><select id="s"><option value="x">x</option><option value="y">y</option></select>`);
    const [button, select] = list as [HTMLButtonElement, HTMLSelectElement];
    const click = vi.fn();
    button.addEventListener("click", click);
    press(button);
    expect(click).toHaveBeenCalledOnce();

    const change = vi.fn();
    select.addEventListener("change", change);
    press(select);
    expect(select.value).toBe("y");
    press(select);
    expect(select.value).toBe("x");
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("requires a menu-note hold, quiet release and fresh hold before music can become menu controls", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const read = vi.spyOn(pitch, "midiOf").mockImplementation((frame) => frame.buf[0] < 0 ? null : frame.buf[0]);
    const listeners = new Set<(frame: InputFrame) => void>();
    const input: InputApi = {
      status: "listening", error: null, devices: [], deviceId: null, paused: false,
      level: { current: 0 }, setDeviceId() {}, async start() {}, stop() {}, autoStart() {},
      subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
    const fire = vi.fn();
    function Menu() {
      const [open, setOpen] = useState(false);
      useSummon(input, !open, () => setOpen(true));
      return open ? createElement(GuitarPad, { input, title: "Menu", rows: Array.from({ length: 6 }, (_, i) => ({ label: String(i) })), onFire: fire }) : null;
    }
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    const emit = (midi: number | null, now: number) => listeners.forEach((hear) => hear({ buf: Float32Array.of(midi ?? -1), sampleRate: 48000, rms: midi === null ? 0 : 0.1, now }));
    try {
      await act(async () => root.render(createElement(Menu)));
      await act(async () => { emit(SUMMON_NOTE, 0); emit(SUMMON_NOTE, 1300); });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await act(async () => { emit(64, 1400); emit(64, 2100); });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await act(async () => { emit(SUMMON_NOTE, 2300); emit(SUMMON_NOTE, 3600); emit(SUMMON_NOTE, 5000); });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await act(async () => { emit(null, 5025); emit(null, 5200); emit(SUMMON_NOTE, 5300); emit(SUMMON_NOTE, 5899); });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await act(async () => emit(SUMMON_NOTE, 5900));
      expect(document.querySelector('[role="menu"]')).toBeTruthy();
      await act(async () => { emit(SUMMON_NOTE, 5925); emit(SUMMON_NOTE, 6600); });
      expect(fire).not.toHaveBeenCalled();

      await act(async () => { emit(65, 6700); emit(65, 7299); });
      expect(fire).not.toHaveBeenCalled();
      await act(async () => { emit(65, 7300); });
      expect(fire.mock.calls).toEqual([[5]]);

      await act(async () => { emit(null, 7500); emit(null, 7700); emit(41, 7800); emit(41, 8400); });
      expect(fire.mock.calls).toEqual([[5], [0]]);
    } finally {
      await act(async () => root.unmount());
      read.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("opens the menu on three quick strikes of the menu note, not on two or on a stray note between", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const read = vi.spyOn(pitch, "midiOf").mockImplementation((frame) => frame.buf[0] < 0 ? null : frame.buf[0]);
    const listeners = new Set<(frame: InputFrame) => void>();
    const input: InputApi = {
      status: "listening", error: null, devices: [], deviceId: null, paused: false,
      level: { current: 0 }, setDeviceId() {}, async start() {}, stop() {}, autoStart() {},
      subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
    const onSummon = vi.fn();
    function Menu() {
      useSummon(input, true, onSummon);
      return null;
    }
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    const emit = (midi: number | null, now: number) => listeners.forEach((hear) => hear({ buf: Float32Array.of(midi ?? -1), sampleRate: 48000, rms: midi === null ? 0 : 0.1, now }));
    const strike = (at: number) => { emit(SUMMON_NOTE, at); emit(SUMMON_NOTE, at + 90); emit(null, at + 150); emit(null, at + 200); };
    try {
      await act(async () => root.render(createElement(Menu)));
      await act(async () => { strike(0); strike(300); });
      expect(onSummon).not.toHaveBeenCalled();
      await act(async () => { emit(64, 640); strike(700); strike(1000); });
      expect(onSummon).not.toHaveBeenCalled();
      await act(async () => { strike(3000); strike(3300); strike(3600); });
      expect(onSummon).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      read.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

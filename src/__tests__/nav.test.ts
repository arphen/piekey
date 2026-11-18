// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { GuitarPad, useSummon } from "../components/GuitarPad";
import { SUMMON_NOTE } from "../song/notekeys";
import * as pitch from "../listen/pitch";
import type { InputApi, InputFrame } from "../listen/useInput";
import { NAV_KEYS, press, pressables, step } from "../nav/useGuitarNav";

// jsdom has no layout: every element reports a client rect unless a test says otherwise.
const shown = (el: Element) => vi.spyOn(el, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);

function page(html: string) {
  document.body.innerHTML = html;
  document.body.querySelectorAll("*").forEach(shown);
  return pressables();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("guitar navigation", () => {
  it("keeps every key above the 12th fret of the high e, one note each", () => {
    const midis = NAV_KEYS.map((k) => k.midi);
    expect(Math.min(...midis)).toBeGreaterThanOrEqual(76); // E5: fret 12 of the high e
    expect(new Set(midis).size).toBe(midis.length);
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
});

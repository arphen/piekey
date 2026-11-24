import { useCallback, useEffect, useRef } from "react";
import { useNoteKeys } from "../components/GuitarPad";
import type { InputApi } from "../listen/useInput";

// The shell is played, not clicked. Notes from the 12th fret up (nothing in an exercise sits that
// high) move a cursor across everything on screen that can be pressed. The notes are shown in
// the legend; the cursor is a ring on the element, gone again when the mouse moves.

/** What each key does, in the order `useNoteKeys` gets them. */
export const NAV_KEYS = [
  { id: "prev", midi: 76, label: "previous", glyph: "◀" }, // E5, the 12th fret of the high e
  { id: "next", midi: 77, label: "on", glyph: "▶" },
  { id: "press", midi: 78, label: "press", glyph: "●" },
  { id: "home", midi: 79, label: "back", glyph: "↩" }, // the shell's Back: one step out, home at the root
  { id: "tabLeft", midi: 80, label: "mode ◀", glyph: "‹" },
  { id: "tabRight", midi: 81, label: "mode ▶", glyph: "›" },
] as const;

type NavId = (typeof NAV_KEYS)[number]["id"];

const PRESSABLE = 'button:not(:disabled), select:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])';
const CURSOR = "gnav-cursor";

let muted = false;
/** A screen that makes its own sound (the ear trainer) mutes the nav while it plays, so the speakers cannot press keys. */
export function setNavMuted(on: boolean) {
  muted = on;
}

/** True while a full-screen session is open: it has its own gestures, the shell stays quiet. */
export const sessionOpen = () => document.querySelector(".ss") !== null;

/** Everything pressable and showing, in reading order. */
export function pressables(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(PRESSABLE)].filter(
    (el) => !el.closest("[data-nav-skip]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
  );
}

/** The element after `from` (or before), wrapping. With no usable cursor: the first thing below the top bar, else the first thing. */
export function step(list: HTMLElement[], from: HTMLElement | null, dir: 1 | -1): HTMLElement | null {
  if (!list.length) return null;
  const at = from ? list.indexOf(from) : -1;
  if (at < 0) {
    const body = list.find((el) => !el.closest(".topbar"));
    return dir === 1 ? (body ?? list[0]) : list[list.length - 1];
  }
  return list[(at + dir + list.length) % list.length];
}

/** A select moves to its next option, like a dial; everything else is clicked. */
export function press(el: HTMLElement) {
  if (el instanceof HTMLSelectElement) {
    const next = (el.selectedIndex + 1) % el.options.length;
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    set?.call(el, el.options[next].value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.click();
}

/**
 * Held high notes drive the cursor. `tab` moves between modes; `home` is the shell's Back.
 * Returns the key being held (an index into `NAV_KEYS`) for the legend.
 */
export function useGuitarNav(input: InputApi, handlers: { home(): void; tab(dir: 1 | -1): void }): number | null {
  const cursor = useRef<HTMLElement | null>(null);
  const fns = useRef(handlers);
  fns.current = handlers;

  const place = useCallback((el: HTMLElement | null) => {
    cursor.current?.classList.remove(CURSOR);
    cursor.current = el;
    if (!el) return;
    el.classList.add(CURSOR);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  // the mouse takes over: the ring goes
  useEffect(() => {
    const off = () => cursor.current && place(null);
    window.addEventListener("mousemove", off);
    return () => window.removeEventListener("mousemove", off);
  }, [place]);

  const fire = useCallback(
    (k: number) => {
      if (sessionOpen() || muted) return;
      const id: NavId = NAV_KEYS[k].id;
      const list = pressables();
      const here = cursor.current && list.includes(cursor.current) ? cursor.current : null;
      if (id === "prev" || id === "next") place(step(list, here, id === "next" ? 1 : -1));
      else if (id === "press") {
        if (here) press(here);
        else place(step(list, null, 1));
      } else if (id === "home") {
        place(null);
        fns.current.home();
      } else {
        place(null);
        fns.current.tab(id === "tabRight" ? 1 : -1);
      }
    },
    [place],
  );

  return useNoteKeys(input, input.status === "listening", NAV_KEYS.map((k) => k.midi), fire);
}

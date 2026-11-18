import { describe, expect, it } from "vitest";
import { drawerToneKeys, toneKeysFor } from "../components/GuitarPad";

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe("tone keys", () => {
  it("puts the drawer's switches on notes no other key uses", () => {
    const settings = toneKeysFor(C_MAJOR, 2);
    const switches = drawerToneKeys(C_MAJOR, 3, settings);
    expect(settings).toEqual([1, 6]); // D♯ is the menu note
    expect(switches).toEqual([3, 8, 10]);
    expect(new Set([...settings, ...switches]).size).toBe(5);
  });

  it("falls back to the paused card's own notes before any open string", () => {
    // every pitch class but the open strings is played
    const busy = [0, 1, 3, 5, 6, 8, 10];
    expect(drawerToneKeys(busy, 3, [])).toEqual([0, 1, 3]);
    expect(drawerToneKeys(busy, 8, [])).toEqual([0, 1, 3, 5, 6, 8, 10, 2]); // D: open strings only as a last resort
  });
});

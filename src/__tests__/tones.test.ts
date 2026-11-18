import { describe, expect, it } from "vitest";
import { drawerToneKeys, toneKeysFor } from "../components/GuitarPad";

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

describe("tone keys", () => {
  it("puts the drawer's switches on notes no other key uses", () => {
    const settings = toneKeysFor(C_MAJOR, 2);
    const switches = drawerToneKeys(C_MAJOR, 3, settings);
    expect(settings).toEqual([1, 3]);
    expect(switches).toEqual([6, 8, 10]);
    expect(new Set([...settings, ...switches]).size).toBe(5);
  });

  it("falls back to open strings when the card leaves too few notes free", () => {
    // every pitch class but the open strings is played
    const busy = [0, 1, 3, 5, 6, 8, 10];
    const switches = drawerToneKeys(busy, 3, []);
    expect(switches).toEqual([2, 4, 7]); // D E G: the open strings
  });
});

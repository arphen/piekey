import { mod } from "../musicTheory";

// Two clear notes, one after the other: a lead note arms, the action's note fires. A single note
// struck while noodling or tuning does nothing, and anything else played between them cancels.
// After an action the lead stays armed for a moment, so the cursor can walk on with fresh strikes
// of action notes alone.

export const CLEAR_MS = 150; // a note held this long is a clear tone, not a passing one
export const ARM_MS = 1500; // the window after the lead (or the last action) for the next note
const GAP_MS = 120; // silence this long ends a note
const CANCEL_MS = 80; // a stray note must last this long to cancel: not a blip of the detector

export interface LeadState {
  armed: boolean;
  /** The action key sounding while armed, before it fires. */
  held: number | null;
}

/**
 * Feed it one detected note (or null) per input frame; it returns the action key to fire, if any.
 * Notes are exact: the lead and keys are MIDI numbers, an octave off is not the key.
 */
export function createLeadKeys(lead: number, keys: readonly number[]) {
  let fresh = false; // whatever was sounding when we started must stop or change first
  let started = false;
  let cur: number | null = null;
  let since = 0;
  let seen = 0;
  let spent = false; // this sounding has done its work
  let armedUntil = -1;
  const keyPcs = new Set([lead, ...keys].map(mod));
  const state: LeadState = { armed: false, held: null };

  const disarm = () => {
    armedUntil = -1;
    state.armed = false;
  };

  function feed(m: number | null, now: number): number | null {
    if (!started) {
      started = true;
      cur = m;
      since = seen = now;
      fresh = m === null;
    }
    if (m !== null && m !== cur) {
      cur = m;
      since = now;
      seen = now;
      spent = false;
      fresh = true;
    } else if (m !== null) seen = now;
    else if (cur !== null && now - seen > GAP_MS) {
      cur = null;
      spent = false;
      fresh = true;
    }

    if (state.armed && now > armedUntil && cur !== lead) disarm();
    state.held = null;
    if (!fresh || cur === null || spent) return null;

    const held = seen - since; // how long it was heard, not the silence after it
    if (cur === lead) {
      if (held >= CLEAR_MS) {
        state.armed = true;
        armedUntil = now + ARM_MS;
      }
      return null;
    }
    const k = keys.indexOf(cur);
    if (k < 0) {
      // octave slips of the lead or a key are the detector, not the player
      if (state.armed && held >= CANCEL_MS && !keyPcs.has(mod(cur))) {
        spent = true;
        disarm();
      }
      return null;
    }
    if (!state.armed) return null;
    if (held < CLEAR_MS) {
      state.held = k;
      return null;
    }
    spent = true;
    armedUntil = now + ARM_MS;
    return k;
  }

  return {
    feed,
    state,
    reset() {
      started = false;
      cur = null;
      spent = false;
      disarm();
      state.held = null;
    },
  };
}

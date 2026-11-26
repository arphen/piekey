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
  /** True when the required silence before the lead has passed (or the lead is already armed). */
  ready: boolean;
  /** Milliseconds of silence still needed before the lead can arm (0 when ready). */
  waitMs: number;
}

/**
 * Feed it one detected note (or null) per input frame; it returns the action key to fire, if any.
 * Notes are exact: the lead and keys are MIDI numbers, an octave off is not the key.
 * When `silenceMs > 0`, that much uninterrupted silence must pass before a fresh lead note can arm.
 */
export function createLeadKeys(lead: number, keys: readonly number[], silenceMs = 0) {
  let silence = Math.max(0, silenceMs);
  let fresh = false; // whatever was sounding when we started must stop or change first
  let started = false;
  let cur: number | null = null;
  let since = 0;
  let seen = 0;
  let spent = false; // this sounding has done its work
  let armedUntil = -1;
  let soundSince: number | null = null; // start of continuous non-null sound (across pitch changes)
  let quietSince: number | null = null; // when continuous silence started
  let quietReady = silence <= 0;
  const keyPcs = new Set([lead, ...keys].map(mod));
  const state: LeadState = { armed: false, held: null, ready: quietReady, waitMs: quietReady ? 0 : silence };

  const disarm = () => {
    armedUntil = -1;
    state.armed = false;
  };

  const syncReadiness = (now: number) => {
    if (silence <= 0 || state.armed) {
      if (silence <= 0) quietReady = true;
      state.ready = true;
      state.waitMs = 0;
      return;
    }
    if (!quietReady && cur === null && quietSince !== null && now - quietSince >= silence) {
      quietReady = true;
    }
    state.ready = quietReady;
    if (quietReady) state.waitMs = 0;
    else if (quietSince === null) state.waitMs = silence;
    else state.waitMs = Math.max(0, silence - (now - quietSince));
  };

  function feed(m: number | null, now: number): number | null {
    if (!started) {
      started = true;
      cur = m;
      since = seen = now;
      fresh = m === null;
      soundSince = m === null ? null : now;
      quietSince = m === null ? now : null;
      quietReady = silence <= 0;
    }
    if (m !== null && m !== cur) {
      if (cur === null) soundSince = now;
      cur = m;
      since = now;
      seen = now;
      spent = false;
      fresh = true;
    } else if (m !== null) {
      seen = now;
    } else if (cur !== null && now - seen > GAP_MS) {
      const wasRealSound = soundSince !== null && seen - soundSince >= CANCEL_MS;
      cur = null;
      soundSince = null;
      spent = false;
      fresh = true;
      if (wasRealSound && quietSince === null) quietSince = seen;
      else if (quietSince === null) quietSince = now;
    }

    // Active playing breaks silence: sustained sound (>= CANCEL_MS) resets the silence timer,
    // except the lead note itself when silence was already satisfied and we are waiting to arm.
    if (cur !== null && soundSince !== null && seen - soundSince >= CANCEL_MS) {
      if (state.armed) {
        quietSince = null;
      } else if (!(quietReady && cur === lead)) {
        quietReady = false;
        quietSince = null;
      }
    }

    if (state.armed && now > armedUntil && cur !== lead) disarm();
    state.held = null;
    syncReadiness(now);
    if (!fresh || cur === null || spent) return null;

    const held = seen - since; // how long it was heard, not the silence after it
    if (cur === lead) {
      if ((state.armed || quietReady) && held >= CLEAR_MS) {
        state.armed = true;
        armedUntil = now + ARM_MS;
        quietReady = false;
        quietSince = null;
        syncReadiness(now);
      }
      return null;
    }
    const k = keys.indexOf(cur);
    if (k < 0) {
      // octave slips of the lead or a key are the detector, not the player
      if (state.armed && held >= CANCEL_MS && !keyPcs.has(mod(cur))) {
        spent = true;
        disarm();
        quietReady = false;
        quietSince = null;
        syncReadiness(now);
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
    setSilence(ms: number) {
      silence = Math.max(0, ms);
      if (silence <= 0) {
        quietReady = true;
        state.ready = true;
        state.waitMs = 0;
      } else if (!state.armed) {
        quietReady = false;
        if (cur === null && quietSince !== null) syncReadiness(Math.max(seen, quietSince));
        else {
          state.ready = false;
          state.waitMs = silence;
        }
      }
    },
    reset() {
      started = false;
      cur = null;
      spent = false;
      soundSince = null;
      quietSince = null;
      quietReady = silence <= 0;
      disarm();
      state.held = null;
      state.ready = quietReady;
      state.waitMs = quietReady ? 0 : silence;
    },
  };
}

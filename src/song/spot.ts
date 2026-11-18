import type { NoteResult } from "../core/contract";
import { mod } from "../musicTheory";
import type { Card } from "./deck";
import { fingerLine, fitWindow } from "./fingering";

// A long piece falls apart in one place. When the same bar has come out short twice running, that
// bar (with its neighbour, when that one went wrong too) is taken out and worked on by itself:
// heard once, then played slowly with the fingering and the names of the notes on the screen, a
// couple of clean times through. Then the piece carries on.

export interface Spot {
  from: number; // slots, inclusive
  to: number;
  first: number; // targets, inclusive
  last: number;
  asked?: boolean; // taken out by the player, not because it went wrong
}

const MIN_BARS = 3; // a shorter exercise is its own spot already
const MIN_NOTES = 10;
const TWICE = 2; // times in a row a bar has to come out short
const MAX_PER_BAR = 2; // times one bar is taken out during one visit
const MIN_SPOT_NOTES = 3;
const MAX_SPOT_BARS = 3;

export interface Trouble {
  /**
   * One time through, in time or at the player's own pace: a verdict per target of the card's
   * timeline. Returns the part to take out, once one has come out short twice in a row.
   */
  pass(results: NoteResult[]): Spot | null;
}

/** The bars of `card` from slot `from` to `to`, as a spot: null when they hold no notes. */
export function spotOf(card: Card, from: number, to: number): Spot | null {
  let first = -1;
  let last = -1;
  for (let i = card.first; i <= card.last; i++) {
    const slot = card.tl.targets[i].slot;
    if (slot < from || slot > to) continue;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? null : { from, to, first, last };
}

export function createTrouble(card: Card): Trouble {
  const short = new Map<number, number>(); // per slot: times in a row it came out short
  const taken = new Map<number, number>();
  const long = card.view !== "chords" && card.to - card.from + 1 >= MIN_BARS && card.last - card.first + 1 >= MIN_NOTES;
  return {
    pass(results) {
      if (!long) return null;
      const missed = new Map<number, number>();
      const notes = new Map<number, number>();
      for (let i = card.first; i <= card.last; i++) {
        const slot = card.tl.targets[i].slot;
        notes.set(slot, (notes.get(slot) ?? 0) + 1);
        if (results[i] === "miss") missed.set(slot, (missed.get(slot) ?? 0) + 1);
      }
      let worst = -1;
      for (let s = card.from; s <= card.to; s++) {
        const n = notes.get(s) ?? 0;
        const m = missed.get(s) ?? 0;
        const bad = n > 0 && (m >= 2 || m / n >= 0.5);
        short.set(s, bad ? (short.get(s) ?? 0) + 1 : 0);
        if (bad && short.get(s)! >= TWICE && (taken.get(s) ?? 0) < MAX_PER_BAR && (worst < 0 || m > (missed.get(worst) ?? 0))) worst = s;
      }
      if (worst < 0) return null;
      // its neighbour too, when that went wrong this time; then on until there is something to play
      let from = worst;
      let to = worst;
      if (to < card.to && (short.get(to + 1) ?? 0) >= 1) to++;
      else if (from > card.from && (short.get(from - 1) ?? 0) >= 1) from--;
      const count = () => {
        let n = 0;
        for (let s = from; s <= to; s++) n += notes.get(s) ?? 0;
        return n;
      };
      while (count() < MIN_SPOT_NOTES && to - from + 1 < MAX_SPOT_BARS && (to < card.to || from > card.from)) {
        if (to < card.to) to++;
        else from--;
      }
      if (to - from + 1 >= card.to - card.from + 1) return null; // that is the whole exercise
      for (let s = from; s <= to; s++) {
        taken.set(s, (taken.get(s) ?? 0) + 1);
        short.set(s, 0);
      }
      return spotOf(card, from, to);
    },
  };
}

/**
 * The card cut down to the spot. A melody has no fingering of its own, so the spot gets one: the
 * position that holds its notes, nearest to where the tune's other exercises are played.
 */
export function spotCard(card: Card, spot: Spot): Card {
  let { steps, p } = card;
  if (card.view !== "chords" && !card.steps[spot.first]) {
    const targets = card.tl.targets.slice(spot.first, spot.last + 1);
    const w = fitWindow(targets.map((t) => t.midi), card.p);
    const fingers = fingerLine(targets.map((t) => t.midi), w);
    const t0 = card.tl.slots[spot.from].start;
    steps = card.steps.map((s, i) => {
      const k = i - spot.first;
      const t = targets[k];
      return t ? { string: fingers[k].string, fret: fingers[k].fret, pc: mod(t.midi), midi: t.midi, startBeat: t.t - t0, durationBeats: t.dur } : s;
    });
    p = w.p;
  }
  return { ...card, ...spot, steps, p, memory: false, spot: true };
}

/** Which finger a fret asks for in position `p`: one finger per fret, the outer two reaching one further. 0 is an open string. */
export const fingerFor = (fret: number, p: number) => (fret === 0 ? 0 : Math.max(1, Math.min(4, fret - p + 1)));

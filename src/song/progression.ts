import type { Card, Deck } from "./deck";
import { parseChord, type Chord } from "./harmony";

// Chords heard in free play: each strum named the way the session judges chords (its required
// pitch classes ring, nothing that would make it another chord), repeats collapsed, and a short
// loop of two to four chords picked out once it has gone round twice. A loop the tune's box has a
// chord card for can be practised from there.

const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const QUALITIES = ["", "m", "7", "maj7", "m7", "m7b5", "dim7"];
const CANDIDATES: Chord[] = ROOTS.flatMap((r) => QUALITIES.map((q) => parseChord(r + q))).filter((c): c is Chord => c !== null);
const MAX_HEARD = 32;

/** The chord a set of ringing pitch classes is, or null. Fuller matches win; the root ringing breaks ties. */
export function nameChord(pcs: readonly number[]): Chord | null {
  const heard = new Set(pcs);
  if (heard.size < 2) return null;
  let best: { c: Chord; score: number } | null = null;
  for (const c of CANDIDATES) {
    if (!c.required.every((pc) => heard.has(pc)) || c.clash.some((pc) => heard.has(pc))) continue;
    const inChord = c.pcs.filter((pc) => heard.has(pc)).length;
    const extra = [...heard].filter((pc) => !c.pcs.includes(pc)).length;
    const score = inChord * 2 - extra * 3 + (heard.has(c.root) ? 1 : 0) - c.pcs.length * 0.1;
    if (!best || score > best.score) best = { c, score };
  }
  return best && best.score > 2 ? best.c : null;
}

/** The chords played, oldest first, with each new strum of the same chord folded into it. */
export function addChord(list: readonly Chord[], c: Chord): Chord[] {
  if (list.length && list[list.length - 1].symbol === c.symbol) return [...list];
  return [...list, c].slice(-MAX_HEARD);
}

/** The shortest loop of two to four chords the last strums went round twice, or null. */
export function findLoop(list: readonly Chord[]): Chord[] | null {
  for (let n = 2; n <= 4; n++) {
    if (list.length < n * 2) break;
    const tail = list.slice(-n * 2);
    const sym = tail.map((c) => c.symbol);
    if (new Set(sym.slice(0, n)).size < 2) continue;
    if (sym.slice(0, n).every((s, i) => s === sym[n + i])) return tail.slice(0, n);
  }
  return null;
}

const same = (a: Chord, b: Chord) => a.root === b.root && b.required.every((pc) => a.pcs.includes(pc));

/** A chord card in the box whose changes go round the loop, cadences (short) before sections. */
export function cardForLoop(deck: Deck, loop: readonly Chord[]): Card | null {
  const changes = (c: Card) => {
    const out: Chord[] = [];
    for (let i = c.first; i <= c.last; i++) {
      const ch = c.context[i]?.chord;
      if (ch && (!out.length || out[out.length - 1].symbol !== ch.symbol)) out.push(ch);
    }
    return out;
  };
  const fits = (c: Card) => {
    const seq = changes(c);
    if (seq.length < loop.length) return false;
    // the loop somewhere in the card's changes, read round
    for (let s = 0; s < seq.length; s++) if (loop.every((l, i) => same(l, seq[(s + i) % seq.length]))) return true;
    return false;
  };
  const chordsCards = deck.cards.filter((c) => c.family === "chords" && c.kind === "voicings");
  const short = (c: Card) => (c.id.includes("cad:") ? 0 : 1);
  return chordsCards.filter(fits).sort((a, b) => short(a) - short(b) || changes(a).length - changes(b).length)[0] ?? null;
}

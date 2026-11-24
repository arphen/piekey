import { getStoredItem, setStoredItem } from "../storage";
import { keyId, LAYERS, RINGS, TRIAD_BY_ID, TRIAD_CARDS, type TriadCard } from "./triads";
import { TOP_BOX, emptyTriads, validTriadStore, type TriadStore } from "./model";

export { TOP_BOX, emptyTriads, validTriadStore, type TriadState, type TriadStore } from "./model";

// The card box (Karteikasten) for triads. A card climbs a box only for an answer that is right and
// quick: knowing ii of E♭ is F A♭ C after a think is not yet knowing it. A wrong answer sends it back
// to the first box, where it keeps coming round until it is instant. The drill never runs dry:
// misses and slow cards first, then what is due, then a new card from the keys open now, then the
// weakest of the rest, so a session can be brute-force repetition for as long as the player likes.
// Progress is portable (a synced setting, merged card by card).

export const TRIADS_KEY = "guitar-triads-v1";
export const TRIAD_BOX_DAYS = [0, 0, 1, 3, 7, 16]; // days until a card in each box is due again; box 0 is unseen
export const FAST_MS = 3000; // right within this is known; slower is still being worked out
const OPEN_SHARE = 0.8; // of a ring's cards known (and those before it) before what follows it opens
const RECENT = 3; // a card is not asked again until this many others have been

export function loadTriads(): TriadStore {
  try {
    const value = JSON.parse(getStoredItem(TRIADS_KEY) ?? "null") as unknown;
    return validTriadStore(value) ? value : emptyTriads();
  } catch {
    return emptyTriads();
  }
}

export function saveTriads(store: TriadStore): boolean {
  try {
    return setStoredItem(TRIADS_KEY, JSON.stringify(store));
  } catch {
    return false;
  }
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const boxOf = (store: TriadStore, id: string) => store.cards[id]?.box ?? 0;

/** How many rings of keys are open: C, then the next step each way round the circle once most of what is open is known. */
const INDEX = new Map(TRIAD_CARDS.map((c, i) => [c.id, i]));
const RING_CARDS: TriadCard[][][] = LAYERS.map((_, l) => Array.from({ length: RINGS }, (_, r) => TRIAD_CARDS.filter((c) => c.layer === l && c.key.ring === r)));

/**
 * Which rings of each layer are open. A ring opens once the ring before it in the same layer is
 * known, and the layer before knows this ring: C first, then G and F beside "which degree in C",
 * and so on, a wave moving down the circle and into the later layers together.
 */
export function openMap(store: TriadStore): boolean[][] {
  const known = LAYERS.map((_, l) => {
    let seen = 0;
    let got = 0;
    return RING_CARDS[l].map((cards) => {
      seen += cards.length;
      got += cards.filter((c) => boxOf(store, c.id) >= 2).length;
      return got >= seen * OPEN_SHARE;
    });
  });
  return LAYERS.map((_, l) => Array.from({ length: RINGS }, (_, r) => (r === 0 || known[l][r - 1]) && (l === 0 || known[l - 1][r])));
}

/** How many rings of a layer are open, in a row from the top of the circle. */
export function openRings(store: TriadStore, layer = 0): number {
  const open = openMap(store)[layer];
  let rings = 0;
  while (rings < RINGS && open[rings]) rings++;
  return rings;
}

export function openCards(store: TriadStore): TriadCard[] {
  const open = openMap(store);
  return TRIAD_CARDS.filter((c) => open[c.layer][c.key.ring]);
}

/** An answer: right and quick climbs a box (when the card was due); right but slow stays; wrong starts over. */
export function answerTriad(store: TriadStore, id: string, right: boolean, ms: number, day: string): TriadStore {
  const was = store.cards[id] ?? { box: 0, due: day, seen: 0, right: 0 };
  const due = was.box <= 1 || was.due <= day;
  let box = was.box;
  let next = was.due;
  if (!right) {
    box = 1;
    next = day;
  } else if (ms <= FAST_MS && due) {
    box = Math.min(TOP_BOX, Math.max(1, box) + 1);
    next = addDays(day, TRIAD_BOX_DAYS[box]);
  } else if (box === 0) {
    box = 1;
    next = day;
  }
  return { ...store, cards: { ...store.cards, [id]: { box, due: next, seen: was.seen + 1, right: was.right + (right ? 1 : 0), ms: Math.max(0, Math.round(ms)) } } };
}

export interface Drill {
  turn: number;
  asked: Map<string, number>; // card → the turn it was last asked in this sitting
}

export const newDrill = (): Drill => ({ turn: 0, asked: new Map() });

/** A key chosen on the circle: everything about it, whatever has opened elsewhere. */
export interface Focus {
  key: string; // keyId: "Em"
  degree?: number; // where to begin
}

/**
 * The next card: due ones (lowest box, longest unasked) first, then a new one, then the weakest of
 * the rest. With a focus, from that key's cards in every layer, named triads before the rest.
 */
export function nextTriad(store: TriadStore, drill: Drill, day: string, focus?: Focus | null): TriadCard {
  const open = focus ? TRIAD_CARDS.filter((c) => keyId(c.key) === focus.key) : openCards(store);
  const fresh = (c: TriadCard) => drill.turn - (drill.asked.get(c.id) ?? -Infinity) > RECENT;
  const order = (a: TriadCard, b: TriadCard) =>
    boxOf(store, a.id) - boxOf(store, b.id) || (drill.asked.get(a.id) ?? -1) - (drill.asked.get(b.id) ?? -1) || INDEX.get(a.id)! - INDEX.get(b.id)!;
  const due = open.filter((c) => { const s = store.cards[c.id]; return s && s.box >= 1 && s.due <= day && fresh(c); }).sort(order);
  if (due.length) return due[0];
  const unseen = open.find((c) => !store.cards[c.id] && fresh(c));
  if (unseen) return unseen;
  const rest = open.filter(fresh).sort(order);
  return rest[0] ?? [...open].sort(order)[0] ?? TRIAD_CARDS[0];
}

/** Cards in each box, 0 (open, not yet seen) to 5, over the cards open now. */
export function boxCounts(store: TriadStore): number[] {
  const out = Array<number>(TOP_BOX + 1).fill(0);
  for (const c of openCards(store)) out[boxOf(store, c.id)]++;
  return out;
}

/** 0..1: how far up the box every triad card is, open or not (the keystone on Home). */
export function triadsFill(store: TriadStore): number {
  if (!TRIAD_CARDS.length) return 0;
  return TRIAD_CARDS.reduce((sum, c) => sum + (store.cards[c.id]?.box ?? 0), 0) / (TRIAD_CARDS.length * TOP_BOX);
}

export const triadCardById = (id: string) => TRIAD_BY_ID.get(id);

export interface KeyStat {
  known: number; // its cards at box 2 or more, every layer
  total: number;
  open: boolean; // its named triads have opened in the wave
  due: number;
  boxes: number[]; // box of each degree's named triad, I to vii°
}

/** For the circle: how well each key is known, whether it has opened, what is due. */
export function keyStats(store: TriadStore, day: string): Map<string, KeyStat> {
  const open = openMap(store);
  const out = new Map<string, KeyStat>();
  for (const c of TRIAD_CARDS) {
    const id = keyId(c.key);
    const stat = out.get(id) ?? { known: 0, total: 0, open: false, due: 0, boxes: Array<number>(7).fill(0) };
    const state = store.cards[c.id];
    stat.total++;
    if ((state?.box ?? 0) >= 2) stat.known++;
    if (state && state.box >= 1 && state.due <= day) stat.due++;
    if (c.ask === "name" && c.inversion === 0) {
      stat.boxes[c.degree] = state?.box ?? 0;
      if (open[c.layer][c.key.ring]) stat.open = true;
    }
    out.set(id, stat);
  }
  return out;
}

/** Open cards due today: what the drill has waiting. */
export function dueCount(store: TriadStore, day: string): number {
  return openCards(store).filter((c) => { const s = store.cards[c.id]; return s && s.box >= 1 && s.due <= day; }).length;
}

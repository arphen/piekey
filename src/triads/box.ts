import { getStoredItem, setStoredItem } from "../storage";
import { RINGS, TRIAD_BY_ID, TRIAD_CARDS, type TriadCard } from "./triads";
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
const OPEN_SHARE = 0.8; // of the open cards known before the next keys round the circle open
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
export function openRings(store: TriadStore): number {
  let rings = 1;
  while (rings < RINGS) {
    const open = TRIAD_CARDS.filter((c) => c.key.ring < rings);
    if (open.filter((c) => boxOf(store, c.id) >= 2).length < open.length * OPEN_SHARE) break;
    rings++;
  }
  return rings;
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

/** The next card: due ones (lowest box, longest unasked) first, then a new one, then the weakest of the rest. */
export function nextTriad(store: TriadStore, drill: Drill, day: string): TriadCard {
  const open = TRIAD_CARDS.filter((c) => c.key.ring < openRings(store));
  const fresh = (c: TriadCard) => drill.turn - (drill.asked.get(c.id) ?? -Infinity) > RECENT;
  const order = (a: TriadCard, b: TriadCard) =>
    boxOf(store, a.id) - boxOf(store, b.id) || (drill.asked.get(a.id) ?? -1) - (drill.asked.get(b.id) ?? -1) || TRIAD_CARDS.indexOf(a) - TRIAD_CARDS.indexOf(b);
  const due = open.filter((c) => { const s = store.cards[c.id]; return s && s.box >= 1 && s.due <= day && fresh(c); }).sort(order);
  if (due.length) return due[0];
  const unseen = open.find((c) => !store.cards[c.id] && fresh(c));
  if (unseen) return unseen;
  const rest = open.filter(fresh).sort(order);
  return rest[0] ?? [...open].sort(order)[0] ?? TRIAD_CARDS[0];
}

/** Cards in each box, 0 (unseen) to 5, over every card in the drill. */
export function boxCounts(store: TriadStore): number[] {
  const out = Array<number>(TOP_BOX + 1).fill(0);
  for (const c of TRIAD_CARDS) out[boxOf(store, c.id)]++;
  return out;
}

export const triadCardById = (id: string) => TRIAD_BY_ID.get(id);

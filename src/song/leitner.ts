import type { Evidence } from "./evidence";
import type { Card, Deck } from "./deck";
import { GLUE, glue, isShared } from "./ids";
import { kinship } from "./kin";
import { seeded, shuffled } from "./rand";
import { getStoredItem, reportStorageError, setStoredItem, storedKeys } from "../storage";

// The card box (Karteikasten): every exercise sits in one of five boxes. A clean pass moves it up a
// box, a pass with a struggle keeps it where it is, a miss sends it back to box 1. The higher the
// box, the longer until it comes round again: box 1 every session, then 1, 3, 7 and 21 days.
//
// Exercises are not islands. A clean pass also counts a little for the exercise's relatives (see
// kin.ts): the credit adds up, and a whole box of it moves the relative up without it being
// played. Scale exercises belong to the player, not to one tune: their boxes are shared by every
// tune that asks for the same scale. And an exercise that builds on another (thirds on the run,
// 16ths on triplets) only joins the box once the one before it has been played clean.

export type Result = "clean" | "ok" | "fail" | "skip";

export interface CardState {
  box: number; // 1..5
  due: string; // YYYY-MM-DD
  bpm: number; // tempo to play it at next time
  bestCleanBpm?: number; // demonstrated tempo, retained after detailed history is trimmed
  seen: number;
  clean: number;
  last: Result | null;
}

export type LoopMode = "adaptive" | "turnaround" | "continuous";

export interface Settings {
  newPerSession: number;
  guide: boolean; // hear the melody while playing it in time
  voice: boolean; // spoken cues
  window: number | null; // first fret of the position; null = chosen for the tune
  shuffle?: boolean; // the session's exercises in a mixed order
  mix?: boolean; // exercises from the other tunes in the library too (on unless turned off)
  length?: "short" | "normal" | "long"; // how long a session is planned for
  loop?: LoopMode; // how looped exercises wrap back to bar 1
}

/** One time through an exercise, for the numbers over time. */
export interface AttemptConditions {
  v: 1;
  source: "measured" | "self";
  support?: "none" | "guide" | "adaptive";
  notation?: "visible" | "hidden" | "faded";
  tempo?: "own-pace" | "adaptive" | "fixed";
  exposure?: "first" | "repeated";
  confidence: "unknown" | "limited" | "usable";
  uninterrupted?: boolean;
}

export interface Attempt {
  uid?: string; // immutable performance identity across devices
  id: string;
  day: string;
  at?: number; // wall-clock timestamp; older attempts only have a day
  timingMeasured?: boolean; // calibration provenance belongs to the recorded performance
  result: Result;
  bpm: number; // the tempo it ended on
  goalBpm?: number; // goal when this attempt was played, not a later suggested tempo
  share: number | null; // notes landed, 0..1: the best pass in time, else the last take
  secs: number; // spent on it, playing
  from: number; // box before (0: new)
  to: number;
  ev?: Evidence; // where it went wrong (older attempts have none)
  conditions?: AttemptConditions;
  arrangementFingerprint?: string; // interpreted musical version observed in this performance
}

export interface SessionEntry {
  uid?: string;
  date: string;
  minutes: number; // spent playing, not sitting
  cards: number;
  clean: number;
  share?: number; // notes landed over the session, 0..1
}

export interface Store {
  v: 1;
  cards: Record<string, CardState>;
  sessions: SessionEntry[];
  settings: Settings;
  history?: Attempt[];
  credit?: Record<string, number>; // progress carried over from related exercises, in boxes
  meta?: { title: string; key: string }; // the tune, for views across tunes
}

export const BOX_DAYS = [0, 0, 1, 3, 7, 21]; // by box
export const BOXES = 5;
const MAX_REVIEWS = 8;
const MAX_HISTORY = 800;
const MAX_CREDIT = 2;
const UNLOCK_BOX = 2; // an exercise opens once the one it builds on has reached this box
const DEFAULTS: Settings = { newPerSession: 4, guide: false, voice: false, window: null, shuffle: false };

const PREFIX = "guitar-song-deck:";
const SHARED = "guitar-skills";
const key = (tuneId: string) => `${PREFIX}${tuneId}`;

interface Shared {
  v: 1;
  cards: Record<string, CardState>;
  credit: Record<string, number>;
}

function loadShared(): Shared {
  try {
    const s = JSON.parse(getStoredItem(SHARED) ?? "null") as Shared | null;
    if (s?.v === 1) return { v: 1, cards: s.cards ?? {}, credit: s.credit ?? {} };
  } catch {
    // none yet
  }
  return { v: 1, cards: {}, credit: {} };
}

/** The scale work shared across tunes (Scales, Free play and every tune's own scale cards). */
export function loadSharedSkills(): { cards: Record<string, CardState>; credit: Record<string, number> } {
  const { cards, credit } = loadShared();
  return { cards, credit };
}

function parse(raw: string | null): Store | null {
  if (!raw) return null;
  const s = JSON.parse(raw) as Store;
  return s.v === 1 ? retainCleanTempos({ ...s, settings: { ...DEFAULTS, ...s.settings } }) : null;
}

/** Migrate verified legacy performances before trimming; suggested tempos never become proof. */
function retainCleanTempos(store: Store): Store {
  const cards = { ...store.cards };
  for (const a of store.history ?? []) {
    const state = cards[a.id];
    if (state && a.conditions?.source !== "self" && a.result === "clean" && Number.isFinite(a.bpm) && a.bpm > (state.bestCleanBpm ?? 0))
      cards[a.id] = { ...state, bestCleanBpm: a.bpm };
  }
  return { ...store, cards };
}

export function loadStore(tuneId: string): Store {
  let store: Store = { v: 1, cards: {}, sessions: [], settings: { ...DEFAULTS } };
  try {
    store = parse(getStoredItem(key(tuneId))) ?? store;
  } catch {
    // a fresh box
  }
  // the player's scale work, wherever it was done: the copy with more plays behind it wins
  const shared = loadShared();
  const cards = { ...store.cards };
  for (const [id, st] of Object.entries(shared.cards)) {
    const own = cards[id];
    const next = !own || st.seen >= own.seen ? st : own;
    const best = Math.max(own?.bestCleanBpm ?? 0, st.bestCleanBpm ?? 0);
    cards[id] = best ? { ...next, bestCleanBpm: best } : next;
  }
  return { ...store, cards, credit: { ...store.credit, ...shared.credit } };
}

export function saveStore(tuneId: string, s: Store) {
  try {
    const retained = retainCleanTempos(s);
    const history = retained.history && chronologicalAttempts(retained.history).slice(-MAX_HISTORY);
    setStoredItem(key(tuneId), JSON.stringify(history ? { ...retained, history } : retained));
    const shared = loadShared();
    for (const [id, st] of Object.entries(retained.cards)) if (isShared(id)) {
      const best = Math.max(st.bestCleanBpm ?? 0, shared.cards[id]?.bestCleanBpm ?? 0);
      shared.cards[id] = best ? { ...st, bestCleanBpm: best } : st;
    }
    for (const [id, c] of Object.entries(s.credit ?? {})) if (isShared(id)) shared.credit[id] = c;
    setStoredItem(SHARED, JSON.stringify(shared));
  } catch (error) {
    reportStorageError(key(tuneId), error);
  }
}

/**
 * Several tunes' boxes read as one, for a session that mixes them. The first tune is the one the
 * session belongs to: its settings and its list of sessions are used, and its exercises keep their
 * ids. The others' exercises carry their tune in front (see ids.ts).
 */
export function loadStores(tuneIds: string[]): Store {
  const [main, ...others] = tuneIds;
  const store = loadStore(main);
  if (!others.length) return { ...store, history: chronologicalAttempts(store.history ?? []) };
  const cards = { ...store.cards };
  const credit = { ...store.credit };
  const history = [...(store.history ?? [])];
  for (const t of others) {
    const o = loadStore(t);
    for (const [id, st] of Object.entries(o.cards)) if (!isShared(id)) cards[glue(t, id)] = st;
    for (const [id, c] of Object.entries(o.credit ?? {})) if (!isShared(id)) credit[glue(t, id)] = c;
    for (const a of o.history ?? []) if (!isShared(a.id)) history.push({ ...a, id: glue(t, a.id) });
  }
  return { ...store, cards, credit, history: chronologicalAttempts(history) };
}

/** Old history has day precision: retain each tune's order and break cross-tune ties by id. */
export function chronologicalAttempts(attempts: readonly Attempt[]): Attempt[] {
  const time = (a: Attempt) => typeof a.at === "number" && Number.isFinite(a.at) ? a.at : Number.NEGATIVE_INFINITY;
  const origin = (id: string) => id.includes(GLUE) ? id.slice(0, id.indexOf(GLUE)) : "";
  return attempts
    .map((attempt, index) => ({ attempt, index }))
    .sort((a, b) => a.attempt.day.localeCompare(b.attempt.day)
      || (time(a.attempt) === time(b.attempt) ? 0 : time(a.attempt) < time(b.attempt) ? -1 : 1)
      || origin(a.attempt.id).localeCompare(origin(b.attempt.id))
      || a.index - b.index)
    .map(({ attempt }) => attempt);
}

/** The other way: each exercise's state goes back into the box of the tune it belongs to. */
export function saveStores(tuneIds: string[], s: Store) {
  const [main, ...others] = tuneIds;
  if (!others.length) return saveStore(main, s);
  const own = <T,>(rec: Record<string, T> | undefined) => Object.fromEntries(Object.entries(rec ?? {}).filter(([id]) => !id.includes(GLUE)));
  saveStore(main, { ...s, cards: own(s.cards), credit: own(s.credit), history: (s.history ?? []).filter((a) => !a.id.includes(GLUE)) });
  for (const t of others) {
    const prefix = t + GLUE;
    const mine = <T,>(rec: Record<string, T> | undefined) =>
      Object.fromEntries(Object.entries(rec ?? {}).flatMap(([id, v]) => (id.startsWith(prefix) ? [[id.slice(prefix.length), v] as [string, T]] : [])));
    const o = loadStore(t); // read after the first tune was saved: the shared scale work in it is current
    saveStore(t, {
      ...o,
      cards: { ...o.cards, ...mine(s.cards) },
      credit: { ...o.credit, ...mine(s.credit) },
      history: [...(o.history ?? []).filter((a) => isShared(a.id)), ...(s.history ?? []).flatMap((a) => (a.id.startsWith(prefix) ? [{ ...a, id: a.id.slice(prefix.length) }] : []))],
    });
  }
}

/** A tune's name and key, kept with its box even when it was only ever played inside another tune's session. */
export function saveMeta(tuneId: string, meta: { title: string; key: string }) {
  const s = loadStore(tuneId);
  if (s.meta?.title !== meta.title || s.meta.key !== meta.key) saveStore(tuneId, { ...s, meta });
}

/** Every tune's box on this machine, for views across tunes. */
export function allStores(): { tuneId: string; store: Store }[] {
  const out: { tuneId: string; store: Store }[] = [];
  try {
    for (const k of storedKeys()) {
      if (!k.startsWith(PREFIX)) continue;
      const store = parse(getStoredItem(k));
      if (store) out.push({ tuneId: k.slice(PREFIX.length), store });
    }
  } catch {
    // nothing to show
  }
  return out;
}

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return today(new Date(y, m - 1, d + n));
}

/** An exercise that builds on another waits until that one has been played clean (or its relatives have carried it there). */
export function unlocked(card: Card | undefined, store: Store): boolean {
  if (!card?.needs) return true;
  return (store.cards[card.needs]?.box ?? 0) >= UNLOCK_BOX || (store.credit?.[card.id] ?? 0) >= 1;
}

/** Today's cards: what's due (lowest box first), then a few new ones, a scale card up front to warm up. */
export function planSession(deck: Deck, store: Store, day: string, exclude: Set<string> = new Set(), newCount = store.settings.newPerSession): string[] {
  const order = new Map(deck.intro.map((id, i) => [id, i]));
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const due = deck.intro
    .filter((id) => !exclude.has(id) && store.cards[id] && store.cards[id].due <= day)
    .sort((a, b) => store.cards[a].box - store.cards[b].box || store.cards[a].due.localeCompare(store.cards[b].due) || order.get(a)! - order.get(b)!)
    .slice(0, MAX_REVIEWS);
  const fresh = deck.intro.filter((id) => !exclude.has(id) && !store.cards[id] && unlocked(byId.get(id), store)).slice(0, newCount);

  const warm = [...due, ...fresh].find((id) => byId.get(id)?.family === "scales");
  const reviews = due.filter((id) => id !== warm);
  const news = fresh.filter((id) => id !== warm);
  const out: string[] = warm ? [warm] : [];
  // two reviews, then something new, so new material lands while the hands are warm but fresh
  while (reviews.length || news.length) {
    out.push(...reviews.splice(0, 2));
    if (news.length) out.push(news.shift()!);
  }
  if (store.settings.shuffle && out.length > 2) {
    // the warm-up stays first; the rest in an order of the day's own: the same one all day
    return [out[0], ...shuffled(out.slice(1), seeded(`${day}:${store.sessions.length}:${exclude.size}`))];
  }
  return out;
}

/** When nothing is due: the cards furthest from done, for a session anyway. */
export function planExtra(deck: Deck, store: Store, n = 6): string[] {
  const order = new Map(deck.intro.map((id, i) => [id, i]));
  return deck.intro
    .filter((id) => store.cards[id])
    .sort((a, b) => store.cards[a].box - store.cards[b].box || store.cards[a].due.localeCompare(store.cards[b].due) || order.get(a)! - order.get(b)!)
    .slice(0, n);
}

const SPEED_BUILD_CAP_BOX = 3; // while below 90% of goalBpm, stay on 1–3 day spacing to build speed
const SPEED_READY_RATIO = 0.9;

export function applyResult(prev: CardState | undefined, card: Card, result: Result, playedBpm: number, day: string): CardState {
  const s: CardState = prev ?? { box: 1, due: day, bpm: card.bpm, seen: 0, clean: 0, last: null };
  if (result === "skip") return { ...s, last: "skip" };
  const buildingSpeed = card.goalBpm > card.bpm && playedBpm < card.goalBpm * SPEED_READY_RATIO;
  let box: number;
  let bpm: number;
  let due: string;
  if (result === "clean") {
    const rawBox = Math.min(BOXES, s.box + 1);
    box = buildingSpeed ? Math.min(SPEED_BUILD_CAP_BOX, rawBox) : rawBox;
    const farBelow = prev !== undefined && s.box >= 2 && card.goalBpm - playedBpm >= 20;
    const step = farBelow ? 6 : 4;
    bpm = Math.min(card.goalBpm, playedBpm + step);
    due = addDays(day, BOX_DAYS[box]);
  } else if (result === "ok") {
    box = Math.max(1, s.box);
    bpm = playedBpm;
    due = addDays(day, BOX_DAYS[box]);
  } else {
    // Soft decay: step back gently instead of wiping a mastered card all the way to box 1,
    // and ease tempo slightly so the next visit meets the player comfortably.
    box = Math.max(1, s.box - 2);
    bpm = Math.max(40, Math.min(playedBpm, s.bpm) - 4);
    due = day;
  }
  return {
    ...s,
    box,
    due,
    bpm,
    seen: s.seen + 1,
    clean: s.clean + (result === "clean" ? 1 : 0),
    last: result,
    ...(result === "clean" && Number.isFinite(playedBpm) && playedBpm > 0 ? { bestCleanBpm: Math.max(s.bestCleanBpm ?? 0, playedBpm) } : {}),
  };
}

/** A first clean pass on an exercise its relatives have prepared starts it further up the box. */
export function headStart(state: CardState, credit: number, day: string): { state: CardState; used: number } {
  const used = Math.min(Math.floor(credit), BOXES - state.box);
  if (used <= 0) return { state, used: 0 };
  const box = state.box + used;
  return { state: { ...state, box, due: addDays(day, BOX_DAYS[box]) }, used };
}

/**
 * A clean pass on `card` counts for its relatives too. Each gets its kinship in credit; a whole
 * box of credit moves an exercise that is already in the box up one, and one not yet met keeps
 * the credit for the day it is.
 */
export function carryOver(store: Store, deck: Deck, card: Card, day: string): { store: Store; moved: { id: string; from: number; to: number }[] } {
  const credit = { ...store.credit };
  const cards = { ...store.cards };
  const moved: { id: string; from: number; to: number }[] = [];
  for (const other of deck.cards) {
    const k = kinship(card.id, other.id);
    if (k < 0.15) continue;
    let c = Math.min(MAX_CREDIT, (credit[other.id] ?? 0) + k);
    const st = cards[other.id];
    if (st && c >= 1 && st.box < BOXES) {
      const box = st.box + 1;
      cards[other.id] = { ...st, box, due: addDays(day, BOX_DAYS[box]) };
      moved.push({ id: other.id, from: st.box, to: box });
      c -= 1;
    }
    credit[other.id] = Math.round(c * 100) / 100;
  }
  return { store: { ...store, cards, credit }, moved };
}

export function logAttempt(store: Store, attempt: Attempt): Store {
  return { ...store, history: chronologicalAttempts([...(store.history ?? []), attempt]) }; // cut to length when it is saved
}

export function boxCounts(deck: Deck, store: Store): { boxes: number[]; fresh: number; due: number } {
  const boxes = Array(BOXES).fill(0);
  let fresh = 0;
  let due = 0;
  const day = today();
  for (const id of deck.intro) {
    const s = store.cards[id];
    if (!s) fresh++;
    else {
      boxes[s.box - 1]++;
      if (s.due <= day) due++;
    }
  }
  return { boxes, fresh, due };
}

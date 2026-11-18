import type { Deck, Family } from "./deck";
import { getStoredItem, removeStoredItem, setStoredItem } from "../storage";
import { GLUE } from "./ids";
import { chronologicalAttempts, planSession, type Store } from "./leitner";
import type { Axis, MistakeClass, SkillProfile, Weakness } from "./profile";
import { familyOf } from "./stats";

// A session with a shape, as a teacher would plan it: hands first (a warm-up), then the one thing
// most worth working on (the focus), then what the box says is due (review), then something to
// play (music). The focus comes from the player's profile and holds for days (an arc) until the
// mistake behind it has shrunk. The plan fills minutes, not a number of cards: how long each kind
// of exercise takes is read off the player's own history.

export type Length = "short" | "normal" | "long";
export const LENGTHS: Length[] = ["short", "normal", "long"];
export const LENGTH_MINUTES: Record<Length, number> = { short: 10, normal: 25, long: 45 };

export type Role = "warmup" | "focus" | "review" | "music";

export interface Block {
  role: Role;
  cards: string[];
  minutes: number;
}

export interface Arc {
  cls: MistakeClass;
  start: string; // day it began
  strength: number; // how strong the mistake was then
}

export interface SessionPlan {
  blocks: Block[];
  ids: string[]; // the cards in order
  minutes: number; // estimated
  why: string; // the focus, as one fact; empty when there is none
  arc: Arc | null; // the arc to keep after this plan (new, carried on, or none)
}

const SECS: Record<Family, number> = { scales: 100, harmony: 130, melody: 160, chords: 130, reading: 100, ear: 70, fretboard: 60 };
const BETWEEN_S = 15; // intro and result screens around each card
const ARC_DAYS = 10; // an arc rests after this long, resolved or not
const RESOLVED = 0.5; // ... or once the mistake is down to this share of where it began
const NEGLECT_DAYS = 7;
const MAX_FOCUS = 5;
const ZONE_ATTEMPTS = 16; // the attempts that say how it is going lately
const ZONE_LOW = 0.6;
const ZONE_HIGH = 0.85;
const RUN_DAYS = 14; // a run-through's short bars are worked on for this long after it
const AXIS_FAMILIES: Record<Axis, Family[]> = {
  pitch: ["melody", "scales", "fretboard"],
  time: ["scales", "melody"],
  tempo: ["scales"],
  chords: ["chords", "harmony"],
  reading: ["reading"],
  ear: ["ear"],
};
const ARC_KEY = "guitar-arc";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Seconds a card of this family takes this player: the median of their own attempts, else a guess. */
export function cardSeconds(store: Store): Record<Family, number> {
  const out = { ...SECS };
  const by = new Map<Family, number[]>();
  for (const a of store.history ?? []) {
    if (a.result === "skip" || a.secs <= 0) continue;
    const f = familyOf(a.id);
    by.set(f, [...(by.get(f) ?? []), a.secs]);
  }
  for (const [f, xs] of by) {
    if (xs.length < 3) continue;
    const s = [...xs].sort((a, b) => a - b);
    out[f] = s[s.length >> 1];
  }
  return out;
}

/** The arc to keep: the last one while it holds, else the strongest mistake the profile names. */
export function nextArc(prev: Arc | null, profile: SkillProfile | null, day: string): Arc | null {
  const named = profile?.weaknesses ?? [];
  if (prev && daysBetween(prev.start, day) < ARC_DAYS) {
    const now = named.find((w) => w.cls === prev.cls);
    if (now && now.strength > prev.strength * RESOLVED) return prev;
  }
  const top = named.find((w) => !prev || w.cls !== prev.cls || daysBetween(prev.start, day) >= ARC_DAYS * 2);
  return top ? { cls: top.cls, start: day, strength: top.strength } : null;
}

export function loadArc(): Arc | null {
  try {
    return JSON.parse(getStoredItem(ARC_KEY) ?? "null") as Arc | null;
  } catch {
    return null;
  }
}

export function saveArc(arc: Arc | null) {
  try {
    if (arc) setStoredItem(ARC_KEY, JSON.stringify(arc));
    else removeStoredItem(ARC_KEY);
  } catch {
    // held for this visit
  }
}

/**
 * New cards for this session, from how recent attempts went: struggling (under 60 % clean) brings
 * none, cruising (over 85 %) brings two more than usual. The setting is the usual number.
 */
export function newCards(store: Store): number {
  const usual = store.settings.newPerSession;
  const recent = chronologicalAttempts(store.history ?? []).filter((a) => a.result !== "skip").slice(-ZONE_ATTEMPTS);
  if (recent.length < ZONE_ATTEMPTS / 2) return usual;
  const clean = recent.filter((a) => a.result === "clean").length / recent.length;
  return clean < ZONE_LOW ? 0 : clean > ZONE_HIGH ? usual + 2 : usual;
}

export interface PlanOptions {
  minutes: number;
  tuneId: string; // the session's own tune: its ids carry no tune in the profile's terms
  profile?: SkillProfile | null;
  arc?: Arc | null;
  exclude?: Set<string>;
}

export function planBlocks(deck: Deck, store: Store, day: string, opts: PlanOptions): SessionPlan {
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const secs = cardSeconds(store);
  const cost = (id: string) => ((byId.get(id) ? secs[byId.get(id)!.family] : 120) + BETWEEN_S) / 60;
  const used = new Set(opts.exclude ?? []);
  const known = (id: string) => Boolean(store.cards[id]);
  const budget = Math.max(0, opts.minutes);

  // the box's own plan: warm-up scale, due cards lowest box first, a few new ones; how many new ones
  // depends on how the last sessions went (the zone where practice teaches most)
  const base = planSession(deck, store, day, used, newCards(store));

  // warm-up: something the hands know, never new
  const warm =
    deck.intro.find((id) => !used.has(id) && byId.get(id)?.family === "scales" && (store.cards[id]?.box ?? 0) >= 2) ??
    base.find((id) => byId.get(id)?.family === "scales" && known(id));
  const warmup: string[] = [];

  // focus: the arc's mistake, where it shows most
  const arc = nextArc(opts.arc ?? null, opts.profile ?? null, day);
  const weak: Weakness | undefined = arc ? opts.profile?.weaknesses.find((w) => w.cls === arc.cls) : undefined;
  const local = (id: string) => (id.startsWith(opts.tuneId + GLUE) ? id.slice(opts.tuneId.length + GLUE.length) : id);
  let focus: string[] = [];
  let why = "";
  if (weak) {
    focus = weak.cards.map(local).filter((id) => byId.has(id) && !used.has(id)).slice(0, MAX_FOCUS);
    if (focus.length) why = weak.fact;
  }
  if (!focus.length) {
    // the last run-through's short bars, in the smallest melody cards that hold them
    const run = chronologicalAttempts(store.history ?? []).reverse().find((x) => x.id === "mel:run" && x.ev?.weakBars?.length && daysBetween(x.day, day) < RUN_DAYS);
    const weakBars = run?.ev?.weakBars ?? [];
    const barsOf = (id: string) => {
      const c = byId.get(id)!;
      return new Set(c.tl.slots.slice(c.from, c.to + 1).map((x) => x.bar));
    };
    const picked: string[] = [];
    for (const bar of weakBars) {
      const best = deck.intro
        .filter((id) => !used.has(id) && !picked.includes(id) && byId.get(id)?.family === "melody" && !byId.get(id)?.run && byId.get(id)?.tuneId === opts.tuneId && barsOf(id).has(bar))
        .sort((x, y) => barsOf(x).size - barsOf(y).size)[0];
      if (best && !picked.some((id) => barsOf(id).has(bar))) picked.push(best);
      if (picked.length >= 3) break;
    }
    if (picked.length) {
      focus = picked;
      why = `Run-through · bar${weakBars.length > 1 ? "s" : ""} ${weakBars.slice(0, 4).map((b) => b + 1).join(", ")}`;
    }
  }
  if (!focus.length && opts.profile) {
    // nothing named: the skill left alone longest, if it has been a while
    const stale = (Object.entries(opts.profile.axes) as [Axis, SkillProfile["axes"][Axis]][])
      .filter(([, a]) => a.last && daysBetween(a.last, day) >= NEGLECT_DAYS)
      .sort((x, y) => x[1].last!.localeCompare(y[1].last!))[0];
    if (stale) {
      const fams = AXIS_FAMILIES[stale[0]];
      focus = deck.intro
        .filter((id) => !used.has(id) && known(id) && fams.includes(byId.get(id)!.family))
        .sort((a, b) => store.cards[a].box - store.cards[b].box)
        .slice(0, 3);
      if (focus.length) why = `${stale[0][0].toUpperCase()}${stale[0].slice(1)} · ${daysBetween(stale[1].last!, day)} days`;
    }
  }
  // Reserve something from the tune before spending the budget on drills. A new player's first
  // melody chunk can close the session too. Prefer a different passage from the focus.
  const melodies = deck.intro
    .filter((id) => !used.has(id) && byId.get(id)?.family === "melody" && byId.get(id)?.tuneId === opts.tuneId && (known(id) || base.includes(id)))
    .sort((a, b) => Number(focus.includes(a)) - Number(focus.includes(b)) || (store.cards[b]?.box ?? 0) - (store.cards[a]?.box ?? 0));
  const melody = melodies.find((id) => cost(id) <= budget);
  const music: string[] = melody ? [melody] : [];
  if (melody) used.add(melody);
  let remaining = budget - (melody ? cost(melody) : 0);

  // Every block uses the same budget, including the focus. Skip an oversized card so a shorter
  // candidate can still fit; an estimate is allowed to be short, never silently longer.
  const fit = (ids: string[], minutes: number) => {
    const out: string[] = [];
    let m = 0;
    for (const id of ids) {
      if (used.has(id) || m + cost(id) > minutes) continue;
      out.push(id);
      used.add(id);
      m += cost(id);
    }
    return out;
  };
  const spent = (ids: string[]) => ids.reduce((a, id) => a + cost(id), 0);
  if (warm && cost(warm) <= remaining) {
    warmup.push(warm);
    used.add(warm);
    remaining -= cost(warm);
  }
  focus = fit(focus, remaining);
  remaining -= spent(focus);
  if (!focus.length) why = "";
  const review = fit(base, remaining);
  remaining -= spent(review);

  // nothing at all due or named: the box's leftovers, so there is always a session
  if (!focus.length && !review.length && !music.length) {
    const extra = deck.intro.filter((id) => !used.has(id) && known(id)).sort((a, b) => store.cards[a].box - store.cards[b].box);
    review.push(...fit(extra, remaining));
  }

  const blocks: Block[] = (
    [
      { role: "warmup", cards: warmup },
      { role: "focus", cards: focus },
      { role: "review", cards: review },
      { role: "music", cards: music },
    ] as const
  )
    .filter((b) => b.cards.length)
    .map((b) => ({ role: b.role, cards: [...b.cards], minutes: Math.round(spent(b.cards)) }));
  const ids = blocks.flatMap((b) => b.cards);
  return { blocks, ids, minutes: ids.length ? Math.min(budget, Math.max(1, Math.round(spent(ids)))) : 0, why, arc };
}

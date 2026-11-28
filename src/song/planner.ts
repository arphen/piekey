import type { Card, Deck, Family } from "./deck";
import { getStoredItem, removeStoredItem, setStoredItem } from "../storage";
import { GLUE } from "./ids";
import { chronologicalAttempts, isExcluded, planSession, unlocked, type Store } from "./leitner";
import type { Axis, MistakeClass, SkillProfile, Weakness } from "./profile";
import { familyOf } from "./stats";
import { GOAL_LABELS, goalProgress, type Goal } from "./goals";

// A session with a shape, as a teacher would plan it: hands first (a key- and position-anchored
// warm-up), then the one thing most worth working on (the focus), an in-key pattern-breaker /
// reset between heavy melody work, what the box says is due (review), and something to play
// (music). The focus comes from the player's profile and holds for days (an arc) until the
// mistake behind it has shrunk. The plan fills minutes, not a number of cards: how long each kind
// of exercise takes is read off the player's own history.

export type Length = "short" | "normal" | "long";
export const LENGTHS: Length[] = ["short", "normal", "long"];
export const LENGTH_MINUTES: Record<Length, number> = { short: 10, normal: 25, long: 45 };

export type Role = "warmup" | "focus" | "review" | "side" | "music";
export const ROLE_LABEL: Record<Role, string> = {
  warmup: "Warm-up",
  focus: "Focus",
  review: "Review",
  side: "Side study",
  music: "Music",
};

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
  sideWhy?: string; // optional side-education / palate-cleanser reason
  arc: Arc | null; // the arc to keep after this plan (new, carried on, or none)
}

// Meatier per-card estimates so a 25-min session schedules ~4–6 cohesive units where the player
// can actually climb BPM instead of 10–12 rapid-fire flashcards.
const SECS: Record<Family, number> = { scales: 115, technique: 110, harmony: 175, melody: 215, chords: 175, reading: 120, ear: 95, fretboard: 85 };
const IMPROV_EXTRA_S = 35;
const BETWEEN_S = 15; // intro and result screens around each card
const ARC_DAYS = 10; // an arc rests after this long, resolved or not
const RESOLVED = 0.5; // ... or once the mistake is down to this share of where it began
const NEGLECT_DAYS = 7;
const MAX_FOCUS = 3;
const ZONE_ATTEMPTS = 16; // the attempts that say how it is going lately
const ZONE_LOW = 0.55;
const ZONE_MID = 0.7;
const ZONE_HIGH = 0.85;
const RUN_DAYS = 14; // a run-through's short bars are worked on for this long after it
const AXIS_FAMILIES: Record<Axis, Family[]> = {
  pitch: ["melody", "scales", "technique", "fretboard"],
  time: ["scales", "technique", "melody"],
  tempo: ["scales", "technique"],
  chords: ["chords", "harmony"],
  reading: ["reading"],
  ear: ["ear"],
};
const ARC_KEY = "guitar-arc";

const MELODY_SPAN_RANK: Record<string, number> = { new: 1, review: 1, join: 2, section: 3, memory: 3, tune: 4 };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function spanRank(card: Card | undefined): number {
  if (!card) return 0;
  if (card.run) return 5;
  return MELODY_SPAN_RANK[card.step?.kind ?? ""] ?? (card.to - card.from + 1);
}

function isShortMelodyChunk(card: Card | undefined): boolean {
  return Boolean(card && card.family === "melody" && (card.step?.kind === "new" || card.step?.kind === "review"));
}

function isChunkConfident(card: Card, store: Store): boolean {
  const st = store.cards[card.id];
  if (!st) return false;
  if (st.box >= 3) return true;
  const best = st.bestCleanBpm ?? 0;
  return card.goalBpm > 0 && best >= 0.8 * card.goalBpm;
}

/** Seconds a card of this family takes this player: bounded median of their own attempts, else a guess. */
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
    const median = s[s.length >> 1];
    // Cap per-card planning estimates so marathon Free Ride sessions or tough phrases never
    // inflate estimates to 10+ minutes and collapse future sessions down to a single exercise.
    out[f] = Math.max(45, Math.min(Math.round(SECS[f] * 1.4), median));
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
 * New cards for this session, from how recent attempts went: softened taper rather than a cliff —
 * under 55% clean keeps 1 new card flowing, 55–70% halves the usual pace (min 1), 70–85% holds
 * steady, and above 85% adds two more than usual.
 */
export function newCards(store: Store): number {
  const usual = store.settings.newPerSession;
  const recent = chronologicalAttempts(store.history ?? []).filter((a) => a.result !== "skip").slice(-ZONE_ATTEMPTS);
  if (recent.length < ZONE_ATTEMPTS / 2) return usual;
  const clean = recent.filter((a) => a.result === "clean").length / recent.length;
  if (clean < ZONE_LOW) return 1;
  if (clean < ZONE_MID) return Math.max(1, Math.floor(usual / 2));
  if (clean > ZONE_HIGH) return usual + 2;
  return usual;
}

export interface PlanOptions {
  minutes: number;
  tuneId: string; // the session's own tune: its ids carry no tune in the profile's terms
  profile?: SkillProfile | null;
  arc?: Arc | null;
  exclude?: Set<string>;
  goal?: Goal | null;
}

export function planBlocks(deck: Deck, store: Store, day: string, opts: PlanOptions): SessionPlan {
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const secs = cardSeconds(store);
  const cost = (id: string) => {
    const card = byId.get(id);
    const baseSec = card ? secs[card.family] + (card.kind === "improv" ? IMPROV_EXTRA_S : 0) : 120;
    return (baseSec + BETWEEN_S) / 60;
  };
  const used = new Set(opts.exclude ?? []);
  const excluded = (id: string) => isExcluded(store.cards[id]);
  const known = (id: string) => Boolean(store.cards[id]) && !excluded(id);
  const budget = Math.max(0, opts.minutes);
  const goal = opts.goal?.tuneId === opts.tuneId ? opts.goal : null;
  const homeKeyName = deck.harmony.home.name;
  const activePos = deck.window.p;

  const isHomeScale = (card: Card | undefined) => Boolean(card && card.family === "scales" && card.group === homeKeyName);
  const isHomeArp = (card: Card | undefined) => Boolean(card && card.family === "harmony" && card.kind === "arps" && card.tuneId === opts.tuneId);
  const isFreshReading = (card: Card | undefined) => Boolean(card && card.family === "reading" && card.tuneId === opts.tuneId);

  /** Pick one crisp in-key, in-position pattern-breaker / reset card (reading, arpeggio, or home scale). */
  const pickReset = (maxMinutes: number, presentFamilies: Set<Family | undefined>, preferReading: boolean): { id: string; reason: string } | null => {
    const ok = (id: string) => {
      const c = byId.get(id);
      return Boolean(c && !used.has(id) && !excluded(id) && unlocked(c, store) && cost(id) <= maxMinutes);
    };
    const inWindowFirst = (ids: string[]) =>
      [...ids].sort((a, b) => Number(byId.get(b)!.p === activePos) - Number(byId.get(a)!.p === activePos) || (store.cards[a]?.box ?? 0) - (store.cards[b]?.box ?? 0));

    const readingIds = inWindowFirst(deck.intro.filter((id) => ok(id) && isFreshReading(byId.get(id))));
    const arpIds = inWindowFirst(deck.intro.filter((id) => ok(id) && isHomeArp(byId.get(id))));
    const scaleIds = inWindowFirst(deck.intro.filter((id) => ok(id) && isHomeScale(byId.get(id))));

    const buckets: { family: Family; ids: string[]; reason: string }[] = preferReading
      ? [
          { family: "reading", ids: readingIds, reason: "Pattern breaker · fresh reading in position" },
          { family: "harmony", ids: arpIds, reason: "Pattern breaker · in-key chord arpeggios" },
          { family: "scales", ids: scaleIds, reason: `Pattern breaker · ${homeKeyName} in position` },
        ]
      : [
          { family: "harmony", ids: arpIds, reason: "Palate cleanser · in-key chord arpeggios" },
          { family: "reading", ids: readingIds, reason: "Palate cleanser · fresh reading in position" },
          { family: "scales", ids: scaleIds, reason: `Palate cleanser · ${homeKeyName} in position` },
        ];

    // Prefer a reset family not already represented in the session, then fall back to any available bucket.
    const unrepresented = buckets.find((b) => !presentFamilies.has(b.family) && b.ids.length > 0);
    const chosen = unrepresented ?? buckets.find((b) => b.ids.length > 0);
    return chosen ? { id: chosen.ids[0], reason: chosen.reason } : null;
  };

  // A new tune starts directly on playing Bar 1 (never auto-inserts mel:hear as Card 1).
  // While the opening join/section is still below Box 2, prioritize the tune's own melody chunks
  // and newly unlocked joins — and weave in a crisp in-key, in-position reset card when only one
  // melody chunk fits or when returning to opening work so sessions aren't stuck at 1 card.
  const openingCard = (["join", "section", "tune"] as const)
    .map((kind) => deck.cards.find((c) => c.tuneId === opts.tuneId && c.step?.kind === kind))
    .find(Boolean);
  const hasOwnSide = deck.cards.some((c) => c.family !== "melody" && c.family !== "scales" && c.family !== "technique" && known(c.id));
  const hasCustomCurriculum = deck.cards.some((c) => c.id.startsWith("custom:") && !used.has(c.id) && !excluded(c.id));
  const learningOpening = !goal && !hasOwnSide && !hasCustomCurriculum && Boolean(openingCard && !excluded(openingCard.id) && (store.cards[openingCard.id]?.box ?? 0) < 2);
  if (learningOpening) {
    const ownMelodies = deck.intro.filter((id) => {
      const c = byId.get(id);
      return Boolean(c && c.family === "melody" && c.tuneId === opts.tuneId && !c.once && !used.has(id) && !excluded(id));
    });
    const practicedOwn = ownMelodies.filter((id) => Boolean(store.cards[id]));
    // Due opening chunks first (lowest box first), then newly unlocked chunks/joins in order.
    const dueOwn = ownMelodies
      .filter((id) => store.cards[id] && store.cards[id].due <= day)
      .sort((a, b) => store.cards[a].box - store.cards[b].box);
    const freshOwn = ownMelodies.filter((id) => !store.cards[id] && unlocked(byId.get(id), store));

    const openingIds: string[] = [];
    const addOpening = (id: string) => {
      if (used.has(id) || !byId.has(id)) return;
      used.add(id);
      openingIds.push(id);
    };
    let m = 0;
    for (const id of [...dueOwn, ...freshOwn]) {
      if (used.has(id)) continue;
      if (openingIds.length > 0 && m + cost(id) > budget) continue;
      addOpening(id);
      m += cost(id);
    }

    // If the opening chunks were already practised today (not due) and no fresh chunk/join is open
    // yet, revisit the lowest-box opening chunks AND allow a crisp in-key reset card alongside them.
    const revisitingToday = practicedOwn.length > 0 && openingIds.length === 0;
    if (revisitingToday) {
      const fallback = [...practicedOwn].sort((a, b) => store.cards[a].box - store.cards[b].box);
      for (const id of fallback) {
        if (openingIds.length > 0 && m + cost(id) > budget) continue;
        addOpening(id);
        m += cost(id);
      }
    }

    // Returning to opening work after already practising chunks: weave 1 crisp in-key/in-position
    // reset card when room remains so repeats don't feel like a closed loop or 1-card session.
    let resetCard: { id: string; reason: string } | null = null;
    if (practicedOwn.length > 0 && openingIds.length > 0 && budget - m >= 1) {
      const stalled = openingIds.some((id) => store.cards[id]?.last === "fail" || store.cards[id]?.last === "ok");
      if (openingIds.length === 1 || revisitingToday || stalled || openingIds.length >= 2) {
        resetCard = pickReset(budget - m, new Set<Family | undefined>(["melody"]), stalled);
        if (resetCard) {
          used.add(resetCard.id);
          m += cost(resetCard.id);
        }
      }
    }

    if (openingIds.length > 0) {
      const spent = (ids: string[]) => ids.reduce((a, id) => a + cost(id), 0);
      const blocks: Block[] = [];
      if (resetCard && openingIds.length >= 2) {
        blocks.push(
          { role: "focus", cards: [openingIds[0]], minutes: Math.round(spent([openingIds[0]])) },
          { role: "side", cards: [resetCard.id], minutes: Math.round(spent([resetCard.id])) },
          { role: "music", cards: openingIds.slice(1), minutes: Math.round(spent(openingIds.slice(1))) },
        );
      } else if (resetCard && openingIds.length === 1) {
        blocks.push(
          { role: "side", cards: [resetCard.id], minutes: Math.round(spent([resetCard.id])) },
          { role: "music", cards: openingIds, minutes: Math.round(spent(openingIds)) },
        );
      } else {
        blocks.push({ role: "music", cards: openingIds, minutes: Math.round(spent(openingIds)) });
      }
      const ids = blocks.flatMap((b) => b.cards);
      return {
        blocks,
        ids,
        minutes: ids.length ? Math.min(budget, Math.max(1, Math.round(spent(ids)))) : 0,
        why: "",
        ...(resetCard ? { sideWhy: resetCard.reason } : {}),
        arc: null,
      };
    }
  }

  const relevant = new Set<string>();
  const include = (id: string) => {
    if (relevant.has(id) || !byId.has(id)) return;
    relevant.add(id);
    const needs = byId.get(id)?.needs;
    if (needs) include(needs);
  };
  goal?.essentialTasks.forEach((task) => include(task.cardId));
  const servesGoal = (id: string) => !goal || relevant.has(id);
  const local = (id: string) => (id.startsWith(opts.tuneId + GLUE) ? id.slice(opts.tuneId.length + GLUE.length) : id);
  const profile = goal && opts.profile ? {
    ...opts.profile,
    weaknesses: opts.profile.weaknesses.map((weakness) => ({ ...weakness, cards: weakness.cards.filter((id) => servesGoal(local(id))) })).filter((weakness) => weakness.cards.length),
  } : opts.profile;

  // the box's own plan: warm-up scale, due cards lowest box first, a few new ones; how many new ones
  // depends on how the last sessions went (the zone where practice teaches most)
  const rawBase = planSession(goal ? { ...deck, intro: deck.intro.filter(servesGoal) } : deck, store, day, used, newCards(store));

  // As shorter melody chunks gain box/tempo confidence, prefer longer melody passages (joins,
  // sections, whole tune) while keeping weak/slow chunks drillable.
  const confidentShortIds = new Set(
    deck.cards.filter((c) => c.tuneId === opts.tuneId && isShortMelodyChunk(c) && isChunkConfident(c, store)).map((c) => c.id),
  );
  const hasLongerPassage = deck.cards.some(
    (c) => c.tuneId === opts.tuneId && c.family === "melody" && !c.once && spanRank(c) >= 2 && (known(c.id) || unlocked(c, store)),
  );
  const base = confidentShortIds.size && hasLongerPassage
    ? [...rawBase].sort((a, b) => Number(confidentShortIds.has(a)) - Number(confidentShortIds.has(b)))
    : rawBase;

  // Position-anchored, key-anchored warm-up: prioritize the tune's own home-key scale (or arpeggio)
  // in the active fret window. Never pull remote-key tech:* foundations into song sessions; only
  // use tech:* as a warm-up when the deck has no scale card (e.g., Technique focus mode).
  const hasDeckScales = deck.cards.some((c) => c.family === "scales");
  const findKnown = (pred: (card: Card) => boolean, minBox = 2) =>
    deck.intro.find((id) => !used.has(id) && !excluded(id) && byId.has(id) && pred(byId.get(id)!) && (store.cards[id]?.box ?? 0) >= minBox) ??
    deck.intro.find((id) => !used.has(id) && !excluded(id) && byId.has(id) && pred(byId.get(id)!) && known(id));
  const homeScaleWarm =
    findKnown((c) => isHomeScale(c) && c.p === activePos) ??
    findKnown((c) => isHomeScale(c)) ??
    findKnown((c) => c.family === "scales") ??
    base.find((id) => !used.has(id) && !excluded(id) && byId.get(id)?.family === "scales" && known(id));
  const homeArpWarm = findKnown((c) => isHomeArp(c) && c.p === activePos) ?? findKnown((c) => isHomeArp(c));
  const techWarm = !hasDeckScales ? findKnown((c) => c.family === "technique") : undefined;
  const warm = homeScaleWarm ?? homeArpWarm ?? techWarm;
  const warmup: string[] = [];

  // focus: the arc's mistake, where it shows most (capped at MAX_FOCUS = 3)
  const arc = nextArc(opts.arc ?? null, profile ?? null, day);
  const weak: Weakness | undefined = arc ? profile?.weaknesses.find((w) => w.cls === arc.cls) : undefined;
  let focus: string[] = [];
  let why = "";
  // A focus works on a part. The whole tune and the run-through show every mistake most (they are
  // the longest), but working on them is playing the tune again: they stay music, never the focus.
  const whole = (id: string) => Boolean(byId.get(id)?.run || byId.get(id)?.once || byId.get(id)?.step?.kind === "tune");
  if (weak) {
    const candidates = weak.cards.map(local).filter((id) => byId.has(id) && !used.has(id) && !excluded(id) && !whole(id));
    // Keep weak/slow chunks drillable; only demote short chunks that are already confident when longer passages are also named.
    const sorted = confidentShortIds.size
      ? [...candidates].sort((a, b) => Number(confidentShortIds.has(a)) - Number(confidentShortIds.has(b)))
      : candidates;
    focus = sorted.slice(0, MAX_FOCUS);
    if (focus.length) why = weak.fact;
  }
  if (!focus.length && (!goal || goal.kind === "melody")) {
    // the last run-through's short bars, in the smallest melody cards that hold them
    const run = chronologicalAttempts(store.history ?? []).reverse().find((x) => x.conditions?.source !== "self" && x.id === "mel:run" && x.ev?.weakBars?.length && daysBetween(x.day, day) < RUN_DAYS);
    const weakBars = run?.ev?.weakBars ?? [];
    const barsOf = (id: string) => {
      const c = byId.get(id)!;
      return new Set(c.tl.slots.slice(c.from, c.to + 1).map((x) => x.bar));
    };
    const picked: string[] = [];
    for (const bar of weakBars) {
      const best = deck.intro
        .filter((id) => servesGoal(id) && !used.has(id) && !excluded(id) && !picked.includes(id) && byId.get(id)?.family === "melody" && !byId.get(id)?.run && byId.get(id)?.tuneId === opts.tuneId && barsOf(id).has(bar))
        .sort((x, y) => barsOf(x).size - barsOf(y).size)[0];
      if (best && !picked.some((id) => barsOf(id).has(bar))) picked.push(best);
      if (picked.length >= MAX_FOCUS) break;
    }
    if (picked.length) {
      focus = picked;
      why = `Run-through · bar${weakBars.length > 1 ? "s" : ""} ${weakBars.slice(0, 4).map((b) => b + 1).join(", ")}`;
    }
  }
  if (!focus.length && goal) {
    const ready = (id: string, visiting = new Set<string>()): string | undefined => {
      if (used.has(id) || excluded(id) || visiting.has(id) || !byId.has(id)) return;
      visiting.add(id);
      const card = byId.get(id)!;
      return unlocked(card, store) ? id : card.needs ? ready(card.needs, visiting) : id;
    };
    // Box rank and kinship can schedule a task; only an actual clean tempo can satisfy its target.
    const demonstrated = new Set(goalProgress(goal, store).taskIds);
    const unfinished = goal.essentialTasks.filter((item) => !demonstrated.has(item.cardId));
    const id = (unfinished.length ? unfinished : goal.essentialTasks).map((item) => ready(item.cardId)).find(Boolean);
    if (id) {
      focus = [id];
      why = `${GOAL_LABELS[goal.kind]} · ${byId.get(id)!.title}`;
    }
  }
  if (!focus.length && opts.profile && !goal) {
    // nothing named: the skill left alone longest, if it has been a while
    const stale = (Object.entries(opts.profile.axes) as [Axis, SkillProfile["axes"][Axis]][])
      .filter(([, a]) => a.last && daysBetween(a.last, day) >= NEGLECT_DAYS)
      .sort((x, y) => x[1].last!.localeCompare(y[1].last!))[0];
    if (stale) {
      const fams = AXIS_FAMILIES[stale[0]];
      focus = deck.intro
        .filter((id) => !used.has(id) && !excluded(id) && known(id) && fams.includes(byId.get(id)!.family))
        .sort((a, b) => Number(confidentShortIds.has(a)) - Number(confidentShortIds.has(b)) || store.cards[a].box - store.cards[b].box)
        .slice(0, MAX_FOCUS);
      if (focus.length) why = `${stale[0][0].toUpperCase()}${stale[0].slice(1)} · ${daysBetween(stale[1].last!, day)} days`;
    }
  }

  // Reserve something from the tune before spending the budget on drills. Prefer a different passage
  // from the focus, and once shorter chunks are confident, graduate to longer passages (joins,
  // sections, whole tune, run-through).
  const melodies = (goal ? goal.essentialTasks.map((task) => task.cardId) : deck.intro)
    .filter((id) => {
      const c = byId.get(id);
      if (used.has(id) || excluded(id) || !c || c.tuneId !== opts.tuneId || c.once) return false;
      if (goal) return unlocked(c, store);
      if (c.family !== "melody") return false;
      if (known(id) || base.includes(id)) return true;
      // When shorter chunks have gained confidence, also offer unlocked longer passages directly.
      return confidentShortIds.size > 0 && spanRank(c) >= 2 && unlocked(c, store);
    })
    .sort((a, b) => {
      const focusDiff = Number(focus.includes(a)) - Number(focus.includes(b));
      if (focusDiff !== 0) return focusDiff;
      if (!goal && confidentShortIds.size > 0) {
        const confDiff = Number(confidentShortIds.has(a)) - Number(confidentShortIds.has(b));
        if (confDiff !== 0) return confDiff;
        const spanDiff = spanRank(byId.get(b)) - spanRank(byId.get(a));
        if (spanDiff !== 0) return spanDiff;
      }
      return (store.cards[b]?.box ?? 0) - (store.cards[a]?.box ?? 0);
    });
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

  // Pattern-breaker / reset: in normal/long un-goaled sessions for returning players, weave 1 crisp
  // in-key, in-position reset card (fresh reading, in-key arpeggio, or home-key scale) between heavy
  // melody work instead of dumping unrelated side-study families at the end.
  const side: string[] = [];
  let sideWhy = "";
  const hasHistory = Object.keys(store.cards).length > 0;
  const recentMelodyMiss = chronologicalAttempts(store.history ?? [])
    .slice(-6)
    .some((a) => familyOf(a.id) === "melody" && (a.result === "fail" || a.result === "ok"));
  const focusHasMelody = focus.some((id) => byId.get(id)?.family === "melody");
  const melodyStalled = recentMelodyMiss || [...focus, ...music].some((id) => byId.get(id)?.family === "melody" && (store.cards[id]?.last === "fail" || store.cards[id]?.last === "ok"));
  if (!goal && hasHistory && budget >= 15 && remaining >= 1) {
    const presentFamilies = new Set([...warmup, ...focus, ...music].map((id) => byId.get(id)?.family));
    const reset = pickReset(remaining, presentFamilies, melodyStalled || focusHasMelody);
    if (reset) {
      side.push(reset.id);
      used.add(reset.id);
      remaining -= cost(reset.id);
      sideWhy = reset.reason;
    }
  }

  const review = fit(base, remaining);
  remaining -= spent(review);

  // nothing at all due or named (or budget still has room after only 1 card): fill from the box's
  // leftovers or unlocked cards so a planned session doesn't collapse to 1 exercise when more fits.
  const scheduledCount = warmup.length + focus.length + side.length + review.length + music.length;
  if ((scheduledCount === 0 || (scheduledCount === 1 && remaining >= 1)) && remaining > 0) {
    const extraKnown = deck.intro
      .filter((id) => servesGoal(id) && !used.has(id) && !excluded(id) && known(id) && !byId.get(id)?.once)
      .sort((a, b) => store.cards[a].box - store.cards[b].box);
    const extraFresh = deck.intro
      .filter((id) => servesGoal(id) && !used.has(id) && !excluded(id) && !store.cards[id] && !byId.get(id)?.once && unlocked(byId.get(id), store));
    review.push(...fit([...extraKnown, ...extraFresh], remaining));
  }

  // Place the pattern-breaker / reset right between focus and review (when focus has heavy work),
  // or between review and closing music otherwise, so heavy melody blocks always get a breath.
  const ordered: { role: Role; cards: string[] }[] = focus.length
    ? [
        { role: "warmup", cards: warmup },
        { role: "focus", cards: focus },
        { role: "side", cards: side },
        { role: "review", cards: review },
        { role: "music", cards: music },
      ]
    : [
        { role: "warmup", cards: warmup },
        { role: "review", cards: review },
        { role: "side", cards: side },
        { role: "music", cards: music },
      ];

  const blocks: Block[] = ordered
    .filter((b) => b.cards.length)
    .map((b) => ({ role: b.role, cards: [...b.cards], minutes: Math.round(spent(b.cards)) }));
  const ids = blocks.flatMap((b) => b.cards);
  return { blocks, ids, minutes: ids.length ? Math.min(budget, Math.max(1, Math.round(spent(ids)))) : 0, why, ...(sideWhy ? { sideWhy } : {}), arc };
}

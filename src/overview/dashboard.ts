import { FAMILY_LABEL, type Deck, type Family } from "../song/deck";
import { loadActiveGoal } from "../song/goals";
import { localId, tuneOf } from "../song/ids";
import { addDays, BOXES, chronologicalAttempts, type Store } from "../song/leitner";
import { loadArc, newCards, planBlocks, ROLE_LABEL, type Arc, type Role } from "../song/planner";
import { allAttempts, buildProfile, type MistakeClass, type SkillProfile, type Weakness } from "../song/profile";
import { familyOf } from "../song/stats";
import type { LeadSheet } from "../tunes/musicxml";

// Read-only analytics & scheduler transparency for the Progress dashboard.
// Never mutates stores, arcs or boxes; runs the exact same profile & planner rules as Guitar mode.

export interface DailyPracticeCell {
  day: string;
  minutes: number;
  sessions: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface FamilyMastery {
  family: Family;
  label: string;
  started: number;
  mastered: number;
  avgBox: number;
}

export interface TempoHighlight {
  id: string;
  title: string;
  tuneTitle: string;
  bpm: number;
  goalBpm: number | null;
}

export interface PracticeDashboard {
  totalMinutes: number;
  weekMinutes: number;
  prevWeekMinutes: number;
  totalSessions: number;
  activeDays84: number;
  currentStreak: number;
  bestStreak: number;
  totalAttempts: number;
  measuredAttempts: number;
  cleanRate: number | null;
  recentCleanRate: number | null;
  recentAttemptsCount: number;
  boxCounts: [number, number, number, number, number];
  startedCards: number;
  masteredCards: number;
  dueCards: number;
  familyBreakdown: FamilyMastery[];
  heatmap: DailyPracticeCell[];
  weeklySeries: number[]; // last 12 weeks, oldest first
  profile: SkillProfile;
}

export interface WeaknessDiagnosis {
  cls: MistakeClass;
  title: string;
  fact: string;
  explanation: string;
  strength: number;
  samples: number;
  isActiveArc: boolean;
  drillCardId: string | null;
  drillTuneId: string | null;
  drillLabel: string | null;
}

export interface PlannedBlockPreview {
  role: Role;
  label: string;
  minutes: number;
  cards: { id: string; title: string; family: Family; box: number }[];
}

export interface SchedulerExplanation {
  focusKind: "weakness-arc" | "run-bars" | "goal" | "neglected" | "balanced";
  focusHeadline: string;
  focusReason: string;
  arcDay: number | null;
  arcMaxDays: number;
  pacingZone: "consolidating" | "steady" | "cruising" | "baseline";
  pacingLabel: string;
  pacingReason: string;
  newCardsPerSession: number;
  usualNewCards: number;
  recentCleanPct: number | null;
  sideStudyReason: string | null;
  blocks: PlannedBlockPreview[];
  totalMinutes: number;
  diagnoses: WeaknessDiagnosis[];
}

const HEATMAP_DAYS = 84; // 12 weeks
const ARC_MAX_DAYS = 10;
const ZONE_ATTEMPTS = 16;

const WEAKNESS_COPY: Record<MistakeClass, { title: string; explanation: string }> = {
  leaps: {
    title: "Wide interval leaps",
    explanation: "Wider note jumps miss significantly more often than stepwise lines. The planner pins lines containing these leaps and pairs string-skipping mechanics.",
  },
  crossing: {
    title: "String crossings",
    explanation: "Right- and left-hand coordination dips when switching strings mid-phrase. The scheduler brings crossing-heavy passages forward and adds string-skip drills.",
  },
  shifts: {
    title: "Position shifts",
    explanation: "Hand shifts up or down the neck are causing extra misses. The planner prioritizes shifting phrases and pairs position-connection foundations.",
  },
  accidental: {
    title: "Recurring semitone slip",
    explanation: "The same target pitch repeatedly lands a half-step off. The planner surfaces the affected lines and pairs enclosure / finger-independence drills.",
  },
  unsteady: {
    title: "Timing spread",
    explanation: "Onsets are scattered around the beat more than 50 ms on average. The planner focuses on steady short phrases and pairs the rhythm pyramid.",
  },
  rushing: {
    title: "Rushing the beat",
    explanation: "Recent timed passes tend to creep ahead of the pulse.",
  },
  dragging: {
    title: "Dragging the beat",
    explanation: "Recent timed passes tend to fall behind the pulse.",
  },
  ear: {
    title: "Playing by ear lags sight",
    explanation: "Accuracy on ear-echo phrases is trailing written/neck accuracy by more than 25%. The planner brings call-and-response cards forward.",
  },
};

const FAMILIES_ORDER: Family[] = ["melody", "chords", "harmony", "scales", "technique", "reading", "ear", "fretboard"];

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function intensityFor(minutes: number, sessions: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0 && sessions <= 0) return 0;
  if (minutes < 10) return 1;
  if (minutes < 22) return 2;
  if (minutes < 40) return 3;
  return 4;
}

/** Build the global ego-bliss & diagnostic analytics from all stored practice data. */
export function buildPracticeDashboard(
  stores: { tuneId: string; store: Store }[],
  day: string,
  latencyOk = true,
): PracticeDashboard {
  const attempts = allAttempts(stores);
  const profile = buildProfile(attempts, day, latencyOk);

  // Aggregate daily practice minutes & session counts across all stores
  const byDay = new Map<string, { minutes: number; sessions: number }>();
  let totalMinutes = 0;
  let totalSessions = 0;

  for (const { store } of stores) {
    for (const s of store.sessions ?? []) {
      const m = Number.isFinite(s.minutes) ? Math.max(0, s.minutes) : 0;
      totalMinutes += m;
      totalSessions += 1;
      const cur = byDay.get(s.date) ?? { minutes: 0, sessions: 0 };
      cur.minutes += m;
      cur.sessions += 1;
      byDay.set(s.date, cur);
    }
    // Also mark days that have recorded attempts even if a session was short (<1 min)
    for (const a of store.history ?? []) {
      if (!a.day || a.result === "skip") continue;
      const cur = byDay.get(a.day);
      if (!cur) byDay.set(a.day, { minutes: Math.max(1, Math.round((a.secs || 30) / 60)), sessions: 1 });
    }
  }

  // 84-day heatmap (oldest → today)
  const startDay = addDays(day, -(HEATMAP_DAYS - 1));
  const heatmap: DailyPracticeCell[] = [];
  let activeDays84 = 0;
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const d = addDays(startDay, i);
    const info = byDay.get(d) ?? { minutes: 0, sessions: 0 };
    if (info.minutes > 0 || info.sessions > 0) activeDays84++;
    heatmap.push({
      day: d,
      minutes: Math.round(info.minutes),
      sessions: info.sessions,
      intensity: intensityFor(info.minutes, info.sessions),
    });
  }

  // 12-week minute series (oldest → newest)
  const weeklySeries: number[] = Array(12).fill(0);
  for (let i = 0; i < heatmap.length; i++) {
    weeklySeries[Math.min(11, Math.floor(i / 7))] += heatmap[i].minutes;
  }
  const weekMinutes = weeklySeries[11] ?? 0;
  const prevWeekMinutes = weeklySeries[10] ?? 0;

  // Current streak (consecutive days ending today or yesterday) & best streak overall
  const activeDates = [...byDay.entries()]
    .filter(([, v]) => v.minutes > 0 || v.sessions > 0)
    .map(([d]) => d)
    .sort();
  let bestStreak = 0;
  let run = 0;
  let prevDate = "";
  for (const d of activeDates) {
    if (prevDate && daysBetween(prevDate, d) === 1) run += 1;
    else run = 1;
    if (run > bestStreak) bestStreak = run;
    prevDate = d;
  }

  let currentStreak = 0;
  const activeSet = new Set(activeDates);
  let cursor = activeSet.has(day) ? day : addDays(day, -1);
  while (activeSet.has(cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  // Measured accuracy stats
  const measured = attempts.filter((a) => a.conditions?.source !== "self");
  const cleanCount = measured.filter((a) => a.result === "clean").length;
  const cleanRate = measured.length ? cleanCount / measured.length : null;
  const recent = measured.slice(-ZONE_ATTEMPTS);
  const recentCleanRate = recent.length ? recent.filter((a) => a.result === "clean").length / recent.length : null;

  // Deduplicated Leitner card boxes & per-family breakdown
  const boxCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const seenCardKeys = new Set<string>();
  const famAcc = new Map<Family, { started: number; mastered: number; boxSum: number }>();
  let dueCards = 0;

  for (const { tuneId, store } of stores) {
    for (const [id, state] of Object.entries(store.cards ?? {})) {
      const key = id.startsWith("scale:") || id.startsWith("tech:") ? id : `${tuneId}::${id}`;
      if (seenCardKeys.has(key)) continue;
      seenCardKeys.add(key);
      const box = Math.max(1, Math.min(BOXES, state.box || 1));
      boxCounts[box - 1] += 1;
      if (state.due && state.due <= day) dueCards += 1;
      const fam = familyOf(id);
      const entry = famAcc.get(fam) ?? { started: 0, mastered: 0, boxSum: 0 };
      entry.started += 1;
      entry.boxSum += box;
      if (box >= BOXES) entry.mastered += 1;
      famAcc.set(fam, entry);
    }
  }

  const startedCards = boxCounts.reduce((a, b) => a + b, 0);
  const masteredCards = boxCounts[BOXES - 1];

  const familyBreakdown: FamilyMastery[] = FAMILIES_ORDER
    .filter((fam) => famAcc.has(fam))
    .map((fam) => {
      const e = famAcc.get(fam)!;
      return {
        family: fam,
        label: FAMILY_LABEL[fam],
        started: e.started,
        mastered: e.mastered,
        avgBox: e.started ? e.boxSum / e.started : 0,
      };
    });

  return {
    totalMinutes: Math.round(totalMinutes),
    weekMinutes: Math.round(weekMinutes),
    prevWeekMinutes: Math.round(prevWeekMinutes),
    totalSessions,
    activeDays84,
    currentStreak,
    bestStreak,
    totalAttempts: attempts.length,
    measuredAttempts: measured.length,
    cleanRate,
    recentCleanRate,
    recentAttemptsCount: recent.length,
    boxCounts,
    startedCards,
    masteredCards,
    dueCards,
    familyBreakdown,
    heatmap,
    weeklySeries,
    profile,
  };
}

/**
 * Run the real session planner (read-only!) to show the learner *why* the app is scheduling
 * their next session the way it is: active focus arc, weakness triggers, pacing throttle, and blocks.
 */
export function explainScheduling({
  sheet,
  deck,
  store,
  profile,
  day,
  arc = loadArc(),
}: {
  sheet: LeadSheet;
  deck: Deck;
  store: Store;
  profile: SkillProfile;
  day: string;
  arc?: Arc | null;
}): SchedulerExplanation {
  const goal = loadActiveGoal(sheet, deck);
  const plan = planBlocks(deck, store, day, {
    minutes: 25,
    tuneId: sheet.id,
    profile,
    arc,
    goal,
  });

  const byId = new Map(deck.cards.map((c) => [c.id, c]));

  // Determine pacing zone from the exact same recent-16 rule in newCards()
  const usualNewCards = store.settings.newPerSession;
  const newCardsPerSession = newCards(store);
  const recent = chronologicalAttempts(store.history ?? [])
    .filter((a) => a.result !== "skip")
    .slice(-ZONE_ATTEMPTS);
  const recentCleanPct = recent.length >= ZONE_ATTEMPTS / 2
    ? Math.round((recent.filter((a) => a.result === "clean").length / recent.length) * 100)
    : null;

  let pacingZone: SchedulerExplanation["pacingZone"] = "baseline";
  let pacingLabel = "Learning your pace";
  let pacingReason = `Introduces up to ${usualNewCards} new exercises per session while collecting your first ${ZONE_ATTEMPTS / 2} graded attempts.`;

  if (recentCleanPct !== null) {
    if (recentCleanPct < 55) {
      pacingZone = "consolidating";
      pacingLabel = "Consolidating";
      pacingReason = `${recentCleanPct}% clean over your last ${recent.length} attempts (under 55%). Easing new material down to ${newCardsPerSession} exercise per session so current passages settle cleanly.`;
    } else if (recentCleanPct < 70) {
      pacingZone = "consolidating";
      pacingLabel = "Building footing";
      pacingReason = `${recentCleanPct}% clean over your last ${recent.length} attempts (55–70%). Trimming new material to ${newCardsPerSession} exercises per session while reinforcing current work.`;
    } else if (recentCleanPct > 85) {
      pacingZone = "cruising";
      pacingLabel = "Cruising";
      pacingReason = `${recentCleanPct}% clean over your last ${recent.length} attempts (over 85%). Expanding new material to ${newCardsPerSession} cards per session.`;
    } else {
      pacingZone = "steady";
      pacingLabel = "In the sweet spot";
      pacingReason = `${recentCleanPct}% clean over your last ${recent.length} attempts (70–85% target zone). Keeping steady at ${newCardsPerSession} new cards per session.`;
    }
  }

  // Classify focus reason
  let focusKind: SchedulerExplanation["focusKind"] = "balanced";
  let focusHeadline = "Balanced Leitner review";
  let focusReason = "No recurring technical bottleneck is flagged right now — sessions prioritize your lowest-box due reviews and steady new cards.";
  let arcDay: number | null = null;

  const activeArc = plan.arc;
  const activeWeakness: Weakness | undefined = activeArc
    ? profile.weaknesses.find((w) => w.cls === activeArc.cls)
    : undefined;

  if (plan.why) {
    if (activeWeakness && activeArc && plan.why === activeWeakness.fact) {
      focusKind = "weakness-arc";
      const copy = WEAKNESS_COPY[activeArc.cls];
      arcDay = Math.min(ARC_MAX_DAYS, Math.max(1, daysBetween(activeArc.start, day) + 1));
      focusHeadline = `${copy.title} (${activeWeakness.fact})`;
      focusReason = `Held as a ${ARC_MAX_DAYS}-day focus arc (day ${arcDay} of ${ARC_MAX_DAYS}). Stays pinned until the miss rate shrinks by half or the arc rests.`;
    } else if (plan.why.startsWith("Run-through")) {
      focusKind = "run-bars";
      focusHeadline = plan.why;
      focusReason = "Your latest run-through stumbled on these bars, so the planner isolates the smallest phrases covering them before expanding back to the full tune.";
    } else if (goal && plan.why.includes("·") && plan.blocks.some((b) => b.role === "focus")) {
      focusKind = "goal";
      focusHeadline = plan.why;
      focusReason = "Prioritizing unfinished tasks needed to demonstrate your active musical goal at target tempo.";
    } else if (plan.why.includes("days")) {
      focusKind = "neglected";
      focusHeadline = plan.why;
      focusReason = "This skill hasn't been exercised for over a week, so the planner weaves a short refresh block before it goes cold.";
    } else {
      focusHeadline = plan.why;
      focusReason = "Selected by the planner based on recent evidence and due reviews.";
    }
  }

  const blocks: PlannedBlockPreview[] = plan.blocks.map((block) => ({
    role: block.role,
    label: ROLE_LABEL[block.role],
    minutes: Math.max(1, block.minutes),
    cards: block.cards.map((id) => {
      const card = byId.get(id);
      return {
        id,
        title: card?.title ?? id,
        family: card?.family ?? familyOf(id),
        box: store.cards[id]?.box ?? 0,
      };
    }),
  }));

  const diagnoses: WeaknessDiagnosis[] = profile.weaknesses.slice(0, 4).map((w) => {
    const copy = WEAKNESS_COPY[w.cls] ?? { title: w.fact, explanation: "Recurring friction detected across recent scored attempts." };
    // Resolve the worst offending card to either the current tune's deck or its owning tune
    let drillCardId: string | null = null;
    let drillTuneId: string | null = null;
    let drillLabel: string | null = null;
    for (const rawId of w.cards) {
      const loc = localId(rawId);
      const t = tuneOf(rawId);
      if (!t || t === sheet.id) {
        const card = byId.get(loc);
        if (card) {
          drillCardId = card.id;
          drillTuneId = sheet.id;
          drillLabel = card.title;
          break;
        }
      } else if (!drillTuneId) {
        drillCardId = loc;
        drillTuneId = t;
        drillLabel = loc;
      }
    }
    return {
      cls: w.cls,
      title: copy.title,
      fact: w.fact,
      explanation: copy.explanation,
      strength: w.strength,
      samples: w.n,
      isActiveArc: Boolean(activeArc && activeArc.cls === w.cls),
      drillCardId,
      drillTuneId,
      drillLabel,
    };
  });

  return {
    focusKind,
    focusHeadline,
    focusReason,
    arcDay,
    arcMaxDays: ARC_MAX_DAYS,
    pacingZone,
    pacingLabel,
    pacingReason,
    newCardsPerSession,
    usualNewCards,
    recentCleanPct,
    sideStudyReason: plan.sideWhy ?? null,
    blocks,
    totalMinutes: plan.minutes,
    diagnoses,
  };
}

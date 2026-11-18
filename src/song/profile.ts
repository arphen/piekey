import { pitchClassToName } from "../musicTheory";
import type { Tally } from "./evidence";
import { glue, isShared } from "./ids";
import { addDays, chronologicalAttempts, type Attempt, type Store } from "./leitner";
import { familyOf } from "./stats";

// The player, read off every box: how each kind of skill is going (axes), which mistakes keep
// coming back across exercises (weaknesses), and how fast each exercise goes clean (ceilings).
// Derived on demand from the attempts' evidence; nothing extra is stored.

export type Axis = "pitch" | "time" | "tempo" | "chords" | "reading" | "ear";
export type MistakeClass = "accidental" | "leaps" | "crossing" | "shifts" | "rushing" | "dragging" | "unsteady" | "ear";

export interface AxisLevel {
  level: number; // 0..1, recent results weigh most
  trend: number | null; // the last four weeks against the four before
  n: number; // attempts behind it
  last: string | null; // day it was last worked on
}

export interface Weakness {
  cls: MistakeClass;
  strength: number; // 0..1
  n: number; // notes (or attempts) behind it
  cards: string[]; // where it shows most, worst first
  fact: string; // one line, a fact: "Leaps · 41 % missed"
}

export interface Ceiling {
  clean: number | null; // fastest clean tempo
  fail: number | null; // slowest tempo it fell apart at, above the clean one
}

export interface SkillProfile {
  axes: Record<Axis, AxisLevel>;
  weaknesses: Weakness[]; // strongest first
  ceilings: Record<string, Ceiling>;
}

export const AXES: Axis[] = ["pitch", "time", "tempo", "chords", "reading", "ear"];

const HALF_LIFE_DAYS = 14;
const WINDOW_DAYS = 60; // evidence older than this no longer names a weakness
const MIN_NOTES = 20; // notes behind a shape class before it is named
const MIN_TIMED = 30; // timed notes before time is judged
const MIN_WRONG = 4; // the same slip this often
const SPREAD_MS = 50; // the notes this scattered around it

/** Every attempt in every box, with ids that tell the tunes apart. */
export function allAttempts(stores: { tuneId: string; store: Store }[]): Attempt[] {
  return chronologicalAttempts(stores.flatMap(({ tuneId, store }) => (store.history ?? []).filter((a) => a.result !== "skip").map((a) => (isShared(a.id) ? a : { ...a, id: glue(tuneId, a.id) }))));
}

/** The skills an attempt says something about. */
export function axesOf(a: Attempt): Axis[] {
  if (a.conditions?.source === "self") return [];
  const out: Axis[] = [];
  switch (familyOf(a.id)) {
    case "scales":
      out.push("pitch", "tempo");
      break;
    case "harmony":
      out.push("pitch", "chords");
      break;
    case "melody":
      out.push("pitch");
      break;
    case "chords":
      out.push("chords");
      break;
    case "reading":
      out.push("reading", "pitch");
      break;
    case "ear":
      out.push("ear");
      break;
    case "fretboard":
      out.push("pitch");
      break;
  }
  if (a.ev?.time) out.push("time");
  return out;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function levelOf(list: { day: string; score: number }[], day: string): number | null {
  let num = 0;
  let den = 0;
  for (const x of list) {
    const w = Math.pow(0.5, Math.max(0, daysBetween(x.day, day)) / HALF_LIFE_DAYS);
    num += w * x.score;
    den += w;
  }
  return den ? num / den : null;
}

/** Historical timing evidence can establish scatter, but its mean cannot prove the cause of alignment. */
function timeScore(a: Attempt): number {
  const t = a.ev?.time;
  if (!t) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, t.spread - 25) / 75));
}

/** Outcomes govern review scheduling; the profile reports measured playing instead. */
function scoreOf(axis: Axis, a: Attempt): number | null {
  if (a.result === "skip") return null;
  if (axis === "time") return a.ev?.time ? timeScore(a) : null;
  if (axis === "tempo") {
    if (a.result !== "clean" || !a.goalBpm || !Number.isFinite(a.goalBpm) || a.goalBpm <= 0 || !Number.isFinite(a.bpm) || a.bpm <= 0) return null;
    return Math.min(1, a.bpm / a.goalBpm);
  }
  const notes = a.ev?.notes;
  if (notes && notes[0] > 0) return Math.max(0, Math.min(1, 1 - notes[1] / notes[0]));
  return a.share !== null && Number.isFinite(a.share) ? Math.max(0, Math.min(1, a.share)) : null;
}

/** Keep the old calibration argument/API; play-along calibration does not isolate hardware latency. */
export function buildProfile(attempts: Attempt[], day: string, _measured = true): SkillProfile {
  attempts = attempts.filter((attempt) => attempt.conditions?.source !== "self");
  const axes = {} as Record<Axis, AxisLevel>;
  for (const axis of AXES) {
    const scored = attempts.filter((a) => axesOf(a).includes(axis)).flatMap((a) => {
      const score = scoreOf(axis, a);
      return score === null ? [] : [{ day: a.day, score }];
    });
    const recent = scored.filter((x) => daysBetween(x.day, day) < 28);
    const before = scored.filter((x) => daysBetween(x.day, day) >= 28 && daysBetween(x.day, day) < 56);
    const now = levelOf(recent, day);
    const then = levelOf(before, addDays(day, -28));
    axes[axis] = {
      level: levelOf(scored, day) ?? 0,
      trend: now !== null && then !== null && recent.length >= 3 && before.length >= 3 ? now - then : null,
      n: scored.length,
      last: scored.reduce<string | null>((m, a) => (m === null || a.day > m ? a.day : m), null),
    };
  }
  const fresh = attempts.filter((a) => daysBetween(a.day, day) < WINDOW_DAYS);
  return { axes, weaknesses: weaknessesOf(fresh, axes), ceilings: ceilingsOf(attempts) };
}

const sum = (list: Tally[]): Tally => list.reduce<Tally>((t, x) => [t[0] + x[0], t[1] + x[1]], [0, 0]);
const rate = (t: Tally) => (t[0] ? t[1] / t[0] : 0);
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Cards ordered by how badly they show a tally, worst first. */
function worst(attempts: Attempt[], pick: (a: Attempt) => Tally | undefined): string[] {
  const by = new Map<string, Tally>();
  for (const a of attempts) {
    const t = pick(a);
    if (!t || !t[0]) continue;
    by.set(a.id, sum([by.get(a.id) ?? [0, 0], t]));
  }
  return [...by].filter(([, t]) => t[1] > 0).sort((x, y) => rate(y[1]) - rate(x[1]) || y[1][1] - x[1][1]).slice(0, 6).map(([id]) => id);
}

function weaknessesOf(attempts: Attempt[], axes: Record<Axis, AxisLevel>): Weakness[] {
  const ev = attempts.filter((a) => a.ev);
  const out: Weakness[] = [];
  const base = rate(sum(ev.map((a) => a.ev!.notes)));

  // a shape of line that goes wrong much more than lines in general
  const shape = (cls: MistakeClass, label: string, pick: (a: Attempt) => Tally) => {
    const t = sum(ev.map(pick));
    if (t[0] < MIN_NOTES) return;
    const r = rate(t);
    if (r < base * 1.5 || r - base < 0.08) return;
    out.push({ cls, strength: Math.min(1, (r - base) / Math.max(0.2, 1 - base)), n: t[0], cards: worst(ev, pick), fact: `${label} · ${pct(r)} missed` });
  };
  shape("leaps", "Leaps", (a) => a.ev!.leap);
  shape("crossing", "String crossings", (a) => a.ev!.cross);
  shape("shifts", "Position shifts", (a) => a.ev!.shift);

  // the same note a semitone off, again and again
  const slips = new Map<string, { n: number; ids: Set<string> }>();
  for (const a of ev)
    for (const [w, h] of a.ev!.wrong) {
      if (Math.abs(w - h) !== 1) continue;
      const k = `${w % 12}>${h % 12}`;
      const s = slips.get(k) ?? { n: 0, ids: new Set<string>() };
      s.n++;
      s.ids.add(a.id);
      slips.set(k, s);
    }
  const top = [...slips].sort((x, y) => y[1].n - x[1].n)[0];
  if (top && top[1].n >= MIN_WRONG) {
    const [w, h] = top[0].split(">").map(Number);
    out.push({ cls: "accidental", strength: Math.min(1, top[1].n / 12), n: top[1].n, cards: [...top[1].ids].slice(0, 6), fact: `${pitchClassToName(w)} → ${pitchClassToName(h)} · ${top[1].n}×` });
  }

  // Pool within-performance scatter. Raw means remain evidence, not a diagnosis of rushing/dragging.
  const timed = ev.filter((a) => a.ev!.time);
  const n = timed.reduce((x, a) => x + a.ev!.time!.n, 0);
  if (n >= MIN_TIMED) {
    const spread = Math.sqrt(timed.reduce((x, a) => x + a.ev!.time!.spread ** 2 * a.ev!.time!.n, 0) / n);
    if (spread >= SPREAD_MS) out.push({ cls: "unsteady", strength: Math.min(1, (spread - 30) / 70), n, cards: [...timed].sort((x, y) => y.ev!.time!.spread - x.ev!.time!.spread).slice(0, 6).map((a) => a.id), fact: `Spread ${Math.round(spread)} ms` });
  }

  // hearing it lags well behind playing it from the page
  const ear = axes.ear;
  if (ear.n >= 5 && axes.pitch.n >= 5 && axes.pitch.level - ear.level >= 0.25) {
    const ids = attempts.filter((a) => familyOf(a.id) === "ear" && a.result === "fail").map((a) => a.id);
    out.push({ cls: "ear", strength: Math.min(1, axes.pitch.level - ear.level), n: ear.n, cards: [...new Set(ids)].slice(0, 6), fact: `By ear · ${pct(ear.level)}` });
  }

  return out.sort((a, b) => b.strength - a.strength);
}

function ceilingsOf(attempts: Attempt[]): Record<string, Ceiling> {
  const out: Record<string, Ceiling> = {};
  for (const a of attempts) {
    const c = (out[a.id] ??= { clean: null, fail: null });
    if (a.result === "clean") c.clean = Math.max(c.clean ?? 0, a.bpm);
  }
  for (const a of attempts) {
    const c = out[a.id];
    if (a.result === "fail" && (c.clean === null || a.bpm > c.clean)) c.fail = c.fail === null ? a.bpm : Math.min(c.fail, a.bpm);
  }
  return out;
}

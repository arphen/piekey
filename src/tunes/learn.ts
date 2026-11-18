import { mod } from "../musicTheory";
import type { LeadSheet } from "./musicxml";
import type { Timeline } from "./order";

// A plan for learning a tune a little at a time, the way it sticks:
//   new chunk (about 2 bars): listen → read it slowly → play it in time
//   join: the new chunk with the one before, so the seams hold
//   section: the whole section in time, then from memory (notes hidden, chords showing)
//   a chunk that repeats earlier music is a quick review; the whole tune closes the plan.

export type StepKind = "new" | "review" | "join" | "section" | "memory" | "tune";

export interface Step {
  kind: StepKind;
  from: number; // slots in playing order, inclusive
  to: number;
  section: string;
  title: string;
  detail: string;
  listen: boolean; // play it once first, for the ear
  read: boolean; // a read-it-slowly phase before playing in time
  pass: number; // share of notes in time to pass, 0..1
}

const CHUNK_BARS = 2;
const PASS: Record<StepKind, number> = { new: 0.9, review: 0.9, join: 0.85, section: 0.85, memory: 0.8, tune: 0.85 };

export function buildPlan(sheet: LeadSheet, tl: Timeline): Step[] {
  const label = (bar: number) => sheet.barNumbers[bar] ?? String(bar + 1);
  const span = (from: number, to: number) => {
    const a = label(tl.slots[from].bar);
    const b = label(tl.slots[to].bar);
    return a === b ? `bar ${a}` : `bars ${a}–${b}`;
  };
  const sectionOf = (bar: number) => {
    for (let b = bar; b >= 0; b--) if (sheet.bars[b].section) return sheet.bars[b].section!;
    return sheet.bars.find((b) => b.section)?.section ?? "The tune";
  };

  // chunks: consecutive slots of bars not met before, cut every 2 bars and at section marks
  const chunks: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  let cur: number[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ from: cur[0], to: cur[cur.length - 1] });
    cur = [];
  };
  tl.slots.forEach((slot, si) => {
    if (seen.has(slot.bar)) return flush();
    const last = cur[cur.length - 1];
    if (cur.length && (cur.length >= CHUNK_BARS || sheet.bars[slot.bar].section || last !== si - 1)) flush();
    cur.push(si);
    seen.add(slot.bar);
  });
  flush();
  // a lone bar joins its neighbour when they're played back to back (a pickup bar, an odd bar out)
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.to !== c.from) continue;
    const next = chunks[i + 1];
    const prev = chunks[i - 1];
    const intoSection = next && sheet.bars[tl.slots[next.from].bar].section;
    const pickup = !sheet.bars.slice(0, tl.slots[c.from].bar + 1).some((b) => b.section);
    if (next && next.from === c.to + 1 && next.to - next.from < 2 && (!intoSection || pickup)) {
      next.from = c.from;
      chunks.splice(i--, 1);
    } else if (prev && prev.to === c.from - 1 && prev.to - prev.from < 2) {
      prev.to = c.to;
      chunks.splice(i--, 1);
    }
  }

  const signature = (c: { from: number; to: number }) => {
    const parts: string[] = [];
    for (let s = c.from; s <= c.to; s++)
      parts.push(sheet.bars[tl.slots[s].bar].notes.map((n) => (n.rest ? `r${n.durationBeats}` : `${n.midi}:${n.durationBeats}`)).join(","));
    return parts.join("|");
  };

  const steps: Step[] = [];
  const learned = new Map<string, string>(); // signature → where it was learned
  let i = 0;
  while (i < chunks.length) {
    const section = sectionOf(tl.slots[chunks[i].from].bar);
    const group: typeof chunks = [];
    while (i < chunks.length && sectionOf(tl.slots[chunks[i].from].bar) === section) group.push(chunks[i++]);
    let prevNew: (typeof chunks)[number] | null = null;
    let anyNew = false;
    for (const c of group) {
      const sig = signature(c);
      const same = learned.get(sig);
      if (same) {
        steps.push({ kind: "review", ...c, section, title: `Review ${span(c.from, c.to)}`, detail: `Same notes as ${same}.`, listen: true, read: false, pass: PASS.review });
        prevNew = null;
        continue;
      }
      learned.set(sig, span(c.from, c.to));
      anyNew = true;
      steps.push({ kind: "new", ...c, section, title: `Learn ${span(c.from, c.to)}`, detail: "New: heard once, read at your own pace, then in time.", listen: true, read: true, pass: PASS.new });
      if (prevNew && prevNew.to + 1 === c.from)
        steps.push({ kind: "join", from: prevNew.from, to: c.to, section, title: `Join ${span(prevNew.from, c.to)}`, detail: "The last two chunks back to back, so the seam holds.", listen: false, read: false, pass: PASS.join });
      prevNew = c;
    }
    const from = Math.min(...group.map((c) => c.from));
    const to = Math.max(...group.map((c) => c.to));
    if (group.length > 1 || anyNew) {
      steps.push({ kind: "section", from, to, section, title: `${section} in time`, detail: `The whole of ${section}, repeats and endings included.`, listen: true, read: false, pass: PASS.section });
      if (anyNew)
        steps.push({ kind: "memory", from, to, section, title: `${section} from memory`, detail: "Notes hidden, chords showing. Each note appears once you've played it.", listen: false, read: false, pass: PASS.memory });
    }
  }
  if (tl.slots.length)
    steps.push({ kind: "tune", from: 0, to: tl.slots.length - 1, section: "", title: "The whole tune", detail: "Top to bottom with the backing.", listen: false, read: false, pass: PASS.tune });
  return steps;
}

// ---------- the melody over the chords ----------

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parseChord(symbol: string): { root: number; minor: boolean; dim: boolean; aug: boolean; six: boolean } | null {
  const m = /^([A-G])([b#♭♯]?)(.*)$/.exec(symbol);
  if (!m) return null;
  const root = mod(LETTER_PC[m[1]] + (m[2] === "b" || m[2] === "♭" ? -1 : m[2] ? 1 : 0));
  const q = m[3].split("/")[0];
  return {
    root,
    minor: /^(m(?!aj)|-|min)/.test(q),
    dim: /dim|°|m7b5|ø/.test(q),
    aug: /\+|aug|#5/.test(q),
    six: /6|dim7/.test(q),
  };
}

function degree(interval: number, c: NonNullable<ReturnType<typeof parseChord>>): string {
  switch (interval) {
    case 0:
      return "R";
    case 1:
      return "♭9";
    case 2:
      return "9";
    case 3:
      return c.minor || c.dim ? "♭3" : "♯9";
    case 4:
      return "3";
    case 5:
      return "11";
    case 6:
      return c.dim ? "♭5" : "♯11";
    case 7:
      return "5";
    case 8:
      return c.aug ? "♯5" : "♭13";
    case 9:
      return c.six ? "6" : "13";
    case 10:
      return "♭7";
    default:
      return "7";
  }
}

/** For each printed note: the chord sounding under it and the note's degree over that chord. */
export function melodyOverChords(sheet: LeadSheet): { chord: (string | null)[]; degree: (string | null)[] } {
  const chord: (string | null)[] = [];
  const deg: (string | null)[] = [];
  let current: string | null = null;
  for (const bar of sheet.bars) {
    const start = bar.notes[0]?.startBeat ?? 0;
    for (const n of bar.notes) {
      const beat = n.startBeat - start;
      bar.chordSymbols.forEach((sym, ci) => {
        if ((bar.chordBeats?.[ci] ?? 0) <= beat + 1e-6) current = sym;
      });
      if (n.rest) continue;
      const parsed = current ? parseChord(current) : null;
      chord.push(current);
      deg.push(parsed ? degree(mod(n.midi - parsed.root), parsed) : null);
    }
    // the bar's last chord carries into the next bar
    if (bar.chordSymbols.length) current = bar.chordSymbols[bar.chordSymbols.length - 1];
  }
  return { chord, degree: deg };
}

/** "Dm: A (5) · Dm(maj7): C♯ (7)": the first melody note under each chord of a step. */
export function chordLandings(sheet: LeadSheet, tl: Timeline, step: Pick<Step, "from" | "to">, over: ReturnType<typeof melodyOverChords>) {
  const written: string[] = [];
  for (const bar of sheet.bars)
    for (const n of bar.notes) if (!n.rest) written.push(n.vexKey[0].toUpperCase() + n.vexKey.slice(1, n.vexKey.indexOf("/")).replace("#", "♯").replace(/b/g, "♭"));
  const out: { chord: string; note: string; degree: string }[] = [];
  let last = "";
  for (const t of tl.targets) {
    if (t.slot < step.from || t.slot > step.to) continue;
    const k = t.notes[0];
    const chord = over.chord[k];
    if (!chord || chord === last) continue;
    last = chord;
    out.push({ chord, note: written[k], degree: over.degree[k] ?? "" });
    if (out.length >= 8) break;
  }
  return out;
}

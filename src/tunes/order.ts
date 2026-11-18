import type { JumpKind, NoteResult, ReadingBar } from "../core/contract";
import type { LeadSheet } from "./musicxml";

// The playing order of a lead sheet: repeats taken, the right ending each time through,
// D.C. / D.S. jumps with To Coda and Fine. After a jump, repeats are played through once and
// the last ending is taken, as usual.

export interface Slot {
  bar: number; // printed bar
  pass: number; // time through the current repeat, from 1
  start: number; // beats from the top
  beats: number;
  run: number; // slots in a row that follow the printed order share a run
}

/** One note to play: a tied chain counts once. `notes` index the sheet's non-rest notes. */
export interface Target {
  midi: number; // sounding
  notes: number[];
  bar: number;
  slot: number;
  t: number; // beats from the top
  dur: number;
  // a chord to play instead of a single note (practice exercises): scored by the pitch classes heard
  chord?: { required: number[]; clash: number[]; voicing: number[]; strike?: boolean }; // strike: it must be struck again here, not left ringing
  any?: number[]; // improvising: any of these pitch classes lands here (midi is only where it is shown)
}

/** A note heard but not scored: the melody under a chord exercise, or a bass line. */
export interface Voice {
  t: number;
  dur: number;
  midi: number;
}

export interface Timeline {
  slots: Slot[];
  targets: Target[];
  comp: { t: number; dur: number; midis: number[] }[];
  total: number; // beats
  bass?: Voice[];
  guide?: Voice[];
}

const has = (b: ReadingBar | undefined, kind: JumpKind) => Boolean(b?.jumps?.some((j) => j.kind === kind));
const barBeats = (b: ReadingBar) => b.beats ?? b.notes.reduce((a, n) => a + n.durationBeats, 0);

export function playOrder(bars: ReadingBar[]): { bar: number; pass: number }[] {
  const n = bars.length;
  const segno = bars.findIndex((b) => has(b, "segno"));
  const toCoda = bars.findIndex((b) => has(b, "toCoda"));
  const coda = bars.findIndex((b, i) => has(b, "coda") && i > toCoda);
  const voltaEnd = (i: number) => {
    let j = i;
    while (j + 1 < n && bars[j + 1].volta && !bars[j + 1].volta!.begin && !bars[j].volta!.end) j++;
    return j;
  };
  // The endings that follow one another after a repeat, from the one starting at `i`.
  const group = (i: number) => {
    let first = i;
    while (first > 0 && bars[first - 1].volta) first--;
    const out: { begin: number; end: number; numbers: number[] }[] = [];
    for (let j = first; j < n && bars[j].volta; j = voltaEnd(j) + 1) out.push({ begin: j, end: voltaEnd(j), numbers: bars[j].volta!.numbers });
    return out;
  };

  const out: { bar: number; pass: number }[] = [];
  const jumpsTaken = new Set<number>();
  let i = 0;
  let pass = 1;
  let from = 0;
  let back = false;
  let jumped = false;
  while (i < n && out.length < 4000) {
    const b = bars[i];
    if (b.repeatStart && !back) {
      from = i;
      pass = 1;
    }
    back = false;

    if (b.volta?.begin) {
      const endings = group(i);
      const last = endings[endings.length - 1];
      const chosen = jumped ? last : endings.find((e) => e.numbers.includes(pass)) ?? last;
      if (chosen.begin !== i) {
        // ahead: skip to it; behind (an ending without a repeat sign): carry on after the endings
        i = chosen.begin > i ? chosen.begin : last.end + 1;
        continue;
      }
    }

    out.push({ bar: i, pass });

    if (jumped && has(b, "fine")) break;
    if (jumped && has(b, "toCoda") && coda > i) {
      i = coda;
      continue;
    }
    if (b.repeatEnd && !jumped) {
      if (pass < b.repeatEnd) {
        pass++;
        i = from;
        back = true;
        continue;
      }
      from = i + 1;
      pass = 1;
    }
    // past the last ending: the next repeat starts fresh
    if (b.volta?.end && !bars[i + 1]?.volta) {
      from = i + 1;
      pass = 1;
    }
    if (!jumpsTaken.has(i) && (has(b, "ds") || has(b, "dc"))) {
      jumpsTaken.add(i);
      jumped = true;
      i = has(b, "ds") && segno >= 0 ? segno : 0;
      from = i;
      pass = 1;
      continue;
    }
    i++;
  }
  return out;
}

export function buildTimeline(sheet: Pick<LeadSheet, "bars" | "comp">): Timeline {
  const order = playOrder(sheet.bars);
  const noteIdx: number[][] = [];
  let k = 0;
  for (const bar of sheet.bars) noteIdx.push(bar.notes.map((n) => (n.rest ? -1 : k++)));

  const slots: Slot[] = [];
  let t = 0;
  let run = 0;
  order.forEach((o, si) => {
    if (si > 0 && o.bar !== order[si - 1].bar + 1) run++;
    const beats = barBeats(sheet.bars[o.bar]);
    slots.push({ bar: o.bar, pass: o.pass, start: t, beats, run });
    t += beats;
  });

  const targets: Target[] = [];
  let tied = false;
  slots.forEach((slot, si) => {
    const bar = sheet.bars[slot.bar];
    const barStart = bar.notes[0]?.startBeat ?? 0;
    bar.notes.forEach((n, ni) => {
      if (n.rest) {
        tied = false;
        return;
      }
      const at = slot.start + n.startBeat - barStart;
      const prev = targets[targets.length - 1];
      if (tied && prev && prev.midi === n.midi && Math.abs(prev.t + prev.dur - at) < 1e-6) {
        prev.notes.push(noteIdx[slot.bar][ni]);
        prev.dur += n.durationBeats;
      } else targets.push({ midi: n.midi, notes: [noteIdx[slot.bar][ni]], bar: slot.bar, slot: si, t: at, dur: n.durationBeats });
      tied = Boolean(n.tieToNext);
    });
  });

  const byBar = new Map<number, LeadSheet["comp"]>();
  for (const c of sheet.comp ?? []) byBar.set(c.bar, [...(byBar.get(c.bar) ?? []), c]);
  const comp = slots.flatMap((slot) => (byBar.get(slot.bar) ?? []).map((c) => ({ t: slot.start + c.beat, dur: c.dur, midis: c.midis })));

  return { slots, targets, comp, total: t };
}

/** Next time bar `bar` comes up at or after slot `from`, else its first time. */
export function slotOfBar(tl: Timeline, bar: number, from = 0): number {
  const ahead = tl.slots.findIndex((s, i) => i >= from && s.bar === bar);
  return ahead >= 0 ? ahead : tl.slots.findIndex((s) => s.bar === bar);
}

export const firstTargetAt = (tl: Timeline, slot: number) => {
  const i = tl.targets.findIndex((t) => t.slot >= slot);
  return i < 0 ? tl.targets.length : i;
};

/**
 * Colours for the printed notes, from results in playing order. Each note shows its latest
 * result; going round a repeat, the notes still ahead in this pass start out clear.
 */
export function printedResults(tl: Timeline, results: NoteResult[], cursor: number): NoteResult[] {
  const out: NoteResult[] = [];
  const at = tl.targets[Math.min(cursor, tl.targets.length - 1)];
  const run = at ? tl.slots[at.slot].run : -1;
  const runFirst = tl.targets.findIndex((t) => tl.slots[t.slot].run === run);
  const ahead = new Set<number>();
  for (let i = cursor; i < tl.targets.length && tl.slots[tl.targets[i].slot].run === run; i++) tl.targets[i].notes.forEach((k) => ahead.add(k));
  tl.targets.forEach((t, i) => {
    const r = results[i];
    if (r === null || r === undefined) return;
    for (const k of t.notes) if (!(ahead.has(k) && i < runFirst)) out[k] = r;
  });
  return out;
}

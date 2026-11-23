import type { ReadingBar } from "../core/contract";
import type { LeadSheet } from "./musicxml";
import type { Timeline } from "./order";

// The tune as it is played rather than as it is printed: repeats, endings and jumps unrolled into
// one forward stream of bars, so the eyes never have to jump back. Every bar keeps its printed
// number and the time through it belongs to. Sections label the form: the file's rehearsal marks
// when it has them, otherwise parts found in the music itself (repeated material shares a letter).

export interface FlowBar {
  slot: number; // timeline slot
  bar: number; // printed bar
  number: string; // as printed
  pass: number; // time through its repeat, from 1
  start: number; // beats from the top of the timeline
  beats: number;
  run: number; // bars played in printed order share a run; a new run follows a jump
}

export interface FlowSection {
  from: number; // flow bars, inclusive
  to: number;
  label: string; // "A", "B", "Turnaround", "A′"
  pass: number; // the time this label comes round, from 1
  start: number; // timeline beats
  beats: number;
  printed: boolean; // named in the file, not found in the music
}

export interface Flow {
  exercise: { bars: ReadingBar[]; keySignature: string; timeSignature: string | undefined };
  bars: FlowBar[];
  sections: FlowSection[];
  notesOf: number[][]; // per target from `first`: its flow notes
  noteTarget: number[]; // flow note → target index (-1 when outside the range)
  printed: number[]; // flow note → printed note index
  first: number;
  start: number; // timeline beats
  end: number;
}

type Sheet = Pick<LeadSheet, "bars" | "barNumbers" | "keySignature" | "timeSignature">;

const PHRASE = 8; // bars in a found phrase
const LONG = 12; // a stretch longer than this is cut into phrases
const RUN = 4; // bars in a row that must come back for a repeat to mark the form
const BAR_ALIKE = 0.5; // two bars this alike count as the same music coming back
const SAME = 0.85; // phrases this alike are the same part
const LIKE = 0.45; // and this alike, a variation of it

interface Heard {
  notes: Set<string>; // "onset:pitch": rhythm and notes, not how they are spelled or tied
  harmony: string | null; // chord roots and qualities, extensions left out: Am7 and Am are one harmony
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function harmonyOf(symbols: string[]): string | null {
  const parts = symbols.flatMap((sym) => {
    const m = /^([A-G])([b#♭♯]?)(.*)$/.exec(sym.trim());
    if (!m) return [];
    const root = (LETTER[m[1]] + (m[2] === "b" || m[2] === "♭" ? 11 : m[2] ? 1 : 0)) % 12;
    const q = m[3].split("/")[0];
    return [`${root}${/dim|°|ø|m7b5/.test(q) ? "o" : /^(m(?!aj)|-|min)/.test(q) ? "m" : ""}`];
  });
  return parts.length ? parts.join("|") : null;
}
function heardIn(b: ReadingBar): Heard {
  const base = b.notes[0]?.startBeat ?? 0;
  return { notes: new Set(b.notes.filter((n) => !n.rest).map((n) => `${Math.round((n.startBeat - base) * 48)}:${n.midi}`)), harmony: harmonyOf(b.chordSymbols) };
}
/**
 * How alike two bars are, 0–1. Over chords, the harmony weighs a little more than the line: the
 * same changes with another melody are still the same part of the form, as a variation.
 */
function likeness(a: Heard, b: Heard): number {
  let shared = 0;
  for (const t of a.notes) if (b.notes.has(t)) shared++;
  const line = !a.notes.size && !b.notes.size ? 1 : shared / (a.notes.size + b.notes.size - shared);
  if (a.harmony === null && b.harmony === null) return line;
  return 0.55 * (a.harmony === b.harmony ? 1 : 0) + 0.45 * line;
}
const silent = (b: ReadingBar) => b.notes.every((n) => n.rest);

/** Slots `from`–`to` of a timeline as one forward stream of bars, with targets `first`–`last` mapped onto it. */
export function flowOf(sheet: Sheet, tl: Timeline, from: number, to: number, first: number, last: number): Flow {
  const printedBase: number[] = [];
  const barOfNote: number[] = [];
  let k = 0;
  sheet.bars.forEach((b, i) => {
    printedBase.push(k);
    for (const n of b.notes) if (!n.rest) barOfNote[k++] = i;
  });
  const keyAt: string[] = [];
  const timeAt: (string | undefined)[] = [];
  let key = sheet.keySignature;
  let time: string | undefined = sheet.timeSignature;
  for (const b of sheet.bars) {
    key = b.keyChange ?? key;
    time = b.timeChange ?? time;
    keyAt.push(key);
    timeAt.push(time);
  }

  const bars: FlowBar[] = [];
  const out: ReadingBar[] = [];
  const flowIdx: Map<number, number>[] = [];
  const printed: number[] = [];
  let u = 0;
  for (let si = from; si <= to; si++) {
    const slot = tl.slots[si];
    const src = sheet.bars[slot.bar];
    const prev = bars[bars.length - 1];
    bars.push({ slot: si, bar: slot.bar, number: sheet.barNumbers[slot.bar] ?? String(slot.bar + 1), pass: slot.pass, start: slot.start, beats: slot.beats, run: slot.run });
    const ids = new Map<number, number>();
    let local = 0;
    for (const n of src.notes) {
      if (n.rest) continue;
      const pk = printedBase[slot.bar] + local++;
      ids.set(pk, u++);
      printed.push(pk);
    }
    flowIdx.push(ids);
    // the marks that send the eyes elsewhere are gone; what the bar says musically stays
    const { repeatStart: _rs, repeatEnd: _re, volta: _v, jumps: _j, section: _s, barline: _b, keyChange: _k, timeChange: _t, tempo, ...rest } = src;
    const bar: ReadingBar = { ...rest, notes: src.notes.map((n) => ({ ...n, tieToNext: false, slur: n.slur && prev && prev.run !== slot.run ? undefined : n.slur })) };
    if (prev && keyAt[slot.bar] !== keyAt[prev.bar]) bar.keyChange = keyAt[slot.bar];
    if (prev && timeAt[slot.bar] !== timeAt[prev.bar]) bar.timeChange = timeAt[slot.bar];
    if (tempo && (!prev || tempo !== sheet.bars[prev.bar].tempo)) bar.tempo = tempo;
    out.push(bar);
  }

  // targets onto flow notes: a tied chain may carry on into the next slot
  const noteTarget = printed.map(() => -1);
  const notesOf: number[][] = [];
  for (let i = first; i <= last; i++) {
    const t = tl.targets[i];
    const mine: number[] = [];
    let s = t.slot;
    for (const pk of t.notes) {
      while (s <= to && tl.slots[s].bar !== barOfNote[pk]) s++;
      const id = s <= to && s >= from ? flowIdx[s - from].get(pk) : undefined;
      if (id === undefined) break;
      mine.push(id);
      noteTarget[id] = i;
    }
    notesOf.push(mine);
  }
  // a tie is drawn only where the timeline holds one note on: never into the bar a repeat goes back to
  const noteAt: { bar: number; n: number }[] = [];
  out.forEach((b, bi) => b.notes.forEach((n, ni) => { if (!n.rest) noteAt.push({ bar: bi, n: ni }); }));
  for (let id = 0; id + 1 < noteAt.length; id++) {
    if (noteTarget[id] < 0 || noteTarget[id] !== noteTarget[id + 1]) continue;
    const at = noteAt[id];
    out[at.bar].notes[at.n] = { ...out[at.bar].notes[at.n], tieToNext: true };
  }

  const startSlot = tl.slots[from];
  const endSlot = tl.slots[to];
  return {
    exercise: { bars: out, keySignature: startSlot ? keyAt[startSlot.bar] : sheet.keySignature, timeSignature: startSlot ? timeAt[startSlot.bar] : sheet.timeSignature },
    bars,
    sections: sectionsOf(sheet, bars, keyAt, timeAt),
    notesOf,
    noteTarget,
    printed,
    first,
    start: startSlot?.start ?? 0,
    end: endSlot ? endSlot.start + endSlot.beats : 0,
  };
}

function sectionsOf(sheet: Sheet, bars: FlowBar[], keyAt: string[], timeAt: (string | undefined)[]): FlowSection[] {
  if (!bars.length) return [];
  const named = bars.some((b) => sheet.bars[b.bar].section);
  const cuts: { at: number; label: string | null }[] = [];
  if (named) {
    // the file's own marks; going back round a repeat starts the section it lands in again
    let current = "";
    bars.forEach((b, j) => {
      const mark = sheet.bars[b.bar].section;
      if (mark) current = mark;
      else if (!current) {
        for (let p = b.bar; p >= 0; p--) if (sheet.bars[p].section) { current = sheet.bars[p].section!; break; }
      }
      const jumpedBack = j > 0 && b.run !== bars[j - 1].run;
      if (j === 0 || mark || jumpedBack) cuts.push({ at: j, label: current || null });
    });
    // a pickup before the first mark belongs to it; a longer opening is an introduction
    if (cuts[0]?.label === null) {
      const pickup = cuts[1]?.at === 1 && bars.length > 1 && bars[0].beats < bars[1].beats - 1e-6;
      if (pickup) {
        cuts.shift();
        cuts[0].at = 0;
      } else cuts[0].label = "Intro";
    }
  } else {
    // no marks: cut where the form shows itself (a repeat, an ending, a double bar, a change of
    // key, meter or tempo), then long stretches into phrases
    const strong = [0];
    for (let j = 1; j < bars.length; j++) {
      const b = sheet.bars[bars[j].bar];
      const p = sheet.bars[bars[j - 1].bar];
      if (
        bars[j].run !== bars[j - 1].run ||
        b.repeatStart ||
        p.repeatEnd ||
        p.volta?.end ||
        p.barline ||
        (b.volta?.begin && !p.volta) ||
        keyAt[bars[j].bar] !== keyAt[bars[j - 1].bar] ||
        timeAt[bars[j].bar] !== timeAt[bars[j - 1].bar] ||
        (b.tempo !== undefined && b.tempo !== p.tempo)
      )
        strong.push(j);
    }
    const heard = bars.map((b) => heardIn(sheet.bars[b.bar]));
    const found = new Set(strong);
    // music that comes back marks the form: the longest returning stretches first, each cut where
    // it starts and ends; a vamp going round and round is one stretch
    const repeats: { i: number; j: number; len: number }[] = [];
    for (let lag = 1; lag < bars.length; lag++) {
      let run = 0;
      for (let i = 0; i + lag <= bars.length; i++) {
        if (i + lag < bars.length && heard[i].notes.size + heard[i + lag].notes.size > 0 && likeness(heard[i], heard[i + lag]) >= BAR_ALIKE) run++;
        else {
          if (run >= RUN) repeats.push({ i: i - run, j: i - run + lag, len: run });
          run = 0;
        }
      }
    }
    repeats.sort((x, y) => y.len - x.len || x.i - y.i);
    const used = new Uint8Array(bars.length);
    const free = (a: number, len: number) => !used.subarray(a, a + len).some(Boolean);
    for (const r of repeats) {
      const lag = r.j - r.i;
      if (lag < 2) continue;
      if (lag < r.len) {
        if (!free(r.i, r.j + r.len - r.i)) continue;
        found.add(r.i);
        found.add(r.j + r.len);
        used.fill(1, r.i, r.j + r.len);
        continue;
      }
      if (!free(r.i, r.len) && !free(r.j, r.len)) continue;
      [r.i, r.i + r.len, r.j, r.j + r.len].forEach((c) => found.add(c));
      used.fill(1, r.i, r.i + r.len);
      used.fill(1, r.j, r.j + r.len);
    }
    found.add(bars.length);
    const marks = [...found].filter((c) => c <= bars.length).sort((a, b) => a - b);
    // stretches nothing marks are cut into phrases; a scrap of a bar or two joins the part before it
    const isStrong = new Set(strong);
    const all: number[] = [];
    for (let m = 0; m + 1 < marks.length; m++) {
      let a = marks[m];
      const b = marks[m + 1];
      all.push(a);
      // a short first bar is a pickup into the phrase after it
      if (a === 0 && b - a > LONG && bars.length > 1 && bars[0].beats < bars[1].beats - 1e-6) a = 1;
      if (b - a <= LONG) continue;
      for (let c = a + PHRASE; b - c >= PHRASE / 2; c += PHRASE) all.push(c);
    }
    all.forEach((at, i) => {
      const len = (all[i + 1] ?? bars.length) - at;
      if (i > 0 && len < 3 && !isStrong.has(at)) return;
      cuts.push({ at, label: null });
    });
  }

  const spans = cuts.map((c, i) => ({ ...c, to: (cuts[i + 1]?.at ?? bars.length) - 1 })).filter((c) => c.to >= c.at);
  // found parts are lettered by what they play: the same music is the same letter, a variation of it primed
  if (!named) {
    const parts: { sig: Heard[]; letter: string; variants: number }[] = [];
    for (const span of spans) {
      const sig = bars.slice(span.at, span.to + 1).map((b) => heardIn(sheet.bars[b.bar]));
      if (bars.slice(span.at, span.to + 1).every((b) => silent(sheet.bars[b.bar]))) {
        span.label = "rest";
        continue;
      }
      let best: (typeof parts)[number] | null = null;
      let bestShare = 0;
      for (const part of parts) {
        const n = Math.max(part.sig.length, sig.length);
        let same = 0;
        for (let i = 0; i < Math.min(part.sig.length, sig.length); i++) same += likeness(part.sig[i], sig[i]);
        if (same / n > bestShare) {
          bestShare = same / n;
          best = part;
        }
      }
      if (best && bestShare >= SAME) span.label = best.letter;
      else if (best && bestShare >= LIKE) span.label = best.letter + "′".repeat(Math.min(3, ++best.variants));
      else {
        const letter = String.fromCharCode(65 + Math.min(25, parts.length));
        parts.push({ sig, letter, variants: 0 });
        span.label = letter;
      }
    }
  }

  const seen = new Map<string, number>();
  return spans.map((s) => {
    const label = s.label ?? "";
    const pass = (seen.get(label) ?? 0) + 1;
    seen.set(label, pass);
    const a = bars[s.at];
    const z = bars[s.to];
    return { from: s.at, to: s.to, label, pass, start: a.start, beats: z.start + z.beats - a.start, printed: named };
  });
}

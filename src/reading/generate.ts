import { mod } from "../musicTheory";
import type { ChordInBar, KeyInfo, Position, ReadingBar, ReadingExercise, ReadingLevel, ReadingNote, Tune, PatternStep } from "../core";
import { OPEN_MIDI, parentScales, spell } from "../core";

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cand {
  string: number;
  fret: number;
}
interface Slot {
  dur: number;
  rest: boolean;
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

const TEMPLATES: Record<ReadingLevel, number[][]> = {
  1: [[1, 1, 1, 1]],
  2: [[1, 1, 1, 1], [1, 1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 1, 0.5, 0.5], [2, 1, 1], [1, 1, 2]],
  3: [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 1, 1.5, 0.5], [1.5, 0.5, 1.5, 0.5], [1, 1, 0.5, 0.5, 1], [2, 1, 1], [1, 0.5, 0.5, 1, 1]],
  4: [[0.5, 1, 1, 1, 0.5], [1, 0.5, 1, 1, 0.5], [0.5, 1, 0.5, 1, 1], [1, 1.5, 0.5, 1], [1.5, 1, 0.5, 1], [0.5, 1, 1, 1.5], [1, 1, 1, 0.5, 0.5]],
};

function chordAt(chords: ChordInBar[], beat: number): { chord: ChordInBar; start: number; idx: number } {
  let t = 0;
  for (let i = 0; i < chords.length; i++) {
    if (beat < t + chords[i].beats - 1e-9) return { chord: chords[i], start: t, idx: i };
    t += chords[i].beats;
  }
  const last = chords.length - 1;
  return { chord: chords[last], start: t - chords[last].beats, idx: last };
}

function durationOf(beats: number): { duration: ReadingNote["duration"]; dotted: boolean } {
  if (beats === 4) return { duration: "w", dotted: false };
  if (beats === 3) return { duration: "h", dotted: true };
  if (beats === 2) return { duration: "h", dotted: false };
  if (beats === 1.5) return { duration: "q", dotted: true };
  if (beats === 1) return { duration: "q", dotted: false };
  return { duration: "8", dotted: false };
}

/** VexFlow key-signature spec for a minor key. */
export function keySpecFor(key: KeyInfo): string {
  return `${key.tonic}m`;
}

/** Accidental per letter implied by the key signature (from the relative major spelling). */
function signature(key: KeyInfo): Record<string, string> {
  const PS = parentScales(key);
  const sig: Record<string, string> = {};
  for (const pc of PS.relMajor.pcs) {
    const n = spell(pc, "relMajor", key);
    sig[n[0]] = n.slice(1);
  }
  return sig;
}

export function generateReading(args: {
  tune: Tune;
  key: KeyInfo;
  level: ReadingLevel;
  loop: { start: number; end: number };
  position: Position;
  seed: number;
}): ReadingExercise {
  const { tune, key, level, position, seed } = args;
  const loop = {
    start: Math.max(0, Math.min(args.loop.start, tune.bars.length - 1)),
    end: Math.max(0, Math.min(args.loop.end, tune.bars.length - 1)),
  };
  if (loop.end < loop.start) loop.end = loop.start;
  const rnd = mulberry32(seed * 7919 + level * 104729 + loop.start * 31 + loop.end);
  const PS = parentScales(key);
  const sig = signature(key);

  const cands = new Map<number, Cand[]>();
  for (let s = 0; s < 6; s++)
    for (let f = position.from; f <= position.to; f++) {
      const m = OPEN_MIDI[s] + f;
      const l = cands.get(m) ?? [];
      l.push({ string: s, fret: f });
      cands.set(m, l);
    }
  const allMidis = [...cands.keys()].sort((a, b) => a - b);
  const center = (allMidis[0] + allMidis[allMidis.length - 1]) / 2;
  const ladderOf = (chord: ChordInBar) => allMidis.filter((m) => PS[chord.parentScale].pcs.includes(mod(m)));
  const ctOf = (chord: ChordInBar) => allMidis.filter((m) => chord.chordTones.includes(mod(m)));

  const nearest = (list: number[], ref: number, avoid?: number): number => {
    let pool = list.filter((m) => m !== avoid);
    if (!pool.length) pool = list;
    const best = Math.min(...pool.map((m) => Math.abs(m - ref)));
    const ties = pool.filter((m) => Math.abs(m - ref) === best);
    return ties[Math.floor(rnd() * ties.length)];
  };
  const nearestIdx = (list: number[], ref: number) => {
    let bi = 0;
    for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - ref) < Math.abs(list[bi] - ref)) bi = i;
    return bi;
  };

  const bars: ReadingBar[] = [];
  const flat: { bar: number; note: ReadingNote; chord: ChordInBar }[] = [];
  let prev = nearest(ctOf(tune.bars[loop.start].chords[0]), center);
  let dir = rnd() < 0.5 ? 1 : -1;

  for (let b = loop.start; b <= loop.end; b++) {
    const barNo = b - loop.start;
    const chords = tune.bars[b].chords;
    const isFinal = b === loop.end;
    const nextBar = !isFinal ? tune.bars[b + 1] : null;

    // rhythm
    let tpl: number[];
    if (isFinal) tpl = [1, 1, 2];
    else {
      let opts = TEMPLATES[level];
      if (chords.length > 1) {
        const ok = opts.filter((t) => {
          let s = 0;
          return t.some((d) => {
            const hit = Math.abs(s - chords[0].beats) < 1e-9;
            s += d;
            return hit;
          });
        });
        opts = ok.length ? ok : [[1, 1, 1, 1]];
      }
      tpl = opts[Math.floor(rnd() * opts.length)];
    }
    const slots: Slot[] = tpl.map((dur) => ({ dur, rest: false }));
    if (level >= 3 && !isFinal && rnd() < 0.5) {
      const choices = slots.map((_, i) => i).filter((i) => i >= 1 && slots[i].dur <= 1 && i < slots.length - 1);
      if (choices.length) slots[choices[Math.floor(rnd() * choices.length)]].rest = true;
    }

    const midis: (number | null)[] = [];
    let off = 0;
    const starts: number[] = [];
    const lastSoundIdx = slots.map((s) => !s.rest).lastIndexOf(true);
    slots.forEach((slot, k) => {
      starts.push(off);
      const { chord, start: cs } = chordAt(chords, off);
      if (slot.rest) {
        midis.push(null);
        off += slot.dur;
        return;
      }
      const sc = ladderOf(chord);
      const cts = ctOf(chord);
      const chordStart = Math.abs(off - cs) < 1e-9;
      let midi: number;
      if (isFinal && k === lastSoundIdx) {
        const roots = allMidis.filter((m) => mod(m) === chord.rootPc);
        midi = nearest(roots.length ? roots : cts, prev);
      } else if ((level <= 3 && chordStart) || (level === 4 && chordStart && rnd() < 0.75)) {
        midi = nearest(cts, prev, prev);
      } else if (level >= 2 && off === 2 && rnd() < 0.6) {
        midi = nearest(cts, prev, prev);
      } else if (k === lastSoundIdx && nextBar) {
        const target = nearest(ctOf(nextBar.chords[0]), prev);
        if (level === 4 && slot.dur === 0.5 && off === 3.5) midi = target;
        else {
          const i = nearestIdx(sc, prev);
          const opts = [sc[Math.min(sc.length - 1, i + 1)], sc[Math.max(0, i - 1)]];
          midi = Math.abs(opts[0] - target) <= Math.abs(opts[1] - target) ? opts[0] : opts[1];
          if (midi === prev) midi = opts[0] === prev ? opts[1] : opts[0];
        }
      } else {
        if (rnd() < 0.25) dir = -dir;
        let leap: number | undefined;
        if (level >= 3 && rnd() < 0.35) {
          const beyond = dir > 0 ? cts.filter((m) => m > prev) : cts.filter((m) => m < prev);
          if (beyond.length) leap = dir > 0 ? beyond[0] : beyond[beyond.length - 1];
        }
        if (leap !== undefined) midi = leap;
        else {
          const size = level === 1 ? 1 : rnd() < 0.65 ? 1 : 2;
          const i = nearestIdx(sc, prev);
          let ni = i + dir * size;
          if (ni < 0 || ni >= sc.length) {
            dir = -dir;
            ni = Math.max(0, Math.min(sc.length - 1, i + dir * size));
          }
          midi = sc[ni];
        }
      }
      prev = midi;
      midis.push(midi);
      off += slot.dur;
    });

    // level 4: chromatic approach from a half step below/above a following strong chord tone
    if (level === 4) {
      for (let i = 0; i + 1 < slots.length; i++) {
        const cur = midis[i];
        const nxt = midis[i + 1];
        if (cur === null || nxt === null || slots[i].dur !== 0.5 || slots[i + 1].rest) continue;
        if (!Number.isInteger(starts[i + 1])) continue;
        const { chord } = chordAt(chords, starts[i + 1]);
        if (!chord.chordTones.includes(mod(nxt)) || rnd() >= 0.6) continue;
        const opts = [nxt - 1, nxt + 1].filter((m) => cands.has(m));
        if (opts.length) midis[i] = opts[Math.floor(rnd() * opts.length)];
      }
    }

    const notes: ReadingNote[] = slots.map((slot, k) => {
      const d = durationOf(slot.dur);
      const startBeat = barNo * 4 + starts[k];
      const m = midis[k];
      if (m === null)
        return { rest: true, midi: 0, vexKey: "b/4", accidental: null, duration: d.duration, dotted: d.dotted, startBeat, durationBeats: slot.dur, string: 0, fret: 0 };
      return { rest: false, midi: m, vexKey: "", accidental: null, duration: d.duration, dotted: d.dotted, startBeat, durationBeats: slot.dur, string: 0, fret: 0 };
    });
    bars.push({ barIndex: b, chordSymbols: chords.map((c) => c.symbol), notes });
    notes.forEach((n, k) => flat.push({ bar: b, note: n, chord: chordAt(chords, starts[k]).chord }));
  }

  // fingering: in-window candidate nearest the previous fingering, preferring string changes
  let pf: Cand | null = null;
  for (const { note } of flat) {
    if (note.rest) continue;
    const list = cands.get(note.midi)!;
    let best = list[0];
    if (pf) {
      let bc = Infinity;
      for (const c of list) {
        const cost = Math.abs(c.fret - pf.fret) + (c.string === pf.string ? 1.5 : 0) + 0.2 * Math.abs(c.string - pf.string);
        if (cost < bc) {
          bc = cost;
          best = c;
        }
      }
    }
    pf = best;
    note.string = best.string;
    note.fret = best.fret;
  }

  // spelling + accidentals (reset every bar to the key signature)
  for (const bar of bars) {
    const state = new Map<string, string>();
    const items = flat.filter((f) => f.bar === bar.barIndex);
    for (const { note, chord } of items) {
      if (note.rest) continue;
      const name = spell(mod(note.midi), chord.parentScale, key);
      const letter = name[0];
      const acc = name.slice(1);
      const li = LETTERS.indexOf(letter);
      const accN = acc.startsWith("#") ? acc.length : -acc.length;
      const written = note.midi + 12;
      const oct = (written - LETTER_PC[li] - accN) / 12 - 1;
      note.vexKey = `${letter.toLowerCase()}${acc}/${oct}`;
      const mapKey = `${letter}${oct}`;
      const current = state.get(mapKey) ?? sig[letter] ?? "";
      if (acc === current) note.accidental = null;
      else note.accidental = (acc === "" ? "n" : acc) as ReadingNote["accidental"];
      state.set(mapKey, acc);
    }
  }

  return {
    id: `reading-${key.tonic}-${level}-${loop.start}-${loop.end}-${position.id}-${seed}`,
    level,
    keySignature: keySpecFor(key),
    bars,
    loop,
    positionId: position.id,
  };
}

export function readingToPattern(ex: { bars: ReadingBar[] }): PatternStep[] {
  const out: PatternStep[] = [];
  for (const bar of ex.bars)
    for (const n of bar.notes)
      if (!n.rest) out.push({ string: n.string, fret: n.fret, pc: mod(n.midi), midi: n.midi, startBeat: n.startBeat, durationBeats: n.durationBeats });
  return out;
}

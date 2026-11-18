import { mod } from "../musicTheory";
import type { ChordInBar, KeyInfo, PatternId, PatternStep, Position } from "./contract";
import { OPEN_MIDI, parentScales } from "./scales";

export const PATTERN_LABELS: Record<PatternId, string> = {
  scale: "Scale",
  thirds: "Thirds",
  triads: "Triads",
  sevenths: "7th arpeggios",
  guideTones: "Guide tones",
  arpChain: "Arpeggio chain",
};

interface Cand {
  string: number;
  fret: number;
}

function degIndex(midi: number, rootPc: number, pcs: number[]): number {
  const rel = mod(midi - rootPc);
  const idx = pcs.findIndex((pc) => mod(pc - rootPc) === rel);
  return Math.floor((midi - rootPc) / 12) * 7 + idx;
}

/** Strictly in-window candidates keyed by midi. */
function windowByMidi(position: Position, keep: (pc: number) => boolean): Map<number, Cand[]> {
  const m = new Map<number, Cand[]>();
  for (let s = 0; s < 6; s++) {
    for (let f = position.from; f <= position.to; f++) {
      const midi = OPEN_MIDI[s] + f;
      if (!keep(mod(midi))) continue;
      const list = m.get(midi) ?? [];
      list.push({ string: s, fret: f });
      m.set(midi, list);
    }
  }
  return m;
}

function layout(seq: number[], byMidi: Map<number, Cand[]>, dur: number): PatternStep[] {
  const steps: PatternStep[] = [];
  let prev: Cand | null = null;
  let beat = 0;
  for (const midi of seq) {
    const cands = byMidi.get(midi);
    if (!cands) continue;
    let best = cands[0];
    if (prev) {
      let bestCost = Infinity;
      for (const c of cands) {
        const cost = Math.abs(c.fret - prev.fret) + (c.string === prev.string ? 1.5 : 0) + 0.2 * Math.abs(c.string - prev.string);
        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }
    } else {
      best = cands.reduce((a, b) => (b.string > a.string ? b : a));
    }
    prev = best;
    steps.push({ string: best.string, fret: best.fret, pc: mod(midi), midi, startBeat: beat, durationBeats: dur });
    beat += dur;
  }
  return steps;
}

export function buildPattern(id: PatternId, chord: ChordInBar, position: Position, key: KeyInfo): PatternStep[] {
  const scale = parentScales(key)[chord.parentScale];
  const byMidi = windowByMidi(position, (pc) => scale.pcs.includes(pc));
  if (byMidi.size === 0) return [];
  const midis = [...byMidi.keys()].sort((a, b) => a - b);
  const byDeg = new Map<number, number>(); // degree index -> midi
  for (const m of midis) byDeg.set(degIndex(m, scale.rootPc, scale.pcs), m);
  const degs = [...byDeg.keys()].sort((a, b) => a - b);

  const rootMidi = midis.find((m) => mod(m) === chord.rootPc) ?? midis.find((m) => chord.chordTones.includes(mod(m))) ?? midis[0];
  const start = degIndex(rootMidi, scale.rootPc, scale.pcs);
  const avail = degs.filter((d) => d >= start && d <= start + 14);
  const top = avail[avail.length - 1];
  const toMidi = (ds: number[]) => ds.filter((d) => byDeg.has(d)).map((d) => byDeg.get(d)!);
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

  let seq: number[] = [];
  let dur = 0.5;
  switch (id) {
    case "scale": {
      const up = avail;
      seq = toMidi([...up, ...up.slice(0, -1).reverse()]);
      break;
    }
    case "thirds":
    case "triads":
    case "sevenths": {
      const offsets = id === "thirds" ? [0, 2] : id === "triads" ? [0, 2, 4] : [0, 2, 4, 6];
      const span = offsets[offsets.length - 1];
      const ds: number[] = [];
      for (const d of range(start, top - span)) ds.push(...offsets.map((o) => d + o));
      for (const d of range(start + span, top).reverse()) ds.push(...offsets.map((o) => d - o));
      seq = toMidi(ds);
      break;
    }
    case "guideTones": {
      dur = 1;
      const [third, seventh] = chord.guideTones;
      const thirds = midis.filter((m) => mod(m) === third);
      const sevenths = midis.filter((m) => mod(m) === seventh);
      if (thirds.length && sevenths.length) {
        const mid = (midis[0] + midis[midis.length - 1]) / 2;
        const t = thirds.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
        const s = sevenths.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
        seq = [t, s];
      }
      break;
    }
    case "arpChain": {
      const ct = avail.filter((d) => chord.chordTones.includes(mod(byDeg.get(d)!)));
      seq = toMidi([...ct, ...ct.slice(0, -1).reverse()]);
      break;
    }
  }
  return layout(seq, byMidi, dur);
}

import type { PatternStep } from "../core/contract";
import { OPEN_MIDI } from "../core/scales";
import { mod } from "../musicTheory";
import { makeScale, parseChord, type Chord, type Scale } from "./harmony";
import { fingerLine, MAX_FRET, notesIn, type Window } from "./fingering";
import type { LineNote } from "./lines";

// Holistic guitar mechanics & musical-glue drills: finger independence (spiders), string skipping,
// rhythm subdivision pyramids, horizontal position shifting, and harmonic enclosures. All pure,
// deterministic, and strictly inside playable acoustic frets (<= MAX_FRET).

export type SpiderPattern = "1234" | "4321" | "1324" | "1423";
export type SkipPattern = "adjacent" | "octave";
export type TechniqueKind = "spider" | "skip" | "pyramid" | "shift" | "enclose";
/** What a foundation trains; Home colours each group alike so a cluster reads at a glance. */
export type FoundationGroup = "fingers" | "picking" | "time" | "phrasing";

export const FOUNDATION_GROUPS: Record<FoundationGroup, { label: string; trains: string }> = {
  fingers: { label: "Fingers", trains: "fretting-hand independence and reach" },
  picking: { label: "Picking", trains: "clean string changes with the pick" },
  time: { label: "Time", trains: "subdivision against a steady beat" },
  phrasing: { label: "Phrasing", trains: "leading into chord tones" },
};

export interface TechniqueNote {
  midi: number;
  t: number;
  dur: number;
  string?: number;
  fret?: number;
}

export interface TechniqueMeta {
  id: string;
  kind: TechniqueKind;
  title: string;
  short: string;
  detail: string;
  why: string;
  insight: string;
  bpm: number;
  goalBpm: number;
  needs?: string;
  group: FoundationGroup;
  /**
   * The key the exercise lives in, as a tree hub ("M6" = F♯ major, "m9" = A minor). Foundations
   * sit in the keys tunes rarely visit, and whichever deck builds one plays it there, so the same
   * id is always the same music.
   */
  hub: string;
}

/** Shared mechanics catalogue displayed on Home's Foundations strip and built into decks. */
export const TECHNIQUE_TRACKS: readonly TechniqueMeta[] = [
  {
    id: "tech:spider:1234",
    kind: "spider",
    title: "Spider · 1-2-3-4",
    short: "Spider 1-2-3-4",
    detail: "One finger per fret, climbing from low E to high e in steady 8ths.",
    why: "Trains relaxed fretting, minimal finger lift, and even alternate picking.",
    insight: "Keep each finger hovering close — lift only when its string moves.",
    bpm: 64,
    goalBpm: 116,
    group: "fingers",
    hub: "M4",
  },
  {
    id: "tech:spider:4321",
    kind: "spider",
    title: "Spider · 4-3-2-1",
    short: "Spider 4-3-2-1",
    detail: "Lead with the pinky (4-3-2-1) across all six strings.",
    why: "Strengthens pinky independence and smooths descending lines.",
    insight: "Plant fingers 1–4 lightly together before peeling off from the pinky.",
    bpm: 62,
    goalBpm: 112,
    needs: "tech:spider:1234",
    group: "fingers",
    hub: "M4",
  },
  {
    id: "tech:spider:1324",
    kind: "spider",
    title: "Spider · 1-3-2-4",
    short: "Spider 1-3-2-4",
    detail: "Alternating finger permutation 1-3-2-4 across all six strings.",
    why: "Breaks adjacent-finger autopilot so non-linear melodies feel effortless.",
    insight: "Relax the thumb behind the neck so fingers 2 and 3 move independently.",
    bpm: 60,
    goalBpm: 112,
    needs: "tech:spider:4321",
    group: "fingers",
    hub: "M11",
  },
  {
    id: "tech:spider:1423",
    kind: "spider",
    title: "Spider · 1-4-2-3",
    short: "Spider 1-4-2-3",
    detail: "Outer-to-inner permutation 1-4-2-3 across all six strings.",
    why: "Isolates ring-and-pinky separation — the biggest fretting bottleneck.",
    insight: "Small, crisp pick strokes keep every chromatic jump locked to the click.",
    bpm: 58,
    goalBpm: 108,
    needs: "tech:spider:1324",
    group: "fingers",
    hub: "M11",
  },
  {
    id: "tech:pyramid:core",
    kind: "pyramid",
    title: "Rhythm pyramid · ¼ → 16ths",
    short: "Rhythm pyramid",
    detail: "One bar each of quarters, 8ths, triplets and 16ths, arpeggiating I–IV–V–I in one position.",
    why: "Shifts your internal subdivision gear smoothly without changing tempo.",
    insight: "Feel the beat stay still while the hand doubles, triples, and quadruples.",
    bpm: 52,
    goalBpm: 84,
    group: "time",
    hub: "M6",
  },
  {
    id: "tech:skip:adjacent",
    kind: "skip",
    title: "String crossings · paired",
    short: "String crossings",
    detail: "Crisp alternating crosses across adjacent string pairs in position.",
    why: "Most missed notes happen crossing strings, not staying on one.",
    insight: "Keep your wrist loose; let the pick clear the string by a hair.",
    bpm: 60,
    goalBpm: 108,
    group: "picking",
    hub: "M1",
  },
  {
    id: "tech:skip:octave",
    kind: "skip",
    title: "String skipping · wide leaps",
    short: "String skipping",
    detail: "Jump cleanly across a silent middle string on every other note.",
    why: "Opens wide melodic intervals and crisp picking accuracy.",
    insight: "Anchor the pick motion from the wrist rather than jumping the whole arm.",
    bpm: 56,
    goalBpm: 104,
    needs: "tech:skip:adjacent",
    group: "picking",
    hub: "M1",
  },
  {
    id: "tech:shift:connect",
    kind: "shift",
    title: "Position shift · two windows",
    short: "Position shifting",
    detail: "Walk up the scale across two connected fret positions and slide back.",
    why: "Breaks one-box thinking so you can move horizontally up the neck.",
    insight: "Look at the target fret one note early before your hand glides there.",
    bpm: 62,
    goalBpm: 108,
    group: "fingers",
    hub: "M8",
  },
  {
    id: "tech:enclose:core",
    kind: "enclose",
    title: "Chord-tone enclosures",
    short: "Enclosures",
    detail: "Half-step below, scale step above, then land on a chord tone of each chord in I–IV–V–I.",
    why: "Turns static arpeggios into real jazz and melodic phrasing.",
    insight: "Lean slightly into the chord tone on beat 2 and beat 4 of each bar.",
    bpm: 60,
    goalBpm: 112,
    group: "phrasing",
    hub: "M3",
  },
];

const SPIDER_OFFSETS: Record<SpiderPattern, readonly number[]> = {
  "1234": [0, 1, 2, 3],
  "4321": [3, 2, 1, 0],
  "1324": [0, 2, 1, 3],
  "1423": [0, 3, 1, 2],
};

/** 6 strings × 4 chromatic frets = 24 eighth notes = 3 full 4/4 bars. Frets stay within 1..MAX_FRET. */
export function spiderLine(pattern: SpiderPattern, windowP: number): TechniqueNote[] {
  const base = Math.max(1, Math.min(MAX_FRET - 3, windowP));
  const order = SPIDER_OFFSETS[pattern];
  const out: TechniqueNote[] = [];
  let t = 0;
  // Climb strings 6 (index 5) → 1 (index 0)
  for (let s = 5; s >= 0; s--) {
    for (const off of order) {
      const fret = base + off;
      out.push({ midi: OPEN_MIDI[s] + fret, t, dur: 0.5, string: s, fret });
      t += 0.5;
    }
  }
  return out;
}

/** 2 bars of 8ths (16 notes) alternating across adjacent strings or skipping one string in position. */
export function skipLine(kind: SkipPattern, scale: Scale, w: Window): TechniqueNote[] {
  const base = Math.max(1, Math.min(MAX_FRET - 3, w.p));
  const pickOnString = (s: number, preferHigh = false): { midi: number; string: number; fret: number } => {
    const cands: { midi: number; string: number; fret: number }[] = [];
    for (let f = base; f <= Math.min(MAX_FRET, base + 3); f++) {
      const midi = OPEN_MIDI[s] + f;
      if (scale.pcs.includes(mod(midi))) cands.push({ midi, string: s, fret: f });
    }
    if (!cands.length) {
      const fret = Math.min(MAX_FRET, base);
      return { midi: OPEN_MIDI[s] + fret, string: s, fret };
    }
    return preferHigh ? cands[cands.length - 1] : cands[0];
  };

  const pairs: [number, number][] =
    kind === "adjacent"
      ? [[5, 4], [4, 3], [3, 2], [2, 1], [1, 0], [0, 1], [2, 3], [4, 5]]
      : [[5, 3], [4, 2], [3, 1], [2, 0], [0, 2], [1, 3], [2, 4], [3, 5]];

  const out: TechniqueNote[] = [];
  let t = 0;
  pairs.forEach(([a, b], idx) => {
    const first = pickOnString(a, idx % 2 === 1);
    const second = pickOnString(b, idx % 2 === 0);
    out.push({ ...first, t, dur: 0.5 });
    t += 0.5;
    out.push({ ...second, t, dur: 0.5 });
    t += 0.5;
  });
  return out;
}

/** A foundation's key: the hub it hangs from on the tree, as a scale. */
export function foundationKey(track: Pick<TechniqueMeta, "hub">): { tonic: number; minor: boolean; scale: Scale } {
  const m = /^(M|m)(\d+)$/.exec(track.hub);
  const minor = m?.[1] === "m";
  const tonic = m ? mod(Number(m[2])) : 0;
  return { tonic, minor, scale: makeScale(tonic, minor ? "naturalMinor" : "major") };
}

/** The key's I–IV–V7–I (i–iv–V7–i in minor, the dominant borrowed from harmonic minor). */
export function cadenceChords(scale: Scale, minor: boolean): Chord[] {
  const name = (deg: number) => scale.names[deg];
  const symbols = [`${name(0)}${minor ? "m" : ""}`, `${name(3)}${minor ? "m" : ""}`, `${name(4)}7`, `${name(0)}${minor ? "m" : ""}`];
  return symbols.map((sym) => parseChord(sym) ?? parseChord(name(0))!);
}

/** Roman numerals for `cadenceChords`. */
export const cadenceRomans = (minor: boolean) => (minor ? ["i", "iv", "V7", "i"] : ["I", "IV", "V7", "I"]);

/** Four ascending chord tones inside the window, from the chord's lowest root where there is room. */
function chordCell(chord: Chord, w: Window): number[] {
  const tones = notesIn(chord.pcs.slice(0, 3), w.low, w.high);
  if (tones.length < 4) {
    const r = OPEN_MIDI[4] + Math.min(5, w.p);
    return [r, r + 4, r + 7, r + 12];
  }
  const rootAt = tones.findIndex((m) => mod(m) === chord.root);
  const from = Math.max(0, Math.min(rootAt < 0 ? 0 : rootAt, tones.length - 4));
  return tones.slice(from, from + 4);
}

/**
 * 4-bar Rhythm Pyramid arpeggiating the key's cadence in one position:
 * bar 1 = quarters on I, bar 2 = eighths on IV, bar 3 = triplets on V7, bar 4 = sixteenths back on I.
 * The beat stays still while the hand doubles, triples and quadruples, and the hand also has to find
 * each chord's shape in the position as it changes.
 */
export function pyramidLine(scale: Scale, w: Window, bars?: readonly Chord[]): TechniqueNote[] {
  const chords = bars?.length === 4 ? bars : cadenceChords(scale, scale.kind !== "major");
  const cells = chords.map((c) => chordCell(c, w));
  const out: TechniqueNote[] = [];
  const bar = (b: number, count: number, len: number) => {
    const cell = cells[b];
    for (let i = 0; i < count; i++) {
      const last = b === 3 && i === count - 1;
      out.push({ midi: last ? cell[0] : cell[i % len], t: b * 4 + (i * 4) / count, dur: 4 / count });
    }
  };
  bar(0, 4, 4);
  bar(1, 8, 4);
  bar(2, 12, 3);
  bar(3, 16, 4);
  return out;
}

/**
 * Horizontal position shifting: climbs two adjacent positions along strings D & G (frets <= MAX_FRET)
 * and glides back down — 16 eighth notes = 2 full 4/4 bars.
 */
export function shiftLine(scale: Scale, w: Window): TechniqueNote[] {
  const lowBase = Math.max(1, Math.min(MAX_FRET - 5, w.p));
  const hiBase = Math.min(MAX_FRET - 3, lowBase + 2);
  const onString = (s: number, fromFret: number, toFret: number) => {
    const found: { midi: number; string: number; fret: number }[] = [];
    for (let f = fromFret; f <= Math.min(MAX_FRET, toFret); f++) {
      const midi = OPEN_MIDI[s] + f;
      if (scale.pcs.includes(mod(midi))) found.push({ midi, string: s, fret: f });
    }
    return found;
  };
  const lowRun = [...onString(3, lowBase, lowBase + 3), ...onString(2, lowBase, lowBase + 3)];
  const hiRun = [...onString(2, hiBase, hiBase + 3), ...onString(1, hiBase, hiBase + 3)];
  const climb = [...lowRun.slice(0, 4), ...hiRun.slice(0, 4)];
  while (climb.length < 8) {
    const last = climb[climb.length - 1] ?? { midi: OPEN_MIDI[3] + lowBase, string: 3, fret: lowBase };
    climb.push(last);
  }
  const seq = [...climb.slice(0, 8), ...climb.slice(0, 8).reverse()];
  return seq.map((n, i) => ({ ...n, t: i * 0.5, dur: 0.5 }));
}

/**
 * Melodic enclosures through the key's cadence, one chord every two beats (2 bars): for each chord,
 * a half-step below, a diatonic step above, then its target held for a beat. The targets are the
 * 3rds of I, IV and V7 (the notes that name each chord) and the root of I to close, each the one
 * nearest the last, so the line moves by step through the changes. Frets stay <= MAX_FRET.
 */
export function enclosureLine(scale: Scale, chord: Chord, w: Window, bars?: readonly Chord[]): TechniqueNote[] {
  const chords = bars?.length === 4 ? bars : [chord, chord, chord, chord];
  const lo = Math.max(w.low + 1, OPEN_MIDI[4] + Math.max(1, w.p));
  const hi = Math.min(w.high - 2, OPEN_MIDI[0] + Math.min(MAX_FRET - 1, w.p + 2));
  if (hi <= lo) return [];
  const diatonicAbove = (midi: number): number => {
    for (let m = midi + 1; m <= midi + 3; m++) if (scale.pcs.includes(mod(m))) return m;
    return midi + 2;
  };
  const out: TechniqueNote[] = [];
  let prev = Math.round((lo + hi) / 2);
  chords.forEach((c, i) => {
    const pc = i === chords.length - 1 ? c.root : c.third !== null ? mod(c.root + c.third) : c.root;
    const options = notesIn([pc], lo, hi);
    if (!options.length) return;
    const target = options.reduce((best, m) => (Math.abs(m - prev) < Math.abs(best - prev) ? m : best), options[0]);
    const t = i * 2;
    out.push({ midi: target - 1, t, dur: 0.5 });
    out.push({ midi: diatonicAbove(target), t: t + 0.5, dur: 0.5 });
    out.push({ midi: target, t: t + 1, dur: 1 });
    prev = target;
  });
  return out.length === chords.length * 3 ? out : [];
}

/** Convert TechniqueNote[] into fretboard PatternStep[], honoring explicit string/fret where given. */
export function techniqueSteps(notes: TechniqueNote[], w: Window): PatternStep[] {
  const auto = fingerLine(notes.map((n) => n.midi), w);
  return notes.map((n, i) => ({
    string: n.string ?? auto[i].string,
    fret: Math.min(MAX_FRET, n.fret ?? auto[i].fret),
    pc: mod(n.midi),
    midi: n.midi,
    startBeat: n.t,
    durationBeats: n.dur,
  }));
}

/**
 * Smart density-aware starting BPM for an exercise based on its note rate (notes per beat)
 * and shortest subdivision, bounded cleanly relative to the target tempo.
 */
export function densityStartBpm(notes: readonly Pick<LineNote, "t" | "dur">[], goalBpm: number): number {
  if (notes.length < 2) return Math.max(48, Math.min(goalBpm, Math.round((goalBpm * 0.8) / 2) * 2));
  const spanBeats = Math.max(1, notes[notes.length - 1].t + notes[notes.length - 1].dur - notes[0].t);
  const density = notes.length / spanBeats; // notes per beat (1 = quarters, 2 = eighths, 4 = sixteenths)
  let shortest = 4;
  for (let i = 1; i < notes.length; i++) {
    const gap = notes[i].t - notes[i - 1].t;
    if (gap > 1e-4 && gap < shortest) shortest = gap;
  }
  // Sparse phrases (<= 1 note/beat) can start closer to goal (~88%); dense runs (~2+ notes/beat) start gentler (~72%),
  // and 16th-note subdivisions cap start speed so the player isn't ambushed on Day 1.
  const factor = shortest <= 0.26 ? 0.65 : density >= 2.2 ? 0.72 : density >= 1.4 ? 0.78 : 0.88;
  const floor = shortest <= 0.26 ? 44 : 52;
  const raw = Math.round((goalBpm * factor) / 2) * 2;
  return Math.max(floor, Math.min(goalBpm, raw));
}

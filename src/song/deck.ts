import type { PatternStep } from "../core/contract";
import { OPEN_MIDI } from "../core/scales";
import { mod, pitchClassToName } from "../musicTheory";
import { buildPlan, type Step } from "../tunes/learn";
import type { LeadSheet } from "../tunes/musicxml";
import type { Target, Timeline, Voice } from "../tunes/order";
import { parsePassageId, passageId, passageLabel, passageTimeline, validPassage } from "../tunes/passage";
import { chooseWindow, fingerLine, fitWindow, MAX_FRET, notesIn, windowAt, type Window } from "./fingering";
import { analyze, makeScale, nice, parseChord, pretty, romanOf, spellIn, type Cadence, type Chord, type ChordEvent, type Harmony, type Scale } from "./harmony";
import { echoOfTune, EAR_TIERS, earPhrase } from "./ear";
import { stringPrompts, thirdPrompts, tonePrompts, STRING_NAMES, type Prompt } from "./fretboard";
import { glue } from "./ids";
import { arpLine, chainLine, guideLine, scaleLine, type LineNote, type ScaleDrill, type Span } from "./lines";
import { seeded } from "./rand";
import { freshLine, knownLine, pickKnown, vary } from "./reading";
import { isolateRhythm } from "./rhythm";
import { cadenceChords, cadenceRomans, densityStartBpm, enclosureLine, foundationKey, pyramidLine, shiftLine, skipLine, spiderLine, TECHNIQUE_TRACKS, techniqueSteps, type SpiderPattern, type TechniqueKind, type TechniqueNote } from "./technique";
import { voiceChords, type Voicing } from "./voicings";

// A tune turned into a deck of exercise cards that together teach it:
//   scales   — each key centre's parent scales in position: run, thirds, diatonic triads and 7ths
//   technique — holistic guitar mechanics: spider permutations, string skipping, rhythm pyramids, shifting, enclosures
//   harmony  — per section (and per cadence): arpeggios, guide-tone line, arpeggio chain
//   chords   — shell voicings through each section and cadence, with the melody playing on top
//   melody   — the learning plan's chunks, joins, sections and memory passes, over the backing
//   reading  — notes that are new every visit, so they can only be read (see reading.ts)
// Every card carries its own timeline (what to play, what the band plays) for the session player.

export type Family = "scales" | "technique" | "harmony" | "melody" | "chords" | "reading" | "ear" | "fretboard";
export type Kind = ScaleDrill | TechniqueKind | "arps" | "guides" | "chain" | "voicings" | "comping" | "improv" | "melody" | "known" | "varied" | "line" | "echo" | "onstring" | "shape3" | "tones";
export type Rhythm = "quarters" | "triplets" | "sixteenths";

export interface Context {
  chord: Chord | null;
  scale: Scale;
  next: Chord | null;
  roman: string;
}

export interface Card {
  id: string;
  tuneId: string; // the tune it was made from
  tune: string; // and that tune's title
  p: number; // first fret of the position it is fingered in
  family: Family;
  kind: Kind;
  group: string; // "D minor" · "A section" · "ii–V–I in F major"
  title: string;
  detail: string; // what to do
  why: string;
  where: string; // "bars 2–9"
  bpm: number; // starting tempo
  goalBpm: number;
  pass: number; // share of an in-time pass to get right
  listen: boolean; // hear it once first, while it's new
  pace: boolean; // an at-your-own-pace phase before playing in time
  memory: boolean; // notes hidden until played
  click: boolean; // click in time
  tl: Timeline;
  from: number; // slots, inclusive
  to: number;
  first: number; // targets, inclusive
  last: number;
  view: "fretboard" | "score" | "chords" | "improv" | "prompts";
  steps: (PatternStep | null)[]; // fingering per target
  context: (Context | null)[]; // harmony under each target
  voicings: (Voicing | null)[]; // chord cards: the shape per target
  step?: Step; // melody cards
  rhythm?: Rhythm; // scale runs in another division of the beat
  needs?: string; // the exercise this one builds on: it joins the box once that one is played clean
  fresh?: boolean; // its notes are new every visit: read, never heard first, and the neck stays out of it
  secret?: string; // what it turned out to be, shown once it has been played
  spot?: boolean; // a part taken out of a longer exercise to be worked on by itself
  run?: boolean; // a run-through: once, top to bottom, nothing stops and the tempo holds
  prompts?: Prompt[]; // fretboard cards: what is asked for each note (card-relative)
  exact?: boolean; // the octave counts: the answer is one place on the neck
  rhythmPitch?: number; // source notation is shown on this one pitch, retaining its original rhythm
  followedBy?: string; // explicitly selected study continues with this card, outside the daily intro
  insight?: string; // crisp one-line musical or mechanical side-education cue
}

export interface Deck {
  cards: Card[];
  harmony: Harmony;
  window: Window;
  intro: string[]; // card ids in the order they are introduced
}

export const FAMILY_LABEL: Record<Family, string> = { scales: "Scales", technique: "Technique", harmony: "Over the changes", melody: "Melody", chords: "Chords", reading: "Reading", ear: "Ear", fretboard: "Fretboard" };
export const KIND_LABEL: Record<Kind, string> = {
  run: "Scale",
  thirds: "Thirds",
  triads: "Triads",
  sevenths: "7th arpeggios",
  spider: "Spider",
  skip: "String skip",
  pyramid: "Rhythm pyramid",
  shift: "Position shift",
  enclose: "Enclosures",
  arps: "Arpeggios",
  guides: "Guide tones",
  chain: "Arpeggio chain",
  voicings: "Voicings",
  comping: "Comping",
  improv: "Improvising",
  melody: "Melody",
  known: "A tune you know",
  varied: "The melody, moved",
  line: "A line to read",
  echo: "An echo",
  onstring: "Notes on a string",
  shape3: "Thirds by shape",
  tones: "Chord tones",
};

// ---------- support: what the band plays ----------

const bassNote = (pc: number) => 40 + mod(pc - 40); // E2..D♯3

/** Root on the change, the 5th halfway through a bar or more (a two-feel). */
function bassLine(spans: Span[]): Voice[] {
  const out: Voice[] = [];
  for (const s of spans) {
    const root = bassNote(s.chord.bass ?? s.chord.root);
    const fifth = bassNote(s.chord.root + s.chord.fifth);
    for (let b = 0; b < s.dur - 1e-6; b += 2) {
      const dur = Math.min(2, s.dur - b);
      out.push({ t: s.t + b, dur, midi: b % 4 === 0 || s.dur < 4 ? root : fifth });
    }
  }
  return out;
}

/** 3-5-7 (or 3-5-8) close voicing around middle C. */
function padVoicing(c: Chord): number[] {
  const third = c.third ?? 4;
  const ivs = [third, c.fifth, c.seventh ?? 12];
  const lowest = 52 + mod(c.root + third - 52);
  return ivs.map((iv) => lowest + (iv - third));
}

function padHits(spans: Span[]): Timeline["comp"] {
  const out: Timeline["comp"] = [];
  for (const s of spans)
    for (let b = 0; b < s.dur - 1e-6; b += 4) out.push({ t: s.t + b, dur: Math.min(4, s.dur - b), midis: padVoicing(s.chord) });
  return out;
}

function synthSlots(total: number): Timeline["slots"] {
  const bars = Math.max(1, Math.ceil(total / 4 - 1e-9));
  return Array.from({ length: bars }, (_, i) => ({ bar: i, pass: 1, start: i * 4, beats: 4, run: 0 }));
}

function slotAt(tl: Pick<Timeline, "slots">, t: number): number {
  const i = tl.slots.findIndex((s) => t >= s.start - 1e-6 && t < s.start + s.beats - 1e-6);
  return i < 0 ? tl.slots.length - 1 : i;
}

function toTargets(tl: Pick<Timeline, "slots">, notes: LineNote[]): Target[] {
  return notes.map((n, i) => {
    const slot = slotAt(tl, n.t);
    return { midi: n.midi, notes: [i], bar: tl.slots[slot].bar, slot, t: n.t, dur: n.dur };
  });
}

function stepsFor(notes: LineNote[], w: Window, t0: number): PatternStep[] {
  const f = fingerLine(notes.map((n) => n.midi), w);
  return notes.map((n, i) => ({ string: f[i].string, fret: f[i].fret, pc: mod(n.midi), midi: n.midi, startBeat: n.t - t0, durationBeats: n.dur }));
}

// ---------- the tune's material ----------

interface Spanned extends Span {
  scale: Scale;
  next: Chord | null;
  roman: string;
}

/** Chord spans between two times, the chord already sounding at `from` included. */
function spansIn(events: ChordEvent[], from: number, to: number): Spanned[] {
  const out: Spanned[] = [];
  events.forEach((e, i) => {
    const a = Math.max(e.t, from);
    const b = Math.min(e.t + e.dur, to);
    if (b - a < 1e-6) return;
    out.push({ chord: e.chord, t: a, dur: b - a, scale: e.scale, next: events[i + 1]?.chord ?? null, roman: e.roman });
  });
  return out;
}

interface Chunk {
  label: string; // "A section", "A section · bars 2–5"
  key: string; // stable id part
  from: number; // slots
  to: number;
}

const sectionName = (label: string) => (/^[A-Z]\d?$/.test(label.trim()) ? `${label.trim()} section` : label.trim());

function barsLabel(sheet: LeadSheet, tl: Timeline, from: number, to: number): string {
  const a = sheet.barNumbers[tl.slots[from].bar] ?? String(tl.slots[from].bar + 1);
  const b = sheet.barNumbers[tl.slots[to].bar] ?? String(tl.slots[to].bar + 1);
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

/** The sections in playing order, each taken once (the first time through), cut to 8 bars at most. */
function chunks(sheet: LeadSheet, tl: Timeline, events: ChordEvent[]): Chunk[] {
  const marked = sheet.bars.some((b) => b.section);
  const sectionOf = (bar: number) => {
    for (let b = bar; b >= 0; b--) if (sheet.bars[b].section) return sheet.bars[b].section!;
    return "";
  };
  const runs: { label: string; from: number; to: number }[] = [];
  tl.slots.forEach((s, i) => {
    const label = marked ? sectionOf(s.bar) : "";
    const last = runs[runs.length - 1];
    if (last && last.label === label && s.bar > tl.slots[i - 1].bar) last.to = i;
    else runs.push({ label, from: i, to: i });
  });
  const seen = new Set<string>();
  const covered = new Set<number>();
  const out: Chunk[] = [];
  for (const r of runs) {
    if (marked && (!r.label || seen.has(r.label))) continue;
    const bars = tl.slots.slice(r.from, r.to + 1).map((s) => s.bar);
    if (!marked && bars.filter((b) => covered.has(b)).length * 2 >= bars.length) continue; // a repeat played again
    seen.add(r.label);
    bars.forEach((b) => covered.add(b));
    for (let a = r.from; a <= r.to; a += 8) {
      const b = Math.min(r.to, a + 7);
      const t0 = tl.slots[a].start;
      const t1 = tl.slots[b].start + tl.slots[b].beats;
      if (!events.some((e) => e.t < t1 - 1e-6 && e.t + e.dur > t0 + 1e-6)) continue;
      const whole = r.from === a && r.to === b;
      const name = r.label ? sectionName(r.label) : "";
      const label = name && whole ? name : name ? `${name} · ${barsLabel(sheet, tl, a, b)}` : barsLabel(sheet, tl, a, b);
      out.push({ label: label.charAt(0).toUpperCase() + label.slice(1), key: `${r.label || "bars"}#${a - r.from}`, from: a, to: b });
    }
  }
  return out;
}

// ---------- texts ----------

const TRIAD_Q: Record<string, string> = { "4,7": "", "3,7": "m", "3,6": "°", "4,8": "+" };
const SEVENTH_Q: Record<string, string> = { "4,7,11": "Δ7", "4,7,10": "7", "3,7,10": "m7", "3,6,10": "ø7", "3,6,9": "°7", "3,7,11": "m(Δ7)", "4,8,11": "Δ7♯5" };

function diatonicChords(scale: Scale, size: 3 | 4): string {
  return scale.pcs
    .map((pc, i) => {
      const ivs = [2, 4, 6].slice(0, size - 1).map((k) => mod(scale.pcs[(i + k) % 7] - pc));
      return scale.names[i] + ((size === 3 ? TRIAD_Q : SEVENTH_Q)[ivs.join(",")] ?? "?");
    })
    .join(" ");
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function scaleWhy(drill: ScaleDrill, scale: Scale, chords: string[], natural: Scale | null): string {
  const used = list(chords.slice(0, 4).map(pretty));
  switch (drill) {
    case "run":
      if (natural && scale.kind !== "naturalMinor") {
        const raised = scale.names.filter((_, i) => !natural.pcs.includes(scale.pcs[i]));
        const lowered = natural.names.filter((_, i) => !scale.pcs.includes(natural.pcs[i]));
        return `${list(raised)} instead of ${list(lowered)}: what ${used || "the dominant"} ${chords.length > 1 ? "need" : "needs"}. Everything else stays.`;
      }
      if (scale.kind === "naturalMinor") return `Home for ${used}. Same notes as ${makeScale(mod(scale.root + 3), "major", undefined).names[0]} major, centred on ${scale.names[0]}.`;
      return `The notes of ${chords.length > 4 ? `${chords.slice(0, 4).map(pretty).join(", ")} and more` : used}.`;
    case "thirds":
      return "Every pair is the bottom of a chord in the key: thirds are the sound of its harmony.";
    case "triads":
      return `The key's triads in one position: ${diatonicChords(scale, 3)}.`;
    default:
      return `Its 7th chords, the ones jazz is built on: ${diatonicChords(scale, 4)}.`;
  }
}

// ---------- the deck ----------

const READ_BARS = 4; // a reading exercise is this long: enough to need the eyes, short enough to finish
const MAX_READ_SECTIONS = 4;

/** A scale's exercises in the order they open: the notes, then other grids and melodic patterns. */
const SCALE_STAGES: { drill: ScaleDrill; rhythm?: Rhythm; needs?: string }[] = [
  { drill: "run" },
  { drill: "run", rhythm: "quarters", needs: "run" },
  { drill: "thirds", needs: "run" },
  { drill: "run", rhythm: "triplets", needs: "run" },
  { drill: "triads", needs: "thirds" },
  { drill: "run", rhythm: "sixteenths", needs: "run:triplets" },
  { drill: "sevenths", needs: "triads" },
];

/** Other divisions of the beat, each at a click that keeps the notes per minute sensible. */
const RHYTHMS: Record<Rhythm, { beats: number; label: string; count: string; bpm: number; goal: number }> = {
  quarters: { beats: 1, label: "quarter notes", count: "one", bpm: 84, goal: 144 },
  triplets: { beats: 1 / 3, label: "triplets", count: "three", bpm: 52, goal: 88 },
  sixteenths: { beats: 1 / 4, label: "16ths", count: "four", bpm: 44, goal: 76 },
};

/**
 * `round` and `seen` only matter to the reading exercises: `round` changes whenever their notes
 * should be new (a new day, another session), `seen` says how often each has been played, which
 * decides how hard it is and which known tune comes next.
 */
export function buildDeck(sheet: LeadSheet, tl: Timeline, opts: { window?: number; round?: string; seen?: Record<string, number>; rhythmFrom?: string; passageFrom?: string } = {}): Deck {
  const harmony = analyze(sheet, tl);
  const w = opts.window ? windowAt(opts.window) : chooseWindow(harmony.home.tonic);
  const tempo = sheet.tempo ?? 90;
  const fromFile = tl.comp.length > 0;
  const allSpans = spansIn(harmony.events, 0, tl.total);
  const songComp = fromFile ? tl.comp : padHits(allSpans);
  const songBass = fromFile ? undefined : bassLine(allSpans);
  const positionText = `frets ${w.p}–${w.p + 3}`;

  const technique: Card[] = [];
  const melodyCards: Card[] = [];

  const base = {
    tuneId: sheet.id,
    tune: sheet.title,
    p: w.p,
    listen: false,
    pace: true,
    memory: false,
    click: false,
    view: "fretboard" as const,
    voicings: [] as (Voicing | null)[],
  };

  // scales: per key centre, its parent scales on the tonic. Notes first (the run), then the same
  // notes on other grids and in melodic patterns; each step opens once the one before it is clean.
  for (const centre of harmony.centres) {
    const scales = centre.scales.filter((s) => s.scale.root === centre.key.tonic && s.beats >= 4).slice(0, 2);
    const natural = scales.find((s) => s.scale.kind === "naturalMinor")?.scale ?? null;
    const tonicChord = parseChord(centre.key.tonicName + (centre.key.mode === "minor" ? "m" : ""))!;
    for (const stage of SCALE_STAGES)
      for (const { scale, chords } of scales) {
        const { drill, rhythm } = stage;
        const notes = scaleLine(drill, scale, w, rhythm ? RHYTHMS[rhythm].beats : undefined);
        if (!notes.length) continue;
        const total = notes[notes.length - 1].t + notes[notes.length - 1].dur;
        const slots = synthSlots(total);
        const spans: Span[] = [{ chord: tonicChord, t: 0, dur: slots.length * 4 }];
        const timeline: Timeline = { slots, targets: toTargets({ slots }, notes), comp: padHits(spans), bass: bassLine(spans), total: slots.length * 4 };
        const ctx: Context = { chord: tonicChord, scale, next: null, roman: centre.key.mode === "minor" ? "i" : "I" };
        technique.push({
          ...base,
          id: `scale:${scale.id}:${drill}${rhythm ? `:${rhythm}` : ""}`,
          family: "scales",
          kind: drill,
          rhythm,
          needs: stage.needs ? `scale:${scale.id}:${stage.needs}` : undefined,
          group: centre.key.name,
          title: rhythm ? `${scale.name} · ${RHYTHMS[rhythm].label}` : drill === "run" ? scale.name : `${scale.name} · ${KIND_LABEL[drill].toLowerCase()}`,
          detail: rhythm
            ? `The same run, ${RHYTHMS[rhythm].count} note${rhythm === "quarters" ? "" : "s"} to the click.`
            : drill === "run"
              ? `From the lowest ${scale.names[0]} up to the top of the position, down to its lowest note and back to ${scale.names[0]}.`
              : drill === "thirds"
                ? "In thirds from the tonic, up and back down."
                : drill === "triads"
                  ? "Each degree's triad up the scale in triplets, then down."
                  : "Each degree's 7th chord, 1-3-5-7, up the scale and back down.",
          why: rhythm ? "Same notes on another grid: the picking hand divides the beat." : scaleWhy(drill, scale, chords, scale.kind === "naturalMinor" ? null : natural),
          where: positionText,
          bpm: rhythm ? RHYTHMS[rhythm].bpm : drill === "triads" ? 60 : drill === "sevenths" ? 63 : 72,
          goalBpm: rhythm ? RHYTHMS[rhythm].goal : drill === "triads" ? 100 : 116,
          pass: 0.85,
          click: true,
          tl: timeline,
          from: 0,
          to: slots.length - 1,
          first: 0,
          last: notes.length - 1,
          steps: stepsFor(notes, w, 0),
          context: notes.map(() => ctx),
        });
      }
  }

  // lines over the changes, for a set of spans on a given timeline
  const lineCard = (
    kind: "arps" | "guides" | "chain",
    spans: Spanned[],
    timeline: Omit<Timeline, "targets">,
    meta: { id: string; group: string; where: string; from: number; to: number; tempoGoal: number },
  ): Card | null => {
    const notes = kind === "arps" ? arpLine(spans, w) : kind === "guides" ? guideLine(spans, w) : chainLine(spans, w);
    if (!notes.length) return null;
    const targets = toTargets(timeline, notes);
    const context = notes.map((n) => {
      const s = spans.find((x) => n.t >= x.t - 1e-6 && n.t < x.t + x.dur - 1e-6) ?? spans[spans.length - 1];
      return { chord: s.chord, scale: s.scale, next: s.next, roman: s.roman };
    });
    const first = spans[0];
    const second = spans.find((s) => s.chord.symbol !== first.chord.symbol);
    let example = "";
    if (kind === "guides" && second) {
      const a = notes.find((n) => n.t < second.t)?.midi;
      const b = notes.find((n) => n.t >= second.t - 1e-6)?.midi;
      if (a !== undefined && b !== undefined)
        example = ` ${spellIn(first.scale, a)} → ${spellIn(second.scale, b)} from ${pretty(first.chord.symbol)} to ${pretty(second.chord.symbol)}.`;
    }
    const n = spans.length;
    return {
      ...base,
      id: `${meta.id}:${kind}`,
      family: "harmony",
      kind,
      group: meta.group,
      title: `${meta.group} · ${KIND_LABEL[kind].toLowerCase()}`,
      detail:
        kind === "arps"
          ? "Each chord as it arrives: 1-3-5-7 from its root, up and back down, in 8ths."
          : kind === "guides"
            ? "The 3rd and 7th of each chord, each moving to the closest one of the next chord."
            : "Unbroken 8ths on chord tones only. At every change, a step to the nearest note of the new chord.",
      why:
        kind === "arps"
          ? `${n} chord${n === 1 ? "" : "s"} under your fingers: ${list([...new Set(spans.map((s) => pretty(s.chord.symbol)))].slice(0, 6))}.`
          : kind === "guides"
            ? `The 3rd and 7th say which chord it is; between chords they move by step.${example}`
            : "This is how a line walks through the changes instead of restarting at every chord.",
      where: meta.where,
      bpm: kind === "guides" ? 72 : kind === "chain" ? 56 : 60,
      goalBpm: kind === "guides" ? Math.max(90, meta.tempoGoal) : meta.tempoGoal,
      pass: kind === "chain" ? 0.75 : 0.8,
      listen: true,
      tl: { ...timeline, targets },
      from: meta.from,
      to: meta.to,
      first: 0,
      last: notes.length - 1,
      steps: stepsFor(notes, w, timeline.slots[meta.from].start),
      context,
    };
  };

  const voicingCard = (
    spans: Spanned[],
    timeline: Omit<Timeline, "targets" | "guide">,
    guide: Voice[],
    meta: { id: string; group: string; where: string; from: number; to: number; tempoGoal: number },
  ): Card | null => {
    if (!spans.length) return null;
    const voicings = voiceChords(spans.map((s) => s.chord), w);
    const targets: Target[] = spans.map((s, i) => {
      const slot = slotAt(timeline, s.t);
      const v = voicings[i];
      return {
        midi: v.midis[v.midis.length - 1],
        notes: [i],
        bar: timeline.slots[slot].bar,
        slot,
        t: s.t,
        dur: s.dur,
        chord: { required: s.chord.required, clash: s.chord.clash, voicing: v.midis },
      };
    });
    return {
      ...base,
      id: `${meta.id}:voicings`,
      family: "chords",
      kind: "voicings",
      group: meta.group,
      title: `${meta.group} · voicings`,
      detail: "Each chord strummed as it comes: at your own pace first (it waits for each chord), then in time under the melody.",
      why: "Shells: root, 3rd and 7th, the sound of each chord in three or four notes. Hear the melody sit on top of them.",
      where: meta.where,
      bpm: Math.min(72, tempo),
      goalBpm: meta.tempoGoal,
      pass: 0.7,
      listen: true,
      view: "chords",
      tl: { ...timeline, targets, guide },
      from: meta.from,
      to: meta.to,
      first: 0,
      last: targets.length - 1,
      steps: targets.map(() => null),
      context: spans.map((s) => ({ chord: s.chord, scale: s.scale, next: s.next, roman: s.roman })),
      voicings,
    };
  };

  // comping: the same shapes struck on a rhythm, with the bass; every hit must be struck again, not
  // left ringing. Two and four first (the hi-hat's beats), then the Charleston (one, and of two).
  const COMP = {
    comp24: { beats: [1, 3], label: "on 2 and 4", detail: "Each chord short on beats 2 and 4, where the hi-hat is." },
    charleston: { beats: [0, 1.5], label: "Charleston", detail: "Every bar: on one, then on the and of two. Short." },
  } as const;
  const compCard = (
    style: keyof typeof COMP,
    spans: Spanned[],
    timeline: Omit<Timeline, "targets">,
    meta: { id: string; group: string; where: string; from: number; to: number; tempoGoal: number },
  ): Card | null => {
    if (!spans.length) return null;
    const voiced = voiceChords(spans.map((s) => s.chord), w);
    const hits: { t: number; slot: number; span: number }[] = [];
    for (let slot = meta.from; slot <= meta.to; slot++) {
      const bar = timeline.slots[slot];
      for (const b of COMP[style].beats) {
        const t = bar.start + b;
        const span = spans.findIndex((x) => t >= x.t - 1e-6 && t < x.t + x.dur - 1e-6);
        if (b < bar.beats && span >= 0) hits.push({ t, slot, span });
      }
    }
    if (hits.length < 2) return null;
    const targets: Target[] = hits.map((h, i) => {
      const v = voiced[h.span];
      const c = spans[h.span].chord;
      return { midi: v.midis[v.midis.length - 1], notes: [i], bar: timeline.slots[h.slot].bar, slot: h.slot, t: h.t, dur: 0.5, chord: { required: c.required, clash: c.clash, voicing: v.midis, strike: true } };
    });
    return {
      ...base,
      id: `${meta.id}:${style}`,
      family: "chords",
      kind: "comping",
      needs: style === "comp24" ? `${meta.id}:voicings` : `${meta.id}:comp24`,
      group: meta.group,
      title: `${meta.group} · comping ${COMP[style].label}`,
      detail: COMP[style].detail,
      why: "Most of a tune is played behind the melody. The shapes you know, now in time with the bass.",
      where: meta.where,
      bpm: Math.min(80, tempo),
      goalBpm: meta.tempoGoal,
      pass: 0.7,
      listen: true,
      pace: false, // the shapes were learnt at your own pace on the voicings card
      click: true,
      view: "chords",
      tl: { ...timeline, targets },
      from: meta.from,
      to: meta.to,
      first: 0,
      last: targets.length - 1,
      steps: targets.map(() => null),
      context: hits.map((h) => ({ chord: spans[h.span].chord, scale: spans[h.span].scale, next: spans[h.span].next, roman: spans[h.span].roman })),
      voicings: hits.map((h) => voiced[h.span]),
    };
  };

  // improvising over the changes: nothing written, any notes; on the strong beats (one and three)
  // a note of the chord sounding counts as landed. It opens once the guide tones are clean.
  const improvCard = (spans: Spanned[], timeline: Omit<Timeline, "targets">, meta: { id: string; group: string; where: string; from: number; to: number; tempoGoal: number }): Card | null => {
    const hits: Target[] = [];
    const context: Context[] = [];
    for (let slot = meta.from; slot <= meta.to; slot++) {
      const bar = timeline.slots[slot];
      for (const b of bar.beats >= 4 ? [0, 2] : [0]) {
        const t = bar.start + b;
        const sp = spans.find((x) => t >= x.t - 1e-6 && t < x.t + x.dur - 1e-6);
        if (!sp) continue;
        const shown = w.low + mod(sp.chord.root - w.low); // the root in the position, for the page
        hits.push({ midi: shown, notes: [], bar: bar.bar, slot, t, dur: Math.min(2, bar.beats - b), any: sp.chord.pcs });
        context.push({ chord: sp.chord, scale: sp.scale, next: sp.next, roman: sp.roman });
      }
    }
    if (hits.length < 4) return null;
    return {
      ...base,
      id: `${meta.id}:improv`,
      family: "harmony",
      kind: "improv",
      needs: `${meta.id}:guides`,
      group: meta.group,
      title: `${meta.group} · improvise`,
      detail: "Any notes, any rhythm. The chord's own notes are lit; one of them on beats one and three lands.",
      why: "Scales and arpeggios are there to make lines up with. A chord tone on the strong beats is what makes a line sound like the changes.",
      where: meta.where,
      bpm: Math.min(80, tempo),
      goalBpm: meta.tempoGoal,
      pass: 0.6,
      pace: false,
      click: true,
      view: "improv",
      tl: { ...timeline, targets: hits },
      from: meta.from,
      to: meta.to,
      first: 0,
      last: hits.length - 1,
      steps: hits.map(() => null),
      context,
    };
  };

  // sections of the tune, on the tune's own timeline with its backing
  const sectionCards = new Map<string, Card[]>();
  const sectionChunks = chunks(sheet, tl, harmony.events);
  for (const ch of sectionChunks) {
    const t0 = tl.slots[ch.from].start;
    const t1 = tl.slots[ch.to].start + tl.slots[ch.to].beats;
    const spans = spansIn(harmony.events, t0, t1);
    if (!spans.length) continue;
    const timeline = { slots: tl.slots, comp: songComp, bass: songBass, total: tl.total };
    const meta = { id: `sec:${ch.key}`, group: ch.label, where: barsLabel(sheet, tl, ch.from, ch.to), from: ch.from, to: ch.to, tempoGoal: tempo };
    const guide: Voice[] = tl.targets.filter((x) => x.t >= t0 - 1e-6 && x.t < t1 - 1e-6).map((x) => ({ t: x.t, dur: x.dur, midi: x.midi }));
    const cards = [
      lineCard("arps", spans, timeline, meta),
      lineCard("guides", spans, timeline, meta),
      voicingCard(spans, { slots: tl.slots, comp: [], bass: bassLine(spans), total: tl.total }, guide, meta),
      compCard("comp24", spans, { slots: tl.slots, comp: [], bass: bassLine(spans), total: tl.total, guide }, meta),
      compCard("charleston", spans, { slots: tl.slots, comp: [], bass: bassLine(spans), total: tl.total, guide }, meta),
      lineCard("chain", spans, timeline, meta),
      improvCard(spans, timeline, meta),
    ].filter((c): c is Card => c !== null);
    sectionCards.set(ch.key, cards);
  }

  // cadences, looped on their own: | ii | V | I | I |  or  | V | V | I | I |
  const cadenceCards = new Map<string, Card[]>();
  const cadenceAt = new Map<string, number>(); // cadence id → first slot
  for (const cad of harmony.cadences) {
    const spans = cadenceSpans(cad);
    const total = 16;
    const slots = synthSlots(total);
    const timeline = { slots, comp: padHits(spans), bass: bassLine(spans), total };
    const where = cad.where.map((i) => sheet.barNumbers[harmony.events[i].bar] ?? String(harmony.events[i].bar + 1));
    const uniq = [...new Set(where)];
    const meta = {
      id: `cad:${cad.id}`,
      group: cad.label,
      where: `${cad.chords.map((c) => pretty(c.symbol)).join(" ")} · bar${uniq.length > 1 ? "s" : ""} ${uniq.slice(0, 4).join(", ")}`,
      from: 0,
      to: slots.length - 1,
      tempoGoal: Math.max(tempo, 100),
    };
    const bassOnly = { slots, comp: [], bass: bassLine(spans), total };
    const cards = [lineCard("arps", spans, timeline, meta), lineCard("guides", spans, timeline, meta), voicingCard(spans, timeline, [], meta), compCard("comp24", spans, bassOnly, meta), compCard("charleston", spans, bassOnly, meta)].filter(
      (c): c is Card => c !== null,
    );
    for (const c of cards) {
      c.why = `${cad.label} comes ${cad.where.length === 1 ? "once" : `${cad.where.length} times`} in the tune. ${c.why}`;
      if (c.kind === "voicings") c.detail = "The cadence round and round: at your own pace first, then in time over the bass.";
      if (c.kind === "comping") c.why = `${cad.label} comes ${cad.where.length === 1 ? "once" : `${cad.where.length} times`} in the tune. Struck in time, the change has to be ready before the beat.`;
    }
    cadenceCards.set(cad.id, cards);
    cadenceAt.set(cad.id, harmony.events[cad.where[0]].slot);
  }

  // melody: the learning plan, on the tune's timeline
  const plan = buildPlan(sheet, tl);
  const melodyTl: Timeline = fromFile ? tl : { ...tl, comp: songComp, bass: songBass };
  const melodyContext: (Context | null)[] = tl.targets.map((x) => {
    const s = allSpans.find((sp) => x.t >= sp.t - 1e-6 && x.t < sp.t + sp.dur - 1e-6);
    return s ? { chord: s.chord, scale: s.scale, next: s.next, roman: s.roman } : null;
  });
  for (const step of plan) {
    const first = tl.targets.findIndex((x) => x.slot >= step.from);
    let last = -1;
    tl.targets.forEach((x, i) => {
      if (x.slot <= step.to) last = i;
    });
    if (first < 0 || last < first) continue;
    melodyCards.push({
      ...base,
      id: `mel:${step.kind}:${step.from}-${step.to}`,
      family: "melody",
      kind: "melody",
      group: step.section ? sectionName(step.section) : sheet.title,
      title: step.title,
      detail: step.detail,
      why:
        step.kind === "memory"
          ? "The page fades in steps; a clean pass schedules a later review."
          : step.kind === "join"
            ? "Seams are where tunes fall apart; this one crosses a seam."
            : step.kind === "tune"
              ? "Top to bottom, as you'd play it."
              : "With the band playing the chords, so you hear where each note sits.",
      where: barsLabel(sheet, tl, step.from, step.to),
      bpm: densityStartBpm(tl.targets.slice(first, last + 1), tempo),
      goalBpm: tempo,
      pass: step.pass,
      listen: step.listen,
      pace: step.read,
      memory: step.kind === "memory",
      view: "score",
      tl: melodyTl,
      from: step.from,
      to: step.to,
      first,
      last,
      steps: tl.targets.map(() => null),
      context: melodyContext,
      step,
    });
  }

  // the run-through: the whole tune once with the band, like playing it for someone. It opens once
  // the tune top to bottom has been played clean; a wrong note does not stop it.
  const whole = melodyCards.find((c) => c.step?.kind === "tune") ?? melodyCards[melodyCards.length - 1];
  if (whole && tl.targets.length) {
    melodyCards.push({
      ...base,
      id: "mel:run",
      family: "melody",
      kind: "melody",
      needs: whole.id,
      group: sheet.title,
      title: "Run-through",
      detail: "The whole tune once with the band, at the tempo it is heading for. Nothing stops for a wrong note.",
      why: "Getting through a wrong note without stopping is its own skill, and only a run-through trains it.",
      where: barsLabel(sheet, tl, 0, tl.slots.length - 1),
      bpm: Math.max(40, Math.round((tempo * 0.75) / 2) * 2),
      goalBpm: tempo,
      pass: 0.75,
      listen: false,
      pace: false,
      view: "score",
      tl: melodyTl,
      from: 0,
      to: tl.slots.length - 1,
      first: 0,
      last: tl.targets.length - 1,
      steps: tl.targets.map(() => null),
      context: melodyContext,
      run: true,
    });
  }

  // reading: notes nobody could have practised. A tune everybody knows in this tune's key, then per
  // section its melody with notes moved and a new line over its chords.
  const reading: Card[] = [];
  const seen = (id: string) => opts.seen?.[id] ?? 0;
  const rand = (id: string) => seeded(`${sheet.id}:${id}:${opts.round ?? ""}:${seen(id)}`);
  const home = harmony.home;
  const readBase = { ...base, family: "reading" as const, fresh: true, pass: 0.8, group: "Reading" };
  const knownCard = (n: number, bars: number): Card | null => {
    const id = `read:known:${n}`;
    const tune = pickKnown(seeded(`${sheet.id}:known:${n}`), seen(id));
    // in the tune's own signature: its key, or the relative one
    const tonic = tune.minor === (home.mode === "minor") ? home.tonic : mod(home.tonic + (tune.minor ? 9 : 3));
    const scale = makeScale(tonic, tune.minor ? "naturalMinor" : "major");
    const notes = knownLine(tune, tonic, w, bars);
    if (!notes.length) return null;
    const slots = synthSlots(notes[notes.length - 1].t + notes[notes.length - 1].dur);
    const ctx: Context = { chord: null, scale, next: null, roman: "" };
    return {
      ...readBase,
      id,
      kind: "known",
      needs: n > 1 ? `read:known:${n - 1}` : undefined,
      title: n > 1 ? "A tune you know · all of it" : "A tune you know",
      detail: "Its name is not on the page.",
      why: "Read it, and the ear says what it is. Another one every time.",
      where: positionText,
      bpm: 72,
      goalBpm: 108,
      click: true,
      secret: tune.title,
      tl: { slots, targets: toTargets({ slots }, notes), comp: [], total: slots.length * 4 },
      from: 0,
      to: slots.length - 1,
      first: 0,
      last: notes.length - 1,
      steps: stepsFor(notes, w, 0),
      context: notes.map(() => ctx),
    };
  };
  const overTune = (id: string, kind: "varied" | "line", notes: LineNote[], from: number, to: number, text: Pick<Card, "title" | "detail" | "why" | "bpm" | "goalBpm">): Card | null => {
    if (notes.length < 4) return null;
    const fit = fitWindow(notes.map((n) => n.midi), w.p);
    return {
      ...readBase,
      ...text,
      id,
      kind,
      p: fit.p,
      where: barsLabel(sheet, tl, from, to),
      tl: { slots: tl.slots, targets: toTargets(tl, notes), comp: songComp, bass: songBass, total: tl.total },
      from,
      to,
      first: 0,
      last: notes.length - 1,
      steps: stepsFor(notes, fit, tl.slots[from].start),
      context: notes.map((n) => {
        const s = allSpans.find((sp) => n.t >= sp.t - 1e-6 && n.t < sp.t + sp.dur - 1e-6);
        return s ? { chord: s.chord, scale: s.scale, next: s.next, roman: s.roman } : null;
      }),
    };
  };
  const first = knownCard(1, 4);
  if (first) reading.push(first);
  sectionChunks.slice(0, MAX_READ_SECTIONS).forEach((ch, k) => {
    const to = Math.min(ch.to, ch.from + READ_BARS - 1);
    const t0 = tl.slots[ch.from].start;
    const t1 = tl.slots[to].start + tl.slots[to].beats;
    const spans = spansIn(harmony.events, t0, t1);
    const lineId = `read:line:${ch.key}`;
    const readLevel = Math.min(4, Math.floor(seen(lineId) / 2));
    const readNotes = spans.length ? freshLine(spans, w, rand(lineId), readLevel) : [];
    const readGoal = Math.max(84, Math.min(tempo, 108));
    const line = overTune(lineId, "line", readNotes, ch.from, to, {
      title: `${ch.label} · a line to read`,
      detail: readLevel >= 3 ? "A syncopated line over these chords — new every visit." : "A line over these chords that was not there before.",
      why: readLevel >= 4 ? "Chromatic approaches into chord tones; let the eyes read ahead by two beats." : readLevel >= 3 ? "Syncopations and wider skips over the changes — keep the picking hand swinging." : "Nobody has heard it, so it can only be read: chord tones on the beats, the scale between them.",
      bpm: densityStartBpm(readNotes, readGoal),
      goalBpm: readGoal,
    });
    const melody = tl.targets.filter((x) => x.t >= t0 - 1e-6 && x.t < t1 - 1e-6).map((x) => ({ midi: x.midi, t: x.t, dur: Math.min(x.dur, t1 - x.t) }));
    const varId = `read:var:${ch.key}`;
    const scaleAt = (i: number) => allSpans.find((sp) => melody[i].t >= sp.t - 1e-6 && melody[i].t < sp.t + sp.dur - 1e-6)?.scale ?? makeScale(home.tonic, home.mode === "minor" ? "naturalMinor" : "major", home.tonicName);
    const pitches = melody.map((n) => n.midi);
    const moved = melody.length >= 4 ? vary(melody, scaleAt, rand(varId), Math.min(...pitches) - 2, Math.max(...pitches) + 2).notes : [];
    const varied = overTune(varId, "varied", moved, ch.from, to, {
      title: `${ch.label} · with notes moved`,
      detail: "The melody, but some of its notes are not where they were.",
      why: "The fingers know the tune. Only the eyes can find what moved.",
      bpm: densityStartBpm(moved, tempo),
      goalBpm: tempo,
    });
    if (line) reading.push(line);
    if (varied) reading.push(varied);
    if (k === 0) {
      const whole = knownCard(2, 9);
      if (whole) reading.push(whole);
    }
  });

  // ear: a phrase is played, then played back (any octave). Its notes are the tune's own home scale,
  // so only keys the player plays songs in come up. The first tiers keep the page on screen as a
  // help; after that it stays hidden until the phrase has been played. Every visit a new phrase.
  const earDeck: Card[] = [];
  {
    const homeScale = makeScale(home.tonic, home.mode === "minor" ? "naturalMinor" : "major", home.tonicName);
    const lo = Math.max(w.low, OPEN_MIDI[4] + w.p);
    const hi = OPEN_MIDI[0] + w.p + 3;
    const rootMidi = 48 + mod(home.tonic - 48);
    const triad = [rootMidi, rootMidi + (home.mode === "minor" ? 3 : 4), rootMidi + 7]; // the key, quietly under it
    const earCard = (id: string, notes: LineNote[], text: Pick<Card, "title" | "detail" | "why" | "memory" | "needs" | "where">, scale = homeScale): Card | null => {
      if (notes.length < 2) return null;
      const end = notes[notes.length - 1].t + notes[notes.length - 1].dur;
      const slots = synthSlots(end);
      const ctx: Context = { chord: null, scale, next: null, roman: "" };
      return {
        ...base,
        ...text,
        id,
        family: "ear",
        kind: "echo",
        group: "Ear",
        fresh: true,
        listen: true,
        pace: true,
        click: false,
        pass: 0.8,
        bpm: 76,
        goalBpm: 76,
        secret: notes.map((n) => spellIn(scale, n.midi)).join(" "),
        tl: { slots, targets: toTargets({ slots }, notes), comp: slots.map((s) => ({ t: s.start, dur: s.beats, midis: triad })), total: slots.length * 4 },
        from: 0,
        to: slots.length - 1,
        first: 0,
        last: notes.length - 1,
        steps: stepsFor(notes, w, 0),
        context: notes.map(() => ctx),
      };
    };
    for (const tier of EAR_TIERS) {
      const id = `ear:${tier.n}`;
      const card = earCard(id, earPhrase(homeScale.pcs, home.tonic, lo, hi, tier, rand(id)), {
        title: tier.title,
        detail: "Hear its notes and rhythm, then play it back.",
        why: tier.page ? "The page is there while the ear catches up." : "Only the ear. The page shows once you have played it.",
        memory: !tier.page,
        needs: tier.n > 1 ? `ear:${tier.n - 1}` : undefined,
        where: positionText,
      });
      if (card) earDeck.push(card);
    }
    // two notes: the interval, before any phrase
    const interval = earCard("ear:int", earPhrase(homeScale.pcs, home.tonic, lo, hi, { n: 0, notes: 2, leap: 4, page: true, title: "" }, rand("ear:int")), {
      title: "Echo · two notes",
      detail: "Hear it, then play it back.",
      why: "Every phrase is made of steps like this one.",
      memory: false,
      needs: undefined,
      where: positionText,
    });
    if (interval) earDeck.unshift(interval); // first: the smallest call
    // the tune's chords as arpeggios: harmony heard as a line
    const common = [...allSpans.reduce((m, x) => m.set(x.chord.symbol, (m.get(x.chord.symbol) ?? 0) + x.dur), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([sym]) => allSpans.find((x) => x.chord.symbol === sym)!.chord);
    for (const chord of common) {
      const id = `ear:arp:${chord.symbol}`;
      const r = rand(id);
      const tones = notesIn(chord.pcs, lo, hi);
      const startAt = tones.findIndex((m) => mod(m) === chord.root);
      if (startAt < 0 || tones.length < startAt + 3) continue;
      const up = tones.slice(startAt, startAt + Math.min(4, chord.pcs.length));
      const line = r() < 0.5 ? up : [...up].reverse();
      const card = earCard(id, line.map((midi, k) => ({ midi, t: k, dur: k === line.length - 1 ? 4 - (k % 4) : 1 })), {
        title: `Echo · ${pretty(chord.symbol)} as a line`,
        detail: "Hear the chord's notes one by one, then play them back.",
        why: "The chords of the tune, heard from the inside: what an arpeggio over them sounds like.",
        memory: true,
        needs: "ear:2",
        where: positionText,
      });
      if (card) earDeck.push(card);
    }
    // the tune's other key centres: phrases where the tune goes
    harmony.centres
      .filter((c) => c.key.id !== home.id && c.scales.length)
      .slice(0, 2)
      .forEach((c) => {
        const id = `ear:key:${c.key.id}`;
        const scale = c.scales[0].scale;
        const card = earCard(id, earPhrase(scale.pcs, c.key.tonic, lo, hi, EAR_TIERS[2], rand(id)), {
          title: `Echo · in ${c.key.name}`,
          detail: "Hear it, then play it back.",
          why: `The tune moves to ${c.key.name}; this is how its notes sound.`,
          memory: true,
          needs: "ear:3",
          where: positionText,
        }, scale);
        if (card) earDeck.push(card);
      });
    sectionChunks.slice(0, 2).forEach((ch) => {
      const t0 = tl.slots[ch.from].start;
      const t1 = tl.slots[Math.min(ch.to, ch.from + 1)].start + tl.slots[Math.min(ch.to, ch.from + 1)].beats;
      const melody = tl.targets.filter((x) => x.t >= t0 - 1e-6 && x.t < t1 - 1e-6).map((x) => ({ midi: x.midi, t: x.t, dur: x.dur }));
      const card = earCard(`ear:tune:${ch.key}`, echoOfTune(melody, t0, 6), {
        title: `${ch.label} · echo the tune`,
        detail: "Hear it, then play it back.",
        why: "A phrase of the tune itself, by ear.",
        memory: true,
        needs: "ear:2",
        where: barsLabel(sheet, tl, ch.from, Math.min(ch.to, ch.from + 1)),
      });
      if (card) earDeck.push(card);
    });
  }

  // the neck itself: notes on each string (low ones first), thirds by shape, the chords' 3rds and 7ths.
  // Answered by playing, new prompts every visit, fast once known (the session times them).
  const fretDeck: Card[] = [];
  {
    const homeScale = makeScale(home.tonic, home.mode === "minor" ? "naturalMinor" : "major", home.tonicName);
    const name = (m: number) => spellIn(homeScale, m);
    const fretCard = (id: string, kind: Kind, prompts: Prompt[], text: Pick<Card, "title" | "detail" | "why" | "needs">, exact: boolean, steps?: PatternStep[]): Card | null => {
      if (prompts.length < 4) return null;
      const notes: LineNote[] = prompts.map((pr, k) => ({ midi: pr.midi, t: k, dur: 1 }));
      const slots = synthSlots(notes.length);
      return {
        ...base,
        ...text,
        id,
        family: "fretboard",
        kind,
        group: "Fretboard",
        where: positionText,
        fresh: true,
        pace: true,
        pass: 0.8,
        bpm: 60,
        goalBpm: 60,
        view: "prompts",
        tl: { slots, targets: toTargets({ slots }, notes), comp: [], total: slots.length * 4 },
        from: 0,
        to: slots.length - 1,
        first: 0,
        last: notes.length - 1,
        steps: steps ?? stepsFor(notes, w, 0),
        context: notes.map(() => ({ chord: null, scale: homeScale, next: null, roman: "" })),
        prompts,
        exact,
      };
    };
    let prev: string | undefined;
    for (const string of [5, 4, 3, 2, 1, 0]) {
      const id = `fb:string:${string}`;
      const prompts = stringPrompts(homeScale.pcs, string, MAX_FRET, name, rand(id));
      const steps = prompts.map((pr, k) => ({ string, fret: pr.midi - OPEN_MIDI[string], pc: mod(pr.midi), midi: pr.midi, startBeat: k, durationBeats: 1 }));
      // the string is given, so the note counts in any octave: fret 1 or 13, and a low string's
      // octave the detector may hear on an acoustic, are the same answer
      const card = fretCard(id, "onstring", prompts, { title: `Notes on the ${STRING_NAMES[string]} string`, detail: "Each note where it lives on this string, as soon as you find it.", why: "Knowing where every note is turns shapes into choices.", needs: prev }, false, steps);
      if (card) {
        fretDeck.push(card);
        prev = id;
      }
    }
    const placeIn = (m: number) => fingerLine([m], w)[0] ?? null;
    const thirds = fretCard("fb:thirds", "shape3", thirdPrompts(homeScale.pcs, w.low, w.high, placeIn, name, rand("fb:thirds")), { title: "Thirds by shape", detail: "From the note shown, the scale's 3rd above it, in the position.", why: "Every arpeggio and every chord is stacked thirds: their shapes, everywhere in the position.", needs: "fb:string:4" }, true);
    if (thirds) fretDeck.push(thirds);
    const tones = fretCard("fb:tones", "tones", tonePrompts(allSpans.map((x) => x.chord), w.low + 7, rand("fb:tones")), { title: "3rds and 7ths of the changes", detail: "The 3rd or the 7th of each chord, any octave.", why: "The guide tones on their own: the notes that say which chord it is.", needs: "fb:thirds" }, false);
    if (tones) fretDeck.push(tones);
  }

  // introduction order: a scale card, two melody cards, a harmony card, something to read, round and round;
  // harmony follows the tune, a cadence joining the queue where it first turns up
  const harmonyQueue: Card[] = [];
  const queued = new Set<string>();
  for (const ch of sectionChunks) {
    const cards = sectionCards.get(ch.key) ?? [];
    const cads = harmony.cadences.filter((c) => !queued.has(c.id) && (cadenceAt.get(c.id) ?? -1) >= ch.from && (cadenceAt.get(c.id) ?? -1) <= ch.to);
    const byKind = (k: Kind) => cards.filter((c) => c.kind === k);
    // small to big: the section's cadences on their own, then the whole section
    for (const c of cads) {
      queued.add(c.id);
      harmonyQueue.push(...(cadenceCards.get(c.id) ?? []).filter((x) => x.kind !== "voicings" && x.kind !== "comping"));
    }
    harmonyQueue.push(...byKind("arps"), ...byKind("guides"));
    for (const c of cads) harmonyQueue.push(...(cadenceCards.get(c.id) ?? []).filter((x) => x.kind === "voicings"));
    harmonyQueue.push(...byKind("voicings"));
    for (const c of cads) harmonyQueue.push(...(cadenceCards.get(c.id) ?? []).filter((x) => x.kind === "comping"));
    harmonyQueue.push(...byKind("comping"), ...byKind("chain"), ...byKind("improv"));
  }
  for (const c of harmony.cadences) if (!queued.has(c.id)) harmonyQueue.push(...(cadenceCards.get(c.id) ?? []));

  // holistic mechanics & technique: spiders, rhythm pyramid, string skipping, shifting, enclosures.
  // Shared globally across all tunes in `guitar-skills` via `tech:*` IDs. Each one lives in the key
  // it hangs from on Home's tree, not in this tune's key: whichever deck builds it, it is the same
  // music, and rotating it into a session takes the player through keys their tunes rarely visit,
  // in that key's position, with the arpeggio drills walking its I–IV–V–I.
  const mechanics: Card[] = [];
  for (const track of TECHNIQUE_TRACKS) {
    const anchor = foundationKey(track);
    const keyScale = anchor.scale;
    const mw = chooseWindow(anchor.tonic);
    const cadence = cadenceChords(keyScale, anchor.minor);
    const romans = cadenceRomans(anchor.minor);
    const tonicChord = cadence[0];
    const mechPos = Math.max(1, Math.min(MAX_FRET - 3, mw.p));
    let rawNotes: TechniqueNote[] = [];
    let harmonic = true;
    let beatsPerChord = 0; // 0: the tonic held throughout
    if (track.kind === "spider") {
      const pat = track.id.split(":")[2] as SpiderPattern;
      rawNotes = spiderLine(pat, mechPos);
      harmonic = false; // chromatic drill: keep backing clean (click + pulse only)
    } else if (track.kind === "skip") {
      rawNotes = skipLine(track.id.endsWith(":octave") ? "octave" : "adjacent", keyScale, mw);
    } else if (track.kind === "pyramid") {
      rawNotes = pyramidLine(keyScale, mw, cadence);
      beatsPerChord = 4;
    } else if (track.kind === "shift") {
      rawNotes = shiftLine(keyScale, mw);
    } else if (track.kind === "enclose") {
      rawNotes = enclosureLine(keyScale, tonicChord, mw, cadence);
      beatsPerChord = 2;
    }
    if (!rawNotes.length) continue;
    const total = rawNotes[rawNotes.length - 1].t + rawNotes[rawNotes.length - 1].dur;
    const slots = synthSlots(total);
    const spans: Span[] = beatsPerChord
      ? cadence.map((chord, i) => ({ chord, t: i * beatsPerChord, dur: i === cadence.length - 1 ? slots.length * 4 - i * beatsPerChord : beatsPerChord }))
      : [{ chord: tonicChord, t: 0, dur: slots.length * 4 }];
    const timeline: Timeline = {
      slots,
      targets: toTargets({ slots }, rawNotes),
      comp: harmonic ? padHits(spans) : [],
      bass: harmonic ? bassLine(spans) : undefined,
      total: slots.length * 4,
    };
    const contextAt = (t: number): Context => {
      const i = beatsPerChord ? Math.min(cadence.length - 1, Math.floor(t / beatsPerChord + 1e-6)) : 0;
      return { chord: harmonic ? cadence[i] : null, scale: keyScale, next: harmonic && beatsPerChord ? cadence[i + 1] ?? null : null, roman: romans[i] };
    };
    const lowFret = track.kind === "shift" ? Math.max(1, Math.min(MAX_FRET - 5, mw.p)) : mechPos;
    const highFret = track.kind === "shift" ? Math.min(MAX_FRET, lowFret + 5) : mechPos + 3;
    mechanics.push({
      ...base,
      id: track.id,
      p: mechPos,
      family: "technique",
      kind: track.kind,
      needs: track.needs,
      group: "Foundations",
      title: track.title,
      detail: track.detail,
      why: track.why,
      insight: track.insight,
      where: `${keyScale.name} · frets ${lowFret}–${highFret}`,
      bpm: track.bpm,
      goalBpm: track.goalBpm,
      pass: 0.85,
      click: true,
      tl: timeline,
      from: 0,
      to: slots.length - 1,
      first: 0,
      last: rawNotes.length - 1,
      steps: techniqueSteps(rawNotes, mw),
      context: rawNotes.map((n) => contextAt(n.t)),
    });
  }

  const streams = [technique, melodyCards, melodyCards, harmonyQueue, reading, earDeck, fretDeck, mechanics];
  const pos = streams.map(() => 0);
  const intro: string[] = [];
  const cards: Card[] = [];
  const taken = new Set<string>();
  const add = (c: Card) => {
    if (taken.has(c.id)) return;
    taken.add(c.id);
    cards.push(c);
    intro.push(c.id);
  };
  let melodyAt = 0;
  for (let round = 0; intro.length < technique.length + melodyCards.length + harmonyQueue.length + reading.length + earDeck.length + fretDeck.length + mechanics.length && round < 1000; round++) {
    streams.forEach((stream, si) => {
      if (stream === melodyCards) {
        if (melodyAt < melodyCards.length) add(melodyCards[melodyAt++]);
        return;
      }
      while (pos[si] < stream.length && taken.has(stream[pos[si]].id)) pos[si]++;
      if (pos[si] < stream.length) add(stream[pos[si]++]);
    });
  }

  const passage = parsePassageId(opts.passageFrom);
  if (passage && validPassage(tl, passage) && passageId(sheet, passage) === opts.passageFrom) {
    const source = melodyCards.find((card) => card.step?.kind === "tune") ?? melodyCards[0];
    const selected = passageTimeline(sheet, melodyTl, passage);
    const fromBar = tl.slots[passage.start].bar;
    const toBar = tl.slots[passage.end].bar;
    const printed = (bar: number) => sheet.barNumbers[bar] ?? String(bar + 1);
    const straight = tl.slots.slice(passage.start, passage.end + 1).every((slot, index) => slot.bar === fromBar + index);
    const title = passage.start === passage.end ? `Bar ${printed(fromBar)}` : straight ? `Bars ${printed(fromBar)}–${printed(toBar)}` : `Bar ${printed(fromBar)} → bar ${printed(toBar)}`;
    const first = selected.targets.findIndex((target) => target.slot >= passage.start && target.slot <= passage.end);
    let last = -1;
    selected.targets.forEach((target, index) => { if (target.slot >= passage.start && target.slot <= passage.end) last = index; });
    if (source && first >= 0 && last >= first) cards.push({
      ...source, id: opts.passageFrom!, title: `${title} · playing order ${passage.start + 1}${passage.end === passage.start ? "" : `–${passage.end + 1}`}`, where: passageLabel(sheet, tl, passage),
      detail: "Your selected bars, at your own pace and then in time.",
      why: "Keep this exact passage together, including its rests and returns.",
      from: passage.start, to: passage.end, first, last, tl: selected,
      step: undefined, needs: undefined, memory: false, run: false, listen: false, pace: true,
      context: selected.targets.map((target) => {
        const span = allSpans.find((item) => target.t >= item.t - 1e-6 && target.t < item.t + item.dur - 1e-6);
        return span ? { chord: span.chord, scale: span.scale, next: span.next, roman: span.roman } : null;
      }),
    });
  }

  if (opts.rhythmFrom) {
    const source = cards.find((card) => card.id === opts.rhythmFrom);
    if (source) for (const study of rhythmStudy(source, w)) add(study);
  }
  return { cards, harmony, window: w, intro };
}

/** Decode only the explicit rhythm route; ordinary melody launches keep the normal deck. */
export function rhythmSourceId(id: string | undefined): string | undefined {
  const prefix = id?.startsWith("rhythm-context:") ? "rhythm-context:" : id?.startsWith("rhythm:") ? "rhythm:" : null;
  return prefix ? id!.slice(prefix.length) || undefined : undefined;
}

/** A selected phrase's rhythm first, then the same attacks on the original pitches with the band. */
export function rhythmStudy(source: Card, w: Window = windowAt(source.p)): [Card, Card] | [] {
  if (source.family !== "melody" || source.view !== "score" || source.rhythmPitch !== undefined || source.last < source.first) return [];
  const natural = new Set([0, 2, 4, 5, 7, 9, 11]);
  const comfortable = [2, 3].flatMap((string) => Array.from({ length: 4 }, (_, fret) => ({ string, fret: w.p + fret, midi: OPEN_MIDI[string] + w.p + fret })))
    .filter((note) => natural.has(mod(note.midi)))
    .sort((a, b) => Math.abs(a.midi - 60) - Math.abs(b.midi - 60) || a.fret - b.fret)[0];
  if (!comfortable) return [];
  const isolatedId = `rhythm:${source.id}`;
  const contextId = `rhythm-context:${source.id}`;
  const midi = comfortable.midi;
  const name = `${nice(pitchClassToName(midi))}${Math.floor(midi / 12) - 1}`;
  const isolated: Card = {
    ...source,
    id: isolatedId,
    title: `${source.where} · rhythm on ${name}`,
    detail: `The phrase's attacks, rests and ties on ${name}. Pick again only at each new note.`,
    why: "One note leaves the picking hand and the space between attacks in focus; the original pitches follow.",
    tl: isolateRhythm(source.tl, midi),
    rhythmPitch: midi,
    followedBy: contextId,
    needs: undefined,
    step: undefined,
    run: false,
    memory: false,
    pace: false,
    listen: true,
    click: true,
    exact: true,
    steps: source.tl.targets.map((target) => ({ ...comfortable, pc: mod(midi), startBeat: target.t - source.tl.slots[source.from].start, durationBeats: target.dur })),
    context: source.tl.targets.map(() => null),
    voicings: [],
  };
  const context: Card = {
    ...source,
    id: contextId,
    title: `${source.where} · original pitches`,
    detail: "The same rhythm, now with the phrase's original pitches and accompaniment.",
    why: "The isolated picking pattern returns to the tune immediately.",
    needs: isolatedId,
    followedBy: undefined,
    run: false,
    memory: false,
    listen: false,
    click: true,
  };
  return [isolated, context];
}

function cadenceSpans(cad: Cadence): Spanned[] {
  const [a, b, c] = cad.chords;
  const minor = cad.key.mode === "minor";
  const home = makeScale(cad.key.tonic, minor ? "harmonicMinor" : "major", cad.key.tonicName);
  const scaleOf = (ch: Chord) => {
    if (ch.pcs.every((pc) => home.pcs.includes(pc))) return home;
    const nat = makeScale(cad.key.tonic, "naturalMinor", cad.key.tonicName);
    if (ch.pcs.every((pc) => nat.pcs.includes(pc))) return nat;
    return makeScale(cad.key.tonic, "melodicMinor", cad.key.tonicName);
  };
  // two bars a chord in a V–I: a line plays its bar, then rests on the root, so each change has room to be heard
  const seq: [Chord, number][] = cad.form === "ii-V-I" ? [[a, 4], [b, 4], [c, 8]] : [[a, 8], [b, 8]];
  let t = 0;
  return seq.map(([chord, dur], i) => {
    const s: Spanned = { chord, t, dur, scale: scaleOf(chord), next: seq[(i + 1) % seq.length][0], roman: romanOf(chord, cad.key.tonic) };
    t += dur;
    return s;
  });
}

/** Spelled name of a target's note, in the harmony under it. */
export function noteName(card: Card, i: number): string {
  const midi = card.tl.targets[i]?.midi ?? 0;
  const ctx = card.context[i];
  return ctx ? spellIn(ctx.scale, midi) : nice(["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][mod(midi)]);
}

/**
 * One deck out of several tunes', for a session that mixes them. `main` keeps its ids; the others'
 * exercises carry their tune in front (ids.ts). A scale both tunes ask for is one exercise. New
 * exercises are introduced in turn: one from each tune, round and round.
 */
export function mixDecks(main: Deck, others: { tuneId: string; deck: Deck }[]): Deck {
  if (!others.length) return main;
  const have = new Set(main.cards.map((c) => c.id));
  const cards = [...main.cards];
  const lanes: string[][] = [main.intro];
  for (const { tuneId, deck } of others) {
    const lane: string[] = [];
    for (const c of deck.cards) {
      const id = glue(tuneId, c.id);
      lane.push(id);
      if (have.has(id)) continue;
      have.add(id);
      cards.push({ ...c, id, needs: c.needs ? glue(tuneId, c.needs) : undefined, followedBy: c.followedBy ? glue(tuneId, c.followedBy) : undefined });
    }
    const at = new Map(deck.intro.map((id, i) => [glue(tuneId, id), i]));
    lanes.push(lane.sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0)));
  }
  const intro: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; lanes.some((l) => i < l.length); i++)
    for (const l of lanes)
      if (i < l.length && !seen.has(l[i])) {
        seen.add(l[i]);
        intro.push(l[i]);
      }
  return { ...main, cards, intro };
}

/** Tutor modes that run a narrowed deck: the families each one works on. */
export type Focus = "all" | "changes" | "scales" | "reading" | "ear" | "technique";
export const FOCUS_FAMILIES: Record<Exclude<Focus, "all">, Family[]> = {
  changes: ["chords", "harmony"],
  scales: ["scales", "fretboard"],
  reading: ["reading"],
  ear: ["ear"],
  technique: ["technique"],
};
export const FOCUS_LABEL: Record<Exclude<Focus, "all">, string> = { changes: "Changes", scales: "Scales", reading: "Reading", ear: "Ear", technique: "Technique" };

/** The whole-tune melody card (or run-through fallback) so a player can jump straight into playing the song. */
export function wholeTuneCard(deck: Deck): Card | undefined {
  return deck.cards.find((c) => c.step?.kind === "tune") ?? deck.cards.find((c) => c.run);
}

/**
 * The same deck narrowed to some families, for a focused session (Changes uses `chords` and
 * `harmony`). Cards whose `needs` card was removed lose that dependency: the focused deck is not a
 * curriculum that can be permanently locked behind material it does not show.
 */
export function familiesOnly(deck: Deck, families: Family[]): Deck {
  const keep = new Set(families);
  const cards = deck.cards.filter((card) => keep.has(card.family));
  const ids = new Set(cards.map((card) => card.id));
  return {
    ...deck,
    cards: cards.map((card) => (card.needs && !ids.has(card.needs) ? { ...card, needs: undefined } : card)),
    intro: deck.intro.filter((id) => ids.has(id)),
  };
}

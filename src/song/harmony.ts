import { mod } from "../musicTheory";
import type { LeadSheet } from "../tunes/musicxml";
import type { Timeline } from "../tunes/order";

// What a tune is made of, harmonically: its chords in playing order, the key centres they group
// into, the parent scale that fits each chord, and the cadences (ii–V–I, V–I) worth drilling.
//
// Key centres come from a Viterbi pass over the chords: staying in a key is free, a chord that
// belongs to the key costs nothing, a secondary dominant (or its ii) costs a little, any other
// chord costs more, and changing key costs most. So a one-chord excursion stays in the key and
// a whole section in a new key becomes its own centre.

// ---------- chords ----------

export type ChordKind = "maj" | "min" | "dom" | "hdim" | "dim" | "aug" | "sus";

export interface Chord {
  symbol: string;
  root: number;
  rootName: string; // as written: "Db"
  bass: number | null; // slash bass
  kind: ChordKind;
  third: number | null; // semitones above the root (2/4 for sus chords)
  fifth: number;
  seventh: number | null; // 9 for 6th and dim7 chords
  tones: number[]; // semitones above the root: 1, 3, 5, (7)
  pcs: number[]; // the chord's pitch classes, root first
  required: number[]; // pitch classes that must ring for the chord to count
  clash: number[]; // pitch classes that would make it a different chord
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function normalize(q: string): string {
  return q
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .replace(/^-(?=\d|$)/, "m")
    .replace(/^min/, "m")
    .replace(/^mi(?=\d|$)/, "m")
    .replace(/^Maj/, "maj")
    .replace(/^M(?=7|9|11|13)/, "maj")
    .replace(/add\d+/g, "")
    .replace(/Δ/g, "maj7")
    .replace(/maj77/, "maj7")
    .replace(/ø7?/, "m7b5")
    .replace(/°7/, "dim7")
    .replace(/°/, "dim")
    .replace(/^o7/, "dim7")
    .replace(/[()]/g, "");
}

export function parseChord(symbol: string): Chord | null {
  const m = /^([A-G])([b#♭♯]?)(.*)$/.exec(symbol.trim());
  if (!m) return null;
  const acc = m[2] === "b" || m[2] === "♭" ? -1 : m[2] ? 1 : 0;
  const root = mod(LETTER_PC[m[1]] + acc);
  const [qRaw, bassRaw] = m[3].split("/");
  const q = normalize(qRaw ?? "");
  if (/^N\.?C/i.test(symbol)) return null;
  let bass: number | null = null;
  const bm = bassRaw ? /^([A-G])([b#♭♯]?)/.exec(bassRaw) : null;
  if (bm) bass = mod(LETTER_PC[bm[1]] + (bm[2] === "b" || bm[2] === "♭" ? -1 : bm[2] ? 1 : 0));

  const hdim = /^m7b5|^m9b5|^m11b5/.test(q);
  const dim = !hdim && /^dim/.test(q);
  const minor = !hdim && !dim && /^m(?!aj)/.test(q);
  const maj7 = /maj(7|9|11|13)/.test(q);
  const aug = /^(\+|aug)/.test(q) || /#5|\+5/.test(q);
  const sus4 = /sus4?(?!2)/.test(q);
  const sus2 = /sus2/.test(q);
  const six = /(^|m)6/.test(q) || /^69/.test(q);
  const ext = /(7|9|11|13)/.test(q.replace(/maj(7|9|11|13)/, "").replace(/b5|#5|b9|#9|#11|b13|6/g, ""));
  const alt = /alt/.test(q);

  const third = sus4 ? 5 : sus2 ? 2 : minor || hdim || dim ? 3 : 4;
  const fifth = hdim || dim || /b5/.test(q) ? 6 : aug ? 8 : 7;
  let seventh: number | null = null;
  if (dim && /dim7/.test(q)) seventh = 9;
  else if (hdim) seventh = 10;
  else if (maj7) seventh = 11;
  else if (six) seventh = 9;
  else if (ext || alt) seventh = 10;

  let kind: ChordKind;
  if (hdim) kind = "hdim";
  else if (dim) kind = "dim";
  else if (minor) kind = "min";
  else if (seventh === 10) kind = "dom";
  else if (sus4 || sus2) kind = "sus";
  else if (aug) kind = "aug";
  else kind = "maj";

  const tones = [0, third, fifth, ...(seventh !== null ? [seventh] : [])];
  const pcs = tones.map((t) => mod(root + t));
  const required = [0, third, ...(seventh !== null ? [seventh] : []), ...(fifth !== 7 ? [fifth] : [])].map((t) => mod(root + t));
  const clashIv: number[] = [];
  if (third === 3) clashIv.push(4);
  else if (third === 4 && !/#9|alt/.test(q)) clashIv.push(3);
  if (seventh === 10) clashIv.push(11);
  if (seventh === 11) clashIv.push(10);
  if (fifth === 6 && kind === "hdim") clashIv.push(7);
  const clash = clashIv.map((t) => mod(root + t)).filter((pc) => !pcs.includes(pc));

  return { symbol, root, rootName: m[1] + (m[2] === "♭" ? "b" : m[2] === "♯" ? "#" : m[2]), bass, kind, third, fifth, seventh, tones, pcs, required, clash };
}

export const isDominant = (c: Chord) => c.kind === "dom" || (c.kind === "sus" && c.seventh === 10) || (c.kind === "aug" && c.seventh === 10);
export const isMinorType = (c: Chord) => c.kind === "min";
/** Can close a cadence: a major or minor chord that isn't a dominant. */
const isResolution = (c: Chord) => c.kind === "maj" || c.kind === "min";

/** "B♭m7♭5", "D♭Δ7": the symbol as it reads on a chart. */
export function pretty(symbol: string): string {
  return symbol
    .replace(/maj7/g, "Δ7")
    .replace(/(^|\/)([A-G])b/g, "$1$2♭")
    .replace(/(^|\/)([A-G])#/g, "$1$2♯")
    .replace(/b(\d)/g, "♭$1")
    .replace(/#(\d)/g, "♯$1");
}

// ---------- scales and keys ----------

export type ScaleKind = "major" | "naturalMinor" | "harmonicMinor" | "melodicMinor";
const STEPS: Record<ScaleKind, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
};
const KIND_NAME: Record<ScaleKind, string> = {
  major: "major",
  naturalMinor: "natural minor",
  harmonicMinor: "harmonic minor",
  melodicMinor: "melodic minor",
};

export interface Scale {
  root: number;
  kind: ScaleKind;
  pcs: number[]; // degrees 1..7
  names: string[]; // spelled degrees: "D E F G A B♭ C♯"
  name: string; // "D harmonic minor"
  id: string; // "D-harmonicMinor"
}

export type Mode = "major" | "minor";
export interface Key {
  tonic: number;
  mode: Mode;
  tonicName: string;
  name: string; // "D minor"
  id: string; // "D-minor"
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_TONIC = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_TONIC = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

/** Display form of a note name: "B♭", "C♯". */
export const nice = (name: string) => name.replace(/^([A-G])(b*)(#*)/, (_, l: string, f: string, sh: string) => l + "♭".repeat(f.length) + "♯".repeat(sh.length));

function spellOn(letterIdx: number, pc: number): string {
  const li = ((letterIdx % 7) + 7) % 7;
  const d = mod(pc - LETTER_PCS[li] + 6) - 6;
  return LETTERS[li] + (d > 0 ? "#".repeat(d) : "b".repeat(-d));
}

export function makeScale(root: number, kind: ScaleKind, rootName?: string): Scale {
  const name0 = rootName ?? (kind === "major" ? MAJOR_TONIC : MINOR_TONIC)[root];
  const letter = LETTERS.indexOf(name0[0]);
  const pcs = STEPS[kind].map((s) => mod(root + s));
  const names = pcs.map((pc, i) => nice(spellOn(letter + i, pc)));
  return { root, kind, pcs, names, name: `${names[0]} ${KIND_NAME[kind]}`, id: `${name0}-${kind}` };
}

export function makeKey(tonic: number, mode: Mode, tonicName?: string): Key {
  const n = tonicName ?? (mode === "major" ? MAJOR_TONIC : MINOR_TONIC)[tonic];
  return { tonic, mode, tonicName: n, name: `${nice(n)} ${mode}`, id: `${n}-${mode}` };
}

/** Every pitch class a key's chords may use: the major scale, or minor with both 6ths and 7ths. */
function pool(k: { tonic: number; mode: Mode }): number[] {
  const ivs = k.mode === "major" ? STEPS.major : [0, 2, 3, 5, 7, 8, 9, 10, 11];
  return ivs.map((i) => mod(k.tonic + i));
}

/** Spelled name of any pitch class in the context of a scale. */
export function spellIn(scale: Scale, pc: number, flats = false): string {
  const i = scale.pcs.indexOf(mod(pc));
  if (i >= 0) return scale.names[i];
  const flatKey = scale.names.some((n) => n.includes("♭")) || flats;
  return nice((flatKey ? MAJOR_TONIC : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])[mod(pc)]);
}

// ---------- the tune ----------

export interface ChordEvent {
  chord: Chord;
  t: number; // beats from the top, playing order
  dur: number;
  slot: number; // slot it starts in
  bar: number; // printed bar
  key: Key;
  scale: Scale; // parent scale for this chord
  roman: string; // "ii7", "V7/iv"
  secondary: string | null; // "V7 of Gm": a borrowed dominant
}

export interface KeyCentre {
  key: Key;
  beats: number;
  scales: { scale: Scale; beats: number; chords: string[] }[]; // parent scales used, most used first
  first: number; // first event index
}

export interface Cadence {
  id: string; // "F-major-iiVI"
  key: Key;
  form: "ii-V-I" | "V-I";
  chords: Chord[]; // as first played in full
  where: number[]; // event index of each occurrence's first chord
  label: string; // "ii–V–I in F major"
}

export interface Harmony {
  events: ChordEvent[];
  centres: KeyCentre[];
  home: Key;
  cadences: Cadence[];
}

/** Chords in playing order; a bar without symbols carries the last chord on. */
function chordTimeline(sheet: LeadSheet, tl: Timeline): Omit<ChordEvent, "key" | "scale" | "roman" | "secondary">[] {
  const raw: { chord: Chord; t: number; slot: number; bar: number }[] = [];
  tl.slots.forEach((slot, si) => {
    const bar = sheet.bars[slot.bar];
    bar.chordSymbols.forEach((sym, ci) => {
      const chord = parseChord(sym);
      if (!chord) return;
      raw.push({ chord, t: slot.start + (bar.chordBeats?.[ci] ?? (ci * slot.beats) / bar.chordSymbols.length), slot: si, bar: slot.bar });
    });
  });
  raw.sort((a, b) => a.t - b.t);
  const merged: typeof raw = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && last.chord.symbol === r.chord.symbol) continue;
    if (last && Math.abs(last.t - r.t) < 1e-6) merged.pop();
    merged.push(r);
  }
  return merged.map((r, i) => ({ ...r, dur: (merged[i + 1]?.t ?? tl.total) - r.t }));
}

const KEYS: { tonic: number; mode: Mode }[] = [];
for (let pc = 0; pc < 12; pc++) KEYS.push({ tonic: pc, mode: "major" }, { tonic: pc, mode: "minor" });

const CHANGE_COST = 2.5;
const CHROMATIC_COST = 1.6;
const SECONDARY_COST = 0.3;
const SECONDARY_II_COST = 0.6;
const TONIC_BONUS = 0.4;
const RESOLVED_BONUS = 1; // a tonic its own dominant resolves to: relative keys (D♭ major / B♭ minor) part here
const OFF_SIGNATURE_COST = 1.2;

function signatureKeys(spec: string): Set<string> {
  const m = /^([A-G][b#]?)(m?)$/.exec(spec);
  if (!m) return new Set();
  const pc = mod(LETTER_PC[m[1][0]] + (m[1][1] === "b" ? -1 : m[1][1] === "#" ? 1 : 0));
  const major = m[2] ? mod(pc + 3) : pc;
  return new Set([`${major}-major`, `${mod(major - 3)}-minor`]);
}

/** The most common spelling of each pitch class among the tune's chord roots. */
function rootSpellings(events: { chord: Chord }[]): Map<number, string> {
  const counts = new Map<number, Map<string, number>>();
  for (const e of events) {
    const m = counts.get(e.chord.root) ?? new Map<string, number>();
    m.set(e.chord.rootName, (m.get(e.chord.rootName) ?? 0) + 1);
    counts.set(e.chord.root, m);
  }
  const out = new Map<number, string>();
  counts.forEach((m, pc) => out.set(pc, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]));
  return out;
}

const MAJOR_OK = new Set(["C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb"]);
const MINOR_OK = new Set(["A", "E", "B", "F#", "C#", "G#", "D#", "D", "G", "C", "F", "Bb", "Eb", "Ab"]);

/** The key's name as the tune spells that root, when that is a key anyone writes in. */
function tonicSpelling(pc: number, mode: Mode, spellings: Map<number, string>): string {
  const seen = spellings.get(pc);
  return seen && (mode === "major" ? MAJOR_OK : MINOR_OK).has(seen) ? seen : (mode === "major" ? MAJOR_TONIC : MINOR_TONIC)[pc];
}

export function analyze(sheet: LeadSheet, tl: Timeline): Harmony {
  const base = chordTimeline(sheet, tl);
  const spellings = rootSpellings(base);
  const n = base.length;
  if (!n) {
    const home = makeKey(0, "major");
    return { events: [], centres: [], home, cadences: [] };
  }

  // per key: which chords belong, which are secondary dominants (chains resolve back to front)
  const diatonic = KEYS.map((k) => {
    const p = pool(k);
    return base.map((e) => e.chord.pcs.every((pc) => p.includes(pc)));
  });
  const secondary = KEYS.map((_, ki) => {
    const out = base.map(() => false);
    for (let i = n - 2; i >= 0; i--) {
      const c = base[i].chord;
      const next = base[i + 1].chord;
      if (isDominant(c) && mod(next.root - c.root) === 5 && (diatonic[ki][i + 1] || out[i + 1])) out[i] = true;
    }
    return out;
  });
  const emission = (ki: number, i: number) => {
    const k = KEYS[ki];
    const c = base[i].chord;
    const w = Math.min(2, Math.max(0.5, base[i].dur / 4));
    if (diatonic[ki][i]) {
      const tonic = c.root === k.tonic && ((k.mode === "major" && c.kind === "maj") || (k.mode === "minor" && c.kind === "min"));
      if (!tonic) return 0;
      const prev = base[i - 1]?.chord;
      const resolved = prev && isDominant(prev) && mod(c.root - prev.root) === 5;
      return -(TONIC_BONUS + (resolved ? RESOLVED_BONUS : 0)) * w;
    }
    if (secondary[ki][i]) return SECONDARY_COST * w;
    const next = base[i + 1]?.chord;
    if ((c.kind === "min" || c.kind === "hdim") && next && secondary[ki][i + 1] && mod(next.root - c.root) === 5) return SECONDARY_II_COST * w;
    return CHROMATIC_COST * w;
  };

  const sig = signatureKeys(sheet.keySignature);
  let cost = KEYS.map((k, ki) => (sig.has(`${k.tonic}-${k.mode}`) ? 0 : OFF_SIGNATURE_COST) + emission(ki, 0));
  const back: number[][] = [];
  for (let i = 1; i < n; i++) {
    const prev = cost;
    const from: number[] = [];
    cost = KEYS.map((_, ki) => {
      let best = prev[ki];
      let arg = ki;
      prev.forEach((c, kj) => {
        if (c + CHANGE_COST < best) {
          best = c + CHANGE_COST;
          arg = kj;
        }
      });
      from.push(arg);
      return best + emission(ki, i);
    });
    back.push(from);
  }
  const path: number[] = Array(n);
  path[n - 1] = cost.indexOf(Math.min(...cost));
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i - 1][path[i]];

  const keyOf = new Map<number, Key>();
  const keyFor = (ki: number) => {
    let k = keyOf.get(ki);
    if (!k) {
      const { tonic, mode } = KEYS[ki];
      k = makeKey(tonic, mode, tonicSpelling(tonic, mode, spellings));
      keyOf.set(ki, k);
    }
    return k;
  };

  const events: ChordEvent[] = base.map((e, i) => {
    const key = keyFor(path[i]);
    const { scale, secondary: sec } = scaleFor(e.chord, base[i + 1]?.chord, key, spellings);
    let roman = romanOf(e.chord, key.tonic);
    if (sec && base[i + 1]) roman = `V7/${romanOf(base[i + 1].chord, key.tonic, false)}`;
    return { ...e, key, scale, roman, secondary: sec };
  });

  // key centres, in order of appearance
  const centres: KeyCentre[] = [];
  events.forEach((e, i) => {
    let c = centres.find((x) => x.key.id === e.key.id);
    if (!c) centres.push((c = { key: e.key, beats: 0, scales: [], first: i }));
    c.beats += e.dur;
    if (e.secondary) return; // a borrowed dominant's scale belongs to the chord, not the key
    let s = c.scales.find((x) => x.scale.id === e.scale.id);
    if (!s) c.scales.push((s = { scale: e.scale, beats: 0, chords: [] }));
    s.beats += e.dur;
    if (!s.chords.includes(e.chord.symbol)) s.chords.push(e.chord.symbol);
  });
  for (const c of centres) {
    const primary = c.key.mode === "major" ? "major" : "naturalMinor";
    const rank = (x: KeyCentre["scales"][number]) => (x.scale.kind === primary && x.scale.root === c.key.tonic ? 0 : 1);
    c.scales.sort((a, b) => rank(a) - rank(b) || b.beats - a.beats);
  }
  const home = [...centres].sort((a, b) => b.beats - a.beats)[0].key;

  return { events, centres, home, cadences: findCadences(events, spellings) };
}

// Accidentals relative to the major scale on the tonic, the usual jazz convention.
const DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♭V", "V", "♭VI", "VI", "♭VII", "VII"];

/** "ii7", "V7", "♭VIΔ7", "iiø7" (slash basses left out). */
export function romanOf(c: Chord, tonic: number, quality = true): string {
  const deg = DEGREES[mod(c.root - tonic)];
  const lower = c.kind === "min" || c.kind === "hdim" || c.kind === "dim";
  const numeral = lower ? deg.replace(/[IV]+/, (x) => x.toLowerCase()) : deg;
  if (!quality) return numeral;
  const q =
    c.kind === "hdim" ? "ø7"
    : c.kind === "dim" ? (c.seventh ? "°7" : "°")
    : c.kind === "aug" ? "+"
    : c.kind === "sus" ? "sus"
    : c.seventh === 11 ? "Δ7"
    : c.seventh === 10 ? "7"
    : c.seventh === 9 ? "6"
    : "";
  return numeral + q;
}

function fits(chord: Chord, scale: Scale) {
  return chord.pcs.every((pc) => scale.pcs.includes(pc));
}

/** The parent scale for a chord inside a key, and whether it is a borrowed (secondary) dominant. */
function scaleFor(chord: Chord, next: Chord | undefined, key: Key, spellings: Map<number, string>): { scale: Scale; secondary: string | null } {
  const name = (pc: number, mode: Mode) => tonicSpelling(pc, mode, spellings);
  const primary = makeScale(key.tonic, key.mode === "major" ? "major" : "naturalMinor", key.tonicName);
  // a dominant resolving down a fifth takes the scale of where it is going: the key's own V7
  // (A7 → Dm in D minor: D harmonic minor), or a borrowed one (D7 → Gm: G harmonic minor)
  if (isDominant(chord) && next && mod(next.root - chord.root) === 5) {
    const minorTarget = isMinorType(next) || next.kind === "hdim";
    const target = makeScale(next.root, minorTarget ? "harmonicMinor" : "major", name(next.root, minorTarget ? "minor" : "major"));
    if (next.root === key.tonic && fits(chord, target)) return { scale: target, secondary: null };
    if (fits(chord, primary)) return { scale: primary, secondary: null };
    if (fits(chord, target)) return { scale: target, secondary: `V7 of ${pretty(next.symbol)}` };
  }
  if (fits(chord, primary)) return { scale: primary, secondary: null };
  if (key.mode === "minor") {
    for (const kind of ["harmonicMinor", "melodicMinor"] as const) {
      const s = makeScale(key.tonic, kind, key.tonicName);
      if (fits(chord, s)) return { scale: s, secondary: null };
    }
  }
  // anything else: the scale holding the chord that shares most notes with the key
  const keyPcs = pool(key);
  let best: { s: Scale; score: number } | null = null;
  for (let r = 0; r < 12; r++)
    for (const kind of ["major", "harmonicMinor", "melodicMinor"] as const) {
      const s = makeScale(r, kind, name(r, kind === "major" ? "major" : "minor"));
      if (!fits(chord, s)) continue;
      const score = s.pcs.filter((pc) => keyPcs.includes(pc)).length + (r === chord.root ? 0.5 : 0) + (kind === "major" ? 0.2 : 0);
      if (!best || score > best.score) best = { s, score };
    }
  return { scale: best?.s ?? primary, secondary: null };
}

function findCadences(events: ChordEvent[], spellings: Map<number, string>): Cadence[] {
  const found = new Map<string, Cadence & { count: number; firstAt: number }>();
  for (let i = 0; i + 1 < events.length; i++) {
    const v = events[i].chord;
    const target = events[i + 1].chord;
    if (!isDominant(v) || mod(target.root - v.root) !== 5 || !isResolution(target)) continue;
    const ii = events[i - 1]?.chord;
    const hasII = Boolean(ii && (ii.kind === "min" || ii.kind === "hdim") && mod(v.root - ii.root) === 5);
    const mode: Mode = isMinorType(target) ? "minor" : "major";
    const key = makeKey(target.root, mode, tonicSpelling(target.root, mode, spellings));
    const id = `${key.id}`;
    const at = hasII ? i - 1 : i;
    const chords = hasII ? [ii!, v, target] : [v, target];
    const hit = found.get(id);
    if (!hit) {
      found.set(id, { id, key, form: hasII ? "ii-V-I" : "V-I", chords, where: [at], label: "", count: 1, firstAt: at });
    } else {
      hit.count++;
      hit.where.push(at);
      if (hasII && hit.form === "V-I") {
        hit.form = "ii-V-I";
        hit.chords = chords;
      }
    }
  }
  const out = [...found.values()]
    .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
    .slice(0, 4)
    .sort((a, b) => a.firstAt - b.firstAt);
  for (const c of out) {
    const minor = c.key.mode === "minor";
    const form = c.form === "ii-V-I" ? (minor ? "iiø–V–i" : "ii–V–I") : minor ? "V–i" : "V–I";
    c.label = `${form} in ${c.key.name}`;
  }
  return out.map(({ count: _c, firstAt: _f, ...c }) => c);
}

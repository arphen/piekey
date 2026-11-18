import { mod } from "../musicTheory";

/**
 * Functional ear training: every chord is a Roman numeral relative to "home",
 * so what you learn transfers to every key. Pure logic only — audio lives in ./engine.
 */

export type Quality = "maj" | "min" | "dim" | "dom7" | "maj7" | "min7" | "hdim7";
export type TrackId = "pop" | "jazz";
export type Mode = "major" | "minor";

export interface ChordSym {
  id: string;
  /** semitones above the tonic */
  degree: number;
  quality: Quality;
  /** one-line ear description, shown when the chord is introduced */
  hear: string;
  /** how common it is in real music (biases the generator) */
  weight: number;
  /** wants to resolve down a fifth (secondary dominants) */
  pulls?: boolean;
}

export const INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  hdim7: [0, 3, 6, 10],
};

const c = (id: string, degree: number, quality: Quality, weight: number, hear: string, pulls = false): ChordSym => ({
  id, degree, quality, weight, hear, pulls,
});

export const CHORDS: Record<string, ChordSym> = {
  // pop / rock triads
  I: c("I", 0, "maj", 3, "Home. Nothing wants to move."),
  IV: c("IV", 5, "maj", 2.5, "Lifts away from home, open and bright — the 'amen' chord. Bass jumps up a 4th."),
  V: c("V", 7, "maj", 2.5, "Tension that leans hard back to I. Bass up a 5th (or down a 4th)."),
  vi: c("vi", 9, "min", 2, "I's sad twin — shares two notes with I, but minor. Bass drops a minor 3rd."),
  ii: c("ii", 2, "min", 1.4, "Soft, minor, 'on the way' to V. Easy to confuse with IV: listen for the bass one step above home."),
  iii: c("iii", 4, "min", 0.8, "Hazy and unresolved; sits between I and vi. Bass a major 3rd up."),
  bVII: c("bVII", 10, "maj", 1.2, "Rock/Mixolydian swagger — a whole step below home. Classic I–bVII–IV."),
  iv: c("iv", 5, "min", 0.9, "IV turned minor: bittersweet, cinematic. Same bass as IV — listen to the colour."),
  II: c("II", 2, "maj", 0.9, "Bright surprise on 2 (V of V). Pushes strongly toward V.", true),
  III: c("III", 4, "maj", 0.7, "Dramatic major chord on 3 (V of vi). Pulls toward vi.", true),
  bVI: c("bVI", 8, "maj", 0.9, "Epic, borrowed from minor. Often bVI–bVII–I."),
  bIII: c("bIII", 3, "maj", 0.6, "Borrowed from minor, bluesy/heroic. Bass a minor 3rd up."),
  // jazz sevenths
  Imaj7: c("Imaj7", 0, "maj7", 3, "Home, with a shimmer (the major 7th)."),
  ii7: c("ii7", 2, "min7", 2.6, "The 'ii' of ii–V–I: soft setup. Bass a step above home."),
  V7: c("V7", 7, "dom7", 2.6, "Dominant: the tritone inside it begs to resolve to I."),
  vi7: c("vi7", 9, "min7", 1.8, "Relative minor; the classic turnaround I–vi–ii–V."),
  iii7: c("iii7", 4, "min7", 1, "Often replaces I; starts the iii–vi–ii–V chain."),
  IVmaj7: c("IVmaj7", 5, "maj7", 1.3, "Floating and lush — a breath away from home."),
  VI7: c("VI7", 9, "dom7", 1.1, "V7 of ii: vi turned dominant, pulls into ii7.", true),
  II7: c("II7", 2, "dom7", 1, "V7 of V: bright, 'Take the A Train' sound. Pulls into V7.", true),
  iv7: c("iv7", 5, "min7", 0.8, "Minor iv — melancholy, sets up the backdoor bVII7."),
  bVII7: c("bVII7", 10, "dom7", 0.8, "Backdoor dominant: resolves up a whole step to I, softer than V7."),
  viiø7: c("viiø7", 11, "hdim7", 0.9, "Half-diminished: the minor ii–V's 'ii'. Dark, unstable.", false),
  III7: c("III7", 4, "dom7", 0.9, "V7 of vi — the minor-key dominant (think Autumn Leaves).", true),
  I7: c("I7", 0, "dom7", 0.8, "Home turned dominant — the bluesy push toward IV.", true),
  bII7: c("bII7", 1, "dom7", 0.7, "Tritone sub: slides down a half step into I."),
  // minor-key home (used by named progressions)
  i: c("i", 0, "min", 3, "Minor home."),
};

export interface Stage {
  add: string[];
  note: string;
}

export interface Track {
  id: TrackId;
  label: string;
  blurb: string;
  stages: Stage[];
}

export const TRACKS: Record<TrackId, Track> = {
  pop: {
    id: "pop",
    label: "Pop & rock",
    blurb: "Triads. The chords behind most songs you know.",
    stages: [
      { add: ["I", "IV", "V"], note: "The three pillars. Almost every song lives here." },
      { add: ["vi"], note: "The relative minor completes the 'four-chord song'." },
      { add: ["ii"], note: "ii is the hard one: it shares two notes with IV. Trust the bass." },
      { add: ["iii"], note: "iii is rare and hazy — it hides between I and vi." },
      { add: ["bVII"], note: "First chord from outside the key: rock's favourite." },
      { add: ["iv"], note: "Borrowed minor iv — same bass as IV, different colour." },
      { add: ["II", "III"], note: "Secondary dominants: major chords that point somewhere." },
      { add: ["bVI", "bIII"], note: "The epic borrowed chords. You've got the full palette." },
    ],
  },
  jazz: {
    id: "jazz",
    label: "Jazz",
    blurb: "Seventh chords and ii–V motion, like Autumn Leaves.",
    stages: [
      { add: ["Imaj7", "ii7", "V7"], note: "ii–V–I: the sentence jazz is written in." },
      { add: ["vi7"], note: "I–vi–ii–V: the turnaround." },
      { add: ["IVmaj7", "iii7"], note: "IV and iii — Autumn Leaves' first four bars live here." },
      { add: ["VI7", "II7"], note: "Secondary dominants: chains of falling fifths." },
      { add: ["viiø7", "III7"], note: "The minor ii–V into vi — the second half of Autumn Leaves." },
      { add: ["iv7", "bVII7"], note: "The backdoor: iv7–bVII7–I." },
      { add: ["I7", "bII7"], note: "Blues push and tritone substitution." },
    ],
  },
};

export function vocabulary(track: TrackId, stage: number): string[] {
  return TRACKS[track].stages.slice(0, stage + 1).flatMap((s) => s.add);
}

export function tonicId(track: TrackId): string {
  return track === "pop" ? "I" : "Imaj7";
}

/* ---------- spelling ---------- */

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEYS = new Set([1, 3, 5, 8, 10]);

const SUFFIX: Record<Quality, string> = { maj: "", min: "m", dim: "°", dom7: "7", maj7: "maj7", min7: "m7", hdim7: "m7b5" };

export function noteName(pc: number, keyPc: number): string {
  const flats = FLAT_KEYS.has(mod(keyPc));
  return (flats ? FLAT : SHARP)[mod(pc)];
}

/** Concrete chord name in a key, e.g. ("vi", C) -> "Am". */
export function chordName(id: string, keyPc: number): string {
  const ch = CHORDS[id];
  const root = mod(keyPc + ch.degree);
  // borrowed flat chords read better with flats
  const name = ch.id.startsWith("b") ? FLAT[root] : noteName(root, keyPc);
  return name + SUFFIX[ch.quality];
}

export function pitchClasses(id: string, keyPc: number): number[] {
  const ch = CHORDS[id];
  return INTERVALS[ch.quality].map((i) => mod(keyPc + ch.degree + i));
}

/* ---------- random ---------- */

export type Rng = () => number;

/** mulberry32 — deterministic for tests */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], weights: number[], rng: Rng): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* ---------- progression grammar ---------- */

const isDominant = (ch: ChordSym) => ch.quality === "dom7" || ch.id === "V" || ch.pulls;

/** How natural it is to move from a to b. Real-music-ish, so what you learn transfers to songs. */
export function transition(a: ChordSym, b: ChordSym, track: TrackId): number {
  if (a.id === b.id) return 0;
  const motion = mod(b.degree - a.degree);
  const downFifth = motion === 5;
  let w = 1;
  if (downFifth) w *= track === "jazz" ? 5 : 2.2;
  if (a.pulls) w *= downFifth ? 3 : 0.12;
  else if (isDominant(a)) {
    if (downFifth) w *= 2;
    else if (b.degree === 9) w *= 1.2; // deceptive V–vi
    else if (a.id === "bVII7" && b.degree === 0) w *= 4; // backdoor
    else w *= 0.35;
  }
  if (a.id === "bII7" && b.degree === 0) w *= 6;
  if (a.id === "iv7" && b.id === "bVII7") w *= 4;
  if (a.id === "bVI" && b.id === "bVII") w *= 3;
  if (a.id === "bVII" && (b.degree === 0 || b.degree === 5)) w *= 2;
  return w;
}

export interface Mastery {
  /** exponentially weighted accuracy, 0..1 */
  score: number;
  attempts: number;
}

export const EMPTY_MASTERY: Mastery = { score: 0.5, attempts: 0 };

export function updateMastery(m: Mastery | undefined, correct: boolean): Mastery {
  const prev = m ?? EMPTY_MASTERY;
  const alpha = prev.attempts < 4 ? 0.35 : 0.18;
  return { score: prev.score + alpha * ((correct ? 1 : 0) - prev.score), attempts: prev.attempts + 1 };
}

/** Weak or brand-new chords show up more — practice goes where it's needed. */
export function needWeight(m: Mastery | undefined): number {
  const mm = m ?? EMPTY_MASTERY;
  const fresh = mm.attempts < 6 ? 1.6 : 1;
  return fresh * (0.5 + 2 * (1 - mm.score));
}

export interface GenOptions {
  track: TrackId;
  vocab: string[];
  length: number;
  mastery: Record<string, Mastery>;
  /** start on the tonic (training wheels) */
  anchorStart: boolean;
  rng: Rng;
}

export function generateProgression(o: GenOptions): string[] {
  const syms = o.vocab.map((id) => CHORDS[id]);
  const home = tonicId(o.track);
  for (let attempt = 0; attempt < 40; attempt++) {
    const out: string[] = [];
    let cur = o.anchorStart
      ? CHORDS[home]
      : pick(syms, syms.map((s) => s.weight * needWeight(o.mastery[s.id])), o.rng);
    out.push(cur.id);
    while (out.length < o.length) {
      const prev = cur;
      const weights = syms.map((s) => transition(prev, s, o.track) * s.weight * needWeight(o.mastery[s.id]));
      if (weights.every((w) => w <= 0)) break;
      cur = pick(syms, weights, o.rng);
      out.push(cur.id);
    }
    // avoid one-chord-family loops like I–V–I–V when there's more vocabulary to hear
    const distinct = new Set(out).size;
    if (out.length === o.length && (distinct >= Math.min(3, syms.length) || attempt > 30)) return out;
  }
  return o.anchorStart ? [home, ...o.vocab.filter((v) => v !== home)].slice(0, o.length) : o.vocab.slice(0, o.length);
}

/* ---------- voicing ---------- */

const UPPER_LO = 52; // E3
const UPPER_HI = 76; // E5
const BASS_LO = 36; // C2
const BASS_HI = 50; // D3

export interface Voicing {
  bass: number;
  upper: number[];
}

/** All close-position inversions of a chord within the upper range. */
function candidates(pcs: number[]): number[][] {
  const out: number[][] = [];
  for (let start = UPPER_LO; start <= UPPER_HI - 12; start++) {
    if (!pcs.includes(mod(start))) continue;
    const notes = [start];
    let m = start;
    for (let k = 1; k < pcs.length; k++) {
      m++;
      while (!pcs.includes(mod(m)) || notes.some((n) => mod(n) === mod(m))) m++;
      notes.push(m);
    }
    if (notes[notes.length - 1] <= UPPER_HI) out.push(notes);
  }
  return out;
}

function nearest(pc: number, ref: number, lo: number, hi: number): number {
  let best = lo;
  for (let m = lo; m <= hi; m++) if (mod(m) === mod(pc) && (mod(best) !== mod(pc) || Math.abs(m - ref) < Math.abs(best - ref))) best = m;
  return best;
}

/**
 * Smooth voice leading: upper voices move as little as possible (like a real pianist/guitarist),
 * so the bass line is the clearest clue — exactly what we want the ear to latch onto.
 */
export function voiceProgression(ids: string[], keyPc: number, prev?: Voicing): Voicing[] {
  const out: Voicing[] = [];
  let last = prev;
  const center = 62;
  for (const id of ids) {
    const pcs = pitchClasses(id, keyPc);
    const opts = candidates(pcs);
    const cost = (notes: number[]) => {
      const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
      if (!last) return Math.abs(avg - center);
      const l = last.upper;
      let move = 0;
      for (let i = 0; i < Math.min(l.length, notes.length); i++) move += Math.abs(notes[i] - l[i]);
      return move + 0.25 * Math.abs(avg - center);
    };
    const upper = opts.reduce((best, o) => (cost(o) < cost(best) ? o : best), opts[0]);
    const root = pcs[0];
    const bass = nearest(root, last?.bass ?? 43, BASS_LO, BASS_HI);
    last = { bass, upper };
    out.push(last);
  }
  return out;
}

export function cadence(track: TrackId, mode: Mode = "major"): string[] {
  if (mode === "minor") return ["i", "iv", "V", "i"];
  return track === "jazz" ? ["Imaj7", "ii7", "V7", "Imaj7"] : ["I", "IV", "V", "I"];
}

/* ---------- confusion tips ---------- */

const DEGREE_WORD: Record<number, string> = {
  0: "home (1)", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "#4", 7: "5", 8: "b6", 9: "6", 10: "b7", 11: "7",
};

/** A concrete listening tip for telling two chords apart. */
export function contrastTip(actual: string, guess: string): string {
  const a = CHORDS[actual];
  const g = CHORDS[guess];
  const pa = pitchClasses(actual, 0);
  const pg = pitchClasses(guess, 0);
  const shared = pa.filter((p) => pg.includes(p)).length;
  if (a.degree === g.degree) {
    return `Same bass note (${DEGREE_WORD[a.degree]}) — the difference is colour: ${actual} is ${describe(a.quality)}, ${guess} is ${describe(g.quality)}.`;
  }
  const shareTxt = shared >= 2 ? `They share ${shared} notes, so the top sounds alike — ` : "";
  return `${shareTxt}listen to the bass: ${actual} sits on ${DEGREE_WORD[a.degree]}, ${guess} on ${DEGREE_WORD[g.degree]}. Hum the bass and compare it to home.`;
}

function describe(q: Quality): string {
  return {
    maj: "major (bright)",
    min: "minor (dark)",
    dim: "diminished (tense)",
    dom7: "dominant 7 (bluesy, restless)",
    maj7: "major 7 (dreamy)",
    min7: "minor 7 (mellow)",
    hdim7: "half-diminished (dark, unstable)",
  }[q];
}

/* ---------- named progressions ---------- */

export interface Famous {
  id: string;
  name: string;
  numerals: string[];
  mode: Mode;
  track: TrackId;
  /** stage index (in its track) at which it joins the quiz */
  stage: number;
  songs: string;
  why: string;
}

export const FAMOUS: Famous[] = [
  { id: "axis", name: "The Axis (I–V–vi–IV)", numerals: ["I", "V", "vi", "IV"], mode: "major", track: "pop", stage: 1,
    songs: "Let It Be · Don't Stop Believin' · With or Without You · Someone Like You",
    why: "Rises to V, falls to the sad vi, then lifts with IV. The most-used loop in pop." },
  { id: "doowop", name: "'50s / doo-wop (I–vi–IV–V)", numerals: ["I", "vi", "IV", "V"], mode: "major", track: "pop", stage: 1,
    songs: "Stand By Me · Every Breath You Take · Earth Angel",
    why: "Same four chords as the Axis, different order: vi comes early, V ends it wanting to go home." },
  { id: "sensitive", name: "Minor-start pop (vi–IV–I–V)", numerals: ["vi", "IV", "I", "V"], mode: "major", track: "pop", stage: 1,
    songs: "Zombie · Africa (chorus) · Numb",
    why: "The Axis rotated to start on vi — it feels minor even though the key is major." },
  { id: "rock145", name: "Three-chord rock (I–IV–V–IV)", numerals: ["I", "IV", "V", "IV"], mode: "major", track: "pop", stage: 0,
    songs: "Wild Thing · La Bamba · Twist and Shout",
    why: "Pure pillars, no minor chords at all. Bass: up 4, up a step, back down." },
  { id: "plagal", name: "Plagal vamp (I–IV–I–V)", numerals: ["I", "IV", "I", "V"], mode: "major", track: "pop", stage: 0,
    songs: "Countless folk & country tunes",
    why: "Home is touched every other chord — notice how strong I feels each time." },
  { id: "mixo", name: "Mixolydian rock (I–bVII–IV–I)", numerals: ["I", "bVII", "IV", "I"], mode: "major", track: "pop", stage: 4,
    songs: "Sweet Child O' Mine (verse) · Hey Jude (coda) · Gloria",
    why: "bVII replaces V — no leading tone, so it swaggers instead of resolving." },
  { id: "royal", name: "Royal Road (IV–V–iii–vi)", numerals: ["IV", "V", "iii", "vi"], mode: "major", track: "pop", stage: 3,
    songs: "Staple of J-pop & anime themes",
    why: "Never lands on I — it keeps falling into vi, so it sounds yearning." },
  { id: "creep", name: "The Creep (I–III–IV–iv)", numerals: ["I", "III", "IV", "iv"], mode: "major", track: "pop", stage: 6,
    songs: "Creep · Get Free",
    why: "Major III is a jolt; IV going minor (iv) is the heartbreak." },
  { id: "epic", name: "Epic cadence (bVI–bVII–I)", numerals: ["I", "bVI", "bVII", "I"], mode: "major", track: "pop", stage: 7,
    songs: "Game & film scores · the Mario 'level clear' cadence",
    why: "Two borrowed major chords march up by whole step into home. Triumphant." },
  { id: "andalusian", name: "Andalusian (i–bVII–bVI–V)", numerals: ["i", "bVII", "bVI", "V"], mode: "minor", track: "pop", stage: 7,
    songs: "Hit the Road Jack · Runaway · Smooth (riff)",
    why: "Bass walks straight down 1–b7–b6–5. Flamenco DNA." },
  { id: "aeolian", name: "Aeolian vamp (i–bVI–bVII–i)", numerals: ["i", "bVI", "bVII", "i"], mode: "minor", track: "pop", stage: 7,
    songs: "All Along the Watchtower (variant) · Stairway (outro)",
    why: "Minor home with two major chords below — dark but driving." },
  { id: "hallelujah", name: "The secret chord (IV–V–vi–IV)", numerals: ["IV", "V", "vi", "IV"], mode: "major", track: "pop", stage: 1,
    songs: "Hallelujah (Cohen / Buckley)",
    why: "IV and V lead into the relative minor, then return to IV." },
  { id: "fastcar", name: "Fast Car loop (IV–I–vi–V)", numerals: ["IV", "I", "vi", "V"], mode: "major", track: "pop", stage: 1,
    songs: "Fast Car",
    why: "Starts away from home on IV, so home (I) arrives on beat two and never feels final." },
  { id: "whatsup", name: "What's Up loop (I–ii–IV–I)", numerals: ["I", "ii", "IV", "I"], mode: "major", track: "pop", stage: 2,
    songs: "What's Up? · countless singalongs",
    why: "Bass climbs 1–2–4 and drops home. ii and IV side by side: perfect for hearing their difference." },
  { id: "mrjones", name: "vi–IV–ii–V", numerals: ["vi", "IV", "ii", "V"], mode: "major", track: "pop", stage: 2,
    songs: "Mr. Jones",
    why: "Never touches I: it circles around home, which keeps it restless and moving." },
  { id: "dani", name: "Minor rock loop (i–bVII–iv–i)", numerals: ["i", "bVII", "iv", "i"], mode: "minor", track: "pop", stage: 5,
    songs: "Dani California",
    why: "Bass steps down to b7, falls to 4, and comes home: a dark, rolling minor groove." },
  { id: "backtoblack", name: "Minor descent (i–iv–bVI–V)", numerals: ["i", "iv", "bVI", "V"], mode: "minor", track: "pop", stage: 7,
    songs: "Back To Black",
    why: "Minor home, minor iv, the big bVI, then the major V that drags you back to i." },
  { id: "hotel", name: "Hotel California (8 chords)", numerals: ["i", "V", "bVII", "IV", "bVI", "bIII", "iv", "V"], mode: "minor", track: "pop", stage: 7,
    songs: "Hotel California",
    why: "Walks down by fourths/fifths from i to bIII, then iv–V pulls back home. Bass: 1–5–b7–4–b6–b3–4–5." },
  { id: "251", name: "Major ii–V–I", numerals: ["ii7", "V7", "Imaj7", "Imaj7"], mode: "major", track: "jazz", stage: 0,
    songs: "Autumn Leaves · Satin Doll · every standard",
    why: "Bass falls by fifths: 2 → 5 → 1. Hear the tension in V7 melt into Imaj7." },
  { id: "1625", name: "Turnaround (I–vi–ii–V)", numerals: ["Imaj7", "vi7", "ii7", "V7"], mode: "major", track: "jazz", stage: 1,
    songs: "I Got Rhythm · Blue Moon · Heart and Soul",
    why: "Loops back to the top. Every chord pushes into the next." },
  { id: "3625", name: "iii–vi–ii–V–I", numerals: ["iii7", "vi7", "ii7", "V7", "Imaj7"], mode: "major", track: "jazz", stage: 2,
    songs: "Fly Me to the Moon (bridge) · I Will Survive",
    why: "Four falling fifths in a row — the circle of fifths in miniature." },
  { id: "autumn", name: "Autumn Leaves A section", numerals: ["ii7", "V7", "Imaj7", "IVmaj7", "viiø7", "III7", "vi7", "vi7"], mode: "major", track: "jazz", stage: 4,
    songs: "Autumn Leaves (in its relative major) · Fly Me to the Moon",
    why: "Major ii–V–I, then IV pivots to a minor ii–V into vi. The whole tune in 8 chords." },
  { id: "rhythm", name: "Rhythm changes A (I–VI7–ii–V)", numerals: ["Imaj7", "VI7", "ii7", "V7"], mode: "major", track: "jazz", stage: 3,
    songs: "I Got Rhythm · Oleo · Anthropology",
    why: "Turnaround with vi made dominant — a brighter, punchier pull into ii." },
  { id: "backdoor", name: "Backdoor (iv–bVII7–I)", numerals: ["Imaj7", "iv7", "bVII7", "Imaj7"], mode: "major", track: "jazz", stage: 5,
    songs: "Lady Bird · Misty (bridge)",
    why: "Sneaks home from a whole step below instead of via V7." },
  { id: "tritone", name: "Tritone-sub ii–V (ii–bII7–I)", numerals: ["ii7", "bII7", "Imaj7", "Imaj7"], mode: "major", track: "jazz", stage: 6,
    songs: "The Girl from Ipanema (bridge) · Satin Doll",
    why: "Bass slides down chromatically 2 → b2 → 1." },
];

export function famousPool(track: TrackId, stage: number): Famous[] {
  return FAMOUS.filter((f) => f.track === track && f.stage <= stage);
}

/** n choices including the answer, preferring look-alikes (same chords / same opening). */
export function famousChoices(answer: Famous, pool: Famous[], n: number, rng: Rng): Famous[] {
  const others = pool.filter((f) => f.id !== answer.id);
  const sim = (f: Famous) => f.numerals.filter((x) => answer.numerals.includes(x)).length + rng();
  const picked = others.sort((a, b) => sim(b) - sim(a)).slice(0, n - 1);
  const all = [answer, ...picked];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

/* ---------- progression to next stage ---------- */

export const STAGE_WINDOW = 10;

/** Ready to unlock when recent rounds are ≥85% and every chord has been heard enough to judge. */
export function readyToAdvance(recent: number[], vocab: string[], mastery: Record<string, Mastery>): boolean {
  if (recent.length < STAGE_WINDOW) return false;
  const avg = recent.slice(-STAGE_WINDOW).reduce((a, b) => a + b, 0) / STAGE_WINDOW;
  return avg >= 0.85 && vocab.every((id) => (mastery[id]?.attempts ?? 0) >= 4 && (mastery[id]?.score ?? 0) >= 0.6);
}

/* ---------- harmonic function (colour-codes the answer pad) ---------- */

export type Family = "tonic" | "pre" | "dominant" | "colour";

export const FAMILY_LABEL: Record<Family, string> = {
  tonic: "Home",
  pre: "Away",
  dominant: "Tension",
  colour: "Borrowed",
};

export function family(id: string): Family {
  const ch = CHORDS[id];
  if (ch.id.startsWith("b") || ch.id.startsWith("iv")) return "colour";
  if (ch.pulls || ch.degree === 7 || ch.degree === 11) return "dominant";
  if (ch.degree === 2 || ch.degree === 5) return "pre";
  return "tonic";
}

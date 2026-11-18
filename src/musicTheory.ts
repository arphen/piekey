export type ViewMode = "scale" | "triad" | "seventh";

export interface ScaleDefinition {
  id: string;
  displayName: string;
  aliases: string[];
  intervals: number[];
  flavor: string;
}

export interface ParsedScaleQuery {
  rootName: string;
  rootPitchClass: number;
  scale: ScaleDefinition;
}

export interface ChordDefinition {
  id: string;
  displayName: string;
  symbol: string;
  aliases: string[];
  intervals: number[];
  flavor: string;
}

export interface ParsedChordQuery {
  rootName: string;
  rootPitchClass: number;
  chord: ChordDefinition;
}

export interface BuiltChord {
  degree: number;
  chordRootInterval: number;
  intervalsFromTonic: number[];
  formulaFromChordRoot: number[];
  symbol: string;
}

const CHROMATIC_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const ENHARMONIC_MAP: Record<string, string> = {
  DB: "C#",
  EB: "D#",
  FB: "E",
  GB: "F#",
  AB: "G#",
  BB: "A#",
  CB: "B",
  "E#": "F",
  "B#": "C",
};

const SEMITONE_TO_DEGREE = [
  "1",
  "b2",
  "2",
  "b3",
  "3",
  "4",
  "b5",
  "5",
  "#5",
  "6",
  "b7",
  "7",
];

const SCALE_LIBRARY: ScaleDefinition[] = [
  {
    id: "major",
    displayName: "Major (Ionian)",
    aliases: ["major", "ionian"],
    intervals: [0, 2, 4, 5, 7, 9, 11],
    flavor: "Bright and stable.",
  },
  {
    id: "natural-minor",
    displayName: "Natural Minor (Aeolian)",
    aliases: ["natural minor", "minor", "aeolian"],
    intervals: [0, 2, 3, 5, 7, 8, 10],
    flavor: "Dark and plaintive.",
  },
  {
    id: "harmonic-minor",
    displayName: "Harmonic Minor",
    aliases: ["harmonic minor"],
    intervals: [0, 2, 3, 5, 7, 8, 11],
    flavor: "Minor with a strong leading tone pull.",
  },
  {
    id: "melodic-minor",
    displayName: "Melodic Minor",
    aliases: ["melodic minor", "jazz minor"],
    intervals: [0, 2, 3, 5, 7, 9, 11],
    flavor: "Minor color with major 6 and 7 tension.",
  },
  {
    id: "dorian",
    displayName: "Dorian",
    aliases: ["dorian"],
    intervals: [0, 2, 3, 5, 7, 9, 10],
    flavor: "Minor mood with a bright 6.",
  },
  {
    id: "phrygian",
    displayName: "Phrygian",
    aliases: ["phrygian"],
    intervals: [0, 1, 3, 5, 7, 8, 10],
    flavor: "Tense and dark with flat 2 color.",
  },
  {
    id: "phrygian-dominant",
    displayName: "Phrygian Dominant",
    aliases: ["phrygian dominant", "dominant phrygian"],
    intervals: [0, 1, 4, 5, 7, 8, 10],
    flavor: "Exotic dominant sound common in harmonic minor.",
  },
  {
    id: "lydian",
    displayName: "Lydian",
    aliases: ["lydian"],
    intervals: [0, 2, 4, 6, 7, 9, 11],
    flavor: "Major with dreamy sharp 4 lift.",
  },
  {
    id: "mixolydian",
    displayName: "Mixolydian",
    aliases: ["mixolydian"],
    intervals: [0, 2, 4, 5, 7, 9, 10],
    flavor: "Dominant color with flat 7 grit.",
  },
  {
    id: "locrian",
    displayName: "Locrian",
    aliases: ["locrian"],
    intervals: [0, 1, 3, 5, 6, 8, 10],
    flavor: "Unstable diminished mode.",
  },
  {
    id: "major-pentatonic",
    displayName: "Major Pentatonic",
    aliases: ["major pentatonic", "pentatonic major"],
    intervals: [0, 2, 4, 7, 9],
    flavor: "Open and melodic with low friction.",
  },
  {
    id: "minor-pentatonic",
    displayName: "Minor Pentatonic",
    aliases: ["minor pentatonic", "pentatonic minor"],
    intervals: [0, 3, 5, 7, 10],
    flavor: "Classic blues-rock framework.",
  },
  {
    id: "blues",
    displayName: "Blues",
    aliases: ["blues", "blues scale"],
    intervals: [0, 3, 5, 6, 7, 10],
    flavor: "Minor pentatonic plus blue-note bite.",
  },
];

const CHORD_LIBRARY: ChordDefinition[] = [
  {
    id: "major",
    displayName: "Major",
    symbol: "",
    aliases: ["maj", "major"],
    intervals: [0, 4, 7],
    flavor: "Stable and open triad color.",
  },
  {
    id: "minor",
    displayName: "Minor",
    symbol: "m",
    aliases: ["min", "minor", "-"],
    intervals: [0, 3, 7],
    flavor: "Darker triad shape.",
  },
  {
    id: "dominant-seventh",
    displayName: "Dominant 7",
    symbol: "7",
    aliases: ["dom7", "dominant7"],
    intervals: [0, 4, 7, 10],
    flavor: "Classic tension-and-release dominant sound.",
  },
  {
    id: "major-seventh",
    displayName: "Major 7",
    symbol: "maj7",
    aliases: ["major7", "ma7", "m7+"],
    intervals: [0, 4, 7, 11],
    flavor: "Lush major extension.",
  },
  {
    id: "minor-seventh",
    displayName: "Minor 7",
    symbol: "m7",
    aliases: ["min7", "minor7"],
    intervals: [0, 3, 7, 10],
    flavor: "Smooth minor color used in modal and jazz harmony.",
  },
  {
    id: "minor-major-seventh",
    displayName: "Minor (Major 7)",
    symbol: "m(maj7)",
    aliases: ["mmaj7", "minmaj7", "minormajor7"],
    intervals: [0, 3, 7, 11],
    flavor: "Minor tonic with strong leading-tone tension.",
  },
  {
    id: "half-diminished",
    displayName: "Minor 7 flat 5",
    symbol: "m7b5",
    aliases: ["halfdim", "halfdiminished"],
    intervals: [0, 3, 6, 10],
    flavor: "Half-diminished color common in minor key harmony.",
  },
  {
    id: "diminished",
    displayName: "Diminished",
    symbol: "dim",
    aliases: ["diminished", "o"],
    intervals: [0, 3, 6],
    flavor: "Symmetrical, unstable triad.",
  },
  {
    id: "diminished-seventh",
    displayName: "Diminished 7",
    symbol: "dim7",
    aliases: ["diminished7", "o7"],
    intervals: [0, 3, 6, 9],
    flavor: "Fully diminished leading-tone tension.",
  },
  {
    id: "augmented",
    displayName: "Augmented",
    symbol: "aug",
    aliases: ["augmented", "+"],
    intervals: [0, 4, 8],
    flavor: "Raised-fifth, floating triad quality.",
  },
  {
    id: "sus2",
    displayName: "Suspended 2",
    symbol: "sus2",
    aliases: ["2sus"],
    intervals: [0, 2, 7],
    flavor: "Open suspended sonority with second scale degree.",
  },
  {
    id: "sus4",
    displayName: "Suspended 4",
    symbol: "sus4",
    aliases: ["sus"],
    intervals: [0, 5, 7],
    flavor: "Suspended dominant-style color.",
  },
  {
    id: "dominant-sus",
    displayName: "7 Sus",
    symbol: "7sus",
    aliases: ["7sus4"],
    intervals: [0, 5, 7, 10],
    flavor: "Dominant chord with suspended fourth.",
  },
  {
    id: "power",
    displayName: "Power Chord",
    symbol: "5",
    aliases: ["power"],
    intervals: [0, 7],
    flavor: "Root and fifth only, high-gain staple.",
  },
];

const SCALE_INDEX = new Map<string, ScaleDefinition>();
const CHORD_INDEX = new Map<string, ChordDefinition>();

for (const scale of SCALE_LIBRARY) {
  SCALE_INDEX.set(normalizeScaleName(scale.displayName), scale);
  SCALE_INDEX.set(normalizeScaleName(scale.id), scale);
  for (const alias of scale.aliases) {
    SCALE_INDEX.set(normalizeScaleName(alias), scale);
  }
}

for (const chord of CHORD_LIBRARY) {
  CHORD_INDEX.set(normalizeChordSuffix(chord.symbol), chord);
  CHORD_INDEX.set(normalizeChordSuffix(chord.displayName), chord);
  CHORD_INDEX.set(normalizeChordSuffix(chord.id), chord);
  for (const alias of chord.aliases) {
    CHORD_INDEX.set(normalizeChordSuffix(alias), chord);
  }
}

export const SUPPORTED_SCALE_NAMES = SCALE_LIBRARY.map((scale) => scale.displayName);
export const SUPPORTED_CHORD_EXAMPLES = [
  "C",
  "Cm",
  "C7",
  "Cmaj7",
  "Cm7",
  "Cm(maj7)",
  "Cm7b5",
  "Cdim",
  "Cdim7",
  "Caug",
  "Csus2",
  "Csus4",
  "C7sus",
  "C5",
];

export function mod(value: number): number {
  return ((value % 12) + 12) % 12;
}

function normalizeScaleName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9#b]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChordSuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/[._-]/g, "")
    .trim();
}

function normalizeRootNote(rawRoot: string): string | null {
  const trimmed = rawRoot.trim();
  if (!trimmed) {
    return null;
  }

  const root = trimmed.length === 1 ? trimmed.toUpperCase() : `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
  if (CHROMATIC_NOTES.includes(root)) {
    return root;
  }

  const flatCandidate = root.replace("b", "B");
  const mapped = ENHARMONIC_MAP[flatCandidate.toUpperCase()];
  return mapped ?? null;
}

function lookupScale(rawName: string): ScaleDefinition | null {
  const normalized = normalizeScaleName(rawName).replace(/\bscale\b/g, "").trim();
  if (!normalized) {
    return null;
  }

  const direct = SCALE_INDEX.get(normalized);
  if (direct) {
    return direct;
  }

  for (const scale of SCALE_LIBRARY) {
    if (scale.aliases.some((alias) => normalizeScaleName(alias) === normalized)) {
      return scale;
    }
    if (scale.aliases.some((alias) => normalizeScaleName(alias).includes(normalized))) {
      return scale;
    }
  }

  return null;
}

function lookupChord(rawName: string): ChordDefinition | null {
  const normalized = normalizeChordSuffix(rawName);
  if (!normalized) {
    const major = CHORD_INDEX.get("");
    return major ?? null;
  }

  const direct = CHORD_INDEX.get(normalized);
  if (direct) {
    return direct;
  }

  const withoutChordWord = normalized.replace(/chord/g, "");
  const stripped = CHORD_INDEX.get(withoutChordWord);
  if (stripped) {
    return stripped;
  }

  return null;
}

export function noteNameToPitchClass(noteName: string): number | null {
  const normalized = normalizeRootNote(noteName);
  if (!normalized) {
    return null;
  }
  return CHROMATIC_NOTES.indexOf(normalized);
}

export function pitchClassToName(pitchClass: number): string {
  return CHROMATIC_NOTES[mod(pitchClass)];
}

export function parseScaleQuery(rawQuery: string): ParsedScaleQuery | null {
  const cleaned = rawQuery.trim();
  if (!cleaned) {
    return null;
  }

  const matched = cleaned.match(/^([A-Ga-g](?:#|b)?)\s+(.+)$/);
  if (!matched) {
    return null;
  }

  const [, rawRoot, rawScaleName] = matched;
  const rootName = normalizeRootNote(rawRoot);
  const scale = lookupScale(rawScaleName);

  if (!rootName || !scale) {
    return null;
  }

  const rootPitchClass = CHROMATIC_NOTES.indexOf(rootName);
  return {
    rootName,
    rootPitchClass,
    scale,
  };
}

export function parseChordQuery(rawQuery: string): ParsedChordQuery | null {
  const cleaned = rawQuery.trim();
  if (!cleaned) {
    return null;
  }

  const matched = cleaned.match(/^([A-Ga-g](?:#|b)?)(.*)$/);
  if (!matched) {
    return null;
  }

  const [, rawRoot, rawChordName] = matched;
  const rootName = normalizeRootNote(rawRoot);
  if (!rootName) {
    return null;
  }

  const compactChordName = rawChordName.replace(/\s+/g, "");
  const normalizedSymbol =
    compactChordName === "M7"
      ? "maj7"
      : compactChordName === "M"
        ? ""
        : compactChordName;

  const chord = lookupChord(normalizedSymbol);
  if (!chord) {
    return null;
  }

  return {
    rootName,
    rootPitchClass: CHROMATIC_NOTES.indexOf(rootName),
    chord,
  };
}

export function getAnchorIntervals(scaleIntervals: number[]): Set<number> {
  const normalized = new Set(scaleIntervals.map((interval) => mod(interval)));
  const anchors = new Set<number>([0]);

  const third = [4, 3, 5].find((interval) => normalized.has(interval));
  const fifth = [7, 6, 8].find((interval) => normalized.has(interval));
  const seventh = [11, 10, 9].find((interval) => normalized.has(interval));

  if (third !== undefined) {
    anchors.add(third);
  }
  if (fifth !== undefined) {
    anchors.add(fifth);
  }
  if (seventh !== undefined) {
    anchors.add(seventh);
  }

  return anchors;
}

function triadQuality(formula: number[]): "major" | "minor" | "diminished" | "augmented" | "suspended" {
  const third = formula[1];
  const fifth = formula[2];

  if (third === 4 && fifth === 7) {
    return "major";
  }
  if (third === 3 && fifth === 7) {
    return "minor";
  }
  if (third === 3 && fifth === 6) {
    return "diminished";
  }
  if (third === 4 && fifth === 8) {
    return "augmented";
  }

  return "suspended";
}

function triadSymbol(formula: number[]): string {
  const quality = triadQuality(formula);
  switch (quality) {
    case "major":
      return "";
    case "minor":
      return "m";
    case "diminished":
      return "dim";
    case "augmented":
      return "aug";
    default:
      return "sus";
  }
}

function seventhSymbol(formula: number[]): string {
  const quality = triadQuality(formula);
  const seventh = formula[3];

  if (quality === "major" && seventh === 11) {
    return "maj7";
  }
  if (quality === "major" && seventh === 10) {
    return "7";
  }
  if (quality === "minor" && seventh === 10) {
    return "m7";
  }
  if (quality === "minor" && seventh === 11) {
    return "m(maj7)";
  }
  if (quality === "diminished" && seventh === 10) {
    return "m7b5";
  }
  if (quality === "diminished" && seventh === 9) {
    return "dim7";
  }
  if (quality === "augmented" && seventh === 10) {
    return "aug7";
  }
  if (quality === "augmented" && seventh === 11) {
    return "augmaj7";
  }
  if (quality === "suspended" && seventh === 10) {
    return "7sus";
  }

  return `${triadSymbol(formula)}7`;
}

export function buildDiatonicChord(
  scaleIntervals: number[],
  degree: number,
  noteCount: 3 | 4,
): BuiltChord {
  const uniqueIntervals = [...new Set(scaleIntervals.map((interval) => mod(interval)))].sort(
    (a, b) => a - b,
  );
  const scaleLength = uniqueIntervals.length;
  const boundedDegree = Math.max(1, Math.min(degree, scaleLength));

  const absoluteIntervals: number[] = [];
  for (let noteIndex = 0; noteIndex < noteCount; noteIndex += 1) {
    const stackIndex = boundedDegree - 1 + noteIndex * 2;
    const intervalIndex = stackIndex % scaleLength;
    const octaveOffset = Math.floor(stackIndex / scaleLength) * 12;
    absoluteIntervals.push(uniqueIntervals[intervalIndex] + octaveOffset);
  }

  const chordRootAbsolute = absoluteIntervals[0];
  const intervalsFromTonic = absoluteIntervals.map((interval) => mod(interval));
  const formulaFromChordRoot = absoluteIntervals.map((interval) => mod(interval - chordRootAbsolute));

  return {
    degree: boundedDegree,
    chordRootInterval: intervalsFromTonic[0],
    intervalsFromTonic,
    formulaFromChordRoot,
    symbol: noteCount === 3 ? triadSymbol(formulaFromChordRoot) : seventhSymbol(formulaFromChordRoot),
  };
}

export function buildScalePitchClassSet(rootPitchClass: number, intervals: number[]): Set<number> {
  return new Set(intervals.map((interval) => mod(rootPitchClass + interval)));
}

export function buildChordPitchClassSet(rootPitchClass: number, intervals: number[]): Set<number> {
  return new Set(intervals.map((interval) => mod(rootPitchClass + interval)));
}

export function intervalToDegree(interval: number): string {
  return SEMITONE_TO_DEGREE[mod(interval)];
}

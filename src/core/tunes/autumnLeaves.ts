import { mod } from "../../musicTheory";
import type { Bar, ChordInBar, HarmonyLevel, KeyInfo, ParentScaleId, Tune } from "../contract";
import { parentScales, spell } from "../scales";

/** Definitions in A minor; pitch classes are transposed by key.offset. */
interface Def {
  rootPc: number;
  tones: number[];
  guide: number[];
  scale: ParentScaleId;
  mode: string;
  suffix: string;
}

const DEFS: Record<string, Def> = {
  Dm7: { rootPc: 2, tones: [2, 5, 9, 0], guide: [5, 0], scale: "relMajor", mode: "dorian", suffix: "m7" },
  G7: { rootPc: 7, tones: [7, 11, 2, 5], guide: [11, 5], scale: "relMajor", mode: "mixolydian", suffix: "7" },
  Cmaj7: { rootPc: 0, tones: [0, 4, 7, 11], guide: [4, 11], scale: "relMajor", mode: "ionian", suffix: "maj7" },
  Fmaj7: { rootPc: 5, tones: [5, 9, 0, 4], guide: [9, 4], scale: "relMajor", mode: "lydian", suffix: "maj7" },
  Bm7b5: { rootPc: 11, tones: [11, 2, 5, 9], guide: [2, 9], scale: "harmMinor", mode: "locrian ♮6", suffix: "m7b5" },
  E7: { rootPc: 4, tones: [4, 8, 11, 2], guide: [8, 2], scale: "harmMinor", mode: "phrygian dominant", suffix: "7" },
  Am: { rootPc: 9, tones: [9, 0, 4, 7], guide: [0, 7], scale: "relMajor", mode: "aeolian", suffix: "m" },
  AmMaj7: { rootPc: 9, tones: [9, 0, 4, 8], guide: [0, 8], scale: "harmMinor", mode: "harmonic minor", suffix: "m(maj7)" },
  Am7: { rootPc: 9, tones: [9, 0, 4, 7], guide: [0, 7], scale: "bVIIMajor", mode: "dorian", suffix: "m7" },
  D7: { rootPc: 2, tones: [2, 6, 9, 0], guide: [6, 0], scale: "bVIIMajor", mode: "mixolydian", suffix: "7" },
  Gm7: { rootPc: 7, tones: [7, 10, 2, 5], guide: [10, 5], scale: "bVIMajor", mode: "dorian", suffix: "m7" },
  C7: { rootPc: 0, tones: [0, 4, 7, 10], guide: [4, 10], scale: "bVIMajor", mode: "mixolydian", suffix: "7" },
};

function makeChordFactory(key: KeyInfo) {
  const PS = parentScales(key);
  const tr = (pc: number) => mod(pc + key.offset);
  const rootName = (id: string) => spell(tr(DEFS[id].rootPc), DEFS[id].scale, key);
  const sym = (id: string) => rootName(id) + DEFS[id].suffix;
  /** note name from an A-minor pitch class, spelled in the given scale */
  const N = (pc: number, scale: ParentScaleId) => spell(tr(pc), scale, key);
  const rel = PS.relMajor.name;
  const relRoot = spell(tr(0), "relMajor", key);
  const lt = N(8, "harmMinor");
  const t = key.tonic;

  const why: Record<string, string> = {
    Dm7: `ii of ${rel}: stay in the ${rel} notes. ${N(5, "relMajor")} (3rd) and ${N(0, "relMajor")} (7th) are the guide tones.`,
    G7: `V of ${relRoot}: ${N(0, "relMajor")} (7th of ${sym("Dm7")}) falls a step to ${N(11, "relMajor")}, the 3rd of ${sym("G7")}. Same notes as ${sym("Dm7")}, nothing changes.`,
    Cmaj7: `Relative major: ${sym("Dm7")}-${sym("G7")}-${sym("Cmaj7")} is the classic ii-V-I. ${sym("G7")}'s ${N(5, "relMajor")} falls to ${N(4, "relMajor")}, the 3rd.`,
    Fmaj7: `IV of ${relRoot}, still the same seven notes. ${N(4, "relMajor")} is its 7th and also the 3rd of ${sym("Cmaj7")} you just left.`,
    Bm7b5: `ii of ${t} minor: from here ${lt} is in the scale. ${N(2, "harmMinor")} (3rd) and ${N(9, "harmMinor")} (7th) lead into ${sym("E7")}'s ${lt} and ${N(2, "harmMinor")}.`,
    E7: `${lt} is the leading tone back to ${t} — the one note that changes. ${N(2, "harmMinor")} (7th) falls to ${N(0, "relMajor")}, the 3rd of ${sym("Am")}.`,
    AmMaj7: `Tonic with the raised 7th on top: the harmonic minor sound itself. ${lt} is the major 7th, a half step under ${t}.`,
    Am: `Tonic. ${lt} from ${sym("E7")} drops back to ${N(7, "relMajor")} natural: the same seven notes as ${rel} again.`,
    Am7: `Level 2: ii of ${PS.bVIIMajor.name.replace(" major", "")}. ${N(6, "bVIIMajor")} appears here instead of ${N(5, "relMajor")}: a new colour note.`,
    D7: `Level 2: V of ${PS.bVIIMajor.name.replace(" major", "")}. ${N(6, "bVIIMajor")} is its 3rd, the guide tone that wants to resolve up to ${N(7, "bVIIMajor")}.`,
    Gm7: `Level 2: ii of ${PS.bVIMajor.name.replace(" major", "")}. ${N(10, "bVIMajor")} replaces ${N(11, "relMajor")}; ${N(6, "bVIIMajor")} becomes ${N(5, "relMajor")}. Slide the whole shape down a half step.`,
    C7: `Level 2: V of ${PS.bVIMajor.name.replace(" major", "")}. ${N(10, "bVIMajor")} (7th) falls to ${N(9, "relMajor")}, the 3rd of ${sym("Fmaj7")}.`,
  };

  return (id: string, beats = 4): ChordInBar => {
    const d = DEFS[id];
    return {
      symbol: sym(id),
      rootPc: tr(d.rootPc),
      beats,
      parentScale: d.scale,
      modeName: `${rootName(id)} ${d.mode}`,
      chordTones: d.tones.map(tr),
      guideTones: d.guide.map(tr),
      why: why[id],
    };
  };
}

const A_SECTION = [["Dm7"], ["G7"], ["Cmaj7"], ["Fmaj7"], ["Bm7b5"], ["E7"], ["Am"], ["Am"]];
const B_SECTION = [["Bm7b5"], ["E7"], ["Am"], ["Am"], ["Dm7"], ["G7"], ["Cmaj7"], ["Fmaj7"]];
const C_SECTION = [["Bm7b5"], ["E7"], ["Am"], ["Am"], ["Fmaj7"], ["Bm7b5", "E7"], ["Am"], ["Am"]];
const C_SECTION_L2 = [["Bm7b5"], ["E7"], ["Am7", "D7"], ["Gm7", "C7"], ["Fmaj7"], ["Bm7b5", "E7"], ["Am"], ["Am"]];

export function buildAutumnLeaves(level: HarmonyLevel, key: KeyInfo): Tune {
  const chord = makeChordFactory(key);
  const sections: [string, string[][]][] = [
    ["A1", A_SECTION],
    ["A2", A_SECTION],
    ["B", B_SECTION],
    ["C", level === 2 ? C_SECTION_L2 : C_SECTION],
  ];
  const bars: Bar[] = [];
  for (const [name, list] of sections)
    for (const ids of list) bars.push({ index: bars.length, section: name, chords: ids.map((s) => chord(s, 4 / ids.length)) });
  return { id: `autumn-leaves-${key.tonic}-l${level}`, title: "Autumn Leaves", key: key.label, bars };
}

/** A harmonic-minor vamp for scale-shape practice: i(maj7) | V7, repeated over `bars` bars. */
export function buildMinorVamp(key: KeyInfo, bars: number): Tune {
  const chord = makeChordFactory(key);
  const out: Bar[] = Array.from({ length: bars }, (_, i) => ({
    index: i,
    section: "Vamp",
    chords: [chord(i % 2 === 0 ? "AmMaj7" : "E7")],
  }));
  return { id: `minor-vamp-${key.tonic}-${bars}`, title: `${key.tonic} harmonic minor vamp`, key: key.label, bars: out };
}

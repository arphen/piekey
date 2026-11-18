import { intervalToDegree, mod } from "../musicTheory";
import type { ChordInBar, KeyInfo, NoteRole } from "./contract";
import { landingTarget } from "./landings";
import { parentScales, spell } from "./scales";

// Short two-bar sax phrases that show what each fretboard legend colour is *for*.
// Bar 1 sounds over chord `a`, bar 2 over chord `b`; beats 0..7, eighths on .5.

export type DemoId = "root" | "guideTone" | "chordTone" | "scale" | "changed" | "target" | "parent" | "mode";

export interface DemoNote {
  midi: number;
  name: string;
  degree: string; // relative to the chord sounding under it
  beat: number;
  dur: number; // beats
  role: NoteRole;
  /** the note this demo is about: drawn bright, played a touch louder */
  accent: boolean;
  /** short tag under accented notes: "end", "land", "old", "new" */
  tag?: string;
}

export interface LegendDemo {
  id: DemoId;
  title: string;
  blurb: string;
  listen: string;
  chords: [ChordInBar, ChordInBar];
  notes: DemoNote[];
}

const LO = 55; // G3
const HI = 79; // G5

function near(pc: number, ref: number): number {
  let best = ref;
  let bestD = Infinity;
  for (let m = LO; m <= HI; m++) {
    if (mod(m) !== mod(pc)) continue;
    const d = Math.abs(m - ref);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** Every midi in range that belongs to the chord's parent scale, ascending. */
function scaleMidis(chord: ChordInBar, key: KeyInfo): number[] {
  const pcs = parentScales(key)[chord.parentScale].pcs;
  const out: number[] = [];
  for (let m = LO - 12; m <= HI + 12; m++) if (pcs.includes(mod(m))) out.push(m);
  return out;
}

/** Scale-step addressing from a chord root: sd(0)=root, sd(2)=3rd, sd(4)=5th, sd(6)=7th. */
function stepper(chord: ChordInBar, key: KeyInfo, rootRef: number) {
  const s = scaleMidis(chord, key);
  const rootMidi = near(chord.rootPc, rootRef);
  const r = s.indexOf(rootMidi);
  return {
    s,
    sd: (n: number) => s[Math.max(0, Math.min(s.length - 1, r + n))],
    idx: (midi: number) => s.indexOf(midi),
  };
}

function roleOf(pc: number, chord: ChordInBar): NoteRole {
  if (pc === chord.rootPc) return "root";
  if (chord.guideTones.includes(pc)) return "guideTone";
  if (chord.chordTones.includes(pc)) return "chordTone";
  return "scale";
}

type Raw = [midi: number, beat: number, dur: number, tag?: string];

function finish(
  raw: Raw[],
  chords: [ChordInBar, ChordInBar],
  key: KeyInfo,
  isAccent: (pc: number, chord: ChordInBar, n: Raw) => boolean,
  roleOverride?: (pc: number, chord: ChordInBar) => NoteRole | undefined,
): DemoNote[] {
  return raw.map((n) => {
    const [midi, beat, dur, tag] = n;
    const chord = beat < 4 ? chords[0] : chords[1];
    const pc = mod(midi);
    return {
      midi,
      name: spell(pc, chord.parentScale, key),
      degree: intervalToDegree(pc - chord.rootPc),
      beat,
      dur,
      role: roleOverride?.(pc, chord) ?? roleOf(pc, chord),
      accent: isAccent(pc, chord, n),
      tag,
    };
  });
}

/** The note that gives each mode its flavour, as semitones above the chord root. */
const MODE_FLAVOUR: Record<string, { semis: number; feel: string }> = {
  ionian: { semis: 11, feel: "the plain major scale; its major 7 is what makes it sound sweet and finished" },
  dorian: { semis: 9, feel: "a minor scale with a bright natural 6, the classic jazz minor-ii sound" },
  mixolydian: { semis: 10, feel: "a major scale with a flat 7, the sound of a dominant chord wanting to move" },
  lydian: { semis: 6, feel: "a major scale with a raised 4, floaty and open, with no clash against the 3rd" },
  aeolian: { semis: 8, feel: "natural minor; the ♭6 gives it its dark, sad colour" },
  "locrian ♮6": { semis: 9, feel: "the half-diminished sound; the natural 6 is borrowed from harmonic minor" },
  "phrygian dominant": { semis: 1, feel: "a dominant chord with ♭2 and ♭6, the minor-key V that pulls hard back home" },
};

export function legendDemo(
  id: DemoId,
  args: { chord: ChordInBar; prevChord?: ChordInBar; nextChord?: ChordInBar; key: KeyInfo },
): LegendDemo | null {
  const { chord, prevChord, nextChord, key } = args;
  const b = nextChord ?? chord;
  const name = (pc: number, c: ChordInBar) => spell(pc, c.parentScale, key);
  const A = stepper(chord, key, 62);

  switch (id) {
    case "root": {
      const B = stepper(b, key, A.sd(0));
      const raw: Raw[] = [
        [A.sd(0), 0, 1.5], [A.sd(4), 1.5, 0.5], [A.sd(2), 2, 0.5], [A.sd(1), 2.5, 0.5], [A.sd(0), 3, 1],
        [B.sd(0), 4, 1.5], [B.sd(2), 5.5, 0.5], [B.sd(4), 6, 0.5], [B.sd(7), 6.5, 1.5],
      ];
      return {
        id,
        title: "Root",
        blurb: `The note the chord is named after: ${name(chord.rootPc, chord)} in ${chord.symbol}. The bass already plays it, so it sounds safe and settled.`,
        listen: "The phrase leaves home and comes back to the root. Restful, but it says nothing the bass hasn't said.",
        chords: [chord, b],
        notes: finish(raw, [chord, b], key, (pc, c) => pc === c.rootPc),
      };
    }
    case "guideTone": {
      const B = stepper(b, key, A.sd(6));
      const raw: Raw[] = [
        [A.sd(2), 0, 1], [A.sd(3), 1, 0.5], [A.sd(4), 1.5, 0.5], [A.sd(6), 2, 1.5], [A.sd(5), 3.5, 0.5],
        [B.sd(2), 4, 1.5], [B.sd(3), 5.5, 0.5], [B.sd(4), 6, 0.5], [B.sd(6), 6.5, 1.5],
      ];
      const [g3, g7] = chord.guideTones;
      return {
        id,
        title: "3rd & 7th: guide tones",
        blurb: `${name(g3, chord)} and ${name(g7, chord)} decide whether ${chord.symbol} is major, minor or dominant. Hit one on beat 1 and the listener hears the chord change even with no band.`,
        listen: "Each bar opens on a 3rd and leans into a 7th. The line spells out the harmony by itself.",
        chords: [chord, b],
        notes: finish(raw, [chord, b], key, (pc, c) => c.guideTones.includes(pc)),
      };
    }
    case "chordTone": {
      const B = stepper(b, key, A.sd(4));
      const raw: Raw[] = [
        [A.sd(0), 0, 0.5], [A.sd(2), 0.5, 0.5], [A.sd(4), 1, 0.5], [A.sd(6), 1.5, 0.5], [A.sd(7), 2, 1], [A.sd(6), 3, 0.5], [A.sd(4), 3.5, 0.5],
        [B.sd(2), 4, 0.5], [B.sd(4), 4.5, 0.5], [B.sd(6), 5, 0.5], [B.sd(4), 5.5, 0.5], [B.sd(2), 6, 2],
      ];
      return {
        id,
        title: "Other chord tones",
        blurb: `The rest of the arpeggio (usually the 5th). Strong, consonant notes in ${chord.symbol}, but they don't define the chord the way the 3rd and 7th do.`,
        listen: "An arpeggio: every note belongs to the chord, so any of them can sit on a strong beat.",
        chords: [chord, b],
        notes: finish(raw, [chord, b], key, (pc, c) => c.chordTones.includes(pc) && !c.guideTones.includes(pc) && pc !== c.rootPc),
      };
    }
    case "scale": {
      const B = stepper(b, key, A.sd(7));
      const top = B.idx(near(b.rootPc, A.sd(7) + 2));
      const raw: Raw[] = [
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((n, i): Raw => [A.sd(n), i * 0.5, 0.5]),
        ...[0, 1, 2, 3].map((n, i): Raw => [B.s[top - n], 4 + i * 0.5, 0.5]),
        [B.s[top - 4], 6, 2],
      ];
      return {
        id,
        title: "Rest of the scale",
        blurb: `Passing notes: they connect chord tones. Great on the "and" of a beat, weaker when you stop on them.`,
        listen: "A straight run. The in-between notes fly by; the line feels settled only where it lands on a chord tone.",
        chords: [chord, b],
        notes: finish(raw, [chord, b], key, (pc, c) => roleOf(pc, c) === "scale"),
      };
    }
    case "parent": {
      const scales = parentScales(key);
      const parent = scales[chord.parentScale];
      const other = scales[chord.parentScale === "relMajor" ? "harmMinor" : "relMajor"];
      const odd = parent.pcs.filter((pc) => !other.pcs.includes(pc));
      const B = stepper(b, key, A.sd(7));
      const top = B.idx(near(b.rootPc, A.sd(7) + 2));
      const raw: Raw[] = [
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((n, i): Raw => [A.sd(n), i * 0.5, 0.5]),
        ...[0, 1, 2, 3].map((n, i): Raw => [B.s[top - n], 4 + i * 0.5, 0.5]),
        [B.s[top - 4], 6, 2],
      ];
      const oddNames = odd.map((pc) => name(pc, chord)).join(", ");
      const vs = other.pcs.filter((pc) => !parent.pcs.includes(pc)).map((pc) => spell(pc, other.id, key)).join(", ");
      const blurb =
        chord.parentScale === "relMajor"
          ? `${parent.label}: ${parent.name} and ${key.tonic} minor are the same 7 notes, just counted from a different home. One set of notes covers every chord in this colour. Next to harmonic minor, the note to know is ${oddNames} (not ${vs}).`
          : chord.parentScale === "harmMinor"
            ? `${parent.label}: natural minor with its 7th raised, ${oddNames} instead of ${vs}. Used over the minor ii–V (half-diminished → dominant) because that raised note is the leading tone that pulls up to the tonic.`
            : `${parent.label}: a borrowed major scale. Compared with the home scale, the notes that change are ${oddNames}.`;
      return {
        id,
        title: parent.label,
        blurb,
        listen: `One run through the scale across ${chord.symbol} and ${b.symbol}: the same notes fit both. The highlighted note is what makes this scale this scale.`,
        chords: [chord, b],
        notes: finish(raw, [chord, b], key, (pc) => odd.includes(pc)),
      };
    }
    case "mode": {
      const mode = chord.modeName.split(" ").slice(1).join(" ").toLowerCase();
      const flavour = MODE_FLAVOUR[mode];
      const parent = parentScales(key)[chord.parentScale];
      const fpc = flavour ? mod(chord.rootPc + flavour.semis) : -1;
      const raw: Raw[] = [
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((n, i): Raw => [A.sd(n), i * 0.5, 0.5]),
        ...[6, 5, 4, 3, 2, 1].map((n, i): Raw => [A.sd(n), 4 + i * 0.5, 0.5]),
        [A.sd(0), 7, 1],
      ];
      const rootName = name(chord.rootPc, chord);
      return {
        id,
        title: chord.modeName,
        blurb: `${parent.name} notes, played from ${rootName} instead of from ${name(parent.rootPc, chord)}. Same notes, new home, so it sounds different: ${flavour?.feel ?? "its own colour"}.`,
        listen: flavour
          ? `Up and down from ${rootName} over ${chord.symbol}. Listen for ${name(fpc, chord)} (the ${intervalToDegree(flavour.semis)}), the flavour note.`
          : `Up and down from ${rootName} over ${chord.symbol}.`,
        chords: [chord, chord],
        notes: finish(raw, [chord, chord], key, (pc) => pc === fpc || pc === chord.rootPc),
      };
    }
    case "changed": {
      if (!prevChord || prevChord.parentScale === chord.parentScale) return null;
      const scales = parentScales(key);
      const oldScale = scales[prevChord.parentScale].pcs;
      const newScale = scales[chord.parentScale].pcs;
      const newPc = newScale.find((pc) => !oldScale.includes(pc));
      if (newPc === undefined) return null;
      const oldPc = oldScale.find((pc) => !newScale.includes(pc) && Math.abs(mod(pc - newPc + 6) - 6) <= 2) ?? oldScale.find((pc) => !newScale.includes(pc));
      if (oldPc === undefined) return null;
      const P = stepper(prevChord, key, 62);
      const N = stepper(chord, key, 62);
      const o = P.idx(near(oldPc, 67));
      const n = N.idx(near(newPc, P.s[o]));
      const raw: Raw[] = [
        [P.s[o + 2], 0, 0.5], [P.s[o + 1], 0.5, 0.5], [P.s[o], 1, 1.5, "old"], [P.s[o - 1], 2.5, 0.5], [P.s[o], 3, 1],
        [N.s[n + 1], 4, 0.5], [N.s[n], 4.5, 1.5, "new"], [N.s[n - 1], 6, 0.5], [N.s[n], 6.5, 1.5],
      ];
      const chords: [ChordInBar, ChordInBar] = [prevChord, chord];
      return {
        id,
        title: "Note that just changed",
        blurb: `${prevChord.symbol} → ${chord.symbol} swaps the scale: ${name(oldPc, prevChord)} becomes ${name(newPc, chord)}. Your fingers will want the old note; this is the one to watch.`,
        listen: `Same lick twice. Hear how ${name(newPc, chord)} makes the second bar sound like a different place.`,
        chords,
        notes: finish(
          raw,
          chords,
          key,
          (pc) => pc === oldPc || pc === newPc,
          (pc, c) => (c === chord && pc === newPc ? "changed" : undefined),
        ),
      };
    }
    case "target": {
      if (!nextChord) return null;
      const land = landingTarget(chord, nextChord, key);
      const endMidi = near(land.endPc, 66);
      const e = A.idx(endMidi);
      const landMidi = near(land.landPc, endMidi);
      const B = stepper(nextChord, key, landMidi);
      const l = B.idx(landMidi);
      const raw: Raw[] = [
        [A.sd(0), 0, 1], [A.sd(2), 1, 0.5], [A.sd(4), 1.5, 0.5], [A.s[e + 2], 2, 0.5], [A.s[e + 1], 2.5, 0.5], [endMidi, 3, 1, "end"],
        [landMidi, 4, 2.5, "land"], [B.s[l + 1], 6.5, 0.5], [landMidi, 7, 1],
      ];
      return {
        id,
        title: "Next chord's 3rd / 7th",
        blurb: `Where to aim. End ${chord.symbol} on ${land.endName} (${land.endRole}), then step ${land.step === 0 ? "nowhere: hold it" : land.step < 0 ? "down" : "up"} into ${land.landName}, the ${land.landRole} of ${nextChord.symbol}, right on the downbeat.`,
        listen: "The line pulls toward the chord change and lands exactly as it arrives. That's voice leading.",
        chords: [chord, nextChord],
        notes: finish(raw, [chord, nextChord], key, (_pc, _c, n) => n[3] === "end" || n[3] === "land"),
      };
    }
  }
}

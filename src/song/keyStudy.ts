import { OPEN_MIDI } from "../core/scales";
import type { ReadingBar, ReadingNote } from "../core/contract";
import { mod } from "../musicTheory";
import type { LeadSheet } from "../tunes/musicxml";
import type { SongSummary } from "../overview/summary";
import type { Family, Focus } from "./deck";
import { FOCUS_FAMILIES } from "./deck";
import type { ScaleKind } from "./harmony";
import { makeScale, nice } from "./harmony";

// Pure key-study synthesizer & passive-tree selection resolver.
// Lets the central Nexus orb adapt dynamically to any selection on the circle of fifths:
// - Nothing selected -> full mix across the session / library
// - A key (e.g. C) -> all tunes in C + its relevant scales & modes (or a synthesized key study if none)
// - A specific song -> solo focus on that song alone
// - Multiple keys / songs / discipline -> custom mixed session blending all of them

export const KEY_STUDY_PREFIX = "key-study:";

export type TreeFocus = "scales" | "changes" | "reading" | "ear" | "triads" | "technique";

export interface RelevantMode {
  name: string;
  role: string;
  /** Key hub this mode naturally lives under, if another hub (e.g. relative minor/major). */
  hubId: string;
  /** Scale skill branch to launch when clicked. */
  skill: string;
  /** Optional explicit scale variant (e.g. harmonicMinor on a minor hub). */
  scaleKind?: ScaleKind;
}

export interface RelevantExercise {
  tuneId: string;
  tuneTitle: string;
  cardId: string;
  title: string;
  family: Family;
  where: string;
  bpm: number;
  box: number;
}

export interface CenterPlan {
  kind: "full-mix" | "key" | "song" | "focus" | "custom-mix";
  orbLabel: string;
  orbSub: string;
  headline: string;
  summary: string;
  tuneIds: string[];
  studyHubIds: string[];
  focus: Focus;
  /** Set when only a standalone drill tab (Ear or Triads) is selected with no keys/songs. */
  openTab: "ear" | "triads" | null;
  exercises: RelevantExercise[];
  modes: RelevantMode[];
  /** Selected hub IDs whose energy veins should flow directly into the center core. */
  activeHubIds: string[];
  /** Selected song IDs whose energy veins should flow directly into the center core. */
  activeSongIds: string[];
}

const MAJOR_VEX = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_VEX = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
const MAJOR_FULL = ["C major", "D♭ major", "D major", "E♭ major", "E major", "F major", "F♯ major", "G major", "A♭ major", "A major", "B♭ major", "B major"];
const MINOR_FULL = ["C minor", "C♯ minor", "D minor", "E♭ minor", "E minor", "F minor", "F♯ minor", "G minor", "G♯ minor", "A minor", "B♭ minor", "B minor"];
const MAJOR_SHORT = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_SHORT = ["Cm", "C♯m", "Dm", "E♭m", "Em", "Fm", "F♯m", "Gm", "G♯m", "Am", "B♭m", "Bm"];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const FOCUS_LABEL: Record<TreeFocus, string> = {
  scales: "Scales",
  changes: "Changes",
  reading: "Reading",
  ear: "Ear",
  triads: "Triads",
  technique: "Technique",
};

export function isKeyStudyId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith(KEY_STUDY_PREFIX));
}

export function keyStudyId(hubId: string): string {
  return `${KEY_STUDY_PREFIX}${hubId}`;
}

export function hubIdFromStudyId(id: string | null | undefined): string | null {
  if (!id || !id.startsWith(KEY_STUDY_PREFIX)) return null;
  const hub = id.slice(KEY_STUDY_PREFIX.length);
  return /^(M|m)\d+$/.test(hub) ? hub : null;
}

export function parseHubId(hubId: string): { minor: boolean; pc: number; shortName: string; fullName: string; vexKey: string } | null {
  const m = /^(M|m)(\d+)$/.exec(hubId);
  if (!m) return null;
  const minor = m[1] === "m";
  const pc = Number(m[2]);
  if (!Number.isInteger(pc) || pc < 0 || pc > 11) return null;
  return {
    minor,
    pc,
    shortName: minor ? MINOR_SHORT[pc] : MAJOR_SHORT[pc],
    fullName: minor ? MINOR_FULL[pc] : MAJOR_FULL[pc],
    vexKey: minor ? MINOR_VEX[pc] : MAJOR_VEX[pc],
  };
}

/** Exact shared scale card ID (`scale:C-major:thirds`, `scale:A-naturalMinor:run:triplets`) for a tree hub + skill. */
export function skillCardId(hubId: string, skill: string, scaleKind?: ScaleKind): string | null {
  const info = parseHubId(hubId);
  if (!info) return null;
  const kind: ScaleKind = scaleKind ?? (info.minor ? "naturalMinor" : "major");
  const scale = makeScale(info.pc, kind);
  return `scale:${scale.id}:${skill}`;
}

function fingeringFor(midi: number): { string: number; fret: number } {
  let best = { string: 2, fret: 5, cost: 999 };
  for (let s = 0; s < OPEN_MIDI.length; s++) {
    const fret = midi - OPEN_MIDI[s];
    if (fret < 0 || fret > 15) continue;
    const cost = Math.abs(fret - 5) + (fret === 0 ? 1.5 : 0);
    if (cost < best.cost) best = { string: s, fret, cost };
  }
  return { string: best.string, fret: best.fret };
}

function vexPitch(spelled: string, soundingMidi: number): { vexKey: string; acc: ReadingNote["accidental"] } {
  const m = /^([A-G])(b{1,2}|#{1,2})?$/.exec(spelled);
  if (!m) return { vexKey: "c/5", acc: null };
  const letter = m[1];
  const rawAcc = m[2] ?? "";
  const accSemis = rawAcc === "#" ? 1 : rawAcc === "##" ? 2 : rawAcc === "b" ? -1 : rawAcc === "bb" ? -2 : 0;
  const writtenMidi = soundingMidi + 12;
  const octave = Math.round((writtenMidi - LETTER_PC[letter] - accSemis) / 12) - 1;
  const acc: ReadingNote["accidental"] =
    rawAcc === "#" || rawAcc === "b" || rawAcc === "##" || rawAcc === "bb" ? rawAcc : null;
  return { vexKey: `${letter.toLowerCase()}${rawAcc}/${octave}`, acc };
}

function makeNote(
  spelled: string,
  soundingMidi: number,
  startBeat: number,
  durationBeats: number,
  duration: ReadingNote["duration"],
  accidental: ReadingNote["accidental"] = null,
): ReadingNote {
  const { vexKey } = vexPitch(spelled, soundingMidi);
  const { string, fret } = fingeringFor(soundingMidi);
  return {
    rest: false,
    midi: soundingMidi,
    vexKey,
    accidental,
    duration,
    dotted: false,
    startBeat,
    durationBeats,
    string,
    fret,
  };
}

/**
 * Deterministic 4-bar diatonic study sheet for any of the 24 keys on the circle of fifths.
 * Major uses Imaj7 -> vi7 -> ii7 -> V7; minor uses i7 -> iv7 -> iiø7 -> V7 (triggering both
 * natural minor and harmonic minor scale cards + ii-V-I harmony cards in `buildDeck`).
 */
export function keyStudySheet(hubId: string): LeadSheet | null {
  const info = parseHubId(hubId);
  if (!info) return null;
  const { minor, pc, fullName, vexKey } = info;
  const scale = makeScale(pc, minor ? "naturalMinor" : "major");
  const harm = minor ? makeScale(pc, "harmonicMinor") : null;

  // Choose comfortable sounding root around A2 (45) .. G#3 (56)
  const rootMidi = pc >= 9 ? 48 + pc - 12 : 48 + pc;
  const degMidi = (deg: number, oct = 0, useHarm = false): number => {
    const targetPc = (useHarm && harm ? harm : scale).pcs[deg];
    const base = rootMidi + mod(targetPc - pc) + oct * 12;
    return base;
  };
  const degName = (deg: number, useHarm = false): string => (useHarm && harm ? harm : scale).names[deg];
  const sym = (deg: number) => scale.names[deg];

  const chords = minor
    ? [`${sym(0)}m7`, `${sym(1)}m7b5`, `${sym(4)}7`, `${sym(0)}m7`]
    : [`${sym(0)}maj7`, `${sym(1)}m7`, `${sym(4)}7`, `${sym(0)}maj7`];

  // Leading-tone accidental for minor bar 3 (raised 7th vs key signature)
  const ltAcc: ReadingNote["accidental"] = minor && harm
    ? (harm.names[6].endsWith("##") ? "##" : harm.names[6].endsWith("#") ? "#" : harm.names[6].endsWith("b") ? "b" : "n")
    : null;

  const patterns: { deg: number; oct: number; harm?: boolean }[][] = minor
    ? [
        [{ deg: 0, oct: 0 }, { deg: 2, oct: 0 }, { deg: 4, oct: 0 }, { deg: 3, oct: 0 }],
        [{ deg: 1, oct: 0 }, { deg: 3, oct: 0 }, { deg: 5, oct: 0 }, { deg: 0, oct: 1 }],
        [{ deg: 4, oct: 0 }, { deg: 6, oct: 0, harm: true }, { deg: 1, oct: 1 }, { deg: 3, oct: 1 }],
        [{ deg: 4, oct: 0 }, { deg: 2, oct: 0 }, { deg: 1, oct: 0 }, { deg: 0, oct: 0 }],
      ]
    : [
        [{ deg: 0, oct: 0 }, { deg: 2, oct: 0 }, { deg: 4, oct: 0 }, { deg: 6, oct: 0 }],
        [{ deg: 1, oct: 0 }, { deg: 3, oct: 0 }, { deg: 5, oct: 0 }, { deg: 0, oct: 1 }],
        [{ deg: 4, oct: 0 }, { deg: 6, oct: 0 }, { deg: 1, oct: 1 }, { deg: 3, oct: 1 }],
        [{ deg: 4, oct: 0 }, { deg: 2, oct: 0 }, { deg: 1, oct: 0 }, { deg: 0, oct: 0 }],
      ];

  const bars: ReadingBar[] = patterns.map((barNotes, barIndex) => ({
    barIndex,
    chordSymbols: [chords[barIndex]],
    beats: 4,
    notes: barNotes.map((n, beat) =>
      makeNote(
        degName(n.deg, n.harm),
        degMidi(n.deg, n.oct, n.harm),
        barIndex * 4 + beat,
        1,
        "q",
        n.harm ? ltAcc : null,
      ),
    ),
    ...(barIndex === 3 ? { barline: "final" as const } : {}),
  }));

  return {
    id: keyStudyId(hubId),
    title: `${fullName} · Key study`,
    composer: "Scales, modes & changes",
    keySignature: vexKey,
    timeSignature: "4/4",
    tempo: 78,
    bars,
    barNumbers: ["1", "2", "3", "4"],
    comp: [],
    chordsFromVoicings: false,
  };
}

/** Relevant scales & modes worth learning for a chosen key hub. */
export function keyRelevantModes(hubId: string): RelevantMode[] {
  const info = parseHubId(hubId);
  if (!info) return [];
  const { minor, pc } = info;
  const scale = makeScale(pc, minor ? "naturalMinor" : "major");
  const deg = (i: number) => nice(scale.names[i]);

  if (minor) {
    const relPc = (pc + 3) % 12;
    const relHub = `M${relPc}`;
    return [
      { name: `${deg(0)} Natural Minor`, role: "Aeolian · home", hubId, skill: "run" },
      { name: `${deg(0)} Harmonic Minor`, role: "V7 leading tone", hubId, skill: "run", scaleKind: "harmonicMinor" },
      { name: `${deg(0)} Dorian`, role: "iv · modal color", hubId, skill: "thirds" },
      { name: `${MAJOR_SHORT[relPc]} Major`, role: "Relative major", hubId: relHub, skill: "run" },
    ];
  }
  const relPc = (pc + 9) % 12;
  const relHub = `m${relPc}`;
  return [
    { name: `${deg(0)} Major`, role: "Ionian · home", hubId, skill: "run" },
    { name: `${MINOR_SHORT[relPc]} Natural Minor`, role: "Relative vi", hubId: relHub, skill: "run" },
    { name: `${deg(1)} Dorian`, role: "ii7 changes", hubId, skill: "thirds" },
    { name: `${deg(4)} Mixolydian`, role: "V7 dominant", hubId, skill: "sevenths" },
  ];
}

function shortOrbTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  if (title.length <= 10) return title;
  if (words.length >= 2 && `${words[0]} ${words[1]}`.length <= 11) return `${words[0]} ${words[1]}`;
  return `${title.slice(0, 9)}…`;
}

function toCoachFocus(focus: TreeFocus | null): Focus {
  if (!focus || focus === "triads") return "all";
  return focus;
}

/**
 * Resolve any combination of selected keys, songs, and discipline focus on the Passive Tree
 * into a unified center-orb presentation and concrete Guitar Mode launch plan.
 */
export function resolveTreeSelection({
  selectedKeys,
  selectedSongs,
  selectedFocus,
  songs,
  songHubs,
  sessionIds,
  leadId,
}: {
  selectedKeys: readonly string[];
  selectedSongs: readonly string[];
  selectedFocus: TreeFocus | null;
  songs: readonly SongSummary[];
  songHubs: ReadonlyMap<string, string>;
  sessionIds: readonly string[];
  leadId: string | null;
}): CenterPlan {
  const byId = new Map(songs.map((s) => [s.tuneId, s]));
  const coachFocus = toCoachFocus(selectedFocus);
  const focusFamilies = coachFocus !== "all" ? new Set(FOCUS_FAMILIES[coachFocus]) : null;

  const collectExercises = (tuneIds: readonly string[], limit = 4): RelevantExercise[] => {
    const out: RelevantExercise[] = [];
    const seen = new Set<string>();
    // Round-robin across tunes so mixed selections pull from every tune evenly.
    for (let depth = 0; depth < 6 && out.length < limit; depth++) {
      for (const tuneId of tuneIds) {
        const song = byId.get(tuneId);
        if (!song) continue;
        const pool = focusFamilies ? song.next.filter((u) => focusFamilies.has(u.family)) : song.next;
        const unit = pool[depth];
        if (!unit) continue;
        const key = `${tuneId}:${unit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          tuneId,
          tuneTitle: song.title,
          cardId: unit.id,
          title: unit.title,
          family: unit.family,
          where: unit.where,
          bpm: unit.bpm,
          box: unit.box,
        });
        if (out.length >= limit) break;
      }
    }
    return out;
  };

  const hasKeys = selectedKeys.length > 0;
  const hasSongs = selectedSongs.length > 0;

  // 1. Nothing selected -> Default Full Mix
  if (!hasKeys && !hasSongs && !selectedFocus) {
    const ordered = sessionIds.length
      ? [...(leadId && sessionIds.includes(leadId) ? [leadId] : []), ...sessionIds.filter((id) => id !== leadId)]
      : songs.map((s) => s.tuneId);
    const tuneIds = ordered.filter((id) => byId.has(id));
    return {
      kind: "full-mix",
      orbLabel: "MIX",
      orbSub: tuneIds.length ? `${tuneIds.length} song${tuneIds.length === 1 ? "" : "s"}` : "all skills",
      headline: "Full Mix",
      summary: tuneIds.length
        ? `Blend all ${tuneIds.length} session song${tuneIds.length === 1 ? "" : "s"}, scales and harmony drills.`
        : "Add a song or pick any key on the circle to begin.",
      tuneIds,
      studyHubIds: [],
      focus: "all",
      openTab: null,
      exercises: collectExercises(tuneIds, 4),
      modes: leadId && songHubs.get(leadId) ? keyRelevantModes(songHubs.get(leadId)!) : keyRelevantModes("M0"),
      activeHubIds: [],
      activeSongIds: [],
    };
  }

  // 2. Only a discipline petal selected (e.g. Scales, Changes, Ear, Triads, Reading)
  if (!hasKeys && !hasSongs && selectedFocus) {
    const label = FOCUS_LABEL[selectedFocus];
    if (selectedFocus === "ear" || selectedFocus === "triads") {
      return {
        kind: "focus",
        orbLabel: label,
        orbSub: "drill mode",
        headline: `${label} mode`,
        summary: selectedFocus === "ear" ? "Train intervals, melodies & chord colors by ear." : "Triad inversions and neck geography across the fretboard.",
        tuneIds: [],
        studyHubIds: [],
        focus: coachFocus,
        openTab: selectedFocus,
        exercises: [],
        modes: [],
        activeHubIds: [],
        activeSongIds: [],
      };
    }
    const ordered = sessionIds.length ? [...sessionIds] : songs.map((s) => s.tuneId);
    const tuneIds = ordered.filter((id) => byId.has(id));
    const studyHubIds = tuneIds.length === 0 && selectedFocus === "technique" ? ["M0"] : [];
    return {
      kind: "focus",
      orbLabel: label,
      orbSub: selectedFocus === "technique" ? "mechanics" : tuneIds.length ? `${tuneIds.length} song${tuneIds.length === 1 ? "" : "s"}` : "focus",
      headline: selectedFocus === "technique" ? "Foundations · Technique" : `${label} focus`,
      summary: selectedFocus === "technique"
        ? "Spiders, rhythm pyramid, string skipping, position shifting & chord-tone enclosures."
        : `Focus strictly on ${label.toLowerCase()} exercises across your session.`,
      tuneIds,
      studyHubIds,
      focus: coachFocus,
      openTab: null,
      exercises: collectExercises(tuneIds, 4),
      modes: leadId && songHubs.get(leadId) ? keyRelevantModes(songHubs.get(leadId)!) : [],
      activeHubIds: [],
      activeSongIds: [],
    };
  }

  // 3. Single Song selected (with optional discipline filter) -> Solo Focus
  if (!hasKeys && selectedSongs.length === 1) {
    const song = byId.get(selectedSongs[0]);
    const hub = song ? songHubs.get(song.tuneId) : undefined;
    const title = song?.title ?? "Song";
    return {
      kind: selectedFocus ? "custom-mix" : "song",
      orbLabel: shortOrbTitle(title),
      orbSub: selectedFocus ? FOCUS_LABEL[selectedFocus].toLowerCase() : "solo focus",
      headline: selectedFocus ? `${title} · ${FOCUS_LABEL[selectedFocus]}` : title,
      summary: selectedFocus
        ? `${FOCUS_LABEL[selectedFocus]} exercises strictly from ${title}.`
        : `Focused session exclusively on ${title} — no other songs mixed in.`,
      tuneIds: song ? [song.tuneId] : [],
      studyHubIds: [],
      focus: coachFocus,
      openTab: null,
      exercises: song ? collectExercises([song.tuneId], 4) : [],
      modes: hub ? keyRelevantModes(hub) : [],
      activeHubIds: hub ? [hub] : [],
      activeSongIds: song ? [song.tuneId] : [],
    };
  }

  // 4. Single Key selected (with optional discipline filter)
  if (selectedKeys.length === 1 && !hasSongs) {
    const hubId = selectedKeys[0];
    const info = parseHubId(hubId);
    const shortName = info?.shortName ?? hubId;
    const fullName = info?.fullName ?? hubId;
    const keySongs = songs.filter((s) => songHubs.get(s.tuneId) === hubId);
    const tuneIds = keySongs.map((s) => s.tuneId);
    const studyHubIds = tuneIds.length === 0 ? [hubId] : [];
    const focusSuffix = selectedFocus ? ` · ${FOCUS_LABEL[selectedFocus]}` : "";
    return {
      kind: selectedFocus ? "custom-mix" : "key",
      orbLabel: selectedFocus ? `${shortName}` : shortName,
      orbSub: selectedFocus
        ? FOCUS_LABEL[selectedFocus].toLowerCase()
        : tuneIds.length
          ? `${tuneIds.length} tune${tuneIds.length === 1 ? "" : "s"}`
          : "key study",
      headline: `${fullName}${focusSuffix}`,
      summary: tuneIds.length
        ? `Most relevant exercises across all ${tuneIds.length} tune${tuneIds.length === 1 ? "" : "s"} in ${shortName}, plus ${fullName} scales & modes.`
        : `No imported tunes in ${shortName} yet — launch a live ${fullName} scale, mode & ii–V–I key study.`,
      tuneIds,
      studyHubIds,
      focus: coachFocus,
      openTab: null,
      exercises: collectExercises(tuneIds, 4),
      modes: keyRelevantModes(hubId),
      activeHubIds: [hubId],
      activeSongIds: tuneIds,
    };
  }

  // 5. Multi-select Custom Mix (multiple keys, multiple songs, or keys + songs + optional focus)
  const tuneSet = new Set<string>();
  const studyHubIds: string[] = [];
  const activeHubIds = new Set<string>(selectedKeys);

  for (const id of selectedSongs) {
    if (byId.has(id)) {
      tuneSet.add(id);
      const hub = songHubs.get(id);
      if (hub) activeHubIds.add(hub);
    }
  }
  for (const hubId of selectedKeys) {
    const matching = songs.filter((s) => songHubs.get(s.tuneId) === hubId);
    if (matching.length) {
      for (const s of matching) tuneSet.add(s.tuneId);
    } else {
      studyHubIds.push(hubId);
    }
  }

  const tuneIds = [...tuneSet];
  const keyNames = selectedKeys.map((h) => parseHubId(h)?.shortName ?? h);
  const totalSelected = selectedKeys.length + selectedSongs.length;

  let orbLabel = `MIX ${totalSelected}`;
  if (!hasSongs && keyNames.length === 2) orbLabel = `${keyNames[0]}+${keyNames[1]}`;
  else if (selectedFocus && keyNames.length === 1 && !hasSongs) orbLabel = keyNames[0];

  const sourceCount = tuneIds.length + studyHubIds.length;
  const orbSub = selectedFocus
    ? `${FOCUS_LABEL[selectedFocus].toLowerCase()} · ${sourceCount}`
    : `${sourceCount} source${sourceCount === 1 ? "" : "s"}`;

  const parts: string[] = [
    ...keyNames,
    ...selectedSongs.map((id) => byId.get(id)?.title).filter((t): t is string => Boolean(t)),
  ];
  const headline = `${parts.slice(0, 3).join(" + ")}${parts.length > 3 ? ` +${parts.length - 3}` : ""}${selectedFocus ? ` · ${FOCUS_LABEL[selectedFocus]}` : ""}`;

  const modes: RelevantMode[] = [];
  const seenMode = new Set<string>();
  for (const h of activeHubIds) {
    for (const m of keyRelevantModes(h).slice(0, 2)) {
      if (!seenMode.has(m.name)) {
        seenMode.add(m.name);
        modes.push(m);
      }
    }
    if (modes.length >= 4) break;
  }

  return {
    kind: "custom-mix",
    orbLabel,
    orbSub,
    headline,
    summary: `Blended session across ${tuneIds.length ? `${tuneIds.length} tune${tuneIds.length === 1 ? "" : "s"}` : ""}${tuneIds.length && studyHubIds.length ? " & " : ""}${studyHubIds.length ? `${studyHubIds.length} key stud${studyHubIds.length === 1 ? "y" : "ies"}` : ""}${selectedFocus ? ` (${FOCUS_LABEL[selectedFocus].toLowerCase()})` : ""}.`,
    tuneIds,
    studyHubIds,
    focus: coachFocus,
    openTab: null,
    exercises: collectExercises(tuneIds, 5),
    modes,
    activeHubIds: [...activeHubIds],
    activeSongIds: [...new Set([...selectedSongs, ...tuneIds])],
  };
}

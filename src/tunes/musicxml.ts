import { OPEN_MIDI } from "../core";
import type { JumpKind, ReadingBar, ReadingNote } from "../core/contract";
import { nameVoicing } from "./chordName";
import { gpifToMusicXml } from "./guitarpro";
import { unzip } from "./unzip";

// A lead sheet loaded from MusicXML: the melody (first part) with its chord symbols, key, meter,
// repeats, endings and jumps, plus the voicings of a chords part when the file has one.
// Pitches are drawn as guitar music is written (an octave above sounding); a part already written
// with the guitar's octave-down treble clef is shifted up so it reads the same way.

export interface CompEvent {
  bar: number;
  beat: number; // in the bar
  dur: number; // beats
  midis: number[]; // sounding
}

export interface LeadSheet {
  id: string;
  title: string;
  composer: string;
  keySignature: string; // VexFlow key spec
  timeSignature: string;
  tempo: number | null; // quarter-note bpm from the file
  bars: ReadingBar[];
  barNumbers: string[]; // as printed in the file
  comp: CompEvent[]; // backing voicings from a chords part
  chordsFromVoicings: boolean; // chord symbols were named from the chords part
  source?: MusicXmlSource;
}

export interface MusicXmlOptions {
  partId?: string;
  voice?: string;
}

export interface MusicXmlPart {
  id: string;
  name: string;
  voices: string[];
  notes: number;
}

export interface MusicXmlSource {
  parts: MusicXmlPart[];
  partId: string;
  partName: string;
  voice: string;
  range: [number, number]; // sounding MIDI
  hasChords: boolean;
  warnings: string[];
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const TYPE_DUR: Record<string, ReadingNote["duration"]> = {
  whole: "w",
  half: "h",
  quarter: "q",
  eighth: "8",
  "16th": "16",
  "32nd": "32",
};
const BY_BEATS: [number, ReadingNote["duration"], boolean][] = [
  [4, "w", false],
  [3, "h", true],
  [2, "h", false],
  [1.5, "q", true],
  [1, "q", false],
  [0.75, "8", true],
  [0.5, "8", false],
  [0.375, "16", true],
  [0.25, "16", false],
  [0.125, "32", false],
];
const UNIT_BEATS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 };
const MAJOR_KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR_KEYS = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];
const ACCIDENTAL: Record<string, ReadingNote["accidental"]> = {
  sharp: "#",
  flat: "b",
  natural: "n",
  "double-sharp": "##",
  "sharp-sharp": "##",
  "flat-flat": "bb",
};
const KIND: Record<string, string> = {
  major: "",
  minor: "m",
  augmented: "+",
  diminished: "dim",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "diminished-seventh": "dim7",
  "augmented-seventh": "+7",
  "half-diminished": "m7b5",
  "major-minor": "m(maj7)",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-11th": "11",
  "major-11th": "maj11",
  "minor-11th": "m11",
  "dominant-13th": "13",
  "major-13th": "maj13",
  "minor-13th": "m13",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  power: "5",
  none: "N.C.",
};

const kids = (el: Element, name: string) => [...el.children].filter((c) => c.tagName === name);
const child = (el: Element, name: string) => [...el.children].find((c) => c.tagName === name) ?? null;
const text = (el: Element | null, path: string) => {
  let cur: Element | null = el;
  for (const name of path.split(" ")) cur = cur ? child(cur, name) : null;
  return cur?.textContent?.trim() ?? "";
};
const num = (el: Element | null, path: string) => {
  const t = text(el, path);
  if (t === "") return null;
  const value = Number(t);
  if (!Number.isFinite(value)) throw new Error(`The MusicXML ${path} value is not a number.`);
  return value;
};
const accStr = (alter: number) => {
  if (!Number.isInteger(alter) || Math.abs(alter) > 2) throw new Error("Pitch alterations beyond a double accidental are not supported.");
  return alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
};
const keySpec = (fifths: number, minor: boolean) => (minor ? MINOR_KEYS : MAJOR_KEYS)[fifths + 7] + (minor ? "m" : "");

function chordSymbol(h: Element): string {
  const root = child(h, "root");
  if (!root) return "";
  const kindEl = child(h, "kind");
  const kind = kindEl?.textContent?.trim() ?? "major";
  let sym = text(root, "root-step") + accStr(Math.round(num(root, "root-alter") ?? 0));
  sym += KIND[kind] ?? kindEl?.getAttribute("text") ?? "";
  for (const d of kids(h, "degree")) {
    if (text(d, "degree-type") === "subtract") continue;
    sym += accStr(Math.round(num(d, "degree-alter") ?? 0)) + text(d, "degree-value");
  }
  const bass = child(h, "bass");
  if (bass) sym += `/${text(bass, "bass-step")}${accStr(Math.round(num(bass, "bass-alter") ?? 0))}`;
  return sym;
}

function signature(fifths: number): Record<string, string> {
  const sig: Record<string, string> = {};
  for (let i = 0; i < Math.abs(fifths); i++) sig[(fifths > 0 ? "FCGDAEB" : "BEADGCF")[i]] = fifths > 0 ? "#" : "b";
  return sig;
}

function jumpOf(words: string): JumpKind | null {
  const w = words.toLowerCase().replace(/\s+/g, " ").trim();
  if (/to coda/.test(w)) return "toCoda";
  if (/^d\.? ?s\.?\b|dal segno/.test(w)) return "ds";
  if (/^d\.? ?c\.?\b|da capo/.test(w)) return "dc";
  if (/^fine$/.test(w)) return "fine";
  return null;
}

/** One note or rest of the first voice, with any stacked chord notes. */
interface RawNote {
  el: Element;
  pos: number; // quarter-note beats into the bar (normalised while walking the XML)
  dur: number;
  rest: boolean;
  pitches: { step: string; alter: number; octave: number; written: number }[];
}

interface RawBar {
  m: Element;
  notes: RawNote[];
  divisions: number;
  length: number; // quarter-note beats
  harmony: { symbol: string; pos: number }[];
  directions: { el: Element; pos: number }[];
  attributes: Element[];
  barlines: Element[];
}

/** Walk a part's measures, keeping the first voice of the first staff. */
function readPart(part: Element, selectedVoice?: string): RawBar[] {
  let divisions = 1;
  const voiceOne = selectedVoice ?? [...part.getElementsByTagName("note")]
    .find((note) => (text(note, "staff") || "1") === "1" && child(note, "pitch") && !child(note, "cue"))
    ?.querySelector("voice")?.textContent?.trim() ?? "1";
  return kids(part, "measure").map((m) => {
    const bar: RawBar = { m, notes: [], divisions: 1, length: 0, harmony: [], directions: [], attributes: [], barlines: [] };
    let pos = 0;
    let previous: RawNote | null = null;
    for (const el of [...m.children]) {
      switch (el.tagName) {
        case "attributes":
          divisions = num(el, "divisions") ?? divisions;
          if (divisions <= 0) throw new Error("MusicXML divisions must be positive.");
          bar.attributes.push(el);
          break;
        case "harmony": {
          const symbol = chordSymbol(el);
          if (symbol) bar.harmony.push({ symbol, pos: pos + (num(el, "offset") ?? 0) / divisions });
          break;
        }
        case "direction":
          bar.directions.push({ el, pos: pos + (num(el, "offset") ?? 0) / divisions });
          break;
        case "barline":
          bar.barlines.push(el);
          break;
        case "backup": {
          const movement = (num(el, "duration") ?? 0) / divisions;
          if (movement < 0 || movement > pos + 1e-6) throw new Error("A MusicXML backup moves outside its measure.");
          pos = Math.max(0, pos - movement);
          previous = null;
          break;
        }
        case "forward": {
          const movement = (num(el, "duration") ?? 0) / divisions;
          if (movement < 0) throw new Error("A MusicXML forward duration cannot be negative.");
          pos += movement;
          previous = null;
          break;
        }
        case "note": {
          if (child(el, "grace") || child(el, "cue")) break;
          const voice = text(el, "voice") || "1";
          const selected = voice === voiceOne && (text(el, "staff") || "1") === "1";
          const stacked = child(el, "chord") !== null;
          const dur = (num(el, "duration") ?? 0) / divisions;
          if (!Number.isFinite(dur) || dur < 0 || divisions <= 0) throw new Error("A note has an invalid duration.");
          if (!selected) {
            if (!stacked) pos += dur;
            previous = null;
            break;
          }
          const p = child(el, "pitch");
          const pitch = p
            ? (() => {
                const step = text(p, "step");
                const alter = Math.round(num(p, "alter") ?? 0);
                const octave = num(p, "octave") ?? 4;
                if (STEP_PC[step] === undefined || !Number.isInteger(octave) || octave < -1 || octave > 9)
                  throw new Error("A melody pitch has an invalid note name or octave.");
                return { step, alter, octave, written: (octave + 1) * 12 + (STEP_PC[step] ?? 0) + alter };
              })()
            : null;
          if (stacked) {
            if (previous && pitch) previous.pitches.push(pitch);
            break;
          }
          previous = { el, pos, dur, rest: child(el, "rest") !== null || !pitch, pitches: pitch ? [pitch] : [] };
          bar.notes.push(previous);
          pos += dur;
          break;
        }
      }
      bar.length = Math.max(bar.length, pos);
    }
    // <forward> and a shorter selected voice leave genuine silence. Materialise those gaps so
    // notation, playback and the follower all agree, including a rest before the first note.
    const ordered = [...bar.notes].sort((a, b) => a.pos - b.pos);
    const filled: RawNote[] = [];
    let until = 0;
    const rest = (from: number, dur: number) => {
      const el = part.ownerDocument.createElement("note");
      el.appendChild(part.ownerDocument.createElement("rest"));
      filled.push({ el, pos: from, dur, rest: true, pitches: [] });
    };
    for (const note of ordered) {
      if (note.pos > until) rest(until, note.pos - until);
      filled.push(note);
      until = Math.max(until, note.pos + note.dur);
    }
    if (ordered.length && until < bar.length) rest(until, bar.length - until);
    bar.notes = filled;
    return bar;
  });
}

export function parseMusicXml(xml: string, fallbackTitle = "Untitled", options: MusicXmlOptions = {}): LeadSheet {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || !root) throw new Error("That file isn't readable XML.");
  if (root.tagName !== "score-partwise") throw new Error("Only part-wise MusicXML is supported (the usual export).");
  const parts = kids(root, "part");
  if (!parts.length) throw new Error("The file has no music in it.");

  const title = text(root, "work work-title") || text(root, "movement-title") || fallbackTitle;
  const composer =
    [...root.getElementsByTagName("creator")].find((c) => c.getAttribute("type") === "composer")?.textContent?.trim() ?? "";
  const partList = child(root, "part-list");
  const available: MusicXmlPart[] = parts.map((part, index) => {
    const id = part.getAttribute("id") ?? String(index + 1);
    const listed = partList && kids(partList, "score-part").find((item) => item.getAttribute("id") === id);
    const notes = [...part.getElementsByTagName("note")].filter((note) => (text(note, "staff") || "1") === "1" && child(note, "pitch") && !child(note, "cue"));
    return { id, name: text(listed || null, "part-name") || `Part ${index + 1}`, voices: [...new Set(notes.map((note) => text(note, "voice") || "1"))], notes: notes.length };
  });
  const selected = options.partId ? available.find((part) => part.id === options.partId) : available.find((part) => part.notes > 0);
  if (!selected) throw new Error(options.partId ? "The selected melody part is missing." : "No melody notes found in the score.");
  const melodyPart = parts[available.indexOf(selected)];
  const voice = options.voice ?? selected.voices[0] ?? "1";
  if (!selected.voices.includes(voice)) throw new Error("The selected melody voice has no notes.");
  const explicitAcc = melodyPart.getElementsByTagName("accidental").length > 0;
  const raw = readPart(melodyPart, voice);
  const warnings: string[] = [];
  if (selected.voices.length > 1) warnings.push(`Only voice ${voice} of ${selected.name} is used for the melody.`);
  if (melodyPart.getElementsByTagName("grace").length || melodyPart.getElementsByTagName("cue").length)
    warnings.push("Grace and cue notes are omitted from practice scoring.");
  if (melodyPart.getElementsByTagName("transpose").length)
    warnings.push("This part contains instrument transposition. Check the sounding range before importing; the reader uses guitar octave notation.");

  let fifths = 0;
  let minor = false;
  let firstKey: string | null = null;
  let currentKey = "";
  let time = "4/4";
  let firstTime: string | null = null;
  let octaveUp = 0;
  let tempo: number | null = null;
  let beatPos = 0;
  let openVolta: { label: string; numbers: number[] } | null = null;
  const bars: ReadingBar[] = [];
  const barNumbers: string[] = [];

  raw.forEach((rb, mi) => {
    const bar: ReadingBar = { barIndex: mi, chordSymbols: [], chordBeats: [], notes: [] };
    const div = rb.divisions;

    for (const a of rb.attributes) {
      const key = child(a, "key");
      if (key) {
        fifths = Math.max(-7, Math.min(7, num(key, "fifths") ?? 0));
        minor = text(key, "mode") === "minor";
        const spec = keySpec(fifths, minor);
        if (firstKey === null) firstKey = spec;
        else if (spec !== currentKey) bar.keyChange = spec;
        currentKey = spec;
      }
      const t = child(a, "time");
      if (t && num(t, "beats")) {
        const next = `${num(t, "beats")}/${num(t, "beat-type") ?? 4}`;
        if (firstTime === null) firstTime = next;
        else if (next !== time) bar.timeChange = next;
        time = next;
      }
      const clef = child(a, "clef");
      if (clef && (!clef.getAttribute("number") || clef.getAttribute("number") === "1"))
        octaveUp = num(clef, "clef-octave-change") === -1 ? 1 : 0;
    }
    const sig = signature(fifths);

    // barlines: repeats, endings, double and final bars
    for (const b of rb.barlines) {
      const loc = b.getAttribute("location") ?? "right";
      const style = text(b, "bar-style");
      const repeat = child(b, "repeat");
      if (repeat?.getAttribute("direction") === "forward") bar.repeatStart = true;
      if (repeat?.getAttribute("direction") === "backward") bar.repeatEnd = Number(repeat.getAttribute("times") ?? 2) || 2;
      if (loc === "right" && !repeat) {
        if (style === "light-light") bar.barline = "double";
        if (style === "light-heavy") bar.barline = "final";
      }
      const ending = child(b, "ending");
      if (ending) {
        const numbers = (ending.getAttribute("number") ?? "1").split(/[ ,]+/).map(Number).filter((n) => n > 0);
        const type = ending.getAttribute("type");
        if (type === "start") {
          openVolta = { label: ending.textContent?.trim() || `${numbers.join(", ")}.`, numbers };
          bar.volta = { ...openVolta, begin: true, end: false, closed: false };
        } else if ((type === "stop" || type === "discontinue") && openVolta) {
          bar.volta = { ...openVolta, begin: bar.volta?.begin ?? false, end: true, closed: type === "stop" };
          openVolta = null;
        }
      }
      if (child(b, "segno")) (bar.jumps ??= []).push({ kind: "segno", text: "" });
      if (child(b, "coda")) (bar.jumps ??= []).push({ kind: "coda", text: "" });
    }
    if (openVolta && !bar.volta) bar.volta = { ...openVolta, begin: false, end: false, closed: false };

    // directions: rehearsal marks, tempo, jumps
    const addJump = (kind: JumpKind, label: string) => {
      bar.jumps ??= [];
      const existing = bar.jumps.find((j) => j.kind === kind);
      if (existing) existing.text ||= label;
      else bar.jumps.push({ kind, text: label });
    };
    let codaSign = false;
    for (const { el } of rb.directions) {
      for (const dt of kids(el, "direction-type")) {
        const reh = text(dt, "rehearsal");
        if (reh) bar.section = reh;
        const words = text(dt, "words");
        const kind = words ? jumpOf(words) : null;
        if (kind) addJump(kind, words);
        if (child(dt, "segno")) addJump("segno", "");
        if (child(dt, "coda")) codaSign = true;
        const met = child(dt, "metronome");
        if (met && num(met, "per-minute")) bar.tempo = Math.round((num(met, "per-minute") ?? 0) * (UNIT_BEATS[text(met, "beat-unit")] ?? 1) * (child(met, "beat-unit-dot") ? 1.5 : 1));
      }
      const sound = child(el, "sound");
      if (sound) {
        if (sound.getAttribute("tempo")) bar.tempo ??= Math.round(Number(sound.getAttribute("tempo")));
        if (sound.getAttribute("dacapo") === "yes") addJump("dc", "D.C.");
        if (sound.getAttribute("dalsegno")) addJump("ds", "D.S.");
        if (sound.getAttribute("tocoda")) addJump("toCoda", "To Coda");
        if (sound.getAttribute("fine")) addJump("fine", "Fine");
        if (sound.getAttribute("segno")) addJump("segno", "");
        if (sound.getAttribute("coda")) codaSign = true;
      }
    }
    if (codaSign && !bar.jumps?.some((j) => j.kind === "toCoda")) addJump("coda", "");
    if (bar.tempo !== undefined) tempo ??= bar.tempo;

    // notes
    const state = new Map<string, string>();
    let tiedIn = false;
    for (const rn of rb.notes) {
      const el = rn.el;
      const beats = rn.dur / div;
      const tm = child(el, "time-modification");
      const notations = kids(el, "notations");
      const inNotations = (name: string) => notations.flatMap((n) => [...n.getElementsByTagName(name)]);
      const tuplet = tm
        ? {
            actual: num(tm, "actual-notes") ?? 3,
            normal: num(tm, "normal-notes") ?? 2,
            edge: (inNotations("tuplet")[0]?.getAttribute("type") ?? undefined) as "start" | "stop" | undefined,
          }
        : undefined;
      const type = TYPE_DUR[text(el, "type")];
      const plainBeats = tuplet ? (beats * tuplet.actual) / tuplet.normal : beats;
      const nearest = BY_BEATS.reduce((a, b) => (Math.abs(b[0] - plainBeats) < Math.abs(a[0] - plainBeats) ? b : a));
      const measureRest = rn.rest && child(el, "rest")?.getAttribute("measure") === "yes";
      const top = rn.pitches.reduce<RawNote["pitches"][number] | null>((a, p) => (!a || p.written > a.written ? p : a), null);

      const note: ReadingNote = {
        rest: rn.rest,
        midi: 0,
        vexKey: "b/4",
        accidental: null,
        duration: measureRest ? "w" : type ?? nearest[1],
        dotted: measureRest ? false : type ? kids(el, "dot").length > 0 : nearest[2],
        startBeat: beatPos + rn.pos / div,
        durationBeats: beats,
        string: 0,
        fret: 0,
        tuplet,
      };

      if (!rn.rest && top) {
        const octave = top.octave + octaveUp;
        const acc = accStr(top.alter);
        note.midi = top.written + 12 * octaveUp - 12;
        note.vexKey = `${top.step.toLowerCase()}${acc}/${octave}`;
        const tieToNext =
          kids(el, "tie").some((c) => c.getAttribute("type") === "start") || inNotations("tied").some((c) => c.getAttribute("type") === "start");
        if (tieToNext) note.tieToNext = true;
        const letterKey = `${top.step}${octave}`;
        if (explicitAcc) note.accidental = ACCIDENTAL[text(el, "accidental")] ?? null;
        else if (!tiedIn) {
          const current = state.get(letterKey) ?? sig[top.step] ?? "";
          if (acc !== current) note.accidental = (acc === "" ? "n" : acc) as ReadingNote["accidental"];
        }
        state.set(letterKey, acc);
        tiedIn = tieToNext;

        const slur: ReadingNote["slur"] = {};
        for (const s of inNotations("slur")) {
          const n = Number(s.getAttribute("number") ?? 1);
          if (s.getAttribute("type") === "start") slur.start = n;
          if (s.getAttribute("type") === "stop") slur.stop = n;
        }
        if (slur.start !== undefined || slur.stop !== undefined) note.slur = slur;

        const wavy = inNotations("wavy-line").map((w) => w.getAttribute("type"));
        const single = wavy.includes("single"); // vibrato on just this note
        const starts = single || wavy.includes("start");
        const stops = single || wavy.includes("stop");
        if (starts || stops) note.vibrato = starts && stops ? "both" : starts ? "start" : "stop";

        const s = num(el, "notations technical string");
        const f = num(el, "notations technical fret");
        if (s !== null && f !== null && s >= 1 && s <= 6) {
          note.string = s - 1;
          note.fret = f;
        } else note.fret = -1; // fingered below
      }
      bar.notes.push(note);
    }

    const length = rb.length / div;
    if (!bar.notes.length) {
      const [b, t] = time.split("/").map(Number);
      const len = length > 0 ? length : (b * 4) / t;
      bar.notes.push({ rest: true, midi: 0, vexKey: "b/4", accidental: null, duration: "w", dotted: false, startBeat: beatPos, durationBeats: len, string: 0, fret: 0 });
      bar.beats = len;
    } else bar.beats = length;
    bar.chordSymbols = rb.harmony.map((h) => h.symbol);
    bar.chordBeats = rb.harmony.map((h) => h.pos / div);
    bars.push(bar);
    barNumbers.push(rb.m.getAttribute("number") ?? String(mi + 1));
    beatPos += bar.beats;
  });

  if (!bars.some((b) => b.notes.some((n) => !n.rest))) throw new Error("No melody notes found in the selected part and voice.");
  finger(bars);

  // A slur joining two notes of the same pitch is a held note: some exports write ties that way.
  const sounding = bars.flatMap((b) => b.notes.filter((n) => !n.rest));
  sounding.forEach((n, k) => {
    const next = sounding[k + 1];
    if (next && n.slur?.start !== undefined && next.slur?.stop === n.slur.start && next.midi === n.midi) {
      n.tieToNext = true;
      delete n.slur.start;
      delete next.slur.stop;
    }
  });

  // A chords part: its voicings back the melody, and name the chords when the file has no symbols.
  const comp: CompEvent[] = [];
  const chordPart = parts.find((p) => p !== melodyPart && p.getElementsByTagName("chord").length > 0);
  if (chordPart) {
    const cOctaveUp = [...chordPart.getElementsByTagName("clef-octave-change")].some((c) => c.textContent?.trim() === "-1") ? 1 : 0;
    readPart(chordPart).forEach((rb, mi) => {
      if (mi >= bars.length) return;
      let open: CompEvent | null = null;
      for (const rn of rb.notes) {
        const midis = rn.pitches.map((p) => p.written + 12 * cOctaveUp - 12);
        const tiedOn = kids(rn.el, "tie").some((t) => t.getAttribute("type") === "stop");
        if (rn.rest) open = null;
        else if (tiedOn && open && open.midis.join() === midis.join()) open.dur += rn.dur / rb.divisions;
        else comp.push((open = { bar: mi, beat: rn.pos / rb.divisions, dur: rn.dur / rb.divisions, midis }));
      }
    });
  }
  const hasSymbols = bars.some((b) => b.chordSymbols.length);
  if (!hasSymbols && comp.length) {
    let last = "";
    for (const c of comp) {
      const name = nameVoicing(c.midis, fifths < 0);
      if (!name || name === last) continue;
      last = name;
      bars[c.bar].chordSymbols.push(name);
      bars[c.bar].chordBeats!.push(c.beat);
    }
  }

  // Extract bar-level lyrics from the active melody part or the first part that carries <lyric> tags.
  const lyricPart = melodyPart.getElementsByTagName("lyric").length
    ? melodyPart
    : parts.find((p) => p.getElementsByTagName("lyric").length > 0);
  if (lyricPart) {
    const measures = kids(lyricPart, "measure");
    measures.forEach((m, mi) => {
      if (mi >= bars.length) return;
      const partsText: string[] = [];
      for (const note of kids(m, "note")) {
        const lyr = child(note, "lyric");
        const t = text(lyr, "text");
        if (t) partsText.push(t);
      }
      if (partsText.length) {
        // Rejoin hyphenated syllables ("la-" + "dy" -> "lady") cleanly for campfire reading
        const joined = partsText.reduce((acc, tok) => (!acc ? tok : acc.endsWith("-") ? `${acc.slice(0, -1)}${tok}` : `${acc} ${tok}`), "");
        bars[mi].lyrics = joined;
      }
    });
  }

  const pitches = bars.flatMap((bar) => bar.notes.filter((note) => !note.rest).map((note) => note.midi));
  const range = pitches.reduce<[number, number]>(([low, high], midi) => [Math.min(low, midi), Math.max(high, midi)], [Infinity, -Infinity]);
  const hasChords = bars.some((bar) => bar.chordSymbols.some((symbol) => symbol !== "N.C."));
  if (!hasChords) warnings.push("No chord symbols were found. Chord-change exercises will not be generated.");
  if (range[0] < 40 || range[1] > 88) warnings.push("Some melody notes lie outside the usual guitar range; check the selected part and octave.");

  return {
    id: `${title}-${composer}-${bars.length}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    composer,
    keySignature: firstKey ?? "C",
    timeSignature: firstTime ?? "4/4",
    tempo,
    bars,
    barNumbers,
    comp,
    chordsFromVoicings: !hasSymbols && comp.length > 0,
    source: { parts: available, partId: selected.id, partName: selected.name, voice, range, hasChords, warnings },
  };
}

/** String and fret for notes the file didn't finger: low on the neck, close to the last one. */
function finger(bars: ReadingBar[]) {
  let prev: { string: number; fret: number } | null = null;
  for (const bar of bars)
    for (const n of bar.notes) {
      if (n.rest) continue;
      if (n.fret >= 0) {
        prev = { string: n.string, fret: n.fret };
        continue;
      }
      let options: { string: number; fret: number }[] = [];
      for (let shift = 0; !options.length && shift <= 24; shift += 12)
        for (const sign of shift ? [1, -1] : [1])
          for (let s = 0; s < 6; s++) {
            const fret = n.midi + sign * shift - OPEN_MIDI[s];
            if (fret >= 0 && fret <= 15) options.push({ string: s, fret });
          }
      if (!options.length) options = [{ string: 0, fret: 0 }];
      const cost = (o: { string: number; fret: number }) =>
        (o.fret > 10 ? 6 : 0) + (prev ? Math.abs(o.fret - prev.fret) + (o.string === prev.string ? 0.5 : 0) + 0.2 * Math.abs(o.string - prev.string) : o.fret * 0.3);
      const best = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      n.string = best.string;
      n.fret = best.fret;
      prev = best;
    }
}

export async function loadTuneFile(file: File): Promise<{ xml: string; name: string }> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a score file smaller than 20 MB.");
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const name = file.name.replace(/\.(musicxml|xml|mxl|gp)$/i, "");
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const entries = await unzip(buf);
    const gpif = entries.get("Content/score.gpif");
    if (gpif) {
      const gpifXml = new TextDecoder().decode(await gpif());
      return { xml: gpifToMusicXml(gpifXml, name), name };
    }
    const container = entries.get("META-INF/container.xml");
    let path: string | undefined;
    if (container) {
      const xml = new TextDecoder().decode(await container());
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      path = [...doc.getElementsByTagName("rootfile")].map((root) => root.getAttribute("full-path")).find((value): value is string => Boolean(value));
    }
    path ??= [...entries.keys()].find((n) => !n.startsWith("META-INF") && /\.(xml|musicxml)$/i.test(n));
    const entry = path ? entries.get(path) : undefined;
    if (!entry) throw new Error("No score found inside that archive.");
    return { xml: new TextDecoder().decode(await entry()), name };
  }
  if (/\.gp(3|4|5|x)?$/i.test(file.name)) {
    throw new Error("Only Guitar Pro 7/8 (.gp) files are supported directly. Older .gp5/.gpx files can be exported to MusicXML from MuseScore or TuxGuitar.");
  }
  return { xml: new TextDecoder().decode(buf), name };
}

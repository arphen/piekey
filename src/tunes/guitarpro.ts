// Browser-native Guitar Pro 7/8 (.gp / Content/score.gpif XML) to part-wise MusicXML 3.1 converter.
// Keeps the rest of the app (parsing, IndexedDB, sync journal, backups, fingerprints) unified on MusicXML.

const DIV = 96; // quarter note divisions: exact for 16ths, 32nds, dots, triplets (3/2) and sextuplets (6/4)

const VALUE_DIVS: Record<string, { divs: number; type: string }> = {
  Whole: { divs: DIV * 4, type: "whole" },
  Half: { divs: DIV * 2, type: "half" },
  Quarter: { divs: DIV, type: "quarter" },
  Eighth: { divs: DIV / 2, type: "eighth" },
  "16th": { divs: DIV / 4, type: "16th" },
  "32nd": { divs: DIV / 8, type: "32nd" },
  "64th": { divs: DIV / 16, type: "32nd" },
};

const SHARP_SPELL: [string, number][] = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];
const FLAT_SPELL: [string, number][] = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
];

const GUITAR_TYPES = new Set(["steelGuitar", "nylonGuitar", "electricGuitar", "acousticGuitar", "twelveStringGuitar"]);
const VOCAL_TYPES = new Set(["voice", "vocal", "choir"]);
const VOCAL_NAME = /\b(vocal|vocals|voice|sing|lyric|vox)\b/i;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const kids = (el: Element | null, tag: string) => (el ? [...el.children].filter((c) => c.tagName === tag) : []);
const child = (el: Element | null, tag: string) => (el ? [...el.children].find((c) => c.tagName === tag) ?? null : null);
const childText = (el: Element | null, tag: string) => clean(child(el, tag)?.textContent);

function propOf(el: Element, name: string): Element | null {
  const props = child(el, "Properties");
  if (!props) return null;
  return kids(props, "Property").find((p) => p.getAttribute("name") === name) ?? null;
}

function parseChordName(raw: string): { rootStep: string; rootAlter: number; kind: string; bassStep?: string; bassAlter?: number } | null {
  const s = clean(raw).replace(/♯/g, "#").replace(/♭/g, "b");
  const m = s.match(/^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/);
  if (!m) return null;
  const [, rootStep, rootAcc, qualRaw, bassStep, bassAcc] = m;
  const alterOf = (acc: string | undefined) => (acc === "#" ? 1 : acc === "b" ? -1 : 0);
  const q = qualRaw.trim();
  const kindMap: Record<string, string> = {
    "": "major",
    maj: "major",
    M: "major",
    m: "minor",
    min: "minor",
    "-": "minor",
    "5": "power",
    "7": "dominant",
    maj7: "major-seventh",
    M7: "major-seventh",
    "Δ7": "major-seventh",
    m7: "minor-seventh",
    min7: "minor-seventh",
    "-7": "minor-seventh",
    dim: "diminished",
    o: "diminished",
    dim7: "diminished-seventh",
    o7: "diminished-seventh",
    m7b5: "half-diminished",
    "ø": "half-diminished",
    "ø7": "half-diminished",
    aug: "augmented",
    "+": "augmented",
    "+7": "augmented-seventh",
    "6": "major-sixth",
    m6: "minor-sixth",
    "9": "dominant-ninth",
    maj9: "major-ninth",
    m9: "minor-ninth",
    "11": "dominant-11th",
    maj11: "major-11th",
    m11: "minor-11th",
    "13": "dominant-13th",
    maj13: "major-13th",
    m13: "minor-13th",
    sus2: "suspended-second",
    sus4: "suspended-fourth",
    sus: "suspended-fourth",
    mmaj7: "major-minor",
    "m(maj7)": "major-minor",
  };
  let kind = kindMap[q];
  if (!kind) {
    if (/^m(?!aj)/i.test(q)) kind = q.includes("7") ? "minor-seventh" : "minor";
    else if (q.includes("maj7") || q.includes("M7")) kind = "major-seventh";
    else if (q.includes("sus4")) kind = "suspended-fourth";
    else if (q.includes("sus2")) kind = "suspended-second";
    else if (q.includes("dim")) kind = "diminished";
    else if (q.includes("aug") || q.includes("+")) kind = "augmented";
    else if (q.includes("7")) kind = "dominant";
    else if (q.includes("6")) kind = "major-sixth";
    else kind = "major";
  }
  return {
    rootStep,
    rootAlter: alterOf(rootAcc),
    kind,
    ...(bassStep ? { bassStep, bassAlter: alterOf(bassAcc) } : {}),
  };
}

function harmonyXml(name: string): string {
  const parsed = parseChordName(name);
  if (!parsed) return "";
  const rootAlter = parsed.rootAlter ? `<root-alter>${parsed.rootAlter}</root-alter>` : "";
  const bass = parsed.bassStep
    ? `<bass><bass-step>${parsed.bassStep}</bass-step>${parsed.bassAlter ? `<bass-alter>${parsed.bassAlter}</bass-alter>` : ""}</bass>`
    : "";
  return `<harmony><root><root-step>${parsed.rootStep}</root-step>${rootAlter}</root><kind>${parsed.kind}</kind>${bass}</harmony>`;
}

interface RhythmInfo {
  divs: number;
  type: string;
  dots: number;
  tuplet?: { actual: number; normal: number };
}

function parseRhythm(el: Element): RhythmInfo {
  const noteValue = childText(el, "NoteValue") || "Quarter";
  const base = VALUE_DIVS[noteValue] ?? VALUE_DIVS.Quarter;
  const dotEl = child(el, "AugmentationDot");
  const dots = dotEl ? Math.max(1, Number(dotEl.getAttribute("count") ?? "1") || 1) : 0;
  let divs = base.divs;
  if (dots === 1) divs = Math.round(divs * 1.5);
  else if (dots === 2) divs = Math.round(divs * 1.75);
  const tupEl = child(el, "PrimaryTuplet");
  let tuplet: { actual: number; normal: number } | undefined;
  if (tupEl) {
    const actual = Number(tupEl.getAttribute("num") ?? "0");
    const normal = Number(tupEl.getAttribute("den") ?? "0");
    if (actual > 0 && normal > 0 && actual !== normal) {
      tuplet = { actual, normal };
      divs = Math.max(1, Math.round((divs * normal) / actual));
    }
  }
  return { divs, type: base.type, dots, tuplet };
}

/** Tokenize a GP Lyrics <Line><Text> string into syllables aligned with sounding vocal beats. */
function tokenizeLyrics(raw: string): string[] {
  const tokens: string[] = [];
  const words = raw.replace(/\r\n/g, "\n").split(/\s+/).filter(Boolean);
  for (const word of words) {
    // GP splits multi-syllable words with '-' and joins tied syllables with '+'
    const parts = word.split("-").filter((p) => p.length > 0);
    if (!parts.length) continue;
    parts.forEach((part, idx) => {
      const cleanPart = part.replace(/\+/g, " ");
      tokens.push(idx < parts.length - 1 ? `${cleanPart}-` : cleanPart);
    });
  }
  return tokens;
}

interface ParsedTrack {
  index: number;
  id: string;
  name: string;
  instType: string;
  isGuitar: boolean;
  isVocal: boolean;
  isDrum: boolean;
  stringCount: number;
  diagrams: Map<string, string>;
  noteBeats: number;
  polyBeats: number;
  firstBar: number;
  lyricOffset: number;
  lyricTokens: string[];
}

/** Convert Guitar Pro 7/8 Content/score.gpif XML into part-wise MusicXML 3.1. */
export function gpifToMusicXml(gpifXml: string, fallbackTitle = "Untitled"): string {
  const doc = new DOMParser().parseFromString(gpifXml, "application/xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || !root || root.tagName !== "GPIF") {
    throw new Error("That Guitar Pro file does not contain a readable GP7/8 score.");
  }

  const scoreEl = child(root, "Score");
  const title = childText(scoreEl, "Title") || fallbackTitle;
  const artist = childText(scoreEl, "Artist");

  const barsById = new Map<string, Element>();
  for (const b of kids(child(root, "Bars"), "Bar")) {
    const id = b.getAttribute("id");
    if (id) barsById.set(id, b);
  }
  const voicesById = new Map<string, Element>();
  for (const v of kids(child(root, "Voices"), "Voice")) {
    const id = v.getAttribute("id");
    if (id) voicesById.set(id, v);
  }
  const beatsById = new Map<string, Element>();
  for (const b of kids(child(root, "Beats"), "Beat")) {
    const id = b.getAttribute("id");
    if (id) beatsById.set(id, b);
  }
  const notesById = new Map<string, Element>();
  for (const n of kids(child(root, "Notes"), "Note")) {
    const id = n.getAttribute("id");
    if (id) notesById.set(id, n);
  }
  const rhythmsById = new Map<string, RhythmInfo>();
  for (const r of kids(child(root, "Rhythms"), "Rhythm")) {
    const id = r.getAttribute("id");
    if (id) rhythmsById.set(id, parseRhythm(r));
  }

  const masterBars = kids(child(root, "MasterBars"), "MasterBar");
  if (!masterBars.length) throw new Error("The Guitar Pro file has no measures.");

  // Tempo automations by 0-based bar index
  const tempoByBar = new Map<number, number>();
  const autos = kids(child(child(root, "MasterTrack"), "Automations"), "Automation");
  for (const auto of autos) {
    if (childText(auto, "Type") !== "Tempo") continue;
    const barIdx = Number(childText(auto, "Bar"));
    const parts = childText(auto, "Value").split(/\s+/);
    const rawBpm = Number(parts[0]);
    const unit = Number(parts[1] ?? "2");
    if (!Number.isFinite(barIdx) || !Number.isFinite(rawBpm) || rawBpm <= 0) continue;
    const mult = unit === 1 ? 0.5 : unit === 3 ? 1.5 : unit === 4 ? 2 : unit === 5 ? 3 : 1;
    if (!tempoByBar.has(barIdx)) tempoByBar.set(barIdx, Math.round(rawBpm * mult));
  }

  // Parse tracks metadata and collect song-wide chords
  const rawTracks = kids(child(root, "Tracks"), "Track");
  const allTracks: ParsedTrack[] = rawTracks.map((t, index) => {
    const name = childText(t, "Name") || `Track ${index + 1}`;
    const instType = childText(child(t, "InstrumentSet"), "Type");
    const tuningEl = [...t.getElementsByTagName("Property")].find((p) => p.getAttribute("name") === "Tuning");
    const tuningPitches = clean(child(tuningEl ?? null, "Pitches")?.textContent).split(/\s+/).filter(Boolean).map(Number);
    const isDrum = instType === "drumKit" || (tuningPitches.length > 0 && tuningPitches.every((p) => p === 0));
    const isVocal = !isDrum && (VOCAL_TYPES.has(instType) || VOCAL_NAME.test(name));
    const isGuitar = !isDrum && !isVocal && (GUITAR_TYPES.has(instType) || (/guitar/i.test(name) && !/bass/i.test(name)));

    const diagrams = new Map<string, string>();
    for (const p of [...t.getElementsByTagName("Property")]) {
      if (p.getAttribute("name") !== "DiagramCollection") continue;
      for (const item of [...p.getElementsByTagName("Item")]) {
        const id = item.getAttribute("id");
        const cname = clean(item.getAttribute("name"));
        if (id && cname) diagrams.set(id, cname);
      }
    }

    // Track-level lyrics
    let lyricOffset = 0;
    let lyricTokens: string[] = [];
    const lyricsEl = child(t, "Lyrics");
    if (lyricsEl) {
      for (const line of kids(lyricsEl, "Line")) {
        const txt = clean(childText(line, "Text"));
        if (txt) {
          lyricOffset = Number(childText(line, "Offset") || "0") || 0;
          lyricTokens = tokenizeLyrics(txt);
          break;
        }
      }
    }

    let noteBeats = 0;
    let polyBeats = 0;
    let firstBar = Number.POSITIVE_INFINITY;
    masterBars.forEach((mb, mi) => {
      const barIds = clean(childText(mb, "Bars")).split(/\s+/);
      const bar = barsById.get(barIds[index]);
      if (!bar) return;
      const vid = clean(childText(bar, "Voices")).split(/\s+/).find((v) => v && v !== "-1");
      const voice = vid ? voicesById.get(vid) : undefined;
      if (!voice) return;
      for (const bid of clean(childText(voice, "Beats")).split(/\s+/)) {
        const beat = beatsById.get(bid);
        const notesStr = clean(childText(beat ?? null, "Notes"));
        if (!notesStr) continue;
        const nlist = notesStr.split(/\s+/);
        noteBeats++;
        if (mi < firstBar) firstBar = mi;
        if (nlist.length > 1) polyBeats++;
      }
    });

    return {
      index,
      id: `P${index + 1}`,
      name,
      instType,
      isGuitar,
      isVocal,
      isDrum,
      stringCount: tuningPitches.length || 6,
      diagrams,
      noteBeats,
      polyBeats,
      firstBar,
      lyricOffset,
      lyricTokens,
    };
  });

  // Song-wide chords by barIndex -> posDivs -> chordName (merged across all tracks so every part sees the changes)
  const songChords = new Map<number, Map<number, string>>();
  for (const track of allTracks) {
    if (!track.diagrams.size) continue;
    masterBars.forEach((mb, mi) => {
      const barIds = clean(childText(mb, "Bars")).split(/\s+/);
      const bar = barsById.get(barIds[track.index]);
      if (!bar) return;
      const vid = clean(childText(bar, "Voices")).split(/\s+/).find((v) => v && v !== "-1");
      const voice = vid ? voicesById.get(vid) : undefined;
      if (!voice) return;
      let pos = 0;
      for (const bid of clean(childText(voice, "Beats")).split(/\s+/)) {
        const beat = beatsById.get(bid);
        if (!beat) continue;
        const rRef = child(beat, "Rhythm")?.getAttribute("ref") ?? "";
        const r = rhythmsById.get(rRef) ?? { divs: DIV, type: "quarter", dots: 0 };
        const chordRef = childText(beat, "Chord");
        if (chordRef) {
          const cname = track.diagrams.get(chordRef);
          if (cname) {
            let atBar = songChords.get(mi);
            if (!atBar) songChords.set(mi, (atBar = new Map()));
            if (!atBar.has(pos)) atBar.set(pos, cname);
          }
        }
        pos += r.divs;
      }
    });
  }

  // Keep pitched, non-empty tracks; sort Guitars -> Vocals -> Other
  const pitched = allTracks
    .filter((t) => !t.isDrum && t.noteBeats > 0)
    .sort((a, b) => {
      const rank = (t: ParsedTrack) => (t.isGuitar ? 0 : t.isVocal ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.firstBar !== b.firstBar) return a.firstBar - b.firstBar;
      return b.noteBeats - a.noteBeats;
    });

  if (!pitched.length) throw new Error("No pitched instrument or vocal tracks were found in that Guitar Pro file.");

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<score-partwise version="3.1">');
  out.push(`<work><work-title>${esc(title)}</work-title></work>`);
  if (artist) out.push(`<identification><creator type="composer">${esc(artist)}</creator></identification>`);
  out.push("<part-list>");
  for (const t of pitched) {
    out.push(`<score-part id="${t.id}"><part-name>${esc(t.name)}</part-name></score-part>`);
  }
  out.push("</part-list>");

  // Render each pitched track as a MusicXML <part>
  for (const track of pitched) {
    out.push(`<part id="${track.id}">`);
    let prevKey = "";
    let prevTime = "";
    let lyricCursor = 0;

    masterBars.forEach((mb, mi) => {
      out.push(`<measure number="${mi + 1}">`);

      // Left barline: forward repeat / volta start
      const repeatEl = child(mb, "Repeat");
      const repStart = repeatEl?.getAttribute("start") === "true";
      const altEnd = clean(childText(mb, "AlternateEndings"));
      if (repStart || altEnd) {
        out.push('<barline location="left">');
        if (repStart) out.push('<repeat direction="forward"/>');
        if (altEnd) {
          const nums = altEnd.split(/\s+/).join(",");
          out.push(`<ending number="${esc(nums)}" type="start">${esc(nums)}.</ending>`);
        }
        out.push("</barline>");
      }

      // Attributes: divisions, key, time, clef
      const keyEl = child(mb, "Key");
      const fifths = Number(childText(keyEl, "AccidentalCount") || "0") || 0;
      const mode = childText(keyEl, "Mode").toLowerCase() === "minor" ? "minor" : "major";
      const keySig = `${fifths}:${mode}`;
      const timeStr = childText(mb, "Time") || prevTime || "4/4";
      const [beatsNum, beatType] = timeStr.split("/").map((x) => Number(x) || 4);

      if (mi === 0 || keySig !== prevKey || timeStr !== prevTime) {
        out.push("<attributes>");
        if (mi === 0) out.push(`<divisions>${DIV}</divisions>`);
        if (mi === 0 || keySig !== prevKey) {
          out.push(`<key><fifths>${fifths}</fifths><mode>${mode}</mode></key>`);
          prevKey = keySig;
        }
        if (mi === 0 || timeStr !== prevTime) {
          out.push(`<time><beats>${beatsNum}</beats><beat-type>${beatType}</beat-type></time>`);
          prevTime = timeStr;
        }
        if (mi === 0) out.push("<clef><sign>G</sign><line>2</line></clef>");
        out.push("</attributes>");
      }

      // Section marker & tempo direction
      const sectionEl = child(mb, "Section");
      const sectionLabel = clean(childText(sectionEl, "Text") || childText(sectionEl, "Letter"));
      const barTempo = tempoByBar.get(mi);
      if (sectionLabel || barTempo) {
        out.push("<direction>");
        if (sectionLabel) out.push(`<direction-type><rehearsal>${esc(sectionLabel)}</rehearsal></direction-type>`);
        if (barTempo) out.push(`<sound tempo="${barTempo}"/>`);
        out.push("</direction>");
      }

      const spellTable = fifths < 0 ? FLAT_SPELL : SHARP_SPELL;
      const barChords = songChords.get(mi);
      const emittedChords = new Set<number>();

      // Emit voice 1 beats
      const barIds = clean(childText(mb, "Bars")).split(/\s+/);
      const bar = barsById.get(barIds[track.index]);
      const vid = bar ? clean(childText(bar, "Voices")).split(/\s+/).find((v) => v && v !== "-1") : undefined;
      const voice = vid ? voicesById.get(vid) : undefined;
      const beatIds = voice ? clean(childText(voice, "Beats")).split(/\s+/).filter(Boolean) : [];

      if (!beatIds.length) {
        if (barChords) {
          for (const [pos, cname] of [...barChords.entries()].sort((a, b) => a[0] - b[0])) {
            if (pos === 0) out.push(harmonyXml(cname));
          }
        }
        const barDivs = Math.round((beatsNum * 4 * DIV) / beatType);
        out.push(`<note><rest measure="yes"/><duration>${barDivs}</duration><voice>1</voice></note>`);
      } else {
        let pos = 0;
        for (const bid of beatIds) {
          const beat = beatsById.get(bid);
          if (!beat) continue;
          const rRef = child(beat, "Rhythm")?.getAttribute("ref") ?? "";
          const r = rhythmsById.get(rRef) ?? { divs: DIV, type: "quarter", dots: 0 };

          // Emit any chord at or before this beat position
          if (barChords) {
            for (const [cpos, cname] of [...barChords.entries()].sort((a, b) => a[0] - b[0])) {
              if (cpos <= pos && !emittedChords.has(cpos)) {
                emittedChords.add(cpos);
                out.push(harmonyXml(cname));
              }
            }
          }

          const noteIds = clean(childText(beat, "Notes")).split(/\s+/).filter(Boolean);
          const resolvedNotes = noteIds
            .map((nid) => notesById.get(nid))
            .filter((n): n is Element => Boolean(n))
            .map((n) => {
              const midiProp = propOf(n, "Midi");
              const midi = Number(childText(midiProp, "Number"));
              if (!Number.isFinite(midi)) return null;
              const strProp = propOf(n, "String");
              const fretProp = propOf(n, "Fret");
              const gpStr = strProp ? Number(childText(strProp, "String")) : NaN;
              const gpFret = fretProp ? Number(childText(fretProp, "Fret")) : NaN;
              const tieEl = child(n, "Tie");
              const tieStart = tieEl?.getAttribute("origin") === "true";
              const tieStop = tieEl?.getAttribute("destination") === "true";
              return { midi, gpStr, gpFret, tieStart, tieStop };
            })
            .filter((n): n is NonNullable<typeof n> => n !== null);

          const dotsXml = "<dot/>".repeat(r.dots);
          const tupXml = r.tuplet
            ? `<time-modification><actual-notes>${r.tuplet.actual}</actual-notes><normal-notes>${r.tuplet.normal}</normal-notes></time-modification>`
            : "";

          if (!resolvedNotes.length) {
            out.push(`<note><rest/><duration>${r.divs}</duration><voice>1</voice><type>${r.type}</type>${dotsXml}${tupXml}</note>`);
          } else {
            // Attach vocal lyric token on the first note of a non-tied-in vocal beat
            let beatLyric = "";
            if (track.lyricTokens.length && mi >= track.lyricOffset && lyricCursor < track.lyricTokens.length) {
              const allTiedIn = resolvedNotes.every((n) => n.tieStop);
              if (!allTiedIn) beatLyric = track.lyricTokens[lyricCursor++];
            }

            resolvedNotes.forEach((n, ni) => {
              // Written pitch is +12 above sounding MIDI to match ordinary treble-clef guitar MusicXML convention
              const writtenMidi = n.midi + 12;
              const [step, alter] = spellTable[((writtenMidi % 12) + 12) % 12];
              const octave = Math.floor(writtenMidi / 12) - 1;
              const chordTag = ni > 0 ? "<chord/>" : "";
              const alterTag = alter ? `<alter>${alter}</alter>` : "";
              const ties = `${n.tieStop ? '<tie type="stop"/>' : ""}${n.tieStart ? '<tie type="start"/>' : ""}`;
              const tech =
                track.isGuitar && track.stringCount === 6 && Number.isFinite(n.gpStr) && Number.isFinite(n.gpFret) && n.gpStr >= 0 && n.gpStr < 6 && n.gpFret >= 0
                  ? `<notations><technical><string>${6 - n.gpStr}</string><fret>${n.gpFret}</fret></technical></notations>`
                  : "";
              const lyricTag = ni === 0 && beatLyric ? `<lyric number="1"><text>${esc(beatLyric)}</text></lyric>` : "";
              out.push(
                `<note>${chordTag}<pitch><step>${step}</step>${alterTag}<octave>${octave}</octave></pitch><duration>${r.divs}</duration>${ties}<voice>1</voice><type>${r.type}</type>${dotsXml}${tupXml}${tech}${lyricTag}</note>`,
              );
            });
          }
          pos += r.divs;
        }
      }

      // Right barline: backward repeat / volta stop
      const repEnd = repeatEl?.getAttribute("end") === "true";
      const repCount = Number(repeatEl?.getAttribute("count") ?? "2") || 2;
      if (repEnd || altEnd) {
        out.push('<barline location="right">');
        if (repEnd) out.push(`<repeat direction="backward" times="${repCount}"/>`);
        if (altEnd) {
          const nums = altEnd.split(/\s+/).join(",");
          out.push(`<ending number="${esc(nums)}" type="stop"/>`);
        }
        out.push("</barline>");
      }

      out.push("</measure>");
    });

    out.push("</part>");
  }

  out.push("</score-partwise>");
  return out.join("\n");
}

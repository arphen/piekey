// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OPEN_MIDI } from "../core";
import { buildDeck } from "../song/deck";
import { BLUE_HOUR_ENTRY, DEMO_TUNES, getDemoStudy } from "../tunes/demos";
import { parseTuneEntry, sameTuneContent } from "../tunes/library";
import { loadTuneFile, parseMusicXml } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";
import { STARTER_ENTRY } from "../tunes/starter";

const note = (step: string, duration = 1, voice = "1") => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 4 ? "whole" : "quarter"}</type></note>`;
const attributes = '<attributes><divisions>1</divisions><key><fifths>-1</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const score = (content: string, second = "") => `<score-partwise><work><work-title>A tune</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part><score-part id="P2"><part-name>Guitar</part-name></score-part></part-list><part id="P1">${content}</part>${second}</score-partwise>`;

function compactGuitarShape(midis: number[], chosen: { string: number; fret: number }[] = []): boolean {
  if (chosen.length === midis.length) {
    const fretted = chosen.map((note) => note.fret).filter((fret) => fret > 0);
    return !fretted.length || Math.max(...fretted) - Math.min(...fretted) <= 3;
  }
  return OPEN_MIDI.some((open, string) => {
    const fret = midis[chosen.length] - open;
    return fret >= 0 && fret <= 5 && (!chosen.length || string < chosen[chosen.length - 1].string)
      && compactGuitarShape(midis, [...chosen, { string, fret }]);
  });
}

/** A small stored ZIP, enough to exercise the real central-directory/container reader. */
function archive(entries: [string, string][]): ArrayBuffer {
  const encoder = new TextEncoder();
  const encoded = entries.map(([name, value]) => ({ name: encoder.encode(name), value: encoder.encode(value) }));
  const localSize = encoded.reduce((size, entry) => size + 30 + entry.name.length + entry.value.length, 0);
  const centralSize = encoded.reduce((size, entry) => size + 46 + entry.name.length, 0);
  const data = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(data.buffer);
  let local = 0;
  let central = localSize;
  for (const entry of encoded) {
    view.setUint32(local, 0x04034b50, true);
    view.setUint32(local + 18, entry.value.length, true);
    view.setUint32(local + 22, entry.value.length, true);
    view.setUint16(local + 26, entry.name.length, true);
    data.set(entry.name, local + 30);
    data.set(entry.value, local + 30 + entry.name.length);
    view.setUint32(central, 0x02014b50, true);
    view.setUint32(central + 20, entry.value.length, true);
    view.setUint32(central + 24, entry.value.length, true);
    view.setUint16(central + 28, entry.name.length, true);
    view.setUint32(central + 42, local, true);
    data.set(entry.name, central + 46);
    local += 30 + entry.name.length + entry.value.length;
    central += 46 + entry.name.length;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, entries.length, true);
  view.setUint16(central + 10, entries.length, true);
  view.setUint32(central + 12, centralSize, true);
  view.setUint32(central + 16, localSize, true);
  return data.buffer;
}

describe("MusicXML interpreted for practice", () => {
  it("imports the bundled jazz study with complete bars, sounding guitar pitches and a repeated chorus", () => {
    const sheet = parseTuneEntry(BLUE_HOUR_ENTRY);
    expect(sheet).toMatchObject({ id: "demo-blue-hour-v1", title: "Blue Hour", composer: "Fretboard Focus Lab", tempo: 76, keySignature: "C" });
    expect(sheet.source).toMatchObject({ partId: "P1", partName: "Guitar", voice: "1", range: [48, 60], hasChords: true, warnings: [] });
    expect(sheet.bars).toHaveLength(12);
    for (const bar of sheet.bars) {
      expect(bar.beats).toBe(4);
      expect(bar.notes.reduce((beats, n) => beats + n.durationBeats, 0)).toBe(4);
    }
    expect(sheet.bars[0].notes[0].rest).toBe(true);
    expect(sheet.bars[10].chordSymbols).toEqual(["C7", "Dm7"]);
    expect(sheet.bars[10].chordBeats).toEqual([0, 2]);
    expect(sheet.bars[11].chordSymbols).toEqual(["G7", "C7"]);
    expect(sheet.comp).toHaveLength(24);
    for (let bar = 0; bar < 12; bar++) {
      const chords = sheet.comp.filter((chord) => chord.bar === bar);
      expect(chords.map((chord) => chord.beat)).toEqual(bar < 10 ? [0, 2.5] : [0, 2]);
      expect(chords.reduce((beats, chord) => beats + chord.dur, 0)).toBeLessThan(4);
    }
    expect(sheet.comp.filter((chord) => chord.bar >= 10)).toEqual([
      { bar: 10, beat: 0, dur: 1, midis: [48, 52, 58] },
      { bar: 10, beat: 2, dur: 1, midis: [50, 53, 60] },
      { bar: 11, beat: 0, dur: 1, midis: [43, 53, 59] },
      { bar: 11, beat: 2, dur: 2, midis: [48, 52, 58] },
    ]);
    for (let index = 1; index < sheet.comp.length; index++) {
      const previous = sheet.comp[index - 1].midis.slice(-2);
      const next = sheet.comp[index].midis.slice(-2);
      expect(next.every((midi, voice) => Math.abs(midi - previous[voice]) <= 2)).toBe(true);
    }
    const tl = buildTimeline(sheet);
    expect(tl.slots).toHaveLength(24);
    expect(tl.total).toBe(96);
    expect(tl.comp).toHaveLength(48);
    expect(tl.comp.slice(0, 24)).toEqual(tl.comp.slice(24).map((chord) => ({ ...chord, t: chord.t - 48 })));
    expect(tl.targets.filter((target) => target.slot < 12).map((target) => [target.midi, target.t, target.dur]))
      .toEqual(tl.targets.filter((target) => target.slot >= 12).map((target) => [target.midi, target.t - 48, target.dur]));
  });

  it("gives the originals complete, separated, compact guitar accompaniments without changing the starter melody", () => {
    const starter = parseTuneEntry(STARTER_ENTRY);
    expect(starter.source?.range).toEqual([59, 69]);
    expect(starter.bars.flatMap((bar) => bar.notes)).toHaveLength(32);
    expect(starter.bars.every((bar) => bar.notes.every((note) => !note.rest && note.durationBeats === 1))).toBe(true);
    for (let bar = 0; bar < 8; bar++) expect(starter.comp.filter((chord) => chord.bar === bar).map((chord) => [chord.beat, chord.dur])).toEqual([[0, 1], [2, 1]]);
    for (const demo of DEMO_TUNES) {
      const sheet = parseTuneEntry(demo.entry);
      const accompaniment = parseMusicXml(demo.entry.xml, "", { partId: "P2" });
      expect(accompaniment.bars).toHaveLength(sheet.bars.length);
      for (const bar of accompaniment.bars) expect(bar.notes.reduce((beats, note) => beats + note.durationBeats, 0)).toBe(4);
      for (const [index, chord] of sheet.comp.entries()) {
        expect(compactGuitarShape(chord.midis)).toBe(true);
        expect(chord.dur).toBeGreaterThan(0);
        expect(chord.beat + chord.dur).toBeLessThanOrEqual(4);
        const next = sheet.comp[index + 1];
        if (next?.bar === chord.bar) expect(chord.beat + chord.dur).toBeLessThan(next.beat);
      }
      expect(getDemoStudy({ ...demo.entry, name: "My title" })).toBe(demo.study);
      expect(getDemoStudy({ ...demo.entry, partId: "P2" })).toBeUndefined();
      expect(getDemoStudy({ ...demo.entry, xml: demo.entry.xml.replace("<step>E</step>", "<step>D</step>") })).toBeUndefined();
    }
  });

  it("turns each downloadable demo into melody, harmony and listening practice", () => {
    for (const demo of DEMO_TUNES) {
      const sheet = parseTuneEntry(demo.entry);
      const deck = buildDeck(sheet, buildTimeline(sheet));
      const families = new Set(deck.cards.map((card) => card.family));
      for (const family of ["melody", "chords", "harmony", "ear", "reading"]) expect(families.has(family as typeof deck.cards[number]["family"])).toBe(true);
      expect(deck.cards.some((card) => card.run)).toBe(true);
      for (const card of deck.cards) {
        expect(card.last).toBeGreaterThanOrEqual(card.first);
        expect(card.tl.targets.slice(card.first, card.last + 1).every((target) => Number.isFinite(target.midi) && target.dur > 0)).toBe(true);
      }
    }
  });

  it("keeps leading and internal silence in the score and scoring timeline", () => {
    const sheet = parseMusicXml(score(`<measure number="1">${attributes}${note("C")}<forward><duration>2</duration></forward>${note("D")}</measure><measure number="2"><forward><duration>2</duration></forward>${note("C", 2)}</measure>`));
    expect(sheet.bars[0].beats).toBe(4);
    expect(sheet.bars[0].notes.map((n) => [n.rest, n.startBeat, n.durationBeats])).toEqual([[false, 0, 1], [true, 1, 2], [false, 3, 1]]);
    expect(buildTimeline(sheet).targets.map((target) => target.t)).toEqual([0, 3, 6]);
  });

  it("tracks the document cursor through other voices and backup movements", () => {
    const xml = score(`<measure number="1">${attributes}${note("C")}<forward><duration>3</duration></forward><backup><duration>4</duration></backup>${note("G", 4, "2")}</measure><measure number="2">${note("D", 4)}</measure>`);
    const first = parseMusicXml(xml);
    const second = parseMusicXml(xml, "", { partId: "P1", voice: "2" });
    expect(first.bars.map((bar) => bar.beats)).toEqual([4, 4]);
    expect(buildTimeline(first).targets.map((target) => [target.midi, target.t])).toEqual([[48, 0], [50, 4]]);
    expect(buildTimeline(second).targets.map((target) => [target.midi, target.t])).toEqual([[55, 0]]);
  });

  it("normalises divisions when an exporter changes them inside a measure", () => {
    const sheet = parseMusicXml(score(`<measure>${attributes}<attributes><divisions>2</divisions></attributes>${note("C", 2)}<attributes><divisions>4</divisions></attributes>${note("D", 4)}</measure>`));
    expect(sheet.bars[0].beats).toBe(2);
    expect(buildTimeline(sheet).targets.map((target) => [target.t, target.dur])).toEqual([[0, 1], [1, 1]]);
  });

  it("rejects invalid numeric movements before generating notes or exercises", () => {
    expect(() => parseMusicXml(score(`<measure>${attributes}<forward><duration>oops</duration></forward>${note("C")}</measure>`))).toThrow("not a number");
    expect(() => parseMusicXml(score(`<measure>${attributes}<backup><duration>2</duration></backup>${note("C")}</measure>`))).toThrow("outside its measure");
  });

  it("selects a playable part and exposes part, voice, key, range and chord availability", () => {
    const xml = score(`<measure number="1">${attributes}<note><unpitched/><duration>4</duration></note></measure>`, `<part id="P2"><measure number="1">${attributes}<harmony><root><root-step>F</root-step></root><kind>major</kind></harmony>${note("F", 4)}</measure></part>`);
    const sheet = parseMusicXml(xml);
    expect(sheet.keySignature).toBe("F");
    expect(sheet.source).toMatchObject({ partId: "P2", partName: "Guitar", voice: "1", range: [53, 53], hasChords: true });
  });

  it("distinguishes arrangements with identical metadata", () => {
    const a = score(`<measure>${attributes}${note("C", 4)}</measure>`);
    const b = score(`<measure>${attributes}${note("G", 4)}</measure>`);
    const first = { id: "old-saved-id", name: "First arrangement", xml: a };
    const second = { id: "new-independent-id", name: "Second arrangement", xml: b };
    expect(sameTuneContent(first, second)).toBe(false);
    expect(sameTuneContent(first, { xml: a, partId: "P1", voice: "1" })).toBe(true);
  });

  it("reads the declared MXL root file with XML quoting and escaped paths", async () => {
    const xml = score(`<measure>${attributes}${note("C", 4)}</measure>`);
    const data = archive([["unused.xml", "not a score"], ["META-INF/container.xml", "<container><rootfiles><rootfile full-path='scores/a&amp;b.musicxml'/></rootfiles></container>"], ["scores/a&b.musicxml", xml]]);
    const file = { name: "example.mxl", size: data.byteLength, arrayBuffer: async () => data } as File;
    expect(await loadTuneFile(file)).toEqual({ name: "example", xml });
  });

});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sameTuneContent } from "../tunes/library";
import { loadTuneFile, parseMusicXml } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";

const note = (step: string, duration = 1, voice = "1") => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 4 ? "whole" : "quarter"}</type></note>`;
const attributes = '<attributes><divisions>1</divisions><key><fifths>-1</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const score = (content: string, second = "") => `<score-partwise><work><work-title>A tune</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part><score-part id="P2"><part-name>Guitar</part-name></score-part></part-list><part id="P1">${content}</part>${second}</score-partwise>`;

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

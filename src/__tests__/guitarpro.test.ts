// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { gpifToMusicXml } from "../tunes/guitarpro";
import { parseMusicXml } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";
import { buildDeck } from "../song/deck";

const SAMPLE_GPIF = `<?xml version="1.0" encoding="utf-8"?>
<GPIF>
  <GPVersion>8.1.3</GPVersion>
  <Score>
    <Title>Campfire Study</Title>
    <Artist>Test Artist</Artist>
  </Score>
  <MasterTrack>
    <Automations>
      <Automation>
        <Type>Tempo</Type>
        <Bar>0</Bar>
        <Value>92 2</Value>
      </Automation>
      <Automation>
        <Type>Tempo</Type>
        <Bar>1</Bar>
        <Value>104 2</Value>
      </Automation>
    </Automations>
  </MasterTrack>
  <Tracks>
    <Track id="0">
      <Name>Drums</Name>
      <InstrumentSet><Type>drumKit</Type></InstrumentSet>
      <Properties><Property name="Tuning"><Pitches>0 0 0 0 0 0</Pitches></Property></Properties>
    </Track>
    <Track id="1">
      <Name>Lead Vocals</Name>
      <InstrumentSet><Type>voice</Type></InstrumentSet>
      <Lyrics>
        <Line>
          <Text>Hel-lo camp-fire</Text>
          <Offset>0</Offset>
        </Line>
      </Lyrics>
    </Track>
    <Track id="2">
      <Name>Acoustic Guitar</Name>
      <InstrumentSet><Type>steelGuitar</Type></InstrumentSet>
      <Properties>
        <Property name="Tuning"><Pitches>40 45 50 55 59 64</Pitches></Property>
        <Property name="DiagramCollection">
          <Items>
            <Item id="0" name="Am" />
            <Item id="1" name="C/G" />
          </Items>
        </Property>
      </Properties>
    </Track>
  </Tracks>
  <MasterBars>
    <MasterBar>
      <Key><AccidentalCount>0</AccidentalCount><Mode>Minor</Mode></Key>
      <Time>4/4</Time>
      <Section><Text>Intro</Text></Section>
      <Bars>0 10 20</Bars>
    </MasterBar>
    <MasterBar>
      <Key><AccidentalCount>0</AccidentalCount><Mode>Minor</Mode></Key>
      <Time>4/4</Time>
      <Section><Text>Verse 1</Text></Section>
      <Bars>1 11 21</Bars>
    </MasterBar>
  </MasterBars>
  <Bars>
    <Bar id="0"><Voices>0 -1</Voices></Bar>
    <Bar id="1"><Voices>0 -1</Voices></Bar>
    <Bar id="10"><Voices>10 -1</Voices></Bar>
    <Bar id="11"><Voices>11 -1</Voices></Bar>
    <Bar id="20"><Voices>20 -1</Voices></Bar>
    <Bar id="21"><Voices>21 -1</Voices></Bar>
  </Bars>
  <Voices>
    <Voice id="0"><Beats>0</Beats></Voice>
    <Voice id="10"><Beats>10 11</Beats></Voice>
    <Voice id="11"><Beats>12 13</Beats></Voice>
    <Voice id="20"><Beats>20 21</Beats></Voice>
    <Voice id="21"><Beats>22</Beats></Voice>
  </Voices>
  <Beats>
    <Beat id="0"><Rhythm ref="0" /><Notes>0</Notes></Beat>
    <Beat id="10"><Rhythm ref="1" /><Notes>10</Notes></Beat>
    <Beat id="11"><Rhythm ref="1" /><Notes>11</Notes></Beat>
    <Beat id="12"><Rhythm ref="1" /><Notes>12</Notes></Beat>
    <Beat id="13"><Rhythm ref="1" /><Notes>13</Notes></Beat>
    <Beat id="20"><Rhythm ref="1" /><Chord>0</Chord><Notes>20</Notes></Beat>
    <Beat id="21"><Rhythm ref="1" /><Notes>21</Notes></Beat>
    <Beat id="22"><Rhythm ref="0" /><Chord>1</Chord><Notes>22</Notes></Beat>
  </Beats>
  <Notes>
    <Note id="0"><Properties><Property name="Midi"><Number>36</Number></Property></Properties></Note>
    <Note id="10"><Properties><Property name="Midi"><Number>60</Number></Property></Properties></Note>
    <Note id="11"><Properties><Property name="Midi"><Number>62</Number></Property></Properties></Note>
    <Note id="12"><Properties><Property name="Midi"><Number>64</Number></Property></Properties></Note>
    <Note id="13"><Properties><Property name="Midi"><Number>65</Number></Property></Properties></Note>
    <Note id="20">
      <Properties>
        <Property name="Midi"><Number>60</Number></Property>
        <Property name="String"><String>4</String></Property>
        <Property name="Fret"><Fret>1</Fret></Property>
      </Properties>
    </Note>
    <Note id="21">
      <Properties>
        <Property name="Midi"><Number>64</Number></Property>
        <Property name="String"><String>5</String></Property>
        <Property name="Fret"><Fret>0</Fret></Property>
      </Properties>
    </Note>
    <Note id="22">
      <Properties>
        <Property name="Midi"><Number>67</Number></Property>
        <Property name="String"><String>5</String></Property>
        <Property name="Fret"><Fret>3</Fret></Property>
      </Properties>
    </Note>
  </Notes>
  <Rhythms>
    <Rhythm id="0"><NoteValue>Whole</NoteValue></Rhythm>
    <Rhythm id="1"><NoteValue>Half</NoteValue></Rhythm>
  </Rhythms>
</GPIF>`;

describe("gpifToMusicXml", () => {
  it("converts GP7/8 tracks, fingerings, chords, sections, tempos and vocal lyrics into parseable MusicXML", () => {
    const xml = gpifToMusicXml(SAMPLE_GPIF, "Fallback");
    const sheet = parseMusicXml(xml, "Fallback");

    expect(sheet.title).toBe("Campfire Study");
    expect(sheet.composer).toBe("Test Artist");
    expect(sheet.tempo).toBe(92);
    expect(sheet.keySignature).toBe("Am");
    expect(sheet.bars).toHaveLength(2);

    // Drums are dropped; Acoustic Guitar is ordered ahead of Lead Vocals
    expect(sheet.source?.parts.map((p) => p.name)).toEqual(["Acoustic Guitar", "Lead Vocals"]);
    expect(sheet.source?.partName).toBe("Acoustic Guitar");

    // Exact guitar string/fret preserved (GP string 4 = B string = index 1; GP string 5 = high E = index 0)
    expect(sheet.bars[0].notes[0].midi).toBe(60);
    expect(sheet.bars[0].notes[0].string).toBe(1);
    expect(sheet.bars[0].notes[0].fret).toBe(1);
    expect(sheet.bars[0].notes[1].midi).toBe(64);
    expect(sheet.bars[0].notes[1].string).toBe(0);
    expect(sheet.bars[0].notes[1].fret).toBe(0);

    // Sections, tempos, chord symbols and vocal lyrics (available even while Guitar is active)
    expect(sheet.bars[0].section).toBe("Intro");
    expect(sheet.bars[1].section).toBe("Verse 1");
    expect(sheet.bars[1].tempo).toBe(104);
    expect(sheet.bars[0].chordSymbols).toEqual(["Am"]);
    expect(sheet.bars[1].chordSymbols).toEqual(["C/G"]);
    expect(sheet.bars[0].lyrics).toBe("Hello");
    expect(sheet.bars[1].lyrics).toBe("campfire");

    // Switching to Lead Vocals part works and keeps chord symbols
    const vocalPart = sheet.source!.parts[1];
    const vocalSheet = parseMusicXml(xml, "Fallback", { partId: vocalPart.id });
    expect(vocalSheet.bars[0].notes.map((n) => n.midi)).toEqual([60, 62]);
    expect(vocalSheet.bars[0].chordSymbols).toEqual(["Am"]);
    expect(vocalSheet.bars[1].chordSymbols).toEqual(["C/G"]);

    // Full downstream pipeline (timeline + deck) succeeds
    const tl = buildTimeline(sheet);
    const deck = buildDeck(sheet, tl);
    expect(deck.cards.length).toBeGreaterThan(0);
  });

  it("rejects non-GPIF XML cleanly", () => {
    expect(() => gpifToMusicXml("<score-partwise/>")).toThrow(/GP7\/8/i);
  });
});

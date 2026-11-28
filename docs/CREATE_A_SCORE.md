# Create a score with your agent

Use your own agent to turn a source you choose into a guitar practice score, or to compose an
original study. Piekey imports MusicXML; it does not send your source to an agent,
fetch the linked music, or convert PDFs inside the app.

Arrange for standard guitar tuning, E–A–D–G–B–E from low to high; the app's fretboard and
fingerings assume it. If a source uses another tuning, ask for a standard-tuning arrangement
and have the agent explain the changes.

## First use

1. In **Song**, open **Create a score with your agent** and copy the prompt. The canonical prompt
   is also in [`src/tunes/agentPrompt.ts`](../src/tunes/agentPrompt.ts), exported as
   `MUSICXML_AGENT_PROMPT`.
2. Paste it into the agent you choose. Replace the bracketed fields with your source URL or
   attached file, the excerpt/arrangement you want, and your playing level. An original study is
   a useful option when you have no source. You can leave optional key/tempo details to the agent.
3. Choose a private output folder outside this repository, for example
   `~/Music/Fretboard Scores/`. Ask for a `.musicxml` file. If the agent returns XML text, save
   just the XML as a UTF-8 plain-text file with that extension, without Markdown fences.
4. In **Song → Library → Import MusicXML**, choose the file, or drop it onto Song. Check the
   melody part/voice, sounding range and warnings in the preview. Choose **A separate tune or
   arrangement** unless you intend to replace a saved score and retain its history.
5. Import it, listen to the first phrase, and compare it with your source before practicing.
   Return any wrong note, rhythm, chord or octave to the agent with the printed bar number.

For a first request, an eight-bar melody with chord symbols at a comfortable tempo is easier to
check than a full arrangement. Say whether you want a faithful transcription or a simplified
exercise; those are different musical results.

## What to check

- **The right music:** title, attribution, excerpt and arrangement match your request. The agent
  should identify changes and uncertain transcription, rather than silently fill gaps.
- **The right sound:** the preview reports sounding notes. In the app's current import convention,
  ordinary treble-clef guitar XML uses written pitches one octave above the intended sound:
  XML E3 becomes sounding E2. The prompt avoids `transpose` and `clef-octave-change` to keep this
  explicit. Do not lower those written pitches again. Check other notation players separately;
  their guitar/transposition conventions may differ.
- **Readable practice material:** use one melody voice on the first staff. The importer lets you
  select a melody part/voice, uses its first staff, and does not apply general instrument
  transposition. Grace/cue notes are omitted from practice scoring. Explicit chord symbols are
  the most direct way to make chord-change exercises available.
- **Correct rhythm:** the agent should parse the XML and check measure durations, rests, ties,
  pickups and repeat order. Well-formed XML alone does not prove a correct transcription.

The app accepts part-wise MusicXML (`.musicxml`/`.xml`) and compressed `.mxl` imports. The prompt
requests an uncompressed score-partwise 3.1 or 4.0 file to keep creation and inspection simple.
This is not a promise to preserve every MusicXML engraving or performance feature.

## If the source cannot be read

Give the agent a readable file or excerpt that you are authorized to use. Do not ask it to bypass
access controls. A web page may expose no usable notation, and an agent may have no browser,
audio or OCR tools. It should describe that limitation instead of claiming a conversion.

PDFs, photographs, tablature and recordings require transcription. Treat OCR or automatic
transcription as a draft: verify the notes, rhythm, accidentals and octave against the source.
When that cannot be done reliably, use a MusicXML export from your notation editor, supply
readable notation, or request a clearly labeled original study. Import success alone does not
verify musical accuracy.

## Keep source and sharing decisions clear

Keep a short note with the source, composer/arranger where known, conversion method and changes.
For public-domain or redistributable output, record supporting evidence for both the composition
and the particular arrangement/edition in the relevant jurisdiction. A public-domain melody
does not make every modern edition or recording public domain.

Personal scores stay in your private folder and browser library, outside the published source.
Importing or converting music does not grant permission to redistribute it or change its license.
Use **Devices → Save file** for a full `.fretpack` backup of your imported library, practice history
and stored recordings.

/** User-copyable instructions; the app never sends this prompt or a score to an agent. */
export const MUSICXML_AGENT_PROMPT = `Create a guitar practice score that I can import into Fretboard Focus Lab.

Source: [paste a source URL, attach a file, or ask for an original study]
What I want: [piece/excerpt and melody or simplified melody with chord symbols]
My playing: [skill level, comfortable range/frets; optional key and tempo]
Tuning: standard guitar E–A–D–G–B–E, low to high. The app's fretboard and fingerings assume this. Flag any source that needs another tuning and explain changes needed to arrange it for standard tuning.
Save as: [private local folder/filename.musicxml, outside the app's source repository]
Sharing: [personal practice by default; if redistribution is wanted, say where and under what permission]

If essential details are missing, ask one short set of questions about the source, arrangement and playing level before writing music. Start with a short, useful excerpt if I have not requested a full piece.

Access and accuracy
- Use material I provide or explicitly authorize you to access. Do not bypass sign-ins, paywalls, DRM or other access controls. If you cannot open or extract the source with your available tools, say exactly what is inaccessible and ask for an authorized file or excerpt. Never invent a transcription or claim you fetched, heard or checked something you did not.
- A PDF, photo, tab or audio recording needs transcription before import. Use available tools only; mark OCR/transcription uncertainties and verify pitches and rhythms against the source. If reliable conversion is not possible, request readable notation/MusicXML or offer an original exercise, clearly distinguished from the source.
- For an original study, compose new music. If I request public-domain or redistributable material, give evidence for the composition AND the particular arrangement/edition in the relevant jurisdiction; an old composition alone is not sufficient. Do not invent attribution or permissions.

MusicXML for this app
- Deliver a UTF-8, uncompressed .musicxml file using score-partwise 3.1 or 4.0, with a valid part-list. Put one readable melody on staff 1, voice 1 of the first part. Avoid overlapping melody voices; optional accompaniment belongs in a separate part. Do not deliver score-timewise, a PDF, or TAB-only notation as the import file.
- Match my range and difficulty. Write an explicit key signature, time signature, positive divisions value and quarter-note tempo. Give notes/rests exact durations and consistent type/dot/tuplet values. Include rests for silence. Encode pitch alterations, ties and chord changes explicitly; use harmony elements for chord symbols at their correct beats. If source harmony is unavailable, say so; label any requested new harmonization. Without usable harmony the app has no chord-change exercises.
- IMPORTANT: this app's current reader expects written guitar pitches one octave above the intended sound when using ordinary treble clef (G, line 2). Use that convention with NO transpose or clef-octave-change elements. Example: low open E2 (sounding MIDI 40) is pitch E3 in this file. Determine concert/sounding pitches first for a transposing source, then encode the guitar-written octave once. Do not apply the octave shift twice.
- Prefer an unambiguous written-out playing order. If preserving repeats/endings, encode and check their actual order. Do not rely on grace/cue notes, ornaments, lyrics or fingering being coached; grace/cue notes are omitted from practice scoring. Keep any simplification explicit.

Before delivery
- Parse the XML with an available XML tool. Check every measure's rhythmic total against its meter, including tuplets, rests and any explicitly marked pickup; stacked chord tones must not add time. Check ties and repeated playing order. Compare pitches/rhythms with the source wherever accessible.
- Report the intended SOUNDING lowest/highest notes, key, meter, tempo, bar count, changes made and unresolved uncertainties. State which checks you actually ran. If you can run this app's importer, inspect its melody selection, warnings and sounding range; otherwise say app import is still unverified.
- Give me the file and brief source/arrangement notes (a separate text file if needed). Tell me to check Song's import-preview range before saving, then listen to the first phrase before practicing. If you cannot create files, provide the complete XML in one code block with save instructions. Keep personal scores outside the published repository; conversion does not grant redistribution rights or put the score under the app's license.`;

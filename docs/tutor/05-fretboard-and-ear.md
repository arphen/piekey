# 05 · Fretboard and ear

Part of [the tutor plans](README.md). Related: T22 (string inference), T23 (echo cards).

## Why

Two kinds of knowledge let a player find what they want to play without reading it:

- **The fretboard map**: where every note, interval and chord tone is, from any root, in the current
  position. Without it, scales stay finger patterns that cannot be bent to fit a chord.
- **The ear**: hearing a phrase or a chord and knowing what it is on the guitar.

Both were partly covered by the removed Fretboard Lab and the chord quiz; both should now be cards in
the session, played on the guitar.

## What exists

- Positions and fingering in a window (`song/fingering.ts`); the `Fretboard` renderer.
- Echo cards (`song/ear.ts`, T23 v1): tiered phrases from the tune's home scale, played back, any
  octave.
- The chord quiz (`ear/*`), with its own engine, answers picked not played.
- Shell navigation proves the guitar can answer prompts reliably by exact pitch.

## Design: fretboard fluency

A new family, `fretboard`, with short, fast cards. Each prompt is answered by **playing**, and the
exact pitch (octave included) pins the location inside the position window, since the string cannot
be heard (T22). Speed matters: these cards measure response time, and fluency means fast and right.

### Card kinds

1. **Find the note.** "C" appears; play every C in the current position, low to high. Judged as a
   set; response time per note.
2. **Note on a string.** The neck highlights one string; a note name appears; play it on that string.
   The pitch identifies the fret uniquely for a given string, so this *is* checkable.
3. **Intervals by shape.** A root sounds and is shown; play the 3rd / 5th / 7th / 9th above (or
   below). The neck shows the shape after the answer.
4. **Chord tones anywhere.** A chord symbol appears (from the player's tunes); play its 3rd, then its
   7th, nearest to a given note. This is the guide-tone skill isolated, and it transfers straight to
   lines over changes.
5. **Position connect.** Play one scale degree in position 1, then the same degree in the next
   position up. Builds the links between shapes the PLAN's "one position at a time" approach leaves
   for later.

### Rules

- Content comes from the player's keys and chords, as echo cards do: no G♭ drill for someone with
  no G♭ tune, until they have one.
- Each kind is a Leitner card per key/chord quality, with response time as tempo: "clean" means all
  right and under a time goal that tightens as the box rises.
- Neck shown at first; hidden as the box rises (`memory`), returning after a miss (adaptive help).

## Design: ear, beyond T23 v1

Echo cards are the right core. Extend them along the axes a jazz player needs, keeping the same
card mechanics (listen → play back at own pace → done).

| Tier | Call | Why |
| --- | --- | --- |
| Existing 1–4 | home-scale phrases, 3–5 notes | |
| Intervals | two notes; play both back | the building block |
| Chord tones | an arpeggio over the tune's chord | hearing harmony as lines |
| Other key centres | phrases from the tune's *other* scales (the B section's key) | jazz tunes move |
| Rhythm in the call | phrases with real rhythm, judged on pitch then on onset (03) | phrases are not just pitches |
| Bass lines | the tune's roots, played back | hearing changes from the bottom |
| Chord quality | a voicing sounds; play its root, then its 3rd | hears m vs maj vs 7 by playing |
| Melody by ear | the tune's next melody phrase without the page | learning heads by ear, the jazz way |

- The page as help: shown at first, then shown only after a miss (T23's "page returns when it goes
  wrong" next step).
- **Retire the chord quiz into the deck** once chord-quality calls exist: its useful parts (confusion
  pairs, weighting) become how the planner weights ear cards. Seed `ear/engine.ts` or remove it.

## Phases

1. **Fretboard kinds 2–4** (note on a string, intervals, chord tones): pure generators, response-time
   tempo, Leitner per key/quality. *Check:* generator tests stay in window and in the player's keys;
   synthetic-player harness run; real guitar for response-time thresholds.
2. **Ear: intervals, chord tones, other key centres.** New tiers in `song/ear.ts`, adaptive page.
3. **Ear: rhythm calls, bass lines, melody by ear.**
4. **Chord quality by playing; fold or retire the quiz.**
5. **Fretboard kinds 1 and 5.**

## Tests

Generator constraints (window, keys, determinism), set judging for "find the note", response-time
scoring. Pure.

## Risks

- **Octave-ambiguous prompts.** Only ask what pitch can answer: "this note on this string", not "this
  note on any string at fret X".
- **Speed pressure versus calm UI.** Response time is measured, not shown as a countdown; it appears
  as a number on the result.

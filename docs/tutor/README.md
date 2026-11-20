# Becoming a dynamic tutor

Plan set written **2026-11-17**. These documents describe how the app grows from a well-built
practice session into a tutor that knows the player, chooses what to work on, and gets out of the
way while they play. They are plans, not status: what exists is in
[../CURRENT_STATE.md](../CURRENT_STATE.md), open `todo` items in [../BACKLOG.md](../BACKLOG.md).
Where a plan overlaps a `T*` item it says so; finish or update that item rather than building a
second version.

## The student

Taken from [PLAN.md](../../PLAN.md), the saved preferences, and what the library holds:

- Acoustic guitar through a Scarlett 2i2. Frets 0–10 by default; the whole neck is opt-in.
- Knows the major scale in several positions and the routine scale → thirds → triads → 7ths.
- Learning jazz standards (Autumn Leaves, In a Sentimental Mood, Take the A Train) and Samba Pa Ti:
  arpeggios over changes, guide tones, swing, comping.
- Practises hands-on: full screen, the guitar is the controller, the app reacts and never lectures.

## What a student needs that the app does not do yet

The session is strong at one thing: take a card, hear it, play it slowly, play it in time, move the
box. A teacher does five more things.

| A teacher… | Today | Plan |
| --- | --- | --- |
| **Knows you.** Remembers *what kind* of mistakes you make, not just which card failed. | One Leitner box per card; `Attempt` keeps result, tempo and share. No idea *why* a card failed. | [01 Student model](01-student-model.md) |
| **Shapes the lesson.** Warm-up, one focus, mixed review, something to play for joy, and stops before you are fried. | `planSession`: due + a few new + scale warm-up. No time budget, no focus, no arc across days. | [02 Session planner](02-session-planner.md) |
| **Fixes your time.** Rhythm is what separates players who sound good from those who know scales. | Click follows tempo; pass/fail is mostly pitch. No swing, no groove measurement, no rhythm-only work, no strumming. | [03 Time and rhythm](03-time-and-rhythm.md) |
| **Teaches the instrument's harmony.** Chords, voicings, changes and comping, not just single lines. | Voicing cards exist; free play cannot hear chords; no chord-change speed work, no comping. | [04 Chords and comping](04-chords-and-comping.md) |
| **Builds the map in your head.** Fretboard knowledge and ears, so you can find what you hear. | Echo cards (T23) v1; fretboard knowledge only implicit through positions. | [05 Fretboard and ear](05-fretboard-and-ear.md) |
| **Gets you making music.** Improvising, not only reproducing. | Nothing asks the player to invent. | [06 Improvisation](06-improvisation.md) |
| **Aims at songs and shows the road.** Goals, memorising, performing, hearing yourself improve. | Tunes are a source of cards; no goal, no run-through, no recordings, stats are per session (T3). | [07 Repertoire and performance](07-repertoire-and-performance.md) |

## Principles every plan keeps

These are the project's rules, restated so a plan cannot drift from them.

1. **React, don't instruct.** Text states what was heard or what state things are in; it is empty
   while the player plays. Encouragement is ambient (warmth, glow, a quiet sound), never praise.
2. **The guitar is the controller.** Every new action has a played gesture shown on screen. In free
   or improvised playing every note is music, so only the guitar menu (D♯5 three quick strikes, or hold · release · hold) works there.
3. **Adaptive help over toggles.** The page, the neck, the guide melody, the click come and go with
   how it is going, not with a switch.
4. **One system.** New material is a deck family or a card kind in the existing session
   (`useSession`, `SongCoach`, the Leitner store), not a new engine. Ear's chord quiz is the
   cautionary tale.
5. **Honest about the signal.** Input is mono. Which string was played is inferred, never heard
   (T22). Chord recognition and timing are measured, so they get accuracy checks before they judge.
6. **Reproducible.** Any generated material is seeded. `src/core/` stays pure.
7. **Storage keys stay stable.** New data gets new keys; old keys are read as before.

## How the plans fit together

```
          ┌──────────── 01 Student model ────────────┐
evidence  │  per-attempt detail → skill profile       │  profile
from every│  (pitch, time, tempo, chords, ear, …)     │──────────┐
session ─▶└───────────────────────────────────────────┘          ▼
                                                     02 Session planner
   03 time · 04 chords · 05 fretboard/ear ·          (time budget, focus,
   06 improvisation · 07 repertoire                   review, play, stop)
   = new card families/kinds and new evidence                │
                         ▲                                    │ plan
                         └──────────── SongCoach session ◀────┘
```

01 is the spine: the other plans add *material* and *evidence*; 02 turns evidence into the next
session. Without 01, every new family is one more box to keep full.

## Order of work

Each phase ends playable and checked with a guitar. Phases are sized so one can ship in a few
sittings.

| Phase | Work | Why first |
| --- | --- | --- |
| **A. Listen better** | 01 phase 1 (per-note evidence on attempts), 03 phase 1 (timing measurement, gap click). | Everything adaptive depends on knowing what went wrong. Timing data is nearly free once notes are scored. |
| **B. Plan better** | 02 phases 1–2 (time budget, shaped session, focus from the profile), 01 phase 2 (skill profile). | Turns the new evidence into a different, better session the next day. |
| **C. Chords** | 04 phases 1–2 (chord recognition with an accuracy check, chord-change drills, comping cards). | Biggest musical gap for a jazz-standards player; unlocks free play steering (T19). |
| **D. Make music** | 07 phases 1–2 (song goal, memory ladder, run-through, recordings), 06 phase 1 (guided improv over a vamp). | Gives the practice a destination and a reason. |
| **E. Fill the map** | 05 (fretboard fluency, wider ear calls), 03 phase 3 (swing, rhythm reading), 06 phase 2. | Depth once the loop is right. |

Stats (T3) is not its own plan: it falls out of 01 (profile) and 07 (progress over weeks).

## What "better tutor" means, measurably

A plan is working when, over four weeks of normal use:

- Sessions differ day to day because of what happened before, and the player can see why (the focus
  is named in one line on the ready screen).
- Mistake classes shrink: the profile's top weakness at week 1 is measurably smaller at week 4.
- Tempo ceilings rise on cards that are *clean*, not on cards that are merely played.
- At least one tune is played start to finish, from memory, with the band, and recorded.
- No new screen needs the mouse during a session.

## Documents

1. [01-student-model.md](01-student-model.md) — evidence, mistake classes, skill profile.
2. [02-session-planner.md](02-session-planner.md) — time-budgeted sessions with a focus and an arc.
3. [03-time-and-rhythm.md](03-time-and-rhythm.md) — timing measurement, gap click, swing, rhythm cards, picking evenness.
4. [04-chords-and-comping.md](04-chords-and-comping.md) — chord recognition, changes drills, voicing ladder, comping.
5. [05-fretboard-and-ear.md](05-fretboard-and-ear.md) — note finding, intervals, chord tones anywhere; ear calls beyond the home scale.
6. [06-improvisation.md](06-improvisation.md) — answer phrases, chord-tone targeting, constraints.
7. [07-repertoire-and-performance.md](07-repertoire-and-performance.md) — song goals, memorising, run-throughs, recordings, long-term progress.

## Status (2026-11-17)

What has a first version in code, per plan. Everything below is unit-tested and typechecked; the
session screens were rendered in headless Chrome with a synthetic player. None of it has been played
with a real guitar yet, so thresholds (spread, latency, prompt times, landing share) are first
guesses to tune by ear.

| Plan | Built | Still open |
| --- | --- | --- |
| 01 Student model | Evidence on every attempt; profile (axes, mistake classes, ceilings) | Kinship over axes; memory class; weighting evidence by calibration confidence; targeted variations by weakness |
| 02 Session planner | Length on the ready screen; warm-up / focus / review / music; arcs; run-through bars as focus; new cards by success zone | Fatigue cut-off; cool-down and rest beat; block marks on the progress line |
| 03 Time and rhythm | Latency play-along; per-note offsets; timing strip; gap click (box 4, time arcs); comping onsets | 2-and-4 click; swing ratio; rhythm-only and strum-pattern cards; picking evenness; time in passing |
| 04 Chords and comping | Strum-timed changes; comping 2 and 4 / Charleston; free play hears loops and offers the card | Drop-2 ladder; accuracy check on a real acoustic; logging progressions |
| 05 Fretboard and ear | Notes on a string, thirds by shape, chord tones (timed); two-note, arpeggio and other-key echoes | Position connect, find-every-note; rhythm and bass-line calls; chord-quality calls; folding the quiz |
| 06 Improvisation | Improvise card per section: chord tones on one and three, lit on the neck | Answer the phrase, three notes only, guide-tone targets, motif, trading fours |
| 07 Repertoire | Run-through card, bar map, weak bars to focus; recorded takes, first vs latest on the overview; tune path; "Your playing" | Explicit goal and tempo per tune; memory ladder; suggested next tune; lead-sheet-only tunes |

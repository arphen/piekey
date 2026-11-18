# 03 · Time and rhythm

Part of [the tutor plans](README.md). Related: T13, T16, T21.

## Why

Listeners forgive wrong notes; they do not forgive bad time. For a player working on jazz standards,
time is also where the style lives: swing eighths, laying back, comping on 2 and 4. Most practice apps
check pitch and treat time as "close enough". The app already has a click that follows the player and
a beat meter; the next step is to **measure time properly, train it on its own, and make it part of
passing**.

## What exists

- In-time phase with a click starting ~12 % under the player, raising on clean passes, lowering on
  short ones (`useSession`).
- `tunes/usePlayback.ts` scores notes against the timeline with timing windows (wider at the edges).
- A beat meter showing ahead/behind/on; free play's `stepLock` moods (`song/freeplay.ts`).
- Scale rhythm stages: quarters, triplets, sixteenths (`RHYTHMS`).
- Onset detection (`pitchDetection.ts`) for single notes.

Missing: a stored timing measure, swing, rhythm-only material, internal-time training, strumming,
picking evenness.

## Design

### 1. Measure time

For every in-time pass record, per landed note, the signed offset from the grid in ms (the scorer
already computes it to decide in/out of window). Summarise into the `Evidence` of [01](01-student-model.md):
mean offset, spread (standard deviation), rush/drag shares. Correct for **latency** first: add a
one-time latency check to calibration (play along to eight clicks; the median offset is the input+
output latency) and store it with `guitar-calibration`. Without that, every player looks late.

Time becomes an axis of passing, gently: a pass with right notes but spread > ~45 ms at the card's
tempo counts as "ok", not "clean". Thresholds per tempo (spread allowance shrinks as the beat gets
shorter, in proportion to beat length).

On screen, after a pass only: a thin **timing strip** under the material, each note a tick left or
right of its beat, coloured by the existing palette. Facts, no words. During playing, nothing new.

### 2. Internal time: the gap click

The single most useful time exercise. The click plays for N bars, then drops out for M bars, then
returns; the player keeps going. When it comes back, how far did they drift?

- A card **modifier**, not a family: any card already clean in time can get a gap-click visit.
- Starts at 2 bars on / 2 off; lengthens the gap as the drift stays under ~1/16 note. Measured by the
  offset of the first notes after the click returns.
- Variants that come later: click on **2 and 4 only** (the jazz feel), click on beat 1 only, click
  once every two bars.

### 3. Swing

- Measure the **swing ratio** of eighth-note lines in time: long/short duration ratio, from onsets.
  Straight is 1:1, hard swing ~2:1; jazz at medium tempo sits near 1.6–1.8 and straightens as tempo
  rises.
- Tunes with a swing marking (or the player's jazz tunes by default) score eighths against a swung
  grid; the playback band already swings or can. The target ratio is a range, not a value.
- Feedback is the timing strip with the swung grid, plus one number after the pass: "swing 1.4".

### 4. Rhythm cards

A new card kind in the `reading` family: **rhythm lines** on one pitch (or a muted strum, see 5).

- Generated (seeded) from a small rhythm vocabulary by level: quarters/eighths → rests and ties →
  syncopation (anticipations, the Charleston) → triplet figures → sixteenth figures.
- Also lifted from the player's tunes: the melody's rhythm on one note. Learning a tune's rhythm
  separately from its pitches is how many players learn heads.
- Judged on onsets only. Shown in notation (VexFlow already renders rhythms).

### 5. Strumming and comping rhythm

Strummed chords make one broadband onset; onset detection handles that better than pitch detection
handles chords. So rhythm on strummed chords can ship **before** chord recognition ([04](04-chords-and-comping.md)):

- Strum-pattern cards: down-strum quarters, bossa, Freddie Green four-to-the-bar, Charleston comping,
  judged by onset timing only (any chord, or muted strings).
- Down/up direction cannot be heard reliably on an acoustic; patterns are judged by *when*, not *how*.

### 6. Picking evenness

From onsets on scale cards: inter-onset interval spread and onset-level spread across sixteenths.
Uneven groups of four (the "gallop") are a classic alternate-picking fault. Evidence field
`evenness`; the profile names it as a class when it persists. No new card needed; the scale
sixteenths stage is the drill.

### 7. Tempo ceilings

Track per topic (scale + pattern, tune section) the fastest clean tempo and the slowest failing one
over time (01's `ceilings`). Raising a ceiling is a natural focus arc for the planner: work at
ceiling − 8 bpm until clean, then step. This is the "metronome-first" request in T16, driven by data
instead of a separate track.

## Phases

1. **Latency check, offsets, timing strip.** Latency step in calibration; offsets into evidence;
   strip after passes. *Check:* scripted takes with known offsets yield the right mean/spread; real
   guitar against the click to confirm latency correction (unverified until done).
2. **Gap click and 2-and-4.** Modifier on clean cards; planner can schedule it. *Check:* synthetic
   player drifting at a known rate is measured correctly; then by ear.
3. **Rhythm and strum cards.** Generator (seeded) + tune-rhythm extraction; onset-only judging.
4. **Swing.** Ratio measurement, swung scoring for marked tunes. Needs a real-guitar check that the
   measurement is stable before it can affect passing.
5. **Time in passing.** Spread thresholds affect clean/ok; only after phase 1 data from real sessions
   shows the numbers are trustworthy.

## Tests

Offset/spread/ratio math on synthetic onset lists; gap-click drift measurement; rhythm generator
determinism and level constraints; onset-only judging. Not the strip's rendering.

## Risks

- **Latency and detector lag** dominate small offsets. Calibrate first, and never show ms values
  until the latency step has run.
- **Acoustic onsets** for soft notes and slurs are late or missing; judge legato passages on pitch
  and let onset-based time apply to picked notes only.
- **Nagging.** The strip appears after passes, not during; time affects passing only once trusted.

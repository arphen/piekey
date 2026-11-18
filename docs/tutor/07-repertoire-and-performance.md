# 07 · Repertoire and performance

Part of [the tutor plans](README.md). Related: T3 (stats), T6 (only these bars).

## Why

Practice needs a destination. For this player the destination is tunes: play Autumn Leaves through,
with the band, from memory, at a real tempo, then improvise a chorus on it. Today a tune is a source
of cards; nothing aims at playing it whole, nothing records it, and progress is visible only one
session at a time. A teacher sets the goal, works backwards to what it needs, and plays you a
recording from last month so you can hear how far you came.

## What exists

- MusicXML library, playback with repeats/endings, Learn / Play along / Wait for me modes.
- Deck generation per tune: melody chunks, harmony, chords, reading, ear.
- Memory cards (`memory`, `hideBars`), spot shortening.
- `song/stats.ts` (`cardTrend`, `sessionTrend`, `totals`), session trend on the done screen, the
  circle-of-fifths map.

## Design

### 1. A tune goal

Choose a tune (the overview's current song) and a target: **tempo** (default: the tune's marked tempo,
or a style default) and **level** — head / head + comping / head + comping + a chorus of improvising.

From the goal, derive a **path**: the cards the goal needs, ordered by `needs`, each with a target
box and tempo. This is mostly already in the deck; the new part is a *finish line* per card (box ≥ 3
and tempo ≥ goal × 0.9) and a single progress number for the tune: share of path cards past their
finish line. The overview shows it per song; the planner's music block (02) pulls from the path.

### 2. Memory ladder

Memorising a head is a skill with stages; the app can fade the page:

1. Full score.
2. Chord symbols and the first note of each phrase only.
3. Chord symbols only.
4. Nothing: the bar count and the cursor.

Per section, as a card modifier on melody cards. The stage rises after clean passes and falls back
one stage after a miss in a bar (adaptive help, bar by bar). T6's "only these bars" view is the
natural companion: learning a chunk shows only its bars.

### 3. Run-through

A distinct mode at the end of the path, and the closest thing to a performance:

- The whole tune (or a section) once through with the band at the goal tempo, **no stopping**:
  mistakes do not pause or restart anything. The click does not adapt during the run.
- At the end, a bar-by-bar map of what landed. The weakest bars become spot cards in the next
  session's focus.
- Optionally recorded (below).

Runs are where "knowing the parts" turns into "playing the tune"; recovering from a mistake without
stopping is a skill the card loop never trains.

### 4. Recordings

- `MediaRecorder` on the shared input stream; save takes to **IndexedDB** (not `localStorage`; the
  quota risk in CURRENT_STATE applies). New store `guitar-recordings`; keep the last N per tune
  (default 10) plus any the player keeps.
- Record automatically on run-throughs and on the first clean in-time pass of a new card each week
  (short clips). No record button in the session; keep/discard on the result screen by note key.
- **Then and now**: the tune's page offers "first take vs latest take", played back to back. This is
  the most motivating thing a practice app can show, and it is honest: the player judges with their
  own ears.
- Recordings stay local; no export unless asked for later.

### 5. Progress over weeks (T3)

A **Progress** view, reachable from the overview by the shell cursor, built from the profile (01) and
the stores:

- Minutes per week; clean share per week; per-axis level and trend (01).
- Per tune: path progress, tempo of each section over time, recordings timeline.
- Per topic: tempo ceiling over time (03).
- Weaknesses resolved: arcs that ended and how much their strength fell (02).

Numbers and small charts only, no commentary. Reuse `cardTrend`/`sessionTrend`; follow the `dataviz`
skill for chart design.

### 6. Bringing in new tunes

Repertoire grows when adding a tune is easy. Keep MusicXML import; add:

- A **suggested next tune** chosen by overlap with what is already learned (keys, progressions,
  voicings in the profile) and one new thing. Suggestions come from a small built-in list of standards
  the player can import scores for; no network.
- Lead-sheet-only tunes (chord symbols, no melody) are valid: they get chords, comping, improv and
  ear-by-bass cards, no melody cards.

## Phases

1. **Goal, path, progress number; memory ladder.** *Check:* pure tests for path derivation and finish
   lines from a fixture deck/store; harness screenshots of the overview.
2. **Run-through mode and bar map.** Weak bars feed the planner. *Check:* scripted run, map correct.
3. **Recordings** (IndexedDB, auto-capture, then/now). *Check:* by hand in Chrome; record what was
   verified.
4. **Progress view.**
5. **Suggested next tune, lead-sheet-only tunes.**

## Tests

Path derivation and finish lines, memory-stage transitions, run-through bar map, recording retention
policy (pure parts). Not the charts' rendering.

## Risks

- **Goals that never finish.** A goal path should be weeks, not months: default goal tempo for a
  first run-through is 75 % of the marked tempo, raised after a recorded run.
- **Storage.** Audio is large; IndexedDB with a retention cap, and a visible count of what is kept.

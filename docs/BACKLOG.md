# Backlog

> **Note (2026-11-16):** the legacy Practice tab, Fretboard Lab, standalone sight reading and the old
> ii–V–I Changes drill have since been removed. Items below that name `ChangesView`, `ReadingView`,
> `CoachPanel` or `SessionPanel` describe code that no longer exists; read them as history.
>
> **Tutor plans (2026-11-17):** the longer-term direction (student model, session planner, time,
> chords, fretboard/ear, improvisation, repertoire) is in [tutor/README.md](tutor/README.md). Those
> plans reference the `T*` items they overlap; finish or update the item rather than duplicating it.

Triage of the root [`todo`](../todo) file against the code as of **2026-11-16**. The original text
is informal and groups several ideas per paragraph; this document assigns one ID per coherent
request (`T1`–`T22`), records what already exists, and states the remaining work. Product context
and current behavior live in [CURRENT_STATE.md](CURRENT_STATE.md); implementation details live in
[ARCHITECTURE.md](ARCHITECTURE.md).

**Status legend**

- **SHIPPED** — the requested behavior exists in the modern Tunes/SongCoach system. Remaining notes
  are verification or polish, not missing functionality.
- **PARTIAL** — a meaningful version exists, but a stated part of the request is missing or only
  covers one view.
- **OPEN** — not implemented, or only a placeholder exists.
- **VERIFY** — code exists but was not exercised at runtime during the survey.

Most items are aimed at the modern full-screen session (`SongCoach`), not the legacy Practice tab.
Unless an item says otherwise, implement it there.

## At a glance

| ID | Request | Status | Main gap |
| --- | --- | --- | --- |
| T1 | Done-screen movement, multiple tunes/types, axes of variation | SHIPPED (v1) | Axes are fixed to tune × family; no configurable axis model. |
| T2 | Done-screen actions playable from the guitar; instrument-navigable app | PARTIAL | Done screen is fully playable; other views have no note controller. |
| T3 | Metrics over sessions per exercise and overall, performance over time | PARTIAL | Captured tune-exercise history and dated tempo observations are inspectable; shared scale archive browsing and broader totals remain open. |
| T4 | Done-screen visual fidelity; micro/macro/mini attention design; refreshing music | SHIPPED (v1) | Subjective polish and user validation remain. |
| T5 | AFK time should not keep counting | SHIPPED | Verify in a real browser. |
| T6 | Learn bars 1–3 only; hide irrelevant bars | PARTIAL | Exact playing-order passages have explicit listen/loop/practice; direct dragging and compact noncontiguous score excerpts remain open. |
| T7 | Remove patronizing/AI language; react instead of instructing | PARTIAL | Modern session is neutral; LearnView/Practice/TuneView copy remains instructive. |
| T8 | Listen again always available, triggered by a guitar note (e.g. E5) | PARTIAL | Done in SongCoach; Learn/Tune/Reading/Changes lack it. |
| T9 | Silence guidance, playback cursor, wrong-note names in score | PARTIAL | Full treatment in SongCoach; other score views only highlight the bar. |
| T10 | Audio output control, including Mac output, via guitar UI | SHIPPED | Chrome/Edge only; physically verify routing and fallback. |
| T11 | Listen / your pace / in time selectable by guitar | SHIPPED | Verify assigned keys on real hardware. |
| T12 | Leniency for first/last note | SHIPPED | Verify with real detection; last note can still be coloured red but no longer fails a clean take. |
| T13 | Approximate progress/vibe; estimator per material; metronome under player, raise on clean | SHIPPED (v1) | Long-term trends and explicit mood cues remain. |
| T14 | Better session-end language and pacing | SHIPPED (v1) | Subjective; legacy LearnView copy remains. |
| T15 | Stronger playback-position highlight in the score | PARTIAL | Cursor exists in SongCoach only; other views use bar shade only. |
| T16 | Scale last-note bug, encouragement, metronome-first work, rhythms and melodic patterns | PARTIAL | Gap click from box 4 and tempo ceilings in the profile (2026-11-17); no BPM history chart. |
| T17 | Stage notes → rhythm → melody; exercises influence each other; avoid endless cards | PARTIAL | Stages and scale kinship exist; kinship does not cover arpeggios/guide tones/voicings. |
| T18 | ii–V–I switch less jarring; listen-again and metronome from guitar anywhere | PARTIAL | Changes now runs in SongCoach (guitar gestures, listen again, tempo); no dedicated "play the progression" card yet. |
| T19 | Free-play logging, key/exercise categorization, passive tree, Leitner integration, react to playing | PARTIAL | Strummed loops recognised and routed to voicings cards (2026-11-17); progressions not logged, tree still read-only. |
| T20 | Unplug/replug interface should not kick the player out or require reload | SHIPPED (code) | Runtime unverified; verify pause/resume and output fallback. |
| T21 | Metronome discipline; communicate slow down/speed up; back off on mistakes; hear V–I; next from guitar | SHIPPED (v1) | Session mood is mostly visual; explicit sonic cues and a first-class "slow down" signal remain. |
| T22 | Detect the string a note was played on | OPEN | String is inferred from position/fingering, not heard. |
| T23 | Ear as call-and-response: hear a phrase, play it back (tiered, in the songs' keys, page as a help first) | PARTIAL (v1 built) | Two-note, chord-arpeggio and other-key calls added (2026-11-17); feel untuned, no adaptive page, no chord-quality calls. The chord quiz stays behind a button. |

## Recommended next steps

**SOL continuation (2026-11-18):** memory cards now fade page → bar-start notes → hidden with
explicit played reveal and conservative visit-wide help/exposure. Due later-day checks require
the same known arrangement; alternate-start transfer remains open. T3 goal counters can check a
bounded complete journal group after the display history trims. Progress now browses the same
captured tune history by exercise with dated clean-tempo dots, conditions and attempt details;
shared scale archive browsing and planner archive integration remain open. T6 adds deliberate
start/end choices naming repeated-bar occurrences, with arrangement-qualified exact-passage
practice in the same coach. T2 recording comparisons now have real played-cursor
Play/Pause/Restart/seek controls on one shared output. The original studies have playable articulated
accompaniments and optional edited study cues. Agent briefs offer selected-tune/all-music scope,
7/28/90-day periods, human preview and nested field allowlisting. Real instrument/phone gates stay open.


**SOL implementation (2026-11-18, code verified; hardware verification open):** Practice/Songs/
Progress is the primary hierarchy; focus modes remain under Explore. T3 now has a dedicated
Progress surface, comparable retained audio and sample-counted cross-tune observations. Captured
tune-exercise history is now inspectable beyond the recent cap. T6/T15 score browsing selects a phrase before
explicit listening/loop/practice and restores browse position. T17 gains immutable, arrangement-bound
musical goals and goal-aware planning; T16/T21 use actual stable assessed-pass tempo, excluding
self-guided activity and varying run-throughs from clean-speed claims. T18 gains standalone tuner/
metronome Tools on the shared input/transport. T23 calls have seeded rhythm/rest/repeated-note
variety; their own-pace response is not a performed-BPM claim. Recording failure rescue, named
partial-library repair, portable backup policy, active-window ownership, local fonts and visible
offline/update state are implemented. None closes the real-guitar/mobile acceptance work. See
[SOL_IMPLEMENTATION.md](SOL_IMPLEMENTATION.md) and [SUPPORTED_SETUPS.md](SUPPORTED_SETUPS.md).

**Demo/agent/timing update (2026-11-18):** original Blue Hour and First Steps are accessible from
the empty Tutor and Song's persistent demo shelf, with direct listening/practice and XML download.
A score-creation prompt and explicit read-only practice-brief export bridge to a user's own agent.
T16/T21 timing now separates bounded constant alignment from scatter/drift in timed passes and
Free play; phase alone does not penalize the profile or tempo. Raw evidence/calibration remain
unchanged. Browser/audio/physical timing verification remains open. The broader proposal is
[SOL_OPINION.md](../SOL_OPINION.md); its unimplemented ideas do not change this backlog's status.

**Reliability update (2026-11-18):** direct daily-session/card entry and standalone Free play are
built. Import now previews part/voice and handles forward/backup timing, durable identities,
duplicates and explicit replacement. Large XML migrates safely to IndexedDB; save failures are
visible and Song supports backup/restore. Planning fits every block to its estimated budget and
orders mixed history chronologically. T3/T16 now report demonstrated clean tempos and musical
milestones; the per-exercise long-term chart remains open. T12/T21 now require separate attacks
for untied repeats and steady timing for tempo increases, including comping; physical guitar QA
remains necessary. Older detailed triage below is historical where it conflicts with this update.

Ordered for a clean slate, not strictly by the original list. The green baseline is restored and
the app, tests and docs are committed in reviewable pieces. The scratch parser check and both Samba
Pa Ti scores live in gitignored `tunes/staging/`.

1. **Finish the tutor entrypoint (mostly done).** Tutor is the default tab; Changes, Scales and
   Reading run as focused `SongCoach` sessions; Fretboard Lab, legacy Practice and the standalone
   sight-reading tab are removed, and the shell and Ear are playable from the guitar. Remaining:
   build Ear call-and-response (**T23**, decided: the click quiz stays for now) and confirm the
   new screens in a browser with a guitar.
2. **Extend the stats layer (T3).** Tune-exercise archive browsing is implemented. Shared scale
   archive browsing and broader cross-tune totals remain; preserve task/version/help context and
   distinguish recent materialized stores from complete captured journal groups.
3. **Extend score guidance outside SongCoach (T6, T9, T15).** Add the cursor/pulse and wrong-note
   shadow to TuneView/LearnView, and add a true "only these bars" mode to `Score` for Learn
   chunks. This directly addresses the sight-reading/keep-your-place complaints.
4. **Finish Changes (T18).** The session now reuses SongCoach; add a card that plays the tune's
   progression with a count-in and common-tone voice leading.
5. **Add chord-progression recognition to free play (T19).** Recognize strummed chords and a
   repeated progression, then route to chord-change cards. This unlocks the beginner branch and
   makes the passive tree reactive rather than read-only.
6. **Extract an app-wide guitar command layer (T2, T8, T18, T21).** The session has the right
   primitives (`GuitarPad`, `useNoteKeys`, `useToneKeys`, `useSummon`); mount a small shared layer
   in `App.tsx` so every view can offer "hear again", metronome, and next/back without duplicating
   note-assignment logic.
7. **Scale work as a first-class track (T16, T17).** Add a metronome-first scale entry, persist
   per-scale BPM history, and extend kinship beyond scale cards (arpeggios, guide tones, voicings)
   so progress in one exercise visibly feeds its relatives.
8. **Investigate string attribution (T22).** Decide whether this is a signal-processing problem
   (per-string pickup/hexaphonic input, harmonic analysis) or an accepted inference limitation.
   Do not promise true string detection from the current mono input without an experiment.
9. **Keep the gate and docs green.** Run `make check` before handoff; regenerate
   `docs/REPO_MAP.md` after moves; update `CURRENT_STATE.md`, `ARCHITECTURE.md` and this file when
   status changes. Keep new work-in-progress scores in `tunes/staging/` until they are stable
   fixtures.

## Detailed triage

### T1 — Done-screen movement and axes of variation

**Original intent.** Visualize how exercises moved; support multiple songs and different exercise
types; introduce axes of variation.

**Status: SHIPPED (v1).**

**Evidence.** `SessionSummary.tsx` renders each exercise from its old box to its new box, with a
tempo sparkline, verdict, and carried relatives. `groups` builds rows by **tune × family**, and a
mixed session shows the tune name only when more than one tune is present. `useSession` accepts
`tuneIds`; `SongCoach` builds guest decks from the library and `mixDecks` glues their ids. Families
are `scales`, `harmony`, `melody`, `chords`, `reading`.

**What remains.** The axes are hard-coded (tune, family). There is no axis model, no way to group
by kind/rhythm/box/tempo, and no filtering or expansion for large decks. "Different types of
exercises" is represented by family/kind, not by an extensible taxonomy.

**Next step.** If this matters, introduce an explicit `axis` descriptor and make the summary a
small pivot (rows = exercise, columns = box; group by one of tune/family/kind). Keep the existing
default so the current screen does not regress.

### T2 — Guitar-executable done screen and instrument-navigable UX

**Original intent.** Every next action on the done screen should be playable, with the note shown;
continue C3, metronome D2, settings C♯2; switch song and shuffle on other tones; develop a
guitar-navigable UI.

**Status: PARTIAL.**

**Evidence.** `SessionSummary.tsx` maps:

- `C3` → carry on (`KEYS.more = 48`)
- `A♯` → free play / metronome (`KEYS.free = 46`; off the open strings)
- `C♯3` → settings (`KEYS.settings = 49`)
- `F3` → Choose tune (`KEYS.tune = 53`), then review and confirm inside the practice room
- `F♯3` → shuffle (`KEYS.shuffle = 54`)

The code uses **A♯ and C♯** (any octave; open-string pitch classes are never keys), not the D2/C♯2 in the original note; the `NoteTag` labels show the
actual notes. Actions are also clickable, and the session itself uses note keys for hear/pace/time/
next, the six-string guitar menu, and held-note start. The done screen arms after a short delay so
ringing notes do not trigger actions.

**Continuation.** The shell has a played cursor. In-room tune choice now works from ready,
summary, live guitar menus and Free play, preserving the outer practice boundary. Optional
opening matching only suggests candidates after explicit arming; review and fresh confirmation
precede a change. Whole-tune/direct-note isolation and deliberate menu summon protect musical
notes. Tuner and metronome share the practice room, with played menus and an optional GPU water
surface. Real guitar ergonomics, audio/visual alignment and physical fullscreen checks remain.

**Next step.** Extract a shared command layer in `App.tsx` using the existing `GuitarPad`/note-key
primitives. Start with two global commands that pay off everywhere: **hear again** and **metronome
on/off/tempo**. Add per-view action maps only after the global layer exists.

### T3 — Metrics, performance over time, stats

**Original intent.** Show a metric over sessions for a particular exercise or all exercises in a
session; show performance over time; show stats.

**Status: PARTIAL.**

**Evidence.** `song/stats.ts` derives `cardTrend` (last 10 tempos, share, plays, delta, best),
`sessionTrend` (last 14 clean shares), `totals`, `meanShare`, and `familyOf` from the stored box.
`SessionSummary` shows session minutes/exercises/notes-landed/boxes-up, all-time sessions and
minutes, a 14-session clean-share line, per-exercise tempo sparklines, box counts and the tree.
`leitner.ts` stores `Attempt[]` history (capped at 800) and `SessionEntry[]` (capped at 200).

**2026-11-18 update.** Progress owns cross-tune observations, current goals, retained recording
comparison and an exercise browser over the captured tune journal. It survives the recent-history
trim, respects reset/conflict/deduplication semantics, and offers dated clean-tempo dots plus
inspectable assessment conditions, score versions and other attempts. Queries are bounded and
unknown on incomplete/capped/conflicted reads; shared scales are excluded because their complete
history belongs to `guitar-skills`. No new persistence format was added.

**What remains.** Shared scale archive browsing, broader cross-tune/all-library totals,
comparison between exercise types and a useful export of selected long-term observations.
The agent brief remains a selective recent-history export. Keep any new metrics contextual;
do not turn BPM across different tasks or assistance into a universal score.

### T4 — Done-screen visual fidelity, attention design, refreshing music

**Original intent.** Increase visual fidelity; implement micro/macro/mini design elements that guide
attention; play refreshing music between sessions.

**Status: SHIPPED (v1), subjective.**

**Evidence.** `SessionSummary` uses a clear hierarchy: session tiles → movement rows → trend → map →
actions. `song/cues.ts` `interlude()` plays a short home/away/home progression, `hush()` stops it,
and the summary arms guitar actions after the music. Idle fade, responsive layout, box/trend
graphics, and animated movement are present. `SessionSummary` comments explicitly describe the
intended eye order.

**What remains.** "Micro/macro/mini" is not a formal design system; it is a good first pass. The
interlude is generated, not a music library. Validate on the actual screen size and with a guitar in
hand; tune timing, contrast and motion.

**Next step.** Do a design QA pass against the four goals (what is the one thing, what is the next
thing, what changed, what can I play next). Do not add more charts until the core hierarchy is
validated.

### T5 — AFK time should stop counting

**Original intent.** The session appears to keep counting time while the player is away.

**Status: SHIPPED.**

**Evidence.** `useSession.ts` keeps `clock.current.active` and only adds `dt` when a note was heard
within `IDLE_MS` (12 s) or the band is playing and the player is still within `3 * IDLE_MS`. After
`AWAY_MS` (75 s) the session enters `away` and rests until a note wakes it. `elapsed()` returns the
active clock, and the session entry stores active minutes. `SessionSummary` uses `s.elapsed()`.

**What remains.** Verify in a browser with a real tab switch and with the guitar silent; browser
timers can be throttled in background tabs. The floor of one minute in the session entry is
intentional but can make a very short session look longer.

### T6 — Learn bars 1–3: show only the relevant bars

**Original intent.** When learning bars 1–3, do not show the rest of the tune; show the relevant
bars.

**Status: PARTIAL.**

**Evidence (2026-11-18).** Songs supports deliberate start/end selection in expanded playing order,
including repeated-bar occurrences, then exact Listen/Loop/Practice. Passage IDs include the
arrangement so an edited score cannot reuse that passage's box. `SongCoach`'s melody stage cuts
the score to the minimum/maximum printed bars in play; gaps between noncontiguous printed bars
are dimmed. Memory cards use `hideBars` for note visibility, not layout.

**What remains.** Direct dragging/tapping of custom boundaries and compact noncontiguous
excerpts. Removing internal gaps needs preserved printed labels, repeat/endings and a mapping
between rendered notes and the existing timeline. The legacy Learn view is not the active path.

### T7 — Language: stop instructing, start reacting

**Original intent.** The copy is patronizing/AI-like ("JUST LISTEN"); the app should figure out how
to react to the player rather than tell them what to do.

**Status: PARTIAL.**

**Evidence.** The modern session's `coachLine` is deliberately terse and observational: it reports
"8 of 10", "92%", "The band comes back in on a note", "Resting. A note carries on." It does not say
"just listen". The session's primary controls are material and guitar gestures, not instructions.
However, older surfaces still instruct:

- `LearnView.tsx`: "Listen first. Hear how the melody sits on the chords.", "At your own pace:
  every note first time, no going back.", "Press Start…", "That's the whole plan. Beautiful work."
- `TuneView.tsx` `nextStep()`: "Press Start listening above…", "Press Play or Space…".
- Legacy Practice (`CoachPanel`, `SessionPanel`) is built around todo lists and "Done when".
- `ChangesView` has "Start listening and play the…", "Close. Try X instead of Y."

**What remains.** A copy audit across the app. The rule should be: state what is heard/what
happened, offer the next action without commanding, and let the material + guitar affordances carry
the instruction. Keep the modern session's tone as the reference.

**Next step.** Replace the LearnView phase copy with observations ("Heard A♭; the written note is
A") and make the next action a visible, guitar-triggerable option. Do the same for TuneView's
`nextStep`.

### T8 — Listen again, always, from the guitar

**Original intent.** The player must always be able to hear the part again, easily triggered with a
designated note such as E5.

**Status: PARTIAL.**

**Evidence.** `SongCoach` assigns `E5` as the hear key by default (`song/notekeys.ts`), displays it
in the running footer (`listen`), and `session.hear()` replays the card. The six-string menu also
has "Hear it again", and the done screen has "carry on". The key avoids notes the card/band sounds.
`LearnView` has a "Hear it again" button but no guitar key. TuneView's wait mode has "Hear the next
two bars" but no guitar key. Reading and Changes have no listen-again gesture.

**What remains.** A shared hear action outside the session. The main design question is note
assignment: a fixed E5 may collide with material in other views, so use the same "home note outside
what is played" logic as `notekeys.ts`.

**Next step.** Add a global `E5` (or assigned) hear command in the shared layer from T2; wire it to
`LearnView`, `TuneView` (wait/along), `ReadingView`, and `ChangesView`.

### T9 — Silence guidance, playback cursor, wrong-note names

**Original intent.** Guide the player after long silence; show where playback is in the score so the
eyes return; write the name of a wrong note in red/green to strengthen sight reading.

**Status: PARTIAL (full in SongCoach).**

**Evidence.**

- **Silence:** `useSession` nudges at 8 s (next note quietly), replays at 12 s, and rests at 75 s.
  `hintNote`, `bassHint`, `padChord` provide musical cues. `nudge` increments and drives
  `cursorPulse`.
- **Playback position:** `Score` supports `playingBar` (bar highlight), `cursor` (lit column),
  `cursorPulse` (attention pulse), and `autoScroll`; `SongCoach` uses all of them.
- **Wrong notes:** `ScoreShadows` draws a hollow notehead at the played pitch with its name, plus
  the written note's name; `Fretboard` ghosts show likely string/fret; results colour notes
  green/red. This is exactly the requested sight-reading reinforcement.

Outside `SongCoach`, `TuneView` and `LearnView` pass `playingBar` but not `cursor`/`cursorPulse`;
they do not use `ScoreShadows`. ReadingView passes neither.

**What remains.** Unify the score presentation. Add cursor/pulse and wrong-note names to
TuneView/LearnView/ReadingView, and add the silence nudge to the standalone reading/follow flows.
The hard part is already solved in `Score`/`ScoreShadows`; this is wiring and UX consistency.

### T10 — Audio output control, including the Mac's output

**Original intent.** Choose the app's audio output (e.g. Mac speakers) instead of being forced onto
the interface/headphones; configure it from the guitar UI.

**Status: SHIPPED (code), VERIFY.**

**Evidence.** `audio/output.ts` routes the Tone context with `setSinkId` where supported, persists
`guitar-output`, lists outputs, cycles devices, falls back to system output when the chosen device
disappears, and restores it when it returns. `audio/context.ts` calls `watchOutputs()` when audio is
created. `SongCoach` exposes the picker in the settings drawer and the six-string menu ("Sound out"
cycles). Routing is app-wide once set. Chrome/Edge support `setSinkId`; Safari/Firefox may not.

**What remains.** Physical verification on the user's Mac + interface: choose Mac speakers, confirm
the guitar input stays on the interface, unplug/replug, confirm fallback/restore. Add a clear
"not supported in this browser" message where the picker is hidden/disabled. Consider exposing the
picker in the shared header so non-session views can change it too.

### T11 — Listen / your pace / in time selectable from the guitar

**Original intent.** All three modes should be triggerable by playing tones.

**Status: SHIPPED.**

**Evidence.** `SongCoach` assigns `E5` (hear), `F2` (pace), `G2` (time), `G♯2` (next) via
`assignNoteKeys`, shows them in the running footer with `NoteTag`, and `useNoteKeys` fires them. The
same actions also exist in the guitar menu. The ready screen uses a held note to begin.

**What remains.** Verify on real hardware that the assigned notes do not collide with the exercise
or the band; the assignment logic already avoids used midis and has fallbacks. Consider making the
action notes stable across cards/views rather than per-card, so muscle memory transfers.

### T12 — Leniency for the first and last note

**Original intent.** The app often marks the first note red even when it was correct; add edge-case
handling.

**Status: SHIPPED.**

**Evidence.** `song/judge.ts` `cleanTake` forgives the first and last note (for takes of four or
more) and allows one stray in twelve. `tunes/usePlayback.ts` uses wider timing windows at the edges
of a range: `EDGE_EARLY_MS = 320`, `EDGE_LATE_MS = 320`, and keeps a finished pass's colours for
650 ms so the last note is seen. `useSession` starts a take on a fresh attack and ignores a ring
from before.

**What remains.** Verify with real detection on the first/last notes of a phrase, especially on
scale cards where the last note is also the return to the tonic. The visual may still show a red
last note if it was genuinely missed; the important part is that it does not fail an otherwise
clean take.

### T13 — Approximate progress/vibe, estimator, metronome pacing

**Original intent.** "Nearly" and progress feel opaque; give an approximate sense of how it is
going, shift the vibe when doing well, use an estimator with different metrics for melodies and
scales; choose a metronome tempo somewhat lower than the player and raise it as they play cleanly,
without demanding 100 %.

**Status: SHIPPED (v1).**

**Evidence.** `song/estimator.ts` maintains a running hit rate, streak and steadiness; scales weight
run length and steadiness, melodies weight right notes. `useSession` exposes `flow` (0–1) and `run`;
`SongCoach` sets CSS `--flow` (room warmth), shows "N in a row", pass bars with the target line,
and a beat meter. Tempo starts at `UNDER = 0.88` of the player's measured tempo; clean passes raise
it by 4/8 bpm, short passes lower it by 6, mostly-wrong passes send the band away. Pass thresholds
are below 100 % (0.7–0.85). Free play has its own `stepLock` with `ahead`/`behind`/`loose` moods.

**What remains.** Long-term trends (T3) and more explicit "slow down"/"speed up" communication
(T21). The estimator is intentionally smoothed; validate that it does not feel random. The "vibe"
is mostly colour and numbers, not music.

### T14 — Session-end language and pacing

**Original intent.** The end-of-session language is terrible; make the transition smooth, like
video-game level pacing.

**Status: SHIPPED (v1).**

**Evidence.** `SessionSummary` opens with an interlude, then session tiles, movement, trend, map and
actions. Copy is neutral ("session", "nothing played", "carry on", "a few more", "nothing more for
today"), and `ResultMark` reports box movement/facts rather than praise. The summary arms guitar
actions after the music and fades in the rest. The session itself moves card → result → next without
a modal.

**What remains.** User validation of pacing and tone. The legacy LearnView still ends with "That's
the whole plan. Beautiful work." and other praise/instruction; if the legacy path remains visible,
align its copy or label it as legacy.

### T15 — Stronger playback-position highlighting

**Original intent.** More visual highlighting in the score where playback is, because the player
looks at the guitar or closes their eyes and loses the place.

**Status: PARTIAL.**

**Evidence.** `Score` supports a bar highlight (`playingBar`), a cursor column (`cursor`), a pulse
(`cursorPulse`), and auto-scroll. `SongCoach` uses all of them; `TuneView`/`LearnView` use only
`playingBar`; ReadingView uses neither. The session's cursor pulses on a silence nudge, which is the
"eyes come back" signal requested.

**Update 2026-11-23.** Long session melody cards now use `ScoreFlow`: a still, lit now-line the
music flows under, the current part lit in a form strip, and the line calls (`pulse`) after a
silence. The active note no longer falls back to the first note during rests, which had scrolled
long pages to the top and back.

**What remains.** Wire the cursor and pulse into every score view; consider a stronger contrast
band or a short "where are we" animation after a long silence in TuneView/Reading. Do not duplicate
the cursor implementation; extend `Score` (or reuse `ScoreFlow` for long listening views).

### T16 — Scale work: last note, encouragement, metronome-first, rhythms and melodic patterns

**Original intent.** Scales mark the last tone failed even when green and never encourage; the real
goal is geometric finger patterns; start in a metronome-controlled environment and track BPM;
add triplet/quarter/16th picking rhythms; add melodic patterns (up a third, down a second), stacked
diatonic chords and 7th arpeggios.

**Status: PARTIAL.**

**Evidence.**

- **Last note/encouragement:** `cleanTake` forgives the last note; `playback` gives the range edges
  wider windows; a clean take calls `glint()` and raises the estimator. A missed last note can still
  be red, but it does not fail a clean take.
- **Metronome/BPM tracking:** scale cards run at the player's pace first, then in time with a click;
  `applyResult` stores the tempo in the card box, and `cardTrend` exposes the last 10 tempos and
  best. `RHYTHMS` sets quarter/triplet/16th tempos and goals.
- **Patterns:** `SCALE_STAGES` includes run, quarters, thirds, triplets, triads, sixteenths,
  sevenths. `lines.ts` generates scale, arpeggio, guide-tone and chain lines; triads/7ths are
  diatonic stacks from each degree.
- **Not there:** a dedicated "metronome first" scale track that prioritizes BPM over reading, a
  long-term BPM chart, and a clean "goal reached" celebration beyond the box/glint.

**What remains.** Decide whether the current run-first stage is the right pedagogy. The `todo`
wants the metronome environment first; the code currently starts with the notes at the player's
pace, then adds time. If changing, add a scale-specific card variant rather than rewriting all
cards. Surface the BPM history (T3) and make the last-note forgiveness visible so it does not feel
like a failure.

### T17 — Staged content, cross-exercise influence, avoiding endless cards

**Original intent.** Stage content from right notes → in rhythm → melodic; exercises on a topic
should influence each other; do not generate an endless card per scale; award progress for
completed exercises; guitar knowledge is connected (D harmonic minor teaches D natural minor).

**Status: PARTIAL.**

**Evidence.** `Card.needs` gates scale stages; `planSession` introduces new cards gradually;
`applyResult` moves boxes on completion; `kin.ts` gives credit across related **scale** exercises
(same scale/pattern, same notes other tonic, one note apart, a fifth away); `carryOver` moves
relatives up; `vary`/`freshLine` keep reading cards new; shared scale ids (`scale:...`) mean every
tune sees the same scale box under `guitar-skills`.

**What remains.** Kinship is scale-only. Arpeggio, guide-tone, voicing and melody cards do not share
progress. There is no topic graph beyond scale ids, and no explicit "right notes → rhythm → melodic"
stage model for non-scale material. The deck still generates cards per tune for non-shared families.

**Next step.** Extend the kinship/topic model beyond `ScaleTopic`: define a `Topic` for a chord
progression, a voicing family, or a melody section, and let a clean pass credit related topics.
Start with arpeggios over the same changes and shell voicings of the same chords. Do not add a card
for every scale; add one shared card per skill.

### T18 — ii–V–I switch, listen-again, adjustable metronome anywhere

**Original intent.** In the ii–V–I practice mode the switch between chords is jarring; there is no
way to play what the app wants without it sounding crazy. Always be able to listen again via a
fretboard tone. Have an adjustable metronome accessible from almost anywhere for practice outside
the curriculum.

**Status: OPEN (Changes drill), PARTIAL (session).**

**Evidence.** `ChangesView` deals a ii–V–I, shows voicings, detects the current chord, and has a
**Hear {chord}** button that strums the current voicing. It has no progression playback, no
count-in, no metronome, no guitar-note controls, and no listen-again gesture. The modern `SongCoach`
does play ii–V–I harmony cards with a band/click, has a hear key, and has a guitar menu with tempo,
but that is a different surface.

**What remains.** Make the Changes drill musical: play the progression at a chosen tempo with a
count-in and click, hold common tones/voice-lead the transition, let the player loop it, and add a
guitar "hear it" key. The "metronome anywhere" part is the shared command layer from T2.

**Next step.** Either upgrade `ChangesView` with a small progression player (reuse
`audio/usePlayer` or `tunes/usePlayback`) or move the drill into the SongCoach family system. Do not
build a third audio path.

### T19 — Free play: logging, categorization, passive tree, Leitner integration, reacting

**Original intent.** In free-play metronome mode, write down what is played, categorize key and
exercise; the curriculum tree should look like Path of Exile's passive tree, structured by the
circle of fifths, with repertoire/exercises filling it; integrate with the Leitner system; react to
what the player plays (e.g. chord progressions → chord-change exercises; then scales); consider the
song they bring.

**Status: PARTIAL.**

**Evidence.**

- `useFreePlay` detects onsets, estimates key (Krumhansl), pattern (run/thirds/triads/7ths), grid
  division, timing and in-key ratio; it runs a click/band and logs `FreeEntry` to `guitar-freeplay`
  on exit (key, pattern, BPM, division, seconds).
- `playedSheet` writes the played notes into a score; `FreePlay` shows the click, timing lane, best
  tempo/record, band and vamp, and offers a matching card from the deck when one exists.
- `tree.ts` builds a circle-of-fifths map with major/minor hubs, skills growing outward, tunes on
  the rim, and free-play marks; `SessionSummary` displays it. It is derived from boxes/credit/free
  log, not stored separately.
- `song/leitner.ts` integrates only by offering a card; free play does not itself create credit or
  alter boxes.

**What remains.** No chord-progression recognition (single notes only), no active tree interaction
(choose a node to practise), no recommendation engine beyond the exact card match, no mapping from
a played progression to a chord-change exercise, and no "bring a song" flow from free play. The tree
is read-only.

**Next step.** Add chord recognition first: detect simultaneous pitch classes and a repeated
progression, then map the progression to a `ChordGoal`/topic and offer the matching harmony or
changes cards. After that, let a tree node be selectable and feed `planSession`/`next` rather than
only displaying state.

### T20 — Unplug/replug interface recovery

**Original intent.** Unplugging and replugging the interface kicks the player out and requires a
reload/restart.

**Status: SHIPPED (code), VERIFY.**

**Evidence.** `listen/useInput.ts` watches `devicechange`, keeps the audio context when only the
device is lost, reopens the preferred device when it returns, and avoids a new click. `useSession`
sets `paused` when input is not listening, shows "No input" and resumes on return without resetting
the card. `audio/output.ts` falls back to system output when the chosen output disappears and
restores it when it returns.

**What remains.** Runtime verification with the actual interface, including: unplug mid-take,
replug, confirm the session resumes at the same position; unplug the output, confirm fallback;
replug, confirm restore; check Chrome's device labels and permissions. Also test the case where the
browser suspends the context.

### T21 — Metronome discipline and communication

**Original intent.** Once locked into a metronome, do not let the player speed up randomly; require
clean playing to raise tempo; communicate "slow down" if too fast and "speed up" if too slow; drop
BPM if consistently slow; back off on mistakes and restart only when confident; always hear the
expected V–I; make next exercises accessible from the guitar.

**Status: SHIPPED (v1).**

**Evidence.** `useSession` raises only on clean passes, lowers on short passes, sends the band away
on mostly-wrong passes, waits after silent passes, and returns to the player's pace. `freeplay.ts`
`stepLock` has `ahead`/`behind`/`loose` moods; clean readings raise, sustained lateness lowers,
rushing never raises. `SongCoach` shows a beat meter ("ahead/behind/on"), pass bars, the click's
target, and a "band comes back in on a note" message. The hear key and guitar menu make the expected
material and next card available from the guitar. The V–I section gets `padChord`/`bassHint` cues in
the session.

**What remains.** The "mood" is mostly visual/numeric; there is no explicit sonic "slow down"/"speed
up" cue, and the session's `slowed`/`backed` counters are not surfaced as a clear message. Add a
musical cue (e.g. a descending/ascending two-note figure) or a concise on-screen signal, and test
that it does not nag. Also consider exposing tempo history (T3).

### T22 — Detect the string a note was played on

**Original intent.** Try to find the correct string for a note; current behavior is "so-so".

**Status: OPEN.**

**Evidence.** `song/fingering.ts` chooses a position window and maps notes to string/fret inside it;
`ghostSpot` in `SongCoach` guesses the most likely string/fret for a wrong pitch using position and
distance. The microphone is mono (or dual-channel with the louder channel chosen); there is no
per-string signal. So the app **infers** a plausible string; it does not hear which string was
played.

**What remains.** This is a signal-processing/hardware problem. Options: a hexaphonic pickup or
per-string input; harmonic/spectral analysis to estimate string from timbre (unreliable on an
acoustic); or accept inference and make the UI say "likely position" rather than "you played the
wrong string". Do not claim true detection without an experiment.

**Next step.** Write a short experiment plan (input source, accuracy metric, test phrases) before
changing the UI. If no reliable signal exists, document the limitation in the practice doc and
soften the feedback wording.

### T23 — Ear as call-and-response (v1 built)

**Intent.** The Ear tile promised "hear it, then play it back". The player wants the guitar in their
hands: the app plays a short phrase, the player plays it back, the mic judges it. They asked for it
to be **tiered**, to start with **sight reading (the page) as a help**, and to **stay within the
scales played in their songs** (no Gb tune they would never guess).

**Built (2026-11-16).** An `ear` card family in the existing session, not a new engine:
`song/ear.ts` (phrase generator, tiers), `deck.ts` (`earDeck`), `useSession.ts` (always listen
first; an echo concludes after the own-pace take, no in-time pass), `EarHub.tsx`.
- Notes from the tune's home scale only, inside the position window (≤ fret 10 by default); a
  mixed session echoes each tune in its own key.
- Tiers: 1 three notes by step, 2 four notes with skips (page shown), 3 four notes and 4 five notes
  wider (page hidden until played), then opening phrases of the tune's first sections. Each unlocks
  from the one before through the card box. New phrases every visit, seeded.
- Response judged by the existing follower, any octave; wrong notes show as the session already
  shows them. Tests: `overview.test.ts` (scale/range/leaps/ending, determinism, deck tiers).

**Next steps.**
- Play it with a guitar and tune the feel: phrase length, tempo (76), the home triad under it, how
  long the call waits, whether tier 1 should start even smaller (two notes).
- Hidden tiers: show the notation adaptively after misses (a "page returns when it goes wrong"
  behaviour like the neck's), rather than only after the phrase is played.
- Intervals and chords as calls; rhythm in the phrase; the minor/major chord tones of the tune's
  other key centres (today only the home scale).
- Fold the chord quiz into the deck or retire it; seed `ear/engine.ts` randomness; decide whether
  the quiz's answer buttons should take a played root note.

## Additional work not in the root todo

These are required for a clean slate even though the user did not list them.

1. **Baseline commit** — the green build is restored; the remaining task is putting the modern app
   and docs under version control. See the first "next steps" item.
2. **Decide the canonical learning path** — modern Tunes vs legacy Practice. Document the decision
   in `AGENTS.md`/`CURRENT_STATE.md` and make the default tab match it.
3. **Storage quota strategy (implemented 2026-11-18)** — large XML uses IndexedDB; failed saves
   are visible and pending progress can be retried or exported in a backup. Remaining: exercise
   real browser quota/private-mode behavior with large scores and verify recovery on hardware.
4. **Runtime verification checklist** — create a short manual QA checklist for audio output, mic
   input, calibration, device reconnect, fullscreen, autoplay, and each view. Automated tests
   cannot cover most of this.
5. **Docs maintenance** — update `CURRENT_STATE.md`/`BACKLOG.md` when a feature ships or a decision
   changes; regenerate `docs/REPO_MAP.md` after file changes.
6. **Dead code decision** — `audio/metronome.ts`, unused barrels, `exportBackingMidi`. Either wire
   them up or remove them with the user's approval.
7. **Verify a fresh clone** — confirm that `make install`, `make check` and `make run` work from a
   clean checkout, without relying on local files in `tunes/staging/` or the scratch harness.

## How to use this backlog

- Pick one item at a time; keep the status and evidence current.
- Do not implement a `todo` item by adding a parallel system. Reuse `SongCoach`, `useSession`,
  `Score`, `usePlayback`, `GuitarPad`, and the Leitner store.
- For anything that changes guitar gestures, tempo rules, the card box or the done screen, read
  [PRACTICE_SESSION.md](PRACTICE_SESSION.md) first and update it with the behavior change.
- For anything that changes module boundaries, update [ARCHITECTURE.md](ARCHITECTURE.md).
- When an item ships, move its status to SHIPPED and record the verification command or manual
  check. A feature is not shipped because the code exists; it is shipped when it has been exercised
  in the browser with a guitar.

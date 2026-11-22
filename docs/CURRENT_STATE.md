# Current state

Updated **2026-11-18** after SOL continuation and browser review. See [SOL_IMPLEMENTATION.md](SOL_IMPLEMENTATION.md)
for delivered boundaries and remaining product work.
This is the authoritative description of what exists, what is only partly built, and what is
broken. Update it when a feature's status changes; wishes belong in [BACKLOG.md](BACKLOG.md).

**Evidence labels used below**

- **Code-verified** — read from the implementation and covered by tests or direct inspection.
- **Runtime-unverified** — implemented, but not exercised in a real browser with a guitar/audio
  interface during verification. Browser-only checks are described separately.
- **Broken** — currently fails a command or is known not to work.

## Health snapshot

| Check | Result | Detail |
| --- | --- | --- |
| `make check` | **PASS** | Typecheck, repository map freshness and 31 suites / 406 tests passed. Existing suites were extended; no new test suite was added in this continuation. |
| `npm run build:quiet` | **PASS** | Production build passed; Vite retains its existing >500 kB chunk-size warning. |
| Focused iteration checks | **PASS** | Typecheck plus storage, goal/planner, session trust, recording, platform, scheduler, archive and mounted score-browsing suites passed while integrating. Full gate below supersedes individual iteration counts. |
| Current browser preview | **PASS, bounded** | Prior review covered 320×844, 390×844 and 1440×1000. This continuation reviewed the guitar room/instruments at 1280×720 and 390×844: GPU water initialized, meter/count-in/pulse/subdivision/stop and tuner switching worked; manual tune choice moved Free play into the selected tune without showing the shell, and Ready opened embedded instruments. A fresh final load reported no console warnings/errors. Earlier intermediate HMR errors were resolved before this check. Viewport emulation is not a physical phone or instrument test. |
| Offline shell / physical sync | **Code-verified; runtime-unverified** | Worker generation includes local fonts/lazy assets. A GitHub Pages workflow is configured but not run here. Actual phone HTTPS, install/offline/update, cross-network/TURN and active-window handoff remain unverified. |
| Audio / mic / devices | **Runtime-unverified** | No physical guitar, routing, reconnect, audible balance, recording, tuner, microphone scoring or audio/visual alignment was tested. See [SUPPORTED_SETUPS.md](SUPPORTED_SETUPS.md), whose outcomes remain NOT RUN. |

Continuation review also exercised brief preparation/Copy, selected period, original study notes
and the checked goal counter on desktop and at 390px. No console warnings/errors were observed.
Memory transitions and recording controls were checked in mounted tests, without synthetic
practice/recordings being inserted into the live browser library.
Continuation browser checks also exercised empty tune archives, repeated-bar passage listening
and exact launch. GPU appearance/initialization was observed; battery drain, microphone tuning,
audible click quality and hardware audio/visual alignment were not measured.

## What the app is

A local-first guitar practice application with no accounts or app-data backend. Practice works
locally; optional foreground device exchange uses PeerJS signaling and STUN/TURN to establish
an encrypted WebRTC channel. Transfer files also work without a signaling connection.
React 18 + TypeScript + Vite; Tone.js for transport/synths/backing; VexFlow for notation;
`@tonejs/midi` only for the unused MIDI export. Preferences and progress live in `localStorage`;
large imported scores and recorded takes use IndexedDB.

There are **three primary views**, with the existing focused modes under Practice → Explore:

| Surface | Component | Role |
| --- | --- | --- |
| Practice (`tutor`) | `OverviewView` → `useSongSummaries` | Current music, goals, Next, Explore, original first-use studies. |
| Songs (`tunes`) | `TuneView` → `SongCoach` | Score-centered listening, phrases and exact passage practice; Library tools. |
| Progress | `ProgressView` | Current goals, captured per-exercise history, bounded cross-tune observations and retained audio comparison. |
| Changes / Reading | `FocusView` → `SongCoach` | Same session narrowed to the tune's chord/harmony or reading cards. |
| Scales | `ScalesView` → `FocusView` / `ShapesView` | Tune scale cards and existing shape explorer. |
| Ear | `EarHub` → `FocusView` / `EarView` | Tune echoes and the original chord quiz. |
| Free play | `FreePlayView` | Existing adaptive engine without requiring a tune. |
| Instruments | `GuitarTools` / `GuitarToolsRoom` | Shared-input A440 tuner and heard-clock metronome, embedded in the guitar room or opened from shell Tools. |

The header keeps real icon-labelled buttons and the existing played cursor. This hierarchy is an
implemented design proposal; improved task finding has not been demonstrated with students.
`App` owns shell Devices/Tools visibility and unmounts the current feature while either is open,
then remounts saved projections on close. Embedded tuner/metronome retain the current guitar
room and its boundary, suspend its engine and return to it. Practice, Free play, the Ear quiz, Tools, Devices and JSON
restore acquire the same exclusive origin-scoped Web Lock before mounting writer hooks. Handoff
waits for async saves and pending recovery; unsupported browsers keep browsing but cannot start
protected operations. Hardware and installed-window behavior still require the
[declared setup checks](SUPPORTED_SETUPS.md).

The browser review fixed overlapping Tools/Devices phone targets and moved selected-phrase
actions into the sticky score transport, where selecting a bar exposes them immediately.
The shared instrument room now uses the practice textures, an engraved weighted metronome dial,
chromatic tuning rail and guitar-operated controls. Optional default-off GPU water is capped at
30 fps and 1,000 pixels on its long edge, pauses in hidden/inactive pages and stays still for
reduced motion. This is a bounded rendering budget, not a measured battery-life claim.
An initial unconfirmed busy lock now stays in Checking while a previous local owner finishes;
the review no longer showed a false claim that another window was practising. Real multi-window
handoff remains a separate hardware/lifecycle check. Progress recordings now have real Play/Pause,
Restart and seek buttons for the played cursor, sharing one routed player per comparison. Controls,
cleanup and late-start cancellation have mounted coverage; physical audio remains unverified.

## SOL delivery: goals, evidence and recovery (2026-11-18)

- Musical goals freeze a short route for a specific interpreted arrangement and personal tempo
  range. Melody, accompaniment, echo, reading and improvisation reuse the existing deck. Goals
  are portable immutable identities; independent first goals union instead of replacing each other.
  Active selection follows deterministic transaction order. The UI allows 12 local goals per tune;
  replay accepts up to 256 per tune to retain independent histories.
- Current-goal proof uses measured clean attempts since creation, matching the score fingerprint.
  Timed tasks need timing samples and the actual stable assessed-pass BPM. Echo completion uses
  own-pace success; its configured BPM describes the call, never a demonstrated response speed.
  Historical card bests/boxes remain separate from this arrangement-bound evidence.
- New attempts and recordings carry optional assessment conditions and arrangement fingerprint.
  Legacy conditions stay unknown. Detector confidence currently stays unknown even for measured
  attempts; no signal-qualification experiment has justified stronger claims.
- Ready offers self-guided practice without requesting the microphone. It uses the existing
  session/playback, stores activity and never awards measured boxes, kinship, profile or best tempo.
  Finish after this pass waits for an ongoing timed pass; Stop now remains explicit.
- Recording saves report recording/saving/saved/failed/unsupported outcomes. Failed Blobs stay in
  memory with Retry and Save audio; full file export rescues pending audio. Paired exchange first
  retries pending takes and refuses to advertise them as durable while saving is unresolved.
- Partial-library loading retains healthy tunes and named repair issues. Missing/invalid XML can
  be replaced under the same ID or explicitly removed while keeping history. Complete backups and
  exchange refuse to silently omit missing scores; repair/remove them before a full-state claim.
- Selected phrases can run a one-note rhythm task, then return to the original phrase in the same
  session. This checks pitched attacks and timing, not muted-string strums. Ear calls now include
  deterministic duration variation, rests and repeated pitches at higher tiers.
- Progress owns take comparison and observed patterns, with task/tempo/arrangement/help context.
  These are app observations on played material, not an overall guitar-level grade.
- Exercise history reads the complete captured tune journal, beyond the recent 800-attempt view.
  Its dated clean-tempo observations and attempt details keep score versions and assistance
  inspectable. Self-guided, skipped, own-pace and unknown legacy work cannot become timed proof.
  Shared scale history is outside this tune-specific view. The journal cannot restore attempts
  already absent when transaction recording began.
- Memory sections fade through page, bar-start landmarks and hidden notes after complete steady
  passes. Due later-day reviews of the same known arrangement start hidden. Restore-page and Hear
  remain available from the guitar; help/exposure provenance stays conservative for the whole
  visit. This does not implement alternate-start transfer or establish independent retention.
- Goal counters check a complete indexed tune journal group, so evidence can survive the 800-row
  display-history limit. Restore/deduplication use the existing projector. Queries cap at 5,000
  transactions and 8,388,608 serialized before/after characters; capped, unavailable, incomplete
  or conflicting records show unknown. Planning still uses bounded retained history and can
  offer an extra review. The read does not rewrite stores or scheduling.
- Production offline/update states are visible; updates wait for old windows to close. Fraunces,
  Inter and JetBrains Mono are bundled locally with their separate OFL notices, removing live
  font requests. Physical cache/update/interruption and sound verification remain not run.

## Demo repertoire and first use (2026-11-18)

Two original studies are bundled in `tunes/demos.ts`: First Steps retains its existing stable ID;
Blue Hour is a 12-bar C jazz blues at 76 BPM, with short phrases, rests, even eighths, a turnaround
and a separate articulated shell-chord accompaniment part. Its downloadable MusicXML includes provenance
and AGPL terms; see [ASSETS.md](../ASSETS.md).

First Steps has two separated chord pulses per bar. Blue Hour uses compact three-note shells,
small upper-voice movement and deliberate gaps. Optional Study notes give each original a clear
purpose, melody fingering, listening cue, simpler entry and creative variation. Notes appear only
for matching bundled content/part/voice. Melody and stable IDs are preserved; opening an updated
demo never overwrites a saved older arrangement. Automated content checks cover duration, rests,
guitar chord shapes and voice movement; musical sound and physical comfort still need a guitarist.

An empty Tutor previews Blue Hour, lets the visitor choose First Steps, and opens its score or
practice without finding a file. Song's empty state and always-reachable Library demo shelf offer
Listen, Open score, Practice and score download. Opening a demo tries to save a missing entry
and reuses an existing entry without overwriting user edits/progress. If saving fails, the original
stays playable as a clearly labelled bundled preview; the UI does not claim it was saved. Audio/fullscreen preparation
occurs in the originating practice gesture; demo Listen unlocks shared audio before asynchronous
saving and waits for the matching rendered score. Listen does not request microphone access.

Song also has an expandable **Create a score with your agent** prompt, with clipboard feedback and
selectable fallback. It describes the actual importer convention and standard-tuning boundary;
[CREATE_A_SCORE.md](CREATE_A_SCORE.md) explains verification and private sources. No score/source is
automatically sent to another service, and no acquisition converter is part of the app.

MusicXML parser tests verify both demo identities, melody range, bar duration, harmony,
accompaniment and repeated playback order. First-use Blue Hour Listen and score rendering were
exercised in the browser without a microphone prompt. First Steps Study notes were reviewed at
390px. Audible balance and score download behavior remain runtime-unverified in this pass.

## Agent-ready practice brief (2026-11-18)

**Songs → Library → Library tools → Practice brief** selects one tune or all saved music and
7/28/90 local calendar days, then prepares a readable summary and inspectable JSON for explicit
Copy/Download. `agent/brief.ts` schema version 2 is a pure bounded projection. Scope filters inputs
before aggregation; clean task tempos require dated retained visits within the chosen period,
excluding undated lifetime best settings. Missing measurements remain null;
assistance/detection confidence that was not captured remains unknown. The selected goal and
assessment-condition counts are included; self-guided activity is excluded from measured proof. Definitions distinguish
reference alignment, within-attempt timing scatter, scheduling and musical ability.

It excludes score XML, audio, raw attempts, device/calibration settings, pairing secrets and the
transaction journal. No agent service, API key, inbound plan execution or private-data endpoint
is added. `public/llms.txt` describes capabilities and boundaries; external agents need an explicit
user-provided export to discuss private progress. Nested conditions and goal objects are explicitly
projected because validated stored objects can still contain extra fields. Existing overview-suite
cases cover date/scope boundaries, deduplication, tempo semantics and private-field exclusion.
Browser preparation, one-week selected-tune preview and Copy for agent succeeded; actual external
agent conversation and JSON download remain unverified. This summary uses retained recent stores,
not the complete journal evidence query used by goal counters.

## Relative timing and alignment (2026-11-18)

Timed sessions and Free play separate steady pulse from constant early/late alignment. A temporary,
bounded phase fit uses distinct attacks, 60% coverage, scatter and noise-bounded drift; it does not move playback,
change the visible audio-clock pulse or overwrite calibration. Its phase bound is the smallest of
200 ms, 30% of a beat and 45% of nearby attack spacing, with tighter residual tolerance for fast
subdivisions. Raw offsets remain in evidence and appear neutrally as alignment; progression and
warmth use steadiness. Profile timing scores no longer penalize constant mean displacement or name
it rushing/dragging. Legacy evidence/enums remain readable.

Free play requires at least six distinct contiguous subdivision attacks and checks phase movement
between reading windows. Missing/duplicate attacks, ambiguous phases, irregularity and accumulating
drift cannot earn a rise. Adjacent timed targets have disjoint attack ownership. Focused existing
tests cover symmetric fixed offsets, drift, sparse/duplicate evidence and profile semantics.
Physical guitar timing and latency remain unverified; play-along compensation still includes the
player's reference behavior and is not an independent hardware-latency measurement.

## Product direction

[SOL_OPINION.md](../SOL_OPINION.md) is the comprehensive product review and proposed roadmap. It
separates the current engine from longer-term design, curriculum, assessment, reliability,
platform and agent-bridge proposals. [SOL_IMPLEMENTATION.md](SOL_IMPLEMENTATION.md) records
which engineering slices are implemented and which validation/content work remains.

## Tutor layer (2026-11-17)

Built from the plans in [tutor/README.md](tutor/README.md). All of it is **code-verified** (unit
tests in `tutor.test.ts`, typecheck) and the new session screens were rendered in headless Chrome
with the synthetic player; **runtime-unverified** with a real guitar, mic and speakers.

- **Evidence per attempt** (`song/evidence.ts`): first-try notes, what sounded instead, misses after
  leaps / string crossings / position shifts (strings inferred), onset offsets of passes in time,
  restarts, hears, a run-through's weak bars. Stored on `Attempt.ev`; older attempts have none.
- **Profile** (`song/profile.ts`): skill axes (pitch, time, tempo, chords, reading, ear) with level
  and four-week trend, mistake classes (leaps, crossings, shifts, semitone slips, rushing, dragging,
  scattered time, ear lagging the page), tempo ceilings. Derived on demand.
- **Measured latency** (`audio/latency.ts`): calibration ends with ten clicks to play along with;
  the median click→note delay replaces the fixed 50 ms in playback and free play. Rushing/dragging
  are only named once it has been measured. After each pass in time a timing strip shows each note
  against its beat and the spread.
- **Planner** (`song/planner.ts`): sessions of 10 / 25 / 45 minutes (ready screen, held F) as
  warm-up → focus → review → music. The focus comes from the profile's strongest mistake (held up to
  ten days as an arc, `guitar-arc`), else the last run-through's short bars, else a skill left
  alone for a week; it is shown as one fact on the ready screen. New cards come by the last 16
  attempts (none under 60 % clean, two extra over 85 %). "Carry on" still uses `planSession`.
- **Gap click**: scale and melody cards from box 4 (and focus cards of a time arc) play in time
  with the band dropping out for bars at a time; the notes are still judged.
- **Chords**: chord changes are timed from the strum; comping cards (2 and 4, then Charleston)
  per section and cadence after the voicings card, each hit must be struck again.
- **Free play hears strummed progressions** (`song/progression.ts`) and offers the voicings card
  whose changes contain the loop.
- **Run-through** (`mel:run`): the whole tune once with the band, nothing stops; bar map on the
  result; short bars feed the next sessions' focus; the take is recorded (`audio/recorder.ts`,
  IndexedDB) and the overview plays the first and latest take.
- **Improvising** (`sec:…:improv`): any notes over a section; a chord tone on beats one and three
  lands; the chord's notes are lit on the neck; note keys are off.
- **Fretboard family** (`fb:*`): notes on each string (any octave; the string's frets carry no
  note keys), thirds by shape (exact),
  3rds/7ths of the tune's chords; timed per box.
- **Ear**: two-note calls first, the tune's chords as arpeggio calls, phrases in its other keys.
- **Overview**: path towards playing each tune whole, and a "Your playing" section (axes, minutes a
  week, named mistakes).

**Not built from the plans yet:** swing ratio and rhythm-only cards, a drop-2 voicing ladder,
chord-quality ear calls (and folding the chord quiz), answer-the-phrase and trading fours, the
memory ladder that fades the page per stage, suggested next tunes, a full progress screen.

## Tutor overview

- `overview/summary.ts` projects the canonical deck/store into `SongSummary` and three `UnitPreview`s
  per song. It uses the same box, due-date and unlock rules as `planSession`, so the overview cannot
  drift from the session.
- Optional `excerpt`, `tempo` and `barCount` fields project score data for presentation. The home
  renders the first two printed bars with the shared `Score`, alongside title, key, meter, tempo
  and bar count. An empty library previews Blue Hour with First Steps available as the gentler choice.
- `pickGlobalUnits` returns three deterministic exercises: the current song first, then an overdue
  review from another song, then a different-family exercise. It does not shuffle or mutate boxes.
- `overview/useSongSummaries.ts` reads `guitar-tunes-v2`, parses each sheet, builds and caches its
  deck in memory, then re-reads the per-tune store on mount. Unreadable imports become named repair issues while healthy scores remain available.
- Next is one flat exercise list; Explore uses mode icons and names (`overview/modes.ts`). Tune
  rows show factual metadata, an open action and existing progress. Progress owns recorded takes. They do not
  repeat the exercise list or use monogram cards. `UnitCard` and focused mode lists share the flat
  exercise-row presentation.
- The primary action opens today's planned session; unit clicks open that exact `SongCoach` card.
  An empty library offers the original First Steps study. Free play opens without a tune.
- Performance milestones use demonstrated clean tempo rather than the suggested next tempo;
  clean BPM records survive history trimming. Skill axes report accuracy/timing/clean tempo.

## One learning system

The legacy Practice curriculum (`src/tutor/*`, CoachPanel/SessionPanel, `guitar-tutor-v4`), the
Fretboard Lab and the standalone sight-reading tab were removed when the tutor shell took over. The
canonical system is Tunes/`SongCoach`; Changes, Scales and Reading are the same session run on a
narrowed deck (`FOCUS_FAMILIES` in `song/deck.ts`). Progress for all of them is one Leitner store per
tune (`guitar-song-deck:<tune>`) plus `guitar-skills`. See
[ARCHITECTURE.md](ARCHITECTURE.md#two-tune-models-and-why-they-exist).

## View inventory

### Changes

- Song-aware. `FocusView` (changes) shows the current tune, key, chord symbols and up to three
  chord/harmony exercise rows via `nextUnits`; it starts `SongCoach` with `focus="changes"`.
- The deck is `familiesOnly(buildDeck(...), ["chords", "harmony"])`; guest-tune mixing is off, and
  `needs` links to removed cards are dropped. Boxes, tempo and sessions go to the tune's normal
  Leitner store, so progress is shared with Song mode.
- Typecheck and `overview.test.ts` cover the deck narrowing; the focused landing screens render
  in the production browser preview. Real guitar sessions remain unverified.
- The old abstract ii–V–I drill (`src/changes/*`) was deleted.

**Gaps:** inherits SongCoach's gestures (listen again, tempo, card box), so the old gaps (metronome,
guitar controller, jarring ii–V–I switch) no longer apply to the screen the app shows. No
dedicated "play the progression" card exists yet; a tune with no chord symbols has no Changes cards.

### Reading

- `FocusView focus="reading"`: the tune's `reading` family cards (`song/reading.ts`: fresh notes
  from the tune's range, introduced as earlier ones land) in `SongCoach`. The old standalone
  generator tab (levels, wait-for-me/play-along, `useNoteCheck`) was removed.
- Same gestures, mic scoring and box as the rest of the session.

**Gaps:** no level control (the deck's window/`round` decide new notes); unverified at runtime.

### Tunes

- Import `.musicxml`, `.xml`, `.mxl` by button or drag-and-drop; library persisted in
  `guitar-tunes-v2`, current tune in `guitar-tune`. A legacy `guitar-tunes` key only triggers a
  "load your tunes once more" notice; there is no automatic migration.
- Import previews the melody part/voice, key, sounding range, chord availability and warnings.
  The parser honors forward/backup timing movements, repeats/endings/jumps and optional comping.
  `.mxl` is unzipped with archive checks. New arrangements get independent IDs; exact duplicates
  open the saved score, and replacement explicitly preserves the selected tune's history.
- The selected part uses its first staff. Instrument transposition is warned about rather than
  applied; the existing guitar octave interpretation remains. Check the sounding-range preview.
- Large XML is stored in IndexedDB with safe migration from existing inline entries. Song exports
  and restores tunes/settings/history in one backup file (audio recordings excluded). Save failures
  stay visible; pending progress can be retried or exported before closing the page.
- Song defaults to a large score with tune metadata, a compact listening transport, phrase rows
  and the next exercise from each family. Library/import/backup tools and sound settings are
  disclosed when requested.
- Browsing playback (`tunes/order.ts` + `tunes/usePlayback.ts`) expands repeats, endings,
  D.C./D.S., To Coda and Fine into a `Timeline`; supports count-in, phrase loops,
  melody/chords/click mix and tempo changes. Listening does not score the microphone.
- Clicking a printed bar or phrase selects its existing melody phrase. **Select passage** offers
  exact start/end choices with printed bar, occurrence and playing-order position. Selection is
  reversible and does not autoplay. Listen/Loop and full-screen Practice use those bounds;
  generated phrases also offer one-note rhythm isolation. Custom passage identities include the
  arrangement and do not join the daily introduction or expand goal requirements. Returning from
  practice restores the browse scroll position. The primary action starts the daily plan. No inline Learn,
  Play along or Wait for me mode competes with the full-screen session.
- Full-screen **Practice session** (`SongCoach`) with multi-tune exercise mixing, free play,
  settings, calibration, input/output device choice, and the done-screen summary.
- Older `LearnView`/`useCoach` modules and stored `guitar-learn:*` data remain compatible legacy
  code/data; the Song page no longer renders them.

**Canonical modern path:** Tunes → Practice session → `SongCoach`. See
[PRACTICE_SESSION.md](PRACTICE_SESSION.md) for behavior and gestures.

### Scales

- `ScalesView`: the tune's `scales` cards via `FocusView`, plus the shape explorer below.

#### Shape explorer (`ShapesView`)

- Root-to-root shape plus seven 3NPS harmonic-minor shapes across the neck, in every key.
- Drills: notes, groups of three, thirds; i(maj7)–V7 vamp generated by `buildMinorVamp`; playback
  with `usePlayer`; degrees or note names; hide-notes memory mode; ←/→ switches shapes.
- Explains the augmented second and the raised 7th's resolution.

**Gaps:** no mic scoring, no guitar controller, no persisted per-shape practice history.

### Triads

- By-heart triad drill (`src/triads/*`, `TriadsView`): "ii of C major", four triads written on a
  treble staff with accidentals and names (German H/B by default, toggle).
- Six layers (`LAYERS`), 728 cards: major (13 keys × 7), major "which degree?" (the triad shown,
  four romans), minor (13 relative minors, i ii° III iv V VI vii°, V and vii° from the harmonic
  minor), minor "which degree?", major inversions (⁶ and ⁶₄), minor inversions. A layer's ring opens
  when its previous ring is known and the layer before knows that ring: a wave down the circle and
  into later layers. Existing major card IDs are unchanged.
- Distractors: the same root in the other quality and the key's degrees either side; inversions
  also offer the same triad turned another way.
- At the guitar, cards in box 4+ (named, root position) are asked without choices: strum it from
  memory; any other three pitch classes ringing together are wrong. Choices return on request or
  after 8 s. Away from the guitar nothing changes.
- Card box (`triads/box.ts`, `guitar-triads-v1`, synced and backed up, merged card by card): a quick
  right answer (≤ 3 s) on a due card climbs a box; slow stays; wrong returns to box 1 and comes back
  after three other cards. The drill never runs dry (due, then new from the earliest open layer, then
  weakest).
- Answers: tap, keys 1–4, the shell cursor, or strumming the triad (exactly one choice's three pitch
  classes ringing after a fresh attack). The answer's chord sounds after each answer.
- Verified: unit tests for spelling (minor, inversions, E♯/B♯/C♭/double sharps), choices, boxes,
  order and the opening wave; component tests of the loop and play-only; headless renders of named,
  "which degree" and inversion cards (with `navigator.locks` stubbed: headless Chrome leaves the
  practice-window check pending). Unverified: strum answering with a real guitar, a physical phone.

### Ear

**Echo cards (call-and-response, new)** — the `ear` deck family (`song/ear.ts`, `deck.ts`):
- A phrase is played, then you play it back (any octave). Run from the Ear tab, from Song, or from
  the overview's queues: they are ordinary cards in the tune's box.
- Notes come only from each tune's own home scale (`song/ear.ts`), so only keys you play songs in
  come up; a mixed session echoes each tune in its own key. A quiet home triad sounds under it.
- Tiers, each unlocking the next (`needs`): 1 three notes by step, 2 four notes with skips (both with
  the page on screen as a help), 3 four notes and 4 five notes with wider steps (page hidden until
  played: `memory`), then the first two sections' own opening phrases by ear.
- Each visit a new phrase (seeded by tune, card, round and times seen). The note names appear once
  it is played (`secret`).
- Flow: listen (always, even in high boxes) → play it back at your own pace (mic-scored; starting
  over is free) → done. There is no in-time pass for an echo. Neck hints return on a wrong note.
- Verified in headless Chrome with a synthetic guitar: the Ear tab starts the session by played
  notes (see Shell navigation) and the ready screen shows the first tier. **Unverified:** a real
  guitar, and how the phrases feel (length, tempo 76, which notes).

**Chord quiz** (the original trainer, behind the "Chord quiz" button on the Ear tab):

- Two modes: **Hear the chords** (choose the progression's chords) and **Name that progression**
  (multiple choice / famous song match).
- Tracks: jazz/pop/etc. (`ear/theory.ts`), staged vocabulary, mastery per chord, confusion pairs,
  adaptive weak-chord weighting, voice leading, generated audio.
- Side panels: path/ladder, mastery, "your music" (song library and Spotify links), mix-ups to
  drill, settings (keys vs guitar sound, pace, progression length).
- Progress in `guitar-ear-v1`; it picks its own random keys and is not tied to your songs' keys.

**Guitar:** the shell cursor (E5–A5, see Shell navigation) reaches every button, including chord
answers (`F♯5` presses). Three keys act directly: `A♯5` play/stop, `B5` check (or next once
answered), `C6` bass line. The keys go quiet while the trainer is sounding, so its own speakers
cannot press them. Unverified with a real guitar.

**Gaps:** the quiz's answers are still picked, not played, and it is not tied to your songs' keys or
the card box; `ear/engine.ts` still uses unseeded randomness. Echo cards are **T23** in
[BACKLOG.md](BACKLOG.md) (v1 built; next steps listed there).

## The modern practice session

`SongCoach` is the full-screen, hands-on system. The authoritative behavior doc is
[PRACTICE_SESSION.md](PRACTICE_SESSION.md); this section is the implementation summary.

### Flow

```
Ready screen
  └─ held note or Start
       intro → (listen) → (your pace) → in time → result → next card …
                                                   └─ session done → SessionSummary
```

- `useSession` runs the queue; `phase` is `intro | listen | pace | time | result`.
- A card can be a scale run/pattern, arpeggio/guide-tone/chain over changes, voicing exercise,
  melody chunk, or fresh reading line.
- New cards are introduced; long cards may be shortened into a spot (`song/spot.ts`) after repeated
  trouble in the same bar.
- Ready previews the first three planned exercises, separates input connection from starting, and
  shows the held-note gesture beside the start button. Running screens name the phase and exercise
  number; the displayed note actions and guitar menu also have clickable buttons.
- The six-string menu has a quiet scrim and phone-safe rows, pressed on each string's first fret
  (never an open string). It waits for the summoning note to stop/change before accepting a fresh
  0.6 s row hold; free play uses a fixed overlay.
- `PracticeAtmosphere` shares a muted water/leaf background and current lines with free play.
  Existing RMS frames give it small smoothed movements; sustained playing and flow gradually
  reveal colour. It is decorative, performs no pitch analysis, and respects reduced motion.
  `BeatPulse` shares the output-clock beat display. Real-guitar responsiveness remains unverified.
- **Living pool** (room mode Living / Living on power; default Still). Verified in headless Chrome
  on an Apple M3 (ANGLE Metal) with the synthetic free-play player and `window.__pool`: at rest
  the algae photograph is visible and flows (two-phase flow map); notes make ripples on a phrase spiral; groove 0.3/0.6/0.9 marble,
  glow and raise blobs while calm lenses keep text readable; heard-beat stones under the glass
  metronome dial; tuner moiré. Measured against the same harness: input-frame p95 25.9–26.2 ms vs
  25.8–25.9 ms for Still, main-thread busy unchanged (18%), browser CPU while playing 48% (Still
  44–47%, Water 55%), idle 23% at the 20 fps cap (Still 14%), GPU 2.2 ms/frame rising to 2.8 ms at
  groove 0.9 on tier Q2. The dial's beat marks land 6–8 ms (p50) after the click's output-clock
  time in headless Chrome; real speaker latency is not measured. Not verified: real microphone input, real power switching, Safari/Firefox,
  phones, context-loss recovery on real hardware, and GPU numbers outside headless Chrome.

### Shell navigation (outside sessions)

`App` owns one shared mic input; `GuitarNav` (`src/nav/useGuitarNav.ts`, `components/GuitarNav.tsx`)
makes every screen outside a session playable. Keys are exact notes from the 12th fret up, held
~0.4 s (`useNoteKeys`), shown as a compact note-and-icon strip at the foot of the page. Labels
remain in tooltips and accessible names. It is DOM-driven: the cursor
moves over every visible `button`, `select`, link and `role="button"` in reading order, so new
screens are navigable without wiring. It goes quiet while a session (`.ss`) is open.

| Note | Fret | Action |
| --- | --- | --- |
| `E5` / `F5` | high e, 12 / 13 | Cursor back / on |
| `F♯5` | high e, 14 | Press (a `select` turns to its next option) |
| `G5` | high e, 15 | Home (Tutor overview) |
| `G♯5` / `A5` | high e, 16 / 17 | Previous / next mode tab |

The keys are muted while something listens to the guitar or makes sound: open sessions, the Ear
trainer while it plays, Song's listening transport while playing, and the Devices dialog.
The tune's own notes can reach E5 and above.

Verified: cursor stepping/press logic (`nav.test.ts`), and in headless Chrome with a synthetic
guitar (a scripted `getUserMedia` stream through the real input and pitch pipeline): cursor
moves, mode tabs, home, press, starting a Changes session by played notes, and the Scales,
Reading, Ear and Song screens render. **Unverified:** a real guitar and mic. A programmatic click is not a user gesture, so a
session started this way may not go full screen until the page has been clicked once.

### Session gestures

| Gesture | Where | Action |
| --- | --- | --- |
| Hold a fretted note ~0.7 s | Ready | Begin (any note except the reserved action notes and open-string pitches) |
| `E5` (or assigned hear key) | Exercise | Hear it again |
| `F2` (or assigned pace key) | Exercise | Your pace |
| `G2` (or assigned time key) | Exercise | In time |
| `G♯2` (or assigned next key) | Exercise | Next exercise |
| D♯5 (high e, fret 11) hold 1.3 s → quiet release → fresh hold 0.6 s | Exercise / free play / instruments | Six-string menu (tempo, click, tuner, output and session controls) |
| `C3` | Done screen | Carry on |
| `A♯` | Done screen | Free play · metronome |
| `C♯3` | Done screen | Settings |
| `F3` | Done screen | Choose tune, then review and confirm inside the room |
| `F♯3` | Done screen | Toggle shuffle |

Action notes are shown beside their labels. Commands reserve all octave equivalents accepted by
the scorer, plus band pitches. Whole-tune cards (`run` and `step.kind === "tune"`) and improvisation
disable direct held/double-tap shortcuts; the deliberate menu gesture remains. Free play has a
separate confirmation before Leave. The done-screen mapping is `SessionSummary.tsx` (`KEYS`).

Choose tune works from ready, summary, the live menu and Free play without changing the outer
practice boundary or calling fullscreen exit. Optional opening matching must be armed, needs
six fresh attacks/three pitch classes, and preserves ambiguous matches. Review and separate
confirmation precede any change; pending practice saves drain first. Menus, instruments and the
picker suspend scoring/playback/automatic wake and reconnect. Physical guitar and native
fullscreen behavior remain unverified.

### Tempo, scoring and reactions

- **Your pace:** cursor waits per note; going back is followed; a take starts on a fresh attack. A
  clean take forgives the first and last note and one stray in twelve (`song/judge.ts`).
- **In time:** click starts at 88 % of the player's measured tempo; clean passes raise it (4 bpm,
  8 bpm when far below target). Untied repeated notes need separate attacks; tempo increases
  require a steady pulse, including comping. Two short passes lower it; two mostly-wrong
  passes send the band away until a clean at-your-own-pace take.
- **Pass thresholds** are per card: scales 0.85, arpeggios/chains 0.75–0.8, melody/voicings 0.7,
  reading 0.8 (roughly; see `Card.pass` in `song/deck.ts`).
- **Silence:** 8 s → next note sounded quietly; 12 s → passage replayed; 75 s → session rests until
  a note wakes it. The active clock stops after 12 s without a note, so AFK time is not counted.
- **Lost input:** session pauses; `useInput` reopens when a device returns, without reload.
- **"How it is going":** `song/estimator.ts` drives the CSS `--flow` warmth, the run counter and
  pass bars. Scales weight unbroken runs and steadiness; melodies weight right notes.
- **Wrong notes:** `ScoreShadows` writes the played note's name beside a hollow notehead at its
  staff height, and the written note's name below; `Fretboard` ghosts show the likely string/fret.
- **Playback position:** a bar highlight (`playingBar`) plus a cursor column (`cursor`) that pulses
  on a silence nudge; the score auto-scrolls.

### Curriculum and progress

- Deck cards carry `family` (`scales`, `harmony`, `melody`, `chords`, `reading`), `kind`, `rhythm`,
  `needs` (stage gate) and optional `secret`/`spot`/`fresh`.
- Scale stages: run → quarters → thirds → triplets → triads → sixteenths → sevenths. A stage opens
  once its prerequisite reaches box 2 (`unlocked`).
- Five-box Leitner: clean +1 box, ok stays, fail → box 1. Intervals 0/0/1/3/7/21 days. A session
  plans due cards, a few new ones, and a scale warm-up (`planSession`).
- Kinship (`song/kin.ts`): a clean scale pass credits relatives (same scale other pattern 0.34;
  same notes other tonic 0.5; one note apart 0.5; a fifth away 0.25). A whole box of credit moves a
  relative up unplayed.
- Scale cards are shared across tunes (`guitar-skills`); other families are per-tune.
- The map (`song/tree.ts` + `SkillTree.tsx`) is derived from the boxes and free-play log: circle of
  fifths hubs, relative minors inside, skills growing outward, tunes on the rim. Read-only.

### Done screen

`SessionSummary.tsx` shows:

- Session tiles: minutes, exercises, notes landed %, boxes gained; all-time sessions/minutes.
- Exercise movement: grouped by tune then family, each row from old box to new box, with tempo
  sparkline and verdict; carried relatives listed separately.
- A 14-session "clean exercises per session" trend line.
- The skill tree, lit for cards touched this session.
- Guitar actions (carry on, free play, settings, choose tune, shuffle) and an interlude played under
  the screen.

This is a v1 of the `todo` done-screen vision: movement, axes (tune × family), stats and guitar
actions exist. Captured tune-specific per-exercise history is now available in Progress; a
configurable axis model and shared-scale archive browser remain absent.

## Free play

`FreePlay` + `useFreePlay` + `song/freeplay.ts`:

- Opens with a quiet listening invitation and input control; notation appears after three notes,
  timing and best tempo only once measured. A manually enabled click shows its pulse before notes.
  Shares `PracticeAtmosphere` and the heard-beat `BeatPulse` with the coached session.
- Listens to single notes; estimates key (Krumhansl profiles), pattern (run, thirds, triads, 7ths)
  and grid/division (quarters, triplets, 16ths).
- The click joins once notes are steady, starts under the player's tempo, and follows the rules in
  `freeplay.ts`: clean readings raise it, sustained lateness lowers it, rushing never raises it,
  messy playing sends the band away.
- Writes the played notes to a score (`playedSheet`), logs what was practised to
  `guitar-freeplay`, tracks best tempo/record per key+pattern, and offers a matching card from the
  box when one exists.
- Guitar menu (D♯5 gesture), also a persistent button: slower/stay, faster, click mode, band and matching-card
  practice. Leave is on the first page when no card is offered; band status distinguishes playing,
  waiting and off. Stats distinguish consecutive bars and this visit's best tempo.

Strummed chords are read too (see Tutor layer): a loop of two to four chords offers its voicings
card. Progressions are not logged to `guitar-freeplay` or the map yet.

## Storage keys

| Key | Writer | Contents |
| --- | --- | --- |
| `guitar-key` | `App.tsx` | Tonic string for the Scales shape explorer, default `A`. |
| `guitar-tutor-v4`, `guitar-roman` | (none) | Written by the removed Practice tab; no longer read or written. |
| `guitar-song-deck:<tune>` | `song/leitner.ts` | Per-tune card box: cards, sessions, settings, history, credit, meta. |
| `guitar-goals-v1` | `song/goals.ts` | Immutable arrangement-bound goals and active selection; portable journaled state. |
| `guitar-skills` | `song/leitner.ts` | Shared scale card states and credit. |
| `guitar-freeplay` | `song/freeplay.ts` | Free-play log (`FreeEntry[]`), capped. |
| `guitar-freeplay-prefs` | `song/useFreePlay.ts` | Band on/off. |
| `guitar-room-render` | `pool/mode.ts` | Room mode `still`/`water`/`living`/`living-power`, default living-power (water on battery); device-local, excluded from sync/backup. |
| `guitar-pool-tier` | `pool/host.ts` | Living pool's last quality tier (0–3); device-local, excluded from sync/backup. |
| `guitar-rendered-room` | (none) | Earlier on/off rendered-water switch; read only to carry "on" over as Water. |
| `guitar-output` | `audio/output.ts` | Chosen output device id. |
| `guitar-input` | `listen/useInput.ts` | Chosen input device id. |
| `guitar-calibration` | `listen/calibration.ts` | Per-string detector profile bound to input device/sample rate. |
| `guitar-ear-v1` | `ear/useEarTrainer.ts` | Ear-training progress/settings. |
| `guitar-triads-v1` | `triads/box.ts` | Triad drill card box and note-name choice; synced, validated by `triads/model.ts`. |
| `guitar-changes`, `guitar-changes-times` | (none) | Written by the removed ii–V–I drill; no longer read or written. |
| `guitar-tunes-v2` | `tunes/library.ts` | Imported tune index: stable id/name, part/voice and small XML or large-XML reference. |
| `guitar-tune` | `TuneView.tsx` | Currently selected tune id. |
| `guitar-learn:<tune>` | `tunes/useCoach.ts` | Learn-mode plan progress. |
| `guitar-latency` | `audio/latency.ts` | Measured input lag bound to input device/sample rate and output route. |
| `guitar-arc` | `song/planner.ts` | The planner's current focus (mistake class, start day, strength). |
| `guitar-recordings` (IndexedDB) | `audio/recorder.ts` | Run-through takes per tune. |
| `guitar-tune-files` (IndexedDB) | `tunes/database.ts` | Large imported XML, referenced by the library index. |
| `guitar-sync-v1` (IndexedDB) | `sync/journal.ts` | Immutable transaction log, causal device identity/vector and committed outbox batch tokens. |
| `fretboard-sync-outbox-v1` | `sync/journal.ts` | Pending journal mutations written before materialized state; retried after reload with batch deduplication. |
| `fretboard-focus-devices-v1` | `sync/devices.ts` | Local device name, phone app URL, paired peer IDs/secrets and last successful exchange. Never exported as practice data. |

Access is guarded. Existing library entries and progress IDs remain stable; large inline scores
migrate only after the new score storage and index have both saved successfully.

## Manual device exchange and offline shell

- `sync/model.ts`, `journal.ts`, `merge.ts` and `state.ts` record portable state as immutable
  `device:seq` transactions, with causal vectors and deterministic replay. New attempt/session
  rows have stable identities. Repeating a union does not count the same event twice; devices
  can practise separately and merge later.
- Library XML, selected tune/key, tune/shared-scale progress, free play, ear progress/settings and
  retained legacy Learn state are portable. Recordings carry their existing IDs, metadata, MIME
  types and SHA-256 hashes. Input/output routes, detector calibration, measured latency and pairing
  secrets stay local to the device.
- Concurrent score edits preserve alternate library copies. Different pre-journal history
  snapshots are retained and reported as legacy conflicts, because overlapping old aggregates
  cannot prove which practice was shared. Reset/deletion handling uses causal context. Successful
  backup restores create an explicit restored generation; subsequent practice survives, while
  conflicting older/offline events remain retained in the journal and reported.
- `exchange.ts` compares inventories, sends missing transactions and recordings in both
  directions. Each recording gets a durable-save ACK before the sender proceeds to the next;
  the final saved ACK follows journal/projection.
  Portable `.fretpack` files use a `FRETPK01` prefix, big-endian JSON-header length, checksummed
  snapshot/recording manifest and concatenated audio. All binary hashes are checked before
  applying practice state. Limits are 128 MiB per recording/header and 2 GiB per archive.
- `transport.ts` pairs with one QR/link containing a short-lived fragment secret, then remembers
  the peer after a successful full exchange. PeerJS provides rendezvous; Cloudflare STUN is the
  default. The channel handshake and payloads are AES-GCM encrypted with fresh directional keys
  and replay counters. Logical payloads use 16 KiB chunks with backpressure and a 128 MiB default
  cap. TURN/custom signaling are build-time options described in README.
- Exchange is manual and foreground-only: keep Devices open on both idle screens. Pending
  library saves or backup restores finish before Devices opens, even after switching screens.
  The current feature's listening/scoring hooks are unmounted during transfer and remount saved state on
  close; full-screen practice blocks opening the dialog. There is no continuous/background
  replication. Use one active app window per device for an exchange;
  simultaneous cross-tab editing has not been verified.
- The repository includes a GitHub Pages workflow (`.github/workflows/pages.yml`) that gates on
  `make check`, builds with the Pages base path and deploys `dist/`; the workflow itself has not
  been run or verified here. A phone cannot use a laptop's localhost address. Host the production
  build at a reachable trusted HTTPS origin before phone microphone, install/Add to Home Screen
  and QR flows can be verified. The local dialog can remember that URL; entering it does not
  publish the app. `.fretpack` transfers remain usable between local browsers.
- `pwa.ts`, the web manifest/icons and the build-generated service worker provide a production
  offline shell after a successful cache installation. The worker is disabled in development;
  updates wait for old windows to close and do not reload a session. Sync rendezvous still needs
  connectivity. Physical-device/PWA behavior remains runtime-unverified.

## Audio and input

- **One shared context.** `audio/context.ts` creates a Tone context lazily (`ensureAudio`), adds a
  compressor + limiter, and starts output-device watching. `play()`/session entry must be called
  from a user gesture.
- **Sound sources.** `audio/samples.ts` pre-renders one-shot buffers (keys, bass, ride, hat, kick,
  click); `audio/pluck.ts` renders a plucked guitar; `audio/backing.ts` generates the older
  Practice-band events; `audio/cues.ts` provides pad/bass/hint/chime/interlude cues; `song/cues.ts`
  wraps them with speech.
- **Playback.** `tunes/usePlayback.ts` schedules a lookahead loop on the audio clock, scores notes
  against the timeline, and supports chord scoring and guide/shadow melody. `audio/usePlayer.ts`
  is the older bar/loop transport used by Practice, Reading and Scale shapes.
- **Visible beat.** Session playback and free play expose a shared `BeatSignal` from the output
  clock. The visual pulse follows heard beats, including count-in, rather than a separate CSS
  metronome; playback gaps and stopped/suspended audio clear the signal. Physical audio/visual
  alignment remains unverified on hardware.
- **Input.** `listen/useInput.ts` owns `getUserMedia`, prefers audio interfaces, reads both channels
  and chooses the louder, remembers the device, and reopens after device loss. `listen/spectrum.ts`
  does FFT/note/chord detection; `pitchDetection.ts` provides pitch/onset primitives.
- **Output.** `audio/output.ts` uses `AudioContext.setSinkId` where supported (Chrome/Edge), persists
  the device, falls back to system output when it disappears, and restores it on return. Only
  `SongCoach` exposes the picker (settings drawer and six-string menu), but routing is app-wide.
- **Calibration.** `listen/calibration.ts` fits per-string detector profiles; `Calibrate.tsx` is
  reachable from the session and stores `guitar-calibration`.

## Content and fixtures

- Project-owned code, documentation, visual assets and original music use `AGPL-3.0-only`.
  [ASSETS.md](../ASSETS.md) records content provenance; [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
  preserves separate dependency/font licenses.
- First Steps (`src/tunes/starter.ts`) is an original eight-bar C major study, added only when
  requested and included under the project license. The older Autumn Leaves model
  (`src/core/tunes/autumnLeaves.ts`) contains harmony data for domain fixtures, not a melody score
  or separate Practice tab.
- No third-party full-score transcriptions are bundled with the release source. Personal
  MusicXML files under `tunes/` are ignored. Imported library scores persist in browser-local `localStorage`
  and IndexedDB across restarts, and travel only through an explicit device exchange or export.
  They are separate from the repository and app build; importing does not change their license.
- Water and leaf textures are derived from the project owner's original photographs. The
  fretboard icon and First Steps study are project assets; see `ASSETS.md` for their scope.
- Reading cards include classical/traditional melodies encoded as scale degrees. The original
  project encoding is AGPL-licensed; underlying public-domain music remains public domain.
- Additional shared fixtures must be original or explicitly redistributable, with provenance.
  Tests must not depend on ignored personal score files.
- `scripts/generate-repo-map.mjs` generates the map. Score acquisition/conversion tools live in
  separate local projects, outside the release source.

## Test coverage

Focused suites in `src/__tests__/` cover:

- Music theory, keys/scales/spelling, patterns, landings, backing (`core`, `roman`, `demos`).
- Harmonic-minor shapes and drills (`shapes`).
- Reading generator invariants, accidentals, pattern conversion (`reading`; used as a `Score` fixture).
- MusicXML parsing, harmony, deck generation, card box, notation (`song`).
- Session kinship, stages, clean takes, note keys, free play, tree (`session`).
- Melody shadow support (`support`).
- Calibration and detector fitting (`calibration`).
- Tone-key assignment (`tones`).
- Practice spots, reading variation, multi-tune sessions (`practice`).
- Ear theory, voice leading, mastery, famous-song matching (`ear`).
- Scoring attacks, octave matching and timing gates (`audio-scoring`); suspended/stale input
  lifecycle (`input-lifecycle`) and device-bound calibration (`calibration`).
- Import cursor/voice/archive handling (`musicxml`); migration, pending saves, backup validation
  and rollback (`storage`).
- Overview and shell navigation (`overview`, `nav`), mounted tab/card/free-play routing (`smoke`),
  selected-card/calibration entry (`coach-entry`), and planner/profile records (`tutor`).
- Score rendering (`score.test.tsx`).
- Encrypted pairing/chunking/replay/cancellation (`sync-transport`) and missing-only exchange,
  archive corruption and pre-ACK validation (`sync-exchange`), using controlled transport/storage
  doubles rather than a real signaling service or IndexedDB device.

**Not covered on hardware:** real Web Audio output, microphone input, device reconnect, fullscreen,
browser storage limits on large tune libraries, and end-to-end scored sessions. Input/storage
failure paths use controlled test doubles. There is no Playwright/CI configuration committed.

## Known risks and blockers

1. **Docs and map can drift.** The map has been regenerated, but docs must be kept current.
2. **The chord quiz is still its own engine** (`ear/*`, `guitar-ear-v1`); it does not share boxes
   or stats with the tune session. Echo cards already use the shared deck.
3. **Progress remains bounded.** Tune-specific exercise history can recover captured journal
   attempts beyond the recent view, within the archive query caps. Shared scale archive browsing,
   planner archive integration and a validated overall ability model remain absent. Cross-tune
   observations and agent briefs still use retained recent stores.
4. **Free play chord recognition is untested on a real acoustic**: strum detection and naming are
   unit-tested on pitch-class sets only.
5. **String attribution is inferred, not heard.** `song/fingering.ts` chooses a position and
   `ghostSpot` guesses the likely string/fret; this is the known "so-so" string detection.
6. **Browser storage is still finite.** Large XML, recordings and the transaction journal use
   IndexedDB; private-mode restrictions and quota limits can prevent saving. Export `.fretpack`
   files to include recordings. The journal has a durable pending outbox when localStorage is
   writable; a quota failure can still require keeping the page open until saving finishes.
7. **Unverified runtime behavior.** Audio routing, mic detection, device unplug/replug, fullscreen
   and browser autoplay policies are implemented from code but not verified here. Physical output
   changes behind the browser's system-default route cannot be identified for recalibration.
8. **No verified phone hosting or physical sync yet.** A GitHub Pages deployment workflow is
   configured but has not been run here. A reachable production HTTPS origin is still needed;
   public signaling availability, restrictive NAT/TURN, large real recording libraries, installed
   mobile app storage and active-window handoff need physical end-to-end checks.

## Cleanup candidates (not done)

These modules remain in the source. Review their consumers before removing them.

- `src/reading/*` — only `Score`'s test uses it now (the Reading mode runs on `song/reading.ts` cards).
- `src/audio/exportMidi.ts` — `exportBackingMidi` has no UI wiring; MIDI export is effectively
  unfinished.
- Legacy-only code in `src/core/`: `PathStep` (contract), `landings.ts` (`landingMoves`,
  `LandingMove`, `stepShort`: voice-leading landings for the removed Practice) and the exported
  `buildAutumnLeaves`. Kept as possibly useful logic; only tests and each other use them.
- Dead CSS was pruned (`practice.css`, `styles.css`); what remains unreferenced is dynamic
  (`scale-*`, `role-*`, `kind-*`, `is-*`) or VexFlow's own classes.
- `docs/REPO_MAP.md` must be regenerated after file moves; do not hand-edit it.

## How to verify this snapshot

```bash
npm run typecheck        # strict TypeScript check
make test                # focused unit/component suites
make map-check           # generated repo-map freshness
make check               # typecheck + map freshness + tests
```

For runtime verification, start `make run`, open the Vite URL, and exercise each tab with a guitar
and an audio interface. Record what was actually tested; do not infer it from code.

# Architecture

How the app is put together and where to change it. This is a contributor guide, not an
exhaustive API reference. For the generated symbol index see [REPO_MAP.md](REPO_MAP.md); for
behavior of the practice session see [PRACTICE_SESSION.md](PRACTICE_SESSION.md); for the feature
inventory see [CURRENT_STATE.md](CURRENT_STATE.md).

## The shape of the app

Local-first React SPA. No app-data backend, router or server state. Optional device exchange uses
signaling plus encrypted WebRTC. `src/main.tsx` mounts `App`; `App`
owns the active view, Devices/Tools visibility, transient tune/card launch request, shared mic input and the key used by
the Scales shape explorer. Each mode owns its feature state; the session modes share one
component (`FocusView` → `SongCoach`). Free play is also reachable without a tune.

```
main.tsx
  └─ App.tsx
       ├─ header: brand + icon-labelled tab buttons + DeviceSync → DeviceSyncPanel
       ├─ Practice  ── OverviewView → useSongSummaries → summary/pickGlobalUnits
       ├─ Songs     ── TuneView → parseMusicXml → LeadSheet → buildTimeline
       │                 ├─ Score + listening transport + phrase/passage selection + exercise rows
       │                 └─ SongCoach → buildDeck → useSession → SessionSummary
       ├─ Progress  ── ProgressView → goals / exercise archive / observed patterns / retained take comparison
       ├─ Explore: Changes ── FocusView(changes) → SongCoach(focus) over familiesOnly(deck)
       ├─ Scales    ── ScalesView → FocusView(scales) | ShapesView → harmonicMinorShapes → usePlayer
       ├─ Reading   ── FocusView(reading) → SongCoach(focus) over familiesOnly(deck)
       ├─ Explore: Ear ── EarHub → FocusView(ear) | EarView → useEarTrainer
       └─ Tools     ── GuitarTools → useTuner / usePlayback (shared input/context)
```

The four layers:

| Layer | Directories | Rule |
| --- | --- | --- |
| Pure domain | `src/core/` and deterministic theory, planning, scoring and generation helpers in `song`, `tunes`, `reading`, `ear`, `overview` | No React or browser state. Keep `core` free of all DOM/audio/browser APIs. |
| Browser services | `src/audio/`, `src/listen/`, `src/storage.ts`, `src/sync/` journal/state/exchange/transport, tune library/database/backup, MusicXML DOM parsing and Leitner persistence wrappers | Own input, routing, parsing and durable state. Keep theory and sync projection/validation in pure helpers. |
| Stateful hooks | `use*.ts` throughout | React state, effects, persistence, subscriptions. This is where browser/stateful behavior belongs. |
| Presentation | `src/App.tsx`, `src/components/` | Render, gestures, CSS. Do not duplicate music theory here. |

`src/musicTheory.ts` is the low-level pitch/interval/scale/chord parser used by everything;
`src/core/` builds the tune/position/pattern model on top. `src/song/harmony.ts` is the modern
lead-sheet harmony/spelling layer. Do not fork note-name or spelling logic; reuse these three.

Score acquisition/conversion utilities live in separate local projects. The app accepts user-imported
MusicXML through `src/tunes/musicxml.ts`; conversion tools have no runtime or build role here.

`tunes/demos.ts` catalogs bundled original scores with stable `TuneEntry` identities. The existing
First Steps ID is preserved; Blue Hour imports its MusicXML source as a raw build asset. Opening a
demo goes through the same durable library/parser/session boundaries as personal music and never
overwrites an existing entry merely to restore a demo. Shared audio is primed in the originating
gesture before asynchronous save/selection; pending demo playback is tied to that selected score. Failed saving falls back to a labelled
bundled preview without replacing any saved edited arrangement.
The two original accompaniments use separated playable chord pulses; Blue Hour uses compact
shell voicings. `getDemoStudy` returns authored notes only for matching bundled content/part/voice,
so an edited arrangement does not inherit inappropriate fingering or teaching cues.

`agent/brief.ts` is a pure, versioned, bounded projection for user-initiated export. `TuneView`
collects saved material metadata/stores. `PracticeBriefPanel` selects music scope and 7/28/90-day
period, shows a readable summary and optional JSON, and copies/downloads only after explicit user
actions. Version 2 filters inputs before aggregation and limits clean tempos to dated visits in
the period. Nested assessment/goal fields are explicitly projected as well. No raw
score, recording, settings or journal dump crosses this boundary. It changes no practice result.
`public/llms.txt` documents capabilities without exposing browser-local data. The separate
`tunes/agentPrompt.ts` is user-copyable source-creation guidance, not a live agent integration.

`audio/useTakePlayback` owns one media element for a Progress comparison pair and connects its
MediaElementSource to the existing Tone destination. Ordinary buttons expose playback to the
played cursor. Source changes/unmount invalidate pending starts and stop media before Blob URLs
are revoked. Unknown recording duration stays unknown; backward seeking remains available in
heard audio and finite seek ranges enable forward seeking. Playback changes no practice state.

`tunes/passage.ts` gives deliberate passage choices playing-order bounds, printed-bar occurrence
labels and an arrangement-qualified ID. `TuneView` keeps the selection separate from playback;
the explicit Listen/Loop/Practice actions use those bounds. A custom passage is regenerated by
`buildDeck` only for an explicit launch, so it cannot enlarge the ordinary introduction or a
goal's essential tasks. Selection does not create another practice engine or rewrite the score.

Temporary timing alignment is fitted by `tunes/scoring.ts` and reused by Free play. Timed matching
keeps adjacent attacks disjoint; readiness distinguishes bounded phase, residual scatter and drift.
Free play also verifies distinct contiguous grid cells and successive-window alignment. Raw offsets
remain evidence; temporary alignment is not persisted as calibration or applied to the audio clock.
Profiles report timing consistency without interpreting constant reference phase as a habit.

## Two tune models, and why they exist

This is the main source of conceptual duplication.

### `Tune` — the legacy model

Defined in `src/core/contract.ts`. A `Tune` is bars of `ChordInBar`, each with a parent scale,
chord tones, guide tones and a teaching note. It is generated for all 12 minor keys by
`src/core/tunes/autumnLeaves.ts`, with a harmony level 1/2. Used by:

- Practice tab: `getTune(tutor.harmonyLevel, key)`, `buildPattern`, `fretboardNotes`, `LeadSheet`.
- Reading tab: `generateReading({ tune, key, level, loop, position, seed })`.
- Scale shapes: `buildMinorVamp` for the i–V backing.
- `usePlayer` / `Transport`.

It is a *harmony-first* model: the tune is known, and notes/patterns are generated from its chords.

### `LeadSheet` + `Timeline` — the modern model

Defined in `src/tunes/musicxml.ts` and `src/tunes/order.ts`. `parseMusicXml` produces a `LeadSheet`:
printed bars with notes/rests, chord symbols, key/meter/tempo, repeats/endings/jumps, printed bar
numbers, and optional comping voicings. `buildTimeline` expands the playing order into `Slot[]` and
`Target[]` (the actual notes to play, with ties collapsed and timing in beats). Used by:

- Tunes: score-centered `TuneView` and listening-only `usePlayback`; legacy `LearnView`/`useCoach`
  remain as compatible modules but are not rendered by Song.
- SongCoach: `buildDeck` turns the `LeadSheet` + `Timeline` into exercise cards.

It is a *score-first* model: the tune is arbitrary MusicXML, and exercises are derived from it.

**Do not merge them in a feature branch.** If you need a tune in the modern system, import the
MusicXML and build a `LeadSheet`. If you need the legacy Autumn Leaves harmony, use `getTune`. A
future unification is possible, but it is a large architectural change and needs a migration plan
for every consumer and every stored id.

## Data flows

### Tutor overview

```
guitar-tunes-v2 (index + small XML) / IndexedDB (large XML)
  └─ loadLibraryAsync → parseTuneEntry → buildTimeline → buildDeck
       └─ loadStore(tuneId) → summarizeSong(sheet, deck, store)
            ├─ nextUnits: due → unlocked new → unfinished → review
            └─ pickGlobalUnits: current song → overdue other song → different family
```

The overview is read-only with respect to progress: it calls no `saveStore`, no `planSession`
mutation and no audio. `useSongSummaries` caches each parsed `LeadSheet` and `Deck` in memory, keyed
by tune id plus an XML hash, and re-reads the store on mount so a completed session is reflected
when the player returns to the Tutor tab. The current tune still comes from `guitar-tune`, written
by both Tunes and the overview.

`SongSummary` optionally carries `excerpt` (the first two printed bars, key and meter), `tempo`
and `barCount`. These are presentation projections of the parsed score, rendered by the existing
`Score`; they do not alter exercises or persist another tune model. Without a library, the home
previews the First Steps score and adds it only when practice is started.

`OverviewView` presents that score and factual metadata, one flat Next exercise list, mode icons
and simple tune rows. `UnitCard` is a shared exercise row used by the overview and `FocusView`;
the tune list does not duplicate it. `Glyph` supplies shared icons for the header, modes and
actions. The compact guitar note/icon legend keeps the existing `useGuitarNav` mappings and mute
rules. View IDs, session launches and practice engines are unchanged by the presentation.

Overview actions carry an explicit tune ID and optional card ID through `App` to `TuneView`, so
failed preference persistence cannot launch a different song. A selected card becomes the ready
screen's one-card plan; the main action opens the budgeted daily plan. These are in-memory launch
requests, not URL deep links. The original First Steps study can seed an empty library.

`tunePath` uses durable clean-tempo evidence for section/whole/memory/run milestones. Technique
variants do not change its denominator. The profile uses measured accuracy and clean tempo/goal;
unknown legacy measurements are omitted rather than inferred from a box result.

### Modern Tunes → SongCoach

`TuneView` owns score browsing/listening and import/library tools. It builds the existing deck to
show phrase/exercise rows. Clicking a printed bar selects its melody phrase and reveals actions
inside the sticky listening transport. Practise phrase passes that exact card ID to `SongCoach`;
it does not create a parallel inline lesson or progress store. Listening
playback has mic scoring disabled. The primary practice action opens the daily coach plan.

```
File (.musicxml/.xml/.mxl)
  └─ loadTuneFile → parseMusicXml → LeadSheet
       ├─ buildTimeline → Timeline (slots, targets, comp, total)
       ├─ analyze(sheet, tl) → Harmony (key centres, chord events, cadences)
       └─ buildDeck(sheet, tl, { window, round, seen }) → Deck
            ├─ Card[] (family, kind, title, detail, bpm, goal, needs, tl, steps, context, voicings)
            └─ intro[] (teaching order)

SongCoach
  ├─ useSession(deck, tuneIds, input)
  │    ├─ loadStores(tuneIds) → Store (cards, sessions, settings, history, credit)
  │    ├─ planSession / planExtra → queue
  │    ├─ useFollower (pace, wait for notes) + useChordFollower (chord cards)
  │    ├─ usePlayback (in time, scoring, band, click)
  │    ├─ applyResult / carryOver / headStart → Store
  │    └─ SessionSummary data (log, store, elapsed)
  └─ Rendering: LineStage / MelodyStage / ChordStage / Score / Fretboard / GuitarPad
```

`buildDeck` options:

- `window`: first fret of the position window. `null`/undefined lets `chooseWindow` pick from the
  tune's key.
- `round`: changes when reading notes should be fresh (day + number of sessions).
- `seen`: per-card play counts, used to vary reading difficulty and choose known tunes.

`useSession` receives `tuneIds` so a session can mix the current tune and guests. Exercise ids are
glued with `<tuneId>::` for non-shared cards (`song/ids.ts`); scale cards keep a global
`scale:...` id and live in `guitar-skills`. This is why mixed sessions stay in the right boxes.

### Reading mode and the old generator

`FocusView focus="reading"` runs the deck's `reading` family (`song/reading.ts`: `freshLine`,
`knownLine`, `pickKnown`, `vary`) in `SongCoach`. `src/reading/generate.ts` is the older exercise
generator for the removed sight-reading tab; only `Score`'s test still uses it.

Generation is seeded and deterministic. If you change note selection, update the invariants in
`src/__tests__/reading.test.ts`.

### Audio

```
ensureAudio()
  ├─ one Tone.Context (latencyHint "playback", lookAhead 0.2)
  ├─ destination → Compressor → Limiter
  └─ watchOutputs() → audio/output.ts (setSinkId, fallback, restore)

usePlayback(timeline, mix, input, listening)
  ├─ schedules melody/chords/bass/click with a 250 ms lookahead
  ├─ scores each target in time
  └─ exposes playing, activeSlot/target, results, lastPass, drift, heard beat

usePlayer(tune)        // older transport: bars, loop, pattern, backing band
  └─ backing.ts + samples.ts + pluck.ts
```

`SongCoach`/`useSession` use `usePlayback`; Practice/Reading/Shapes use `usePlayer`. Do not create a
third playback path for a new feature. If a feature needs a metronome only, reuse
`useFreePlay`'s click rules (`freeplay.ts` `stepLock`, `clickFor`) or the `OneShots` click buffer.

Cues (`song/cues.ts`) are fire-and-forget sounds: pad chord, bass hint, hint note, chime, glint,
interlude, hush, speech. They are not part of the transport and must be safe when audio is not
running (they no-op).

`song/pulse.ts` defines `BeatSignal` (beat index within the bar, monotonic serial, active flag,
meter and count-in).
`usePlayback` reads the output timestamp used by the notation cursor; `useFreePlay` publishes a
beat only after its scheduled output time. `useSession` forwards the playback signal. Presentation
consumes these signals rather than starting its own metronome clock; stopped/suspended audio and
playback gaps clear the active beat.

Memory sections reuse `useSession` and existing card IDs/scheduling. A visit starts at page,
bar-start landmarks or hidden according to its known matching-arrangement review history, then
complete steady timed passes fade help. `Score.noteVisibility` hides pitch-disclosing links as
well as notes; existing ear-card played-note reveal remains the default. `memorySeen` aggregates
visual help over the visit and disables automatic melodic hints. Partial/own-pace memory exits
skip scheduling changes; a timed hidden section may reschedule the existing card. This stores no
new schema and makes no independent-retention claim.

The shared presentation is `components/PracticeAtmosphere.tsx` + `song/atmosphere.css`.
`PracticeAtmosphere` takes the existing input, warmth, flow, playing state and optional heard
beat; it reuses RMS frames
for a smoothed breath and caps colour by accumulated active input. It creates no audio context,
pitch detector or practice state. Water/leaf assets in `src/assets/` derive from the project owner's
original photographs and use the project AGPL-3.0-only license; see [ASSETS.md](../ASSETS.md).
`BeatPulse` in the same
module renders `BeatSignal` with an engraved SVG dial, alternating weighted sweep and one
resonance per serial; CSS controls finite decay/sweep, not beat scheduling. Reduced motion leaves
static texture and discrete beat markers. `RenderedWater` is an optional WebGL canvas behind the
score, using fixed-cost analytic waves, shared RMS and heard-beat envelopes. Resolution is capped
at 1,000 pixels on the long edge and rendering at 30 fps; inactive/hidden/reduced-motion rooms
stop the animation. Resource cleanup, context-loss fallback and capability guards keep it
independent from practice.

**Living pool** (`src/pool/`). `pool/mode.ts` stores one device-local room mode in
`guitar-room-render` — Still (default), Water (`RenderedWater`), Living, or Living on power — and
reads the old `guitar-rendered-room` switch only to carry an "on" over as Water. Living needs
WebGL2 with renderable half floats and no software rasteriser; Living on power also needs the
Battery Status API to report a charger (`pool/power.ts`), else it resolves to Water. One
`PoolRoom` provider wraps each practice room (`SongCoach` outside the keyed room, `FreePlayView`,
standalone `GuitarTools`; nested providers defer to the outer one). Each `PracticeAtmosphere`
publishes `{ playing, warmth, flow, beat, bpm }` to the provider's `PoolBus`; the last mounted
publisher wins and the provider's single canvas is moved into its `.pa-pool-slot` (a WebGL context
survives reparenting), so fluid state persists across session, free play, instruments and tune
changes. `pool/host.ts` and `pool/engine/*` load by dynamic `import()` only when Living is
effective. The host subscribes to the shared input only while Living, reads pitch from the
per-frame `pitchOf` cache during the publisher's `playing` turn, and runs `pool/groove.ts` (pure:
`createOnsets`, `guessKey`, `steadyGap`/`readGrid` from `song/freeplay.ts`) to a slow groove that
needs about two minutes of pitched playing; `pool/params.ts` maps it to the look. At rest the
photograph is already visible and gently flowing; glow, bloom and blobs are earned. Notes drop ripple stones on a phrase phyllotaxis; heard
`BeatSignal` serials light the dial's rim on the same frame and drop a ring already at the rim; tuner readings drive a moiré at
the real beat frequency; SongCoach emits a `bloom` on a clean outcome and a `sweep` on a card
change. Nothing is read back. The engine (`engine/renderer.ts`, DOM-free) runs stable fluids,
a two-phase flow map over the crisp photograph (two advected displacement fields, each restarting
unseen every flow period and crossfaded, so the image keeps flowing without tearing), a ripple height field, note dye, heat
with buoyant blobs, 34 GPU leaves cut from the algae photograph, bloom and a soft-knee composite.
`[data-pool]` tokens on room elements become rocks (fluid obstacles), calm lenses (pull back toward
the resting look so text keeps its contrast) or glass (magnify; the metronome dial). Quality tiers
Q0–Q3 are governed from GPU timer queries and the pool's own JS time and persist in
`guitar-pool-tier`; hidden pages stop, release after 30 s; a second context loss or Q0 overrun
rests the room as Water for the visit. `--pool-glow`/`--pool-tint` on the room root change only
colour and opacity. In development `window.__pool` drives the visuals without a guitar.
`song/coach-flow.css` owns Ready/Running
layout and action affordances; `song/freeplay-room.css` owns the free-play invitation and gradual
reveal of notation/measurements. The presentation reuses the existing engines and gestures.
`useSummon` requires `SUMMON_NOTE` (D♯5, high e fret 11) held 1.3 s, at least 150 ms of quiet
and a fresh 600 ms hold within five seconds; the coach blocks it while the music sounds that note. Another pitch cancels the arm. `GuitarPad` primes held-string input after the opening note stops or changes, then accepts a
fresh 600 ms row hold. Its scrim and responsive rows are shared; free play fixes the overlay to
the viewport so it remains reachable while the room scrolls.

`tools/GuitarToolsRoom` is shared by shell Tools and embedded practice/free-play instruments.
Only shell Tools adds a writer boundary; embedded instruments keep their host's boundary.
Opening them suspends the host engine and hides its controls; close stops the instrument click
before resuming a pause it owns. Tuner uses `useTuner`; metronome uses `usePlayback` with an empty
timeline of 2–7 quarter beats. Meter changes stop playback and require an explicit fresh Start.

`SongCoachRoom` is keyed inside a stable `PracticeWindowBoundary`, allowing tune replacement
without releasing writer ownership or fullscreen. `TunePicker` arms `useThemePicker` explicitly,
then separates candidate review and fresh confirmation. `song/theme.ts` matches original-key
pitch-class prefixes (six attacks, three pitch classes; no fuzzy/transposed claim), preserves
ambiguity and never navigates. Confirmed changes drain pending writes before the host replaces
the tune. `useSession.Options.suspended` gates scoring, playback and automatic recovery while a
modal owns input; reconnect/away recovery waits for it to close. Command allocation in
`song/notekeys.ts` reserves the octave equivalence accepted by scoring. Whole-tune cards and
improvisation disable direct musical shortcuts entirely.

### Input

```
useInput({ fftSize, intervalMs })
  ├─ getUserMedia, prefer interface, read both channels, louder wins
  ├─ remembers guitar-input, reopens on devicechange without a reload
  └─ subscribe(frame) → { buf, sampleRate, now, rms }

subscribers:
  ├─ useFollower       wait-for-me note matching and per-note results
  ├─ useSession        note scoring, silence detection, note keys
  ├─ useFreePlay       onset/key/pattern/grid detection
  └─ GuitarPad         held-note and tone-key gestures
```

The mic is mono/dual-channel, not per-string. `listen/spectrum.ts` and `pitchDetection.ts` provide
FFT, pitch, note and chord primitives. `listen/calibration.ts` fits per-string profiles and is
applied by the detector. String attribution is inferred by `song/fingering.ts`, not heard.

## Key modules

### App shell and shared UI

| Path | Role |
| --- | --- |
| `src/App.tsx` | Tab state, key/Roman prefs, selected bar/chord, loop, position, pattern, reading exercise, shared mic input, stop-on-tab-change. |
| `src/components/Fretboard.tsx` | Shared fretboard renderer: notes, labels, position window, pattern, active step, ghosts, pulses. |
| `src/components/Score.tsx` | VexFlow renderer: bars, chords, repeats/endings, tuplets, results, cursor, playhead, focus/hide bars, note labels, fingering. |
| `src/components/LeadSheet.tsx` | Lead-sheet layout with chord symbols and bar selection. |
| `src/components/GuitarPad.tsx` | Guitar-as-controller primitives: `useNoteKeys`, `useToneKeys`, `useSummon`, `GuitarPad`, `NoteTag`, `ToneTag`, tone-key assignment. |
| `src/components/keyContext.ts` | Key/Roman React contexts. |
| `src/components/Transport.tsx` | Shared play/stop, BPM, swing, click, count-in, mix, loop controls for `usePlayer`. |

### Modern session

| Path | Role |
| --- | --- |
| `src/components/SongCoach.tsx` | Full-screen session UI, ready screen, running screen, done screen wiring, settings drawer, six-string pad, calibration, free-play switch. Large; treat as orchestration, not domain logic. |
| `src/components/SessionSummary.tsx` | Done screen: tiles, movement, trend, tree, guitar actions, interlude. |
| `src/components/PracticeAtmosphere.tsx` | Shared decorative RMS/flow atmosphere and heard-beat `BeatPulse`; publishes to the room's pool; no practice decisions. |
| `src/pool/mode.ts`, `src/pool/power.ts` | Device-local room mode (Still/Water/Living/Living on power), legacy migration, GPU probe, charger state. |
| `src/pool/PoolRoom.tsx`, `src/pool/bus.ts` | One pool per room: publisher stack, events, calm tokens, shared-input forwarding; hooks `usePoolPublisher`, `usePoolCalm`, `usePoolEmit`. |
| `src/pool/groove.ts`, `src/pool/params.ts`, `src/pool/golden.ts` | Pure mood estimator, groove → look mapping and golden-ratio placements. |
| `src/pool/host.ts`, `src/pool/engine/*` | Lazily loaded renderer lifecycle (rAF, tiers, visibility, context loss, anchors) and the DOM-free WebGL2 engine. |
| `src/song/useSession.ts` | Session engine: queue, phases, takes, tempo, silence, input loss, spots, outcomes, persistence. |
| `src/song/deck.ts` | Builds exercise cards from a lead sheet: scales, harmony (incl. improvise), chords (voicings, comping), melody (incl. run-through), reading, ear, fretboard. |
| `src/song/leitner.ts` | Card box, session planning, result application, kinship carry-over, storage. |
| `src/song/judge.ts` | Clean-take leniency. |
| `src/song/estimator.ts` | Smoothed "how it is going" number. |
| `src/song/support.ts` | Adaptive melody shadow (plays under the player where needed). |
| `src/song/freeplay.ts` | Pure free-play analysis: onsets, key, pattern, grid, click rules, log. |
| `src/song/useFreePlay.ts` | Live free-play hook: audio scheduling, state, band, logging. |
| `src/song/pulse.ts` | Shared heard-beat signal for playback, sessions and free-play presentation. |
| `src/song/notekeys.ts` | Assigns action notes outside the exercise's pitch classes. |
| `src/song/spot.ts` | Takes a troublesome bar out of a longer card. |
| `src/song/kin.ts` | Scale kinship. |
| `src/song/tree.ts` | Circle-of-fifths skill tree derived from boxes/credit/free log. |
| `src/song/stats.ts` | Derived trends/totals. |
| `src/song/evidence.ts` | Per-attempt evidence: first-try notes, wrong pitches, misses after leaps/crossings/shifts, onset timing, restarts, hears, a run-through's weak bars. |
| `src/song/profile.ts` | The player across every box: skill axes (level, trend), recurring mistake classes, tempo ceilings. Derived, not stored. |
| `src/song/planner.ts` | Shaped sessions: warm-up, focus (profile arc, run-through bars, neglected skill), review (`planSession`), music; minutes from the player's own times; new cards by recent success. |
| `src/song/progression.ts` | Strummed chords in free play: naming, folding repeats, finding a 2–4 chord loop, matching a voicings card. |
| `src/song/fretboard.ts` | Seeded prompts for fretboard cards: notes on a string, thirds by shape, chord tones. |
| `src/audio/latency.ts` | Measured input lag (calibration play-along) and audio-clock → performance-clock mapping. |
| `src/audio/recorder.ts` | Run-through takes in IndexedDB; first + newest ten kept per tune. |
| `src/song/cues.ts` | Musical cues for the session. |
| `src/song/notation.ts` | Turns a card's line into a `ReadingExercise` for `Score`. |
| `src/song/fingering.ts` | Position window and string/fret assignment. |
| `src/song/harmony.ts` | Chord/scale parsing, analysis, key centres, spelling. |
| `src/song/lines.ts` | Scale/arpeggio/guide-tone/chain line generators. |
| `src/song/voicings.ts` | Shell voicings for chord cards. |
| `src/song/rand.ts` | Seeded PRNG/shuffle. |

### Tunes

| Path | Role |
| --- | --- |
| `src/tunes/musicxml.ts` | MusicXML/MXL parsing into `LeadSheet`; chord symbols, comping, bar numbers, repeats/jumps. |
| `src/tunes/order.ts` | `playOrder`, `buildTimeline`, `slotOfBar`, `firstTargetAt`, `printedResults`. |
| `src/tunes/usePlayback.ts` | Audio-clock playback and in-time scoring. |
| `src/tunes/useCoach.ts` | Learn-mode plan progression and persisted state. |
| `src/tunes/learn.ts` | `buildPlan`, chord landings, melody-over-chords reduction. |
| `src/tunes/unzip.ts` | `.mxl` unzip. |
| `src/tunes/chordName.ts` | Names chords from voicings when the file has no symbols. |

### Reading, follow, ear

| Path | Role |
| --- | --- |
| `src/reading/generate.ts` | Older deterministic reading melodies (only `Score`'s test uses it). |
| `src/follow/follower.ts` | Wait-for-me matcher: index, results, misses, retakes, wrong note. |
| `src/ear/*` | Ear-training theory, library, engine, session hook. |

## The session state machine

`useSession` is the most important stateful module. Read it before changing session behavior.

```
running=false
  start()/begin(plan)
    queue = planBlocks(...).ids   (SongCoach; planSession is the review block's engine)
    pos = 0, phase = "intro", running = true
      intro → (listen?) → pace → time → result
        listen: app plays the card; any note or timeout advances
        pace: cursor waits for each note; clean takes counted
        time: loop with band/click; passes scored; tempo moves
        result: show outcome, then next card or finish
      next card → intro …
      finish → finished = true, SessionSummary
      keepGoing() → append planSession/planExtra, continue
      exit() → finish if needed, stop, running = false
```

Persistent vs transient state:

- `store` (`Store`) is persisted per tune; `log`/`outcome` are the session's record.
- `queue`/`pos` drive the session; `card` is derived from `queue[pos]`.
- `phase` is transient; `paused`/`away`/`waiting` are reactions, not phases.
- `pressed`/`follow`/`chords` are note-matching state from `useFollower`/`useChordFollower`.
- `playback` is the audio/scoring state from `usePlayback`.
- `clock.current` holds `active`, `card`, `heard`, `event`, `nudges`; `active` is the only time that
  counts toward session minutes.
- Refs (`logRef`, `recorded`, `storeRef`, `boxes`, `ownTempo`, `missRun`, etc.) bridge async effects
  without stale closures. Be careful when adding state that an effect reads; prefer a ref if the
  effect must see the latest value without re-subscribing.

Important constants at the top of `useSession.ts`: `UNDER`, `STEP_UP`, `STEP_UP_FAR`, `STEP_DOWN`,
`MESSY`, `IDLE_MS`, `NUDGE_MS`, `REPLAY_MS`, `AWAY_MS`, `MAX_UNCLEAN`, `SPOT_CLEAN`, `MAX_SPOTS`.
Change them with the behavior doc and tests, not casually.

### Session outcomes

`conclude(result, share)` writes an `Outcome` with `from`/`to` boxes, BPM, share, seconds, carried
relatives (`also`), spots, and an optional secret. `applyResult` computes the box move;
`carryOver` credits relatives; `headStart` applies accumulated credit on a first clean pass;
`logAttempt` adds an `Attempt` (with `ev`, its evidence) to history; `finish()` writes a
`SessionEntry` with active minutes. Ear and fretboard cards conclude after their own-pace take
(fretboard: clean only when the notes came within `PROMPT_SECS` for the box); a run-through
concludes after its one pass (`card.run`) and its take is recorded.

## The card deck and curriculum

A `Card` is the unit of practice. Its fields matter:

- `id`: local (`mel:new:0-1`, `sec:A#0:arps`, `scale:C-major:run`) or glued (`<tune>::...`).
- `family`: `scales | harmony | melody | chords | reading | ear | fretboard` (drives labels/colors/stats).
- `kind`: scale drill (`run`, `thirds`, `triads`, `sevenths`), harmony (`arps`, `guides`, `chain`),
  `voicings`, `comping`, `improv`, `melody`, `known`, `varied`, `line`, `echo`, fretboard
  (`onstring`, `shape3`, `tones`).
- `needs`: prerequisite card id; the card is locked until that card reaches box 2 (or credit ≥ 1).
- `tl` + `from`/`to`: the slice of the timeline this card plays.
- `first`/`last`: target indices (inclusive) for scoring.
- `steps`: fingering per target; `context`: harmony per target; `voicings`: chord shapes.
- `view`: `fretboard | score | chords | improv | prompts`, which stage component renders it.
- `run`: a run-through (once, nothing stops, tempo holds). `prompts`/`exact`: fretboard cards' asks
  and whether the octave counts.
- Timeline targets may carry `chord.strike` (comping: must be struck again) or `any` (improvising:
  any of these pitch classes lands).
- `fresh`: reading cards whose notes change; never previewed, no neck.
- `spot`: a card made from a trouble spot.
- `secret`: a hidden tune identity revealed after playing (ear/known-tune cards).

`buildDeck` constructs cards in this order: scales per key centre, harmony cards per section/cadence,
chord voicings, melody plan chunks/joins/sections/memory, reading lines. `intro` is the teaching
order; `planSession` uses it for due/new selection.

Scale stages (`SCALE_STAGES`) are the clearest example of the intended pedagogy:

```
run → run:quarters → thirds → run:triplets → triads → run:sixteenths → sevenths
```

Each stage's `needs` points at the card it builds on. The rhythm variants use `RHYTHMS` to choose a
starting tempo/goal that keeps notes-per-minute sensible.

### Leitner rules

- Boxes 1–5; `BOX_DAYS = [0, 0, 1, 3, 7, 21]` days until due.
- Clean +1 box (max 5), `ok` stays, `fail` → box 1. Clean also raises BPM by 4 up to `goalBpm`.
- `planSession`: due cards (lowest box first), a scale warm-up, then two reviews + one new card;
  shuffle is deterministic per day/session.
- `planExtra`: when nothing is due, the cards furthest from done.
- `kin`: only scale ids; `carryOver` adds credit, moves a relative up when a whole box accrues.
- Shared scale cards: ids start with `scale:`; `saveStore` mirrors them into `guitar-skills`, and
  `loadStore` merges the copy with more plays. Other families stay in the tune's store.

If you add a card family, update `familyOf`, `FAMILY_LABEL`, the summary grouping, tree/stats (if it
should appear there), and the tests.

## Musical goals and assessment provenance

`guitar-goals-v1` contains immutable goals grouped by tune and an active goal ID. Each goal freezes
an outcome, 1–12 essential task IDs, personal start/target BPM and an interpreted arrangement
fingerprint. `goalDeck` adjusts session tempos without editing imported score tempo; the planner
prioritizes its relevant tasks. `GoalChooser` subscribes via `useGoals`. The fingerprint includes
musical notes/form/source selection/comping and excludes display fingering and title.

`sync/model.ts` validates full goals and replay output; `sync/merge.ts` unions goal IDs even for
two independent first writes. Conflicting content under the same immutable ID rejects projection.
Only the active selection follows ordered transactions. Explicit backup resets still create a
new generation. Local creation is capped at 12 goals/tune; replay allows 256 so independent device
histories have room. Bounds fail visibly without silently dropping goals.

Attempts and takes optionally carry `AttemptConditions` (measured/self, support, notation,
tempo mode, exposure, confidence, interruption) plus arrangement fingerprint. Omission means
unknown legacy evidence. No detector-confidence level is inferred from a clean result. Current
goal proof checks actual measured attempts since creation and matching fingerprint. Timed tasks
need samples and stable assessed-pass BPM; echoes prove successful own-pace response and describe
BPM as reference-call tempo. Historical `bestCleanBpm` is retained, with its weaker provenance
explained in Progress.

`usePlayback` tracks BPM bounds per assessed pass, independent of trimmed scheduling segments.
`useSession` logs the assessed tempo; manual changes invalidate the current pass immediately.
A varying run-through cannot earn a new clean-speed claim. Stable adaptive lesson passes remain
app-checked practice evidence, distinct from independent fixed-tempo uninterrupted performance.
Self-guided operation uses this same state machine, logs activity and excludes automatic
box/kinship/best/profile credit. Graceful finish waits for the current timed pass before summary.

`audio/recorder.ts` exposes durable save outcomes and a subscribed pending-Blob recovery list.
A failed save retains audio in memory for retry/download; consumers never treat an IndexedDB
failure as an empty recording list. `keepPracticeWrite` keeps the window owner alive through
stop-and-save. Take conditions/fingerprints survive transfer manifests and file export.

## Persistence

Small records stay in `localStorage`; large imported XML uses IndexedDB (`guitar-tune-files`).
Practice/library persistence goes through `src/storage.ts`: failures appear in `SaveNotice`,
pending writes are read through on remount, and retries/backups can rescue them. Store versions
and existing key names stay compatible. There is no general migration framework.

Imported scores are persistent browser data, separate from repository files and the production
build. They survive a normal browser restart and are removed when site data is cleared. Parsing
and saving an import does not upload it to the static host; an explicit Devices exchange or
transfer export includes the saved library XML. Importing never changes the score's license.

Rules:

- Keep key names stable. Add new keys rather than renaming old ones unless you write a migration.
- Keep `guitar-song-deck:<tune>` and `guitar-skills` compatible; they are the practice history.
- `saveStore` caps history at 800 attempts and sessions at 200 (`saveStores`), and writes shared
  scale cards. Optional `at`/`goalBpm` evidence orders new attempts and explains achieved tempos;
  `bestCleanBpm` survives detailed-history trimming and is never the next suggested BPM.
- Await `loadLibraryAsync()` before changing the library. Partial hydration returns healthy entries
  and named issues; `loadCompleteLibraryAsync()` gates full-state backup/exchange. Explicit repair
  preserves IDs, and identity-only removal journals a tombstone while retaining practice history. It hydrates XML references, keeping
  the old inline library intact until both the IndexedDB write and updated index succeed.
- Use `parseTuneEntry()` for persisted scores. Entry IDs are durable; parser metadata slugs
  are only legacy defaults. Replacing a score is explicit; duplicate content opens the saved copy.
- Import previews the chosen part/voice and sounding range. The selected part uses its first
  staff; instrument transposition is warned about rather than applied, retaining guitar octave
  interpretation.
- `tunes/backup.ts` validates and merges backup tunes/settings/history with rollback on failed
  writes. Audio recordings are excluded; failed pending progress writes are included on export.
- Audio takes use IndexedDB (`guitar-recordings`); `guitar-latency` and `guitar-arc`
  are small localStorage records (measured input lag; the planner's current focus).
- Test persistence logic as pure functions where possible; the storage wrappers are thin.

## Occasional two-way state exchange

`src/sync/` is a portable transaction layer over the existing materialized stores, not another
practice engine. `model.ts` validates snapshots and immutable identities; `merge.ts` is the pure
deterministic projection. `journal.ts` owns durable device sequencing/outbox/IndexedDB;
`state.ts` captures and applies snapshots; `exchange.ts` handles inventory/archives/ACKs;
`transport.ts` owns encrypted foreground connections; `devices.ts` keeps local pairing preferences.

Each mutation has a stable `device:seq` ID, Lamport clock and causal version-vector context.
Union rejects an ID reused with different content and sorts deterministically; wall-clock `at`
is evidence, not a last-write-wins rule. New attempt/session rows also carry stable IDs. Practice
deltas combine plays, clean results, time and progress without replaying an event twice. Shared
scale progress is owned by `guitar-skills`, so copies in tune stores cannot multiply credit.
Independent score-field edits combine; overlapping concurrent edits preserve alternate library
copies. Resets/deletions use causal context rather than resurrecting concurrent old state.
Successful backup restores record explicit full-state reset transactions. Replay selects the
effective restored generation first, then applies practice that observes it; losing concurrent
restores and older offline events remain preserved in the journal and reported as conflicts.

Existing browser data is captured as a baseline. Identical baselines deduplicate; different
pre-journal aggregates cannot prove a shared ancestor. Their originals stay in the journal,
projection is conservative and the exchange reports legacy conflicts. Do not claim exact recovery
of overlapping history recorded before stable transaction IDs existed.

Small mutations first enter `fretboard-sync-outbox-v1` in localStorage, before the ordinary state
write. A stable batch token is committed alongside sequence allocation in IndexedDB
`guitar-sync-v1` (`transactions` and `meta`), so a crash after journal commit but before outbox
removal cannot create another practice event. Journal errors/pending state must remain visible.
Capture flushes pending mutations. Apply validates the union/projection, commits the journal, then
writes existing storage/library projections with sync recording suppressed. An interrupted
projection can be repaired by repeating the same union. Keep active practice outside the dialog;
Devices entry waits until pending library saves and whole backup restores finish, including
operations whose initiating screen has unmounted.
`App` unmounts the current feature for the dialog's lifetime, cleaning up Song listening/Ear
timers, then remounts persisted projections on close. A full-screen practice session blocks
device entry. Merge operations serialize within the page and use a named Web Lock where the
browser supports it; projection rechecks the committed union and retries if it changed.
`platform/practiceWindow.ts` reserves one writer across same-origin windows using Web Locks.
`PracticeWindowBoundary` mounts before session, Free play, Ear quiz, Tools or Devices hooks. A
handoff unmounts the active subtree and waits for tracked writes, recording rescue and pending
progress before releasing ownership. BroadcastChannel/storage events request handoff; they never
establish ownership. Unsupported browsers are conservatively blocked from protected operations.
An initial unavailable claim stays in Checking until a peer announces ownership or a second
claim confirms contention, allowing an unmounted local owner time to release without a false warning.
JSON restore and update checks acquire the same idle lock. Physical suspension/handoff still needs
testing; no expiring localStorage lease pretends to be an atomic lock.

The journal's local IndexedDB schema 2 adds a `[kind,key]` index without changing portable format
version 1. `readPracticeTransactions` flushes pending journal writes, then reads only one complete
tune group with a readonly cursor, capped at 5,000 transactions / 8,388,608 before/after characters.
It returns no partial evidence when capped. `practiceHistory.projectPracticeStore` validates and
reuses the normal projector for UID deduplication, reset generations and legacy conflicts.
`projectGoalEvidence` applies `goalProgress` to that same validated store.
`useGoalEvidence` cancels stale goal/revision reads and supplies display-only GoalChooser counters;
`usePracticeHistory` does the same for a selected tune's exercise browser. Incomplete, conflicted
or failed reads are unknown. The browser groups actual attempts by stable task ID, keeps legacy,
self-guided and skipped rows inspectable, and plots only dated measured clean attempts with
timing observations. Arrangement and assistance remain attached; there is no combined progress
line across conditions. Shared scale IDs belong to `guitar-skills` and are excluded from this
tune-group archive. Captured history may already have been trimmed before the journal began.
Materialized stores, planner and brief remain on retained recent history, so a previously
demonstrated task can still be suggested for review. Archive reads never write practice state.

Portable state includes tune XML/identities, musical goals, selected key/tune, per-tune/shared-scale progress,
free-play and ear progress/settings, retained Learn data, and all recordings still stored locally.
Audio input/output IDs, detector calibration, measured latency, the active sequence allocator and
pairing keys stay local. Source device IDs still travel with their immutable transactions.
Keep device secrets outside snapshot/backup whitelists.

`exchangeState` sends inventories first, then only missing immutable transactions and audio IDs.
It rejects missing advertised transactions, recording-ID/hash collisions and changed manifests.
Received recordings must pass SHA-256/size checks and commit before journal/projection. The
sender waits for each recording's durable-save ACK before sending the next Blob, bounding the
receiver's persistence queue; a final saved ACK follows practice application. `initiator`
determines send/receive order to avoid deadlock.
Remember the pair only after the complete two-way exchange succeeds; failures are retryable unions.

`.fretpack` is the manual file equivalent: `FRETPK01`, a four-byte big-endian header length,
JSON header (version, snapshot, recording descriptors and canonical-content SHA-256), followed by
the audio blobs in manifest order. Verify total length, snapshot/header checksum and every audio
hash before projection. Current caps are 128 MiB per recording/header and 2 GiB per archive.
The older JSON `tunes/backup.ts` format remains compatible and excludes audio; it is distinct from
the full transaction/recording archive. New JSON exports use the same portable-key policy;
legacy hardware keys are accepted on parsing but ignored on restore. Current-device input/output,
calibration and latency are retained. Full archives include pending recoverable audio; paired
exchange requires it to save before advertising a durable-known recording ID.

One-QR pairing uses a ten-minute URL-fragment invitation with host peer ID and a random 256-bit
key. PeerJS handles SDP/ICE rendezvous; Cloudflare STUN is the default. STUN alone cannot carry the
answer, and restrictive networks may need TURN. Every datachannel frame, including mutual hello,
is AES-GCM encrypted. Fresh nonces derive directional session keys; checked counters reject
replays. Frames carry 16 KiB chunks with backpressure/timeouts; the default logical-item cap is
128 MiB, and receiving a recording assembles one bounded Blob before persistence.

`syncNetworkConfig()` accepts public build settings `VITE_SYNC_SIGNALING_HOST`, `_PORT`, `_PATH`,
`_SECURE`, `_KEY` (with the common `VITE_SYNC_SIGNALING` prefix) and `VITE_WEBRTC_ICE_SERVERS`
(JSON `RTCIceServer[]`). It validates configuration without printing credentials. The default
PeerJS service is an external availability dependency; there is no background or continuous sync.
Devices must be foreground/open on both ends; remembered secrets enable the next manual exchange.

## Production phone/offline shell

Source publication does not provision hosting. A phone cannot open a laptop's localhost
origin. Host the production `dist/` at a reachable trusted HTTPS site before verifying
phone microphone, camera-link/QR entry or installation. `DeviceSyncPanel` lets a local browser
remember that phone app URL; entering it does not deploy anything. File exchange is available
between local browsers without signaling, but does not make the app reachable on a phone.

`public/manifest.webmanifest` and icons describe the installable app. `pwa.ts` registers the worker
only for a secure production build. `vite.config.ts` emits `sw.js` from the final asset list,
including lazy chunks, and caches the offline shell under a build-specific scope. Navigation
falls back to cached `index.html`; updates wait for all old app windows to close, without
`skipWaiting` or session reload. Browser user data remains in its own localStorage/IndexedDB.
Offline/update status is observable through `pwa.ts` and `PlatformStatus`. Update checks are
idle-only and never invoke skipWaiting. UI fonts are local WOFF2 assets imported by `fonts.css`
and included in the build cache; their unmodified source URLs/hashes are in
`notices/font-assets.json`. Offline shell code is inspected; real mobile installation/offline updates and physical pairing
remain unverified until tested on devices.

## Contracts and types

- `src/core/contract.ts` is the old typed boundary between `core`/`audio`/`tutor` and UI. It is
  still the contract for Practice, Reading, Fretboard, `usePlayer`, and the legacy path. Change it
  only with every consumer updated.
- Modern types are closer to their modules: `LeadSheet` (`tunes/musicxml.ts`), `Timeline`
  (`tunes/order.ts`), `Card`/`Deck` (`song/deck.ts`), `Store`/`Settings` (`song/leitner.ts`),
  `SessionApi` (`song/useSession.ts`), `InputApi` (`listen/useInput.ts`), `PlaybackMix`/`PassScore`
  (`tunes/usePlayback.ts`).
- Prefer `import type` and the existing types over `any`. The project is strict with
  `noUnusedLocals`/`noUnusedParameters`.
- `SongCoach` returns `SessionApi` from `useSession` and passes it to `SessionSummary`; that is the
  seam for adding done-screen data. Add fields to `SessionApi` rather than reaching into internals.

## How to extend safely

### Add a tab/view

1. Add the id to `Tab` in `App.tsx`, a button to the nav, and a render branch.
2. Stop the shared player on the new tab if it has its own audio (`useEffect` next to the existing
   ear/shapes/changes/tunes stop).
3. Export the component from its module. Add a focused smoke test if it renders complex state.
4. Update `README.md`, `CURRENT_STATE.md`, and regenerate the repo map.

### Add a guitar gesture

1. Use `useNoteKeys` for a note-by-name action, `useToneKeys` for a double-tapped pitch-class action,
   `useSummon` for the guitar menu, or `useHold` for a held-note "yes".
2. Assign notes outside the exercise's pitch classes with `toneKeysFor`/`drawerToneKeys`; never
   steal a note the player must play.
3. Show the note on screen with `NoteTag`/`ToneTag`.
4. Handle the keyboard equivalent if one exists, and make sure `enabled` is false while a menu/pad/
   calibration is open.
5. Update `PRACTICE_SESSION.md` and add a test for the assignment logic if it is non-trivial.

### Add a card family or kind

1. Add to `Family`/`Kind` in `song/deck.ts`, `FAMILY_LABEL`/`KIND_LABEL`.
2. Build the card in `buildDeck` with a stable id, `family`, `kind`, `needs`, `tl`, `from`/`to`,
   `first`/`last`, `steps`/`context`, `view`, `bpm`/`goalBpm`, `pass`.
3. Teach the renderer: `LineStage`, `MelodyStage`, or `ChordStage` in `SongCoach.tsx`; add a
   `view` if none fits.
4. Update `familyOf` in `song/stats.ts`, summary grouping, tree/stats if relevant, and tests.
5. Decide whether it is shared (`scale:` id) or per-tune. Shared cards need a migration story for
   already-stored boxes.

### Add a MusicXML feature

1. Parse it in `tunes/musicxml.ts` into `LeadSheet`/`ReadingBar`; keep the parser pure.
2. Add it to `buildTimeline`/`playOrder` if it changes playback order.
3. Make `Score` draw it (VexFlow) and preserve bar-number mapping.
4. Add a fixture-based test in `song.test.ts` or a focused parser test. Keep personal scores
   outside release source and do not make the normal suite depend on ignored files. Shared
   fixtures must be original or explicitly redistributable and carry their source/license in
   [ASSETS.md](../ASSETS.md). Third-party components retain the licenses documented in
   [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

### Change session tempo/silence/scoring

1. Read `PRACTICE_SESSION.md` and the constants/comments at the top of `useSession.ts`.
2. Change the smallest state machine transition; do not add a parallel phase.
3. Add/adjust unit tests in `session.test.ts` (kin, clean takes, free play, tree) and
   `practice.test.ts` (multi-tune/session behavior).
4. Update the behavior doc. If it changes guitar gestures or the done screen, update
   `CURRENT_STATE.md` too.

### Add a metronome-based drill

Reuse, in order of preference:

1. `useSession` with scale/harmony cards (full scored session).
2. `useFreePlay` (adaptive click + band + logging).
3. `usePlayer` + `audio/samples.ts` click (simple backing).
4. `freeplay.ts` `stepLock`/`clickFor` as pure rules if you only need the tempo policy.

Do not create a new AudioContext, a new click scheduler, or a new tick-based timing system.

## Architectural debt and sharp edges

1. **Two learning systems** (see above). The largest conceptual debt. Do not expand the legacy path
   without a decision.
2. **Duplicated audio transports.** `usePlayer` (bars/loop/pattern/backing) and `usePlayback`
   (timeline/scoring) coexist. They solve different problems but overlap in click/backing. Prefer
   `usePlayback` for note-accurate work and `usePlayer` for bar/pattern work; do not add a third.
3. **Note-name/spelling duplication.** `musicTheory.ts`, `core/scales.ts`, `song/harmony.ts`,
   `song/deck.ts` (`noteName`), `tunes/chordName.ts`, `Score.tsx` (`prettyChord`), `LearnView`
   (`pretty`) all have spelling/formatting logic. Reuse the domain functions where possible; the
   presentation formatters can stay local.
4. **Large orchestration files.** `SongCoach.tsx` (~1,650 lines), `useSession.ts` (~990),
   `deck.ts` (~760). Split only along clear seams (stage components, pure helpers) and keep tests
   green; do not rewrite them wholesale.
5. **No router/URL state.** Tab and exercise state are in memory/localStorage. Deep links are not
   supported. Adding them is a product decision, not a quick refactor.
6. **No CI.** `make check` is the local gate. There is no Playwright, so browser/audio/mic behavior
   is unverified by automation.
7. **Dead/unused code.** `audio/exportMidi.ts` (no UI) and the legacy-only bits listed under
   "Cleanup candidates" in CURRENT_STATE. Either wire or remove with approval.
8. **Strict TypeScript + no Node types.** Tests that read files must either add `@types/node` and a
   tsconfig path or avoid Node APIs. Keep local conversion and parser experiments outside the
   published source and the normal test suite.

## Tests: what to add and where

Existing suites are behavior-focused. Add tests for logic that can regress, not for render
permutations.

| Area | File | Add when |
| --- | --- | --- |
| Keys/scales/patterns/landings | `core.test.ts` | Changing `core` music math. |
| Legacy path/session/progress | `tutor.test.ts` | Changing `tutor` behavior. |
| Reading generation/notation | `reading.test.ts` | Changing levels, spelling, seeds, pattern conversion. |
| MusicXML/harmony/deck/box | `song.test.ts` | Changing parsing, `buildDeck`, `applyResult`, notation. |
| Session/kin/free play/tree | `session.test.ts` | Changing tempo rules, clean takes, kinship, free-play policy, tree. |
| Multi-tune/spot/reading variation | `practice.test.ts` | Changing mixed sessions, spots, reading freshness. |
| Melody shadow | `support.test.ts` | Changing the adaptive accompaniment. |
| Calibration | `calibration.test.ts` | Changing detector fitting. |
| Tone/action keys | `tones.test.ts` | Changing note-key assignment. |
| Ear theory/session | `ear.test.ts` | Changing vocabulary, voice leading, mastery, famous songs. |
| Score rendering | `score.test.tsx` | Changing VexFlow layout/accidentals. |
| Smoke | `smoke.test.tsx` | Adding a view that should render without crashing. |

Use `make test` for the quiet summary and `npx vitest run <file>` while iterating. Run
`npm run typecheck` before handing off. If you add a file that reads fixtures, prefer a small
tracked fixture under `src/__tests__/fixtures/` over depending on the full `tunes/` library.

## Glossary

- **Card** — one exercise in the box; the unit of practice and scheduling.
- **Deck** — all cards derived from a tune plus the harmony/window/intro metadata.
- **Family** — broad exercise class: scales, harmony, melody, chords, reading.
- **Kind** — specific drill within a family (run, thirds, triads, sevenths, arps, guides, chain,
  voicings, melody, known, varied, line).
- **Box** — Leitner level 1–5; higher means longer until due.
- **Stage** — a scale card that opens after its prerequisite (`needs`) reaches box 2.
- **Kinship** — how much credit a clean pass gives a related scale exercise.
- **Shared scale** — a scale card stored under `guitar-skills` and visible to every tune.
- **Pace** — at-your-own-speed phase; the cursor waits.
- **Time** — in-time phase with band/click and pass scoring.
- **Spot** — a troublesome bar taken out of a longer card and worked on alone.
- **Shadow** — the adaptive melody that plays under the player in time.
- **Flow** — the 0–1 "how it is going" estimate that warms the room.
- **Target** — one note/chord to play in a `Timeline`; ties collapse into one target.
- **Slot** — one printed bar occurrence in playing order (a repeated bar has multiple slots).
- **LeadSheet** — parsed MusicXML: printed bars, notes, chords, key/meter, comping.
- **Timeline** — expanded playing order with slots, targets, comping, total beats.

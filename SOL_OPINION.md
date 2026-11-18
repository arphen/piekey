# Sol's opinion: the guitar app I would want to keep

**Product review and development plan · 18 November 2026**

This is an opinionated proposal, grounded in the current application and the owner's stated
preferences. It is a plan for decisions and work, not a claim that the proposed features exist.
[CURRENT_STATE](docs/CURRENT_STATE.md) remains the feature inventory;
[PRACTICE_SESSION](docs/PRACTICE_SESSION.md) defines the current session behavior.
The older [PLAN](PLAN.md) and [tutor plans](docs/tutor/README.md) contain valuable intent, but some
of their descriptions of missing features predate the implementation.

The review used source inspection and independent reviews of the engineering, audio and learning
systems. It did not include a new physical guitar test, an accessibility audit, a learner study or
market research. Hardware and learning claims below therefore have explicit validation work.
The accompanying demo/onboarding and timing work should be assessed separately from the longer
roadmap; their final status belongs in CURRENT_STATE.

> Implementation ledger: [docs/SOL_IMPLEMENTATION.md](docs/SOL_IMPLEMENTATION.md) records the
> delivered engineering slices and remaining physical, content and product acceptance work.

## Contents

1. [The recommendation](#1-the-recommendation)
2. [What is already valuable, and what is missing](#2-what-is-already-valuable-and-what-is-missing)
3. [Who we should serve first](#3-who-we-should-serve-first)
4. [The product structure and daily journeys](#4-the-product-structure-and-daily-journeys)
5. [A design language with feeling](#5-a-design-language-with-feeling)
6. [Listening, timing and trust](#6-listening-timing-and-trust)
7. [A learning system with a musical destination](#7-a-learning-system-with-a-musical-destination)
8. [The curriculum and everyday guitar tools](#8-the-curriculum-and-everyday-guitar-tools)
9. [Songs, scores and getting material in](#9-songs-scores-and-getting-material-in)
10. [Progress worth caring about](#10-progress-worth-caring-about)
11. [Ownership, mobile use and reliability](#11-ownership-mobile-use-and-reliability)
12. [Agent-ready, guitar-first](#12-agent-ready-guitar-first)
13. [Teachers, community and a sustainable project](#13-teachers-community-and-a-sustainable-project)
14. [The delivery plan](#14-the-delivery-plan)
15. [How we will know it is good](#15-how-we-will-know-it-is-good)
16. [Decisions, deferrals and the immediate backlog](#16-decisions-deferrals-and-the-immediate-backlog)

## 1. The recommendation

Build the place a guitarist opens when they sit down to play: their music, an achievable next
step, a dependable musical partner, and a record of what their playing has become.

The strongest promise is: **choose music you care about, spend a useful amount of time with your
guitar, and leave able to play something better.** The interface should make that promise visible
through the score, the sound and the next action. It does not need a slogan on every screen.

This app already has an unusually promising combination: repertoire-derived exercises, an adaptive
practice session, instrument operation, ear work, uninterrupted performances, recordings and
local ownership. Those capabilities belong together. The opportunity is to make their connection
obvious and their judgment trustworthy.

My priority order would be:

1. Make the app a reliable listener and keeper of the student's work.
2. Deliver an excellent first ten minutes with music already available.
3. Make browsing, practice and reflection feel like one carefully designed instrument.
4. Connect every required exercise to a musical goal the player chose.
5. Make improvement audible, and be precise about what the evidence establishes.
6. Make rhythm, accompaniment, memory and ear-to-guitar fluency as useful as note finding.
7. Make the phone a complete practice device, with uncomplicated occasional exchange.
8. Expand the edited repertoire and curriculum only as the quality of the experience holds up.

"Everyone's go-to app" should guide the eventual reach. The first convincing version needs a
specific student and a complete experience. A self-directed guitarist who can already make a few
notes sound, wants to learn real pieces and sometimes loses direction is an excellent starting
point. A complete school for someone who has never held a guitar is a larger instructional
commitment, with physical demonstrations and teacher review.

### What deluxe should mean

Deluxe means the app remembers the passage, hears a soft note, preserves the take, responds calmly
when the room is noisy, and makes the next visit easy. It also means beautiful notation,
comfortable typography, good sound, restrained motion and satisfying transitions. A dense feature
list does not establish any of those qualities.

The student should feel that someone has thought about the five awkward seconds before they
start, the moment they lose the phrase, the frustration of being misheard, and the decision to put
the guitar away. Those moments deserve as much design as the successful performance.

## 2. What is already valuable, and what is missing

The baseline has considerably more substance than a prototype of a fretboard viewer. Preserve
that work and develop its strongest connections.

| Area | Current foundation | Next important gap |
| --- | --- | --- |
| Practice | One SongCoach session, own-pace following, adaptive in-time passes, narrowed mode decks | A clear personal goal and an authored route through the available material |
| Session planning | 10/25/45-minute warm-up, focus, review and music blocks; mistake-based arcs | Goal relevance, a graceful finish, and a welcoming return after time away |
| Song page | Score-centered listening, phrase loops, bar-to-phrase practice launches | Flexible passage selection, arrangements and a much easier content entry path |
| Guitar operation | Played controls, low-E menu, shell navigation and ordinary button alternatives | Physical usability evidence, discoverability and recovery when the input itself fails |
| Ear | Echo cards in the shared session, plus a separate chord quiz | Rhythmic calls, hearing-to-finding transfer, and deliberate integration of the quiz's useful ideas |
| Rhythm | Timing evidence, adaptive tempo, gap practice and comping patterns | Useful onset-only practice, musical subdivisions and careful treatment of delay |
| Memory and performance | Memory cards, continuous run-throughs, weak-bar feedback, recorded takes | Delayed retrieval, varied starting points, dependable saves and comparable recordings |
| Progress | First/latest takes, skill summaries, clean tempos and tune milestones | Separation of practice history, current readiness and independently demonstrated ability |
| Data ownership | Browser persistence, full transfer files and transactional device exchange | Recovery from damaged entries, a clear backup policy and proven mobile lifecycle behavior |
| Atmosphere | Shared water/leaf textures, audio-clock pulse and slowly revealed colour | A consistent visual system, clear intensity control and physical performance/battery checks |

Relevant implementation anchors include [App](src/App.tsx), [TuneView](src/components/TuneView.tsx),
[SongCoach](src/components/SongCoach.tsx), [the planner](src/song/planner.ts),
[the profile](src/song/profile.ts), [tune milestones](src/overview/progress.ts), and
[device exchange](src/sync/exchange.ts). This table describes code-supported foundations, not
proof that the full experience has been validated with students.

### Four issues to address before stronger promises

These are concrete observations from this review, rather than speculative redesign complaints:

- [Local recording saves](src/audio/recorder.ts) can return or catch an error without reporting a
  failed save. A completed performance and a durably saved recording need separate visible states.
- [Library loading](src/tunes/library.ts) rejects the whole asynchronous load if one referenced
  score is missing. A damaged entry needs a repair state while healthy repertoire remains usable.
- [Play-along calibration](src/audio/latency.ts) estimates an effective offset that includes the
  player's consistency relative to the clicks. It does not independently isolate hardware latency.
- [Progress derivation](src/overview/progress.ts) can recognize a historical clean performance near
  the target tempo. That is useful evidence of an achievement; it does not by itself prove delayed
  recall, transfer, or current readiness.

These issues should become tracked implementation work. This document does not silently change
their behavior or rewrite the existing feature status.

## 3. Who we should serve first

| Student | What they arrive wanting | A convincing result |
| --- | --- | --- |
| Early learner | "Help me make a little music without getting lost" | A short original piece played with a supportive backing and understandable physical guidance |
| Intermediate self-directed player | "I know shapes, but my tunes keep falling apart" | A specific join, rhythm or change improves and then survives a complete take |
| Returning guitarist | "I want to enjoy playing again" | Familiar music at a comfortable level, with no wall of overdue work |
| Time-limited adult | "I have seven minutes" | A useful passage, one focused improvement and an easy finish |
| Developing improviser | "I can run scales but cannot say much" | A short intentional phrase, an answer, and an audible connection to the changes |
| Teacher's student | "I know what my teacher assigned; help me work on it" | The assigned bars, a clear goal, reliable evidence and a chosen take to bring back |

Start product research with the first three groups. Treat the others as explicit journeys to
support, rather than six separate applications.

### Support different ways of being a guitarist

The interface must work for a non-reader, a reader, someone using tab, and someone learning by
ear. Those are different starting points, not levels of seriousness. Likewise, fingerstyle,
strummed accompaniment and single-note picking need different observations from the input.

Initially state the supported instrument/setup clearly: standard six-string tuning and the
validated audio paths. Add left-handed display, capo and alternative tunings deliberately. Each
affects diagrams, written versus sounding pitch, calibration and played controls. They cannot be
delivered responsibly by changing six labels.

Someone unable or unwilling to use a microphone must still be able to browse, hear, loop, practise
with a pulse and record a self-assessed result. Assisted listening is a capability, not an entrance
fee to the app.

## 4. The product structure and daily journeys

### A simpler public structure

I would work toward three primary destinations:

| Destination | Its job | What belongs there |
| --- | --- | --- |
| **Practice** | Help me begin or continue useful playing | Current musical goal, a short session, a specific passage, Free play and focused practice shortcuts |
| **Songs** | Help me look around, listen and choose | Library, score, recordings, arrangements, selected bars and related exercises |
| **Progress** | Help me understand what has changed | Audible comparisons, musical goals, retained repertoire and inspectable evidence |

Changes, Scales, Reading and Ear remain useful focused entries into the shared session. Present
them together in Practice/Explore rather than making every exercise family compete as a primary
destination. Devices, audio setup, tuner and metronome belong in a consistent utility area.

This is a proposed information architecture, not a diagnosis of broken navigation. The existing
played navigation already works in code and has not failed in an observed guitar test during this
review. Reorganize only after testing whether people can find and start the task they intend.
Preserve ordinary buttons and played access throughout the change.

On a phone, keep the primary destinations and the current task easy to reach with a thumb.
On a laptop or music stand, optimize reading distance and keyboard/guitar use. The phone layout
should choose an appropriate arrangement of the score and controls rather than shrink the entire
desktop screen.

### First visit: hear something before asking for commitment

An empty library should feel like an invitation to music. It should never require the visitor to
understand MusicXML before discovering the app's value.

The first-use sequence I would aim for is:

1. Show a real, appealing score excerpt with an obvious Listen action and an original demo title.
2. Offer a gentler study alongside the more characterful musical demo. Keep the choice small.
3. Let the visitor hear the piece, change the pace and select a phrase without microphone permission.
4. Offer Try practice for that phrase. Explain the microphone at the moment it becomes useful.
5. Check whether the app hears one comfortable note. Present ordinary controls immediately.
6. Teach one played command through a tiny rehearsal; further commands appear when needed.
7. Let the visitor complete a short, supported phrase and hear it in context.
8. End with a clear saved result and a natural next visit. Make importing personal repertoire an
   optional next step.

Proposed research targets are first sound within two deliberate actions and first useful playing
within a few minutes on a supported setup. These are targets to measure, not performance claims.
Permission denial, no microphone and unavailable storage all need designed alternatives.

The starter experience should always be recoverable from the library, including after the user
imports their own music. Opening it again must preserve existing practice and avoid duplicate
library entries. A bundled demo should have a downloadable source score and clear provenance.

### A normal visit: reduce the cost of starting

The opening view should answer four questions through its hierarchy: what music am I working on,
what would help today, how much time do I have, and how do I begin?

Show the current tune and one useful next step. Keep the reason concise and available:
"Bars 7–8 · the join into B" is more useful than a mysterious priority score. Let the player choose
that step, a different focus or Free play. Preserve the last useful setup without assuming the
same microphone or output is still connected.

The current time-budgeted planner is a strong foundation. Add a genuinely short session only if it
can end with satisfying music. Keep existing stored choices compatible; do not replace the
10/25/45-minute scheme merely to make a new set of buttons look tidy.

### Browsing Songs with the guitar still in its case

Songs is for curiosity as well as readiness. Put the score and listening first, then optional
passages and exercises. Preserve playback position, score scale and selection when moving into
practice and returning. Avoid sending the user back to the top of a long score after every try.

Today, clicking a bar launches its generated phrase. A useful evolution is a simple selection
model: select a phrase or drag/tap a start and end, hear it, loop it, or practise it. On touch,
selection must remain deliberate and reversible. Show repeated passages as printed bars and
playing-order occurrences so the chosen range has a predictable meaning.

### A difficult day

Repeated misses should produce a comprehensible response: a shorter passage, a slower pace, a
returned visual cue or a brief replay. Change one major demand at a time. Keep the player able to
say that the app misheard, return to their own pace, choose another task or finish.

The software cannot know that someone is frustrated from an uneven phrase. It can observe
retries, silence and uncertain input. Respond to those observations without announcing an
emotional diagnosis. A quiet familiar musical ending is a good invitation; a forced easier mode
or a discouraging label can remove the player's sense of control.

### Ending well

Finish with one audible or musical fact, a saved take when available, and an obvious way to stop.
"Bars 5–8, twice through at 76" says something concrete. A result screen should allow listening,
another purposeful attempt, a different focus or leaving. It should not require a celebration,
an explanation or another exercise to make the session feel complete.

The app needs a graceful finish when a time estimate runs long. The player chooses whether to
continue; the planner should not turn a short practice into an expanding obligation.

## 5. A design language with feeling

### The visual identity

I would develop the quiet, tactile practice-room direction already suggested by the owner's water
and leaf photographs. Use a warm charcoal field, readable manuscript surfaces, muted mineral and
plant colours, fine rules and generous attention around the notes. Let the actual score, fingering
and musical structure supply much of the visual character.

The app currently has shared practice tokens alongside older global styles and feature styles.
Consolidate the visible system gradually as each screen changes: type roles, spacing, surfaces,
focus rings, icon strokes, interactive states and score colours. Do not start with a wholesale CSS
rewrite. Build a small reference page or documented component specimen only if it helps maintain
the system; it should not become another user-facing destination.

The product name also needs one deliberate decision. The repository is Piekey and the interface
currently says Fretboard Focus Lab. Choose a public identity, then use it consistently in the
header, install icon, browser title, exported files and documentation. An endless naming exercise
would be a distraction; one coherent identity is enough.

### Rules that would make it feel designed

| Element | Direction | Practical check |
| --- | --- | --- |
| Main content | Notes, diagrams and audible examples lead; explanation follows the need | Can someone recognize the current musical task without reading a paragraph? |
| Layout | Use shared surfaces, typographic hierarchy, rules and alignment | Does a container establish a useful boundary, or merely enclose another label? |
| Typography | A small set of roles for reading, musical character and measured values | Is every important value readable on a stand, in ordinary room light? |
| Icons | A consistent family for actions with stable meanings | Can a newcomer identify the action; is an accessible name always present? |
| Colour | Reserved accents for meaning, modest ambient colour for warmth | Does the interface still make sense in grayscale or with colour-vision differences? |
| Motion | Show cause and continuity; keep the score stable | Can the player read a difficult passage without competing movement? |
| Controls | Large, well-spaced targets with obvious focus and selected states | Can a phone user hit the intended action while holding a guitar? |
| Feedback | Show the affected note, beat, bar or saved item | Is a general banner replacing a more precise musical response? |

Aim for WCAG AA contrast and clear keyboard/screen-reader behavior. Use roughly 44-pixel touch
targets as a design goal where practical. Measure these; the current source review is not an
accessibility conformance claim. Add low-motion and low-stimulation choices that retain all
functional information. A bright-room/high-contrast score presentation would be valuable even if
the shell remains dark.

More icons should mean less repetitive prose and better recognition. Essential unfamiliar actions
still deserve short visible labels. Tooltips alone are a weak explanation on a phone or music
stand. Instrument gestures should be shown beside the action, with an ordinary control available.

### A responsive room, with emotional restraint

Keep two distinct kinds of visual feedback:

- **Musical time:** a clear pulse, count-in, meter and current beat driven by the audio clock.
- **Atmosphere:** a slow response to sustained active playing, with small movement from input
  energy and gradual changes of colour and texture.

The first is an instrument the player may depend on. The second should make the room feel alive.
The existing `BeatPulse` and `PracticeAtmosphere` already make this distinction; preserve it.

An atmosphere could move through still water, soft light, moving grain and a fuller palette over
the course of a session. A literal landscape, weather system or four seasons is an optional art
direction. Prototype it against the existing photographic textures before committing to an
illustration engine. The best choice is the one that leaves the music legible and feels worth
returning to after the novelty has passed.

The sharpest colours should arrive slowly during sustained, comfortable playing, as the owner
suggested. Avoid rapid flashes on note attacks, red error washes, or instant desaturation after a
miss. A difficult passage should not appear to drain life out of the room. Let intensity settle
gently, and allow the player to keep a quiet room even during excellent playing.

Do not make volume the reward signal: soft playing can be deeply engaged. Do not present the
estimator as an emotional detector. Its observations are limited to musical/input events. Keep
decoration outside scoring, avoid extra audio analysis, and measure frame time, battery use and
heat on an ordinary phone. A reduced-motion mode should retain a clear discrete beat indicator.
In gap-click exercises, a visible pulse must respect the intended silence rather than reveal the
time the exercise asks the player to maintain.

### Copy that respects a musician

Use short, concrete language about the action or observation. Keep a little warmth through rhythm,
sound and material rather than endless encouragement. Remove marketing copy from the work area.

| Need | Example of useful copy |
| --- | --- |
| Start | "Listen" · "Try phrase" · "Start practice" |
| Orientation | "Bars 5–8" · "Second chorus" · "Your pace" |
| Limited signal | "A few notes weren't clear" · "Check input" |
| Relative timing | "Steady · alignment +90 ms" |
| Evidence | "Played at 80 BPM · 18 Nov" |
| Recovery | "Recording not saved" · "Save audio file" |
| Device handoff | "Last exchange: today, 14:10" · "3 takes received" |

These are examples to test, not a mandate to display all of them. Avoid unearned "mastered,"
invented personality, exaggerated praise and vague tutoring slogans. When a beginner needs an
explanation, provide one clearly before or after playing. Quiet during performance should not
mean withholding essential teaching.

## 6. Listening, timing and trust

### The app must qualify its own hearing

Before judging an exercise, establish what the current setup can support. Acoustic guitar through
a laptop microphone, clean interface input and a phone beside loud backing tracks are different
conditions. A successful permission request does not establish a usable signal.

A brief setup check should confirm guitar audibility, ordinary soft/normal notes, room noise,
clipping and whether backing alone can produce false matches. Present a simple result: ready for
note checking, limited checking, or listen/practise without checking. The result can be task-specific:
single notes may be usable while chord checking is unreliable.

Carry observation confidence through the listening boundary where it affects judgment. Distinguish
a confidently wrong note, a note that was not heard clearly, and something the app did not measure.
Uncertain input should not quietly become a named weakness or reduce a student's long-term
standing. A played/button action for "I played that" could offer an immediate neutral retry and an
optional short local diagnostic capture. Do not make students argue with an unexplained red note.

The ordinary control path must recover from a failed microphone because a microphone gesture
cannot operate a disconnected microphone. Device-loss handling already exists; the complete
interaction still needs physical testing.

### Constant delay and pulse are separate observations

The owner's 80 BPM example is a good product requirement. At 80 BPM, beats are 750 ms apart. A
series of attacks every 750 ms can be steady even if the observed attacks consistently arrive
100 ms after the reference. A series arriving progressively later is a different case. So are
irregular attacks and missing alternate beats.

Represent at least three things separately:

1. **Pulse/steadiness:** how consistent the spacing is relative to the intended rhythmic pattern.
2. **Alignment:** the stable early/late displacement relative to this setup's reference.
3. **Confidence:** enough distinct, credible attacks and a plausible association with the targets.

For ordinary practice, allow a bounded stable alignment offset to be removed when evaluating
steadiness. Estimate it from enough attacks with a robust centre, inspect residual scatter and
drift, and keep early/late handling symmetric. Keep the original observation available. A large
offset near another beat, insufficient coverage, duplicate attacks or moving alignment should
prevent a confident fit. The software must not rescue a wrong tempo by continuously chasing it.

This adjustment should not move the backing track, shift the displayed beat or rewrite permanent
hardware calibration. The audio clock remains the reference. A later performance check may
explicitly ask for closer alignment, when the setup supports that judgment. The practice view can
say that playing was steady while showing a neutral alignment value.

Play-along calibration is useful effective compensation. Since a person's motor response is part
of the measurement, call it what it is. Store the method and setup identity if the calibration model
evolves; stronger absolute latency claims need an independently timed reference or loopback.
Bluetooth, output changes behind the system default, detector windowing and different registers
are reasons to recheck. Do not turn compensation into a confident diagnosis that the student rushes
or drags.

### Physical acceptance work

Build a small, rights-cleared set of annotated signals and then verify them with actual players.
Include clean interface input, acoustic mic, fan/speech noise, backing without guitar, soft notes,
sustain, fret noise, repeated pitches, ties, chords, hammer-ons and slides. Count false accepts and
false failures separately. A single overall "accuracy" percentage hides the failures that make a
practice session unpleasant.

For timing, compare against known event times and record the setup: input/output, sample rate,
browser, device and compensation method. Test consistent early and late offsets, a genuinely wrong
tempo, gradual drift, omitted attacks and subdivisions. Video/audio capture can reveal whether
the visible pulse is useful in relation to what leaves the speakers. Synthetic timing tests are
necessary for the math and insufficient for the experience.

### Guitar operation should become a learned physical habit

Preserve the low-E menu, on-screen note actions and actual button equivalents. Teach one stable
action at a time. Show a clear arming state, cancellation and completion. Avoid expanding the
gesture vocabulary until real players can reliably use the current one.

Validate playing with long sustains, natural harmonics, weak high strings, loud backing and notes
that resemble commands. Check upper-register reach on different guitars, short-scale instruments
and restricted mobility. Stable recovery matters more than an ingenious extra shortcut.

There is no evidence here that navigation is generally broken. There is a strong reason to test
the physical interaction as carefully as the parser. Any future footswitch or MIDI-controller
support should invoke the same actions, with a visible mapping and a complete ordinary-control
fallback.

### Make the band worth spending time with

The app already has bass, keys, drums, pluck and a shared audio-clock infrastructure. Improve
arrangement and balance before investing in a large sound library. A few excellent accompaniments
with space for the guitar are more valuable than dozens of mediocre presets.

Start with a clear bass, an audible count-in, predictable form, sensible endings, restrained
comping and an easy guide-melody level. Develop one convincing straight feel and one convincing
swing feel, with a musician checking the voicings and register. In Free play, an uncertain key or
ambiguous tempo should allow silence and an easy confirmation rather than a confident wrong band
entrance. Assess fatigue, balance and intelligibility on speakers, wired headphones and interfaces.

## 7. A learning system with a musical destination

### Put goals above the inventory of exercises

The current deck is a valuable supply of relevant practice. Add a small authored goal layer over
that supply. A player might choose to play the melody through, accompany a tune, learn a phrase by
ear, read comfortably in a position, or improvise one chorus.

Each goal needs a recognizable outcome, starting assumptions, an arrangement/version, a personal
tempo range, essential tasks and one optional extension. Completion must remain possible without
clearing every generated scale, rhythm and pattern variant. New content should not move a
student's finish line retroactively.

The planner should rank obstacles by relevance to that goal, reliability of the evidence,
recurrence and likely benefit. A person's weakest statistical axis may be irrelevant to today's
accompaniment goal. Preserve the existing warm-up/focus/review/music shape, but make the reason
for the focus inspectable and allow an alternative.

### Be precise about ability

Keep the card boxes as a scheduling mechanism. They are useful and already integrated with shared
skills and kinship. Refine the public claims around them:

| Claim | What would justify it |
| --- | --- |
| Practised | A recorded attempt with its date, task and conditions |
| Demonstrated | A relevant completed performance under stated conditions |
| Retained | A successful later retrieval without immediate rehearsal |
| Independent | The relevant visual/audio help was removed |
| Transfers | Success with an appropriate unfamiliar example, starting point, position or key |
| Performance-ready for this goal | A continuous fixed-tempo take with the intended assistance and recovery |
| Prepared by related work | Kinship/prerequisite evidence that invites a check |

The existing model preserves useful clean tempos and timing provenance. The next data increment
should describe assessment conditions: support heard, score/help visible, first exposure or
repetition, adaptive or fixed tempo, observation confidence and self-assessed versus measured
result. Store these compatibly, with validated portable fields and stable attempt identities.
Older attempts must remain valid without being retroactively assigned conditions we never knew.

A historical success should remain an honest achievement. Current readiness can invite a short
check after a long break. Do not erase the achievement or pretend that a distant best performance
fully describes today's ability. Do not label an entire guitarist with a single level derived from
accuracy on whatever material happened to be attempted.

### A complete lesson loop

For a passage with a difficult join:

1. Hear the phrase in context and understand its destination.
2. Play a baseline with enough support to understand the task.
3. Isolate the actual obstacle: rhythm, fretboard movement, a note choice or the join itself.
4. Adjust one demand, practise briefly and return to context.
5. Play the section continuously, including recovery if something goes wrong.
6. Retrieve it later with less help or from a different starting point.
7. Try a small related example that tests transfer.

The current session already covers substantial parts of this loop. The next work is to connect
them with a clear purpose and sound assessment conditions. Avoid constructing a second lesson
engine beside SongCoach.

### Expert teaching where measurement stops

Mono pitch input cannot verify posture, pressure, tension, the actual string used, muting quality,
fingering or expressive intention. The app can suggest a plausible fingering and teach with an
edited demonstration. It can invite self-listening and provide a cue. It should not claim to have
seen a hand or graded the beauty of a phrase.

Short human-authored explanations, diagrams and performed examples belong at the point of need.
They should state what to try and what to listen for. Later, selective teacher feedback can cover
judgment that automated evidence cannot. A conversational AI persona is not required to provide
any of these benefits.

## 8. The curriculum and everyday guitar tools

### Build a small, excellent first month

Commission or create a compact set of original/cleared studies with a musical identity. Each needs
an editor, a level rationale, playable fingerings, a simpler entry, an appealing model, one clear
teaching purpose and a transfer task. Start with perhaps six to twelve carefully reviewed studies;
the exact count matters less than the completeness of each learning experience.

| Strand | Useful early sequence | Musical destination |
| --- | --- | --- |
| First music | Comfortable notes, two-note motifs, pulse, a short phrase, joining phrases | A small tune played with accompaniment |
| Accompaniment | Comfortable shapes, clean changes, steady strumming, rests and anticipations | Supporting a melody without stopping |
| Reading | Pulse/rests, a small pitch set, repeated notes, new short phrases | Reading unfamiliar easy music rather than memorizing a test |
| Fretboard/harmony | Note locations, nearby chord tones, thirds/sevenths, connecting positions | Finding useful notes in the current song |
| Ear | Echo, find, remember, transpose a little, hear bass and defining tones | Learning a short phrase with the guitar by listening |
| Groove | One-note rhythm, muted-string rhythm, subdivisions, silence and re-entry | Keeping time through a phrase and a gap |
| Improvisation | Space, short motif, answer, variation, chord-tone destinations | An intentional short musical conversation |
| Repertoire | Sections, joins, memory landmarks, varied starts, continuous takes | Music that remains playable later |

Support student choice within this structure. A strumming-focused student should not be required
to become a jazz sight-reader before feeling successful. The current jazz/harmony depth is a
strength to preserve as an advanced direction.

### The next musical investment: rhythm from the current tune

Let a player take the rhythm of a troublesome bar and practise it on one note, then muted strings,
then restore its pitches. Use the exact passage so the benefit is immediately apparent. Begin with
rests, ties, repeated attacks, pickups and a few idiomatic cells.

Muted/percussive input needs an onset path that does not depend on finding a stable pitch. Validate
that path before presenting a grade. Distinguish a picked attack from a legato change. Extend gap
practice deliberately: present/absent bars, 2-and-4, sparse clicks and a confident return to form.
Assess re-entry while respecting the intended silence.

Swing should initially be a good listening and playing reference with room for musical feel.
Tempo, phrase and style affect it. A universal ratio score would make a dubious teacher.

### Ear work that reaches the hand

Develop the shared echo cards into a sequence of hearing, finding, playing and remembering. Add
rhythmic phrases, repeated notes, bass roots, defining chord tones, a nearby-key version and a
related answer. The current equal-note calls are a useful beginning; edited phrase character will
make them more musical.

Preserve the standalone quiz's useful contrast listening, confusion weighting and bass references
when integrating its capabilities. Migrate progress deliberately and avoid a third ear subsystem.
Check transfer with a new call, not only the exact familiar prompt.

### Memory and improvisation

Memory needs gradual removal of landmarks, later retrieval and starting from somewhere besides
bar one. Existing hidden-note cards are a foundation. Let help return without turning the attempt
into a moral failure; just record the conditions honestly.

Improvisation should develop intention: a three-note answer, repeated motif, space, an ending,
guide-tone destinations, then trading phrases. Describe the exercise constraint and let the
student listen to their result. Strong-beat chord-tone landing is a useful measured task and a
small part of the much larger question of whether a solo communicates.

### Utilities that earn the right to be on the home screen

An everyday guitar app should make a few ordinary jobs exceptionally convenient:

- A clear chromatic tuner, built on the shared input rather than a new microphone engine.
- A metronome with count-in, tap tempo, useful subdivisions and a trustworthy visual pulse.
- Fast phrase looping, a manageable tempo and a quick guide/backing balance.
- Free play with an easy way to capture an idea and return to it.
- A compact contextual chord/fretboard reference tied to the current music.

There is existing note display/calibration and metronome functionality; the proposal is to make
these jobs coherent, accessible tools. Avoid duplicating engines or making a student configure a
full studio to practise for five minutes. An amp simulator, DAW and huge effects collection would
be separate products with substantial support costs.

## 9. Songs, scores and getting material in

### Make the bundled repertoire an actual product

Always-available original demos solve the first barrier. They also give us known-good material
for onboarding, diagnostics and demonstrations. Keep each score's stable identity and original
source available. A person can return to the same study months later and hear the difference.

For the first set, use original compositions or explicitly cleared editions. A familiar
public-domain composition can be an excellent later addition, but establish both the composition's
status and the edition/arrangement's provenance in the relevant territories. A title being old,
or a downloadable score being free to view, is insufficient evidence. Never rebuild a private
commercial transcription into the release because its underlying tune is old.

The original Blue Hour jazz study and the simpler First Steps are a sensible opening pair. Their
different roles should be obvious through the music: an inviting miniature with character, and a
gentler quarter-note study. Include the harmony in the actual listening score so the first Listen
represents the musical promise rather than relying on the practice engine to add it later.

### Personal repertoire should feel ordinary

The library needs search, composer/title metadata, a small set of useful tags and statuses such
as Learning, Keep playable and Resting. Start with those jobs before adding an elaborate collection
system. Show arrangement, difficulty context and the last meaningful practice, rather than an
abstract completion score alone.

Import should preview the audible melody/part, a useful excerpt, range, meter and detected
limitations. Existing part/voice previews and durable identity handling are good foundations.
Let a student fix the selected voice or replace a score without losing the identity of the
repertoire and its history. Keep conflicting arrangements distinct and explain what happens to
passage references when the structure changes.

Longer-term score tools should include deliberate range selection, zoom/layout preferences,
phrase names, private annotations and arrangement-specific goals. Preserve the printed bar number,
playing-order occurrence and chosen start/end. A transposed or simplified arrangement needs an
explicit relationship to its source, and its performance evidence needs the correct context.

### Bridge the agent/import gap without becoming a score-acquisition service

Provide a copyable prompt and a short [score-creation guide](docs/CREATE_A_SCORE.md). The user
specifies a source they can provide or access, the desired melody/part, standard guitar setup and
the intended difficulty. Their chosen agent can help prepare an importable MusicXML file. The
prompt should describe the app's actual supported subset and ask for duration/pitch verification.

The prompt must allow the agent to say that it cannot read a source. It should request the needed
file or excerpt, offer an original study as an alternative, and preserve the distinction between
an approximate transcription and a verified one. PDF/image extraction needs note-by-note musical
review; a valid XML document is not proof of a correct transcription.

Keep score acquisition/conversion utilities as separate local projects. The app receives the
result through its ordinary import boundary. No automatic upload, hidden external request or
commercial-catalog scraping belongs in the practice flow.

### More formats: choose by observed demand

MusicXML supplies useful musical structure, but ordinary guitarists also arrive with chord
sheets, tab, PDFs, images, recordings and ideas they played themselves. Research which of these
blocks the target student most often.

The likely useful next step is a simple chord/form representation or an unscored score/reference
practice mode, rather than pretending arbitrary PDFs/audio can become reliable scored lessons.
MIDI can be useful for notes and timing but loses important spelling, voice and notation intent.
Guitar Pro import requires its own format/licensing and musical-compatibility work. Take one
well-defined route at a time, with an honest preview and a complete fallback.

## 10. Progress worth caring about

The strongest progress screen would let the student hear something they previously could not
play. Develop the existing recordings around that idea.

### An audible practice journal

Let the student keep a reference take, a recent take and a few intentional bookmarks. Identify the
passage, arrangement, tempo, date and assistance. Compare a short equivalent passage when useful.
Different tempos or help levels should be visible; never silently time-stretch a take and present
it as the original performance.

After listening, offer an optional reflection or next goal. A brief private note, "the B join felt
easier," can be more useful than another percentage. Make keeping, exporting and deleting takes
understandable. Automatic retention should preserve chosen keeps and explain which recent files
are rotated out. Verify that retention and two-device merging do not unexpectedly resurrect or
delete material.

### A useful progress hierarchy

1. **Music:** pieces and passages played, retained repertoire and chosen goals.
2. **Evidence:** performances and recordings, with their conditions and dates.
3. **Patterns:** useful recurring observations, with enough samples and uncertainty acknowledged.
4. **Practice activity:** active time and sessions as context.

Per-exercise tempo history can help, especially when a person reaches a plateau. Keep task,
rhythmic density and clean-performance conditions comparable. A quarter-note run at 100 BPM and
sixteenths at 100 BPM are different demands. More minutes and a higher suggested tempo do not
automatically demonstrate better playing.

Missing evidence should be presented as unknown, not a zero level. A high score on an easy exercise
does not establish an advanced guitar skill. Kinship can suggest that a related task may be ready;
reserve a claim of demonstrated performance for an actual check.

### Motivation that fits adult musicians

Use a small active repertoire and a welcoming return. Avoid streak debt, leaderboards, arbitrary
currencies, pressure to maintain a daily chain, and goals that expand whenever someone gets close.
A player should be able to take a holiday without being punished on return.

Personal milestones, appealing music, visible agency and audible change are enough to investigate
first. Measure whether they actually help people return and improve. Do not assume a pleasing
animation establishes a sustained learning benefit.

## 11. Ownership, mobile use and reliability

### Local-first should feel dependable

Local ownership is a product strength. The app should explain that the browser/device holds the
library and progress, with an obvious full backup and recovery path. Browser data can still be
evicted, denied or cleared. Request persistent storage where appropriate and show factual status
without promising permanence.

Make full `.fretpack` transfer the ordinary backup path, including recordings. Keep legacy JSON
restore compatible, with its different scope clearly identified. Today the older backup broadly
copies `guitar-*` settings while device exchange has a more careful portability boundary. Resolve
that with a versioned policy rather than unexpectedly changing the meaning of old backups.

A small data-status surface should show pending saves, a successful full export date, storage
information where available and an action when something needs attention. Distinguish a completed
run, a recording still saving, a saved take and an unavailable take. Every consequential claim
about a save should follow durable completion.

One damaged score should preserve its title/identity and offer repair or re-import, while healthy
music and history remain usable and exportable. Repair must not silently drop missing data or
relabel it as a new tune.

### Occasional device exchange is enough

Preserve the owner's chosen model: practise independently, then merge both devices when convenient.
The immutable transaction union, stable attempt identities and durable acknowledgements are a
good foundation. They prevent important classes of duplicate/lost update. They cannot remove all
semantic conflict: two arrangements, contradictory edits, schema upgrades and delete/restore intent
still require policy and clear presentation.

The exchange should communicate last successful contact, what will be shared, progress and the
durable result. Recognizable device names and an easy disconnect/forget action are useful.
One-QR pairing needs reachable signaling; STUN alone cannot carry the return invitation. Keep the
file fallback prominent when networks prevent direct exchange.

Do not make live multi-device practice or background replication a prerequisite for a polished
phone companion. Prove the simple journey: practise on laptop, exchange, leave with phone,
practise offline, return and exchange, with both histories and recordings intact.

### Installation, updates and origin changes

Choose a stable HTTPS address and verify the actual production base path, manifest and service
worker scope. A project under `/piekey/` needs matching build paths. Do not describe localhost as
a phone deployment. Moving from localhost to a hosted origin requires an explicit transfer;
browser storage does not move with the source code or DNS.

Show whether the production shell is available offline and whether a new version is waiting.
Preserve the current policy of not reloading during practice. Offer updates at a safe boundary.
Self-host or remove externally requested fonts so offline appearance and privacy are predictable;
keep their separate notices intact.

Verify phone interruption, screen lock, background suspension, incoming audio interruption,
orientation changes, reopening the installed app and older windows surviving an update. A wake
lock request already exists, but it cannot substitute for lifecycle testing. Two open windows on
one origin also need a single active practice-writer boundary or an equivalent safe policy.

### Grow efficiently without a rewrite

Measure startup, session entry, score scrolling, memory and exchange preparation on a representative
phone with a realistic accumulated library and recordings. Then optimize what actually blocks
playing: lazy summaries, cached immutable hashes, incremental work and a clear recording budget.
Choose performance budgets on a named reference device/network and publish measured results.

Journal compaction, unused-score reclamation and recording deletion need causal/version-aware
design. Simple pruning can break later merges. Extract clear policy/stage seams from large source
files when necessary for a change; avoid replacing the working engine with a speculative framework.

### Privacy is visible behavior

Scores and recordings stay local unless the user chooses an exchange or export. Explain external
signaling/STUN dependencies and avoid implying that a portable archive is encrypted just because
the WebRTC channel is encrypted. An exported full archive can contain private repertoire and audio.

Diagnostic sharing should be deliberate and previewable, with scores, raw audio and secrets
excluded by default. No remote analytics, crash payloads containing repertoire, or cloud accounts
are required to establish whether the core product works. Start with consented research sessions
and locally visible measurements.

## 12. Agent-ready, guitar-first

### An invited collaborator around the instrument

The user should be able to tell their chosen agent, "Here is my practice; help me decide what to
work on," without reconstructing weeks of activity by hand. The app should make its information
legible and portable. Its main interface should remain about playing, listening and music.

Start with a **read-only, user-initiated practice brief**. Generate it from the same saved evidence
and definitions the app uses. Let the user preview it, copy it or save a portable file. They decide
which agent receives it. No API key, model subscription, embedded chat or automatic transmission
belongs in that first step.

A static `llms.txt` capability note can help an agent understand the application, its source,
formats and limitations. It must not imply that an external agent can read a private browser
library by opening the public site. Static hosting serves application files; private practice data
requires an explicit user export or a separately designed authorized bridge.

### What an agent brief needs to say

| Information | Why it matters | Default boundary |
| --- | --- | --- |
| Format/schema version and generation time | The recipient can interpret and date the snapshot | Include; tolerate supported older versions |
| Reporting window and evidence counts | A model can distinguish one attempt from a sustained pattern | Define the window and all denominators |
| Selected music and arrangement identity | Advice stays connected to the student's actual material | Include selected metadata in preview; omit score contents |
| Demonstrated clean tempos and dates | Separate an achievement from a suggested next tempo | Preserve task context and unknown values |
| Observed pitch/timing facts | Support a useful conversation without a fabricated guitar level | Include coverage, spread/alignment distinction and limitations |
| Assistance/calibration provenance | Avoid comparing unlike attempts or diagnosing equipment effects | Explicitly unknown where it was never recorded |
| Personal goal and available time | Advice should serve the person's intention | Ask the user when absent; do not infer a goal as fact |
| Definitions and limitations | Prevent plausible but unsupported interpretations | Explain inferred fingering, detection limits and scheduling versus mastery |

Exclude score XML, raw audio, pairing secrets, hardware identifiers, browser storage dumps and the
transaction journal by default. More detailed sharing can be a later explicit selection. Imported
titles, annotations and source text are untrusted data. They must never become instructions that
override the user's request or the receiving agent's rules.

Unknown means unknown. If support visibility was not saved on older attempts, say so. If there are
no recent attempts, do not export "0% guitar skill." If timing includes setup uncertainty, do not
hand the agent a confident diagnosis of rushing. Distinguish a high-water mark from current
readiness and a repeated practice item from genuinely unseen reading evidence.

### A good first agent conversation

The user exports the brief and adds their own request: "I have 15 minutes on four days this week;
I want the melody to flow at a comfortable tempo." Their agent can summarize the evidence, ask
about anything missing, suggest one or two concrete next steps and explain why those fit the goal.
It can also help prepare a personal MusicXML file using the separate score-creation prompt.

The app should make it easy to refer back to a tune, phrase or exercise by stable identity and a
human-readable bar range. It should not claim that advice has been validated merely because a
model generated it. Recordings can support the conversation only when the user separately chooses
to share them and the receiving tool can actually listen.

### A safe progression toward richer integration

1. **Now:** documented formats, a previewable practice brief and score-creation guidance. Read-only
   sharing, no hidden connection.
2. **Next:** selective scopes for a tune, date range or chosen takes; a concise human rendering
   beside structured data; stable reference/deep-link design.
3. **Later:** a versioned proposed-practice-plan file. The app validates known tune/exercise IDs,
   ranges, tempo/time bounds and permissions, previews the consequences, and waits for the user to
   apply it. It changes a plan or goal, never fabricates performance evidence.
4. **Only with demonstrated demand:** a narrowly scoped local connector/MCP bridge with explicit
   authorization, revocation, read/write separation and a visible activity record. A browser-first
   deployment cannot secretly acquire arbitrary local filesystem or remote browser access.

Treat an incoming agent plan like any other untrusted import. Reject unsupported schemas and
unknown actions; keep rollback and stable identities; route accepted portable changes through the
same journal as ordinary UI actions. Natural-language text is not executable app configuration.
Do not let an agent rewrite past attempts, delete a library, weaken assessment rules or silently
share files through this convenience layer.

### Acceptance criteria

A user can export a useful brief without sharing their score or audio, understand exactly what is
included, and have an external agent explain the same recent facts the app shows. Empty and old
histories remain honest. Exporting changes no practice state. Future machine recommendations stay
reviewable proposals. The guitarist can ignore this entire capability and enjoy a complete app.

## 13. Teachers, community and a sustainable project

### Help a real teaching relationship

A teacher could assign a tune/version, a bar range, a performance goal, a tempo range and one
listening or physical cue. The student accepts that assignment into the existing session and
chooses what evidence to bring back. Begin with a validated portable assignment and a selective
report. Full-device exchange contains far more private material than a lesson handoff needs.

The teacher supplies interpretation, physical correction and musical judgment; the app supports
repetition, listening and an accurate record. A teacher dashboard, class roster and messaging
service are later business decisions, with authentication, privacy and support costs.

### A community built around useful material

An open project can invite contributions of original studies, cleared editions, fingerings,
translations, sound improvements and reproducible bug reports. Establish a small content review
rubric: musical value, level, technical correctness, provenance, accessible explanation and a
complete first-use experience.

Keep personal imported repertoire out of public contribution paths. A shared assignment should
not silently republish its score. A public score marketplace or social feed would require rights
handling, moderation and abuse processes; it would consume attention before the core experience
has earned a durable audience.

### Fund the care the product requires

AGPL source and user ownership fit this project's identity. Maintain the source offer, notices and
asset provenance as part of releasing. Sustainable options to investigate include donations,
patron support, paid editorial content with appropriate licensing, lessons, or optional managed
services. Decide with actual operating costs and the owner's ambitions in mind.

Keep practice, recovery and export usable without an account. Do not make the reliability of
someone's progress depend on an upsell. Signaling/TURN, storage services, editorial work, platform
maintenance and human support all have costs; a business model should name the service it funds.

### How people find and recommend it

The most persuasive public introduction is a short sequence of actual use: hear the bundled
piece, select two bars, play, receive a useful response, then hear a later improvement. A live
demo without sign-up should tell that story before a list of features.

After supported-device validation, invite a small group of guitar students and a few teachers.
Give them a complete original study and observe repeat use over several weeks. Fix what interrupts
their music. Expand through teacher recommendations and shareable rights-cleared study links when
the experience reliably earns them. Avoid paid acquisition before the first session and return
visit both work well.

## 14. The delivery plan

### Work in complete, reviewable slices

Limit concurrent product bets. A slice should include its musical content, interaction,
persistence, recovery and validation. Keep the existing engine and evolve its boundaries only
when the slice requires it.

The sizes below are relative planning bands: S is a contained change, M spans a feature boundary,
L requires substantial design/content or platform validation. They are not calendar estimates.
The amount of physical research and the number of people doing the work will determine timing.

| Stage | Deliverable | Size | Completion gate |
| --- | --- | --- | --- |
| **A · Trust the instrument** | Supported setup pilot; visible recording outcomes; damaged-score recovery; stable-phase timing policy | M/L | Real students can finish, recover input and retain their result; timing claims match measured capability |
| **B · A beautiful first visit** | Two dependable originals, first Listen, phrase practice, gentle setup, persistent demo shelf and source prompt | M | A new visitor hears and tries music without finding a score or studying an instruction page |
| **C · One complete musical goal** | Personal tune/arrangement goal, relevant plan, graceful finish, a recorded baseline and later check | L | Someone can state the goal, finish the route and hear an improvement that survives another day |
| **D · Daily guitar depth** | Rhythm isolation, stronger ear calls, memory fading, tuner/metronome access, a few excellent band arrangements | L | Each tool solves a real passage-level problem and returns the player to music |
| **E · A dependable companion** | Proven phone/offline/update lifecycle, clear full backup, safe active-window ownership and occasional exchange | M/L | Laptop → phone → offline practice → laptop preserves complete portable state on declared platforms |
| **F · A growing practice relationship** | Richer curated repertoire, comparable takes, returning-player flow, selective agent/teacher handoffs | L | People keep useful repertoire and return voluntarily over several weeks |

Some engineering in E is a prerequisite for a public mobile claim and should happen earlier when
that claim is needed. A/B can overlap in design, but a beautiful onboarding cannot compensate for
losing the first take. Expand content only when the first authored path is convincingly useful.

### The next six working cycles I would choose

**Cycle 1 — Establish the baseline.** Run the supported guitar/setup pilot, inventory the strongest
failure modes and record a representative end-to-end session. Agree what the product can safely
claim today. Open concrete issues for silent recording loss, damaged-score recovery and ambiguous
calibration language. Deploy the actual production origin before phone claims.

**Cycle 2 — Finish the first study.** Edit and play-test Blue Hour and First Steps, including their
backing, fingerings, first phrase, preview and download. Watch a new person try them. Remove every
avoidable question between arrival and the first useful attempt. Verify denied-mic and no-mic use.

**Cycle 3 — Design the common shell.** Prototype the Practice/Songs/Progress hierarchy with real
scores and data. Consolidate visible tokens, icon roles and control states around those journeys.
Test on a phone and at stand distance. Do not replace the existing navigation until task finding
improves.

**Cycle 4 — Connect a personal goal.** Add a narrow goal contract and assessment conditions. Build
one authored route over existing cards. Make its reason, time budget and ending understandable.
Test a normal visit, a difficult day and a return after a gap.

**Cycle 5 — Make progress convincing.** Complete reliable take handling and a useful comparison.
Add one rhythm-isolation lesson and one delayed retrieval/transfer check. Verify that evidence
supports the claims. Improve the practice brief using a real conversation with a user-chosen agent.

**Cycle 6 — Prove companionship.** Exercise mobile interruption/offline/update and two-device
exchange with realistic data. Test recovery and export from a fresh browser. Decide the next
content investment from observed student use rather than the most interesting technical demo.

These cycles describe outcomes rather than sprint deadlines. Revisit their order when a pilot
exposes a more consequential obstacle.

### Implementation packets and boundaries

| Packet | Likely existing seams | Data implications |
| --- | --- | --- |
| Listening confidence | `listen`, `pitchDetection`, `tunes/scoring`, `useSession` | Compatible observation/assessment provenance; avoid inventing confidence for old attempts |
| Timing alignment | `audio/latency`, `tunes/scoring`, `song/freeplay`, `song/profile` | Retain raw observations; separate temporary phase fit from hardware settings |
| Goals and plan | `song/planner`, `deck`, `leitner`, `overview` | Versioned goal/arrangement references and validated portable changes |
| Score selection | `TuneView`, `Score`, `tunes/order`, phrase cards | Stable printed/playing-order references and explicit arrangement versions |
| Recording/recovery | `audio/recorder`, `storage`, `tunes/library`, `sync/exchange` | Durable outcomes, retention/delete policy and repair without lost identity |
| Product shell/design | `App`, `OverviewView`, mode views and scoped styles | Keep feature state in hooks; preserve real controls and played access |
| Agent/teacher bridge | Pure report builders plus explicit export/import UI | Versioned bounded formats, preview, no raw-state or secret export |
| Platform readiness | `pwa`, Vite shell generation, Devices and audio setup | Stable origin/scope, safe update boundary, device-local settings remain local |

Do not expand `core/contract.ts` casually, create another audio context, duplicate music theory or
fork the practice state machine. A new exercise belongs in the existing deck/session. Add a pure
helper when it clarifies a policy; avoid a general extension framework before real extensions
need one.

## 15. How we will know it is good

### A lean validation strategy

Keep the automated tests focused on behavior that can damage musical judgment or saved work:
timing/drift, distinct attacks, parser duration/pitch, goal/assessment semantics, identity,
transaction merge, backup compatibility and failure recovery. Extend existing suites. Skip tests
that merely repeat copy, CSS classes, trivial getters or every visual permutation.

Run the smallest relevant suite while editing and the repository's `make check` gate once at
handoff. Use real musical fixtures with provenance. Automated coverage is not a substitute for a
guitarist listening to the backing, a student using the controls or a phone being interrupted.

### The physical journeys that should gate release claims

| Journey | What to observe |
| --- | --- |
| New visitor, no score | First sound, first useful phrase, understandable next action, no required terminology |
| No/denied microphone | Browsing/listening/looping remains useful; recovery is obvious; no fabricated scores |
| Quiet and noisy guitar input | False accepts/failures, soft-note handling, backing leakage and confidence behavior |
| Stable early/late playing | Steadiness remains useful; alignment is visible; no continuous chasing of a wrong tempo |
| Repeats, ties and silence | Distinct attacks are required appropriately; rests and gap form remain meaningful |
| Full guitar-operated session | Learnability, accidental commands, escape/recovery, comfortable physical reach |
| Disconnect/reconnect | No reload requirement, no lost place, correct route and appropriate timing recheck |
| Full/denied storage and damaged XML | Honest save/repair states; healthy data remains exportable; no false saved take |
| Laptop/phone round trip | Independent work merges once, recordings survive, hardware settings stay local |
| Installed phone interruption/update | Correct pause/resume, offline start, readable layout and no surprise reload |
| Return after a week away | A manageable musical invitation, retained achievements and no overdue wall |
| Agent brief handoff | Useful accurate interpretation, explicit unknowns, no private content leaked by default |

For each supported setup, keep a short result record and the limits discovered. Add more browsers
and instruments when there is capacity to support them. Do not extrapolate from one successful
laptop microphone session to every acoustic guitar and phone.

### Product measures that are worth collecting

Use research and consented/local measurements first. Define denominators and separate direct
observation from self-report.

- **Getting started:** share of visitors who hear a demo, try a useful phrase and understand the
  next action; where they stop and why.
- **Trust:** visible save failures, unrecovered input failures, false judgments and successful
  recovery. Any confirmed silent loss is a release-level incident to understand.
- **Musical benefit:** later retrieval, a complete take at the chosen conditions, successful
  transfer and a student/teacher hearing an improvement in comparable recordings.
- **Return:** whether students voluntarily practise again over several weeks and what they value
  on return. Session length and consecutive days are context rather than an end in themselves.
- **Clarity:** whether someone can explain today's task, the displayed result and the meaning of
  an unknown/limited measurement.
- **Companionship:** successful offline use, full restore and occasional device exchange with
  real accumulated history.

Initial pilot targets should be agreed after a baseline. Avoid publishing impressive-sounding
accuracy, retention or learning gains without a study that supports them. Qualitative evidence
from a handful of observed students is useful for design and cannot establish population-wide
educational effectiveness.

### A review rubric for each feature

Before adding a feature, answer: which student and musical job does it serve; what can the app
actually observe; how does the person recover; what persists and travels; what is the smallest
useful implementation; and how will we hear or see that it helped?

After building it, repeat the entire journey with real music. If it adds decisions without
improving playing, simplify or remove it. A deluxe product earns its complexity through use.

## 16. Decisions, deferrals and the immediate backlog

### Decisions I would make now

1. Keep one practice/learning system and the guitar as its primary physical controller.
2. Make original, rights-cleared music available throughout the product, including first use.
3. Make a chosen musical goal the organizing layer above the exercise supply.
4. Treat signal uncertainty, stable delay and actual musical error as different observations.
5. Preserve raw evidence and historical achievement; qualify claims about readiness and transfer.
6. Keep the reactive room, with restrained intensity, clear functional feedback and full access
   through low-motion/ordinary controls.
7. Keep occasional two-way exchange and a complete user-owned export as core capabilities.
8. Make agents invited recipients of well-described information and reviewable proposals.
9. Keep score acquisition outside the application and private repertoire outside release history.
10. Develop the first authored path with learners before expanding the catalogue or infrastructure.

### Work I would explicitly defer

Accounts as a requirement; mandatory cloud sync; social feeds and leaderboards; a general chat
tutor inside the practice room; confident hand/technique or aesthetic grading from mono audio;
a native rewrite; an amp/effects workstation; an open plugin ecosystem; a giant curriculum graph;
automatic transcription of any arbitrary source; always-on multi-device replication; and a public
score marketplace.

Any of these could become a separate justified decision. None is a prerequisite for delivering
the core promise. Prefer a narrow hypothesis, a learner and a concrete acceptance gate before
reopening one.

### The next actionable issues

| Priority | Issue | Done when |
| --- | --- | --- |
| P0 | Real-guitar/setup validation | A declared supported matrix has recorded judgments, limits and recovery outcomes |
| P0 | Recording save visibility | No completed take is presented as saved before durable success; failure has an export/retry path |
| P0 | Partial-library recovery | A missing score remains identifiable and repairable without blocking healthy practice/export |
| P0 | Timing honesty | Stable delay, irregularity and drift have separate behavior; absolute diagnoses match calibration evidence |
| P1 | First-use musical path | A new person can listen and try an original without a file, account or mandatory mic |
| P1 | Goal and assessment context | A selected musical outcome changes the plan and its evidence records the relevant conditions |
| P1 | Installed/mobile reliability | Actual HTTPS origin, offline/update/interruption and active-window behavior are verified |
| P1 | Clear full-state recovery | Full export/restore/exchange has consistent portability and legacy compatibility policies |
| P1 | Agent-ready practice brief | User previews accurate bounded evidence; unknowns stay explicit and private content stays excluded |
| P2 | Rhythm and memory depth | One current-tune rhythm lesson and a later retrieval/transfer task improve an actual passage |
| P2 | Unified visual/product shell | Observed task finding and score readability improve on laptop and phone |
| P2 | Edited curriculum and sound | Every added study has a complete reviewed musical and learning experience |

Track these as implementation issues without treating this opinion document as evidence that
they are finished. Update the authoritative status docs when behavior is implemented and verified.

The product question I would keep returning to is simple: **after a few weeks, can this person
independently play music they care about, recover when it goes wrong, and hear the difference?**
That should decide what deserves the next week of work.

# Sol implementation ledger

Updated 2026-11-18. This records delivery against [SOL_OPINION.md](../SOL_OPINION.md),
not a declaration that its research, curriculum and platform acceptance gates are complete.
The existing React, shared audio/input, deck, full-screen coach and transaction journal remain
the application’s foundation.

## Delivered slices

| Plan area | Implemented behavior | Evidence boundary |
| --- | --- | --- |
| Trust the result | Visible recording outcomes; retry/download of pending audio; read errors distinguished from an empty library | Failure-path tests; no real quota or microphone recording test |
| Keep music recoverable | Healthy scores remain available beside named repair issues; replacement preserves identity; explicit removal preserves history | Storage tests, including missing XML and migration races |
| First musical visit | Listen without a file or mic; existing original demos remain playable when saving fails; no-mic practice in the same coach | Mounted score/entry tests and browser Listen/self-guided entry; audible balance and student usability unverified |
| Score-centered Songs | Select a generated phrase from a bar, see printed/playing-order positions, use immediately visible sticky listen/loop/practice controls, return to the browse position | Mounted selection/play/launch tests; browser review at 320/390/1440px with Blue Hour; long-score/physical-phone checks remain |
| A personal destination | Immutable arrangement-bound melody/accompaniment/echo/reading/improvisation goals; personal tempos; goal-aware plan and Next | Goal/planner/projection tests; authored teaching quality still needs review |
| Honest assessment | Optional support/notation/tempo/exposure/confidence/interruption context, arrangement fingerprint, actual stable assessed-pass BPM | Focused session/scheduler tests; confidence remains unknown |
| A difficult day | Self-guided activity without scoring; no automatic review/kinship/accuracy/speed credit; graceful finish at a musical boundary | Mounted ready/session tests; guitar gesture comfort unverified |
| Rhythm from real music | One-note rendering of the selected phrase, then a return to that phrase in context | Deterministic deck/rhythm tests; not muted-string grading |
| Stronger echo calls | Seeded duration variation, rests and repeated pitches in higher tiers; response remains own pace | Musical invariant tests; call pacing needs a real guitar |
| Everyday tools | Chromatic 440 Hz tuner, tap tempo, count-in, subdivisions and a centered output-clock beat pulse | Signal/tap/scheduler tests; browser count-in/pulse/subdivision/stop; physical tuning accuracy and sound unverified |
| Useful Progress | Goals, historical task records, bounded cross-tune observations and retained audio comparison with context | Data projection and recording persistence tests; subjective comparison UX unverified |
| One active writer | Origin-scoped Web Lock before practice/quiz/tools/Devices; explicit handoff waits for cleanup and save recovery; JSON restore uses idle lock | Controlled competing-window/lifecycle tests; real installed/browser suspension unverified |
| Consistent portability | Goals and assessment metadata journal/transfer; independent first goals union; hardware/calibration stay local in new and legacy backups | Merge, archive and restore tests; real laptop/phone exchange unverified |
| Offline presentation | Observable preparation/ready/error/update status; safe update boundary; local OFL font assets | State tests and production build; offline installation/update cycle unverified |
| Agent-ready evidence | Explicit previewable brief adds selected goal and bounded conditions; self activity separated; private XML/audio/settings excluded | Existing bounded-report test; no inbound agent control or LLM service |

## What a goal means

A goal fixes an interpreted score version, an outcome, a personal start/target tempo and at most
twelve essential tasks. Optional generated variants cannot keep enlarging its denominator.
Changing the music or source part pauses an incompatible goal while preserving its history.
Changing the title or display fingering does not create a new musical arrangement.

Progress counts actual measured clean attempts since goal creation with the matching arrangement
fingerprint. A timed task needs real timing observations at its target using the tempo of the
complete stable assessed pass. Adaptive practice can be app-checked goal evidence; it is not an
independent performance claim. Echoes prove successful own-pace responses: their BPM is the call’s
reference tempo. Self-guided activity and related-exercise scheduling credit prove neither.

Older attempts/takes keep unknown assistance, confidence or arrangement context. Historical task
records remain visible with that limitation; lifetime best settings are not upgraded into proof
of the current arrangement. The bounded display history can eventually age out detailed goal
evidence even though original transactions remain in the journal. There is no journal-wide
assessment query yet. Retained recordings use native audio controls; played-guitar recording
transport actions remain a gap.

Goals union by immutable ID on exchange, including independent first saves. Only active selection
uses deterministic transaction order. Reusing an unchanged goal preserves its creation date and
evidence. The local UI allows twelve saved goals per tune; portable validation allows 256 to
retain independent device histories, across at most 128 tune buckets. Conflicting content under
one ID or excess bounds fails visibly without silently discarding goals. Goals can be deactivated;
there is no goal-deletion interface.

## Recovery and device behavior

Recording completion is separate from durable storage. Pending audio stays in this page’s memory
until retry succeeds or the user saves the audio/full transfer file. Closing the page can still
lose a Blob that the browser refused to persist. Paired exchange retries pending audio before
advertising durable-known IDs; it never acknowledges a remote save before writes complete.
Full file export can rescue pending audio.

Partial score recovery does not pretend to export the full missing library. Healthy tunes can be
browsed and practised, while full backup/exchange requires named missing scores to be repaired
or explicitly removed. Score replacement keeps the tune ID and prior history; arrangement-aware
goal evidence remains separate. The bundled original is available as a labelled preview if the
browser cannot save it, without overwriting an edited saved demo.

Protected writer surfaces require browser Web Locks. Browsing remains available without them.
Handoff requests use BroadcastChannel or storage events, while the atomic lock determines
ownership. If pending writes cannot save, the original window retains ownership and exposes
recovery. The lock is per browser origin; separate browser profiles/devices still exchange
transactions manually. It is not a cross-device lock or continuous sync.

Input/output choices, detector calibration, measured latency and pairing secrets stay local.
This applies to new JSON practice backups and full transfers. Older JSON backups remain accepted,
but their hardware fields do not overwrite the receiving setup. JSON excludes audio; `.fretpack`
includes retained and recoverable audio. Explicit successful JSON restore remains a reset
generation rather than ordinary practice events.

## Still to do

1. **Run the instrument pilot.** Complete [SUPPORTED_SETUPS.md](SUPPORTED_SETUPS.md) with actual
   guitar/interface/phone judgments. Qualify signal reliability before claiming usable detector
   confidence, and tune latency, chords, echo pacing, recovery and autoplay on hardware.
2. **Host and prove the phone journey.** Deploy a trusted HTTPS origin, then verify laptop → phone
   → offline practice → laptop, remembered pairing, restrictive networks/TURN, install, updates,
   interruption and storage recovery. No deployment is claimed by these source changes.
3. **Edit the first month.** Play-test both existing originals and author a small reviewed set of
   lessons/arrangements with excellent sound, fingerings, retrieval/transfer checks and teaching
   notes. Generated cards alone do not supply an edited curriculum.
4. **Observe the design.** Check readability, task finding, played gestures and stand distance with
   students on laptop and phone. The three-surface hierarchy is implemented but its usability
   advantage has not been measured. Arbitrary drag-to-select score ranges remain unimplemented.
5. **Deepen evidence carefully.** Long-term per-exercise views, comparable uninterrupted checks,
   useful retention/transfer evidence and a bounded journal-based goal query remain. Do not infer
   an overall guitar level from detector percentages or a review box.
6. **Improve musical depth from observations.** Memory fading, expressive rhythm, richer comping,
   more convincing band arrangements, bends/slides/vibrato and string attribution require musical
   or signal experiments. Current one-note rhythm and echo work do not claim to solve them.
7. **Use the agent bridge with a real conversation.** Review whether the exported bounded report
   helps a learner and their chosen agent choose a next step. Teacher handoffs, reviewed plan
   import, richer APIs, community material and funding are subsequent product work.

## Validation policy

Focused existing suites cover consequential changes and failure paths. New suites are confined
to recording durability, assessment trust, platform ownership, musical tools and mounted score
browsing. There are no new copy snapshots, render permutations, lint packages or CI frameworks.
The handoff gate is `make check`, followed by `npm run build:quiet`. The exact current results and
browser/hardware limits live in [CURRENT_STATE.md](CURRENT_STATE.md).

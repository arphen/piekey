# Agent Notes — Fretboard Focus Lab

## What this is

A local-first guitar practice app built with React/TypeScript and Vite. It combines a fretboard
visualizer with a practice suite: guided tune practice, chord-changes drills, generated
sight-reading with mic note checking, MusicXML tune import/playback/coaching, scale-shape drills,
and ear training. Practice is local; preferences and progress live in `localStorage`, while large
scores, recordings and the sync journal use IndexedDB. Optional manual device exchange uses PeerJS
signaling and encrypted WebRTC; there is no app-data backend.

Read `PLAN.md` for the product intent and musical constraints. It is the original roadmap; much of
it is now implemented, so verify features against the code rather than assuming a phase is missing.

There is one learning system: **Tunes** (`src/tunes/*`, `src/song/*`, full-screen `SongCoach`) with
arbitrary MusicXML, mic-scored sessions and guitar-driven gestures. The tutor shell (`src/overview/*`,
`OverviewView`) is the entrypoint; Changes, Scales and Reading are the same session on a narrowed
deck (`FocusView`, `FOCUS_FAMILIES`). The old Practice tab (`src/tutor/*`), Fretboard Lab and the
standalone sight-reading tab were removed. Song is a score-centered browser/listener and launches
exact phrases in `SongCoach`; do not restore an inline Learn flow. Ear (`src/ear/*`) is still its own engine.

## Stack

- React 18.3 + ReactDOM 18.3, Vite 5.4, TypeScript 5.6 (strict; `noUnusedLocals`, `noUnusedParameters`).
- Tone.js 15.1 for the transport, synths and backing band; `@tonejs/midi` for MIDI export; VexFlow 4.2 for notation.
- Vitest 2.1 + jsdom; tests live under `src/__tests__/`. No linter or formatter is configured.
- Node 18+ (Vite 5 requirement). No Node version file is committed.
- npm is the only package manager; the lockfile is `package-lock.json`.

## Critical entry points

1. `src/main.tsx` — mounts React and loads global styles.
2. `src/App.tsx` — thin shell: three primary tabs (Practice, Songs, Progress), with Changes, Scales, Reading, Ear and Triads under Explore, the one shared mic input, and `GuitarNav`. It also holds the key for the Scales shape explorer. Feature state belongs in the feature's hook, not here.
3. `src/core/contract.ts` — the typed boundary between logic (`core`, `audio`) and UI (`App`, `components`). Change only by agreement, then update every consumer.
4. `src/core/index.ts` — public music-domain API (`getKey`, `getTune`, `buildPattern`, `fretboardNotes`, ...).
5. `src/audio/usePlayer.ts` — transport/playback API (`play`, `stop`, `setLoop`, `setPattern`, mix). `src/audio/backing.ts` generates the band.
6. `src/overview/summary.ts` + `src/components/FocusView.tsx` — tutor overview data and the mode screens that start a focused session.
7. `src/nav/useGuitarNav.ts` — played navigation for the whole shell (notes E5–A5, DOM-driven cursor). The Reading mode itself runs on `src/song/reading.ts` cards; `src/reading/generate.ts` is legacy, kept only as a `Score` test fixture.
8. `src/components/Fretboard.tsx` — the shared fretboard renderer used across views.
9. `src/tunes/musicxml.ts` — MusicXML/archive import, the entry point for loaded tunes.
10. `src/sync/` — immutable transaction journal, deterministic projection, full recording/file
    exchange and encrypted foreground transport. `DeviceSync`/`DeviceSyncPanel` own its shell UI.
11. `src/song/goals.ts` — immutable arrangement-bound musical goals; `useGoals` subscribes to
    portable changes. Self-guided history is activity, never measured progress.
12. `src/platform/` — exclusive writer ownership across browser windows, offline/update status.
    Mount the boundary before any practice/quiz/tools writer hook. `src/tools/` reuses input/playback.
13. `src/agent/brief.ts` — pure, versioned, bounded practice-brief projection for explicit user
    export. Keep score/audio contents, device secrets and raw storage/journal data out of it.
14. `src/song/practiceHistory.ts` / `usePracticeHistory.ts` and `goalEvidence.ts` — display-only,
    bounded journal exercise history and goal checks. Replay a complete tune transaction group
    with the existing projector; capped, unavailable or conflicted history is unknown. Shared
    scale history is outside the tune query. Never replace stores or scheduling with an archive query.
15. `src/tunes/passage.ts` — explicit playing-order passage bounds, occurrence labels and stable
    arrangement-qualified IDs. Custom passages join the existing deck only for an explicit launch.
16. `src/song/theme.ts` / `useThemePicker.ts` — explicitly armed opening matching; candidates
    never navigate or change a tune before separate review and confirmation.
17. `src/tools/GuitarTools.tsx` — shared `GuitarToolsRoom` inside the existing practice boundary.
    Suspend the host engine while instruments own the input. `PracticeAtmosphere` owns decorative
    output-clock resonance; optional `RenderedWater` is capped GPU presentation, never a clock.
18. `src/pool/` — optional living pool: one `PoolRoom` per practice room, rooms publish through
    `usePoolPublisher`, the engine loads lazily (`host.ts`, `engine/*`). Decoration only: it pulses
    only on a heard `BeatSignal`, never on a beat inferred from notes, earns intensity only from
    pitched playing during the player's turn, and nothing reads pool state back into practice.

## Repository map and project docs (read this second)

Read `docs/CURRENT_STATE.md` for verified feature status and known gaps, then
`docs/ARCHITECTURE.md` for layers, data flow and extension recipes. `docs/BACKLOG.md` is the
triage of the root `todo` (`T1`–`T22`); check an item's status there before starting work on it.
`docs/PRACTICE_SESSION.md` is authoritative for the guitar-driven session behavior.

Read `docs/REPO_MAP.md` before searching code. It is a bounded path/symbol index, not source
bodies: grouped by top-level directory, with exported symbol names and line hints.

- Regenerate after adding, removing, renaming, or moving modules: `make map-update`.
- Verify freshness: `make map-check` (exits 1 when stale).
- Never hand-edit `docs/REPO_MAP.md`; change `scripts/generate-repo-map.mjs` instead.
- The map indexes git-tracked plus untracked non-ignored files, so in-progress modules appear
  without staging. It omits dependency/build/cache output, lockfiles, tests' bodies, and secrets.

STARTUP PROTOCOL: do not run recursive listings (`ls -R`, `find .`) to discover the codebase. Read
this file and `docs/REPO_MAP.md`, then locate code by exact symbol with `rg`/grep, scoped to the
relevant directory. Treat map line numbers as hints and verify the source.

## Commands

Run from the repository root. Prefer quiet forms and redirect long output.

| Task | Command |
| --- | --- |
| Install | `make install` (npm install) |
| Dev server | `make run` (port 5173; stops a stale listener first) |
| Build | `npm run build` or `make build`; quiet: `npm run build:quiet` |
| Typecheck | `npm run typecheck` (or `make typecheck`) |
| Fast loop | `make quick` (typecheck only) |
| One test file | `make test-file FILE=src/__tests__/song.test.ts` |
| Related tests | `make test-related FILE=src/song/deck.ts` |
| Tests | `make test` (quiet summary; full log on failure); `npm test` for the full Vitest reporter |
| Preview | `make preview` (port 4173) |
| Repo map | `make map-update` / `make map-check` |
| Full gate | `make check` (typecheck + map freshness + tests) |

`npm run build` runs `tsc` then Vite; `npm run typecheck` is the fast feedback loop. Unit and
component tests run under jsdom. No CI configuration is committed; `make check` is the local gate.

## Working loop

- While editing: run `make quick` plus the smallest test that covers the change
  (`make test-file FILE=...` or `make test-related FILE=...`).
- Do not run `make test` or `make check` after every edit. They are handoff gates, not a watch loop.
- Do not add lint, format, CI or other cleanup tooling unless the task is specifically about
  tooling. Prefer the smallest mechanical check that covers the change.
- Before handoff: run `make check` once. If it fails, read the bounded tail instead of rerunning
  the whole command repeatedly.

## Architecture rules

- Keep `src/core/` pure: no React, DOM, browser APIs, or audio. It is the shared music domain and is
  consumed by UI, audio, tutor, reading and song modules.
- Put stateful/browser behavior in hooks (`use*.ts`), presentational UI in `src/components/`, and
  reusable logic in plain modules. Views should not duplicate music theory that belongs in `core`.
- `src/musicTheory.ts` is the low-level pitch/interval/query toolkit; `src/core/` builds the
  tune/position/pattern model on top of it. Reuse both; do not fork note-name or spelling logic.
- Audio: one shared AudioContext/transport. `play()` must be called from a user gesture. New sounds
  go through `src/audio/`; views should use `usePlayer`/`useInput` rather than creating contexts.
- Generated exercises are reproducible: `reading/generate.ts` is seeded, `core/demos.ts` is
  deterministic by construction. Do not introduce unseeded randomness; tests depend on it.
- Wrap `localStorage` reads/writes in try/catch. Tutor progress is per key; keep the existing
  storage keys stable so upgrades do not erase practice history.
- Practice and library persistence uses `src/storage.ts` for visible failures and pending writes;
  use its read-through helpers so remounts retain unsaved progress. Await `loadLibraryAsync()`
  before editing the library; parse persisted entries with `parseTuneEntry()` to preserve identity.
  Large score XML lives in IndexedDB. Keep backup/restore compatible with existing tune IDs.
- Sync is an occasional two-way union of immutable transactions, not whole-store replacement or
  live replication. Preserve `device:seq` IDs, causal context, stable attempt/session IDs and
  recording IDs. Keep conflicting score versions and report ambiguous legacy history. Goals union by immutable
  ID even on independent first writes; only active selection follows deterministic transaction order.
  Backup restore records an explicit reset only after success; rollback writes must not become
  practice events. Keep whole asynchronous restores inside `withLibraryOperation` so Devices
  cannot open midway through a restore after its screen unmounts.
- New portable state must go through the journal and its validated projection; keep device input,
  output, calibration, latency and pairing secrets local. Full `.fretpack` files include recordings;
  the older JSON practice backup still excludes them. Never acknowledge a remote save before
  recording and journal/projection writes complete. Keep the write-ahead outbox retry-safe.
- Pair only while Devices is open, outside a practice session. One-QR pairing needs reachable
  signaling; STUN alone is not a return signaling channel. Keep custom signaling/TURN configurable,
  invitation secrets in URL fragments, and app data encrypted. Phone mic/install requires trusted
  HTTPS; never describe a laptop's localhost address as a usable phone URL or claim deployment.
  `App` owns dialog visibility and unmounts the active feature while it is open, so listening/ear
  hooks stop and the feature remounts persisted projections on close. Preserve that idle boundary.
- Assessment conditions and arrangement fingerprints are optional on legacy attempts/takes. Keep
  unknowns explicit; self-guided activity never promotes boxes, kinship, profile or clean tempo.
  Timed claims use the actual stable assessed-pass BPM, never the final UI tempo.
  Memory help aggregates the whole visit; restoring the page cannot produce hidden-only evidence.
  Later hidden reviews require the same known arrangement and never imply independent retention.
- Tutor can launch a daily session or a selected card directly, and its Free play tile opens
  the existing free-play engine without a tune. Do not add another practice or audio engine.
- Bundled demos use stable IDs from `src/tunes/demos.ts`; preserve the existing First Steps ID
  and never overwrite a saved demo when reopening it. New distributed scores need provenance in
  `ASSETS.md`. Agent briefs are explicit read-only exports with versioned definitions and unknowns;
  never send them to an LLM automatically or execute agent-authored plans without a new boundary.
  Brief scope/period apply before aggregation and to dated tempo records. Explicitly project nested
  conditions and goal fields; validated persisted objects may still contain extra private fields.
- The practice session (`src/song/`, `SongCoach`) is operated from the guitar and reacts to the
  player rather than instructing them; read `docs/PRACTICE_SESSION.md` before changing its
  gestures, tempo rules or card box. Any new action there needs a played gesture, shown on screen.
  Whole-tune cards (`step.kind === "tune"` as well as `run`) and improvisation reserve notes for
  music. Command allocation reserves every octave of chord tones, improvisation choices and
  non-exact melody notes. The menu summon is D♯5 hold/release/hold; menu rows are first frets.
  Never put a command on an open-string pitch. Tune changes retain the outer practice boundary and never exit fullscreen.
  Modal suspension blocks scoring, playback and automatic wake/reconnect until the modal closes;
  resume only a pause owned by that modal. Renderer preferences are device-local
  (`guitar-room-render`, `guitar-pool-tier`); with nothing chosen the room is Living on power
  (water on battery or a weak GPU); the pool uses the shared input and `pitchOf` cache,
  never its own detector, and `[data-pool]` marks rocks, calm lenses and glass on room elements.
- Outside sessions the shell is played too (`src/nav/`, notes from fret 12 up): keep controls real
  `button`/`select` elements so the cursor reaches them, and mark decoration `data-nav-skip`.
- TypeScript is strict. Avoid `any`; prefer the contract types. Keep `npm run typecheck` green.
- CSS lives in `src/styles.css` and per-feature `*.css` files; keep class names scoped by feature.

## Boundaries

NEVER search, index, or hand-edit these directories (names apply at any depth):

- Dependencies/VCS: `.git/`, `node_modules/`, `vendor/`.
- Build/test output: `dist/`, `coverage/`, `test-results/`, `playwright-report/`, `logs/`.
- Local state/secrets: `.claude/`, `.vscode/`, `.idea/`, `.env*`, `*.local`.

Do not hand-edit `docs/REPO_MAP.md` or `package-lock.json` (update the latter only through npm).
Do not delete or rewrite `tunes/*.musicxml` fixtures or repository tooling without checking who
uses them. Keep score acquisition/conversion tools in separate local projects, outside the published
repository. Preserve unrelated working-tree changes: this repository may contain substantial
in-progress work. Never run `git reset --hard`, `git checkout -- .`, `git clean`, or `git stash`
without explicit permission, and never commit changes you did not author.

Personal score files stay outside the published repository or in ignored `tunes/` files. Imported
library XML is persistent browser data (`localStorage`/IndexedDB), separate from source files;
do not describe it as transient session storage. Shared score fixtures must be original or
explicitly redistributable, with provenance.

## Licensing and publication

- Project-owned code, docs, original studies and visual assets use `AGPL-3.0-only`; see `LICENSE`
  and `ASSETS.md`. The water/leaf textures derive from the project owner's original photographs.
- Dependencies and third-party fonts keep their own licenses and notices. Maintain
  `THIRD_PARTY_NOTICES.md` when changing distributed third-party material.
- Do not add personal full-score transcriptions to release source. Importing or converting a
  score does not grant redistribution rights or put it under the app's AGPL license.
- Publish only release history cleared for redistribution. Preserve private development history;
  do not rewrite or publish it without explicit authorization.

## Working agreements

- Do not overtest. Add focused tests for behavior that can regress (music logic, timing, stateful
  hooks, parsers); skip trivial accessors, pure presentation, and one-off render permutations.
  Check existing coverage first; avoid duplicate happy paths, copy checks and internal call counts.
  Reuse the existing suites, run the targeted test file while iterating, and run the full suite
  once before handing off.
- Before handing off: run `make check` (quiet typecheck + map freshness + tests); regenerate the map
  if files moved.
- Keep runs concise: use `build:quiet` and `make test` (summary only, bounded failure tail);
  redirect long logs and read the tail. Use `git status --short` / `git diff --stat` instead of
  dumping whole diffs.
- Commit finished work in small, reviewable commits that say what changed and why. Do not mix
  unrelated changes. Ask before committing when the tree contains work you did not author. When a
  change adds, removes, renames, or moves files, regenerate the map and commit
  `docs/REPO_MAP.md` with the code change.
- When adding a feature module, export its public API from the folder's `index.ts` where one exists
  (`audio`, `reading`, `tutor`), and add focused tests under `src/__tests__/`.
- Update `README.md` and this file when the view list, commands, or architecture rules change.
- Update `docs/CURRENT_STATE.md` when a feature's verified status changes, `docs/ARCHITECTURE.md`
  when a layer, model or data flow changes, and `docs/BACKLOG.md` when a `T*` item is completed,
  split or re-scoped. Keep these three docs consistent with the code; stale status docs are worse
  than none.

## User communication

- Acknowledge new user messages immediately, before continuing long-running work.
- Report exact commands and results. If something is unverified (audio output, mic input, browser
  UI), say so instead of implying it was tested.

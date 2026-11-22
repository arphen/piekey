# Fretboard Focus Lab

A local-first guitar practice app built with React, TypeScript and Vite. It pairs a fretboard
visualizer with a practice suite for scales, arpeggios, chords and real tunes.

Source repository: [arphen/piekey](https://github.com/arphen/piekey).

## Views

- **Practice** — the home screen: current score, a short Next list, musical goals and Explore
  shortcuts. Start the daily session, a selected exercise, or Free play without importing music.
  An empty library offers **Listen** and **Try practice** for two original studies.
- **Songs** — browse and hear MusicXML with the score at the center. Select a phrase or choose
  exact start/end bars, listen once or loop them, then practise that passage in the full-screen
  coach. Start/end choices name each repeated-bar occurrence and its playing-order position.
  Returning preserves the browsing position.
  Library/import/backup tools are disclosed separately.
- **Progress** — musical goals, historical task records, observed practice patterns and recordings.
  Compare any two retained takes with tempo, task, score-version and assistance context.
  Exercise history reads the captured tune journal beyond the recent-attempt limit, with dated
  clean-tempo observations and inspectable attempts. Versions and help remain separate; shared
  scale history is outside this tune-specific view, and unavailable evidence stays unknown.

**Changes, Scales, Reading, Ear and Triads** remain accessible through Practice’s Explore shortcuts.
**Triads** is a by-heart drill: "ii of C major" and four written triads to choose from (tap, keys
1–4, the guitar's cursor, or strum the triad), filed in a card box, keys opening from C outward round
the circle of fifths, then the same the other way round, minor keys and inversions as each is
learned; well-known triads are played from memory at the guitar; it works on a phone without it.
Its home is a circle of fifths: choose a key (say E minor, for a band in E minor) to see its seven
triads unfold and drill that key in every layer.
Changes/Scales/Reading narrow the same `SongCoach` session; Ear includes tune-based echo cards and
its existing chord quiz. Scales also has a shape explorer. The chromatic A440 tuner and metronome
open inside the guitar room, pause its current exercise and return to it. Both are reachable from
the guitar menu as well as the visible instrument controls. The metronome has tap tempo,
beats-per-bar selection, count-in and subdivisions; its weighted sweep and resonances follow
the heard output clock. The **room** can stay a still photograph (default), become a capped GPU
**water** surface, or become a **living** pool — the algae photograph on a fluid simulation that
ripples with each note heard and slowly glows over minutes of steady playing (optionally only
while the laptop is plugged in). All modes stop when the page is hidden.
The shell's **Tools** button opens the same instruments; Devices remains outside practice.

The full-screen coach is played from the guitar, with ordinary buttons alongside its gestures.
It also offers **Practise without scoring** when the microphone is unavailable or unwanted.
Self-guided activity stays in history and never earns measured accuracy, review-box or clean-tempo
credit. **Finish after this pass** offers a musical ending; see
[docs/PRACTICE_SESSION.md](docs/PRACTICE_SESSION.md).
Ordinary musical notes cannot choose another tune. **Choose tune** stays in the practice room;
optionally enable **Listen to opening**, play at least six notes of an opening in its original
key, review matches and confirm the choice. Ambiguous matches remain choices. The guitar menu
uses a deliberate D♯5 (high e, fret 11) hold, release and second hold, so one sustained note cannot open it.

Practice runs locally, with preferences/progress stored in the browser and large scores/recordings
in IndexedDB. Optional device pairing uses a signaling service to establish an encrypted connection.
Score imports are parsed and saved in the browser, without uploading them to the static host.
The library persists across browser restarts; clearing the site's browser data removes it.
Imported scores are browser data, separate from this source repository and its production build.
The app includes two original studies: **Blue Hour**, a 12-bar C jazz blues with accompaniment,
and **First Steps**, an eight-bar C major melody over soft chords. They remain available from Song's Library,
including after importing personal tunes. Listen, open the score, start practice, or download
their MusicXML. Study notes offer a melody fingering, a listening cue, a simpler entry and a
creative variation. Reopening preserves saved versions and progress; updated bundled arrangements
do not overwrite an older library copy.
Users can also import their own MusicXML repertoire. **Create a score with your agent** provides
a copyable prompt for an original study or a source they specify; see
[the score-creation guide](docs/CREATE_A_SCORE.md). The app does not send sources to an agent.
Score acquisition/conversion utilities are maintained as separate local projects.
Song includes an import preview with part/voice selection and explicit score replacement. Use
**Devices → Save file** for a `.fretpack` containing tunes, practice history, settings and recordings.
Importing a transfer merges its immutable transactions; repeated imports do not count practice twice.
Song's older JSON practice backup remains available under Library tools and excludes recordings.
Save failures remain visible. Unsaved progress can be retried or exported; failed recording saves
stay in memory with Retry and Save audio actions. Keep the page open until they are rescued.

## With your own agent

In **Songs → Library → Library tools → Practice brief**, choose one tune or all saved music and
7, 28 or 90 days. Prepare a readable summary, inspect its JSON, then copy it for your chosen agent
or download the report. The bounded report includes
practice counts, observed notes/timing and dated clean task tempos within that period, with definitions and
explicit unknowns. It excludes score XML, audio, hardware/calibration settings, pairing secrets and
the transaction journal. It includes the selected goal and bounded assessment-condition counts;
older assistance and detector confidence remain explicitly unknown. Nothing is automatically sent to an LLM; generating a brief changes no
practice state. A public `llms.txt` describes the capabilities and boundaries for external agents.

The app remains guitar-first. The brief supports a conversation about goals and next steps;
there is no agent control API or automatic plan execution.

Memory practice gradually removes the page, then brings due sections back hidden on a later day.
The page can always be restored with its button or the guitar menu; recorded help stays explicit.
Progress recordings have Play/Pause, Restart and seek buttons reachable by the played cursor.
Use headphones when controlling recording playback from the guitar.

## Devices and full transfers

Open **Devices** on both screens. Pair device shows one QR code; scan it on the other device and
choose **Connect & sync**. After a successful exchange the devices remember each other, and the
next exchange starts with **Sync** while both Devices panels are open. Pairing links expire after
ten minutes. Pasting a pairing link and carrying a `.fretpack` file are alternatives to scanning.

Sync is manual and runs in the foreground, outside an active practice session. Devices waits for
pending library saves/restores; opening it suspends the current screen's listening/ear engine,
and closing it remounts saved state. Practice, the Ear quiz, Tools, Devices and JSON restore share
an exclusive browser Web Lock; moving practice to another window waits for pending saves.
Browsers without Web Locks retain browsing but cannot start these protected operations. It exchanges missing transactions and recordings in
both directions, then confirms durable saves. Concurrent score edits are preserved as separate
library copies; differences in history created before transaction recording are reported for review.
Microphone/output choices, detector calibration, latency and pairing keys stay with each device.

The default rendezvous is PeerJS's public service with Cloudflare STUN. These establish the
connection; app data travels over the encrypted WebRTC channel. Restrictive networks may need TURN.
Custom signaling and STUN/TURN are configured at build time with `VITE_SYNC_SIGNALING_HOST`,
`VITE_SYNC_SIGNALING_PORT`, `VITE_SYNC_SIGNALING_PATH`, `VITE_SYNC_SIGNALING_SECURE`,
`VITE_SYNC_SIGNALING_KEY`, and `VITE_WEBRTC_ICE_SERVERS` (a JSON array of standard `RTCIceServer`
objects with `urls` and optional `username`/`credential`). These are public build settings.

## Deploy to GitHub Pages

The repository includes `.github/workflows/pages.yml`. On every push to `main` it runs
`make check`, builds with the repository's Pages base path, and deploys `dist/` through GitHub
Actions. The project site is served at `https://<owner>.github.io/piekey/` unless a custom domain
is configured; a custom domain gets the root base path automatically.

One-time setup in the GitHub repository:

1. Open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
2. Push to `main`, or run **Deploy to GitHub Pages** from the Actions tab.

GitHub Pages serves the site over HTTPS, so microphone, install and offline-shell flows have the
origin they require. Local practice data is scoped to the origin: a deployment on a new hostname
starts with an empty library. Export a `.fretpack` from the old origin and import it there to
carry existing practice across.

For other static hosts, serve `dist/` at the site root. If the app lives in a subdirectory, build
with `BASE_PATH=/subdirectory/`; `vite.config.ts` passes it to Vite, and the generated manifest,
license links, service worker and asset URLs follow that base path.

## Phone and offline use

The GitHub Pages workflow above can provide a trusted HTTPS production origin. A laptop's
`localhost` URL still cannot open the app on a phone, and entering an address in Devices does not
deploy anything. The phone needs the production build served from a reachable, trusted HTTPS
address for its microphone and install/offline features. The Devices panel can remember that app
address.

Run `npm run build:quiet`, then serve the generated `dist/` contents at the root of a static HTTPS
site. Open that address on the phone, then use the browser's install/Add to Home Screen action.
After a successful production load and service-worker installation, the cached app opens offline;
paired transfers still need connectivity for rendezvous. Updates wait until the old app windows
close. A visible status distinguishes offline preparation, readiness, failure and an update
waiting for windows to close. Fonts are bundled for offline use. The development server does
not register the offline shell.

Full transfer files work between local browser instances without public hosting. Real phone pairing,
microphone use and installed-app behavior still need physical-device verification. The explicit
[setup and acceptance matrix](docs/SUPPORTED_SETUPS.md) records those checks as not run.

## Run locally

```bash
make install
make run
```

Then open the local Vite URL (default: http://localhost:5173).

Node 18+ is required (Vite 5). `make run` stops a stale listener on port 5173 before starting.

## Other commands

```bash
make build       # typecheck and production build
make quick       # typecheck only, for the edit loop
make test-file   # one test file: make test-file FILE=src/__tests__/song.test.ts
make test        # quiet Vitest summary (full log on failure)
make typecheck   # fast TypeScript feedback
make preview     # serve the production build on port 4173
make check       # handoff gate: typecheck + repo-map freshness + tests
```

## Documentation

- [docs/SOL_IMPLEMENTATION.md](docs/SOL_IMPLEMENTATION.md) — delivered implementation slices,
  evidence limits and remaining product work.
- [SOL_OPINION.md](SOL_OPINION.md) — comprehensive product critique, design direction, learning
  strategy, agent bridge, staged delivery plan and acceptance gates. Proposals are distinct from
  implemented features.
- [docs/CREATE_A_SCORE.md](docs/CREATE_A_SCORE.md) — using your chosen agent to prepare a personal
  MusicXML score, with import and musical verification guidance.
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) — verified snapshot of what is implemented,
  partially implemented and unfinished, plus storage keys, health status and cleanup candidates.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, tune/session models, data flow,
  transaction sync, session state machine, and extension recipes.
- [docs/BACKLOG.md](docs/BACKLOG.md) — triage of the root `todo` (`T1`–`T22`), what remains for each
  item, and a prioritized next-ten list.
- [AGENTS.md](AGENTS.md) — contributor/agent workflow, architecture rules and boundaries.
- [docs/REPO_MAP.md](docs/REPO_MAP.md) — generated path/symbol index. Refresh with
  `make map-update` after moving files; verify with `make map-check`.
- [docs/PRACTICE_SESSION.md](docs/PRACTICE_SESSION.md) — how the practice session reacts to the
  player: guitar gestures, tempo rules, the card box and its curriculum, free play.
- [PLAN.md](PLAN.md) — product intent, musical source material and phased roadmap.

## License

Project-owned code, documentation, original music and visual assets are licensed under the
[GNU Affero General Public License version 3 only](LICENSE) (`AGPL-3.0-only`). The water and leaf textures
derive from the project owner's original photographs. See [ASSETS.md](ASSETS.md) for provenance.
Modified versions offered over a network must offer their users the Corresponding Source under
the AGPL's terms.

Dependencies and third-party fonts retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Importing a score does not change its copyright
or license. Personal repertoire is not bundled with the source or app build.

Production builds include the license and notices under `licenses/`; the app footer links to
those files and the source revision used for the build.

# Fretboard Focus Lab

A local-first guitar practice app built with React, TypeScript and Vite. It pairs a fretboard
visualizer with a practice suite for scales, arpeggios, chords and real tunes.

Source repository: [arphen/piekey](https://github.com/arphen/piekey).

## Views

- **Tutor** — the default entrypoint. Shows the current song, a mixed three-exercise queue, the
  practice modes, and the next three units for every song in the library. Songs are read from the
  same deck/box data as the full-screen session. Start today's practice directly or open a specific
  exercise. **Try a starter tune** adds the original eight-bar First Steps study.
- **Changes** — the current tune's own chord and harmony cards, run as a focused full-screen session.
- **Reading** — the tune's reading cards (fresh notes from its range each day) as a focused full-screen session.
- **Song** (the Tunes tab) — a score-centered page for browsing MusicXML, listening to the melody
  and backing, and starting practice. Click a printed bar or a phrase row to open that exact phrase
  in the full-screen coach; the main practice action starts the daily session. There is no inline
  Learn view.
  The full-screen practice session is run from the guitar: played notes are its buttons, it follows
  the player's tempo and mistakes, and between sessions it shows what moved (see
  [docs/PRACTICE_SESSION.md](docs/PRACTICE_SESSION.md)). Free play with an adaptive metronome is
  one note away.
- **Scales** — the tune's scale cards as a focused session, plus the harmonic-minor shape explorer.
- **Ear** — echo cards (hear a phrase from your tune's own scale, play it back; the page helps in the first tiers) plus the original chord quiz.
- **Free play** — open its tile on Tutor for the adaptive metronome without importing a tune.

Practice runs locally, with preferences/progress stored in the browser and large scores/recordings
in IndexedDB. Optional device pairing uses a signaling service to establish an encrypted connection.
Score imports are parsed and saved in the browser, without uploading them to the static host.
The library persists across browser restarts; clearing the site's browser data removes it.
Imported scores are browser data, separate from this source repository and its production build.
The app includes the original First Steps study; users import their own MusicXML repertoire.
Score acquisition/conversion utilities are maintained as separate local projects.
Song includes an import preview with part/voice selection and explicit score replacement. Use
**Devices → Save file** for a `.fretpack` containing tunes, practice history, settings and recordings.
Importing a transfer merges its immutable transactions; repeated imports do not count practice twice.
Song's older JSON practice backup remains available under Library tools and excludes recordings.
Save failures remain visible and unsaved practice writes can be retried or exported.

## Devices and full transfers

Open **Devices** on both screens. Pair device shows one QR code; scan it on the other device and
choose **Connect & sync**. After a successful exchange the devices remember each other, and the
next exchange starts with **Sync** while both Devices panels are open. Pairing links expire after
ten minutes. Pasting a pairing link and carrying a `.fretpack` file are alternatives to scanning.

Sync is manual and runs in the foreground, outside an active practice session. Devices waits for
pending library saves/restores; opening it suspends the current screen's listening/ear engine,
and closing it remounts saved state. It exchanges missing transactions and recordings in
both directions, then confirms durable saves. Concurrent score edits are preserved as separate
library copies; differences in history created before transaction recording are reported for review.
Microphone/output choices, detector calibration, latency and pairing keys stay with each device.

The default rendezvous is PeerJS's public service with Cloudflare STUN. These establish the
connection; app data travels over the encrypted WebRTC channel. Restrictive networks may need TURN.
Custom signaling and STUN/TURN are configured at build time with `VITE_SYNC_SIGNALING_HOST`,
`VITE_SYNC_SIGNALING_PORT`, `VITE_SYNC_SIGNALING_PATH`, `VITE_SYNC_SIGNALING_SECURE`,
`VITE_SYNC_SIGNALING_KEY`, and `VITE_WEBRTC_ICE_SERVERS` (a JSON array of standard `RTCIceServer`
objects with `urls` and optional `username`/`credential`). These are public build settings.

## Phone and offline use

This source repository does not provision hosting. A laptop's `localhost` URL cannot open the app
on a phone. The phone needs the production build served from a reachable, trusted HTTPS address
for its microphone and install/offline features. The Devices panel can remember that app address;
entering an address does not deploy the app.

Run `npm run build:quiet`, then serve the generated `dist/` contents at the root of a static HTTPS
site. Open that address on the phone, then use the browser's install/Add to Home Screen action.
After a successful production load and service-worker installation, the cached app opens offline;
paired transfers still need connectivity for rendezvous. Updates wait until the old app windows
close. The development server does not register the offline shell.

Full transfer files work between local browser instances without public hosting. Real phone pairing,
microphone use and installed-app behavior still need physical-device verification.

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

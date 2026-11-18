# Supported setups and physical acceptance

Status date: **2026-11-18**. The capabilities below are implemented in code; they are not a
certification of a browser, interface, microphone or phone. **Every physical check in this document
is NOT RUN.** No real guitar, audible output, microphone route, phone installation or laptop–phone
exchange was exercised for this change. Earlier bounded browser layout reviews do not verify audio
or device behavior.

“Code present” means the implementation exists and can be inspected, with focused automated tests
where indicated. Tests using generated samples, mocked browser APIs or jsdom do not establish how a
physical setup behaves. A setup becomes physically verified only after recording its exact hardware,
software and outcomes against the checklist below.

## Capability requirements

- Measured practice needs Web Audio, an allowed audio input, IndexedDB/localStorage and Web Locks.
  Without Web Locks the app keeps practice closed and permits browsing; closing other windows does
  not remove that capability requirement.
- Self-guided practice uses the same session without mic scoring. It records activity without box
  advancement, measured note accuracy or inferred timing confidence. It still needs the practice
  window capability and audio support for playback.
- Desktop localhost can be a trusted development context. A phone needs its own reachable, trusted
  **HTTPS** production origin. A laptop's localhost address is not a phone URL. No phone deployment
  is supplied or verified by this document.
- Explicit output selection is capability detected through `AudioContext.setSinkId`; other browsers
  use system output. Interface names, permission lifetime and available capture formats vary.
- Offline availability requires an initially successful production service-worker installation and
  its cached assets. The Vite development server is not an offline/PWA acceptance environment.
- Paired device exchange needs reachable signaling and a successful WebRTC route. STUN is not a
  signaling channel; some networks need configured TURN. A `.fretpack` file is a separate manual
  exchange route and does not establish that pairing works.

## Setup matrix

Browser families identify candidates to check, not tested version guarantees. Record the actual
version and capabilities; run browser and installed-app variants separately.

| Candidate setup | Code-present path / limitation | Physical outcome |
| --- | --- | --- |
| Laptop, wired guitar interface, wired headphones; Chrome/Edge | Shared input, pitch/chord checking, calibration, run recording; explicit output selection only when available | **NOT RUN** |
| Laptop, acoustic guitar and built-in/USB mic, wired headphones | Shared mic detector and noise/tuning setup; soft attacks, room sound and harmonics need acceptance | **NOT RUN** |
| Laptop, guitar mic and loudspeaker backing | Capture and backing can run together; reliable rejection of backing leakage is not established | **NOT RUN** |
| Desktop Safari/Firefox with a working audio route | Same capability gates; system output fallback when output selection is absent | **NOT RUN** |
| Android phone, Chrome browser and installed app | Trusted HTTPS, permissions, Web Locks, capture and installed/offline lifecycle must each be checked | **NOT RUN** |
| iPhone/iPad, Safari and Add to Home Screen | Trusted HTTPS and capability gates; interruption, capture format, download and resume policies need separate checks | **NOT RUN** |
| Bluetooth input/output or mixed wired/Bluetooth routes | Route-specific compensation exists; transport delay, jitter and system routing are not guaranteed | **NOT RUN** |
| Browser without Web Locks | Browsing remains available; practice is deliberately blocked | **NOT RUN** |
| Laptop and phone on home Wi-Fi, then separate networks | Encrypted foreground union exchange, configurable signaling/TURN and full transfer files | **NOT RUN** |

## Physical acceptance checklist

Use an original or redistributable study with rests, soft repeated notes, ties, a short phrase, a
full run and chord changes. Keep an independent written expectation for the played notes. Begin
with a wired headphone route so loudspeaker leakage is tested separately. Each row is independent:
a pass on one route, browser or device does not pass the others.

| Check | Procedure and acceptance evidence to record | Outcome |
| --- | --- | --- |
| First visit / no input permission | Open practice with no saved mic permission. Browsing and self-guided entry must remain reachable without a mandatory mic prompt. Start self-guided practice; confirm no note percentage, timing verdict, box credit or measured-confidence claim is created. | **NOT RUN** |
| Denied mic | Explicitly enable listening and deny permission. Record the actual error and recovery controls. Continue without scoring; complete an exercise and verify activity is retained without measured credit. Then allow permission and start a new measured session. | **NOT RUN** |
| Correct input and tuning | Select the physical route, play every open string and fretted notes across the used range, then a low/high octave pair. Record sample rate, detected names, noise floor, calibration and any octave errors. Repeat soft and normal attacks. | **NOT RUN** |
| Repeated / tied notes | Play quiet repeated notes with distinct picks, then sustain one note over repeated printed attacks, then over a printed tie. Fresh attacks must be distinct from a sustained note; a tied chain must not require an extra pick. Record misses and false accepts, not just the final percentage. | **NOT RUN** |
| Chord attacks | Play the requested voicing, an incomplete voicing and a clashing note. Test repeated comping strikes while holding the same shape. A ringing chord must not supply every later required strike. Record actual accepted/missed events. | **NOT RUN** |
| Backing leakage | With the guitar silent, run click, support melody and full backing through headphones, then speakers at recorded levels and distances. Record any scored note or played navigation action caused by playback. A silent player must not earn a successful pass from the app's own sound. Speaker reliability remains unaccepted until this passes. | **NOT RUN** |
| Timing: steady offset | Play evenly with a deliberate small early or late alignment, then near the reference. Inspect raw alignment separately from scatter. Within the scoring bounds, constant offset alone must not be called uneven playing or earn an extra tempo increase. Do not describe play-along compensation as an isolated hardware-latency measurement. | **NOT RUN** |
| Timing: scatter and drift | Play alternating early/late notes, then gradually accelerate or decelerate, then omit attacks. These must remain distinct from an evenly shifted pass and must not earn the same steady-pass progression. Record tempo, attack spacing and observed strip/tempo behavior. | **NOT RUN** |
| Route change | Change input, output and sample rate where the platform permits. Record which calibration/compensation is reused or invalidated. Reconnect a prior route and confirm its own saved setup returns without attributing another route's lag to it. | **NOT RUN** |
| Input reconnect | Unplug the input mid-phrase, then reconnect; also switch the input off/on in the browser. Practice must pause instead of scoring silence, avoid duplicate engines/attempts, and resume only with a usable route. Confirm the fallback to self-guided practice hides old timing/accuracy marks. | **NOT RUN** |
| Guitar controls / finish | Exercise shown note keys, hold low E to open the menu, then release/change it before selecting a row. Confirm the summoning note does not also select an action. Request finish after a pass; the next completed musical pass should lead to recap. Buttons/keyboard must remain usable when no mic is available. | **NOT RUN** |
| Recording capture | Finish a run and wait for its actual save state. Leave and reopen the app, play back the take and inspect its beginning/end and format. Confirm an unavailable/empty capture is reported separately from the practice result; no unavailable recording may be called saved. | **NOT RUN** |
| Recording save failure / rescue | In a disposable browser profile, use browser storage controls to reproduce a failed write. Keep the page open. Verify unsaved status, retry and individual audio download; listen to the downloaded file. Retry several old pending takes and confirm each survives. Check `.fretpack` rescue when durable inventory is readable; JSON practice backup must not be presented as an audio backup. | **NOT RUN** |
| Two practice windows | Open browser and installed windows sharing one origin/profile. Move practice while a completed recording is saving; the old engine must stop before the new one starts, and failed writes must remain visible/recoverable rather than silently acknowledged. Retry after leaving the old screen; verify ownership can recover without simultaneous playback. | **NOT RUN** |
| Phone interruption | On each phone/browser/app variant, interrupt a phrase by switching apps, locking the screen and an incoming call/audio interruption. Record permission, AudioContext and capture behavior. Returning must not add silent successes, run duplicate audio or lose the recovery UI; perform any required explicit resume gesture. | **NOT RUN** |
| Production offline launch | After the production shell reports ready, close/reopen offline and visit Tutor, Song, focused modes, Ear and an imported local score. Check lazy-loaded assets, notation, fonts, progress and recordings. Record missing resources and storage errors. An uncached first visit is not an offline pass. | **NOT RUN** |
| Update lifecycle | With a second production build available, check for updates while practice is active in another window, then when every practice window is idle. No active session may reload or switch assets. Close every old app window, reopen and verify the new build with library/progress/audio intact. Repeat a failed/offline update check. | **NOT RUN** |
| Full laptop–phone file exchange | On two devices with the app already reachable, export/import `.fretpack` with scores, goals, attempts and recordings. Verify IDs, score versions, audio playback and assessment/arrangement provenance; repeat import and confirm no duplicate practice. Device routing, calibration and pairing secrets must remain local. Repeat a failed save and confirm completion is not reported early. | **NOT RUN** |
| Full laptop–phone paired exchange | Pair only from Devices while both engines are idle. Exchange divergent local progress plus full score/audio content, then repeat in the opposite direction and again unchanged. Verify union, conflicts, stable IDs and playable audio on both devices. Repeat on separate networks with the actual signaling/TURN configuration; interrupt and retry before a remote save completes. No sync success may precede durable recording/journal/projection writes. | **NOT RUN** |
| Phone presentation / downloads | At actual phone size, reach setup, rescue and transfer actions without hidden controls. Exercise both played and tapped audio-download actions; record any browser activation/download restriction and whether the explicit tap works. Confirm the downloaded file exists and plays. | **NOT RUN** |

## Recording a result

For each run record the date, app revision/build, production origin, device/OS, browser version,
browser versus installed mode, input/interface, output/headphones, wired/Bluetooth route, sample
rate, permission state and relevant calibration. For exchange include both devices, network types,
signaling/TURN configuration and file-versus-paired transport. Keep pairing secrets out of the report.

Replace **NOT RUN** only with a dated **PASS**, **FAIL** or **BLOCKED**, the exact steps and evidence,
and any remaining limitation. A layout screenshot cannot verify audible output; a saved label
cannot verify a playable file; a synthetic scoring test cannot verify a soft guitar attack. Report
partial passes per row and setup rather than generalizing them into full physical support.

Relevant source boundaries: [input](../src/listen/useInput.ts), [session](../src/song/useSession.ts),
[recordings](../src/audio/recorder.ts), [window ownership](../src/platform/practiceWindow.ts),
[offline shell](../src/pwa.ts) and [exchange](../src/sync/exchange.ts).

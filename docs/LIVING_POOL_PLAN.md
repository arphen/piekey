# Living Pool: implementation plan

An optional rendering mode that makes the practice room come alive. The algae photograph floats on
real fluid, drifts and swirls, ripples under every note heard on the microphone, and over minutes
of connected playing starts to dance and glow like a lava lamp. The metronome, tuner, score and
menus become part of the pool instead of sitting on top of it. The full mode runs while the laptop
is plugged in. Phones and battery power keep today's lighter rooms.

This plan is for the implementing agent. It is self-contained, but read these first:
`AGENTS.md`, `docs/PRACTICE_SESSION.md` (sections "The practice room" and "Visible beat"), and the
atmosphere paragraph in `docs/ARCHITECTURE.md` (search for `PracticeAtmosphere`).

---

## 0. Working rules for this task

- **The working tree has substantial uncommitted work you did not write.** That includes several
  files this plan touches: `PracticeAtmosphere.tsx`, `GuitarTools.tsx`, `SongCoach.tsx`,
  `FreePlay.tsx`, `atmosphere.css`, the docs and `docs/REPO_MAP.md`. Edit them surgically and never
  revert hunks you did not write. Ask the user before committing any file that already had
  someone else's uncommitted changes. Never run `git stash`, `reset`, `checkout -- .` or `clean`.
- **Measure before and after.** The user has called out guessed performance fixes. Record
  baseline numbers for the current Still and Water rooms before you write renderer code (§11).
- Work in the phases in §13. Each phase should end runnable, typechecked and committed (with
  permission) as one small commit.
- Use only raw WebGL2, as `RenderedWater.tsx` does. Do not add three.js, regl, twgl or other
  rendering dependencies. Write original shaders from the published algorithms (Stam, "Stable
  Fluids", 1999; GPU Gems chapter 38). Do not paste third-party shader code. If anything is
  adapted, record it in `THIRD_PARTY_NOTICES.md`.
- Validation stays light: `make quick` plus the smallest relevant test while iterating, and
  `make check` once before handoff.

---

## 1. What it should feel like

The user's own words, condensed:

- The background photo is "disgustingly green algae that are paradoxically almost unnaturally
  green." The whole constellation floats on water and drifts slowly across the screen, whirling
  and twirling. Use real fluid physics.
- Notes heard on the microphone make ripples.
- When the music connects and settles into a mood, the pool slowly dances more and more and
  becomes more glowing and intense. The target is a lava-lamp vibe with a physics simulation that
  reacts to the playing.
- Every part is natively integrated: the metronome, the tuner and everything else. Oozy, slowly
  shifting vibes, chaotic patterns, "some fibonacci stuff."
- It can be switched off for phones. The full version runs only while the laptop is plugged in.

**The arc over one session** (tune the constants toward this):

| Time / state | What the pool does |
| --- | --- |
| Room open, nothing played | The photo is muted, as today. It drifts slowly with a faint current, like a pond at dusk. |
| First notes | Each note drops a stone. Rings spread and refract the algae. Nothing else changes yet. |
| ~30 s of continuous playing | Currents organise. One or two slow eddies form, and the algae start to marble around the score. |
| 1–2 min, steady and in one key | The pool dances: eddies orbit on a golden spiral, onsets kick them, the algae glow neon, and warm blobs start to rise. |
| Long locked groove | Full lava lamp: glowing translucent blobs rise, merge and split, with strong vorticity and bloom. The score stays perfectly readable. |
| Player stops | Ripples stop at once. The glow sinks over about 15 s, and the drift carries on quietly. |
| Menu, calibration or modal opens | The pool calms over about 2 s: the fluid thickens and eddies fade. It never freezes abruptly. |

---

## 2. What exists today (verified)

- `src/components/PracticeAtmosphere.tsx` holds the shared room. It has CSS layers (`.pa-dawn`,
  `.pa-water` using `src/assets/water-texture.webp`, `.pa-leaf` using `leaf-texture.webp`,
  `.pa-current` SVG lines, `.pa-shade`), driven by CSS variables `--bloom`, `--breath` and
  `--drift-*` from a 20 Hz rAF loop. It subscribes to `input` for RMS only. Earned colour is
  `min(warmth, played/150 s)` × flow. `BeatPulse` (the metronome dial) lives in the same file.
- `src/components/RenderedWater.tsx` is the optional WebGL1 analytic-wave shader. It is capped at
  30 fps and 1,000 px on the long edge, rests when inactive or hidden, and handles context loss.
  This becomes the **Water** tier and stays as the fallback.
- `src/song/renderedRoom.ts` stores the device-local on/off preference `guitar-rendered-room`
  through `useSyncExternalStore`. It has three consumers: `PracticeAtmosphere` and two places in
  `src/tools/GuitarTools.tsx` (a pad row and a footer button).
- The atmosphere is mounted separately in three places, each with its own canvas:
  `SongCoach.tsx` (~line 735, hidden while free play, the tune picker or tools are open),
  `FreePlay.tsx` (~172) and `GuitarTools.tsx` (~145). Opening the metronome today resets the room.
- Input: `src/listen/useInput.ts` provides frames of `{ buf, sampleRate, now, rms }` every 25 ms
  (4096 samples) through `input.subscribe`. `src/listen/pitch.ts` `pitchOf(frame)` /
  `midiOf(frame)` **cache the detector result per frame in a WeakMap**, so a new listener gets
  pitch for free whenever the session or follower is already listening.
- Music analysis already exists in `src/song/freeplay.ts`. **Reuse it and do not fork it:**
  `createOnsets()` (frame → note onset), `guessKey(midis)` (Krumhansl–Kessler, returns tonic,
  mode and fit), `steadyGap(onsets)`, `readGrid(onsets, beatAt, beatMs, beats)` (lock against a
  heard click), and the lock moods `locked | ahead | behind | loose`.
- `src/song/pulse.ts` `BeatSignal { index, serial, active, beats, counting }` reports a beat
  *heard* from the output clock.
- The two textures are 1200×1600 and 1200×1578 WebP files derived from the owner's photographs
  (AGPL, see `ASSETS.md`). The algae photo has bright neon-green marbled swirls, near-black water
  gaps and scattered small yellow/orange leaves. The leaf photo shows backlit green leaf veins.

---

## 3. Non-negotiable rules

These come from `AGENTS.md` and `docs/PRACTICE_SESSION.md`. Breaking them is a bug.

1. **Decoration only.** The pool never influences scoring, tempo, scheduling, evidence, boxes,
   goals or warmth claims. Nothing reads pool state back into practice logic.
2. **No animation clock supplies musical time.** The pool may pulse periodically **only** on a
   heard `BeatSignal`. Without a click, the dance must be *reactive*: impulses from actual onsets
   decaying under physics. **Never predict or extrapolate a beat grid from the player's notes and
   pulse on it.** That would turn the background into a metronome the player follows.
3. **Colour and intensity are earned by the player's own pitched playing during their turn.**
   Enabling the mode, hearing the click, listening to a demo, waiting, or leaving a menu open earns
   nothing. Gate accumulation on the existing `playing` prop, and count only pitched onsets, so the
   mic picking up the click or other transients does not count.
4. **One shared input.** Do not create a new AudioContext, `getUserMedia` call or second pitch
   detector. Use `input.subscribe` + `pitchOf(frame)` and the `freeplay.ts` helpers.
5. **Preferences are device-local.** New localStorage keys must stay out of sync and backup.
   Confirm how the portable-state allowlist in `src/sync/` works. Wrap every read and write in
   try/catch.
6. **Reduced motion** (`prefers-reduced-motion: reduce`) renders one still frame: no drift, no
   ripples, no beat motion.
7. **Hidden pages render nothing.** Context loss falls back silently to the CSS photo room.
8. **Readability wins.** Text over the pool keeps at least its current contrast at maximum
   intensity (§10.3, "calm" lens).
9. **No unseeded randomness.** Use a seeded PRNG (for example mulberry32) for emitter jitter, so
   screenshots and tests reproduce.
10. **Guitar-operated UI.** The mode switch must be reachable as a played `GuitarPad` row, not
    only as a button. Labels state a state ("Room · Living"), never an instruction.
11. `src/core/` stays untouched. TypeScript strict, no `any`.

---

## 4. Architecture

```
            InputApi.subscribe (25 ms frames)        BeatSignal / tuner / session events
                       │                                        │
                       ▼                                        ▼
  src/pool/groove.ts (pure) ──► GrooveState ──►  src/pool/bus.ts (imperative, no React state)
  reuses createOnsets/guessKey/                         │
  steadyGap/readGrid                                    ▼
                                         src/pool/params.ts (pure)  groove → PoolParams
                                                        │
  DOM anchors [data-pool]  ── rect collector ──►  src/pool/host.ts  (rAF, governor, visibility,
  (score, dial, tuner, pad)   (on layout change)        │            context loss, power gating)
                                                        ▼
                                         src/pool/engine/renderer.ts  (DOM-free WebGL2)
                                           fluid · marbling · waves · glow · lava · floaters
                                                        │
                                                        ▼
                                                <canvas> behind the room
                                                        │
                                  CSS vars --pool-glow / --pool-tint on the room root (≤ 8 Hz)
```

### File layout

```
src/pool/
  index.ts            public API: PoolRoom, usePool, useRoomRender, types
  mode.ts             room render preference + migration (replaces song/renderedRoom.ts)
  power.ts            usePowerSource(): "plugged" | "battery" | "unknown"
  groove.ts           pure mood estimator (tested)
  params.ts           pure groove → PoolParams mapping (tested at anchors)
  golden.ts           phyllotaxis, golden spiral and Fibonacci helpers (pure)
  bus.ts              typed event bus + publisher stack
  host.ts             owns renderer lifecycle, rAF, governor, visibility, context loss
  PoolRoom.tsx        provider + canvas + anchor collection + input subscription
  pool.css
  engine/
    gl.ts             program/FBO/ping-pong helpers, capability probe
    fluid.ts          stable-fluids passes
    waves.ts          height-field ripple simulation
    floaters.ts       GPU particle leaves
    compose.ts        final composite + bloom
    shaders.ts        GLSL ES 3.00 sources as TS strings
    renderer.ts       class Renderer { init, step, resize, setAnchors, dispose }
```

`renderer.ts` must not touch `window` or `document`, so it can move into a worker with
`OffscreenCanvas` later if profiling shows main-thread cost (§11). Load the whole engine with a
**dynamic `import()`** only when the effective mode is Living. Phones and Still/Water users never
download it.

### One pool per room

Today each room mounts its own atmosphere. Replace that with **one `PoolRoom` provider per
practice room**: the outermost element of `SongCoachRoom`, plus standalone `FreePlayView` and
standalone `GuitarTools` (inside its `PracticeWindowBoundary`) when no parent provider exists.
`PracticeAtmosphere` becomes a **publisher** when a provider is present. It pushes `playing`,
`warmth`, `flow`, `beat` and `bpm` through the provider, and the canvas and fluid state survive
switching between session, free play, tuner and metronome. Publishers form a stack where the
last mounted one wins. That matches today's conditional mounting, where only one atmosphere is
visible at a time. With no provider (Still/Water, or tests), `PracticeAtmosphere` renders exactly
as today.

---

## 5. Render modes and power gating

Replace the boolean with a four-value device preference.

| Stored mode | Label | Effective behaviour |
| --- | --- | --- |
| `still` (default) | Room · Still | Today's CSS photo room. |
| `water` | Room · Water | Today's `RenderedWater`. |
| `living` | Room · Living | Living pool whenever the GPU qualifies, on any power. |
| `living-power` | Room · Living on power | Living while plugged in; Water on battery or when power is unknown. |

- Key `guitar-room-render`. **Migration:** if it is absent and `guitar-rendered-room === "on"`,
  read it as `water`. Keep the old key untouched. Use the same `useSyncExternalStore` + storage
  event + transient-fallback pattern as `renderedRoom.ts`. Export
  `useRoomRender(): { mode, effective, cycle() }` and update the three consumers. Delete
  `renderedRoom.ts` only after nothing imports it.
- `power.ts`: use `navigator.getBattery?.()`, listening to `chargingchange`. Without the API
  (Safari, Firefox, iOS) the state is `"unknown"`, and `living-power` behaves like Water. The row
  value then states it: "Living on power · not detectable here".
- Unplugging while Living crossfades to Water within about 3 s and releases GL resources after
  10 s. Plugging back in crossfades up.
- **Capability probe:** WebGL2 plus renderable half-float colour (`EXT_color_buffer_half_float`
  or `EXT_color_buffer_float`). If this fails, Living falls back to Water, and the row value says
  "Living · unavailable on this GPU".
- Reduced motion with Living shows one still composite of the marbled photo. It re-renders only on
  resize or mode change.
- **Where the switch lives** (all cycle the four modes):
  - the GuitarTools pad row and footer button (today "Rendered water");
  - a row in the SongCoach settings pad, which is guitar-played (find the settings `pages`/`rows`
    near the `session.updateSettings` calls);
  - the free-play pad, if it has a settings page.
- Persist the governor's last stable quality tier in `guitar-pool-tier` (device-local).

---

## 6. The simulation

The sim grid uses aspect-correct, normalised coordinates. All fields are ping-pong framebuffers.
Never call `readPixels`, or `getError` inside the frame loop, because both stall the GPU.

### 6.1 Fluid (stable fluids)

Per step: **curl → vorticity confinement → forces → divergence → pressure (Jacobi, warm-started
from previous pressure × 0.8) → gradient subtract → advect velocity** (semi-Lagrangian, linear
filtering, dissipation by half-life).

- Velocity is RG16F and pressure is R16F, at sim resolution (tier table in §11).
- **Forces:**
  - ambient vortices (§9);
  - note stones: a gentle radial outward splat plus a small push from the ripple height gradient;
  - metronome pendulum slosh (§10.4);
  - lava buoyancy (§6.5);
  - "calm" damping when a modal opens: raise dissipation temporarily.
- **Obstacles** ("rock" anchors, §10.3) are passed as up to 16 rounded rects in a
  `uniform vec4 rects[16]` with radii. Compute an SDF in the shaders and apply free-slip at the
  boundary: remove the normal velocity component inside or near the rock. This makes the algae
  stream and pile around the score like water around stones. No mask texture is needed.

### 6.2 Marbling the photograph (the key trick)

Do **not** advect the photo's colour as dye. Repeated bilinear resampling blurs the photograph
into mush within seconds. Instead, advect a **coordinate displacement field** and sample the
crisp photo through it.

- Absolute photo coordinate `C(x) = x + drift + D(x)`. `drift` is a uniform that accumulates the
  slow constellation drift across the screen. `D` is stored in RG16F at "marble" resolution.
- Advecting `C` with velocity `v` gives **`D'(x) = D(x − v·dt) − v·dt`**. Then relax:
  `D' *= exp(−dt / τ_relax)`. Storing the *displacement* rather than absolute coordinates keeps
  values small, so half floats keep enough precision. Absolute UVs in half float would be about
  13 px coarse.
- **Stretch guard:** compute `|∇D|` in the advect shader. Where it exceeds about 1.5, relax harder
  locally, so extreme stretching never turns into smears. `τ_relax` follows the groove: a calm
  pool keeps the photo coherent, and a deep groove lets it marble and twist.
- Sample `water-texture.webp` with `MIRRORED_REPEAT` (NPOT is fine in WebGL2) and mipmaps. Use
  world scale with one photo height ≈ 1.2 screen heights, rotated −12° for continuity with the
  current CSS layer. Load it with `createImageBitmap(await (await fetch(url)).blob())`, taking the
  URL from a Vite asset import.

### 6.3 Ripples (wave equation)

There is a separate height field `h` (R16F ping-pong) at the "waves" resolution:
`h' = (2h − h_prev + c²·dt²·∇²h) · damping`. Keep `c·dt/dx ≤ 0.7` for stability, sub-stepping
if needed.

- **Note stone:** a Gaussian drop. Low notes are wide and soft, high notes small and sharp:
  radius ∝ `2^(−(midi−40)/24)`. Amplitude comes from the onset's RMS, normalised by a running
  peak. A chord (several strong pitch classes in one onset frame, already computed elsewhere
  through `strongPitchClasses`; do not add a second spectrum pass just for this) drops several
  stones together.
- **Placement:** phyllotaxis (§9.1), avoiding "calm" lenses.
- The composite uses `∇h` for refraction (photo UV offset), specular glints and caustic sparkle.
  It also adds a weak force to the fluid, so ripples stir the algae.

### 6.4 Glow: algae emission, note dye and bloom

- **Algae mask**, computed in the composite from the photo sample:
  `smoothstep(0.05, 0.25, g − max(r, b)) · smoothstep(0.25, 0.6, luma)`. This is the "unnaturally
  green" stuff. As the groove grows, it becomes emissive neon:
  `emissive = mask · neon · glow(groove) · (1 + kick)`.
- **Note dye:** RGBA16F at half display resolution. Each stone injects a soft spot tinted by mode
  (§8). It is advected by the velocity and dissipates over a few seconds, so phrases leave fading
  luminous trails that swirl away.
- **Bloom:** downsample the emissive to 1/4 resolution, apply two separable blur passes, and add.
  Finish with soft tonemapping (Reinhard or a simple filmic curve) so intensity never clips.

### 6.5 Lava lamp (buoyant heat)

- A temperature field `T` (R16F, sim resolution) is advected with the fluid and cools
  exponentially.
- Heat sources sit along the bottom edge at x positions `frac(k·φ)` (§9.3). Their rate is
  `max(0, groove − 0.55)` × energy. Buoyancy force: `F = α·(T − T_ambient)·ŷ`.
- **Render:** `blob = smoothstep(0.42, 0.58, T)` gives metaball-like gooey edges that merge and
  split naturally. Add an edge halo of `exp(−|T−0.5|·12)`. The blob interior is translucent,
  backlit `leaf-texture.webp` (veins glowing through), refracting the photo behind it. Blobs flow
  around rocks.

### 6.6 Floating leaves ("whirling and twirling")

- Use 34 particles (a Fibonacci number). Their state lives in an RGBA32F texture
  (`pos.xy, angle, spin`). An update pass samples velocity at the particle position for drift
  with lag. Spin follows the local curl, plus a bob scale from `h`. Render with instanced quads
  (`drawArraysInstanced`, reading state with `texelFetch` in the vertex shader).
- **Sprites come from the algae photo itself, so no new asset is needed.** Hard-code about 8
  normalised UV rects around the yellow/orange leaves in `water-texture.webp`. Find them once with
  a throwaway analysis script in the session scratchpad, not in the repo. Alpha uses a chroma key:
  yellow/orange means high R and G with low B, and `r/g > 0.75`. With groove, the visible count
  grows 8 → 13 → 21 → 34.

### 6.7 Composite order

1. Photo sampled at `C(x)` + refraction from `∇h`.
2. Grade with saturation and brightness from params. At groove 0 this **must match today's muted
   CSS room** (greyscale 0.88, sepia 0.3, opacity ≈ 0.15 over `#101615`), so switching modes at
   rest is seamless.
3. Algae emission.
4. Ripple specular and caustics.
5. Lava blobs (alpha composite).
6. Note dye.
7. Floaters (separate draw).
8. Bloom.
9. Lenses (§10.3) and vignette.
10. Tonemap.

The canvas is opaque with normal blending. In Living mode, hide `.pa-water`, `.pa-water-colour`,
`.pa-leaf` and `.pa-current`, and keep `.pa-shade` as the readability baseline.

---

## 7. Groove: mood estimation (`src/pool/groove.ts`, pure)

Write this as a pure state machine:
`stepGroove(state, frame: { now, rms, midi, clarity, playing }, context: { beat?, beatMs?, flow? }) → { state, onset? }`.
Its features are computed every 250 ms. It has no DOM, no `Math.random` and no wall clock other
than `frame.now`.

**Per frame:**
1. `midi` is counted only when `clarity ≥ 0.8`. Feed `createOnsets()`. On an onset, push it to a
   ring buffer (at most 64 entries / 20 s) and emit it, so the pool drops a stone.
2. Mark sounding 250 ms bins (`rms > 0.008` or pitched).
3. `activeMs` accumulates only while `playing` and sounding. While silent it decays at a quarter
   of the rate.
4. `energy` follows today's breath: `unit(sqrt(rms)·2.5)` with about 250 ms attack and 900 ms
   release.
5. `kick` is a decaying impulse. Each onset adds `velocity·(0.3 + 0.7·groove)` and it decays with
   τ ≈ 600 ms. It drives flashes and vortex spin-ups and is purely reactive.

**Every 250 ms:**

- **Continuity** `C` = sounding bins / 48, covering the last 12 s.
- **Steadiness** `S`, using the first case that applies:
  - a heard beat is active: `readGrid(last 6 s onsets, lastBeatAt, beatMs, beats)?.onGrid ?? 0`;
  - `steadyGap(onsets) !== null`: 1;
  - otherwise, IOI regularity over the last 12 onsets after snapping ratios to the median
    {½, 1, 1½, 2, 3}: `1 − clamp(cv / 0.6)`.

  This is used only as a feature. It must never become a predicted beat.
- **Tonal** `T`: `guessKey(last 24 onset midis)`. Map `fit` with `clamp((fit − 0.5) / 0.4)`.
  Multiply by 0.7 if the tonic changed versus the previous three readings. Keep `tonic` and
  `mode` for tint.
- **Clean** `Q`: session `flow` when provided, otherwise the mean clarity of onset frames.
- `raw = C^0.7 · (0.4·S + 0.35·T + 0.25·Q)`.
- `earned = unit(activeMs / 30 000)^0.7` (was 120 000 in the first version; shortened 2026-11-22 at the user's request). It takes about half a minute of real playing to reach full
  intensity.
- `target = playing ? min(raw, earned) : 0`.
- `groove` approaches `target` exponentially with τ = 20 s rising and 10 s falling, or 8 s after
  4 s of silence.

**Output:** `GrooveState { groove, energy, kick, density, steadiness, tonal, tonic, mode, activeMs, onsetSerial }`.
Band bleed into an acoustic mic during run-throughs may add some energy. That is acceptable for
decoration and never feeds back.

---

## 8. Mood → parameters (`src/pool/params.ts`, pure)

Interpolate smoothly between these anchors with smoothstep, not linear segments. The values are
starting points for tuning by eye. Tune the groove-0 column against a screenshot of today's room.

| Parameter | g = 0 | 0.25 | 0.5 | 0.75 | 1 |
| --- | --- | --- | --- | --- | --- |
| Drift (screen widths / min) | 0.02 | 0.04 | 0.07 | 0.10 | 0.14 |
| Vorticity confinement ε | 2 | 5 | 10 | 18 | 28 |
| Ambient vortices (Fibonacci) | 1 | 2 | 3 | 5 | 8 |
| Vortex orbit speed (rad/s) | 0.01 | 0.03 | 0.06 | 0.10 | 0.16 |
| Velocity half-life (s) | 2 | 3 | 4 | 6 | 8 |
| Marble relax τ (s) | 15 | 30 | 60 | 120 | 200 |
| Photo saturation | 0.12 | 0.35 | 0.70 | 1.05 | 1.35 |
| Photo brightness | 0.18 | 0.25 | 0.35 | 0.45 | 0.55 |
| Algae emission | 0 | 0.05 | 0.20 | 0.50 | 0.90 |
| Bloom | 0 | 0 | 0.15 | 0.40 | 0.70 |
| Ripple damping half-life (s) | 0.6 | 0.8 | 1.1 | 1.5 | 2.0 |
| Lava heat | 0 | 0 | 0 | 0.4 | 1 |
| Visible floaters | 8 | 13 | 21 | 34 | 34 |

- `energy` scales ripple amplitude by `(0.6 + 0.4·g)`. `kick` adds to emission and vortex
  strength briefly.
- **Tint:** neon algae green is always dominant. The glow and dye hue lean warm gold-lime for
  major and cool jade-cyan for minor, with a ±15° hue nudge per tonic around the circle of fifths.
  Never use a rainbow.
- Modal "calm": multiply velocity half-life by 0.3 and fade ambient vortices over 2 s.

---

## 9. Golden-ratio and Fibonacci motifs (`src/pool/golden.ts`)

Use these structurally, not as decoration: they make the motion organic and never-repeating.

1. **Phrase phyllotaxis.** The n-th onset of the current phrase lands at `r = R·√(n/89)`,
   `θ = n·137.5077° + slowRotation`, around a phrase centre placed away from calm lenses. A
   phrase resets after 2 s of silence, and `n` wraps at 89. As you play, a sunflower spiral of
   fading ripples and dye builds up, a visible record of the phrase that swirls away.
2. **Vortex dance.** The ambient vortex count follows Fibonacci with the groove (1, 2, 3, 5, 8).
   Centres sit on a slowly rotating golden spiral `r = a·φ^(2θ/π)` with alternating spin sign.
   Each vortex adds a curl force `s · perp(x − c) · exp(−|x − c|² / r²)`, is repelled from
   rocks, and `kick` spins it up.
3. **Heat emitters** along the bottom sit at `frac(k·φ)`, a low-discrepancy pattern that never
   clumps.
4. **Incommensurate LFOs.** The drift wander uses periods `T·φ^k` (T = 23 s, k = 0..3), so the
   pattern never visibly loops.
5. **Counts:** 34 floaters, rect cap 16, phrase wrap 89.

---

## 10. Native integration with every part

### 10.1 Event bus (`bus.ts`)

```ts
type Anchor = "metronome" | "tuner" | "cursor" | "focus";
type PoolEvent =
  | { kind: "note"; midi: number; velocity: number; chord?: number[]; at?: Anchor }
  | { kind: "beat"; index: number; serial: number; downbeat: boolean; counting: boolean; swing: -1 | 1 }
  | { kind: "tune"; cents: number | null; frequency: number | null } // at most 10 Hz
  | { kind: "bloom"; strength: number; at?: Anchor }                   // a clean pass
  | { kind: "sweep"; direction: -1 | 1 }                                // card change
  | { kind: "calm"; on: boolean };                                      // modal/pad/calibration
```

The bus is imperative, with no React state per frame. `PoolRoom` subscribes to input itself
(groove + note events). Beat events come from `PracticeAtmosphere`'s existing `beat` prop on
serial change, so no new clock is introduced.

### 10.2 CSS variables: the UI breathes with the pool

The host writes `--pool-glow` (0–1) and `--pool-tint` (an rgb triplet) on the room root. It
writes at most 8 Hz, and only when a value changes by more than 0.02. Consumers change only
colour and opacity, never layout and never keyframe animations per note. An earlier profile found
per-note CSS animations forcing 55–120 fps. Good consumers:

- `BeatPulse` ring stroke, accent and resonance;
- beat dots;
- the score cursor glow;
- `GuitarPad` row highlight;
- the input-state dot.

### 10.3 Anchors, rocks and lenses

Elements opt in with `data-pool` (space-separated) and optionally `data-pool-anchor`:

| Token | Effect |
| --- | --- |
| `rock` | Fluid obstacle: the algae flow and pile around it. |
| `calm` | Readability lens: inside the rounded rect, brightness ×0.55, saturation ×0.6, refraction ×0.3, emission ×0.25, with a soft edge. |
| `glass` | Magnifying lens: ×1.15 zoom and stronger refraction inside a circle, with a thin caustic ring at the rim. |

- **Collector:** `ResizeObserver` + `MutationObserver` (attribute filter `data-pool`, childList)
  on the room root, throttled to 4 Hz. Rects are converted to canvas-normalised coordinates and
  sent to the renderer only when changed. The cap is 16; prefer the largest.
- **Mark:**
  - score/material container: `rock calm`;
  - `GuitarPad` scrim panel: `calm`;
  - the tuner rail: `calm`, anchor `tuner`;
  - the metronome dial face: `glass rock`, anchor `metronome`;
  - the current score note, if the score exposes a stable element for it: anchor `cursor`;
  - session text lines: `calm`.

### 10.4 Metronome: a glass disc floating on the pond

- Each heard beat (from `BeatSignal`, never a timer) drops a stone at the dial's centre. A
  downbeat is amplitude 1.0 with a warm dye tint, other beats 0.55, and count-in beats 0.35 with a
  cool tint.
- **Pendulum slosh:** each beat adds a tangential swirl around the dial whose direction follows
  `serial % 2`, the same parity `BeatPulse` uses for its sweep. The pool sloshes with the
  pendulum.
- The dial face is `glass`: the pool shows magnified through it, and rings leave its rim. Make the
  dial's SVG pool gradient transparent in Living mode so the real pool shows through.
- This replaces `.pa-beat-resonance` in Living mode. Keep `.pa-beat-resonance` for Still/Water.

### 10.5 Tuner: visible beating

Draw two analytic concentric ring sets at the tuner anchor in the composite (not the wave sim).
One is at the reference wavelength, the other detuned. Their phase difference advances at the
**real beat frequency**:

    Δf = f · (2^(cents/1200) − 1)

Out of tune, the moiré shimmers. The shimmer slows as you approach pitch, and in tune
(|cents| ≤ 3) it freezes into clean standing rings while the pool goes glassy: turbulence is
damped and vortices fade. This shows the physics instead of instructing. `GuitarToolsRoom` emits
`tune` events from `tuner.pitch`.

### 10.6 Practice session and free play

- **Session:**
  - onsets during the player's turn make stones;
  - a cleanly passed card emits `bloom` (one slow radial glow wave from the focus);
  - a card change emits `sweep` (a gentle current carries the old material's trails off-screen);
  - wrong notes get **no** special punitive visual; they are just smaller, duller stones.

  Find the pass and card-change moments in `useSession`/`SongCoach`. Emitting is fire-and-forget
  and must not change session code paths.
- **Free play:** the full intensity range. Phrase phyllotaxis is at its most visible here.
- **Menus, calibration, the tune picker and the Devices dialog** set `calm` (and `playing` is
  already false there). Respect modal suspension: no scoring, playback or wake is triggered by the
  pool.

### 10.7 Later, optional: the shell

Phase 7 at most, and only if the user wants it. A calmer idle pool could sit behind
Overview/Songs/Progress in Living mode. Navigation notes (`useGuitarNav`, fret 12 and up) would
drop stones at the nav cursor's rect. It must not open the mic by itself, and it must unmount
while Devices is open (see the `App` idle-boundary rule).

---

## 11. Performance

### Budget

Target a plugged-in Apple Silicon MacBook running Chrome.

- **Living, top tier, while playing:**
  - p95 frame ≤ 18 ms (55+ fps);
  - GPU ≤ 5 ms/frame, using `EXT_disjoint_timer_query_webgl2` where available;
  - pool JS ≤ 1 ms/frame on average.
- **Input cadence must not degrade.** The p95 interval between 25 ms input frames should stay
  within +2 ms of baseline with Living on. This is the acceptance criterion that protects
  scoring.
- **Idle and visible:** at most 20 fps, on tier ≤ 1.
- **Hidden:** zero rAF.
- **GPU memory:** ≤ 64 MB.

### Quality tiers

| Tier | Sim (long edge) | Jacobi iterations | Marble | Waves | Bloom | Floaters | Max fps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q3 | 256 | 24 | 1024 | 512 | full | 34 | 60 |
| Q2 | 192 | 18 | 768 | 384 | full | 34 | 60 |
| Q1 | 128 | 12 | 512 | 256 | half | 21 | 30 |
| Q0 | 96 | 8 | 384 | 192 | off | 0 | 30 |

- Display resolution is ≤ 0.75 × DPR, with a cap of 1600 px on the long edge.
- Q3 is allowed only while plugged in (or in explicit `living` on a desktop-class GPU).
- **Governor:**
  - start at the persisted tier, or Q2;
  - every 3 s, read the p90 frame time;
  - above 18 ms, step down a tier;
  - below 11 ms for 10 s, step up;
  - if Q0 still exceeds 25 ms, drop to Water for the session with `data-renderer="degraded"`.

### Worker

Start on the main thread behind the DOM-free `Renderer`. Move to a worker with
`transferControlToOffscreen()` (the main thread posts rAF ticks, events and rects; the worker loads
the image with `createImageBitmap`), **only if** measurement shows pool JS above 1 ms/frame or any
input-cadence regression. Keep a main-thread fallback.

### Measuring

Do this before Phase 2 and after Phases 2, 4 and 5.

- Recreate the earlier playwright-core harness: install `playwright-core` in a scratch directory
  outside the repo, never as a repo dependency, and drive system Chrome against `vite` on port
  5199.
- Measure per-process CPU with `ps` across the browser's process tree, a trace with frame/paint
  counts, and input-frame intervals (log `frame.now` deltas in a temporary harness subscriber).
- Ablate layers one by one: waves, lava, floaters, bloom.
- Check `WEBGL_debug_renderer_info`. If headless fell back to SwiftShader, GPU numbers are not
  representative, so run headed Chrome for them.
- Report before and after numbers to the user.

---

## 12. Lifecycle and failure behaviour

- On `webglcontextlost`: `preventDefault`, crossfade to the CSS photo room, and try one restore
  on `webglcontextrestored`. A second loss means Water for the session.
- On visibility hidden: stop ticking and keep GPU resources for 30 s, then release them.
- Unmount releases every program, texture, framebuffer and buffer (follow `RenderedWater`'s
  `release()` discipline).
- Mode changes crossfade over about 1.5 s. There is never a black frame. Keep the CSS room under
  the canvas until `data-renderer="ready"`.
- jsdom and tests: there is no WebGL2, so `PoolRoom` renders the canvas with
  `data-renderer="unavailable"` and the CSS room. Existing smoke tests must stay green unchanged.
- **Dev only** (`import.meta.env.DEV`): `window.__pool = { setGroove(g | null), note(midi, v), beat(downbeat), tune(cents) }`
  drives the visuals without a guitar, for screenshots and tuning. It must be stripped from
  production builds.

---

## 13. Phases

Each phase ends with `make quick`, the phase's focused tests and a short visual check. Commit
only with the user's permission (§0).

**P0. Baseline.** Measure today's Still and Water rooms during a synthetic session (CPU, frames,
input cadence) and save the numbers.

**P1. Modes and power.**
- Build `mode.ts` (four modes, migration) and `power.ts`, and replace `useRenderedRoom` in its
  three consumers.
- Add pad rows in Tools, the SongCoach settings and free play (if it has settings), and update
  the footer button label.
- Living resolves to Water until P2 lands.
- *Tests:* migration, cycling order, `living-power` with mocked `getBattery`
  (charging / not charging / unsupported), and reduced-motion resolution.

**P2. Engine skeleton and one pool per room.**
- Build `gl.ts`, the capability probe, the fluid passes, coordinate marbling of the photo, the
  composite matching today's look at groove 0, ambient drift and one vortex.
- Build the host (rAF, tiers, governor, visibility, context loss) and the dynamic import.
- Build `PoolRoom` plus the publisher stack in `PracticeAtmosphere`. The fluid now persists across
  tools, free play and tune switches.
- *Accept:*
  - at rest, a 1440×900 screenshot looks like today's room (mean luminance within about 10%);
  - the photo visibly drifts and marbles without smearing after 10 minutes;
  - perf is within budget.

**P3. Ripples and the bus.**
- Build the wave field, note stones from the shared input (`pitchOf` cache + `createOnsets`),
  phrase phyllotaxis, refraction/specular, dye injection, and `bus.ts`.
- *Accept:* in a synthetic session, each played note makes a ring at a phyllotaxis position, with
  no ring during the demo/listen phase or while a menu is open.

**P4. Groove and intensity.**
- Build `groove.ts` and `params.ts`, algae emission, bloom, lava buoyancy, floaters and the
  tonic/mode tint.
- *Tests:* see §14.
- *Accept:*
  - with `__pool.setGroove` at 0 / 0.3 / 0.6 / 0.9, screenshots show the arc in §1;
  - a synthetic two-minute steady in-key performance rises through it without the override;
  - stopping sinks the glow over about 15 s.

**P5. Native integration.**
- Add the anchor collector, rocks, calm and glass lenses, metronome stones and slosh, the tuner
  beating rings, session `bloom`/`sweep`, and the `--pool-glow`/`--pool-tint` consumers.
- *Accept:*
  - text contrast inside calm lenses at groove 0.9 is at least as high as today, measured on
    screenshots;
  - the metronome works with the click and stays still without it;
  - tuner rings freeze within ±3 cents.

**P6. Docs, assets and handoff.**
- Make the doc updates in §16 and run `make map-update`.
- Take final perf numbers versus P0, then run `make check` once.

**P7 (optional, ask first).** The shell-level pool (§10.7).

---

## 14. Tests

Focused tests only, reusing the existing suites' style under `src/__tests__/`.

- **`pool-groove.test.ts`** (a pure, seeded synthetic onset/frame stream):
  - silence stays at 0;
  - 2 minutes of steady eighths in G major at 100 bpm with `playing` rises above 0.7;
  - the same notes during `playing=false` (demo) stay at 0;
  - random chromatic pitches at random timing stay below 0.35;
  - unpitched click-like transients (`midi` null) never raise the groove;
  - after the steady stream stops, the groove halves within 8–12 s with no step drop;
  - with a heard beat, onsets on the grid score higher steadiness than the same onsets off it;
  - identical input produces identical output.
- **`pool-params.test.ts`:** anchor values are hit exactly, every parameter is monotonic in
  groove, and groove-0 grading constants match the documented "today's look" values.
- **`pool-mode.test.ts`:** as listed in P1.
- Do not test shaders, rendering permutations or CSS. Verify those visually and by measurement.

---

## 15. Visual verification without a guitar

- Use a temporary `harness.html` + `.harness/main.tsx` in the repo root, and delete both
  afterwards. Wrap the mount in `<div className="app">`, and import `src/practice.css` and
  `src/tunes/tunes.css`.
- Use a fake `InputApi` whose `subscribe` feeds synthesised frames: a sine plus two overtones,
  4096 samples at 48 kHz every 25 ms, with a pick envelope. This drives the real detector and
  onsets. Seed a fake `guitar-calibration`.
- Screenshot with:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1440,900 --virtual-time-budget=9000 --screenshot=out.png URL`.
  Launch it in the background, wait for the PNG, then `pkill -f` its `--user-data-dir`, because
  it often doesn't exit.
- The audio clock does not advance under virtual time. Use `__pool.beat()` for metronome visuals
  in screenshots.
- Review at 1440×900 and 390×844 (Living off on phone width, unless the user forces it), at
  groove 0, 0.3, 0.6 and 0.9.
- Never claim that real mic input, real power switching or real GPU performance was verified
  unless it was. State exactly what was checked.

---

## 16. Docs and assets to update (P6)

- **`docs/ARCHITECTURE.md`:**
  - in the atmosphere paragraph, describe the pool layer, modes, bus, anchors and rules;
  - add `src/pool/*` rows to the module table.
- **`docs/PRACTICE_SESSION.md`:**
  - in "The practice room", replace the "Rendered water" paragraph with the four modes;
  - state that the pool uses the shared cached pitch and onsets (still no second detector), that
    it reacts and never predicts beats, and that intensity is earned only by the player's pitched
    playing.
- **`docs/CURRENT_STATE.md`:**
  - feature status with exactly what was verified;
  - storage table rows for `guitar-room-render` and `guitar-pool-tier` (device-local, outside
    sync/backup);
  - note that `guitar-rendered-room` is read only for migration.
- **`README.md`:** the "Rendered water" mention.
- **`AGENTS.md`:**
  - entry 17 (the `RenderedWater`/`PracticeAtmosphere` line) and the renderer rule in
    "Architecture rules";
  - the pool must never be a clock and must never feed practice logic.
- **`ASSETS.md`:** a row saying the pool shaders are original project code (AGPL-3.0-only) and
  that floaters reuse regions of the existing `water-texture.webp`, with no new image assets.
- **`docs/BACKLOG.md`:** update it only if a `T*` item covers this.
- Run `make map-update`. Never hand-edit `docs/REPO_MAP.md`. Commit it with the code that added
  the files.

---

## 17. Out of scope / don'ts

- No new audio analysis passes. Chord stones reuse what is already computed. If nothing computes
  it in a given room, single-note stones are fine.
- No beat prediction, and no tempo inference driving periodic visuals.
- No changes to scoring, follower, session state machines or tempo rules.
- No rendering libraries and no new image assets.
- No `localStorage` writes per frame.
- No layout-affecting CSS driven by the pool.
- Do not enable Living by default, and never auto-enable it on phones.
- Do not keep the harness files, the scratch analysis scripts or `playwright-core` in the repo.

## 18. Defaults chosen (the user may override)

- Living keeps drifting while the room is idle but visible: alive at rest, slowly. Water still
  rests when idle, as today.
- `living-power` falls back to **Water** on battery (not Still).
- The engine runs on the main thread first. Move it to a worker only if measurement demands it.
- The shell-level pool is deferred to an optional phase.

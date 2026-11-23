# The practice session

How the full-screen session in the Tunes view (`src/song/`, `src/components/SongCoach.tsx`) is
meant to behave, and why. The rule behind all of it: the app reacts to what the player does; it
does not tell them what to do.

## The guitar is the controller

| Gesture | Where | Does |
| --- | --- | --- |
| A note held ~0.4 s (shown on screen next to what it works) | exercises | hear it again · your pace · in time · next exercise |
| The same, by note name in any octave | before and after a session | carry on · free play · settings · other tune · shuffle |
| D♯5 (high e, fret 11) struck three times quickly, or held 1.3 s, released into quiet, then held again 0.6 s | exercises, free play, instruments | the six-string menu (tempo, click, tuner, sound output, …) |
| A free note tapped twice | exercises, open drawer | gear, calibration, the drawer's switches |
| F (any octave) held | ready screen | session length: 10 / 25 / 45 minutes |

Note keys (`song/notekeys.ts`) have home notes outside what exercises play (E5; F2, G2, G♯2). A
card that sounds a key's home note, itself or through its band, gets the nearest free note
instead. Allocation reserves every octave of what the player plays: chord tones, improvisation
choices and, unless the card is exact, melody notes. A note asked for on the neck is searched
for, so every fret (0–15) of its string, or two semitones around a position's answers, stays free
of keys too. Tones a chord scorer only tolerates stay free, so chord cards keep their keys; tone keys use the same pitch classes. In free play,
whole-tune cards and improvisation every note is music; direct held-note and double-tap
shortcuts are disabled. The deliberate guitar menu remains available.
It is called with D♯5 (`SUMMON_NOTE`, high e fret 11): fretted and above the default fret-10
range, because open strings ring on and get tuned. The fast way in is three separate strikes of
it (each ≥70 ms, under 450 ms apart, within 2.2 s); any other pitch between them cancels, and
the coach ignores it while the music itself can sound D♯5. The "Sound & setup" page has a
Settings row that opens the settings drawer. No note key or tone key uses it, and the
coach ignores it while the current or previous target can sound it. Its first hold only arms
it; at least 150 ms of quiet and a fresh second hold within five seconds confirm it. A
different intervening pitch cancels. One sustained musical note cannot open the menu. The menu
waits for the opening note to stop or change before accepting a fresh row hold (0.6 s). Its six
rows are the first fret of each string (F, A♯, D♯, G♯, C, F; any octave, F split by register);
the tune chooser uses the same six notes. A quiet scrim separates the menu from the music; its
rows remain reachable on phone screens.

No command anywhere sits on an open-string pitch class (E, A, D, G, B): open strings ring on and
get tuned. Ready uses A♯ free play, C♯ settings, G♯ mix, F length, E♭ without scoring, F♯ tune
and C instruments (the metronome is a switch inside); the summary uses C, A♯, C♯, F and F♯. On
Ready, any other fretted note held 0.7 s begins; exact open-string pitches never do, including
the fretted unisons that sound the same (for example A2 at the fifth fret of the low E string).
Double taps are off while the six-row menu is open; the paused drawer prefers the card's own
notes to open strings.

**Choose tune** lives inside this room, including from free play. Its optional **Listen to
opening** only listens while explicitly armed. Matching needs at least six fresh attacks and
three pitch classes from an original-key opening; octaves may differ. It offers candidates,
then a separate review and fresh confirmation. Recognition alone never changes music. A change
waits for practice saves and keeps the outer writer boundary and fullscreen. Save failures stay
in the picker for retry. Menus and pickers suspend scoring, clocks and auto wake/reconnect;
closing one only releases a pause it owns.

## The session's shape

The ready screen plans a session of the chosen length (`song/planner.ts`): a scale the hands know,
then a focus, then what the box says is due, then a melody of the tune. The focus is the mistake the
player's history shows most (`song/profile.ts`), kept for up to ten days and dropped once it has
halved; without one, the last run-through's short bars or a skill left alone for a week. It is
named as one fact ("Leaps · 41 % missed"), never as advice. Struggling lately brings no new cards;
cruising brings more.

The opening three exercises are visible before starting. Input status and connection/reconnect
actions sit beside the held-note start gesture; the option notes are shown separately. During a
session the phase and exercise number stay visible. The displayed note actions and guitar menu
also work as buttons.

All blocks, including focus work, fit the selected estimated budget; a melody is reserved for
the ending when one fits. The estimate is not a countdown: retries and time spent on a passage
can extend it. If nothing fits, the ready screen offers a longer length or free play. Mixed-tune
attempts are ordered by timestamp (day/order for older data) before adapting the new-card count.
From Practice or a focused mode, choosing an exercise opens that exact card on the ready screen.

A selected musical goal fixes a short arrangement-specific route and personal start/target tempo.
The planner favors its relevant tasks while retaining due review and a musical ending. New goals
never rewrite the imported score tempo. Goals appear in Practice, Songs and Progress; their
completion evidence is distinct from lifetime review boxes and historical milestones.

Ready offers **Practise without scoring** before a fresh microphone request. This starts the same
session engine with playback and manual actions, without listening-based verdicts. Activity is
saved with source `self`; it earns no automatic box, kinship, accuracy or clean-tempo credit. A
failed or denied microphone therefore leaves a useful practice route available.

**Finish after this pass** is reachable through the shown time-note action and its button. During
a timed pass it waits for that pass to finish, then opens the summary; elsewhere it finishes at the
next safe boundary. **Stop now** remains available. Neither action awards an unfinished pass.

## One exercise

`intro → (listen) → (your pace) → in time → result`, by itself (`song/useSession.ts`). Once the
music has been heard, just now or on an earlier visit, it goes straight to in time; your pace comes
first only for music never heard, new-every-time cards and a part taken out, and stays one note key
away. Asking for in time while a pass is already playing changes nothing: the pass carries on.

- **Your pace.** The cursor waits for each note. Going back is followed, not punished. A take
  starts on a fresh attack, so a string still ringing is not its first note. A take is clean when
  the notes landed first time, forgiving the first and last note and one stray mark in twelve
  (`song/judge.ts`): detection is least reliable at the edges of a phrase.
- **In time.** If the player came in with a steady tempo of their own, the click starts ~12 % under
  it, so they settle down onto it. Only clean passes raise it; two short passes lower it a step
  (4 bpm, as much as a clean pass earns). The first time, where the visit is heading stays put, so
  clean passes earn the way back; after that it comes down too. Right notes with too few attacks
  caught to time them hold the tempo without counting as short; three such passes end the
  exercise as ok. Two passes of mostly wrong notes send the band away until a take at the
  player's own pace is clean again. The tempo moves while the band plays. The first note may come early, the last may land
  late, and a finished pass keeps its colours for a moment.
  Untied repeated notes need separate attacks; ties remain a single target. Scale, melody and
  comping passes must also establish steady timing before the tempo rises. A bounded constant
  early/late alignment is separate from unevenness or accumulating drift; distinct attacks for at
  least 60% of the middle notes must establish steadiness (an attack the onset detector misses,
  such as a slur or ringing repeat, is a detection gap rather than a timing error). Drift counts
  only beyond its own measurement noise (twice its standard error from scatter around the fitted
  line), so noisy short phrases are not failed by chance. Alignment does not earn a larger increase. Held
  voicings and improvisation keep their own acceptance rules.
- **The beat.** Hearing the passage and playing it in time both carry a pulse when no click is
  asked for: a soft kick and hat on every beat, with a quiet eighth between beats slower than
  84 bpm, so rests are heard as time. In a gap only a soft hat stays.
- **Coming round.** A looped phrase (melody, reading, ear) has a counted bar between passes: the
  count-in clicks and the big number return, the finished pass keeps its colours through it, and
  its score lands before the next pass starts. Scales, harmony drills and chord changes cycle on
  without a break.
- **Gaps.** Once an exercise is well known (box 4) the band drops out for two bars in four (four in
  eight in the top box) while it plays in time; the notes are still judged, so the time is the
  player's. During a focus on time every focus card plays this way.
- **Timing.** After each pass in time a strip shows every note against its beat and how scattered
  they were (ms), with raw reference alignment separate from scatter. A pass accommodates constant
  phase within the smallest of 200 ms, 30% of a beat and 45% of nearby attack spacing; scatter and
  drift limits still apply. Calibration's play-along supplies effective compensation, including
  the player's response to the reference; it does not isolate hardware latency.
  A note is timed where its string was struck (`listen/attacks.ts`: the highs of the pick, read in
  ~3 ms steps from the newest samples of each frame), not at the frame that later finds its pitch,
  and the same pitch struck again (triplets, repeated notes) is a new attack even when the level
  hardly moves. A calibration measured before this (or the 50 ms output guess it absorbed) no
  longer applies; until the play-along runs again the input lag is a 30 ms guess.
  Tuning/noise calibration belongs to the opened input and sample rate; measured lag also belongs
  to the selected output. Changing that setup makes lag a guess until measured again.
  Assessed BPM comes from the completed pass's actual scheduled tempo, not its final control value.
  Changing tempo invalidates the current pass immediately. A varying run-through is at most `ok`
  and cannot certify a new clean speed; adaptive lessons need a fresh, stable complete pass.
  A suspended
  input pauses the session until it resumes.
- **Silence.** 8 s without a note at the player's own pace: the next note sounds quietly and the
  cursor calls. Twice that and the passage is played again. 75 s: the session rests until a note
  wakes it. Only time spent playing is counted.
- **Devices.** A lost input pauses the session and resumes when one is back (`listen/useInput.ts`
  reopens it without a reload). Sound output is chosen in the drawer or the menu
  (`audio/output.ts`, Chrome/Edge) and falls back to the system's output while its device is away.
- **How it is going** is one number (`song/estimator.ts`) that warms the room and widens the line
  under the material: right notes for melodies; right notes, unbroken runs and sitting on the
  click for scales.
- **Ghost playhead.** In time a faint line glides through the score where the music being heard
  is, from one note toward the next (`playback.beatAt`, read from the device clock on each frame).
  It is absent in count-ins, breaths and gaps. A note that lands right flares and throws a few
  sparks; a missed one dims like an ember. Reduced motion shows neither.
- **Tempo by hand.** Wherever the tempo dial shows (an exercise, free play), quiet − and + steps
  beside its number move the tempo 4 bpm, as the guitar menu and the − / + keys do. At the
  player's own pace the dial then shows the tempo set, not the measured pulse.
- **Flowing score.** The whole tune, a run-through and sections longer than eight played bars are
  read as they are played (`tunes/flow.ts`, `components/ScoreFlow.tsx`): repeats, endings and
  jumps are unrolled into one forward line, so nothing sends the eyes back; the parts of the form
  are named in a strip above it (the file's rehearsal marks, or parts found from what comes back
  in the melody and the chords: A, B, A′…) with the current one lit. Notes are spaced by time and
  the line flows right to left under a still line where the music is, on the heard output clock;
  every note reaches the line as it sounds, and a note played right turns the colour of the
  floating leaves. At the player's own pace the line eases on to each note they find. Round to
  the top for another pass, the paper fades back rather than rewinding. In a gap the notes keep
  coming and the line dims: the time is the player's. It sits closer as the exercise moves up the
  box; the guitar menu's **Score** row (Tune & session page, in place of Return to playing), Z / X,
  a trackpad pinch or two fingers move it (`guitar-score-zoom`, this device only). Memory work and
  parts taken out keep the page.
- **Visible beat.** The pulse follows the beat being heard from the audio output clock, including
  count-in. That clock is the device's own (`heardTime`, read from the browser context behind
  Tone's wrapper, which reports none), shown a paint ahead so it lands as it sounds; scoring and
  calibration read the same device clock (`ctxToPerf`). Each heard beat also lights the whole room
  from its edges (warm on the bar's first
  beat, cool while counting in), so the beat is felt while the eyes stay on the music. It rests
  with paused/stopped audio and gap practice; no separate animation clock supplies time to the
  player.

## The practice room

The session and free play share a decorative water/leaf texture and quiet current lines
(`PracticeAtmosphere`). Input loudness gives them a small, smoothed movement; sustained active
playing and the existing flow measure gradually reveal colour. Waiting, listening to a demo,
or leaving a menu open does not earn warmth. The decoration performs no extra pitch analysis
and has no effect on scoring or tempo. Reduced motion removes drift and beat ripples while
keeping the current beat marker and readable state.

Tuner and metronome open from the visible instrument controls or the guitar menu without leaving
the room. The current practice engine holds still; Return restores it. The tuner reuses the
shared input at concert A440 and shows chromatic cents, a centered tuning rail and standard
string targets. Tuning notes are music until the deliberate menu gesture is completed.

The metronome uses the existing playback engine: 2–7 quarter-note beats per bar, an accented
first beat, subdivisions, one-bar count-in and tap tempo. Changing meter stops it so the next
Start begins a fresh bar. Its engraved dial, weighted sweep, beat markers and room resonance
follow heard beats, including count-in; no presentation timer supplies musical time.
The **room** has four device-local modes, chosen from the instruments' guitar pad ("Room"), the
instruments footer or the session settings: **Still** (default, the photographic room),
**Water** (analytic GPU waves, capped at 1,000 pixels and 30 fps), **Living** and **Living on
power** (Living only while a charger is reported; otherwise Water). The living pool floats the
algae photograph on a fluid simulation, flowing gently from the moment it opens: notes make ripples on a sunflower spiral of the phrase,
the heard beat lights the metronome's glass dial on the same frame, sends a ring out from its rim
and sloshes with its sweep (the dial's dot is fastest into the ends of its arc, on the click), the
tuner shows the string's real beating as moving rings that freeze within ±3 cents, and over about
half a minute of steady, in-key pitched playing the algae marble, glow and grow rising blobs.
Over minutes the pond itself changes: it turns, place by place, into the next of the owner's pond
photographs, the old algae streaming away as the new shapes grow out of them, and on to the next;
playing hurries the turn a little, an open menu holds it. Every
heard beat also throws the spiral eddies one way and the next swings them back, more as the groove
builds, so the poison-green algae sway on the pulse against the dark water. With nothing chosen the
room is Living on power (Water on battery). It
uses the shared per-frame pitch cache and free-play onsets (no second detector or audio context),
reacts to onsets and heard beats only, and never predicts a beat from the player's notes.
Intensity is earned only by the player's pitched playing during their turn: enabling the mode,
the click, a demo, waiting or an open menu earn nothing, and menus calm the pool. Calm lenses keep
text at its resting contrast. Reduced motion draws one still frame; hidden pages draw nothing;
GPU denial, a second context loss or an overloaded lowest tier rest the room as Water. The pool
never influences scoring, tempo, scheduling, evidence, boxes or goals.

## Other kinds of exercise

- **Run-through.** The whole tune once with the band; nothing stops for a wrong note and the tempo
  holds. The result shows it bar by bar, the short bars come back in the next sessions, and the take
  is recorded so retained takes can be compared in Progress. Recording/saving/saved/failure states
  are distinct. Failed audio stays in memory with Retry and Save audio; keep the page open until
  rescued. A stopped microphone may produce a visible unsupported/failed outcome, not a saved take.
- **Rhythm on one note.** Select a phrase in Songs, then choose this exercise. Its existing note
  durations, rests, ties and order become a single comfortable pitch. The next card returns to the
  same phrase in context. This is pitched-attack timing, not muted-strum or expressive-rhythm grading.
- **Echo.** Seeded calls include duration variation, rests and repeated notes at higher tiers. The
  response remains at the player's own pace. A goal's BPM names the call tempo; success never
  claims the response was performed at that BPM.
- **Memory.** Existing section memory cards start with the page, move to the first note of each
  bar, then hide the notes. Each automatic fade follows a complete steady pass at the visit's
  target and starts a fresh pass/count-in. Chord symbols remain; pitch-revealing labels, links,
  automatic melody support and wrong-note overlays do not. Restore the page with its button or
  use the D♯5 hold/release/hold menu gesture, then D. Hear again remains an explicit option. A previously successful
  card due on a later day starts hidden only for the same known arrangement. Same-day rehearsal
  stays repeated exposure; restoring help stays visible/faded provenance for the whole visit.
  This is a later section review, not an independent retention or alternate-start transfer claim.
- **Comping.** A section's or cadence's voicings struck on 2 and 4, then the Charleston, with the
  bass. Every hit must be struck again.
- **Improvising.** Any notes over a section; the chord's notes are lit, a chord tone on one and
  three lands. Nothing is written, so there is no support melody and no part is taken out.
- **Fretboard.** A note name (and string), or a note shown and its 3rd asked for, or a chord's 3rd or
  7th; answered by playing, timed. A note on a given string counts in any octave (fret 1 or 13 is
  the same answer, and a low acoustic string is often heard an octave up); a 3rd must be above. Clean means right and quick enough for the box.

## The curriculum

Exercises live in a five-box card box per tune (`song/leitner.ts`). On top of that:

- **Stages.** A scale opens in steps: its notes, then the same notes on other grids (quarters,
  triplets, 16ths) and in patterns (thirds, triads, 7th arpeggios). A step joins the box once the
  one it builds on has reached box 2 (`Card.needs`).
- **Kinship** (`song/kin.ts`). A clean pass also counts for related scale exercises: the same
  scale in another pattern (0.34), the same seven notes from another tonic (0.5), one note apart
  on the same tonic (0.5) or a fifth away (0.25). A whole box of credit moves a relative up
  unplayed; credit on an exercise not yet met gives it a head start.
- **Shared scales.** Scale exercises belong to the player, not the tune: their boxes are kept
  under `guitar-skills` and every tune that asks for the scale sees them.
- **The map** (`song/tree.ts`, shown between sessions). The circle of fifths: each major key a
  hub, its relative minor inside it, skills growing out of each hub in the order they open, tunes
  on the rim by key. It is derived from the boxes; nothing extra is stored.

## Free play

The Tutor tile opens free play directly without a tune. It runs the same engine and guitar menu
as free play inside a session; tune-specific exercise suggestions appear only with a tune's deck.
It opens with a listening invitation and input control. Notation appears after three notes;
timing and best-tempo measures appear once measured. Enabling a steady click from the menu shows
its pulse before any notes are played. The shared pulse follows the heard click. The guitar menu
remains visible as a button, reports whether the band is playing,
waiting or off, and offers Leave on its first page when there is no matching exercise.

`song/freeplay.ts` (pure) and `song/useFreePlay.ts`. Whatever is played is written down; the key
(Krumhansl profiles, line turns weighted), the pattern (run, thirds, triads, 7ths) and the grid
are read off it. The click joins once the notes come evenly, a little under the player. Steady
playing on a bounded phase-aligned grid earns +4 bpm; constant early/late alignment is neutral.
At least six distinct contiguous attacks, enough coverage, low scatter and stable alignment across
readings are required. Accumulating late drift costs tempo; earlier drift cannot earn a rise;
notes falling apart send it away until the playing is steady again. What was
practised is logged (`guitar-freeplay`) and shows on the map; if the box holds an exercise for
exactly that scale and pattern, the menu offers it.

## Storage

`guitar-song-deck:<tune>` (box, history of attempts, sessions, settings, title and key),
`guitar-skills` (shared scale boxes and credit), `guitar-freeplay`, `guitar-output`,
`guitar-input`, `guitar-calibration`. Keep these keys stable.

Save failures remain visible. Failed progress writes stay in memory for retry and are included
in a backup exported from Song. Do not close the page before saving or exporting that progress.
Song's JSON backup excludes audio; Devices → Save file exports a full `.fretpack`, including
pending recoverable audio. New JSON exports and full transfers keep input/output/calibration and
latency local to each device; older JSON hardware settings are ignored on restore. New tune identities are independent of titles and
arrangements; existing identities and their history stay unchanged.

The overview reports measured note accuracy, clean scale tempo relative to its goal, timing and
historical task milestones. New goal evidence needs microphone-checked clean attempts of the same
arrangement since goal creation; timed targets need real timing samples. Support, notation,
tempo mode, exposure and interruption travel with new attempts/takes where known. Older evidence
remains unknown, and detector confidence is currently unknown. A suggested next BPM is not an achievement; the fastest clean tempo is
kept on the card even after detailed history is trimmed. Whole-tune, section, memory and run-through
milestones are independent of how many technique variants the deck contains.

Practice, Free play, Tools, the Ear quiz and Devices reserve one writer window per browser origin.
An explicit handoff unmounts listening hooks and waits for pending saves before another window
starts. If those writes fail, ownership stays with their recovery window. JSON restore also needs
an idle writer lock. Browsers without Web Locks keep score browsing but cannot start these
protected operations. Installed/mobile behavior needs the physical checks in
[SUPPORTED_SETUPS.md](SUPPORTED_SETUPS.md).

## Not there yet

- Free play recognises a strummed loop and offers its voicings card, but does not log it yet.
- Which string a note was played on is inferred from the position the hand is in, not heard.
- Kinship covers scale exercises; arpeggio, guide-tone and voicing cards do not share progress.
- The map is read-only: it shows what is there, it does not yet choose what comes next.

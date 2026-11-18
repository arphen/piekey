# The practice session

How the full-screen session in the Tunes view (`src/song/`, `src/components/SongCoach.tsx`) is
meant to behave, and why. The rule behind all of it: the app reacts to what the player does; it
does not tell them what to do.

## The guitar is the controller

| Gesture | Where | Does |
| --- | --- | --- |
| A note held ~0.4 s (shown on screen next to what it works) | exercises | hear it again · your pace · in time · next exercise |
| The same, by note name in any octave | before and after a session | carry on · free play · settings · other tune · shuffle |
| Open low E held 1.3 s | exercises, free play | the six-string menu (tempo, click, sound output, …) |
| A free note tapped twice | exercises, open drawer | gear, calibration, the drawer's switches |
| F (any octave) held | ready screen | session length: 10 / 25 / 45 minutes |

Note keys (`song/notekeys.ts`) have home notes outside what exercises play (E5; F2, G2, G♯2). A
card that sounds a key's home note, itself or through its band, gets the nearest free note
instead, and the key's notes are never heard as part of the exercise. In free play and while
improvising every note is music, so only the low-E menu works there.
The menu waits for the opening note to stop or change before accepting a fresh string hold
(0.6 s), so the low E that summoned it cannot immediately close it. A quiet scrim separates the
menu from the music; its rows remain reachable on phone screens.

## The session's shape

The ready screen plans a session of the chosen length (`song/planner.ts`): a scale the hands know,
then a focus, then what the box says is due, then a melody of the tune. The focus is the mistake the
player's history shows most (`song/profile.ts`), kept for up to ten days and dropped once it has
halved; without one, the last run-through's short bars or a skill left alone for a week. It is
named as one fact ("Leaps · 41 % missed"), never as advice. Struggling lately brings no new cards;
cruising brings more.

The opening three exercises are visible before starting. Input status and connection/reconnect
actions sit beside the held-note start gesture; the option notes are shown separately. During a
session the phase and exercise number stay visible. The displayed note actions and low-E menu
also work as buttons.

All blocks, including focus work, fit the selected estimated budget; a melody is reserved for
the ending when one fits. The estimate is not a countdown: retries and time spent on a passage
can extend it. If nothing fits, the ready screen offers a longer length or free play. Mixed-tune
attempts are ordered by timestamp (day/order for older data) before adapting the new-card count.
From Tutor or a focused mode, choosing an exercise opens that exact card on the ready screen.

## One exercise

`intro → (listen) → your pace → in time → result`, by itself (`song/useSession.ts`).

- **Your pace.** The cursor waits for each note. Going back is followed, not punished. A take
  starts on a fresh attack, so a string still ringing is not its first note. A take is clean when
  the notes landed first time, forgiving the first and last note and one stray mark in twelve
  (`song/judge.ts`): detection is least reliable at the edges of a phrase.
- **In time.** If the player came in with a steady tempo of their own, the click starts ~12 % under
  it, so they settle down onto it. Only clean passes raise it; two short passes lower it; two
  passes of mostly wrong notes send the band away until a take at the player's own pace is clean
  again. The tempo moves while the band plays. The first note may come early, the last may land
  late, and a finished pass keeps its colours for a moment.
  Untied repeated notes need separate attacks; ties remain a single target. Scale, melody and
  comping passes must also establish steady timing before the tempo rises. Rushing does not earn
  a larger tempo increase. Held voicings and improvisation keep their own acceptance rules.
- **Gaps.** Once an exercise is well known (box 4) the band drops out for two bars in four (four in
  eight in the top box) while it plays in time; the notes are still judged, so the time is the
  player's. During a focus on time every focus card plays this way.
- **Timing.** After each pass in time a strip shows every note against its beat and how scattered
  they were (ms). Calibration's play-along measures the input's lag so the strip means the player.
  Tuning/noise calibration belongs to the opened input and sample rate; measured lag also belongs
  to the selected output. Changing that setup makes lag a guess until measured again. A suspended
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
- **Visible beat.** The pulse follows the beat being heard from the audio output clock, including
  count-in. It rests with paused/stopped audio and gap practice; no separate animation clock
  supplies time to the player.

## The practice room

The session and free play share a decorative water/leaf texture and quiet current lines
(`PracticeAtmosphere`). Input loudness gives them a small, smoothed movement; sustained active
playing and the existing flow measure gradually reveal colour. Waiting, listening to a demo,
or leaving a menu open does not earn warmth. The decoration performs no extra pitch analysis
and has no effect on scoring or tempo. Reduced motion removes drift and beat ripples while
keeping the current beat marker and readable state.

## Other kinds of exercise

- **Run-through.** The whole tune once with the band; nothing stops for a wrong note and the tempo
  holds. The result shows it bar by bar, the short bars come back in the next sessions, and the take
  is recorded so the first and latest can be heard from the overview.
- **Comping.** A section's or cadence's voicings struck on 2 and 4, then the Charleston, with the
  bass. Every hit must be struck again.
- **Improvising.** Any notes over a section; the chord's notes are lit, a chord tone on one and
  three lands. Nothing is written, so there is no support melody and no part is taken out.
- **Fretboard.** A note name (and string), or a note shown and its 3rd asked for, or a chord's 3rd or
  7th; answered by playing, timed. Clean means right and quick enough for the box.

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

The Tutor tile opens free play directly without a tune. It runs the same engine and low-E menu
as free play inside a session; tune-specific exercise suggestions appear only with a tune's deck.
It opens with a listening invitation and input control. Notation appears after three notes;
timing and best-tempo measures appear once measured. Enabling a steady click from the menu shows
its pulse before any notes are played. The shared pulse follows the heard click. The low-E menu
remains visible as a button, reports whether the band is playing,
waiting or off, and offers Leave on its first page when there is no matching exercise.

`song/freeplay.ts` (pure) and `song/useFreePlay.ts`. Whatever is played is written down; the key
(Krumhansl profiles, line turns weighted), the pattern (run, thirds, triads, 7ths) and the grid
are read off it. The click joins once the notes come evenly, a little under the player. Clean
playing on the grid earns +4 bpm; being behind it three readings in a row costs 4; being ahead
never speeds it up; notes falling apart send it away until the playing is steady again. What was
practised is logged (`guitar-freeplay`) and shows on the map; if the box holds an exercise for
exactly that scale and pattern, the menu offers it.

## Storage

`guitar-song-deck:<tune>` (box, history of attempts, sessions, settings, title and key),
`guitar-skills` (shared scale boxes and credit), `guitar-freeplay`, `guitar-output`,
`guitar-input`, `guitar-calibration`. Keep these keys stable.

Save failures remain visible. Failed progress writes stay in memory for retry and are included
in a backup exported from Song. Do not close the page before saving or exporting that progress.
Audio takes are excluded from the backup. New tune identities are independent of titles and
arrangements; existing identities and their history stay unchanged.

The overview reports measured note accuracy, clean scale tempo relative to its goal, timing and
performance milestones. A suggested next BPM is not an achievement; the fastest clean tempo is
kept on the card even after detailed history is trimmed. Whole-tune, section, memory and run-through
milestones are independent of how many technique variants the deck contains.

## Not there yet

- Free play recognises a strummed loop and offers its voicings card, but does not log it yet.
- Which string a note was played on is inferred from the position the hand is in, not heard.
- Kinship covers scale exercises; arpeggio, guide-tone and voicing cards do not share progress.
- The map is read-only: it shows what is there, it does not yet choose what comes next.

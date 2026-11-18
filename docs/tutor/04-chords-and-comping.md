# 04 · Chords and comping

Part of [the tutor plans](README.md). Related: T18, T19 (free play chord recognition).

## Why

A guitarist in a jazz setting spends most of a tune comping, not soloing. Chord work also builds the
fretboard knowledge that makes lines over changes possible: an arpeggio is a voicing played one note
at a time. The app teaches lines over changes well and chords barely: voicing cards exist, but the
app cannot hear a chord, so it cannot judge changes, comping, or a player strumming in free play.

## What exists

- `chords` family with `voicings` kind; guide-tone and chain cards in `harmony`.
- `listen/spectrum.ts`: `detectNotes` (FFT peaks → notes) and `strongPitchClasses` (the pitch
  classes sounding within a dB range). This is a usable chord-recognition front end.
- MusicXML chord symbols and an optional chords part with voicings (`tunes/musicxml.ts`).
- `usePlayback` has chord scoring (per CURRENT_STATE, unverified at runtime).
- Fingering window ≤ fret 10 by default.

## Design

### 1. Chord recognition you can trust

A pure matcher, `listen/chordMatch.ts`: given heard pitch classes (with strengths) and a target chord
symbol, return `{ match: boolean, missing: pc[], extra: pc[], confidence }`.

- Judge against the **target**, not open-ended recognition. Asking "is this Dm7?" is far more
  reliable than "what chord is this?".
- Required tones: 3rd and 7th (guide tones) must be present; root optional (shells and rootless
  voicings are normal in jazz); 5th always optional. Extensions allowed if they are chord tones of
  the symbol.
- Strummed acoustic chords decay fast; read the spectrum in a window ~60–250 ms after the onset.

**Accuracy check before it judges anything.** A small fixture set: recordings (or synthesised plucked
voicings via `audio/pluck.ts` as a first pass) of common shapes, scored for precision/recall. Write
the result in CURRENT_STATE. If real-guitar accuracy on shells is under ~90 %, chord cards treat a
mismatch as "not heard" (no penalty, try again) rather than wrong.

### 2. Voicing ladder

One shared ladder per chord quality (like shared scale cards under `guitar-skills`), not per tune:

1. **Shells** (root–3–7, root–7–3) on strings 6/5 roots — the jazz guitarist's core.
2. **Shell + one** (add the 5th or 9th/13th on top).
3. **Drop-2 on the middle four strings**, ≤ fret 10.
4. **Drop-2 on the top four strings.**
5. **Rootless / upper-structure** (opt-in, later).

Each step is a card per quality (maj7, m7, 7, m7♭5, dim7, 7alt later) in the position the tune uses.
Kinship: a clean shell for G7 credits G7's drop-2 a little. Shapes shown on the neck (`Fretboard`)
and in notation.

### 3. Chord-change drills

The classic "one-minute changes", made hands-off:

- A card is a **pair or short chain** of chords from the player's tunes (ii–V, V–I, ii–V–I, the
  tune's own turnarounds) in one position.
- **Your pace:** play chord A, then B; each is judged when it rings; the score shows the next shape.
- **In time:** the click and bass play; one strum per bar, then per two beats, then on 2 and 4.
  Measure **change time**: delay from the barline to a matching chord.
- Tempo rises on clean passes as for every other card. Change time goes into evidence (`time` axis,
  `chords` axis).
- Voice leading shown: common tones highlighted between shapes (the T18 complaint about jarring
  switches is answered by *showing* the short path).

### 4. Comping cards

Comp through a tune section with the band (bass + drums, no keys) using the tune's symbols:

- Rhythm patterns from [03](03-time-and-rhythm.md): four-to-the-bar, 2 and 4, Charleston, bossa.
- Judged on: right chord when struck (matcher), on the rhythm pattern (onsets).
- Levels: shells on whole notes → shells in rhythm → drop-2 in rhythm → free rhythm (only chord
  correctness and time are judged).
- The tune's melody can play on top (`guide`), so comping is heard in context.

### 5. Free play hears chords (T19)

With the matcher, free play can recognise a strummed progression:

- Segment by strong onsets; match each segment against the 24 triads and the common 7th qualities;
  keep the best match above a confidence floor.
- A repeated sequence of 2–4 chords becomes a **progression**; map it to Roman numerals in the
  estimated key.
- If the deck has a changes card for that progression (or a tune contains it), the low-E menu offers
  it, as it does for scales today. The free-play log records progressions and the map shows them.

### 6. Arpeggio ↔ voicing link

The same chord appears as an arpeggio card (`harmony`) and a voicing card (`chords`). A card variant
plays the voicing, then its arpeggio in the same shape. Kinship credit both ways through the `chords`
axis in [01](01-student-model.md).

## Phases

1. **Matcher + accuracy check.** Pure matcher and tests; fixture accuracy reported. *Check:* tests on
   synthetic pitch-class sets; then real guitar on 10 shell shapes, results written down.
2. **Change drills.** Pair/chain cards from the tunes' progressions, your pace and in time, change
   time in evidence. Voicing ladder steps 1–2.
3. **Comping.** Comp cards with rhythm patterns; ladder steps 3–4.
4. **Free play chords.** Progression detection and routing (closes T19's main gap).

## Tests

Matcher (required tones, rootless, extensions, extras), progression detection on segment lists,
ladder generation within the fret window, card generation from a tune's symbols. Pure.

## Risks

- **Acoustic chord detection is hard**: strong low strings mask upper partials; open strings ring
  under the next chord. Judge against targets, read the right time window, and fail soft until the
  accuracy check says otherwise.
- **Too many cards**: ladder steps are shared per quality, not per tune or key; positions follow the
  tune's window.

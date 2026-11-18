# Plan: Autumn Leaves Practice Tutor

> **Historical (superseded).** This is the original roadmap for the hardcoded Autumn Leaves tutor.
> That tutor (`src/tutor/`, the Practice tab, Fretboard Lab) has been removed; the product is now
> the MusicXML-driven tutor shell. Use it for intent and musical constraints only. For what exists
> read [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md), and for what is next
> [docs/BACKLOG.md](docs/BACKLOG.md). File paths below may no longer exist.

Goal: turn the existing Fretboard Focus Lab into a personal practice tutor. The student learns
scale/arpeggio patterns over a real tune (Autumn Leaves in A minor) instead of cycling through keys,
gets a prescribed 20–30 min daily session, and practices against a metronome and a generated backing track.

## Student profile (drives all defaults)

- Knows: major scale in several positions, mode names. Not yet: arpeggios over changes, swing/comping.
- Current routine per scale: full scale → scale in 3rds → diatonic triads → diatonic 7th arpeggios.
- Fingering approach: **one position at a time** (stay in a 4–5 fret window, connect all chords there).
- Scale approach: **key-center first** (few parent scales, learn where they switch), mode names secondary.
- Harmony: **plain diatonic changes first**, jazz variations unlocked later.
- Session: **20–30 min, prescribed** ("do X, Y, Z now"), tempo creeps up as exercises get marked clean.

## Musical content (source of truth — put in `src/tunes/autumnLeaves.ts`)

Real Book form AABC, 32 bars, 4/4, transposed to A minor.

| Section | Bars | Level 1 (plain) |
|---|---|---|
| A1 | 1–8 | Dm7 \| G7 \| Cmaj7 \| Fmaj7 \| Bm7b5 \| E7 \| Am \| Am |
| A2 | 9–16 | same as A1 |
| B | 17–24 | Bm7b5 \| E7 \| Am \| Am \| Dm7 \| G7 \| Cmaj7 \| Fmaj7 |
| C | 25–32 | Bm7b5 \| E7 \| Am \| Am \| Fmaj7 \| Bm7b5 E7 \| Am \| Am |

Level 2 (unlock) replaces C bars 27–28 with `Am7 D7 | Gm7 C7` and adds E7 → E7alt option.

Parent-scale mapping (key-center first):

| Chord | Parent scale | Mode name (secondary) | Chord tones | Guide tones (3, 7) |
|---|---|---|---|---|
| Dm7 | C major / A nat. minor | D dorian | D F A C | F, C |
| G7 | C major / A nat. minor | G mixolydian | G B D F | B, F |
| Cmaj7 | C major / A nat. minor | C ionian | C E G B | E, B |
| Fmaj7 | C major / A nat. minor | F lydian | F A C E | A, E |
| Bm7b5 | A harmonic minor | B locrian ♮6 | B D F A | D, A |
| E7 | A harmonic minor | E phrygian dominant | E G# B D | G#, D |
| Am / Am7 | A natural minor | A aeolian | A C E (G) | C, G |
| L2: Am7 D7 | G major | A dorian / D mixo | | |
| L2: Gm7 C7 | F major | G dorian / C mixo | | |

**Core lesson to visualize:** the only difference between the two parent scales is **G vs G#**.
Whenever the parent scale changes, highlight the changed note(s) on the fretboard.

Positions (one-position system), in curriculum order: V (frets 5–8), VII–VIII, II–III, IX–X, XII.
Each position = 4–5 fret window, show only notes inside the window, gray out the rest.

## Architecture

Read the existing code first (`src/musicTheory.ts`, `src/App.tsx`, `src/chordDetection.ts`,
`src/pitchDetection.ts`). Reuse scale/chord/fretboard logic; don't rewrite it. `App.tsx` is ~900 lines —
extract the fretboard into `src/components/Fretboard.tsx` with props roughly:

```ts
type FretboardProps = {
  notes: { pc: number; role: 'root' | 'chordTone' | 'guideTone' | 'scale' | 'changed' | 'outside' }[];
  window?: { from: number; to: number };   // position window; outside notes dimmed
  sequence?: { string: number; fret: number }[]; // numbered path for patterns (phase 4)
  activeIndex?: number;                      // currently sounding note in sequence
  labels: 'names' | 'degrees';
  compact?: boolean;                         // mini diagram for the chord grid
};
```

New modules:
- `src/tunes/types.ts` — `Tune { title; key; form: Section[] }`, `Section { name; bars: Bar[] }`,
  `Bar { chords: { symbol; beats; parentScale; modeName; level }[] }`.
- `src/tunes/autumnLeaves.ts` — data from the tables above.
- `src/patterns.ts` — generate note sequences for a scale within a position window:
  scale up/down, 3rds, diatonic triads, diatonic 7ths, each starting from the chord root nearest the
  window's low end. Output `{string, fret, pc}[]` so the fretboard can number/animate them.
- `src/audio/transport.ts` — single clock (Tone.js `Transport`) shared by metronome, backing, cursor.
- `src/audio/backing.ts` — generate MIDI-style events per bar: walking bass (root beat 1, chord tones,
  chromatic approach into next root on beat 4), shell-voicing comp (3+7) on swung offbeats, ride
  + hi-hat on 2 & 4. Play via sampled instruments (`smplr` or `soundfont-player`; fall back to Tone
  synths). Optional: export as `.mid` (`@tonejs/midi`).
- `src/tutor/` — curriculum, session generator, progress store (localStorage).

Add libs as needed (Tone.js, smplr, @tonejs/midi). Keep `npm run build:quiet` and `npm run typecheck` green.

## Phases

### Phase 1 — first deliverable (ship fast, no audio)

The student wants to start practicing while the rest is built.

- New "Tune" view (default tab), keep existing tools reachable in another tab.
- 32-bar lead sheet grid, 4 bars per row, section labels A/A/B/C.
- Each bar cell shows: chord symbol, parent scale name (e.g. "A harm. minor"), mode name small,
  and a **compact mini-fretboard** of the parent scale in the selected position with chord tones colored.
- Color-code cells by parent scale (C major/A minor vs A harmonic minor) so the key switch is visible
  at a glance across the whole form.
- Click a bar → large fretboard below: parent scale in position window, root / chord tones /
  guide tones / changed note (G#) distinct. Also show the *next* chord's guide tones faintly so the
  student sees the voice-leading target.
- Position selector (V, VII, II, IX, XII). Label toggle names/degrees.
- Acceptance: open app, see whole Autumn Leaves in Am, every chord has a scale and a diagram, G vs G#
  switch obvious, works on a laptop screen without scrolling the grid horizontally.

### Phase 2 — metronome + playback cursor
- Tempo (40–200), count-in, accent on 1, click on 2 & 4 option (jazz feel), swing amount.
- Play/stop/loop a bar range (e.g. bars 1–8 or single 2-bar ii-V). Current bar highlighted, large
  fretboard follows the cursor. Keyboard: space = play/stop.

### Phase 3 — backing track
- Bass + comp + drums from `backing.ts`, per-instrument volume/mute, same transport as metronome.
- Loop selected bars; "chord only" mode (sustained pads) for slow practice.

### Phase 4 — pattern visualization
- Pattern picker: scale, 3rds, triads, 7ths (the student's routine), plus later "guide-tone line"
  and "arpeggio chain" (continuous 8ths, move to the nearest chord tone of the next chord at the barline).
- Fretboard shows numbered path; during playback the active note animates in time (8ths at tempo).
- Optional tab/notation strip of the pattern below the fretboard.

### Phase 5 — tutor / session generator
- Curriculum = ordered units: (position × section × pattern). Start: position V, bars 1–8, scale.
- Daily session (~25 min), presented as a checklist with timers:
  1. Warm-up 5 min — parent scales in position, G↔G# switch, metronome only.
  2. Pattern block 10 min — current pattern over current section with backing loop.
  3. Connection 5 min — guide-tone line / arpeggio chain through the section.
  4. Free play 5 min — improvise over full form using that position.
- Per exercise: "clean" / "sloppy" buttons. Clean ×2 → +4 bpm next time; target tempo reached →
  next pattern; all patterns done → next section; all sections → next position; later Level 2 changes.
- Short "why" text per exercise (e.g. "E7 brings G# — leading tone back to A").
- Progress stored in localStorage; streak + history list.

### Phase 6 — extensions (later)
- Level 2 harmony (chromatic ii-Vs, E7alt), more positions, mode-centric toggle.
- More tunes via the same `Tune` format (e.g. Blue Bossa, All the Things You Are).
- Reuse existing mic chord/pitch detection to auto-check "did you hit the guide tone on beat 1".

## Working notes for the implementing agent
- Ship Phase 1 alone first and stop for review; each later phase is a separate step.
- Verify music data with unit-level checks (e.g. every chord tone is in its parent scale; G# only in
  harmonic minor bars) — add vitest with `--reporter=dot` if adding tests.
- Follow `AGENTS.md`: quiet builds, no dumping build output.

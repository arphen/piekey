# 01 · Student model

Part of [the tutor plans](README.md). Related: T3 (stats), T17 (exercises influence each other).

## Why

A Leitner box answers "when should this card come back?". It cannot answer "what is this player bad
at?". Two failed cards can fail for unrelated reasons: one because the hand is late on string
crossings, the other because B♭ is always played as B. A teacher fixes the cause once; the box makes
the player fail both cards until each is drilled separately.

The model's job: turn every take into **evidence about skills**, and keep a **profile** that the
planner (02) and the session can act on.

## What exists

- `Attempt` (`song/leitner.ts`): card id, day, result, tempo, `share` of notes landed, seconds, box
  before and after. Capped at 800 per store.
- `CardState`: box, due, next tempo, seen, clean, last result.
- `song/estimator.ts`: in-session running hit rate, streak, steadiness. Not persisted.
- `song/kin.ts`: credit between related *scale* cards.
- The follower and `tunes/usePlayback.ts` already know, per written note, whether it landed, what was
  heard instead, and (in time) when it came.

So the raw facts exist during a take and are thrown away at its end.

## Design

### Evidence: what one take leaves behind

Extend `Attempt` with an optional, compact `ev` field. Optional so old history still reads.

```ts
interface Evidence {
  // pitch
  wrong: Array<[written: number, heard: number]>; // midi pairs, first try only, capped ~16
  missedPcs: number[];        // pitch classes written but not landed (counts by index 0..11)
  // time (in-time passes only; see 03)
  offsetMs: [mean: number, spread: number] | null; // signed, + = late
  rush: number;               // share of notes > 60 ms early
  drag: number;               // share of notes > 60 ms late
  // shape
  crossMiss: number;          // share of string-crossing notes missed (inferred strings, see T22)
  leapMiss: number;           // share of notes after a leap ≥ a fourth missed
  posShift: number;           // misses within 2 notes of a position shift
  restarts: number;           // takes started over (your pace)
  hearUsed: number;           // times "hear it again" was asked
  helpSeen: Array<"page" | "neck" | "guide">; // adaptive help that came on
}
```

All of it is computed from data the take already has. Strings are *inferred* from the fingering
(`song/fingering.ts`); the field names say "cross" and "shift", not "string", so nothing claims more
than the signal gives.

### Mistake classes

Derived, never stored. A small pure module, `song/profile.ts`, reads history across stores and names
the patterns a teacher would name:

| Class | Signal | Example reading |
| --- | --- | --- |
| Accidental slip | `wrong` pairs one semitone apart, same written pc repeatedly | "B♭ → B in 7 of 9 takes" |
| Key-centre confusion | wrong notes that belong to the *previous* chord's scale | lands on F♯ over Dm7 after a D7 |
| Leaps | `leapMiss` ≫ overall miss rate | |
| String crossing | `crossMiss` ≫ overall miss rate | |
| Position shifts | `posShift` high | |
| Rushing / dragging | `rush`/`drag` and signed `offsetMs` mean | "28 ms ahead, rushing on runs" |
| Tempo wall | clean below X bpm, collapses above, over ≥ 3 sessions | "clean to 112, falls apart at 120" |
| Memory | fails with `memory` cards or hidden bars, clean with the page | |
| Ear | echo cards fail where the same notes read from the page pass | |

Each class has a strength (0–1) and an evidence count; under five takes of evidence a class is not
reported.

### The skill profile

One derived object per player, built from every `guitar-song-deck:*` store plus `guitar-skills` and
`guitar-freeplay`:

```ts
interface SkillProfile {
  axes: Record<Axis, { level: number; trend: number; n: number }>;
  // Axis: "pitch" | "time" | "tempo" | "reading" | "memory" | "ear" | "chords" | "fretboard" | "improv"
  weaknesses: Array<{ cls: MistakeClass; strength: number; n: number; cards: string[] }>;
  ceilings: Record<string, { cleanBpm: number; failBpm: number }>; // per scale/pattern topic
  lastPlayed: Record<Axis, string>; // day, for neglect
}
```

- **level** is a smoothed share (exponential decay over sessions, half-life ~7 sessions) of clean
  results on cards tagged with that axis. Cards get axis tags from family/kind, plus `time` for every
  in-time pass and `memory` for memory cards.
- **trend** is the slope of level over the last four weeks. This feeds the progress view (07).
- Nothing new is stored for the profile: it is recomputed on demand. History caps (800 attempts per
  store) are the only retention; evidence fields keep attempts small enough that the cap still spans
  months.

### Mastery beyond boxes

Keep the box as the scheduling truth (it is stable and the player understands it). Add one derived
number per card, `mastery = f(box, last 5 shares, tempo / goalBpm)`, so the planner can tell
"box 3 and solid" from "box 3 and hanging on". Do not replace Leitner with a new algorithm; tune its
inputs instead.

### Where the session uses it

- **Targeted variations.** If a card's top weakness is "leaps", the next visit's variation (`vary`,
  `song/spot.ts`) picks the bars with the leaps. The spot mechanism already shortens cards to trouble
  bars; this gives it a reason.
- **Adaptive help.** Help that came on (`helpSeen`) is evidence: a card passed only with the page
  showing is not yet a memory pass.
- **Kinship beyond scales (T17).** Evidence by axis lets a clean arpeggio pass credit the same
  chord's guide-tone card a little, through the shared `chords`/`pitch` axes, without new
  hand-written relations.

## Phases

1. **Evidence.** Add `Evidence` to `Attempt`, filled by `useSession` at the end of each take from the
   follower and playback scoring. Read-compatible with old stores. *Check:* unit test that a take with
   scripted wrong notes yields the right `wrong` pairs and `offsetMs`; play three cards with the
   synthetic player in the session harness and inspect the stored history.
2. **Profile.** `song/profile.ts` (pure) with mistake classes and axes; tests over fixture histories
   (a player who rushes, one who misses leaps, one with a tempo wall). Show the top weakness as one
   line on the ready screen: "Leaps · 41 % missed" — a fact, not advice.
3. **Act on it.** Targeted variations and the planner's focus (02). Kinship over axes.

## Tests

Focused on the pure parts: evidence extraction from a scripted take, each mistake class from a
fixture history, decay/trend math, old-store compatibility. No render tests.

## Risks

- **Detection noise looks like weakness.** A detector miss on the low E is not a player miss. Weight
  evidence by calibration confidence where `listen/calibration.ts` has it, and require five takes
  before naming a class.
- **History caps.** 800 attempts per tune store. If evidence makes attempts much larger, check the
  `localStorage` budget against the large-library risk in CURRENT_STATE.
- **Over-reporting.** One line, one weakness, only when it is strong. The profile is for the planner;
  the player sees little of it.

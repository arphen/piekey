# 02 · Session planner

Part of [the tutor plans](README.md). Depends on [01](01-student-model.md). Related: T17, T19.

## Why

`planSession` today picks due cards, a few new cards and a scale warm-up. That keeps the box healthy,
but it is not a lesson. A good lesson has a shape:

1. **Warm-up** — the hands, not the head. Easy, physical, at a comfortable tempo.
2. **Focus** — one thing, worked properly, near the edge of ability. This is where improvement comes
   from, and it is the part most self-taught players skip.
3. **Mixed review** — interleaved old material. Mixing feels harder than blocking and teaches more.
4. **Music** — a tune or improvisation. The reason for the rest.
5. **Stop** — before fatigue makes the last ten minutes practise mistakes.

Across days a teacher also keeps an **arc**: the same focus for a week, not a new one every session,
then a check that it moved.

## What exists

- `planSession(deck, store, day, exclude, newCount)` returns card ids.
- Multi-tune mixing (`mixDecks`, guest decks), shuffle, `newPerSession`.
- The overview's `pickGlobalUnits` picks three exercises: current song, overdue review elsewhere,
  a different family.
- Active-time clock in `useSession`; idle and away states.

## Design

### Time budget

The ready screen asks one question, answerable from the guitar: **how long?** Three held-note
choices shown as note tags — short (~10 min), normal (~25), long (~45) — defaulting to the last
choice. No form. Card durations are estimated from history (`Attempt.secs`, median per kind), so the
planner fills minutes, not card counts.

### Blocks

The planner returns blocks instead of a flat list:

```ts
interface PlannedBlock {
  role: "warmup" | "focus" | "review" | "music" | "cooldown";
  cards: string[];
  minutes: number; // estimate
  why: string;     // one fact, for the ready screen: "Leaps · 41 % missed"
}
```

Default split for 25 minutes: warm-up 3 · focus 10 · review 7 · music 5. Short sessions drop review
first, then music; focus is never dropped. The session does not announce blocks; the result screen
between cards shows a thin progress line with block marks, ambient only.

### Choosing the focus

From the profile (01), in order:

1. A **current arc** (focus chosen in the last 7 days and not yet resolved) continues.
2. Otherwise the strongest **weakness** with enough evidence.
3. Otherwise the most **neglected axis** (longest since played) that the player's tunes need.
4. Otherwise the **next stage** on the current tune's path (07).

The focus block fills with cards that exercise it: the weak cards themselves, spot-shortened
variations of them (`song/spot.ts`), and relatives through kinship. An arc resolves when the
weakness strength falls under half its starting value, or after 10 sessions (then it rests a week —
grinding the same thing forever is its own failure).

### Desirable difficulty

Target a **success zone of roughly 70–85 %** clean in the focus block:

- Measured over the block's last few takes. Above it: raise tempo faster (already done per card),
  hide help sooner, pick the harder variation. Below it: lower tempo, bring the page back, shorten to
  a spot.
- Review is allowed to be easier (85–95 %): it is retrieval, not stretch.
- This replaces the fixed `newPerSession`: new cards come in when the zone allows it, none when the
  player is struggling. The setting stays as an upper bound.

### Interleaving

Review interleaves families and tunes by default (shuffle already exists). The focus block stays
blocked for the first few takes (learning needs repetition) and interleaves once the zone is reached.

### Warm-up and cool-down

- Warm-up: a scale or chromatic card in the player's current position at 70 % of its known clean
  tempo, plus one chord-change card once [04](04-chords-and-comping.md) exists. Never a new card.
- Cool-down (long sessions): free play or the music block's tune at an easy tempo. Long sessions also
  get a rest beat after ~25 active minutes: the interlude plays, the session waits for a note. No
  message about breaks; the music is the break.

### Fatigue

If the share across the last five cards drops sharply against the session's own start (not against
history), the planner shortens: skips remaining review, goes to the music block. The player never
sees "you're tired", just a session that ends on something they can play.

## Phases

1. **Time budget and blocks.** Replace the flat plan with blocks (warm-up, due/new as review, music);
   duration estimates from history; ready-screen note tags for length. *Check:* pure tests that a
   10/25/45-minute plan fits within ±20 %, never drops focus, and never puts a new card in warm-up.
2. **Focus from the profile.** Needs 01 phase 2. Arcs stored as one small record per player
   (new key `guitar-arc`: focus class, start day, starting strength). *Check:* fixture profiles produce
   the expected focus; an arc resolves.
3. **Success zone.** Zone-driven tempo/help/new-card decisions in `useSession`. *Check:* scripted
   take sequences move the zone the right way; then a real-guitar session to tune the thresholds.
4. **Overview.** The Tutor overview shows today's plan as blocks with the focus line, replacing the
   three-unit queue when a plan exists. Unit deep links into `SongCoach` (open item in CURRENT_STATE).

## Tests

Plan shape and budget fitting, focus choice from fixtures, arc lifecycle, zone transitions. All pure.

## Risks

- **Opaque choices feel arbitrary.** The one-line `why` on the ready screen is the fix: always a fact.
- **Overfitting to noise.** Arcs need evidence thresholds (01). A bad mic day must not start an arc.
- **Breaking what works.** Keep `planSession` as the review block's engine; blocks wrap it.

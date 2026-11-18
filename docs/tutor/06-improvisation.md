# 06 · Improvisation

Part of [the tutor plans](README.md). Depends on [03](03-time-and-rhythm.md) and
[04](04-chords-and-comping.md) for measurement.

## Why

Scales, arpeggios and guide tones exist to make up music over changes. Without practice at
inventing, they stay exercises. Improvisation is also where the player's motivation lives. It can be
taught step by step, with constraints that make it achievable and measures that are honest about
what can be judged: **there is no wrong solo, but there are chord tones on strong beats, steady time,
space, and repetition**.

## What exists

- Free play: notes written down, key/pattern/grid read, click and band that follow.
- Harmony cards: arpeggios, guide tones, chains over a tune's changes.
- Echo cards: the app plays a phrase, the player plays it back.
- Backing band and vamps in free play.

Nothing yet asks the player to invent, or reflects on what they invented.

## Design

Improvisation cards are a new family, `improv`. They run with the band over a vamp or a tune section
and have no "right notes". The session reacts as everywhere else: the room warms when the measures
are good, and the result screen shows a few facts. Because every note is music, only the guitar menu
works during them (same rule as free play).

### What is measured

From the notes already detected and the chord under each one:

| Measure | Meaning |
| --- | --- |
| **Landing** | share of strong-beat notes (1 and 3, or chord changes) that are chord tones of the chord sounding |
| **Guide-tone landing** | share of chord changes where the first note is the new chord's 3rd or 7th |
| **Time** | offset spread (03) |
| **Space** | share of bars with a rest of at least a beat |
| **Range** | lowest to highest note used, in the position |
| **Motif** | how often a rhythmic or interval cell from earlier comes back (n-gram repeats) |

The room's warmth follows landing and time. The result screen shows them as numbers and a small
bar-by-bar strip: landed changes lit, missed ones dim. No grades, no words.

### Card kinds, as a ladder of constraints

Constraints are what make improvising learnable; each step removes one.

1. **Answer the phrase.** The band plays a two-bar call (from echo cards), then leaves two bars for an
   answer. Any answer counts; landing and time are measured. This is call-and-response, the oldest
   way to learn to improvise, and it reuses T23's machinery.
2. **Three notes only.** Improvise over a ii–V–I vamp using only the 3rd, 5th and 7th of each chord
   (shown on the neck). Teaches hearing the changes.
3. **Guide-tone lines.** Improvise, but land on a guide tone at each change; the next target is shown
   one beat ahead, as a glow on the neck, not as text.
4. **One rhythm.** A fixed rhythm cell (e.g. Charleston); choose any notes.
5. **Motif.** Play a short idea in bar 1; vary it in bars 2–4. The motif measure lights when the idea
   comes back.
6. **Over the tune.** Improvise a chorus over a section of the player's tune with the band. Measures
   as above, plus the section's hard spots (the bars where landing is lowest) feed back into the
   planner as harmony cards for those bars.

Each kind is a Leitner card per tune section or vamp; "clean" means landing and time over a threshold
that rises with the box. Tempo follows the usual rules.

### Trading

A late addition that turns practice into play: the app "trades fours" with the player. It plays four
bars built from the tune's scales and chord tones (seeded), then the player plays four. The app's
next four can echo a cell from the player's last four, so the conversation is real.

## Phases

1. **Measures + answer-the-phrase + three-notes-only.** Pure measurement module over notes and
   chords (`song/improv.ts`), two card kinds. *Check:* tests on scripted note streams (all chord
   tones on beats → landing 1.0; scale runs ignoring changes → low); real guitar to calibrate
   thresholds.
2. **Guide-tone targets, one rhythm, motif.**
3. **Over the tune; hard spots to the planner.**
4. **Trading fours.**

## Tests

Measurement math on scripted streams (landing, guide-tone landing, space, motif repeats); card
generation from tune sections. Pure.

## Risks

- **Judging taste.** Only measure what is structural (chord tones on strong beats, time, space,
  repetition). Never call an "outside" note wrong; landing is a share, not a pass/fail per note.
- **Detection of fast lines.** Fast runs lose notes; weight strong-beat notes, which are usually
  longer and better detected.

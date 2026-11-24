// How much of the original to play under the player, note by note.
//
// The melody is a shadow: silent while the player has it, fading in where they struggle and
// easing off again as the notes start to land. Each note keeps a running tally of hits and
// misses in which old visits count for less each time round (a discounted Beta posterior). The
// estimate for a note pools the tallies of the notes around it, weighted by how close they are
// in time, so trouble in a bar brings the shadow in for the rest of that bar and thins out over
// the next one. Notes just played say more about the player's form right now than a tally from
// the last time round, so tallies count for less as they age. The estimate leans low while there is little evidence. Help arrives faster than
// it leaves: one good note doesn't pull the rug.

const PRIOR_P = 0.9; // assume they have it until shown otherwise
const PRIOR_WEIGHT = 0.5; // in notes of evidence: one played note outweighs it
const FORGET = 0.45; // what an old visit is worth one visit later
const REACH_BEATS = 2.5; // how far trouble spreads (kernel width)
const FRESH_NOTES = 8; // notes played since, after which a tally has gone stale
const STALE = 0.35; // what a stale tally still counts
const CAUTION = 0.5; // standard deviations taken off the estimate
const SILENT_ABOVE = 0.82; // estimated hit rate at which the shadow is gone
const FULL_BELOW = 0.4; // and at which it plays in full
const RISE = 0.75; // share of the way to the target gain per visit, coming in
const FALL = 0.6; // and easing off
const FLOOR = 0.06; // quieter than this is not worth sounding

export interface Support {
  /** A note was scored in time. */
  observe(i: number, hit: boolean): void;
  /** Gain (0–1) for note `i`, about to sound. Moves the note's gain one step: call once per visit. */
  gain(i: number): number;
  /** Estimated chance of hitting note `i`. */
  skill(i: number): number;
  /** Mean gain over all notes, for the display. */
  level(): number;
}

export interface SupportOptions {
  /** Initial blend-in gain (0..1) so new/unfamiliar phrases breathe softly with you on note 1 and dissolve as notes land. */
  warmStart?: number;
}

export function createSupport(times: number[], opts: SupportOptions = {}): Support {
  const n = times.length;
  const warm = Math.max(0, Math.min(0.6, opts.warmStart ?? 0));
  const prior = warm > 0 ? 0.68 : PRIOR_P;
  const hits = new Float64Array(n).fill(prior * PRIOR_WEIGHT);
  const misses = new Float64Array(n).fill((1 - prior) * PRIOR_WEIGHT);
  const gains = new Float64Array(n).fill(warm);
  const seen = new Float64Array(n); // the clock when each note was last scored
  let clock = 0;

  const estimate = (j: number): { p: number; weight: number } => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      const d = (times[i] - times[j]) / REACH_BEATS;
      if (Math.abs(d) > 3) continue;
      const k = Math.exp(-0.5 * d * d) * (STALE + (1 - STALE) * Math.exp(-(clock - seen[i]) / FRESH_NOTES));
      a += k * hits[i];
      b += k * misses[i];
    }
    return { p: a / (a + b), weight: a + b };
  };

  const skill = (j: number) => {
    const { p, weight } = estimate(j);
    return Math.max(0, p - CAUTION * Math.sqrt((p * (1 - p)) / (weight + 1)));
  };

  return {
    observe(i, hit) {
      if (i < 0 || i >= n) return;
      hits[i] = hits[i] * FORGET + (hit ? 1 : 0);
      misses[i] = misses[i] * FORGET + (hit ? 0 : 1);
      seen[i] = ++clock;
    },
    gain(i) {
      if (i < 0 || i >= n) return 0;
      const need = Math.min(1, Math.max(0, (SILENT_ABOVE - skill(i)) / (SILENT_ABOVE - FULL_BELOW)));
      const target = need * need * (3 - 2 * need);
      gains[i] += (target > gains[i] ? RISE : FALL) * (target - gains[i]);
      return gains[i] < FLOOR ? 0 : gains[i];
    },
    skill,
    level() {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += gains[i];
      return n ? sum / n : 0;
    },
  };
}

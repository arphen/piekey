// How it is going right now, as one number between 0 and 1, so the screen can warm up when the
// playing does. Fed note by note (did it land?), take by take and pass by pass. What "going well"
// means depends on the material: a scale is about evenness, so a long unbroken run and sitting on
// the click count for a lot; a melody is about the right notes, so they count for nearly all.

export interface Estimator {
  note(hit: boolean): void;
  /** A finished take at the player's own pace. */
  take(clean: boolean): void;
  /** A pass in time: notes landed and unevenness/drift around its alignment (ms; null: unknown). */
  pass(share: number, unevenMs: number | null, beatMs: number): void;
  value(): number;
  /** Notes landed in a row, up to now. */
  run(): number;
}

const NOTE_WEIGHT = 0.15; // what one note moves the running hit rate
const START = 0.6; // before anything is known: neither cold nor glowing

export function createEstimator(kind: "melody" | "scale"): Estimator {
  let rate = START;
  let streak = 0;
  let steady = 0.5;
  const fullRun = kind === "scale" ? 16 : 8;
  return {
    note(hit) {
      rate += NOTE_WEIGHT * ((hit ? 1 : 0) - rate);
      streak = hit ? streak + 1 : 0;
    },
    take(clean) {
      if (clean) rate = Math.max(rate, 0.85);
    },
    pass(share, unevenMs, beatMs) {
      rate = 0.5 * rate + 0.5 * share;
      if (unevenMs !== null) steady += 0.5 * (1 - Math.min(1, Math.abs(unevenMs) / (beatMs * 0.25)) - steady);
    },
    value() {
      const run = Math.min(1, streak / fullRun);
      const v = kind === "scale" ? 0.55 * rate * rate + 0.25 * run + 0.2 * steady : 0.7 * rate * rate + 0.3 * run;
      return Math.max(0, Math.min(1, v));
    },
    run: () => streak,
  };
}

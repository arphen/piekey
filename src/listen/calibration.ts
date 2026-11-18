import { choosePitch, DEFAULT_TUNING, setDetectorTuning, setTuningOffset, type DetectorTuning, type PitchAnalysis } from "../pitchDetection";
import { currentInputSetup, sameInputSetup, type InputSetup } from "../audio/setup";

// Learning one guitar. The player lets each open string ring; knowing which note each take is,
// we can measure what the detector cannot know on its own:
//  - how far the guitar sits from concert pitch (a guitar tuned 30 cents flat still plays "A"),
//  - how loud its quietest string is against the room, for the gate between note and noise,
//  - which of the detector's judgement calls read this guitar best. Octave slips come from the
//    choice between a peak and its octave, and how strong the overtones are differs per guitar,
//    string gauge and pickup: so the choice is fitted on the takes, attack frames included.

const STORAGE = "guitar-calibration";
const PROMINENCE = [0.8, 0.84, 0.88, 0.92, 0.95];
const CLARITY = [0.5, 0.6, 0.7, 0.8];
const MIN_GATE = 0.0015;

export interface StringTake {
  midi: number; // the open string
  frames: PitchAnalysis[]; // from the pick on
}

export interface StringReport {
  midi: number;
  cents: number | null; // against concert pitch; null when the string could not be read
  level: number;
  clean: number; // share of frames read as the right note, with the fitted tuning
}

export interface Profile {
  v: 1;
  at: string;
  cents: number; // the guitar as a whole
  noise: number;
  tuning: DetectorTuning;
  strings: StringReport[];
  cleanBefore: number; // share of frames read right with the stock detector, for comparison
  clean: number; // and with the fit
  input?: InputSetup; // older records are preserved, but cannot certify a newly opened device
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** Cents from the nearest octave of `midi`, or null when the frequency is not that note at all. */
function centsFrom(frequency: number, midi: number): number | null {
  const d = 1200 * Math.log2(frequency / (440 * 2 ** ((midi - 69) / 12)));
  const folded = d - 1200 * Math.round(d / 1200);
  return Math.abs(folded) < 100 ? folded : null;
}

function grade(take: StringTake, t: DetectorTuning, cents: number): { score: number; exact: number } {
  let score = 0;
  let exact = 0;
  for (const f of take.frames) {
    const r = choosePitch(f, t);
    if (r.frequency === null) {
      score -= 0.25; // a late note
      continue;
    }
    const m = Math.round(69 + 12 * Math.log2(r.frequency / 440) - cents / 100);
    if (m === take.midi) {
      score += 1;
      exact += 1;
    } else score -= (m - take.midi) % 12 === 0 ? 1 : 2; // an octave slip, or a wrong note
  }
  return { score, exact };
}

/** Was that the string asked for? Octaves are forgiven: that is what calibration is there to fix. */
export function soundsLike(take: StringTake): boolean {
  const cents = take.frames.map((f) => choosePitch(f, DEFAULT_TUNING).frequency).filter((x): x is number => x !== null).map((f) => centsFrom(f, take.midi));
  return cents.length >= take.frames.length * 0.4 && cents.filter((c) => c !== null).length >= cents.length * 0.6;
}

export function fitProfile(noise: number, takes: StringTake[], at: string): Profile {
  const perString = takes.map((take) => {
    const cents = take.frames.map((f) => choosePitch(f, DEFAULT_TUNING).frequency).filter((x): x is number => x !== null).map((f) => centsFrom(f, take.midi)).filter((x): x is number => x !== null);
    return { cents: cents.length >= 4 ? median(cents) : null, level: median(take.frames.map((f) => f.rms)) };
  });
  const known = perString.map((s) => s.cents).filter((x): x is number => x !== null);
  const cents = known.length ? Math.round(median(known)) : 0;
  const quietest = Math.min(...perString.map((s) => s.level));
  const minRms = Math.max(MIN_GATE, Math.min(noise * 3, quietest * 0.3));

  const total = takes.reduce((n, t) => n + t.frames.length, 0) || 1;
  const stock = { ...DEFAULT_TUNING, minRms };
  let best = stock;
  let bestScore = takes.reduce((n, t) => n + grade(t, stock, cents).score, 0);
  for (const prominence of PROMINENCE)
    for (const minClarity of CLARITY) {
      const t = { minRms, minClarity, prominence };
      const score = takes.reduce((n, take) => n + grade(take, t, cents).score, 0);
      if (score > bestScore + 1e-9) {
        best = t; // ties stay with the stock settings
        bestScore = score;
      }
    }
  return {
    v: 1,
    at,
    cents,
    noise,
    tuning: best,
    strings: takes.map((take, i) => ({ midi: take.midi, cents: perString[i].cents === null ? null : Math.round(perString[i].cents!), level: perString[i].level, clean: grade(take, best, cents).exact / (take.frames.length || 1) })),
    cleanBefore: takes.reduce((n, t) => n + grade(t, DEFAULT_TUNING, 0).exact, 0) / total,
    clean: takes.reduce((n, t) => n + grade(t, best, cents).exact, 0) / total,
  };
}

let visit: Profile | null = null;

export function loadProfile(): Profile | null {
  try {
    const p = visit ?? JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Profile | null;
    const input = currentInputSetup();
    return p && p.v === 1 && (!input || sameInputSetup(p.input, input)) ? p : null;
  } catch {
    return null;
  }
}

export function applyProfile(p: Profile | null) {
  setDetectorTuning(p?.tuning ?? null);
  setTuningOffset(p?.cents ?? 0);
}

export function saveProfile(p: Profile) {
  const bound = { ...p, input: currentInputSetup() ?? p.input };
  visit = bound;
  try {
    localStorage.setItem(STORAGE, JSON.stringify(bound));
    visit = null;
  } catch {
    // private mode: the profile still applies for this visit
  }
  applyProfile(bound);
}

/** Apply the saved profile once at app startup; importing this module has no side effects. */
export function initCalibration() {
  applyProfile(loadProfile());
}

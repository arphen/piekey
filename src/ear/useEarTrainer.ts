import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStoredItem, setStoredItem } from "../storage";
import { buildEvents, EarEngine, type Instrument, type Phrase } from "./engine";
import { songsFor, type MySong } from "./library";
import {
  cadence,
  FAMOUS,
  famousChoices,
  famousPool,
  generateProgression,
  makeRng,
  readyToAdvance,
  tonicId,
  TRACKS,
  updateMastery,
  vocabulary,
  type Famous,
  type Mastery,
  type TrackId,
} from "./theory";

export type EarMode = "chords" | "names";

export interface TrackProgress {
  stage: number;
  mastery: Record<string, Mastery>;
  /** "actual>guess" -> count */
  confusion: Record<string, number>;
  /** per-round accuracy at the current stage */
  recent: number[];
}

export interface Settings {
  instrument: Instrument;
  /** seconds per chord */
  pace: number;
  length: number;
  randomKey: boolean;
  fixedKey: number;
}

interface Stats {
  rounds: number;
  streak: number;
  best: number;
  names: { right: number; total: number };
}

interface Saved {
  track: TrackId;
  mode: EarMode;
  settings: Settings;
  progress: Record<TrackId, TrackProgress>;
  stats: Stats;
}

export interface ChordQuestion {
  kind: "chords";
  serial: number;
  ids: string[];
  keyPc: number;
  answers: (string | null)[];
  /** slots given for free (not scored) */
  given: boolean[];
  revealed: boolean;
}

export interface NameQuestion {
  kind: "names";
  serial: number;
  answer: Famous;
  choices: Famous[];
  keyPc: number;
  picked: string | null;
}

export type Question = ChordQuestion | NameQuestion;

const STORE = "guitar-ear-v1";
const emptyProgress = (): TrackProgress => ({ stage: 0, mastery: {}, confusion: {}, recent: [] });
const DEFAULTS: Saved = {
  track: "pop",
  mode: "chords",
  settings: { instrument: "keys", pace: 1.3, length: 4, randomKey: true, fixedKey: 0 },
  progress: { pop: emptyProgress(), jazz: emptyProgress() },
  stats: { rounds: 0, streak: 0, best: 0, names: { right: 0, total: 0 } },
};

function load(): Saved {
  try {
    const raw = getStoredItem(STORE);
    if (!raw) return DEFAULTS;
    const s = JSON.parse(raw) as Partial<Saved>;
    return {
      ...DEFAULTS,
      ...s,
      settings: { ...DEFAULTS.settings, ...s.settings },
      progress: { pop: { ...emptyProgress(), ...s.progress?.pop }, jazz: { ...emptyProgress(), ...s.progress?.jazz } },
      stats: { ...DEFAULTS.stats, ...s.stats },
    };
  } catch {
    return DEFAULTS;
  }
}

let serial = 0;

function pickWeighted<T>(items: T[], weights: number[], rng: () => number): T {
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
}

/** Early stages give you the first chord (always home) so you can find your footing. */
const anchored = (stage: number) => stage < 2;

export function useEarTrainer() {
  const [saved, setSaved] = useState<Saved>(load);
  const { track, mode, settings, progress, stats } = saved;
  const prog = progress[track];
  const vocab = useMemo(() => vocabulary(track, prog.stage), [track, prog.stage]);

  useEffect(() => {
    try {
      setStoredItem(STORE, JSON.stringify(saved));
    } catch {
      // progress is a convenience
    }
  }, [saved]);

  const rngRef = useRef(makeRng(Date.now() % 2147483647));
  const engine = useRef<EarEngine | null>(null);
  if (!engine.current) engine.current = new EarEngine();
  engine.current.instrument = settings.instrument;
  useEffect(() => () => engine.current?.dispose(), []);

  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [unlocked, setUnlocked] = useState<number | null>(null);

  const nextKey = useCallback(
    () => (settings.randomKey ? Math.floor(rngRef.current() * 12) : settings.fixedKey),
    [settings.randomKey, settings.fixedKey],
  );

  const makeQuestion = useCallback(
    (m: EarMode = mode, t: TrackId = track, p: TrackProgress = progress[t]): Question => {
      const rng = rngRef.current;
      if (m === "names") {
        let pool = famousPool(t, p.stage);
        if (pool.length < 4) {
          const extra = FAMOUS.filter((f) => f.track === t && !pool.includes(f)).sort((a, b) => a.stage - b.stage);
          pool = [...pool, ...extra.slice(0, 4 - pool.length)];
        }
        const playable = famousPool(t, p.stage);
        const from = playable.length ? playable : pool;
        // progressions behind songs you actually listen to come up three times as often
        const answer = pickWeighted(from, from.map((f) => (songsFor(f.id).length ? 3 : 1)), rng);
        return { kind: "names", serial: ++serial, answer, choices: famousChoices(answer, pool, Math.min(4, pool.length), rng), keyPc: nextKey(), picked: null };
      }
      const v = vocabulary(t, p.stage);
      const anchor = anchored(p.stage);
      const ids = generateProgression({ track: t, vocab: v, length: settings.length, mastery: p.mastery, anchorStart: anchor, rng });
      const given = ids.map((_, i) => anchor && i === 0);
      return { kind: "chords", serial: ++serial, ids, keyPc: nextKey(), answers: ids.map((id, i) => (given[i] ? id : null)), given, revealed: false };
    },
    [mode, track, progress, settings.length, nextKey],
  );

  const [q, setQ] = useState<Question>(() => makeQuestion());

  /* ---------- audio ---------- */

  const run = useCallback(
    async (phrases: Phrase[], keyPc: number, pace = settings.pace) => {
      setPlaying(true);
      await engine.current!.play(buildEvents(phrases, keyPc, pace), setCursor);
      setPlaying(false);
    },
    [settings.pace],
  );

  const stop = useCallback(() => {
    engine.current?.stop();
    setPlaying(false);
    setCursor(null);
  }, []);

  const homeCadence = useCallback(
    (): Phrase => ({
      ids: cadence(track, q.kind === "names" ? q.answer.mode : "major"),
      slotBase: -1,
      len: 0.5,
      gap: 0.7,
    }),
    [track, q],
  );

  const questionIds = q.kind === "chords" ? q.ids : q.answer.numerals;

  const play = useCallback(
    (withCadence = true) => {
      const phrases: Phrase[] = withCadence ? [homeCadence()] : [];
      // named progressions are loops: hear it twice
      if (q.kind === "names") phrases.push({ ids: questionIds, slotBase: 0, gap: 0.5 });
      phrases.push({ ids: questionIds, slotBase: 0 });
      void run(phrases, q.keyPc);
    },
    [homeCadence, questionIds, q, run],
  );

  const playBass = useCallback(() => {
    void run([{ ids: [tonicId(track)], slotBase: -1, bassOnly: true, gap: 0.5 }, { ids: questionIds, slotBase: 0, bassOnly: true }], q.keyPc);
  }, [run, track, questionIds, q.keyPc]);

  const playHome = useCallback(() => void run([{ ids: [tonicId(track)], slotBase: -1, len: 1.5 }], q.keyPc), [run, track, q.keyPc]);

  /** Hear a chord against home: I → X → I. The fastest way to learn a chord's "flavour". */
  const audition = useCallback(
    (id: string, keyPc = q.keyPc) => {
      const home = tonicId(track);
      void run([{ ids: id === home ? [home] : [home, id, home], slotBase: -1 }], keyPc);
    },
    [run, track, q.keyPc],
  );

  /** Alternate two easily-confused chords, each framed by home. */
  const contrast = useCallback(
    (a: string, b: string) => {
      const home = tonicId(track);
      void run([{ ids: [home, a, home], slotBase: -1, gap: 0.6 }, { ids: [home, b, home], slotBase: -1 }], q.keyPc);
    },
    [run, track, q.keyPc],
  );

  const playAnswer = useCallback(() => {
    if (q.kind !== "chords") return;
    const ids = q.answers.map((a, i) => a ?? q.ids[i]);
    void run([{ ids, slotBase: 0 }], q.keyPc);
  }, [q, run]);

  /** One of your songs' progressions, in the key it's usually played in. */
  const playSong = useCallback(
    (song: MySong) => {
      const f = FAMOUS.find((x) => x.id === song.progression);
      if (!f) return;
      void run([{ ids: cadence(f.track, f.mode), slotBase: -1, len: 0.5, gap: 0.7 }, { ids: f.numerals, slotBase: -1 }], song.keyPc);
    },
    [run],
  );

  const playCorrect = useCallback(() => void run([{ ids: questionIds, slotBase: 0 }], q.keyPc), [questionIds, q.keyPc, run]);

  /* ---------- answering ---------- */

  const activeSlot = q.kind === "chords" && !q.revealed ? q.answers.findIndex((a) => a === null) : -1;

  const choose = useCallback(
    (id: string) => {
      if (q.kind !== "chords") return;
      if (q.revealed) return audition(id);
      const i = q.answers.findIndex((a) => a === null);
      if (i < 0) return;
      const answers = [...q.answers];
      answers[i] = id;
      setQ({ ...q, answers });
    },
    [q, audition],
  );

  const setSlot = useCallback(
    (i: number) => {
      if (q.kind !== "chords" || q.revealed || q.given[i]) return;
      const answers = [...q.answers];
      answers[i] = null;
      setQ({ ...q, answers });
    },
    [q],
  );

  const undo = useCallback(() => {
    if (q.kind !== "chords" || q.revealed) return;
    for (let i = q.answers.length - 1; i >= 0; i--) {
      if (q.answers[i] !== null && !q.given[i]) return setSlot(i);
    }
  }, [q, setSlot]);

  const check = useCallback(() => {
    if (q.kind !== "chords" || q.revealed || q.answers.some((a) => a === null)) return;
    let p = { ...prog, mastery: { ...prog.mastery }, confusion: { ...prog.confusion } };
    let right = 0;
    let scored = 0;
    q.ids.forEach((actual, i) => {
      if (q.given[i]) return;
      const guess = q.answers[i]!;
      const ok = guess === actual;
      scored++;
      if (ok) right++;
      else p.confusion[`${actual}>${guess}`] = (p.confusion[`${actual}>${guess}`] ?? 0) + 1;
      p.mastery[actual] = updateMastery(p.mastery[actual], ok);
    });
    const acc = scored ? right / scored : 1;
    p.recent = [...p.recent, acc].slice(-20);
    const perfect = acc === 1;
    if (readyToAdvance(p.recent, vocab, p.mastery) && p.stage < TRACKS[track].stages.length - 1) {
      p = { ...p, stage: p.stage + 1, recent: [] };
      setUnlocked(p.stage);
    }
    setSaved((s) => {
      const streak = perfect ? s.stats.streak + 1 : 0;
      return {
        ...s,
        progress: { ...s.progress, [track]: p },
        stats: { ...s.stats, rounds: s.stats.rounds + 1, streak, best: Math.max(s.stats.best, streak) },
      };
    });
    setQ({ ...q, revealed: true });
  }, [q, prog, vocab, track]);

  const pickName = useCallback(
    (id: string) => {
      if (q.kind !== "names" || q.picked) return;
      const ok = id === q.answer.id;
      setQ({ ...q, picked: id });
      setSaved((s) => {
        const streak = ok ? s.stats.streak + 1 : 0;
        return {
          ...s,
          stats: {
            ...s.stats,
            rounds: s.stats.rounds + 1,
            streak,
            best: Math.max(s.stats.best, streak),
            names: { right: s.stats.names.right + (ok ? 1 : 0), total: s.stats.names.total + 1 },
          },
        };
      });
    },
    [q],
  );

  const next = useCallback(() => {
    stop();
    setQ(makeQuestion());
  }, [makeQuestion, stop]);

  // A fresh question plays itself — fewer clicks, more listening.
  const playRef = useRef(play);
  playRef.current = play;
  const lastSerial = useRef<number | null>(null);
  useEffect(() => {
    if (lastSerial.current !== null && lastSerial.current !== q.serial) playRef.current(true);
    lastSerial.current = q.serial;
  }, [q.serial]);

  /* ---------- settings ---------- */

  const setTrack = useCallback(
    (t: TrackId) => {
      stop();
      setSaved((s) => ({ ...s, track: t }));
      setQ(makeQuestion(mode, t, progress[t]));
    },
    [stop, makeQuestion, mode, progress],
  );

  const setMode = useCallback(
    (m: EarMode) => {
      stop();
      setSaved((s) => ({ ...s, mode: m }));
      setQ(makeQuestion(m));
    },
    [stop, makeQuestion],
  );

  const setStage = useCallback(
    (stage: number) => {
      stop();
      const p = { ...progress[track], stage, recent: [] };
      setSaved((s) => ({ ...s, progress: { ...s.progress, [track]: p } }));
      setQ(makeQuestion(mode, track, p));
    },
    [stop, progress, track, makeQuestion, mode],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSaved((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const reset = useCallback(() => {
    stop();
    setSaved((s) => ({ ...s, progress: { ...s.progress, [track]: emptyProgress() }, stats: DEFAULTS.stats }));
    setQ(makeQuestion(mode, track, emptyProgress()));
  }, [stop, track, makeQuestion, mode]);

  return {
    track, mode, settings, progress: prog, stats, vocab, q, cursor, playing, activeSlot,
    unlocked, dismissUnlock: () => setUnlocked(null),
    play, playBass, playHome, playSong, audition, contrast, playAnswer, playCorrect, stop,
    choose, setSlot, undo, check, pickName, next,
    setTrack, setMode, setStage, updateSettings, reset,
  };
}

export type EarTrainer = ReturnType<typeof useEarTrainer>;

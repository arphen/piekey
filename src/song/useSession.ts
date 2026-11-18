import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { createSupport } from "./support";
import { useFollower } from "../follow/useFollower";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import type { NoteResult } from "../core/contract";
import type { Timeline } from "../tunes/order";
import { usePlayback } from "../tunes/usePlayback";
import { assessTiming } from "../tunes/scoring";
import { latencyMeasured } from "../audio/latency";
import { mod } from "../musicTheory";
import type { Card, Deck } from "./deck";
import { bassHint, chime, glint, hintNote, hush, padChord, say } from "./cues";
import { createEstimator } from "./estimator";
import { cleanTake, takeShare } from "./judge";
import { noteName } from "./deck";
import { finishTake, record } from "../audio/recorder";
import { keepPracticeWrite } from "../platform/practiceWindow";
import { createEvidence, type EvidenceLog } from "./evidence";
import { applyResult, carryOver, headStart, loadStores, logAttempt, planExtra, planSession, saveStores, today, type AttemptConditions, type Result, type Settings, type Store } from "./leitner";
import { assignNoteKeys, usedMidis } from "./notekeys";
import { createTrouble, spotCard, spotOf, type Spot } from "./spot";
import { meanShare } from "./stats";
import { useChordFollower } from "./useChordFollower";
import { isShared, tuneOf } from "./ids";

// Runs a practice session without touching the computer. Each card goes
//   intro → (listen) → (at your own pace) → in time with the band → result
// and the next card comes up by itself. The session reacts to how the playing goes rather than
// telling the player what to do:
//
// At your own pace the cursor waits for every note, and starting over (from the top or a few
// notes back) is followed, not punished: only finished takes count, and a take is clean when
// (nearly) every note landed first time. The tempo the notes come at is measured.
//
// In time, the click starts a little under that tempo, so the player settles down onto it, and
// only clean passes raise it, up to the tempo this visit is heading for. Passes that fall short
// bring it down; passes that are mostly wrong notes send the band away until a take at the
// player's own pace is clean again. A pass with nothing heard doesn't count; a few of those in a
// row and the band stops and waits for a note.
//
// A long piece that keeps falling apart in the same bar has that bar taken out (spot.ts): heard
// once, then at the player's own pace with fingering and note names showing, a couple of clean
// times through, and back into the piece.
//
// Silence is answered too: after a few seconds without a note the next one is played quietly,
// later the passage is played again, and after a long while the session rests (and stops
// counting time) until a note wakes it. Losing the audio input pauses it; it resumes on its own.

export type Phase = "intro" | "listen" | "pace" | "time" | "result";
type MemoryStage = "page" | "landmarks" | "hidden";

const INTRO_NEW_MS = 3400;
const INTRO_MS = 2200;
const NEXT_TAKE_MS = 1100;
const START_TIME_MS = 900;
const RESULT_MS = 2600;
const SKIPPED_MS = 900;
const MAX_UNCLEAN = 4; // finished takes that weren't clean before the band takes over anyway
const PULSE_NOTES = 4; // notes in a row that must come evenly for the player to have a tempo
const PULSE_SPREAD = 0.35; // how far apart the slowest and fastest of them may be (share of the beat)
const UNDER = 0.88; // the click starts this far under the player's own tempo
const STEP_UP = 4; // bpm a clean pass earns
const STEP_UP_FAR = 8; // while the tempo is far below where it is heading, after a steady pass
const STEP_DOWN = 6;
const MIN_BPM = 40;
const MAX_BPM = 240;
const MAX_MISSED_PASSES = 7;
const MESSY = 0.5; // a pass under this share is mostly wrong notes: tempo is not the problem
const SILENT_PASSES = 3; // then the band waits for you
const HEARD_FRAMES = 6; // frames with a pitch for a pass to count as played
const IDLE_MS = 12000; // without a note for this long, the session's clock stands still
const NUDGE_MS = 8000; // of silence at the player's own pace: the next note, quietly
const NUDGES = 2;
const REPLAY_MS = 12000; // after the last nudge: the passage again
const AWAY_MS = 75000; // of silence: the session rests until a note wakes it
const SOUND_RMS = 0.006; // louder than this is somebody playing
const SPOT_CLEAN = 2; // clean times through a spot before the piece carries on
const MAX_SPOTS = 3; // spots taken out of one exercise in one visit
const SPOT_NUDGE_MS = 3000; // in a spot, the next note sounds this soon: it is there to be shown
const PROMPT_SECS = [4, 3.5, 3, 2.4, 1.8, 1.4]; // by box: seconds a note on the neck may take to be found
const WEAK_BAR = 0.7; // a run-through's bar with fewer of its notes than this is worked on next time
const RUN_CLEAN = 0.9;
const GAP_BOX = 4; // an exercise this far along is played in time with gaps in the band: the time is the player's
const GAP_BARS = 2; // bars with the band, then bars without it (twice as many in the top box)

const EMPTY: Timeline = { slots: [], targets: [], comp: [], total: 0 };
const KEY_IDS = ["hear", "pace", "time", "next"];
const even = (bpm: number) => Math.round(bpm / 2) * 2;

export interface Outcome {
  id: string;
  at: number; // position in the session queue
  result: Result;
  from: number; // box before
  to: number;
  bpm: number;
  share: number | null; // notes landed, 0..1
  secs: number; // spent on it, playing
  also: { id: string; from: number; to: number }[]; // relatives it carried up a box
  spots: number; // parts of it that were taken out and worked on
  secret?: string; // what a tune without a name turned out to be
  bars?: { bar: number; share: number }[]; // a run-through, bar by bar
  recordingId?: string;
  conditions?: AttemptConditions;
}

/** Notes landed per printed bar over a card's range. */
function barShares(card: Card, results: readonly NoteResult[]): { bar: number; share: number }[] {
  const by = new Map<number, [number, number]>();
  for (let i = card.first; i <= card.last; i++) {
    const r = results[i];
    if (!r) continue;
    const bar = card.tl.targets[i].bar;
    const t = by.get(bar) ?? [0, 0];
    by.set(bar, [t[0] + 1, t[1] + (r === "hit" ? 1 : 0)]);
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([bar, [n, hit]]) => ({ bar, share: hit / n }));
}

export interface SessionOptions {
  gap?: ReadonlySet<string>; // exercises to play in time with gaps in the band whatever their box (a focus on time)
  arrangementFingerprint?: string;
  arrangementFingerprints?: ReadonlyMap<string, string>;
  tempoBounds?: { minBpm: number; targetBpm: number };
}

/** `tuneIds`: the tune the session belongs to, then any others whose exercises are mixed in. */
export function useSession(deck: Deck, tuneIds: string[], input: InputApi, options: SessionOptions = {}) {
  const boxes = useRef(tuneIds);
  boxes.current = tuneIds;
  const boxesKey = tuneIds.join("|");
  const saveStore = useCallback((s: Store) => saveStores(boxes.current, s), []);
  const [store, setStore] = useState<Store>(() => loadStores(tuneIds));
  const storeRef = useRef(store);
  storeRef.current = store;
  const [queue, setQueue] = useState<string[]>([]);
  const [pos, setPos] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [selfGuided, setSelfGuided] = useState(false);
  const [ending, setEnding] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [paused, setPaused] = useState(false);
  const [away, setAway] = useState(false); // resting after a long silence: a note wakes it
  const [waiting, setWaiting] = useState(false); // the band stopped: play to bring it back
  const [bpm, setBpm] = useState(80);
  const [target, setTarget] = useState(80); // the tempo this visit is heading for
  const [takes, setTakes] = useState({ clean: 0, unclean: 0 });
  const [lastTake, setLastTake] = useState<{ hit: number; total: number; clean: boolean } | null>(null);
  const [passes, setPasses] = useState<number[]>([]);
  const [silent, setSilent] = useState(0);
  const [slowed, setSlowed] = useState(0);
  const [backed, setBacked] = useState(0); // times the band stepped back to the player's own pace
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [log, setLog] = useState<Outcome[]>([]);
  const [loopKey, setLoopKey] = useState(0);
  const [listenKey, setListenKey] = useState(0);
  const [click, setClick] = useState(true);
  const [flow, setFlow] = useState(0.5); // how it is going right now, 0..1
  const [run, setRun] = useState(0); // notes landed in a row, right now
  const [nudge, setNudge] = useState(0); // times the app has spoken up in a silence, this card
  const [spotState, setSpot] = useState<(Spot & { key: string }) | null>(null); // a part of this card, taken out
  const [memoryStage, setMemoryStage] = useState<MemoryStage>("page");
  const memorySeen = useRef(new Set<MemoryStage>());
  const memoryVisit = useRef("");
  const [spotted, setSpotted] = useState(0); // times that happened, this card
  const spotFrom = useRef<"pace" | "time">("time"); // where the piece carries on after it
  const logRef = useRef<Outcome[]>([]);
  logRef.current = log;
  const recorded = useRef({ outcomes: 0, ms: 0 }); // already written to the session history
  const timeStarts = useRef(0); // in-time loops started for this card
  const runBars = useRef<Outcome["bars"]>(undefined); // the last run-through, bar by bar
  const missRun = useRef(0); // passes in a row that fell short
  const rhythmMisses = useRef(0); // right pitches without a steady pulse do not earn a faster click
  const returnTo = useRef<Phase | null>(null); // where a "hear it again" goes back to
  const lostInput = useRef(false);
  const ownTempo = useRef<number | null>(null); // the last steady tempo at the player's own pace
  const exposed = useRef(false);
  const interrupted = useRef(false);
  const assessment = useRef<AttemptConditions | undefined>();
  const assessedBpm = useRef<number | undefined>();
  const manualTempoChanged = useRef(false);
  // the session's clock: only time spent playing counts
  const clock = useRef({ active: 0, card: 0, heard: 0, event: 0, nudges: 0 });

  useEffect(() => {
    setStore(loadStores(boxes.current));
  }, [boxesKey]);

  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  const whole: Card | undefined = running && !finished ? byId.get(queue[pos]) : undefined;
  const cardKey = whole ? `${pos}:${whole.id}` : "";
  const spot = spotState && spotState.key === cardKey ? spotState : null;
  // the exercise in front of the player: all of it, or the part taken out
  const card = useMemo(() => (whole && spot ? spotCard(whole, spot) : whole), [whole, spot]);
  const memoryExercise = Boolean(whole?.memory && whole.family === "melody" && whole.view === "score");
  const trouble = useMemo(() => (whole ? createTrouble(whole) : null), [cardKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = card ? store.cards[card.id] : undefined;
  const box = state?.box ?? 0; // 0: new
  // a new exercise whose relatives are already under the fingers needs less leading in
  const level = state?.box ?? (card && (store.credit?.[card.id] ?? 0) >= 0.5 ? 2 : 0);
  const settings = store.settings;
  const listening = input.status === "listening" && !input.paused;
  const tempoBounds = card?.tuneId === tuneIds[0] ? options.tempoBounds : undefined;
  const minTempo = tempoBounds?.minBpm ?? MIN_BPM;
  const maxTempo = tempoBounds?.targetBpm ?? MAX_BPM;
  const arrangementFor = (id: string) => options.arrangementFingerprints?.get(id) ?? (id === tuneIds[0] ? options.arrangementFingerprint : undefined);
  const initialMemory = useMemo(() => {
    const day = today();
    const previous = [...(storeRef.current.history ?? [])].reverse().find((attempt) => attempt.id === whole?.id && attempt.result !== "skip");
    const arrangement = whole && arrangementFor(whole.tuneId);
    const review = Boolean(memoryExercise && whole && previous && (previous.result === "clean" || previous.result === "ok")
      && previous.day < day && Boolean(arrangement && previous.arrangementFingerprint === arrangement)
      && (storeRef.current.cards[whole.id]?.due ?? "9999") <= day);
    const practisedToday = (storeRef.current.history ?? []).some((attempt) => attempt.day === day && attempt.result !== "skip" && !isShared(attempt.id) && (tuneOf(attempt.id) ?? boxes.current[0]) === whole?.tuneId);
    // A heard/read card can have been skipped without creating a saved attempt.
    const visitedThisSession = logRef.current.some((attempt) => !isShared(attempt.id) && byId.get(attempt.id)?.tuneId === whole?.tuneId);
    const rehearsed = memoryExercise && (practisedToday || visitedThisSession);
    return { stage: review ? "hidden" as const : "page" as const, review, rehearsed };
  }, [cardKey]); // a visit's starting evidence stays fixed while it runs

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setStore((s) => {
        const n = { ...s, settings: { ...s.settings, ...patch } };
        saveStore(n);
        return n;
      });
    },
    [saveStore],
  );

  /** What the tune is called and its key, kept with its box for views across tunes. */
  const setMeta = useCallback(
    (meta: { title: string; key: string }) => {
      const cur = storeRef.current.meta;
      if (cur?.title === meta.title && cur.key === meta.key) return;
      const n = { ...storeRef.current, meta };
      storeRef.current = n;
      saveStore(n);
      setStore(n);
    },
    [saveStore],
  );

  // what this card asks for, given its box
  const long = card ? card.last - card.first + 1 > 24 : false;
  const needClean = spot
    ? SPOT_CLEAN
    : !card || !card.pace
      ? 0
      : card.fresh
        ? 1 // new notes every time: always read through once first
        : card.view === "chords"
          ? (level <= 2 ? 1 : 0)
          : card.family === "scales"
            ? (level <= 1 ? 1 : 0)
            : level <= 1
              ? (long ? 1 : 2)
              : level === 2
                ? 1
                : 0;
  const doListen = Boolean(card?.listen && (level <= 1 || card.family === "ear")); // an echo is always heard first

  // notes that work the session instead of the exercise: never heard as part of it
  const keys = useMemo(() => assignNoteKeys(KEY_IDS, card ? usedMidis(card) : []), [card]);
  const ignore = useMemo(() => new Set(Object.values(keys).filter((m): m is number => m !== null)), [keys]);

  const midis = useMemo(() => (card && card.view !== "chords" ? card.tl.targets.slice(card.first, card.last + 1).map((t) => t.midi) : []), [card]);
  const goals = useMemo(
    () => (card && card.view === "chords" ? card.tl.targets.slice(card.first, card.last + 1).map((t) => t.chord ?? { required: [], clash: [] }) : []),
    [card],
  );
  const pacing = phase === "pace" && !paused && Boolean(card) && !selfGuided;
  const follow = useFollower(midis, input, pacing && card?.view !== "chords", !card?.exact, ignore);
  const chords = useChordFollower(goals, input, pacing && card?.view === "chords");
  // both hand out a new object every render; these two are the same functions throughout
  const restartFollow = follow.restart;
  const restartChords = chords.restart;

  const guideMelody = settings.guide && card?.family === "melody" && !memoryExercise;
  // the notes under the player in time: silent while they land, fading in where they don't
  const shadow = useMemo(() => (whole ? createSupport(whole.tl.targets.map((t) => t.t)) : null), [whole]);
  const mix = {
    bpm,
    melody: phase === "listen" || (phase === "time" && guideMelody),
    shadow: phase === "time" && card?.kind !== "improv" && !memoryExercise ? shadow : null,
    fill: phase === "listen" || phase === "time",
    chords: true,
    click: phase === "time" && (Boolean(card?.click) || card?.family === "scales") && click,
    countIn: true,
    bass: true,
    guide: !memoryExercise || phase === "listen",
  };
  // a gap: the band drops out for a couple of bars and comes back; the notes in between are still judged
  const gapped = Boolean(card && !spot && !card.run && card.view !== "chords" && card.family !== "ear" && (options.gap?.has(card.id) || (box >= GAP_BOX && (card.family === "scales" || card.family === "melody"))));
  const barBeats = card?.tl.slots[card.from]?.beats ?? 4;
  const gap = gapped ? { on: GAP_BARS * barBeats, off: (box >= 5 ? 2 : 1) * GAP_BARS * barBeats } : null;
  const playback = usePlayback(card?.tl ?? EMPTY, { ...mix, gap }, input, phase === "time" && listening && !selfGuided, !card?.exact, ignore);
  const { play, stop } = playback;

  const conditionsFor = (tempo: AttemptConditions["tempo"]): AttemptConditions => ({
    v: 1, source: selfGuided ? "self" : "measured", confidence: "unknown", tempo,
    support: phase === "time" ? guideMelody || (mix.guide && card?.tl.guide?.length) ? "guide" : mix.shadow ? "adaptive" : "none" : nudge ? "adaptive" : "none",
    notation: card?.view === "score" ? memoryExercise
      ? memorySeen.current.size === 1 && memorySeen.current.has("hidden") ? "hidden"
        : memorySeen.current.size === 1 && memorySeen.current.has("page") ? "visible" : "faded"
      : card.memory ? "faded" : "visible" : undefined,
    exposure: exposed.current || follow.take > 1 ? "repeated" : "first",
    uninterrupted: selfGuided ? undefined : !interrupted.current && follow.take <= 1,
  });

  /** A changed page starts a fresh pass; its earlier help remains part of this visit's evidence. */
  const changeMemoryStage = useCallback((next: MemoryStage, requested = false) => {
    if (!memoryExercise || phase === "result") return;
    memorySeen.current.add(next);
    exposed.current = true;
    if (requested && (phase === "pace" || phase === "time")) interrupted.current = true;
    setMemoryStage(next);
    stop();
    restartFollow();
    restartChords();
    setLastTake(null);
    setTakes({ clean: 0, unclean: 0 });
    if (phase === "time") setLoopKey((value) => value + 1);
    clock.current.event = performance.now();
  }, [memoryExercise, phase, stop, restartFollow, restartChords]);

  // ---------- moving through the session ----------

  /** Call from a click: audio and the input can only start inside one; after that the session runs itself. */
  const begin = useCallback(
    (plan: string[], self = false) => {
      ensureAudio();
      void Tone.start().catch(() => undefined);
      setQueue(plan);
      setPos(0);
      setFinished(false);
      setSelfGuided(self);
      setEnding(false);
      setPaused(false);
      setAway(false);
      lostInput.current = false;
      setLog([]);
      recorded.current = { outcomes: 0, ms: 0 };
      const now = performance.now();
      clock.current = { active: 0, card: 0, heard: now, event: now, nudges: 0 };
      setRunning(true);
      if (!self && (input.status === "idle" || input.status === "error")) void input.start();
    },
    [input],
  );

  const start = useCallback(() => begin(planSession(deck, storeRef.current, today())), [begin, deck]);

  const finish = useCallback(() => {
    stop();
    hush();
    setFinished(true);
    setEnding(false);
    const fresh = logRef.current.slice(recorded.current.outcomes).filter((o) => o.result !== "skip");
    const ms = clock.current.active - recorded.current.ms;
    recorded.current = { outcomes: logRef.current.length, ms: clock.current.active };
    if (!fresh.length) return;
    const entry = {
      uid: crypto.randomUUID(),
      date: today(),
      minutes: Math.max(1, Math.round(ms / 60000)),
      cards: fresh.length,
      clean: fresh.filter((o) => o.result === "clean").length,
      share: meanShare(fresh) ?? undefined,
    };
    const n = { ...storeRef.current, sessions: [...storeRef.current.sessions, entry].slice(-200) };
    storeRef.current = n;
    saveStore(n);
    setStore(n);
  }, [stop, saveStore]);

  const keepGoing = useCallback(() => {
    ensureAudio();
    void Tone.start().catch(() => undefined);
    const done = new Set(logRef.current.filter((o) => o.result !== "skip").map((o) => o.id));
    let more = planSession(deck, storeRef.current, today(), done, Math.max(2, storeRef.current.settings.newPerSession));
    if (!more.length) more = planExtra(deck, storeRef.current, 4).filter((id) => !done.has(id));
    if (!more.length) return false;
    const now = performance.now();
    clock.current = { ...clock.current, heard: now, event: now };
    setQueue((q) => [...q, ...more]);
    setPos((p) => p + 1);
    setFinished(false);
    setPaused(false);
    setAway(false);
    return true;
  }, [deck]);

  const exit = useCallback(() => {
    if (running && !finished) finish();
    stop();
    hush();
    setRunning(false);
    setFinished(false);
  }, [running, finished, finish, stop]);

  // a new card (or the same one again later in the queue): reset and introduce it
  const estimator = useMemo(() => createEstimator(card?.family === "scales" ? "scale" : "melody"), [cardKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // where this visit goes wrong, kept with its attempt
  const evidence = useMemo<EvidenceLog>(() => createEvidence(), [cardKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const evidenceRef = useRef(evidence);
  evidenceRef.current = evidence;
  const feel = () => {
    setFlow(Math.round(estimator.value() * 20) / 20);
    setRun(estimator.run());
  };
  useEffect(() => {
    if (!card) return;
    stop();
    timeStarts.current = 0;
    missRun.current = 0;
    rhythmMisses.current = 0;
    returnTo.current = null;
    ownTempo.current = null;
    memoryVisit.current = cardKey;
    setMemoryStage(initialMemory.stage);
    memorySeen.current = new Set(memoryExercise ? [initialMemory.stage] : []);
    // A later-day task is still rehearsed if this tune has already been practised today.
    exposed.current = initialMemory.rehearsed;
    interrupted.current = false;
    assessment.current = undefined;
    assessedBpm.current = undefined;
    manualTempoChanged.current = false;
    const now = performance.now();
    clock.current = { ...clock.current, card: 0, event: now, nudges: 0 };
    setPhase("intro");
    setTakes({ clean: 0, unclean: 0 });
    setLastTake(null);
    setPasses([]);
    setSilent(0);
    setSlowed(0);
    setBacked(0);
    setWaiting(false);
    setOutcome(null);
    setNudge(0);
    setFlow(0.5);
    setRun(0);
    setSpot(null);
    setSpotted(0);
    const restored = storeRef.current.cards[card.id]?.bpm ?? card.bpm;
    const tempo = Math.min(maxTempo, Math.max(minTempo, restored));
    setBpm(tempo);
    setTarget(tempo);
    if (storeRef.current.settings.voice) say(card.title);
  }, [cardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Into the band. A player who came in with a tempo of their own gets a click a little under it
   * (never past the exercise's goal), to settle onto; from there clean passes take it up to where
   * this visit is heading. Without one, the click is the tempo kept from last time.
   */
  const enterTime = useCallback(() => {
    const own = ownTempo.current;
    if (own && card) {
      const start = Math.max(minTempo, Math.min(card.goalBpm, maxTempo, even(own * UNDER)));
      setBpm(start);
      if (start > target) setTarget(start);
    } else setBpm(target);
    missRun.current = 0;
    setPhase("time");
  }, [target, card, minTempo, maxTempo]);

  const nextPhase = useCallback(
    (from: Phase) => {
      if (!card) return;
      stop();
      const back = returnTo.current;
      returnTo.current = null;
      clock.current.event = performance.now();
      if (from === "listen" && back) {
        // heard again on request: back to where the player was
        if (back === "pace") {
          restartFollow();
          restartChords();
        }
        setPhase(back);
      } else if (from === "intro" && doListen) setPhase("listen");
      else if (selfGuided) enterTime();
      else if ((from === "intro" || from === "listen") && needClean > 0) setPhase("pace");
      else enterTime();
    },
    [card, doListen, needClean, stop, enterTime, restartFollow, restartChords, selfGuided],
  );

  const conclude = useCallback(
    (result: Result, share: number | null = null, recordingId?: string) => {
      if (!card) return;
      // A finished visible/own-pace pass is still part of learning this memory task.
      // Ending, skipping or taking a spot must not defer its later hidden review.
      if (!selfGuided && memoryExercise && (phase !== "time" || memoryStage !== "hidden" || spot)) result = "skip";
      stop();
      const before = storeRef.current;
      const prev = before.cards[card.id];
      const conditions = selfGuided ? conditionsFor(phase === "time" ? "fixed" : "own-pace") : assessment.current;
      const self = conditions?.source === "self";
      const playedBpm = self ? bpm : assessedBpm.current ?? bpm;
      const day = today();
      let nextState = applyResult(prev, card, result, playedBpm, day);
      let used = 0;
      if (!self && !prev && result === "clean") {
        const head = headStart(nextState, before.credit?.[card.id] ?? 0, day);
        nextState = head.state;
        used = head.used;
      }
      const from = prev?.box ?? 0;
      const o: Outcome = { id: card.id, at: pos, result, from, to: result === "skip" || self ? from : nextState.box, bpm: playedBpm, share: self ? null : share, secs: Math.round(clock.current.card / 1000), also: [], spots: spotted, secret: result === "clean" || result === "ok" ? card.secret : undefined, bars: card.run ? runBars.current : undefined, recordingId, conditions };
      if (result !== "skip") {
        let n: Store = self ? before : { ...before, cards: { ...before.cards, [card.id]: nextState } };
        if (used) n = { ...n, credit: { ...n.credit, [card.id]: (n.credit?.[card.id] ?? 0) - used } };
        if (!self && result === "clean") {
          const carried = carryOver(n, deck, card, day);
          n = carried.store;
          o.also = carried.moved;
        }
        n = logAttempt(n, { uid: crypto.randomUUID(), id: card.id, day, at: Date.now(), timingMeasured: self ? undefined : latencyMeasured(), goalBpm: card.goalBpm, arrangementFingerprint: arrangementFor(card.tuneId), result, bpm: playedBpm, share: o.share, secs: o.secs, from, to: o.to, ev: self ? undefined : evidence.done(), conditions });
        storeRef.current = n;
        saveStore(n);
        setStore(n);
        if (!self) chime(result !== "fail");
      }
      setLog((l) => [...l, o]);
      setOutcome(o);
      setPhase("result");
      // a miss comes round once more this session, a few cards later
      if (result === "fail" && !queue.slice(pos + 1).includes(card.id) && queue.filter((id) => id === card.id).length < 2)
        setQueue((q) => [...q.slice(0, pos + 4), card.id, ...q.slice(pos + 4)]);
    },
    [card, bpm, saveStore, stop, queue, pos, deck, spotted, evidence, selfGuided, phase, memoryExercise, memoryStage, spot, guideMelody, nudge, follow.take, mix.shadow, options.arrangementFingerprint, options.arrangementFingerprints, tuneIds],
  );

  // ---------- a part taken out ----------

  /** These bars by themselves: heard once, then at the player's own pace until they have come out clean a couple of times. */
  const startSpot = useCallback(
    (sp: Spot, from: "pace" | "time") => {
      stop();
      hush();
      spotFrom.current = from;
      returnTo.current = null;
      setSpot({ ...sp, key: cardKey });
      setSpotted((n) => n + 1);
      setTakes({ clean: 0, unclean: 0 });
      setLastTake(null);
      setWaiting(false);
      clock.current.event = performance.now();
      clock.current.nudges = 0;
      setPhase("listen");
      if (memoryExercise) memorySeen.current.add("page");
    },
    [stop, cardKey, memoryExercise],
  );

  /** Back into the piece, where it was left. */
  const endSpot = useCallback(() => {
    stop();
    setSpot(null);
    setTakes({ clean: 0, unclean: 0 });
    setLastTake(null);
    missRun.current = 0;
    clock.current.event = performance.now();
    setPhase(spotFrom.current);
  }, [stop]);

  /** By hand: take these bars of the exercise out (slots of its timeline). */
  const spotAt = useCallback(
    (from: number, to: number) => {
      const sp = whole && phase !== "result" ? spotOf(whole, Math.max(whole.from, from), Math.min(whole.to, to)) : null;
      if (sp) startSpot({ ...sp, asked: true }, phase === "time" ? "time" : "pace");
    },
    [whole, phase, startSpot],
  );

  // intro → first phase
  useEffect(() => {
    if (phase !== "intro" || !card || paused) return;
    const id = window.setTimeout(() => nextPhase("intro"), box === 0 ? INTRO_NEW_MS : INTRO_MS);
    return () => window.clearTimeout(id);
  }, [phase, card, paused, box, nextPhase]);

  // listen: hear it once
  const heard = useRef(false);
  useEffect(() => {
    if (phase !== "listen" || !card || paused) return;
    exposed.current = true;
    heard.current = false;
    void play(card.from, card.to, false);
  }, [phase, card, paused, play, listenKey]);
  useEffect(() => {
    if (phase !== "listen" || paused) return;
    if (playback.playing) heard.current = true;
    else if (heard.current) {
      heard.current = false;
      nextPhase("listen");
    }
  }, [playback.playing, phase, paused, nextPhase]);

  // at your own pace: count finished takes; starting over mid-take is free
  useEffect(() => {
    if (phase !== "pace" || !card || card.view === "chords" || !follow.done) return;
    assessment.current = conditionsFor("own-pace");
    assessedBpm.current = ownTempo.current ?? bpm;
    exposed.current = true;
    const clean = follow.takeStart === 0 && cleanTake(follow.results);
    const next = clean ? { ...takes, clean: takes.clean + 1 } : { ...takes, unclean: takes.unclean + 1 };
    setTakes(next);
    setLastTake({ ...takeShare(follow.results), clean });
    estimator.take(clean);
    feel();
    if (clean) glint();
    // a take that keeps going wrong in the same bar: that bar comes out
    const abs: NoteResult[] = [];
    follow.results.forEach((r, i) => (abs[card.first + i] = r));
    for (let k = 1; k < follow.take; k++) evidence.restart();
    if (follow.takeStart === 0) {
      const heardAt: (number | null)[] = [];
      follow.wrongAt.forEach((m, i) => (heardAt[card.first + i] = m));
      evidence.notes(card.tl.targets.map((t) => t.midi), card.steps, abs, heardAt, card.first, card.last);
    }
    const sp = !spot && !clean && follow.takeStart === 0 && spotted < MAX_SPOTS ? trouble?.pass(abs) ?? null : null;
    const id = window.setTimeout(() => {
      if (ending) {
        if (clean) conclude("ok", takeShare(follow.results).hit / Math.max(1, follow.total));
        else finish();
        return;
      }
      // being here at all asks for one clean take; past a few that weren't, the band decides
      if (next.clean >= Math.max(1, needClean) || next.unclean >= MAX_UNCLEAN) {
        // an echo, or a set of notes found on the neck, is done once played: no band to play it in time with
        if ((card.family === "ear" || card.family === "fretboard") && !spot) {
          const done = next.clean >= Math.max(1, needClean);
          // the neck is known when the notes come quickly: the time allowed shrinks as the box rises
          const slow = card.family === "fretboard" && follow.seconds !== null && follow.seconds / Math.max(1, follow.total) > PROMPT_SECS[Math.min(box, PROMPT_SECS.length - 1)];
          const sh = takeShare(follow.results);
          conclude(done ? (slow ? "ok" : "clean") : "fail", sh.total ? sh.hit / sh.total : null);
        }
        else (spot ? endSpot : enterTime)();
      }
      else if (sp) startSpot(sp, "pace");
      else follow.restart();
    }, NEXT_TAKE_MS);
    return () => window.clearTimeout(id);
  }, [phase, follow.done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== "pace" || !card || card.view !== "chords" || !chords.done) return;
    assessment.current = conditionsFor("own-pace");
    assessedBpm.current = ownTempo.current ?? bpm;
    exposed.current = true;
    setTakes((t) => ({ ...t, clean: t.clean + 1 }));
    glint();
    const id = window.setTimeout(() => ending ? conclude("ok", 1) : enterTime(), NEXT_TAKE_MS);
    return () => window.clearTimeout(id);
  }, [phase, chords.done]); // eslint-disable-line react-hooks/exhaustive-deps

  // the harmony under your own-pace playing: a soft chord whenever it changes
  const lastPad = useRef("");
  const paceIndex = card?.view === "chords" ? chords.index : follow.index;
  useEffect(() => {
    if (phase !== "pace" || !card || paused) {
      lastPad.current = "";
      return;
    }
    const i = card.first + Math.min(paceIndex, card.last - card.first);
    if (card.view === "chords") {
      const ctx = card.context[i];
      const sym = `${i}`;
      if (ctx?.chord && sym !== lastPad.current) bassHint(40 + mod((ctx.chord.bass ?? ctx.chord.root) - 40));
      lastPad.current = sym;
      return;
    }
    const ctx = card.context[i];
    const sym = ctx?.chord?.symbol ?? "";
    if (ctx?.chord && sym !== lastPad.current) {
      const c = ctx.chord;
      const third = c.third ?? 4;
      const low = 52 + mod(c.root + third - 52);
      padChord([40 + mod((c.bass ?? c.root) - 40), low, low + c.fifth - third, low + (c.seventh ?? 12) - third]);
    }
    lastPad.current = sym;
  }, [phase, card, paused, paceIndex, follow.take]); // eslint-disable-line react-hooks/exhaustive-deps

  // At their own pace there is no tempo, until the player has one: once the notes come evenly,
  // that tempo is known. It is not clicked back at them (a click that follows the player teaches
  // nothing); it decides where the click starts when the band comes in.
  const beat = useRef<{ index: number; at: number; ms: number[] }>({ index: -1, at: 0, ms: [] });
  const [pulse, setPulse] = useState<number | null>(null);
  useEffect(() => {
    const b = beat.current;
    if (phase !== "pace" || !card || card.view === "chords" || paused) {
      beat.current = { index: -1, at: 0, ms: [] };
      setPulse(null);
      return;
    }
    const now = performance.now();
    clock.current.event = now;
    clock.current.nudges = 0;
    const i = follow.index - 1; // the note just played
    const t = card.tl.targets;
    const beatsTo = (k: number) => t[card.first + k].t - t[card.first + k - 1].t;
    if (i >= 1 && b.index === i - 1 && beatsTo(i) > 0) b.ms = [...b.ms, (now - b.at) / beatsTo(i)].slice(-PULSE_NOTES);
    else b.ms = [];
    const landed = b.index !== i; // a new note, not this effect running again
    b.index = i;
    b.at = now;
    if (landed && i >= 0 && follow.results[i]) {
      estimator.note(follow.results[i] === "hit");
      feel();
    }
    const sorted = [...b.ms].sort((x, y) => x - y);
    const mid = sorted[sorted.length >> 1];
    const steady = sorted.length === PULSE_NOTES && (sorted[sorted.length - 1] - sorted[0]) / mid < PULSE_SPREAD && mid > 250 && mid < 2000;
    if (steady) ownTempo.current = Math.round(60000 / mid);
    setPulse(steady ? Math.round(60000 / mid) : null);
  }, [phase, card, paused, follow.index, follow.take]); // eslint-disable-line react-hooks/exhaustive-deps

  // a run-through is recorded (audio/recorder.ts): a take left unfinished is not kept
  const take = useRef<{ stop(): Promise<Blob | null> } | null>(null);
  const runNow = phase === "time" && Boolean(card?.run) && !paused;
  useEffect(() => {
    if (!runNow) return;
    const stream = input.stream?.();
    if (!stream) return;
    take.current = record(stream);
    return () => {
      const t = take.current;
      take.current = null;
      void t?.stop();
    };
  }, [runNow, cardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // in time: loop with the band
  useEffect(() => {
    if (phase !== "time" || !card || paused || waiting) return;
    const id = window.setTimeout(() => {
      manualTempoChanged.current = false;
      void play(card.from, card.to, true);
    }, timeStarts.current++ === 0 ? START_TIME_MS : 250);
    return () => window.clearTimeout(id);
  }, [phase, card, paused, waiting, loopKey, play]);

  // each note scored in time feeds the estimate of how it is going
  const scored = useRef<NoteResult[]>([]);
  useEffect(() => {
    const before = scored.current;
    scored.current = playback.results;
    if (phase !== "time" || selfGuided) return;
    let fed = false;
    playback.results.forEach((r, i) => {
      if (r && !before[i]) {
        estimator.note(r === "hit");
        fed = true;
      }
    });
    if (fed) feel();
  }, [playback.results]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = playback.lastPass;
    if (phase !== "time" || !p || !card || !p.total) return;
    if (selfGuided) return;
    const stableTempo = p.tempoStable === true && !manualTempoChanged.current;
    manualTempoChanged.current = false;
    assessedBpm.current = p.bpm ?? Math.min(bpm, card.bpm);
    assessment.current = conditionsFor(card.run && stableTempo ? "fixed" : "adaptive");
    if (!stableTempo) assessment.current.uninterrupted = false;
    exposed.current = true;
    if (p.heard < HEARD_FRAMES) {
      const n = silent + 1;
      setSilent(n);
      if (n >= SILENT_PASSES) {
        stop();
        setWaiting(true);
      }
      return;
    }
    setSilent(0);
    if (card.view === "score" || card.view === "fretboard") evidence.notes(card.tl.targets.map((t) => t.midi), card.steps, p.results, p.wrong, card.first, card.last);
    evidence.timing(p.at.slice(card.first, card.last + 1));
    const score = p.hit / p.total;
    if (card.run) {
      // a run-through: once, top to bottom, and it is what it was
      const bars = barShares(card, p.results);
      evidence.weak(bars.filter((b) => b.share < WEAK_BAR).map((b) => b.bar));
      runBars.current = bars;
      // the take is kept with what it scored
      const rec = take.current;
      take.current = null;
      const recordingId = `take-${crypto.randomUUID()}`;
      void keepPracticeWrite(finishTake({ id: recordingId, tuneId: card.tuneId, cardId: card.id, day: today(), at: Date.now(), bpm: assessedBpm.current, share: score, conditions: assessment.current, arrangementFingerprint: arrangementFor(card.tuneId) }, rec));
      conclude(score >= RUN_CLEAN && stableTempo ? "clean" : score >= card.pass ? "ok" : "fail", score, recordingId);
      return;
    }
    const all = [...passes, score];
    setPasses(all);
    // A setting changed partway through: the next complete pass establishes the new tempo.
    if (!stableTempo) {
      if (ending) finish();
      return;
    }
    const targets = card.tl.targets.slice(card.first, card.last + 1);
    const beatMs = 60000 / assessedBpm.current;
    const spacing = targets.slice(1).reduce((shortest, t, i) => Math.min(shortest, (t.t - targets[i].t) * beatMs || shortest), beatMs);
    const timing = assessTiming(p.at.slice(card.first, card.last + 1), assessedBpm.current, spacing);
    estimator.pass(score, timing.fit ? Math.max(timing.fit.spread, Math.abs(timing.fit.drift)) : null, beatMs);
    feel();
    const onTime = (card.view === "chords" && card.kind !== "comping") || card.kind === "improv" || timing.ready;
    if (ending) {
      if (score >= card.pass && onTime) conclude("ok", score);
      else finish();
      return;
    }
    if (score >= card.pass && !onTime) rhythmMisses.current++;
    const missed = all.filter((s) => s < card.pass).length + rhythmMisses.current;
    const sp = !spot && spotted < MAX_SPOTS && card.kind !== "improv" ? trouble?.pass(p.results) ?? null : null;
    if (score >= card.pass && onTime) {
      missRun.current = 0;
      if (assessedBpm.current >= target) {
        if (memoryExercise && !spot && memoryStage !== "hidden") {
          changeMemoryStage(memoryStage === "page" ? "landmarks" : "hidden");
          return;
        }
        conclude(slowed === 0 && backed === 0 && spotted === 0 && missed <= 1 ? "clean" : "ok", score);
        return;
      }
      // A steady pass earns the step; a constant phase offset never makes the step larger.
      const far = target - bpm > 12;
      setBpm(Math.min(target, bpm + (far ? STEP_UP_FAR : STEP_UP)));
      return;
    }
    missRun.current++;
    if (missed >= MAX_MISSED_PASSES) conclude("fail", Math.max(...all));
    else if (sp) {
      // the same bar short twice running: it is taken out and worked on, then the piece carries on
      missRun.current = 0;
      startSpot(sp, "time");
    } else if (score < MESSY && missRun.current >= 2 && card.pace) {
      // mostly wrong notes: the band steps back until the notes are there again
      missRun.current = 0;
      stop();
      follow.restart();
      chords.restart();
      setTakes({ clean: 0, unclean: 0 });
      setLastTake(null);
      setBacked((n) => n + 1);
      clock.current.event = performance.now();
      setPhase("pace");
    } else if (missRun.current >= 2 && bpm > minTempo) {
      // falling short at this tempo: it comes down, and so does where this visit is heading
      missRun.current = 0;
      const slower = Math.max(minTempo, bpm - STEP_DOWN);
      setBpm(slower);
      setTarget(slower);
      setSlowed((s) => s + 1);
    }
  }, [playback.lastPass]); // eslint-disable-line react-hooks/exhaustive-deps

  // the band waits: any steady note brings it back in
  const { subscribe } = input;
  useEffect(() => {
    if (!waiting || paused) return;
    let run = 0;
    let last: number | null = null;
    return subscribe((f) => {
      const m = midiOf(f);
      run = m !== null && m === last ? run + 1 : m !== null ? 1 : 0;
      last = m;
      if (run >= 4) {
        setSilent(0);
        setWaiting(false);
        setLoopKey((k) => k + 1);
      }
    });
  }, [waiting, paused, subscribe]);

  // result → next card
  useEffect(() => {
    if (phase !== "result" || paused) return;
    const id = window.setTimeout(
      () => {
        if (ending) finish();
        else if (pos + 1 < queue.length) setPos(pos + 1);
        else finish();
      },
      outcome?.result === "skip" ? SKIPPED_MS : RESULT_MS,
    );
    return () => window.clearTimeout(id);
  }, [phase, paused, pos, queue.length, finish, outcome, ending]);

  // ---------- reacting to silence, absence and a lost input ----------

  /** The passage once more, then back to where the player was. From the guitar, or by itself after a long silence. */
  const hear = useCallback(() => {
    if (!card || phase === "result") return;
    stop();
    hush();
    setWaiting(false);
    setPaused(false);
    setAway(false);
    clock.current.event = performance.now();
    if (phase === "pace" || phase === "time") returnTo.current = phase;
    if (phase === "listen") setListenKey((k) => k + 1);
    else setPhase("listen");
  }, [card, phase, stop]);

  useEffect(() => {
    if (!running || finished) return;
    return subscribe((f) => {
      // a pitch, or (strummed chords often have none) simply sound
      if (midiOf(f) !== null || f.rms > SOUND_RMS) clock.current.heard = f.now;
    });
  }, [running, finished, subscribe]);

  const everySecond = useRef<(now: number, quiet: number) => void>(() => undefined);
  everySecond.current = (now, quiet) => {
    if (!card || paused) return;
    if (selfGuided) return;
    if (quiet >= AWAY_MS && (phase === "pace" || phase === "time")) {
      stop();
      hush();
      setPaused(true);
      setAway(true);
      return;
    }
    if (phase !== "pace") return;
    if (memoryExercise && !spot && memoryStage !== "page") return; // recall stays quiet until help is requested
    const c = clock.current;
    const still = now - Math.max(c.heard, c.event);
    if (c.nudges >= NUDGES) {
      if (still >= REPLAY_MS) {
        c.nudges = 0;
        hear();
      }
    } else if (still >= (spot ? SPOT_NUDGE_MS : NUDGE_MS)) {
      c.nudges++;
      exposed.current = true;
      c.event = now;
      setNudge((n) => n + 1);
      const i = card.first + Math.min(paceIndex, card.last - card.first);
      const chord = card.context[i]?.chord;
      if (card.view === "chords") {
        if (chord) bassHint(40 + mod((chord.bass ?? chord.root) - 40));
      } else {
        hintNote(card.tl.targets[i].midi);
        if (spot && settings.voice) say(noteName(card, i));
      }
    }
  };
  const live = useRef({ paused, playing: playback.playing });
  live.current = { paused, playing: playback.playing };
  useEffect(() => {
    if (!running || finished) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const c = clock.current;
      const quiet = now - c.heard;
      // playing, or listening to the app play: not sitting in front of it
      if (!live.current.paused && (quiet < IDLE_MS || (live.current.playing && quiet < 3 * IDLE_MS) || (selfGuided && live.current.playing))) {
        c.active += dt;
        c.card += dt;
      }
      everySecond.current(now, quiet);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, finished, selfGuided]);

  // resting: a steady note wakes the session
  useEffect(() => {
    if (!away) return;
    let run = 0;
    let last: number | null = null;
    return subscribe((f) => {
      const m = midiOf(f);
      run = m !== null && m === last ? run + 1 : m !== null ? 1 : 0;
      last = m;
      if (run < 4) return;
      clock.current.event = f.now;
      setAway(false);
      setPaused(false);
      setLoopKey((k) => k + 1);
    });
  }, [away, subscribe]);

  // the input went away (unplugged, switched off): hold still, and carry on when it is back
  useEffect(() => {
    if (!running || finished || selfGuided) return;
    if (!listening && !paused) {
      lostInput.current = true;
      interrupted.current = true;
      stop();
      hush();
      setPaused(true);
    } else if (listening && lostInput.current) {
      lostInput.current = false;
      clock.current.event = performance.now();
      setPaused(false);
      setLoopKey((k) => k + 1);
    }
  }, [listening, running, finished, selfGuided]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- by hand: note keys on the guitar, the pad, keys or a pedal ----------

  const togglePause = useCallback(() => {
    if (!paused) {
      if (phase === "pace" || phase === "time") interrupted.current = true;
      stop();
      hush();
    } else {
      lostInput.current = false;
      clock.current.event = performance.now();
      if (phase === "time") setLoopKey((k) => k + 1);
    }
    setAway(false);
    setPaused(!paused);
  }, [paused, stop, phase]);

  const skip = useCallback(() => {
    if (!card) return;
    setPaused(false);
    setAway(false);
    if (spot && phase !== "result") endSpot();
    else if (phase === "intro" || phase === "listen") nextPhase(phase);
    else if (phase === "pace") {
      stop();
      enterTime();
    } else if (phase === "time") conclude("skip");
    else if (pos + 1 < queue.length) setPos(pos + 1);
    else finish();
  }, [card, phase, nextPhase, stop, conclude, pos, queue.length, finish, enterTime, spot, endSpot]);

  /** On to the next exercise, from wherever this one is. */
  const next = useCallback(() => {
    if (!card) return;
    setPaused(false);
    setAway(false);
    hush();
    if (phase !== "result") {
      let recordingId: string | undefined;
      if (selfGuided && card.run) {
        const rec = take.current;
        take.current = null;
        recordingId = `take-${crypto.randomUUID()}`;
        void keepPracticeWrite(finishTake({ id: recordingId, tuneId: card.tuneId, cardId: card.id, day: today(), at: Date.now(), bpm, share: null, conditions: conditionsFor(phase === "time" ? "fixed" : "own-pace"), arrangementFingerprint: arrangementFor(card.tuneId) }, rec));
      }
      conclude(selfGuided ? "ok" : "skip", null, recordingId);
    }
    else if (pos + 1 < queue.length) setPos(pos + 1);
    else finish();
  }, [card, phase, conclude, pos, queue.length, finish, selfGuided, bpm, options.arrangementFingerprint, options.arrangementFingerprints, tuneIds, guideMelody, nudge, follow.take, mix.shadow]);

  const finishAfterPass = useCallback(() => {
    if (phase === "result" || phase === "intro" || phase === "listen" || selfGuided || waiting || !listening) finish();
    else setEnding(true);
  }, [phase, selfGuided, waiting, listening, finish]);

  const continueWithoutScoring = useCallback(() => {
    setSelfGuided(true);
    setPaused(false);
    setAway(false);
    setWaiting(false);
    lostInput.current = false;
    interrupted.current = true;
    setPasses([]);
    setLastTake(null);
    setTakes({ clean: 0, unclean: 0 });
    setFlow(0.5);
    setRun(0);
    setLoopKey((value) => value + 1);
  }, []);

  /** Straight to one way of working on this exercise. */
  const go = useCallback(
    (to: "pace" | "time") => {
      if (!card || phase === "result") return;
      returnTo.current = null;
      stop();
      hush();
      setPaused(false);
      setAway(false);
      setWaiting(false);
      setSpot(null); // asking for the whole of it ends a part taken out
      clock.current.event = performance.now();
      if (to === "pace") {
        restartFollow();
        restartChords();
        setTakes({ clean: 0, unclean: 0 });
        setLastTake(null);
        setPhase("pace");
      } else if (phase === "time") setLoopKey((k) => k + 1);
      else enterTime();
    },
    [card, phase, stop, restartFollow, restartChords, enterTime],
  );

  const again = useCallback(() => {
    if (!card) return;
    stop();
    exposed.current = true;
    interrupted.current = true;
    setPaused(false);
    setAway(false);
    setWaiting(false);
    setTakes({ clean: 0, unclean: 0 });
    setLastTake(null);
    setPasses([]);
    setSilent(0);
    setSpot(null);
    restartFollow();
    restartChords();
    setPhase("intro");
  }, [card, stop, restartFollow, restartChords]);

  /** By hand: the tempo moves at once (the band doesn't stop), and so does where this visit is heading. */
  const tempo = useCallback((delta: number) => {
    const next = Math.min(maxTempo, Math.max(minTempo, bpm + delta));
    if (phase === "time" && next !== bpm) manualTempoChanged.current = true;
    setBpm(next);
    setTarget((t) => Math.min(maxTempo, Math.max(minTempo, t + delta)));
  }, [minTempo, maxTempo, bpm, phase]);

  useEffect(() => () => hush(), []);

  // ---------- what the screen shows ----------

  const results = useMemo((): NoteResult[] => {
    if (!card) return [];
    if (selfGuided) return card.tl.targets.map(() => null);
    if (phase === "pace" && card.view !== "chords") {
      const out: NoteResult[] = card.tl.targets.map(() => null);
      follow.results.forEach((r, i) => (out[card.first + i] = r));
      return out;
    }
    if (phase === "pace") return card.tl.targets.map((_, i) => (i >= card.first && i < card.first + chords.index ? "hit" : null));
    if (phase === "time") return playback.results.map((r, i) => (i >= card.first && i <= card.last ? r : null));
    return card.tl.targets.map(() => null);
  }, [card, phase, follow.results, chords.index, playback.results, selfGuided]);

  /** The pitch played in place of each missed note: drawn as a shadow next to it. */
  const shadows = useMemo((): (number | null)[] => {
    if (!card || card.view === "chords" || selfGuided) return [];
    const out: (number | null)[] = [];
    if (phase === "pace") follow.wrongAt.forEach((m, i) => (out[card.first + i] = follow.results[i] === "miss" ? m : null));
    else if (phase === "time") playback.wrong.forEach((m, i) => (out[i] = playback.results[i] === "miss" ? m : null));
    return out;
  }, [card, phase, follow.wrongAt, follow.results, playback.wrong, playback.results, selfGuided]);

  const active = !card
    ? -1
    : phase === "pace"
      ? card.view === "chords"
        ? chords.done
          ? -1
          : card.first + chords.index
        : follow.done
          ? -1
          : card.first + follow.index
      : playback.activeTarget >= 0
        ? playback.activeTarget
        : phase === "intro" || phase === "time"
          ? card.first
          : -1;

  /** "Hear it again" asked for by the player, not the silence: a sign the passage isn't in the ear yet. */
  const askHear = useCallback(() => {
    evidenceRef.current.hear();
    hear();
  }, [hear]);

  return {
    store,
    settings,
    updateSettings,
    setMeta,
    running,
    finished,
    selfGuided,
    ending,
    queue,
    pos,
    card,
    box,
    phase,
    paused,
    away,
    waiting,
    bpm,
    target,
    needClean,
    doListen,
    takes,
    lastTake,
    passes,
    slowed,
    backed,
    outcome,
    log,
    spot,
    spotted,
    spotAt,
    whole,
    follow,
    chords,
    playback: selfGuided ? { ...playback, lastPass: null, drift: null } : playback,
    beat: playback.beat,
    results,
    shadows,
    shadow: memoryExercise ? null : shadow,
    pulse,
    flow,
    run,
    nudge,
    // Do not flash the previous card's visible page before a hidden review's reset effect runs.
    memoryStage: memoryExercise ? spot ? "page" as const : memoryVisit.current === cardKey ? memoryStage : initialMemory.stage : null,
    memoryReview: initialMemory.review,
    toggleMemoryPage: () => changeMemoryStage(memoryStage === "page" ? "landmarks" : "page", true),
    keys,
    active,
    click,
    setClick,
    start,
    begin,
    finish,
    finishAfterPass,
    continueWithoutScoring,
    keepGoing,
    exit,
    togglePause,
    skip,
    next,
    go,
    hear: askHear,
    again,
    tempo,
    listeningOff: !listening && !selfGuided,
    /** Time spent playing this session, in ms: sitting in front of it doesn't count. */
    elapsed: () => (running ? clock.current.active : 0),
  };
}

export type SessionApi = ReturnType<typeof useSession>;

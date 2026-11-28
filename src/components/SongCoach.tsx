import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { useOutputs } from "../audio/output";
import type { FretNote, NoteResult, Position, ReadingBar } from "../core/contract";
import { OPEN_MIDI } from "../core/scales";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { mod, pitchClassToName } from "../musicTheory";
import { assignNoteKeys, commandMidis, SUMMON_NOTE } from "../song/notekeys";
import { createStartPhrase, START_PHRASE_LENGTH } from "../song/startPhrase";
import { melodyOverChords } from "../tunes/learn";
import type { LeadSheet } from "../tunes/musicxml";
import { printedResults, type Timeline } from "../tunes/order";
import { flowOf } from "../tunes/flow";
import { useScoreZoom } from "../song/scoreZoom";
import { buildDeck, FAMILY_LABEL, familiesOnly, findCard, FOCUS_FAMILIES, FOCUS_LABEL, mixDecks, noteName as spelled, rhythmSourceId, wholeTuneCard, type Card, type Context, type Deck, type Focus } from "../song/deck";
import { rhythmSheet } from "../song/rhythm";
import { arrangementIdentity, goalDeck, loadActiveGoal } from "../song/goals";
import { buildCurriculumCards, isCurriculumStudyId, mergeCurriculumIntoDeck, useCurriculum } from "../song/curriculum";
import { isCustomExerciseId, useCustomExercises } from "../song/customExercises";
import { useGoals } from "../song/useGoals";
import { fitTiming, timingTolerance } from "../tunes/scoring";
import { localId } from "../song/ids";
import { lineSheet, signatureFor } from "../song/notation";
import { analyzeWrongNote, mistakeDeltaText, type StaffShadowInfo } from "../song/staffShadow";
import { makeScale, nice, pretty, spellIn } from "../song/harmony";
import { allStores, BOXES, boxCounts, isExcluded, loadStore, loadStores, saveMeta, today, type LoopMode, type Store } from "../song/leitner";
import { cardSeconds, LENGTH_MINUTES, LENGTHS, loadArc, planBlocks, ROLE_LABEL, saveArc, type Role, type SessionPlan } from "../song/planner";
import { currentInputSetup } from "../audio/setup";
import { allAttempts, buildProfile } from "../song/profile";
import { latencyMeasured } from "../audio/latency";
import { fingerFor } from "../song/spot";
import { useSession, type Outcome, type SessionApi } from "../song/useSession";
import { clearPartialSession, loadPartialSession, partialSessionProgress, resolvePartialSession, savePartialSession, type PartialSession, type SessionSnapshot } from "../song/resume";
import { ChordBox } from "./ChordBox";
import { loadProfile } from "../listen/calibration";
import { Calibrate } from "./Calibrate";
import { Ear } from "./Ear";
import { FreePlay } from "./FreePlay";
import { drawerToneKeys, GuitarPad, NoteTag, noteName as keyName, SummonVisual, ToneTag, toneKeysFor, useNoteKeys, useSummon, useToneKeys, type PadRow } from "./GuitarPad";
import { Fretboard, type FretGhost, type FretPulse, type LabelMode } from "./Fretboard";
import { BeatPulse, PracticeAtmosphere } from "./PracticeAtmosphere";
import { readNoteBoxes } from "../song/noteBoxes";
import { Score } from "./Score";
import { ScoreFlow } from "./ScoreFlow";
import { SessionSummary } from "./SessionSummary";
import { RecordingRecovery, RecordingStatus } from "./RecordingStatus";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import { settlePracticeWrites } from "../platform/practiceWindow";
import { TunePicker } from "./TunePicker";
import { useSessionSet } from "../song/sessionSet";
import { chooseShape, keepOwnShape, useShapeBook } from "../song/shapeBook";
import { knownLine, placeOwn, shapeFrets, shapeLine, shapeOptions, variantId, type ShapeBook, type ShapeOption } from "../song/scaleShapes";
import { useHeardPass } from "../song/useHeardPass";
import { GuitarToolsRoom } from "../tools/GuitarTools";
import { TuneCheck, isTuned } from "../tools/TuneCheck";
import { PoolRoom, usePoolCalm, usePoolEmit } from "../pool/PoolRoom";
import { ROOM_MODES, useRoomRender, type RoomMode } from "../pool/mode";
import { MAX_NAV_SILENCE_S, MIN_NAV_SILENCE_S, useNavSilence } from "../nav/silence";
import { Glyph } from "./Glyph";
import "../song/song.css";
import "../song/coach-flow.css";

// The practice session, quiet under the shell's header: one exercise at a time, hands on the guitar. The
// guitar runs it: hold a note to begin, play to move on, start over whenever. Single notes the
// exercise doesn't use are keys (hear it again, your pace, in time, next), each shown beside
// what it works; the menu note (D♯5: hold, release, hold) calls the menu. Everything else
// (settings, the card box, the plan) lives behind the gear; keys and a pedal still work.

interface SongCoachProps {
  sheet: LeadSheet;
  tl: Timeline;
  input: InputApi;
  onClose(): void;
  tunes?: { id: string; title: string }[]; // the library, to move to another tune from the guitar
  onTune?(id: string): void | Promise<void>;
  others?: { sheet: LeadSheet; tl: Timeline }[]; // the library's other tunes: their exercises can be mixed into the session
  mixIds?: readonly string[]; // explicit guest IDs for a tree selection (solo = [], key/custom mix = [...])
  focus?: Focus; // a tutor mode: only that mode's card families
  initialCardId?: string; // an exercise chosen on the overview or a focused mode
  /** Start running `initialCardId` immediately on mount, skipping the Ready lobby. */
  autoStart?: boolean;
  /** Behind another tab: no input reaches the room, the session holds still, the pool rests. */
  parked?: boolean;
  /** Lets the host finish and save the session before it replaces the room's music. */
  handle?: MutableRefObject<RoomHandle | null>;
  /** Whether a session is under way, for the Play tab's live mark while parked. */
  onLive?(live: boolean): void;
  /** Which surface inside the room is visible, so the shell's topbar and water stay in sync. */
  onSurface?(surface: RoomSurface): void;
  /** The shell asks the room for its own instruments or free play (a new serial each time), so they never compete with it. */
  request?: RoomRequest;
  /** The last request carried out, kept outside the tune-keyed room so a tune change does not repeat it. */
  served?: MutableRefObject<number>;
}

export type RoomSurface = "practice" | "free" | "tuner" | "metronome";

export interface RoomRequest {
  serial: number;
  kind: "practice" | "tuner" | "metronome" | "free" | "settings";
}

export interface RoomHandle {
  /** End the session (recording what was played) and wait for practice saves. */
  leave(): Promise<void>;
}

/** The room's view of the shared input: frames stop while it is parked behind another tab. */
function useParkedInput(input: InputApi, parked: boolean): InputApi {
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  const { subscribe } = input;
  const gated = useCallback<InputApi["subscribe"]>((fn) => subscribe((frame) => { if (!parkedRef.current) fn(frame); }), [subscribe]);
  return useMemo(() => ({ ...input, subscribe: gated }), [input, gated]);
}

const FRET_COUNT = 12;
const PAGE = 8; // notes of a long run shown on the fretboard at once
const IDLE_MS = 2600; // then the corner buttons and the cursor fade
// A♯: free · C♯: settings · G♯: mix · F: length · E♭: self · F♯: tune · C: instruments. Every pitch class
// off the open strings is in use; the metronome is one switch inside the instruments room.
const READY_KEYS = [46, 49, 56, 53, 51, 54, 48];
type RoomTool = "tuner" | "metronome";
const NECK_MS = 7000; // the neck stays this long after it was called for
const NO_TUNES: { sheet: LeadSheet; tl: Timeline }[] = [];
const IV_LABEL: Record<number, string> = { 0: "R", 1: "♭9", 2: "9", 3: "♭3", 4: "3", 5: "4", 6: "♭5", 7: "5", 8: "♯5", 9: "6", 10: "♭7", 11: "7" };
const SCALE_DEGREE = ["1", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"];
const TENSION: Record<number, string> = { 1: "♭9", 2: "9", 3: "♯9", 5: "11", 6: "♯11", 8: "♭13", 9: "13" };

// ---------- shadow notes: what was played instead ----------

/** `midi` brought into the octave around `want`: the mistake is the interval, not the octave. */
function foldNear(midi: number, want: number): number {
  let m = midi;
  while (m - want > 6) m -= 12;
  while (want - m > 6) m += 12;
  return m;
}

/**
 * Where on the neck a wrong note was most likely played. A pitch can sit on several strings; the
 * hand is in position, so the spot inside it wins, and among those the one nearest the note that
 * was meant.
 */
function ghostSpot(midi: number, to: { string: number; fret: number }, p: number): { string: number; fret: number } | null {
  const want = OPEN_MIDI[to.string] + to.fret;
  const m = foldNear(midi, want);
  if (m === want) return null;
  let best: { string: number; fret: number } | null = null;
  let cost = Infinity;
  for (let s = 0; s < 6; s++) {
    const fret = m - OPEN_MIDI[s];
    if (fret < 0 || fret > FRET_COUNT) continue;
    const away = fret >= p && fret <= p + 3 ? 0 : fret >= p - 1 && fret <= p + 4 ? 1.6 : 4 + Math.min(Math.abs(fret - p), Math.abs(fret - p - 3));
    const c = away + 0.45 * Math.abs(fret - to.fret) + 0.35 * Math.abs(s - to.string);
    if (c < cost) {
      cost = c;
      best = { string: s, fret };
    }
  }
  return best;
}

/** What sounded, spelled the way the harmony under it spells its notes. */
const playedName = (ctx: Context | null | undefined, midi: number) => (ctx ? spellIn(ctx.scale, midi) : nice(pitchClassToName(mod(midi))));

/** A note's job: its scale degree in a scale drill, else chord tone (R 3 5 7) or tension (9 11 13) over the chord. */
function degreeOf(family: Card["family"], ctx: Context | null, pc: number): string {
  if (!ctx) return "";
  if (family === "scales" || !ctx.chord) return SCALE_DEGREE[mod(pc - ctx.scale.root)];
  const c = ctx.chord;
  const iv = mod(pc - c.root);
  if (c.tones.includes(iv)) return iv === 9 && c.kind === "dim" ? "°7" : IV_LABEL[iv];
  return TENSION[iv] ?? IV_LABEL[iv];
}

type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };

function streak(store: Store): number {
  const days = new Set(store.sessions.map((s) => s.date));
  let n = 0;
  const d = new Date();
  if (!days.has(today(d))) d.setDate(d.getDate() - 1);
  while (days.has(today(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** The notes of the shape being played, coloured by their job in the chord sounding now. */
function boardNotes(ctx: Context | null, p: number, family: Card["family"], shape: Set<string>): FretNote[] {
  if (!ctx) return [];
  const { chord, scale, next } = ctx;
  const natural = scale.kind === "harmonicMinor" || scale.kind === "melodicMinor" ? makeScale(scale.root, "naturalMinor") : null;
  const guides = chord ? [chord.third, chord.seventh ?? null].filter((x): x is number => x !== null).map((iv) => mod(chord.root + iv)) : [];
  const nextGuides =
    next && chord && next.symbol !== chord.symbol ? [next.third, next.seventh ?? next.fifth].filter((x): x is number => x !== null).map((iv) => mod(next.root + iv)) : [];
  const out: FretNote[] = [];
  for (let s = 0; s < 6; s++)
    for (let fret = 0; fret <= FRET_COUNT; fret++) {
      const midi = OPEN_MIDI[s] + fret;
      const pc = mod(midi);
      const inChord = chord?.pcs.includes(pc) ?? false;
      if (!shape.has(`${s}-${fret}`)) continue;
      const role: FretNote["role"] =
        chord && pc === chord.root ? "root" : guides.includes(pc) ? "guideTone" : inChord ? "chordTone" : natural && !natural.pcs.includes(pc) ? "changed" : "scale";
      const i = scale.pcs.indexOf(pc);
      out.push({
        string: s,
        fret,
        pc,
        midi,
        name: i >= 0 ? scale.names[i] : nice(pitchClassToName(pc)),
        degree: degreeOf(family, ctx, pc),
        role,
        inWindow: fret >= p - 1 && fret <= p + 4,
        isNextTarget: nextGuides.includes(pc),
      });
    }
  return out;
}

/** The run of notes over the chord sounding now; long runs a page at a time. */
function segmentOf(card: Card, active: number): { from: number; to: number } {
  const a = Math.max(card.first, Math.min(card.last, active));
  const sym = (i: number) => card.context[i]?.chord?.symbol ?? "";
  let from = a;
  let to = a;
  while (from > card.first && sym(from - 1) === sym(a)) from--;
  while (to < card.last && sym(to + 1) === sym(a)) to++;
  if (to - from + 1 > PAGE) {
    from += Math.floor((a - from) / PAGE) * PAGE;
    to = Math.min(to, from + PAGE - 1);
  }
  return { from, to };
}


/** The steps over the chord sounding now, as fretboard spots: the shape under the hand. */
function shapeOf(card: Card, active: number): { key: string; spots: Set<string> } {
  const a = Math.max(card.first, Math.min(card.last, active));
  const sym = (i: number) => card.context[i]?.chord?.symbol ?? "";
  let from = a;
  let to = a;
  while (from > card.first && sym(from - 1) === sym(a)) from--;
  while (to < card.last && sym(to + 1) === sym(a)) to++;
  const spots = new Set<string>();
  for (let i = from; i <= to; i++) {
    const st = card.steps[i];
    if (st) spots.add(`${st.string}-${st.fret}`);
  }
  return { key: `${card.id}:${from}:${to}`, spots };
}

/** Prime sound from the opening click; a new microphone permission remains an explicit choice. Fullscreen is the player's own choice (settings). */
export function openPractice(input: InputApi) {
  ensureAudio();
  void Tone.start().catch(() => undefined);
  if (input.status === "idle" || input.status === "error") input.autoStart();
}

/** The pitch classes a card plays, chords included: tone keys are picked from outside them. */
function pitchClassesOf(card: Card): number[] {
  return card.tl.targets.slice(card.first, card.last + 1).flatMap((t) => (t.chord ? [...t.chord.voicing, ...t.chord.required] : t.any ?? [t.midi])).map((m) => mod(m));
}

/** True once the mouse has been still for a while. */
function useIdle(enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let id = window.setTimeout(() => setIdle(true), IDLE_MS);
    const on = () => {
      setIdle(false);
      window.clearTimeout(id);
      id = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener("mousemove", on);
    window.addEventListener("mousedown", on);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousemove", on);
      window.removeEventListener("mousedown", on);
    };
  }, [enabled]);
  return idle;
}

/** The guitar's start phrase: any 3 distinct fretted notes in succession. Fills the listening ring in 3 clear steps; open strings stay free for tuning, and single held notes never trigger it. */
function useStartPhrase(input: InputApi, enabled: boolean, onStart: () => void): { ring: RefObject<SVGCircleElement>; notes: number[] } {
  const ring = useRef<SVGCircleElement>(null);
  const [notes, setNotes] = useState<number[]>([]);
  const cb = useRef(onStart);
  cb.current = onStart;
  const listening = input.status === "listening" && !input.paused;
  const { subscribe } = input;
  useEffect(() => {
    const setRing = (p: number) => {
      if (ring.current) ring.current.style.strokeDashoffset = String(1 - p);
    };
    setRing(0);
    setNotes([]);
    if (!enabled || !listening) return;
    const tracker = createStartPhrase();
    let shownKey = "";
    return subscribe((f) => {
      const state = tracker.step(midiOf(f), f.now);
      setRing(state.progress);
      const nextKey = state.notes.join(",");
      if (nextKey !== shownKey) {
        shownKey = nextKey;
        setNotes(state.notes);
      }
      if (state.fired) cb.current();
    });
  }, [enabled, listening, subscribe]);
  return { ring, notes };
}

/** How often each exercise of a tune has been played: decides what its reading exercises bring next. */
const seenIn = (tuneId: string) => Object.fromEntries(Object.entries(loadStore(tuneId).cards).map(([id, st]) => [id, st.seen]));

export function SongCoach(props: SongCoachProps) {
  const input = useParkedInput(props.input, Boolean(props.parked));
  const served = useRef(0);
  // The pool sits outside the keyed room so its water keeps moving when the tune changes.
  return <PracticeWindowBoundary onExit={props.onClose}><PoolRoom input={input} parked={props.parked}><SongCoachRoom key={props.sheet.id} {...props} input={input} served={served} /></PoolRoom></PracticeWindowBoundary>;
}

/** The practice room must remain inside a stable PracticeWindowBoundary while changing tunes. */
export function SongCoachRoom({ sheet, tl, input, onClose, onTune, others = NO_TUNES, mixIds, focus = "all", initialCardId, autoStart = false, parked = false, handle, onLive, onSurface, request, served: servedRef }: SongCoachProps) {
  const explicitMix = mixIds !== undefined;
  const [windowP, setWindowP] = useState<number | null>(() => loadStore(sheet.id).settings.window);
  const [mix, setMix] = useState(() => (explicitMix ? mixIds.length > 0 : loadStore(sheet.id).settings.mix !== false)); // the other tunes' exercises too
  // reading exercises bring new notes whenever this changes: every day, and after every session
  const [round, setRound] = useState(() => `${today()}:${loadStore(sheet.id).sessions.length}`);
  const shapeBook = useShapeBook();
  const curriculum = useCurriculum();
  const customExercises = useCustomExercises();
  const isCurriculumHost = isCurriculumStudyId(sheet.id);
  const rawOwn = useMemo(() => buildDeck(sheet, tl, { window: windowP ?? undefined, round, seen: seenIn(sheet.id), rhythmFrom: rhythmSourceId(initialCardId), passageFrom: initialCardId, shapes: shapeBook }), [sheet, tl, windowP, round, initialCardId, shapeBook]);
  const goals = useGoals();
  const activeGoal = useMemo(() => (isCurriculumHost ? null : loadActiveGoal(sheet, rawOwn)), [isCurriculumHost, sheet, rawOwn, goals]);
  const own = useMemo(() => goalDeck(rawOwn, activeGoal), [rawOwn, activeGoal]);
  const arrangementFingerprint = useMemo(() => arrangementIdentity(sheet).fingerprint, [sheet]);
  const focused = useMemo(() => (focus === "all" ? own : familiesOnly(own, FOCUS_FAMILIES[focus])), [focus, own]);
  // the songs chosen for the session; a change made while a session runs applies to the next one
  const roomIds = useMemo(() => [sheet.id, ...others.map((o) => o.sheet.id)], [sheet.id, others]);
  const sessionSet = useSessionSet(roomIds);
  const setKey = sessionSet.ids.join("\u0000");
  const [mixKey, setMixKey] = useState(() => (explicitMix ? mixIds.join("\u0000") : setKey));
  const mixable = useMemo(() => {
    const chosen = new Set(mixKey ? mixKey.split("\u0000") : []);
    return others.filter((o) => chosen.has(o.sheet.id));
  }, [others, mixKey]);
  const guests = useMemo(
    () =>
      isCurriculumHost || (!explicitMix && focus !== "all")
        ? []
        : mix
          ? mixable.map((o) => {
              const built = buildDeck(o.sheet, o.tl, { window: loadStore(o.sheet.id).settings.window ?? undefined, round, seen: seenIn(o.sheet.id), shapes: shapeBook });
              return { tuneId: o.sheet.id, sheet: o.sheet, deck: focus === "all" ? built : familiesOnly(built, FOCUS_FAMILIES[focus]) };
            })
          : [],
    [isCurriculumHost, explicitMix, focus, mix, mixable, round, shapeBook],
  );
  const mixedDeck = useMemo(() => mixDecks(focused, guests), [focused, guests]);
  const includeCurriculum = isCurriculumHost || (!explicitMix && focus === "all" && mix);
  const curriculumCards = useMemo(
    () =>
      includeCurriculum
        ? buildCurriculumCards(curriculum, customExercises, shapeBook, isCustomExerciseId(initialCardId) ? initialCardId : undefined)
        : [],
    [includeCurriculum, curriculum, customExercises, shapeBook, initialCardId],
  );
  const deck = useMemo(
    () => (curriculumCards.length ? mergeCurriculumIntoDeck(mixedDeck, curriculumCards, isCurriculumHost) : mixedDeck),
    [mixedDeck, curriculumCards, isCurriculumHost],
  );
  const tuneIds = useMemo(() => [sheet.id, ...guests.map((g) => g.tuneId)], [sheet.id, guests]);
  const sheets = useMemo(() => new Map<string, LeadSheet>([[sheet.id, sheet], ...guests.map((g) => [g.tuneId, g.sheet] as [string, LeadSheet])]), [sheet, guests]);
  const arrangementFingerprints = useMemo(() => new Map([...sheets].map(([id, score]) => [id, arrangementIdentity(score).fingerprint])), [sheets]);
  const [direct] = useState(() => {
    if (!autoStart || !initialCardId) return null;
    const card = findCard(deck.cards, initialCardId);
    if (!card) return null;
    const soloLaunch = Boolean(card.once || card.run || card.step?.kind === "tune" || card.followedBy || card.id.startsWith("mel:passage:"));
    if (soloLaunch) {
      const ids = [card.id, ...(card.followedBy ? [card.followedBy] : [])];
      return {
        ids,
        blocks: [{ role: "focus" as const, cards: ids, minutes: 2 }],
        why: card.followedBy ? "Rhythm, then the phrase" : "",
      };
    }
    const initialStore = loadStores(tuneIds);
    const day = today();
    const profile = buildProfile(allAttempts(allStores()), day, latencyMeasured());
    const lengthPref = initialStore.settings.length ?? "normal";
    const planned = planBlocks(deck, initialStore, day, { minutes: LENGTH_MINUTES[lengthPref], tuneId: sheet.id, profile, arc: loadArc(), goal: activeGoal });
    const rest = planned.ids.filter((id) => id !== card.id);
    if (!rest.length) {
      for (const id of deck.intro) {
        if (id === card.id || isExcluded(initialStore.cards[id])) continue;
        const c = deck.cards.find((entry) => entry.id === id);
        if (!c || c.once) continue;
        rest.push(id);
        if (rest.length >= 3) break;
      }
    }
    const ids = [card.id, ...rest];
    const blocks: SessionPlan["blocks"] = rest.length
      ? [
          { role: "focus" as const, cards: [card.id], minutes: 2 },
          ...planned.blocks.map((b) => ({ ...b, cards: b.cards.filter((id) => id !== card.id) })).filter((b) => b.cards.length),
        ]
      : [{ role: "focus" as const, cards: [card.id], minutes: 2 }];
    return { ids, blocks, why: planned.why };
  });
  const [gapIds, setGapIds] = useState<ReadonlySet<string>>(() => new Set()); // a focus on time: these play with gaps in the band
  const [sessionBlocks, setSessionBlocks] = useState<SessionPlan["blocks"]>(() => direct?.blocks ?? []);
  const outputs = useOutputs();
  const [labels, setLabels] = useState<LabelMode>("names");
  const [menu, setMenu] = useState(false);
  const [free, setFree] = useState(false); // free play: nothing asked, a click that follows the player
  const [freeInstruments, setFreeInstruments] = useState(false);
  const [tuned, setTuned] = useState(isTuned);
  const [choosingTune, setChoosingTune] = useState(false);
  const [tools, setTools] = useState<RoomTool | null>(null);
  const [full, setFull] = useState(() => Boolean(document.fullscreenElement));
  const [pad, setPad] = useState<number | null>(null); // the guitar's own menu: which page is up
  const [calib, setCalib] = useState(() => !loadProfile() && input.status !== "idle" && input.status !== "error");
  const checkedSetups = useRef(new Set<string>());
  const skippedPendingSetup = useRef(false);
  const idle = useIdle(!parked && !menu && !choosingTune && !tools && !freeInstruments);
  const pausedByMenu = useRef(false);
  const pausedByChooser = useRef(false);
  const pausedByTools = useRef(false);
  const switchStopped = useRef(false);
  const themeSources = useMemo(() => [{ id: sheet.id, title: sheet.title, tl }, ...others.map((other) => ({ id: other.sheet.id, title: other.sheet.title, tl: other.tl }))], [sheet.id, sheet.title, tl, others]);
  const session = useSession(deck, tuneIds, input, { gap: gapIds, arrangementFingerprint, arrangementFingerprints, tempoBounds: activeGoal?.tempo, suspended: parked || choosingTune || Boolean(tools) || free || menu || pad !== null || calib, initialQueue: direct?.ids });
  // Decoration only: the pool hears clean passes, streaks and exercise moves; nothing comes back.
  // Tracked synchronously via ref so landing a note never triggers a second full room re-render.
  usePoolCalm(menu || calib);
  const emitPool = usePoolEmit();
  const pooled = useRef<{ outcome: unknown; pos: number | null; hits: number; run: number; serial: number; notifiedOutcome: unknown; notifiedRun: number }>({
    outcome: session.outcome,
    pos: null,
    hits: 0,
    run: 0,
    serial: 0,
    notifiedOutcome: session.outcome,
    notifiedRun: 0,
  });
  const currentHits = useMemo(
    () => (session.results ?? []).filter((r) => r === "hit").length,
    [session.results],
  );
  if (currentHits > pooled.current.hits) pooled.current.serial++;
  pooled.current.hits = currentHits;
  if (session.run > pooled.current.run) pooled.current.serial++;
  pooled.current.run = session.run;
  if (session.outcome !== pooled.current.outcome) {
    pooled.current.outcome = session.outcome;
    if (session.outcome?.result === "clean") pooled.current.serial++;
  }
  const hitSerial = pooled.current.serial;
  const lastHealHit = useRef(hitSerial);
  useEffect(() => {
    if (hitSerial > lastHealHit.current) {
      if (session.decay > 0) emitPool({ kind: "heal", strength: 0.55 });
    }
    lastHealHit.current = hitSerial;
  }, [hitSerial, session.decay, emitPool]);
  const lastMissPooled = useRef(session.missSerial);
  useEffect(() => {
    if (session.missSerial > lastMissPooled.current) {
      emitPool({ kind: "decay", strength: 0.42, tone: "miss" });
    }
    lastMissPooled.current = session.missSerial;
  }, [session.missSerial, emitPool]);
  useEffect(() => {
    if (session.run > pooled.current.notifiedRun && session.run >= 12 && session.run % 12 === 0) {
      emitPool({ kind: "bloom", strength: 0.42, at: "focus" });
    }
    pooled.current.notifiedRun = session.run;
  }, [session.run, emitPool]);
  useEffect(() => {
    if (session.outcome === pooled.current.notifiedOutcome) return;
    pooled.current.notifiedOutcome = session.outcome;
    if (session.outcome?.result === "clean") {
      emitPool({ kind: "bloom", strength: session.outcome.newBest ? 1 : 0.85, at: "focus" });
    } else if (session.outcome?.result === "fail") {
      emitPool({ kind: "decay", strength: 0.78, tone: "miss" });
    }
  }, [session.outcome, emitPool]);
  const lastLiftKey = useRef(0);
  useEffect(() => {
    if (session.tempoLift && session.tempoLift.key !== lastLiftKey.current) {
      lastLiftKey.current = session.tempoLift.key;
      emitPool({ kind: "bloom", strength: 0.55, at: "focus" });
    }
  }, [session.tempoLift, emitPool]);
  const lastPassLen = useRef(0);
  useEffect(() => {
    const passLog = session.passLog ?? [];
    const len = passLog.length;
    if (len > lastPassLen.current) {
      const latest = passLog[len - 1];
      if (latest && !latest.clean && !latest.settle) {
        emitPool({ kind: "decay", strength: latest.reason === "timing" ? 0.45 : 0.72, tone: latest.reason === "timing" ? "drift" : "miss" });
      }
    }
    lastPassLen.current = len;
  }, [session.passLog, emitPool]);
  useEffect(() => {
    if (pooled.current.pos !== null && pooled.current.pos !== session.pos) {
      emitPool({ kind: "sweep", direction: session.pos > pooled.current.pos ? 1 : -1 });
    }
    pooled.current.pos = session.pos;
  }, [session.pos, emitPool]);

  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    let gone = false;
    let wake: { release(): Promise<void> } | null = null;
    (navigator as WakeLockNav).wakeLock
      ?.request("screen")
      .then((w) => {
        if (gone) void w.release().catch(() => undefined);
        else wake = w;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      document.removeEventListener("fullscreenchange", on);
      void wake?.release().catch(() => undefined);
    };
  }, []);

  // the tune's name and key travel with its box, for the map across tunes
  const { setMeta } = session;
  const homeKey = deck.harmony.home.id;
  useEffect(() => setMeta({ title: sheet.title, key: homeKey }), [setMeta, sheet.title, homeKey]);
  useEffect(() => guests.forEach((g) => saveMeta(g.tuneId, { title: g.sheet.title, key: g.deck.harmony.home.id })), [guests]);

  const { store, running, finished } = session;
  const [chosenCard, setChosenCard] = useState(() => (direct ? undefined : initialCardId));
  const [partialRev, setPartialRev] = useState(0);
  const partial = useMemo<PartialSession | null>(
    () => (!running && !chosenCard ? resolvePartialSession(loadPartialSession(sheet.id, focus), deck) : null),
    [running, chosenCard, sheet.id, focus, deck, partialRev],
  );
  const persistPartial = useCallback(
    (snap: SessionSnapshot | null | undefined, clearWhenEmpty = false) => {
      if (snap) {
        savePartialSession({
          v: 1,
          tuneId: sheet.id,
          focus,
          savedAt: Date.now(),
          day: today(),
          ...snap,
          blocks: sessionBlocks,
          gapIds: [...gapIds],
        });
      } else if (clearWhenEmpty) {
        clearPartialSession(sheet.id, focus);
      }
    },
    [sheet.id, focus, sessionBlocks, gapIds],
  );
  const persistRef = useRef({ running, session, persistPartial });
  persistRef.current = { running, session, persistPartial };
  useEffect(() => {
    if (!running) return;
    const snap = session.snapshot?.();
    if (snap) persistPartial(snap);
    else if (finished) clearPartialSession(sheet.id, focus);
  }, [running, finished, session.pos, session.queue, session.log, session.phase, session.selfGuided, sheet.id, focus, persistPartial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onUnload = () => {
      const p = persistRef.current;
      if (!p.running) return;
      const snap = p.session.snapshot?.();
      if (snap) p.persistPartial(snap);
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
  const inputSetup = currentInputSetup();
  const setupKey = inputSetup ? `${inputSetup.deviceId}:${inputSetup.sampleRate}` : null;
  useEffect(() => {
    if (running || choosingTune || tools || input.status !== "listening" || input.paused || !setupKey || checkedSetups.current.has(setupKey)) return;
    checkedSetups.current.add(setupKey);
    if (skippedPendingSetup.current) {
      skippedPendingSetup.current = false;
      return;
    }
    if (!loadProfile()) setCalib(true);
  }, [running, choosingTune, tools, input.status, input.paused, setupKey]);
  // the player across every box, and the session planned from it: warm-up, focus, review, music
  const length = store.settings.length ?? "normal";
  const unavailablePassage = Boolean(chosenCard?.startsWith("mel:passage:") && !deck.cards.some((card) => card.id === chosenCard));
  const shaped = useMemo<SessionPlan>(() => {
    const chosen = findCard(deck.cards, chosenCard);
    if (chosen) {
      const ids = [chosen.id, ...(chosen.followedBy ? [chosen.followedBy] : [])];
      const minutes = Math.max(1, Math.ceil(ids.length * cardSeconds(store)[chosen.family] / 60));
      return { ids, blocks: [{ role: "focus", cards: ids, minutes }], minutes, why: chosen.followedBy ? "Rhythm, then the phrase" : "Selected exercise", arc: null };
    }
    if (unavailablePassage) return { ids: [], blocks: [], minutes: 0, why: "This passage is unavailable in the current arrangement. Choose it again in Songs.", arc: null };
    const day = today();
    const profile = buildProfile(allAttempts(allStores()), day, latencyMeasured());
    return planBlocks(deck, store, day, { minutes: LENGTH_MINUTES[length], tuneId: sheet.id, profile, arc: loadArc(), goal: activeGoal });
  }, [chosenCard, deck, store, length, sheet.id, activeGoal, unavailablePassage]);
  const plan = shaped.ids;
  const cycleLength = () => {
    if (!live) session.updateSettings({ length: LENGTHS[(LENGTHS.indexOf(length) + 1) % LENGTHS.length] });
  };

  const close = () => {
    const wasRunning = running;
    const saved = session.exit();
    if (wasRunning) persistPartial(saved, true);
    setPartialRev((n) => n + 1);
    onClose();
  };
  const resumePartial = () => {
    if (calib || menu || free || choosingTune || tools || !partial) return;
    setGapIds(new Set(partial.gapIds));
    setSessionBlocks(partial.blocks);
    session.resumeFrom(partial);
    setChosenCard(undefined);
  };
  const discardPartial = () => {
    clearPartialSession(sheet.id, focus);
    setPartialRev((n) => n + 1);
  };
  const beginNow = (self = false) => {
    if (calib || menu || free || choosingTune || tools || !plan.length) return;
    clearPartialSession(sheet.id, focus);
    saveArc(shaped.arc);
    const onTime = shaped.arc && ["rushing", "dragging", "unsteady"].includes(shaped.arc.cls);
    setGapIds(new Set(onTime ? shaped.blocks.find((b) => b.role === "focus")?.cards ?? [] : []));
    setSessionBlocks(shaped.blocks);
    if (self) session.begin(plan, true);
    else session.begin(plan);
    setChosenCard(undefined);
  };
  const beginFromCard = (cardId: string) => {
    if (calib || menu || free || choosingTune || tools) return;
    clearPartialSession(sheet.id, focus);
    const rest = plan.filter((id) => id !== cardId);
    const ordered = [cardId, ...rest];
    saveArc(shaped.arc);
    const onTime = shaped.arc && ["rushing", "dragging", "unsteady"].includes(shaped.arc.cls);
    setGapIds(new Set(onTime ? shaped.blocks.find((b) => b.role === "focus")?.cards ?? [] : []));
    setSessionBlocks(rest.length ? [{ role: "focus", cards: [cardId], minutes: 2 }, ...shaped.blocks.map((b) => ({ ...b, cards: b.cards.filter((id) => id !== cardId) })).filter((b) => b.cards.length)] : [{ role: "focus", cards: [cardId], minutes: 2 }]);
    session.begin(ordered);
    setChosenCard(undefined);
  };
  const beginCard = (cardId: string) => {
    if (calib || menu || free || choosingTune || tools) return;
    clearPartialSession(sheet.id, focus);
    setGapIds(new Set());
    setSessionBlocks([{ role: "focus", cards: [cardId], minutes: 2 }]);
    session.begin([cardId]);
    setChosenCard(undefined);
  };
  const wholeCard = useMemo(() => wholeTuneCard(own), [own]);
  const hearCard = useMemo(() => own.cards.find((c) => c.once && c.step?.kind === "hear"), [own]);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  // the session holds still while the settings are open
  const openMenu = () => {
    if (tools) return;
    if (running && !finished && !session.paused) {
      session.togglePause();
      pausedByMenu.current = true;
    }
    setMenu(true);
  };
  const closeMenu = () => {
    setMenu(false);
    if (pausedByMenu.current && session.paused) session.togglePause();
    pausedByMenu.current = false;
  };

  // the pad: called from the guitar with the menu note, worked with the six strings
  const openPad = () => {
    if (tools) return;
    if (!session.paused) {
      session.togglePause();
      pausedByMenu.current = true;
    }
    setPad(0);
  };
  const closePad = (resume = true) => {
    setPad(null);
    if (resume && pausedByMenu.current && session.paused) session.togglePause();
    pausedByMenu.current = false;
  };
  const inExercise = running && !finished && !free;
  const live = running && !finished;
  const sessions = store.sessions.length;
  useEffect(() => {
    if (!live) setRound(`${today()}:${sessions}`);
  }, [live, sessions]);
  useEffect(() => {
    if (!live) setMixKey(setKey);
  }, [live, setKey]);
  // between sessions only: the exercise in front of the player may be one of the other tunes'
  const toggleMix = () => {
    if (live || !mixable.length) return;
    session.updateSettings({ mix: !mix });
    setMix(!mix);
  };

  // free play: the session (if one is on) holds still until the player comes back
  const openFree = () => {
    if (running && !finished && !session.paused) {
      session.togglePause();
      pausedByMenu.current = true;
    }
    setPad(null);
    setMenu(false);
    setFree(true);
  };
  const closeFree = () => {
    setFree(false);
    if (pausedByMenu.current && session.paused) session.togglePause();
    pausedByMenu.current = false;
  };
  const openTunePicker = () => {
    if (!onTune) return;
    if (running && !finished && !session.paused) {
      session.togglePause();
      pausedByChooser.current = true;
    } else {
      pausedByChooser.current = pausedByMenu.current;
    }
    pausedByMenu.current = false;
    switchStopped.current = false;
    setPad(null);
    setMenu(false);
    setChoosingTune(true);
  };
  const closeTunePicker = () => {
    setChoosingTune(false);
    if (!switchStopped.current && pausedByChooser.current && session.paused) {
      if (free) pausedByMenu.current = true;
      else session.togglePause();
    }
    pausedByChooser.current = false;
  };
  const chooseTune = async (id: string) => {
    if (!onTune || id === sheet.id || !themeSources.some((source) => source.id === id)) return;
    if (!switchStopped.current) {
      if (free) flushSync(() => setFree(false)); // commit free-play's saved visit before draining practice writes
      const wasRunning = running;
      const saved = session.exit();
      if (wasRunning) persistPartial(saved, true);
      switchStopped.current = true;
      pausedByChooser.current = false;
    }
    await settlePracticeWrites();
    await onTune(id);
  };
  const openTools = (tool: RoomTool) => {
    if (choosingTune || calib) return;
    if (tools) {
      setTools(tool);
      return;
    }
    if (running && !finished && !session.paused) {
      session.togglePause();
      pausedByTools.current = true;
    } else pausedByTools.current = pausedByMenu.current;
    pausedByMenu.current = false;
    setPad(null);
    setMenu(false);
    setTools(tool);
  };
  const closeTools = () => {
    setTools(null);
    if (pausedByTools.current && session.paused) {
      if (free) pausedByMenu.current = true;
      else session.togglePause();
    }
    pausedByTools.current = false;
  };
  /** From free play straight into the exercise that matches what was being played. */
  const practise = (id: string) => {
    setFree(false);
    pausedByMenu.current = false;
    if (running && !finished) session.finish();
    clearPartialSession(sheet.id, focus);
    session.begin([id]);
  };

  const cardNow = session.card;
  const wholeTune = Boolean(cardNow?.run || cardNow?.step?.kind === "tune");
  const improvising = cardNow?.kind === "improv";
  // not while the menu note is part of what is being played
  const menuNoteInMusic = useRef(false);
  menuNoteInMusic.current = Boolean(cardNow && session.active >= 0 && [session.active, session.active - 1].some((i) => {
    const t = cardNow.tl.targets[i];
    if (!t) return false;
    if (t.chord) return [...t.chord.voicing, ...t.chord.required].some((m) => mod(m) === mod(SUMMON_NOTE));
    if (t.any) return t.any.some((pc) => mod(pc) === mod(SUMMON_NOTE));
    return cardNow.exact ? t.midi === SUMMON_NOTE : mod(t.midi) === mod(SUMMON_NOTE);
  }));
  const summonRing = useSummon(input, inExercise && pad === null && !menu && !calib && !choosingTune && !tools, openPad, menuNoteInMusic);

  // note keys: one note each, held for a moment, and the session does that
  const noteKeys = session.keys;
  // Shapes: where on the neck a scale exercise is played. Chosen from the card or the guitar menu,
  // or played: a whole pass of the scale that is not the score is offered as a shape of its own.
  const shapes = useMemo(() => (cardNow ? playableShapes(cardNow, shapeBook) : []), [cardNow, shapeBook]);
  const pickShape = (shapeId: string) => {
    if (!cardNow?.base || cardNow.spot) return;
    chooseShape(cardNow.base, shapeId);
    session.swap(cardNow.id, variantId(cardNow.base, shapeId));
  };
  const cycleShape = () => {
    if (shapes.length < 2 || !cardNow) return;
    const at = shapes.findIndex((o) => o.id === (cardNow.shape ?? ""));
    pickShape(shapes[(at + 1) % shapes.length].id);
  };
  const cardScale = cardNow?.family === "scales" ? cardNow.context[cardNow.first]?.scale ?? null : null;
  const capturing = Boolean(cardScale && cardNow?.kind === "run" && !cardNow.spot) && inExercise && pad === null && !menu && !calib && !choosingTune && !tools && !session.paused && (session.phase === "pace" || session.phase === "time");
  const keyIgnore = useMemo(() => new Set(Object.values(noteKeys).filter((m): m is number => m !== null)), [noteKeys]);
  const heardPass = useHeardPass(input, capturing, cardScale?.pcs ?? null, keyIgnore, `${session.pos}:${cardNow?.id ?? ""}`);
  const offer = useMemo(() => {
    if (!heardPass || !cardNow || !cardScale) return null;
    const lines = [cardNow.tl.targets.slice(cardNow.first, cardNow.last + 1).map((t) => t.midi), ...(shapeBook.own[cardScale.id] ?? []).map((o) => o.notes)];
    return knownLine(heardPass, lines) ? null : heardPass;
  }, [heardPass, cardNow, cardScale, shapeBook]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const shownOffer = offer && dismissed !== offer.join(",") ? offer : null;
  const keepKey = useMemo(() => (shownOffer && cardNow ? assignNoteKeys(["keep"], [...commandMidis(cardNow), ...keyIgnore], { keep: [78, 73, 47] }).keep : null), [shownOffer, cardNow, keyIgnore]);
  const keepOffer = () => {
    if (!shownOffer || !cardNow?.base || !cardScale) return;
    const id = keepOwnShape(cardScale.id, shownOffer, placeOwn(shownOffer, cardNow.p), today());
    chooseShape(cardNow.base, id);
    session.swap(cardNow.id, variantId(cardNow.base, id));
  };
  // Guard the Result screen briefly before guitar note keys arm so a trailing note never advances by mistake.
  const [resultArmed, setResultArmed] = useState(false);
  useEffect(() => {
    if (session.phase !== "result") {
      setResultArmed(false);
      return;
    }
    const id = window.setTimeout(() => setResultArmed(true), 1500);
    return () => window.clearTimeout(id);
  }, [session.phase, session.outcome]);

  // A whole-tune run and improvisation reserve every played note for the music.
  const onResult = session.phase === "result";
  const noteKeysEnabled = inExercise && pad === null && !menu && !calib && !choosingTune && !tools && !session.paused && !wholeTune && !improvising && (!onResult || resultArmed);
  const held = useNoteKeys(
    input,
    noteKeysEnabled,
    onResult
      ? [null, null, null, noteKeys.next, null, null]
      : [noteKeys.hear, noteKeys.pace, noteKeys.time, noteKeys.next, keepKey, noteKeys.prev ?? null],
    (key) => {
      if (key === 0) session.hear();
      else if (key === 1) session.go("pace");
      else if (key === 2) session.go("time");
      else if (key === 4) keepOffer();
      else if (key === 5) session.prev?.();
      else session.next();
    },
    false,
    onResult ? 800 : undefined,
  );

  // tone keys: the gear and the listening circle answer to a double tap of a note this card doesn't play
  const openCalib = () => {
    if (inExercise && !session.paused) {
      session.togglePause();
      pausedByMenu.current = true;
    }
    setPad(null);
    setCalib(true);
  };
  const keyPcs = Object.values(noteKeys)
    .filter((m): m is number => m !== null)
    .map((m) => mod(m));
  const usedPcs = cardNow ? [...pitchClassesOf(cardNow), ...keyPcs] : [];
  const toneKeys = toneKeysFor(usedPcs, 2);
  // the drawer's switches: click, melody under me, spoken names. Full screen is left out because
  // browsers only grant it from a real click or key press, never from a note coming in.
  const switchTones = drawerToneKeys(usedPcs, 6, toneKeys);
  // between exercises single notes are the keys, so double taps only work the open drawer there;
  // whole tunes and improvisation reserve every note for the music, and the pad has its own notes
  const tonesLive = !calib && !free && !choosingTune && !tools && pad === null && ((inExercise && !wholeTune && !improvising) || menu);
  const tapped = useToneKeys(input, tonesLive, [...toneKeys, ...switchTones], (key) => {
    if (key === 0) (menu ? closeMenu : openMenu)();
    else if (key === 1) {
      if (!menu) openCalib();
    } else if (menu) {
      if (key === 2) session.setClick((c) => !c);
      else if (key === 3) session.updateSettings({ guide: !session.settings.guide });
      else if (key === 4) session.updateSettings({ voice: !session.settings.voice });
    }
  });
  const endCalib = () => {
    const opened = currentInputSetup();
    if (opened) checkedSetups.current.add(`${opened.deviceId}:${opened.sampleRate}`);
    else skippedPendingSetup.current = true;
    setCalib(false);
    if (pausedByMenu.current && session.paused) session.togglePause();
    pausedByMenu.current = false;
  };
  /** The bar being played, by itself; in a part already taken out, back into the piece. */
  const barAlone = () => {
    const c = session.whole;
    if (!c) return;
    if (session.spot) return session.skip();
    const slot = c.tl.targets[Math.max(c.first, Math.min(c.last, session.active))]?.slot ?? c.from;
    session.spotAt(slot, slot);
  };
  const memoryPageControl = Boolean(session.memoryStage && !session.spot);
  // a flowing score comes closer or steps back: the menu's "Score" row, Z / X, a pinch
  const flowing = Boolean(cardNow && flows(cardNow));
  const scoreZoom = useScoreZoom(session.box);
  const LOOP_MODES: LoopMode[] = ["adaptive", "turnaround", "continuous"];
  const cycleLoopMode = () => session.setLoopMode(LOOP_MODES[(LOOP_MODES.indexOf(session.loopMode) + 1) % LOOP_MODES.length]);
  const padPages: { title: string; rows: PadRow[]; fire: (() => void)[] }[] = [
    {
      title: `${session.card?.title ?? ""} · ♩ ${session.bpm}`,
      rows: [{ label: "Return to playing" }, { label: "Restart exercise" }, { label: memoryPageControl ? session.memoryStage === "page" ? "Use landmarks" : "Reveal page" : "Hear again" }, { label: "Slower", value: "−4 bpm" }, { label: "Faster", value: "+4 bpm" }, { label: "Session controls" }],
      fire: [() => closePad(), () => (session.again(), closePad()), () => {
        if (memoryPageControl) { session.toggleMemoryPage(); closePad(); }
        else { closePad(false); session.hear(); }
      }, () => session.tempo(-4), () => session.tempo(4), () => setPad(1)],
    },
    {
      title: "Session",
      rows: [
        { label: "Exercise controls" },
        { label: session.selfGuided ? "Done practising" : "Next exercise" },
        { label: "Click", value: session.click ? "on" : "off" },
        { label: "Loop", value: session.loopMode },
        !session.spot && shapes.length > 1 ? { label: "Shape", value: shapes.find((o) => o.id === (cardNow?.shape ?? ""))?.label ?? "Default" } : { label: session.spot ? "Return to the piece" : "Practise this bar" },
        { label: "Sound & setup" },
      ],
      fire: [
        () => setPad(0),
        () => (closePad(false), session.next()),
        () => session.setClick((c) => !c),
        cycleLoopMode,
        () => (!session.spot && shapes.length > 1 ? cycleShape() : (closePad(false), barAlone())),
        () => setPad(2),
      ],
    },
    {
      title: "Sound & setup",
      rows: [
        { label: "Tune & session" },
        { label: "Sound output", value: outputs.supported ? outputs.label : "system output" },
        { label: "Free play" },
        { label: "Settings" },
        { label: "Calibrate guitar" },
        { label: session.ending ? "Finishing after this pass" : "Finish after this pass" },
      ],
      fire: [
        () => setPad(3),
        outputs.cycle,
        openFree,
        () => (setPad(null), openMenu()), // the exercise is already held still by the pad
        () => (setPad(null), setCalib(true)), // stays paused until the guitar has been heard
        () => (closePad(), session.finishAfterPass()),
      ],
    },
    {
      title: "Tune & session",
      rows: [{ label: "Sound & setup" }, { label: onTune ? "Choose tune" : "" }, { label: session.pos > 0 ? "Previous exercise" : "Session controls" }, { label: "Tuner" }, { label: "Metronome" }, flowing ? { label: "Score", value: scoreZoom.name } : !session.spot && cardNow && !cardNow.once ? { label: "Accept & exclude" } : { label: "Return to playing" }],
      fire: [() => setPad(2), openTunePicker, () => (session.pos > 0 ? (closePad(false), session.prev?.()) : setPad(1)), () => openTools("tuner"), () => openTools("metronome"), () => (flowing ? scoreZoom.cycle() : !session.spot && cardNow && !cardNow.once ? (closePad(false), session.accept?.()) : closePad())],
    },
  ];

  // keys: all optional. Space pauses, arrows (or a page-turner pedal) skip and go again, −/+ tempo, S settings
  const act = { session, menu, pad, calib, free, freeInstruments, choosingTune, tools, endCalib, close, beginNow, resumePartial, partial, persistPartial, openMenu, closeMenu, openPad, closePad, openFree, closeFree, openTools, closeTools, inExercise, barAlone, flowing, scoreZoom, parked, running, finished };
  const actRef = useRef(act);
  actRef.current = act;

  // Parked behind another tab: the room's own instruments close (they make sound), a running
  // session holds still, and only the pause parking took is released on return. Pauses owned by
  // the instruments pass to parking, so coming back resumes exactly what was playing.
  const pausedByPark = useRef(false);
  useEffect(() => {
    const a = actRef.current;
    if (parked) {
      if (a.tools) {
        if (pausedByTools.current) pausedByPark.current = true;
        pausedByTools.current = false;
        setTools(null);
      }
      if (a.free) {
        if (pausedByMenu.current) pausedByPark.current = true;
        pausedByMenu.current = false;
        setFree(false);
      }
      if (a.running && !a.finished && !a.session.paused) {
        a.session.togglePause();
        pausedByPark.current = true;
      }
    } else if (pausedByPark.current) {
      pausedByPark.current = false;
      if (a.session.paused) a.session.togglePause();
    }
  }, [parked]);
  useEffect(() => { onLive?.(live); }, [live, onLive]);
  const surface: RoomSurface = tools ?? (free ? "free" : "practice");
  useEffect(() => { onSurface?.(surface); }, [surface, onSurface]);
  // a request from the shell, carried out once the room is in view
  const ownServed = useRef(0);
  const served = servedRef ?? ownServed;
  useEffect(() => {
    if (!request || parked || served.current === request.serial) return;
    served.current = request.serial;
    const a = actRef.current;
    if (request.kind === "settings") {
      if (a.tools) { a.closeTools(); window.setTimeout(() => { if (!actRef.current.menu) actRef.current.openMenu(); }, 0); }
      else if (!a.menu) a.openMenu();
    } else if (request.kind === "practice") {
      if (a.tools) a.closeTools();
      if (a.free) a.closeFree();
    } else if (request.kind === "free") {
      if (a.tools) {
        setTools(null);
        if (pausedByTools.current) pausedByMenu.current = true;
        pausedByTools.current = false;
      }
      if (!a.free) a.openFree();
    } else {
      if (a.free) setFree(false);
      if (a.tools !== request.kind) a.openTools(request.kind);
    }
  }, [request, parked, served]);
  useEffect(() => () => onLive?.(false), [onLive]);
  useEffect(() => {
    if (!handle) return;
    handle.current = {
      async leave() {
        const a = actRef.current;
        if (a.free) flushSync(() => setFree(false)); // commit free-play's saved visit before draining practice writes
        const saved = a.session.exit();
        if (a.running) a.persistPartial(saved, true);
        await settlePracticeWrites();
      },
    };
    return () => { handle.current = null; };
  }, [handle]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actRef.current;
      if (a.parked) return;
      const s = a.session;
      const el = e.target as HTMLElement;
      const k = e.key;
      if (a.choosingTune || a.tools || a.freeInstruments) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (el.tagName === "BUTTON" && (k === " " || k === "Enter")) return;
      if (a.calib) {
        if (k === "Escape") a.endCalib();
        else return;
      } else if (a.free) {
        if (k === "Escape") a.closeFree();
        else return;
      } else if (k === "Escape") {
        if (a.pad !== null) a.closePad();
        else if (a.menu) a.closeMenu();
        else if (!document.fullscreenElement) a.close();
        else return;
      } else if (k === "m" && !a.menu && a.inExercise) {
        if (a.pad !== null) a.closePad();
        else a.openPad();
      } else if (a.pad !== null) return;
      else if (k === "s" || k === ",") {
        if (a.menu) a.closeMenu();
        else a.openMenu();
      } else if (a.menu) return;
      else if (k === "f") a.openFree();
      else if (!s.running) {
        if (k === " " || k === "Enter") {
          if (a.partial) a.resumePartial();
          else a.beginNow();
        } else return;
      } else if (s.finished) {
        if (k === " " || k === "Enter") {
          if ((s.remaining ?? 0) > 0) s.resume?.();
          else s.keepGoing();
        } else return;
      } else if (s.phase === "result" && (k === " " || k === "Enter")) s.next();
      else if (k === " ") s.togglePause();
      else if (k === "ArrowRight" || k === "PageDown") s.skip();
      else if (k === "ArrowLeft" || k === "PageUp") s.again();
      else if (k === "h") s.hear();
      else if (k === "b") a.barAlone();
      else if (k === "p") s.prev?.();
      else if (k === "n") s.next();
      else if (k === "-" || k === "_") s.tempo(-4);
      else if (k === "+" || k === "=") s.tempo(4);
      else if (k === "c") s.setClick((c) => !c);
      else if (k === "g") s.updateSettings({ guide: !s.settings.guide });
      else if (k === "l") setLabels((l) => (l === "names" ? "degrees" : "names"));
      else if ((k === "z" || k === "x") && a.flowing) a.scoreZoom.step(k === "z" ? 1 : -1);
      else return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fam = session.card?.family;
  const between = !menu && !calib && !choosingTune && !tools; // the screens between exercises listen for their own keys
  return (
    <div
      className={`ss ${idle ? "is-idle" : ""} ${fam ? `fam-${fam}` : ""} ${pad !== null && inExercise ? "has-pad" : ""} ${inExercise ? "is-exercise" : ""} ${parked ? "is-parked" : ""}`}
      style={{ "--flow": inExercise ? session.flow : 0.5 } as CSSProperties}
      role="dialog"
      aria-label="practice session"
    >
      {!parked && !free && !choosingTune && !tools ? <PracticeAtmosphere input={input} warmth={Math.min(1, session.elapsed() / 45000)} flow={inExercise ? session.flow : 0} decay={inExercise ? session.decay : 0} missSerial={inExercise ? session.missSerial : 0} hitSerial={hitSerial} playing={inExercise && (session.phase === "pace" || session.phase === "time") && !session.paused && !session.away && !session.listeningOff && pad === null && !menu && !calib} beat={inExercise && !session.paused && pad === null && !menu && !calib ? session.beat : undefined} bpm={session.bpm} /> : null}
      <div style={{ display: choosingTune || tools ? "none" : "contents" }} aria-hidden={choosingTune || Boolean(tools) || undefined}>
      {free ? (
        <FreePlay input={input} deck={deck} onClose={closeFree} onPractise={practise} active={!choosingTune && !tools} onChooseTune={onTune ? openTunePicker : undefined} onToolsChange={setFreeInstruments} />
      ) : !running ? (
        <Ready
          deck={deck}
          session={session}
          sheet={sheet}
          input={input}
          plan={plan}
          shaped={shaped}
          length={length}
          onLength={cycleLength}
          partial={partial}
          onResume={resumePartial}
          onDiscardPartial={discardPartial}
          onBegin={() => beginNow()}
          onSelfBegin={() => beginNow(true)}
          onStartFromCard={beginFromCard}
          onStartCard={beginCard}
          wholeCardId={wholeCard?.id}
          hearCardId={hearCard?.id}
          windowP={windowP}
          onWindow={(p) => (setWindowP(p), session.updateSettings({ window: p }))}
          onFree={openFree}
          onSettings={openMenu}
          onChooseTune={onTune ? openTunePicker : undefined}
          onTools={openTools}
          keysOn={between}
          tuned={tuned}
          onTuned={() => setTuned(true)}
          guests={mixable.map((o) => o.sheet.title)}
          mix={mix}
          focus={focus}
          unavailablePassage={unavailablePassage}
          onMix={toggleMix}
        />
      ) : finished ? (
        <SessionSummary
          deck={deck}
          session={session}
          input={input}
          title={sheet.title}
          onChooseTune={onTune ? openTunePicker : undefined}
          onFree={openFree}
          onSettings={openMenu}
          enabled={between}
          ear={<Ear input={input} size="small" />}
        />
      ) : (
        <Running
          deck={deck}
          session={session}
          sheet={sheets.get(session.card?.tuneId ?? "") ?? sheet}
          input={input}
          labels={labels}
          ring={summonRing}
          earTag={<ToneTag pc={tonesLive && !menu ? toneKeys[1] : null} lit={tapped === 1} />}
          held={held}
          blocks={sessionBlocks}
          onGuitarMenu={openPad}
          onTools={openTools}
          shapes={shapes}
          onShape={pickShape}
          offer={shownOffer}
          keepKey={keepKey}
          onKeep={keepOffer}
          onDismiss={() => shownOffer && setDismissed(shownOffer.join(","))}
        />
      )}
      {!freeInstruments ? <div className="ss-chrome">
        <button type="button" className="ss-icon" onClick={openMenu} aria-label="settings" title="Settings (S)">
          <Gear />
          <ToneTag pc={tonesLive ? toneKeys[0] : null} lit={tapped === 0} />
        </button>
      </div> : null}
      {pad !== null && inExercise ? <GuitarPad input={input} title={padPages[pad].title} rows={padPages[pad].rows} onFire={(i) => padPages[pad].fire[i]()} /> : null}
      {calib ? <Calibrate input={input} onDone={endCalib} /> : null}
      {menu ? (
        <Drawer
          deck={deck}
          session={session}
          input={input}
          outputs={outputs}
          plan={plan}
          windowP={windowP}
          onWindow={(p) => (setWindowP(p), session.updateSettings({ window: p }))}
          labels={labels}
          onLabels={setLabels}
          full={full}
          onFull={toggleFull}
          tones={switchTones}
          tapped={tapped}
          onClose={closeMenu}
          mix={mixable.length ? mix : null}
          onMix={toggleMix}
        />
      ) : null}
      </div>
      {choosingTune ? <TunePicker input={input} sources={themeSources} currentTuneId={sheet.id} session={sessionSet} onCancel={closeTunePicker} onChoose={chooseTune} /> : null}
      {tools ? <GuitarToolsRoom input={input} initialTool={tools} initialBpm={session.bpm} onToolChange={setTools} onClose={closeTools} /> : null}
    </div>
  );
}

// ---------- before: the tune, and a circle that listens ----------

function RoomInstruments({ onOpen, ready = false, held = null, disabled = false }: { onOpen(tool: RoomTool): void; ready?: boolean; held?: number | null; disabled?: boolean }) {
  return <nav className={`ss-instruments ${ready ? "ss-instruments--ready" : "ss-instruments--running"}`} aria-label="Practice instruments">
    <button type="button" onClick={() => onOpen("tuner")} disabled={disabled} title={ready ? "Hold C in any octave" : "Tuner · Guitar menu → Tune & session"}><Glyph name="tools" size={ready ? 17 : 14} /><span>Tuner</span>{ready ? <NoteTag midi={READY_KEYS[6]} held={held === 6} octave={false} /> : null}</button>
    <button type="button" onClick={() => onOpen("metronome")} disabled={disabled} title={ready ? "Hold C for the instruments, then switch with the guitar menu" : "Metronome · Guitar menu → Tune & session"}><Glyph name="free" size={ready ? 18 : 15} /><span>Metronome</span></button>
  </nav>;
}

const READY_WINDOWS: (number | null)[] = [null, 1, 5, 7, 9, 10];

function Ready({
  deck,
  session,
  sheet,
  input,
  plan,
  shaped,
  length,
  onLength,
  partial,
  onResume,
  onDiscardPartial,
  onBegin,
  onSelfBegin,
  onStartFromCard,
  onStartCard,
  wholeCardId,
  hearCardId,
  windowP,
  onWindow,
  onFree,
  onSettings,
  onChooseTune,
  onTools,
  keysOn,
  tuned,
  onTuned,
  guests,
  mix,
  onMix,
  focus,
  unavailablePassage,
}: {
  deck: Deck;
  session: SessionApi;
  sheet: LeadSheet;
  input: InputApi;
  plan: string[];
  shaped: SessionPlan;
  length: string;
  onLength(): void;
  partial: PartialSession | null;
  onResume(): void;
  onDiscardPartial(): void;
  onBegin(): void;
  onSelfBegin(): void;
  onStartFromCard(cardId: string): void;
  onStartCard(cardId: string): void;
  wholeCardId?: string;
  hearCardId?: string;
  windowP: number | null;
  onWindow(p: number | null): void;
  onFree(): void;
  onSettings(): void;
  onChooseTune?(): void;
  onTools(tool: RoomTool): void;
  keysOn: boolean;
  tuned: boolean;
  onTuned(): void;
  guests: string[]; // the library's other tunes
  mix: boolean;
  onMix(): void;
  focus: Focus;
  unavailablePassage: boolean;
}) {
  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  const partialProgress = partial ? partialSessionProgress(partial) : null;
  const activeQueue = partial ? partial.queue.slice(partial.pos) : plan;
  const primaryStart = partial ? onResume : onBegin;
  // a short 3-note fretted phrase begins immediately (open strings remain free for quick tuning)
  const { ring, notes: phraseNotes } = useStartPhrase(input, activeQueue.length > 0 && keysOn, primaryStart);
  const held = useNoteKeys(input, keysOn, [READY_KEYS[0], READY_KEYS[1], guests.length ? READY_KEYS[2] : null, READY_KEYS[3], READY_KEYS[4], onChooseTune ? READY_KEYS[5] : null, READY_KEYS[6]], (k) => (k === 0 ? onFree() : k === 1 ? onSettings() : k === 2 ? onMix() : k === 3 ? onLength() : k === 4 ? onSelfBegin() : k === 5 ? onChooseTune?.() : onTools("tuner")), true);
  const from = new Set(activeQueue.map((id) => byId.get(id)?.tune).filter(Boolean));
  const listening = input.status === "listening" && !input.paused;
  const first = byId.get(activeQueue[0]);
  const days = streak(session.store);
  const say = unavailablePassage ? "Choose this passage again in Songs" : !activeQueue.length
    ? deck.cards.length ? "A little more time for this one" : "No exercise in this score yet"
    : listening
      ? partial ? "Pick up where you left off" : "Ready when you are"
      : input.status === "starting"
        ? "Connecting your guitar…"
        : input.paused
          ? "Wake up the sound"
          : "Let’s hear your guitar";
  const inputLabel = listening ? "Guitar listening" : input.status === "starting" ? "Opening input" : input.paused ? "Audio suspended" : "Input off";
  const startLabel = listening ? (partial ? "Resume session" : "Begin session") : input.status === "starting" ? "Opening input…" : input.paused ? "Resume listening" : input.status === "error" ? "Reconnect input" : "Enable listening";
  const isWholeSelected = Boolean(wholeCardId && plan.length === 1 && plan[0] === wholeCardId);
  const cycleWindow = () => {
    const idx = READY_WINDOWS.indexOf(windowP);
    onWindow(READY_WINDOWS[(idx + 1) % READY_WINDOWS.length]);
  };
  const winLabel = windowP === null ? `Frets ${deck.window.p}–${deck.window.p + 3} (auto)` : `Frets ${windowP}–${windowP + 3}`;
  const playedMins = partial && partial.activeMs >= 30000 ? Math.max(1, Math.round(partial.activeMs / 60000)) : 0;
  return (
    <div className="ss-ready ss-ready-flow">
      <div className="ss-ready-story">
        <div className="ss-ready-eyebrow">
          <span className="ss-ready-key">{sheet.keySignature}</span>
          <p className="ss-kicker">{focus !== "all" ? FOCUS_LABEL[focus] : days > 1 ? `Day ${days}` : "In the room"}</p>
          {partialProgress ? (
            <span className="ss-ready-meta">{partialProgress.done}/{partialProgress.total} done · {partialProgress.remaining} left</span>
          ) : plan.length > 0 ? (
            <span className="ss-ready-meta">{plan.length} · ~{shaped.minutes}m{from.size > 1 ? ` · ${from.size} tunes` : ""}</span>
          ) : null}
        </div>
        <h1 className="ss-display">{sheet.title}</h1>
        {partial && partialProgress ? (
          <div className="ss-resume-banner" role="region" aria-label="Unfinished session">
            <div className="ss-resume-copy">
              <strong>Unfinished session</strong>
              <span>
                {partialProgress.done} of {partialProgress.total} done · {partialProgress.remaining} left
                {playedMins ? ` · ${playedMins}m played` : ""}
              </span>
            </div>
            <div className="ss-resume-actions">
              <button type="button" className="ss-resume-go" disabled={!keysOn} onClick={onResume}>
                Resume
              </button>
              <button type="button" className="ss-resume-discard" disabled={!keysOn} onClick={onDiscardPartial}>
                Start fresh
              </button>
            </div>
          </div>
        ) : shaped.why || shaped.sideWhy ? (
          <p className="ss-focus">
            {shaped.why}
            {shaped.why && shaped.sideWhy ? " · " : ""}
            {shaped.sideWhy ? <span>{shaped.sideWhy}</span> : null}
          </p>
        ) : null}
        {(wholeCardId && !isWholeSelected) || hearCardId ? (
          <div className="ss-whole-actions">
            {wholeCardId && !isWholeSelected ? (
              <button
                type="button"
                className="ss-whole-jump"
                disabled={!keysOn || unavailablePassage}
                onClick={() => onStartCard(wholeCardId)}
              >
                <Glyph name="play" size={14} />
                <span>Play the whole tune</span>
                <small>scrolling score · jump right in</small>
              </button>
            ) : null}
            {hearCardId ? (
              <button
                type="button"
                className="ss-whole-hear"
                disabled={!keysOn || unavailablePassage}
                onClick={() => onStartCard(hearCardId)}
                title="Listen to the whole tune once through before practising"
              >
                <span>Hear the tune</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {first ? (
          <div className="ss-ready-preview">
            <ol className="ss-ready-queue">
              {activeQueue.slice(0, 3).map((id, i) => {
                const card = byId.get(id);
                if (!card) return null;
                const blocksSource = partial ? partial.blocks : shaped.blocks;
                const role = blocksSource.find((b) => b.cards.includes(id))?.role;
                const cardState = session.store.cards[id];
                const cardBpm = cardState?.bestCleanBpm ?? cardState?.bpm ?? card.bpm;
                const num = (partial ? partial.pos : 0) + i + 1;
                return (
                  <li key={`${num}:${id}`} className={`fam-${card.family}`}>
                    <button
                      type="button"
                      className="ss-ready-row"
                      disabled={!keysOn}
                      onClick={() => (partial && i === 0 ? onResume() : onStartFromCard(id))}
                    >
                      <span className="ss-ready-num">{String(num).padStart(2, "0")}</span>
                      <span className="ss-ready-copy">
                        <strong>{card.title}</strong>
                        <small>
                          {role ? `${ROLE_LABEL[role]} · ` : ""}
                          {FAMILY_LABEL[card.family]}
                          {card.goalBpm > card.bpm ? ` · ♩${cardBpm}→${card.goalBpm}` : ""}
                          {from.size > 1 ? ` · ${card.tune}` : ""}
                        </small>
                      </span>
                      <span className="ss-ready-go" aria-hidden="true">↗</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {activeQueue.length > 3 ? (
              <p className="ss-ready-more">+{activeQueue.length - 3} more {partial ? "left in session" : "in queue"}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ss-ready-arrival">
        <span className={`ss-connection ${listening ? "is-live" : ""}`}><i />{inputLabel}</span>
        <Ear input={input} size="big" ring={ring} />
        {listening && activeQueue.length > 0 ? (
          <ol className="ss-phrase-steps" aria-label={`Start phrase progress: ${phraseNotes.length} of ${START_PHRASE_LENGTH} notes`}>
            {Array.from({ length: START_PHRASE_LENGTH }, (_, i) => (
              <li key={i} className={phraseNotes[i] !== undefined ? "is-lit" : ""}>
                {phraseNotes[i] !== undefined ? keyName(phraseNotes[i]) : String(i + 1)}
              </li>
            ))}
          </ol>
        ) : null}
        <p className="ss-say" aria-live="polite">{say}</p>
        {listening && activeQueue.length > 0 && !tuned ? <TuneCheck input={input} onDone={onTuned} onSkip={onTuned} /> : null}
        <p className="ss-ready-instruction">
          {unavailablePassage ? "Return to Songs to choose a passage with melody notes in this arrangement." : !activeQueue.length
            ? deck.cards.length ? "Hold F below for more time, or open free play." : "Free play is always available."
            : listening ? (partial ? "Play 3 fretted notes to resume · open strings stay free" : "Play 3 fretted notes to begin · open strings stay free") : input.paused ? "Tap to wake audio, then play to begin." : "Connect an interface or allow the microphone."}
        </p>
        {input.error ? <p className="ss-input-detail" role="status">{input.error}</p> : null}
        <button
          type="button"
          className="ss-begin"
          disabled={!keysOn || unavailablePassage || input.status === "starting" || (listening && !activeQueue.length)}
          onClick={listening ? primaryStart : () => void input.start()}
        >
          {startLabel}<span aria-hidden="true">↗</span>
        </button>
        <button type="button" className="ss-self-begin" onClick={onSelfBegin} disabled={!keysOn || !plan.length}>
          <NoteTag midi={READY_KEYS[4]} held={held === 4} octave={false} /> <span>Practise without scoring</span>
        </button>
      </div>

      <div className="ss-ready-options">
        <p className="ss-section-label">These notes open options · hold in any octave</p>
        <ul className={`ss-acts ${listening && keysOn ? "is-armed" : ""}`} aria-label="played on the guitar">
          <li>
            <button type="button" onClick={onFree} disabled={!keysOn}>
              <NoteTag midi={READY_KEYS[0]} held={held === 0} octave={false} />
              <span>Free play</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={onSettings} disabled={!keysOn}>
              <NoteTag midi={READY_KEYS[1]} held={held === 1} octave={false} />
              <span>Settings</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={onLength} disabled={!keysOn}>
              <NoteTag midi={READY_KEYS[3]} held={held === 3} octave={false} />
              <span>Length · {LENGTH_MINUTES[length as keyof typeof LENGTH_MINUTES]} min</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={cycleWindow} disabled={!keysOn} title="Region of the neck for warm-ups, scales and reading lines (never restricts how you finger the melody)">
              <span>{winLabel}</span>
            </button>
          </li>
          {guests.length ? (
            <li>
              <button type="button" onClick={onMix} title={guests.join(" · ")} disabled={!keysOn}>
                <NoteTag midi={READY_KEYS[2]} held={held === 2} octave={false} />
                <span>{mix ? `Mix · ${guests.length + 1} tunes` : "Mix · this tune"}</span>
              </button>
            </li>
          ) : null}
          {onChooseTune ? <li><button type="button" onClick={onChooseTune} disabled={!keysOn}><NoteTag midi={READY_KEYS[5]} held={held === 5} octave={false} /><span>Choose tune</span></button></li> : null}
        </ul>
        <RoomInstruments onOpen={onTools} ready held={held} disabled={!keysOn} />
      </div>
    </div>
  );
}

/** True for a while after `tick` changed. */
function useLately(tick: number, ms: number): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const id = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(id);
  }, [tick, ms]);
  return on;
}

/** "bars 13–14": the bars a card plays, by the tune's own numbers where it is played on the tune. */
function barsOf(card: Card, sheet: LeadSheet): string {
  const own = card.family === "melody" || card.kind === "varied" || card.kind === "line" || localId(card.id).startsWith("sec:");
  const name = (slot: number) => {
    const bar = card.tl.slots[slot].bar;
    return own ? sheet.barNumbers[bar] ?? String(bar + 1) : String(slot + 1);
  };
  const a = name(card.from);
  const b = name(card.to);
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

// ---------- during: one exercise, nothing else ----------

/**
 * The one line under the material. It reports what was heard, in numbers where there are any, and
 * stays silent while the player plays: what there is to do is on the page already.
 */
function coachLine(card: Card, s: SessionApi, last: number | undefined): { text: string; tone?: "good" | "soft" | "drift" | "decay" } {
  if (s.paused) return { text: "" };
  if (s.ending) return { text: "Finishing after this pass" };
  if (s.selfGuided) return { text: "Self-guided · no mic score" };
  if (s.phase === "pace") {
    if (card.view === "chords" || !s.follow.done || !s.lastTake) return { text: "" };
    return { text: `${s.lastTake.hit} of ${s.lastTake.total}`, tone: s.lastTake.clean ? "good" : "decay" };
  }
  if (s.phase === "time") {
    if (s.waiting) return { text: "The band comes back in on a note." };
    if (s.settling) return { text: "Settling in · next pass counts", tone: "soft" };
    if (s.freeRide && s.bankedBpm) return { text: `Banked ♩${s.bankedBpm} · riding ♩${s.bpm}`, tone: "good" };
    if (s.playback.counting) return { text: "" };
    const latest = s.passLog[s.passLog.length - 1];
    if (latest) {
      const pct = Math.round(latest.share * 100);
      if (latest.clean) return { text: `${pct}%`, tone: "good" };
      if (latest.reason === "timing") return { text: `${pct}% · pulse unsteady`, tone: "drift" };
      if (!latest.settle) return { text: `${pct}%`, tone: "decay" };
    }
    if (last === undefined) return { text: "" };
    return { text: `${Math.round(last * 100)}%`, tone: last >= card.pass ? "good" : "decay" };
  }
  return { text: "" };
}

/** Raw alignment remains visible; its cause may be the player, the route or onset detection. */
function BeatMeter({ drift, beatMs }: { drift: number | null; beatMs: number }) {
  const x = drift === null ? 0 : Math.max(-1, Math.min(1, drift / (beatMs * 0.25)));
  const label = drift === null ? "" : `${drift >= 0 ? "+" : ""}${Math.round(drift)} ms`;
  return (
    <span className="ss-beat" aria-label={label ? `Alignment ${label}` : "Alignment"} title="Alignment against the click, after the current input correction; not a hardware-latency measurement.">
      <i style={{ transform: `translateX(${(x * 16).toFixed(1)}px)` }} />
      <em>{label}</em>
    </span>
  );
}

/** The last time through, note by note: above the line came after its beat, below it ahead. */
function TimingStrip({ at, first, last, beatMs }: { at: (number | null)[]; first: number; last: number; beatMs: number }) {
  const offs = at.slice(first, last + 1);
  const vals = offs.filter((o): o is number => o !== null && o !== undefined);
  if (vals.length < 3) return null;
  const fit = fitTiming(offs)!;
  const reach = beatMs * 0.25;
  const n = Math.max(1, offs.length - 1);
  return (
    <span className="ss-timing" title="Each note stays at its raw alignment against the click. Colour shows scatter around the passage's alignment; a constant offset is separate from steadiness.">
      <span className="ss-timing-lane">
        {offs.map((o, i) =>
          o === null || o === undefined ? null : (
            <i key={i} className={Math.abs(o - fit.offset) > timingTolerance(beatMs) ? "is-off" : ""} style={{ left: `${(i / n) * 100}%`, top: `${50 + Math.max(-1, Math.min(1, o / reach)) * 50}%` }} />
          ),
        )}
      </span>
      <em>±{Math.round(fit.spread)} ms spread · {fit.offset >= 0 ? "+" : ""}{Math.round(fit.offset)} ms alignment</em>
    </span>
  );
}

function Running({
  deck,
  session: s,
  sheet,
  input,
  labels,
  ring,
  earTag,
  held,
  blocks,
  onGuitarMenu,
  onTools,
  shapes,
  onShape,
  offer,
  keepKey,
  onKeep,
  onDismiss,
}: {
  deck: Deck;
  session: SessionApi;
  sheet: LeadSheet;
  input: InputApi;
  labels: LabelMode;
  ring: RefObject<SVGCircleElement>;
  earTag: ReactNode;
  held: number | null; // the note key being held
  blocks: SessionPlan["blocks"];
  onGuitarMenu(): void;
  onTools(tool: RoomTool): void;
  shapes: ShapeOption[]; // a scale exercise's shapes, the default first; empty elsewhere
  onShape(shapeId: string): void;
  offer: number[] | null; // a pass of the player's own, heard and not yet kept
  keepKey: number | null;
  onKeep(): void;
  onDismiss(): void;
}) {
  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  const roleByPos = useMemo(() => {
    const out: (Role | null)[] = [];
    for (const b of blocks) for (let k = 0; k < b.cards.length; k++) out.push(b.role);
    return out;
  }, [blocks]);
  // a tempo set by hand shows itself, even while the dial would otherwise show the player's own pulse
  const [setByHand, setSetByHand] = useState<string | null>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const lifted = useLately(s.tempoLift?.key ?? 0, 2400);
  const card = s.card;
  useEffect(() => {
    setConfirmAccept(false);
  }, [s.pos, card?.id, s.phase]);
  if (!card) return null;
  const say = coachLine(card, s, s.passes[s.passes.length - 1]);
  const aidLevel = s.phase === "time" ? s.shadow?.level() ?? 0 : 0;

  // the three ways to work on it: each one a note away
  // improvising, every note is music: the keys are off, so none are shown
  const free = card.kind === "improv";
  const wholeTune = Boolean(card.run || card.step?.kind === "tune");
  const playedShortcuts = !free && !wholeTune;
  const trail = [
    { id: "listen", label: "Hear again", key: s.keys.hear, fire: s.hear },
    { id: "pace", label: card.view === "chords" ? "Your shapes" : "Your pace", key: s.keys.pace, fire: () => s.go("pace") },
    { id: "time", label: "In time", key: s.keys.time, fire: () => s.go("time") },
  ];
  const order = ["intro", "listen", "pace", "time", "result"];
  const stateOf = (id: string) => (s.phase === id ? "is-now" : order.indexOf(s.phase) > order.indexOf(id) ? "is-done" : "");
  const counting = s.phase === "time" && !s.paused ? s.playback.counting : 0;
  const turnaround = s.phase === "time" && !s.paused && Boolean(s.breathing);
  const initialCount = counting && !turnaround ? counting : 0;
  const pips = s.phase === "pace" && card.view !== "chords" && s.needClean > 1;
  const handKey = `${card.id}:${s.phase}`;
  const own = s.phase === "pace" && s.pulse !== null && setByHand !== handKey;
  const stepTempo = (delta: number) => {
    setSetByHand(handKey);
    s.tempo(delta);
  };
  const mixed = new Set(s.queue.map((id) => byId.get(id)?.tuneId)).size > 1;
  const showMeter = s.phase !== "intro" && s.phase !== "listen" && s.phase !== "result";
  const hasMeter = showMeter && (s.run >= 4 || (s.phase === "time" && (s.passLog.length > 0 || Boolean(s.playback.lastPass))));
  const hasCoach = Boolean(say.text || pips || hasMeter);
  const showBeatRail = (s.phase === "time" || s.phase === "listen") && !s.paused;

  const latestByPos = useMemo(() => {
    const map = new Map<number, Outcome>();
    for (const o of s.log) if (o.at >= 0) map.set(o.at, o);
    return map;
  }, [s.log]);

  return (
    <div className={`ss-run phase-${s.phase} ${s.paused ? "is-paused" : ""} ${turnaround ? "is-turnaround" : ""}`}>
      <ol className="ss-progress" aria-label={`exercise ${s.pos + 1} of ${s.queue.length}`}>
        {s.queue.map((id, i) => {
          const o = latestByPos.get(i);
          const role = roleByPos[i];
          const blockStart = i > 0 && role && role !== roleByPos[i - 1];
          return <li key={i} className={`fam-${byId.get(id)?.family ?? "melody"} ${i === s.pos ? "is-now" : ""} ${o ? `is-${o.result}` : ""} ${blockStart ? "is-block-start" : ""}`} title={role ? ROLE_LABEL[role] : undefined} />;
        })}
      </ol>

      <header className="ss-head" key={`${s.pos}:${card.id}`} data-pool="calm">
        <div className="ss-head-bar">
          <RoomInstruments onOpen={onTools} />
          <div className="ss-head-utils">
            {card.view === "score" || card.view === "fretboard" ? (
              <button
                type="button"
                className={`ss-util-btn ${showSymbols ? "is-on" : ""}`}
                aria-expanded={showSymbols}
                onClick={() => setShowSymbols((v) => !v)}
                title="Quick guide to music notation symbols (rests, 16ths, triplets, ties)"
              >
                <span>Symbols ?</span>
              </button>
            ) : null}
            {!s.spot && !card.once && s.phase !== "result" ? (
              confirmAccept ? (
                <span className="ss-accept-confirm" role="group" aria-label="Confirm accepting and excluding this piece">
                  <span>Exclude from future sessions?</span>
                  <button type="button" className="ss-accept-yes" onClick={() => { setConfirmAccept(false); s.accept?.(); }}>
                    Accept &amp; exclude
                  </button>
                  <button type="button" className="ss-accept-no" onClick={() => setConfirmAccept(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="ss-util-btn"
                  onClick={() => setConfirmAccept(true)}
                  title="Mark this piece accepted and exclude it from future sessions and scoring (unlocks what comes next)"
                >
                  <span>Accept as done</span>
                </button>
              )
            ) : null}
          </div>
        </div>

        {showSymbols ? <NotationGuide onClose={() => setShowSymbols(false)} /> : null}

        <div className="ss-titlebar">
          <p className="ss-kicker">
            <span className="ss-fam">{FAMILY_LABEL[card.family]}</span>
            {mixed ? ` · ${card.tune}` : ""}
            {s.box === 0 ? " · new" : ""}
            {s.gapped ? " · band dropout" : ""}
          </p>
          <h1 className="ss-title">{card.title}</h1>
          {shapes.length > 1 && !s.spot ? <ShapePicker card={card} shapes={shapes} onShape={onShape} /> : null}
        </div>

        {offer ? (
          <div className="ss-shape-offer" role="status">
            <span>Heard <b>{passName(offer)}</b> · {offer.length} notes</span>
            <button type="button" onClick={onKeep} aria-label={`Keep as a shape${keepKey !== null ? ` · hold ${keyName(keepKey)}` : ""}`}>
              <NoteTag midi={keepKey} held={held === 4} />
              <span>Keep as shape</span>
            </button>
            <button type="button" className="ss-shape-offer-x" onClick={onDismiss} aria-label="Not this one">×</button>
          </div>
        ) : null}

        {s.spot ? (
          <p className="ss-why ss-spotline" key="spot">
            <b>{barsOf(card, sheet)}</b>
            {s.spot.asked ? " · by " : " came out short twice · here by "}
            {card.to > card.from ? "themselves" : "itself"}
          </p>
        ) : (
          <p className="ss-why">
            {card.detail} {card.why}
          </p>
        )}

        {s.suggestedSpot && !s.spot && s.phase !== "result" ? (
          <div className="ss-spot-offer" role="status">
            <span>Tough spot · <b>{barsOf({ ...card, ...s.suggestedSpot }, sheet)}</b></span>
            <button type="button" onClick={s.acceptSpot}>Drill alone</button>
            <button type="button" className="ss-spot-offer-x" onClick={s.dismissSpot} aria-label="Keep playing full passage">×</button>
          </div>
        ) : null}

        {s.memoryStage ? (
          <div className="ss-memory-aid">
            <span aria-live="polite">{s.memoryReview ? "Memory review" : "Memory"} · {s.memoryStage === "page" ? "page shown" : s.memoryStage === "landmarks" ? "landmarks" : "hidden"}</span>
            <button type="button" onClick={s.toggleMemoryPage} disabled={s.phase === "result" || Boolean(s.spot)}>{s.memoryStage === "page" ? "Use landmarks" : "Reveal page"}</button>
          </div>
        ) : null}
      </header>

      <div className="ss-stage">
        {showBeatRail ? (
          <StageBeatRail
            beat={s.beat}
            counting={initialCount}
            reentry={s.phase === "time" ? s.reentry : 0}
            turnaround={turnaround}
            bpm={s.bpm}
            entryOffset={
              card.tl.targets[card.first] && card.tl.slots[card.from]
                ? Math.max(0, card.tl.targets[card.first].t - card.tl.slots[card.from].start)
                : 0
            }
          />
        ) : null}
        <div className="ss-material">
          {card.view === "score" && flows(card) ? (
            <FlowStage card={card} session={s} sheet={sheet} />
          ) : card.view === "score" ? (
            <MelodyStage card={card} session={s} sheet={sheet} />
          ) : card.view === "chords" ? (
            <ChordStage card={card} session={s} />
          ) : card.view === "improv" ? (
            <ImprovStage card={card} session={s} labels={labels} />
          ) : card.view === "prompts" ? (
            <PromptStage card={card} session={s} labels={labels} />
          ) : (
            <LineStage card={card} session={s} sheet={sheet} labels={labels} />
          )}
        </div>
        {initialCount ? (
          <span className="ss-countin" key={initialCount} aria-live="off">
            {initialCount}
          </span>
        ) : null}
        {s.paused ? (
          <span className="ss-veil ss-pause-state">
            <strong>
              {s.away
                ? "A moment of quiet"
                : s.listeningOff
                  ? input.status === "starting"
                    ? "Connecting your guitar…"
                    : input.status === "idle"
                      ? "Connect your guitar"
                      : "Let’s hear you again"
                  : "Paused"}
            </strong>
            <small>
              {s.listeningOff
                ? input.error ?? (input.status === "starting" ? "Listening will begin automatically once the input opens." : input.status === "idle" ? "Allow the microphone or play along without scoring." : "The session carries on when the guitar is connected.")
                : s.away
                  ? "A note brings the session back."
                  : "Space to carry on · high e fret 11 for the guitar menu"}
            </small>
            {s.listeningOff ? <button type="button" onClick={() => void input.start()} disabled={input.status === "starting"}>{input.status === "starting" ? "Opening input…" : input.paused ? "Resume listening" : input.status === "idle" ? "Enable listening" : "Reconnect input"}</button> : null}
            {s.listeningOff ? <button type="button" onClick={s.continueWithoutScoring}>{input.status === "idle" ? "Practise without scoring" : "Continue without scoring"}</button> : null}
          </span>
        ) : null}
        {s.phase === "result" && s.outcome ? (
          <ResultMark
            o={s.outcome}
            titleOf={(id) => byId.get(id)?.title ?? ""}
            secret={s.outcome.secret}
            isLast={s.ending || s.pos + 1 >= s.queue.length}
            nextKey={playedShortcuts ? s.keys.next : null}
            onNext={s.next}
            onAgain={s.again}
          />
        ) : null}
      </div>

      <div className={`ss-coach ${hasCoach ? "has-copy" : ""}`}>
        {hasCoach ? (
          <div className="ss-coach-row">
            {say.text ? (
              <p className={`ss-say ${say.tone ? `is-${say.tone}` : ""}`} aria-live="polite" key={say.text}>
                {say.text}
              </p>
            ) : null}
            {pips ? (
              <span className="ss-takes" aria-hidden="true">
                {Array.from({ length: Math.max(1, s.needClean) }, (_, i) => (
                  <i key={i} className={i < s.takes.clean ? "is-on" : ""} />
                ))}
              </span>
            ) : null}
            {hasMeter ? (
              <span className="ss-meter" aria-hidden="true">
                {s.run >= 4 ? (
                  <span className={`ss-streak ${s.run >= 16 ? "is-hot" : s.run >= 8 ? "is-warm" : ""}`} title="notes landed in a row">
                    <b key={s.run}>{s.run}</b> streak
                  </span>
                ) : null}
                {s.phase === "time" && s.passLog.length ? (
                  <span className="ss-passes" title="each pass: emerald clean · amber unsteady pulse · ochre missed notes · hollow settle-in">
                    {s.passLog.slice(-8).map((entry, i) => (
                      <i key={i} className={entry.settle ? "is-settle" : entry.clean ? "is-in" : entry.reason === "timing" ? "is-timing" : "is-miss"} style={{ height: `${Math.max(12, entry.share * 100)}%` }} />
                    ))}
                    <em style={{ bottom: `${card.pass * 100}%` }} />
                  </span>
                ) : null}
                {s.phase === "time" && s.playback.lastPass ? <TimingStrip at={s.playback.lastPass.at} first={card.first} last={card.last} beatMs={60000 / s.bpm} /> : null}
              </span>
            ) : null}
          </div>
        ) : null}
        <span className="ss-flow" aria-hidden="true" title="how it is going" />
      </div>

      <footer className="ss-foot" data-pool="calm">
        <span className="ss-call">
          <Ear input={input} size="small" ring={ring} tag={earTag} />
          <span className="ss-menu-access">
            <button type="button" onClick={onGuitarMenu}>Guitar menu</button>
            <SummonVisual compact />
          </span>
        </span>
        {!free ? (
          <ol className="ss-trail" aria-label={playedShortcuts ? "Hold a shown note in the exact octave" : "Exercise controls"}>
            {trail.map((r, i) => (
              <li key={r.id} className={stateOf(r.id)}>
                <button
                  type="button"
                  onClick={r.fire}
                  disabled={s.paused || s.phase === "result"}
                  title={playedShortcuts && r.key !== null ? `${r.label} · hold ${keyName(r.key)} (exact octave)` : r.label}
                  aria-label={`${r.label}${playedShortcuts && r.key !== null ? ` · hold ${keyName(r.key)}` : ""}`}
                  aria-current={s.phase === r.id ? "step" : undefined}
                >
                  <NoteTag midi={playedShortcuts ? r.key : null} held={held === i} />
                  <span>{r.label}</span>
                </button>
              </li>
            ))}
            <li className="ss-trail-prev">
              <button
                type="button"
                onClick={() => s.prev?.()}
                disabled={s.paused || s.pos === 0}
                title={playedShortcuts && s.keys.prev != null ? `Previous exercise · hold ${keyName(s.keys.prev)} (exact octave)` : "Previous exercise"}
                aria-label={`Previous exercise${playedShortcuts && s.keys.prev != null ? ` · hold ${keyName(s.keys.prev)}` : ""}`}
              >
                <NoteTag midi={playedShortcuts ? s.keys.prev : null} held={held === 5} />
                <span>Prev</span>
              </button>
            </li>
            <li className={`ss-trail-next ${s.bankedBpm !== null ? "is-banked" : ""}`}>
              <button
                type="button"
                onClick={s.next}
                disabled={s.paused}
                title={playedShortcuts && s.keys.next !== null ? `${s.selfGuided ? "Done practising" : s.bankedBpm !== null ? `Bank ♩${s.bankedBpm} & next` : "Next exercise"} · hold ${keyName(s.keys.next)} (exact octave)` : s.selfGuided ? "Done practising" : s.bankedBpm !== null ? `Bank ♩${s.bankedBpm} & next` : "Next exercise"}
                aria-label={`${s.selfGuided ? "Done practising" : s.bankedBpm !== null ? "Bank and next exercise" : "Next exercise"}${playedShortcuts && s.keys.next !== null ? ` · hold ${keyName(s.keys.next)}` : ""}`}
              >
                <NoteTag midi={playedShortcuts ? s.keys.next : null} held={held === 3} />
                <span>{s.selfGuided ? "Done" : s.bankedBpm !== null ? "Bank & next" : "Next"}</span>
              </button>
            </li>
          </ol>
        ) : (
          <div className="ss-foot-free">
            {s.pos > 0 ? (
              <button type="button" onClick={() => s.prev?.()} disabled={s.paused} aria-label="Previous exercise">
                ← Prev
              </button>
            ) : null}
            <span className="ss-foot-note">Every note is music</span>
            <button type="button" onClick={s.next} disabled={s.paused} aria-label={s.selfGuided ? "Done practising" : "Next exercise"}>
              {s.selfGuided ? "Done" : "Next →"}
            </button>
          </div>
        )}
        <div className="ss-side" data-pool="calm">
          {s.phase === "time" && aidLevel >= 0.08 ? (
            <span className="ss-aid is-on" style={{ opacity: Math.min(1, aidLevel * 2.1) }} title="Adaptive guide melody blending in where needed and fading out as you carry it">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0" />
              </svg>
              <em>guide</em>
            </span>
          ) : null}
          {s.phase === "time" && s.playback.drift !== null ? <BeatMeter drift={s.playback.drift} beatMs={60000 / s.bpm} /> : null}
          <span className={`ss-tempo-cluster ${own ? "is-own" : ""} ${s.freeRide ? "is-riding" : ""}`} title={own ? "your own tempo" : card.goalBpm > card.bpm ? `tempo ${s.bpm} bpm · goal ${card.goalBpm} bpm${s.priorBest ? ` · prior best ${s.priorBest} bpm` : ""}` : "tempo"}>
            <BeatPulse beat={s.beat} bpm={own ? s.pulse ?? s.bpm : s.bpm} onTempo={stepTempo} />
            {lifted && s.tempoLift ? (
              <b className="ss-tempo-lift">+{s.tempoLift.to - s.tempoLift.from} → {s.tempoLift.to}</b>
            ) : s.bankedBpm !== null && card.goalBpm > card.bpm && (s.priorBest === null || s.bankedBpm > s.priorBest) ? (
              <b className="ss-tempo-best is-new">new best ♩{s.bankedBpm}</b>
            ) : s.priorBest !== null && card.goalBpm > card.bpm ? (
              <em className="ss-tempo-best">best ♩{s.priorBest}</em>
            ) : s.phase === "time" && s.target > s.bpm ? (
              <em>→ {s.target}</em>
            ) : null}
          </span>
          <BoxPips box={s.box} />
        </div>
      </footer>
    </div>
  );
}

function BoxPips({ box, gained = 0 }: { box: number; gained?: number }) {
  return (
    <span className="ss-pips" title={box ? `box ${box} of ${BOXES}` : "new"}>
      {Array.from({ length: BOXES }, (_, i) => (
        <i key={i} className={`${i < box ? "is-on" : ""} ${i + 1 === gained ? "is-new" : ""}`} />
      ))}
    </span>
  );
}

function NotationGuide({ onClose }: { onClose(): void }) {
  return (
    <div className="ss-symbols" role="region" aria-label="Notation symbols guide">
      <div className="ss-symbols-head">
        <strong>Reading symbols</strong>
        <button type="button" onClick={onClose} aria-label="Close symbols guide">×</button>
      </div>
      <div className="ss-symbols-grid">
        <div>
          <p className="ss-symbols-cat">Notes (sound)</p>
          <ul>
            <li><b>𝅝</b><span>Whole · 4 beats</span></li>
            <li><b>𝅗𝅥</b><span>Half · 2 beats</span></li>
            <li><b>♩</b><span>Quarter · 1 beat</span></li>
            <li><b>♪</b><span>8th (1 beam) · ½ beat</span></li>
            <li><b>𝅘𝅥𝅯</b><span>16th (2 beams) · ¼ beat</span></li>
            <li><b>♩.</b><span>Dot · +50% longer</span></li>
          </ul>
        </div>
        <div>
          <p className="ss-symbols-cat">Rests (silence)</p>
          <ul>
            <li><b>𝄻</b><span>Whole rest (hangs) · 4 beats</span></li>
            <li><b>𝄼</b><span>Half rest (sits) · 2 beats</span></li>
            <li><b>𝄽</b><span>Quarter rest · 1 beat</span></li>
            <li><b>𝄾</b><span>8th rest (1 flag) · ½ beat</span></li>
            <li><b>𝄿</b><span>16th rest (2 flags) · ¼ beat</span></li>
          </ul>
        </div>
        <div>
          <p className="ss-symbols-cat">Groupings &amp; pitch</p>
          <ul>
            <li><b>3</b><span>Triplet · 3 notes in space of 2</span></li>
            <li><b>‿</b><span>Tie · hold note, don&apos;t re-pick</span></li>
            <li><b>♯ / ♭</b><span>Sharp (+1 fret) / Flat (−1 fret)</span></li>
            <li><b>♮</b><span>Natural · cancels ♯ or ♭</span></li>
            <li><b>‖: :‖</b><span>Repeat section</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ResultMark({
  o,
  titleOf,
  secret,
  isLast,
  nextKey,
  onNext,
  onAgain,
}: {
  o: Outcome;
  titleOf(id: string): string;
  secret?: string;
  isLast: boolean;
  nextKey: number | null;
  onNext(): void;
  onAgain(): void;
}) {
  const self = o.conditions?.source === "self";
  const autoSkip = o.result === "skip" && !o.excluded;
  const text = o.excluded
    ? "Accepted · excluded from sessions"
    : self
      ? "Practice noted · unscored"
      : o.result === "clean"
        ? `Box ${o.to}`
        : o.result === "ok"
          ? `Stays in box ${o.to}`
          : o.result === "fail"
            ? "Back a step"
            : "";
  const also = o.also.map((a) => titleOf(a.id)).filter(Boolean);
  const deltaText = !self && o.result === "clean"
    ? o.newBest && o.startBpm && o.bpm > o.startBpm
      ? `♩${o.startBpm} → ♩${o.bpm} (+${o.bpm - o.startBpm} · new best)`
      : o.newBest
        ? `New best · ♩${o.bpm}`
        : o.priorBest && o.bpm >= o.priorBest
          ? `Matched best · ♩${o.bpm}`
          : o.startBpm && o.bpm > o.startBpm
            ? `♩${o.startBpm} → ♩${o.bpm} (+${o.bpm - o.startBpm})`
            : null
    : null;
  return (
    <div className={`ss-result is-${o.excluded ? "clean" : o.result}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" pathLength={1} />
        {o.excluded || o.result === "clean" || o.result === "ok" ? <path d="M31 52 L45 66 L70 37" pathLength={1} /> : o.result === "fail" ? <path d="M33 50 H67" pathLength={1} /> : <path d="M40 34 L60 50 L40 66" pathLength={1} />}
      </svg>
      {secret ? <p className="ss-result-secret">{secret}</p> : null}
      {text ? <p>{text}</p> : null}
      {deltaText ? <p className={`ss-result-delta ${o.newBest ? "is-best" : ""}`}>{deltaText}</p> : null}
      {o.result !== "skip" && !self ? <BoxPips box={o.to} gained={o.to > o.from ? o.to : 0} /> : null}
      {o.result !== "skip" ? (
        <p className="ss-result-facts">
          {!self ? <>{o.conditions?.tempo === "own-pace" ? "reference " : ""}♩ {o.bpm}</> : "Unscored"}
          {o.share !== null ? ` · ${Math.round(o.share * 100)}%` : ""}
        </p>
      ) : null}
      {o.unlocked?.length ? (
        <p className="ss-result-unlock">Unlocks {o.unlocked.join(" · ")}</p>
      ) : null}
      {o.bars?.length ? (
        <ol className="ss-runbars" aria-label="the run-through, bar by bar">
          {o.bars.map((b) => (
            <li key={b.bar} className={b.share >= 0.9 ? "is-in" : b.share < 0.7 ? "is-short" : ""} title={`bar ${b.bar + 1} · ${Math.round(b.share * 100)}%`} />
          ))}
        </ol>
      ) : null}
      {o.recordingId ? <RecordingStatus ids={[o.recordingId]} /> : null}
      {also.length ? (
        <p className="ss-result-also">
          carried up with it: {also.slice(0, 3).join(" · ")}
          {also.length > 3 ? ` +${also.length - 3}` : ""}
        </p>
      ) : null}
      {!autoSkip ? (
        <div className="ss-result-actions">
          <button type="button" className="ss-result-next" onClick={onNext}>
            {isLast ? "Session summary →" : "Next exercise →"}
          </button>
          {!o.excluded ? (
            <button type="button" className="ss-result-again" onClick={onAgain}>
              Play again
            </button>
          ) : null}
        </div>
      ) : null}
      {!autoSkip ? (
        <p className="ss-result-hint">
          {nextKey !== null ? `Space / Enter or hold ${keyName(nextKey)} to continue` : "Space / Enter or click to continue"}
        </p>
      ) : null}
    </div>
  );
}

function Harm({ ctx, scale = false }: { ctx: Context | null | undefined; scale?: boolean }) {
  const chord = ctx?.chord;
  const next = chord && ctx.next && ctx.next.symbol !== chord.symbol ? ctx.next : null;
  return (
    <div className="ss-harm">
      {chord ? (
        <>
          <b key={chord.symbol}>{pretty(chord.symbol)}</b>
          <i>{ctx.roman}</i>
          {scale ? <span>{ctx.scale.name}</span> : null}
          {next ? <em>→ {pretty(next.symbol)}</em> : null}
        </>
      ) : null}
    </div>
  );
}

interface WrongNote {
  n: number; // printed note (index among the score's non-rest notes)
  midi: number; // what sounded
  want: number; // what is written, sounding
  vexKey: string;
  name: string; // what sounded, by name
  wantName: string; // and what is written
  spot?: { string: number; fret: number } | null;
  degree?: string;
}

interface Ghost {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  info: StaffShadowInfo;
  name: string;
  wantName: string;
  wx: number; // the written note: where its name goes
  wy: number;
}

function entryLabel(offsetBeats: number): string | null {
  if (!(offsetBeats > 1e-6)) return null;
  const beatNum = Math.floor(offsetBeats + 1e-6) + 1;
  const frac = offsetBeats - Math.floor(offsetBeats + 1e-6);
  if (Math.abs(frac) < 0.05) return `enters on beat ${beatNum}`;
  if (Math.abs(frac - 0.5) < 0.08) return `enters on ${beatNum} &`;
  if (Math.abs(frac - 0.25) < 0.08) return `enters on ${beatNum} e`;
  if (Math.abs(frac - 0.75) < 0.08) return `enters on ${beatNum} a`;
  if (Math.abs(frac - 1 / 3) < 0.06 || Math.abs(frac - 2 / 3) < 0.06) return `enters off beat ${beatNum}`;
  return null;
}

/**
 * Eye-level beat rail directly above the score: 4 tactile beat pills pulsing strictly on the heard
 * audio clock (beat 1 anchored brightly), plus an unmistakable "Bar 1 in N" re-entry countdown
 * during count-in, turnaround bars, and post-final-note tails.
 */
function StageBeatRail({
  beat,
  counting,
  reentry,
  turnaround,
  bpm,
  entryOffset = 0,
}: {
  beat: SessionApi["beat"];
  counting: number;
  reentry: number;
  turnaround: boolean;
  bpm: number;
  entryOffset?: number;
}) {
  const total = Math.max(2, Math.min(8, beat.beats || 4));
  const active = beat.active ? beat.index : -1;
  const entry = entryLabel(entryOffset);
  const tag = counting
    ? `Count-in · bar 1 in ${counting}${entry ? ` · ${entry}` : ""}`
    : reentry > 0
      ? `${turnaround ? "Turnaround" : "Next pass"} · bar 1 in ${reentry}${entry ? ` · ${entry}` : ""}`
      : null;
  return (
    <div
      className={`ss-beat-rail ${beat.active ? "is-live" : ""} ${active === 0 ? "is-downbeat" : ""} ${counting || reentry > 0 ? "is-reentry" : ""}`}
      style={{ "--beat-decay": `${Math.min(0.75, 50 / (bpm || 80))}s` } as CSSProperties}
      aria-live="off"
    >
      <div className="ss-beat-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i === active ? `${i}:${beat.serial}` : i}
            className={`ss-beat-dot ${i === 0 ? "is-one" : ""} ${i === active ? "is-now" : ""}`}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {tag ? (
        <span className="ss-beat-cue">
          <i aria-hidden="true" />
          <b>{tag}</b>
        </span>
      ) : null}
    </div>
  );
}

/**
 * The shadow score: an engraved hollow head beside each missed note, at the exact staff height that
 * was played, WITH real ledger lines, staff-line/space helper ticks, and upright accidental glyphs
 * so mistakes actually reinforce sight-reading memory.
 */
const ScoreShadows = memo(function ScoreShadows({ host, wrong, keySignature }: { host: RefObject<HTMLDivElement>; wrong: WrongNote[]; keySignature: string }) {
  const key = wrong.map((w) => `${w.n}:${w.midi}`).join(",");
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  useEffect(() => {
    const el = host.current;
    if (!el || !wrong.length) {
      setGhosts([]);
      return;
    }
    const cached = readNoteBoxes(el);
    let hostRect: DOMRect | null = null;
    setGhosts(
      wrong.flatMap((w) => {
        let left: number;
        let top: number;
        let width: number;
        let height: number;
        const box = cached?.[w.n];
        if (box) {
          left = box.x;
          top = box.y;
          width = box.w;
          height = box.h;
        } else {
          hostRect ??= el.getBoundingClientRect();
          const head = el.querySelector(`[data-note="${w.n}"] .vf-notehead`)?.getBoundingClientRect();
          if (!head) return [];
          left = head.left - hostRect.left + el.scrollLeft;
          top = head.top - hostRect.top + el.scrollTop;
          width = head.width;
          height = head.height;
        }
        const info = analyzeWrongNote(w.midi, w.want, w.vexKey, keySignature);
        return [
          {
            key: `${w.n}:${w.midi}`,
            x: left + width * 1.9,
            y: top - (info.steps * height) / 2,
            w: width,
            h: height,
            info,
            name: w.name,
            wantName: w.wantName,
            wx: left + width / 2,
            wy: top + height,
          },
        ];
      }),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {ghosts.map((g) => (
        <Fragment key={g.key}>
          <span
            className={`ss-ghost-wrap ${g.info.onLine ? "is-line" : "is-space"}`}
            style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
            aria-hidden="true"
          >
            {/* Exact engraved ledger lines for off-staff notes (below E4 or above F5) */}
            {g.info.ledgerHalfSpaces.map((half) => (
              <span
                key={half}
                className="ss-ghost-ledger"
                style={{ top: `${50 + half * 50}%` }}
              />
            ))}
            {/* Subtle line/space helper ticks so line vs space is unmistakable even in bar gaps */}
            {g.info.inStaff && g.info.onLine ? (
              <span className="ss-ghost-line" />
            ) : g.info.inStaff ? (
              <>
                <span className="ss-ghost-space is-top" />
                <span className="ss-ghost-space is-bot" />
              </>
            ) : null}
            {/* Upright musical accidental glyph (♯ / ♭ / ♮) */}
            {g.info.acc ? <i className="ss-ghost-acc">{g.info.acc}</i> : null}
            {/* Hollow coral notehead tilted like real engraving */}
            <span className="ss-ghost-head" />
            {/* Played note name */}
            <b className="ss-ghost-name">{g.name}</b>
          </span>
          <span className="ss-want-name" style={{ left: g.wx, top: g.wy }} aria-hidden="true">
            {g.wantName}
          </span>
        </Fragment>
      ))}
    </>
  );
});

/**
 * Quiet visual-mechanical mistake comparison directly beneath the score: renders a real 5-line
 * micro-staff with ledger lines comparing the note symbol you played (coral) against the written
 * target (emerald), paired with the exact fret direction so eye, ear, and hand memorize the fix.
 */
function MistakeFlash({ wrong, keySignature }: { wrong: WrongNote[]; keySignature: string }) {
  const latest = wrong[wrong.length - 1];
  if (!latest) return null;
  const info = analyzeWrongNote(latest.midi, latest.want, latest.vexKey, keySignature);
  const delta = mistakeDeltaText(latest.midi, latest.want);
  // Micro-staff geometry: 5 main staff lines at positions 0, 2, 4, 6, 8 (each diatonic step = 3.2px)
  const stepPx = 3.2;
  const minPos = Math.min(-2, info.wantPos, info.ghostPos);
  const maxPos = Math.max(10, info.wantPos, info.ghostPos);
  const yOf = (pos: number) => 10 + (maxPos - pos) * stepPx;
  const svgH = Math.max(46, Math.ceil((maxPos - minPos) * stepPx + 20));
  const ledgersFor = (pos: number): number[] => {
    const out: number[] = [];
    if (pos <= -2) for (let p = -2; p >= pos; p -= 2) out.push(p);
    else if (pos >= 10) for (let p = 10; p <= pos; p += 2) out.push(p);
    return out;
  };
  const ghostLedgers = ledgersFor(info.ghostPos);
  const wantLedgers = ledgersFor(info.wantPos);
  const gx = 28;
  const wx = 66;
  return (
    <div className="ss-mistake-bar" aria-live="polite">
      <svg className="ss-mistake-staff" viewBox={`0 0 92 ${svgH}`} width="92" height={svgH} aria-hidden="true">
        {[0, 2, 4, 6, 8].map((p) => (
          <line key={p} className="ss-ms-line" x1="6" x2="86" y1={yOf(p)} y2={yOf(p)} />
        ))}
        {ghostLedgers.map((p) => (
          <line key={`gl:${p}`} className="ss-ms-ledger is-played" x1={gx - 9} x2={gx + 9} y1={yOf(p)} y2={yOf(p)} />
        ))}
        {wantLedgers.map((p) => (
          <line key={`wl:${p}`} className="ss-ms-ledger is-want" x1={wx - 9} x2={wx + 9} y1={yOf(p)} y2={yOf(p)} />
        ))}
        {/* Played wrong notehead + accidental */}
        {info.acc ? <text className="ss-ms-acc is-played" x={gx - 12} y={yOf(info.ghostPos) + 3.5}>{info.acc}</text> : null}
        <ellipse className="ss-ms-head is-played" cx={gx} cy={yOf(info.ghostPos)} rx="4.6" ry="3.2" transform={`rotate(-18 ${gx} ${yOf(info.ghostPos)})`} />
        {/* Arrow linking played -> written */}
        <line className="ss-ms-arrow" x1={gx + 8} y1={yOf(info.ghostPos)} x2={wx - 9} y2={yOf(info.wantPos)} />
        {/* Target written notehead */}
        <ellipse className="ss-ms-head is-want" cx={wx} cy={yOf(info.wantPos)} rx="4.6" ry="3.2" transform={`rotate(-18 ${wx} ${yOf(info.wantPos)})`} />
      </svg>
      <div className="ss-mistake-copy">
        <span className="ss-mistake-pair">
          <b className="is-played">Played {latest.name}</b>
          <em aria-hidden="true">→</em>
          <b className="is-want">Written {latest.wantName}</b>
        </span>
        <small>
          {[
            delta,
            latest.degree ? `deg ${latest.degree}` : null,
            latest.spot ? `str ${latest.spot.string + 1} · ${latest.spot.fret === 0 ? "open" : `fret ${latest.spot.fret}`}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
    </div>
  );
}

const GLINT_MS = 680;
const SPARKS = [24, 114, 204, 294];

/** A note as it lands: a lightweight GPU-composited glimmer using cached notehead coordinates (zero reflows). */
const ScoreGlints = memo(function ScoreGlints({ host, results, reset }: { host: RefObject<HTMLDivElement>; results: readonly NoteResult[]; reset: string }) {
  const [bursts, setBursts] = useState<{ key: string; x: number; y: number; kind: "hit" | "miss" }[]>([]);
  const before = useRef<{ reset: string; results: readonly NoteResult[] }>({ reset, results });
  const serial = useRef(0);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const prev = before.current;
    before.current = { reset, results };
    const el = host.current;
    if (!el || prev.reset !== reset) return;
    const cached = readNoteBoxes(el);
    let hostRect: DOMRect | null = null;
    const fresh: { key: string; x: number; y: number; kind: "hit" | "miss" }[] = [];
    for (let n = 0; n < results.length; n++) {
      const r = results[n];
      if (!r || prev.results[n] === r) continue;
      const box = cached?.[n];
      if (box) {
        fresh.push({ key: `${serial.current++}`, x: box.x + box.w / 2, y: box.y + box.h / 2, kind: r });
      } else {
        hostRect ??= el.getBoundingClientRect();
        const head = el.querySelector(`[data-note="${n}"] .vf-notehead`)?.getBoundingClientRect();
        if (head) fresh.push({ key: `${serial.current++}`, x: head.left - hostRect.left + el.scrollLeft + head.width / 2, y: head.top - hostRect.top + el.scrollTop + head.height / 2, kind: r });
      }
    }
    if (!fresh.length) return;
    setBursts((now) => [...now.slice(-12), ...fresh]);
    const keys = new Set(fresh.map((b) => b.key));
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      setBursts((now) => now.filter((b) => !keys.has(b.key)));
    }, GLINT_MS);
    timers.current.add(id);
  }, [results, reset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  return (
    <>
      {bursts.map((b) => (
        <span key={b.key} className={`ss-glint is-${b.kind}`} style={{ left: b.x, top: b.y }} aria-hidden="true">
          <b />
          {SPARKS.map((a, i) => <i key={a} style={{ "--a": `${a + (i % 2 ? 14 : 0)}deg`, "--d": `${b.kind === "hit" ? 18 + (i % 2) * 6 : 10}px` } as CSSProperties} />)}
        </span>
      ))}
    </>
  );
});

/** Scales, arpeggios and lines: read off the staff. The neck below shows where the hands are, and where they went wrong. */
function LineStage({ card, session: s, sheet, labels }: { card: Card; session: SessionApi; sheet: LeadSheet; labels: LabelMode }) {
  const p = card.p;
  const active = s.active >= 0 ? s.active : card.first;
  const seg = segmentOf(card, active);
  const ctx = card.context[active] ?? null;
  // How much of the neck there is to look at. A scale is its shape, so the neck is the point. A
  // line over the changes has it while it is new; later it steps back and returns when a note goes
  // wrong or the player has gone quiet. Reading exercises never show what is coming: only, when it
  // is called for, where the one note is that is being looked for.
  const called = useLately(s.nudge, NECK_MS);
  const astray = [active, active - 1, active - 2].some((i) => i >= card.first && s.results[i] === "miss");
  const neck = card.spot || card.family === "scales" || card.family === "technique" || isCustomExerciseId(card.id) || (!card.fresh && s.box < 2) ? "all" : called || astray ? (card.fresh ? "note" : "all") : "away";
  const whole = shapeOf(card, active);
  const here = card.steps[active];
  const shape = neck === "note" ? { key: `${card.id}:${active}`, spots: new Set(here ? [`${here.string}-${here.fret}`] : []) } : whole;
  // the board redraws when the harmony changes, not on every note
  const harmonyKey = ctx ? `${ctx.chord?.symbol}|${ctx.scale.id}|${ctx.next?.symbol}|${shape.key}` : "";
  const notes = useMemo(() => boardNotes(ctx, p, card.family, shape.spots), [harmonyKey, p, card.family]); // eslint-disable-line react-hooks/exhaustive-deps
  const position: Position = useMemo(() => ({ id: "V", label: "", from: p, to: p + 3 }), [p]);
  const pattern = useMemo(
    () => (neck === "note" ? (here ? [here] : []) : card.steps.slice(seg.from, seg.to + 1).filter((x): x is NonNullable<typeof x> => x !== null)),
    [card, seg.from, seg.to, neck, here],
  );

  // the line as notation: printed note k is target card.first + k
  const cardKeySig = useMemo(() => {
    const scale = card.context[card.first]?.scale;
    if (scale && (isCustomExerciseId(card.id) || isCurriculumStudyId(sheet.id))) return signatureFor(scale);
    return sheet.keySignature;
  }, [card, sheet.id, sheet.keySignature]);
  const written = useMemo(() => lineSheet(card, cardKeySig), [card, cardKeySig]);
  const heads = useMemo(() => written.bars.flatMap((b) => b.notes.filter((n) => !n.rest)), [written]);
  const results = useMemo(() => s.results.slice(card.first, card.last + 1), [s.results, card]);
  // under the notes: finger numbers on spiders, names in a spot, degrees when asked for
  const degrees = useMemo(
    () =>
      card.spot
        ? heads.map((_, k) => spelled(card, card.first + k))
        : card.kind === "spider"
          ? heads.map((_, k) => {
              const st = card.steps[card.first + k];
              return st ? String(fingerFor(st.fret, card.p)) : "";
            })
          : labels === "degrees" && !card.fresh
            ? heads.map((_, k) => degreeOf(card.family, card.context[card.first + k], card.tl.targets[card.first + k].midi))
            : null,
    [labels, heads, card],
  );
  const wrong = useMemo(() => {
    const out: WrongNote[] = [];
    for (let i = card.first; i <= card.last; i++) {
      const midi = s.shadows[i];
      const k = i - card.first;
      if (midi != null && s.results[i] === "miss" && heads[k])
        out.push({
          n: k,
          midi,
          want: card.tl.targets[i].midi,
          vexKey: heads[k].vexKey,
          name: playedName(card.context[i], midi),
          wantName: spelled(card, i),
          spot: card.steps[i] ?? null,
          degree: degreeOf(card.family, card.context[i], mod(card.tl.targets[i].midi)),
        });
    }
    return out;
  }, [s.shadows, s.results, card, heads]);
  const host = useRef<HTMLDivElement>(null);
  const playingBar = s.playback.playing ? (card.tl.slots[s.playback.activeSlot] ? s.playback.activeSlot - card.from : -1) : -1;
  // in time, a faint line follows the music being heard: from one printed note toward the next
  const { beatAt } = s.playback;
  const timed = s.phase === "time";
  const playhead = useMemo(() => {
    if (!timed) return undefined;
    const notes = card.tl.targets.slice(card.first, card.last + 1);
    const end = card.tl.slots[card.to].start + card.tl.slots[card.to].beats;
    return () => {
      const beat = beatAt();
      if (beat === null || !notes.length) return null;
      let lo = 0;
      let hi = notes.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (notes[mid].t <= beat + 1e-9) lo = mid + 1;
        else hi = mid;
      }
      const k = lo - 1;
      if (k < 0) return 0;
      const until = k + 1 < notes.length ? notes[k + 1].t : end;
      return k + Math.min(1, (beat - notes[k].t) / Math.max(1e-6, until - notes[k].t));
    };
  }, [timed, card, beatAt]);

  // what was played instead: a shadow on the neck, with a thread to the note that was meant
  const ghosts = useMemo(() => {
    const out: FretGhost[] = [];
    for (let i = Math.max(seg.from, active - 4); i <= Math.min(seg.to, active); i++) {
      const m = s.shadows[i];
      const to = card.steps[i];
      const spot = m != null && to ? ghostSpot(m, to, p) : null;
      if (spot && to) out.push({ key: `${i}:${m}`, ...spot, to });
    }
    return out;
  }, [s.shadows, card, seg.from, seg.to, active, p]);
  // and a ripple on each note as it lands, at the player's own pace
  const landed = s.phase === "pace" && active - 1 >= seg.from ? active - 1 : -1;
  const landedOn = landed >= 0 ? card.steps[landed] : null;
  const landedAs = landed >= 0 ? s.results[landed] : null;
  const pulse = useMemo(
    (): FretPulse | null => (landedOn && landedAs ? { key: `${s.follow.take}:${landed}`, string: landedOn.string, fret: landedOn.fret, kind: landedAs } : null),
    [landedOn, landedAs, landed, s.follow.take],
  );
  const lineHideBars = useMemo(() => (card.memory ? written.bars.map((_, i) => i) : null), [card.memory, written]);
  const showHarm = card.family !== "scales" && card.kind !== "spider";
  return (
    <div className={`ss-line ${showHarm ? "has-harm" : "no-harm"} ${neck === "away" ? "is-neck-away" : ""}`}>
      {showHarm ? <Harm ctx={ctx} scale /> : null}
      <div className="ss-score ss-score--line" data-scroll-host ref={host} data-pool="rock calm" data-pool-anchor="focus">
        <Score
          exercise={written}
          activeStep={s.active >= 0 ? s.active - card.first : -1}
          results={results}
          showFingering={false}
          autoScroll
          playingBar={playingBar}
          hideBars={lineHideBars}
          noteLabels={degrees}
          cursor
          cursorPulse={s.nudge}
          reentryCue={s.phase === "time" && s.reentry > 0 && s.reentry <= 2}
          playhead={playhead}
        />
        <ScoreShadows host={host} wrong={wrong} keySignature={sheet.keySignature} />
        <ScoreGlints host={host} results={results} reset={`${card.id}:${s.phase}`} />
      </div>
      <MistakeFlash wrong={wrong} keySignature={sheet.keySignature} />
      <div className={`ss-board ss-board--aside ${neck === "away" ? "is-away" : ""} ${card.spot ? "is-spot" : ""}`}>
        <Fretboard
          notes={notes}
          fretCount={Math.max(FRET_COUNT, ...card.steps.map((st) => (st ? st.fret + 1 : 0)))}
          position={position}
          labels={card.spot ? "names" : labels}
          pattern={pattern}
          activeStep={neck === "note" ? 0 : s.active >= 0 ? s.active - seg.from : -1}
          ghosts={neck === "note" ? undefined : ghosts}
          pulse={neck === "note" ? null : pulse}
        />
      </div>
      {card.spot ? <NowNote card={card} at={active} /> : null}
    </div>
  );
}

/** The note being looked for, spelled out: its name, its job over the chord, where it is and which finger takes it. */
function NowNote({ card, at }: { card: Card; at: number }) {
  const i = Math.max(card.first, Math.min(card.last, at));
  const step = card.steps[i];
  const ctx = card.context[i] ?? null;
  const target = card.tl.targets[i];
  if (!step || !target) return <p className="ss-now"> </p>;
  const job = degreeOf(card.family, ctx, mod(target.midi));
  const finger = fingerFor(step.fret, card.p);
  return (
    <p className="ss-now" key={i}>
      <b>{spelled(card, i)}</b>
      {job ? <span>{ctx?.chord && card.family !== "scales" ? `${job} of ${pretty(ctx.chord.symbol)}` : `degree ${job}`}</span> : null}
      <span>string {step.string + 1}</span>
      <span>{step.fret === 0 ? "open" : `fret ${step.fret}`}</span>
      {finger ? <span>finger {finger}</span> : null}
    </p>
  );
}

/** A part taken out of a melody: where its notes are on the neck, each with its name, and the one being looked for spelled out. */
function SpotNeck({ card, session: s }: { card: Card; session: SessionApi }) {
  const active = Math.max(card.first, Math.min(card.last, s.active >= 0 ? s.active : card.first));
  const ctx = card.context[active] ?? null;
  const steps = useMemo(() => card.steps.slice(card.first, card.last + 1).filter((x): x is NonNullable<typeof x> => x !== null), [card]);
  const spots = useMemo(() => new Set(steps.map((st) => `${st.string}-${st.fret}`)), [steps]);
  const harmonyKey = `${ctx?.chord?.symbol}|${ctx?.scale.id}`;
  const notes = useMemo((): FretNote[] => {
    if (ctx) return boardNotes(ctx, card.p, card.family, spots);
    // no chord under it: the notes by name
    return steps.map((st) => ({ string: st.string, fret: st.fret, pc: st.pc, midi: st.midi, name: nice(pitchClassToName(st.pc)), degree: "", role: "scale", inWindow: true, isNextTarget: false }));
  }, [harmonyKey, card, spots]); // eslint-disable-line react-hooks/exhaustive-deps
  const position: Position = useMemo(() => ({ id: "V", label: "", from: card.p, to: card.p + 3 }), [card.p]);
  const ghosts = useMemo(() => {
    const out: FretGhost[] = [];
    for (let i = Math.max(card.first, active - 3); i <= active; i++) {
      const m = s.shadows[i];
      const to = card.steps[i];
      const spot = m != null && to ? ghostSpot(m, to, card.p) : null;
      if (spot && to) out.push({ key: `${i}:${m}`, ...spot, to });
    }
    return out;
  }, [s.shadows, card, active]);
  return (
    <>
      <div className="ss-board ss-board--aside is-spot">
        <Fretboard notes={notes} fretCount={FRET_COUNT} position={position} labels="names" pattern={steps} activeStep={s.active >= 0 ? s.active - card.first : -1} ghosts={ghosts} />
      </div>
      <NowNote card={card} at={active} />
    </>
  );
}

/** The printed bars a card plays, cut out of the sheet: nothing else is on the page. */
function excerptOf(sheet: LeadSheet, bars: number[]) {
  const from = Math.min(...bars);
  const to = Math.max(...bars);
  let keySignature = sheet.keySignature;
  let timeSignature = sheet.timeSignature;
  for (let b = 0; b <= from; b++) {
    keySignature = sheet.bars[b].keyChange ?? keySignature;
    timeSignature = sheet.bars[b].timeChange ?? timeSignature;
  }
  const heads = (b: ReadingBar) => b.notes.filter((n) => !n.rest).length;
  const offset = sheet.bars.slice(0, from).reduce((n, b) => n + heads(b), 0); // printed notes before the excerpt
  const cutBars = sheet.bars.slice(from, to + 1).map((b, i) => (i === 0 ? { ...b, keyChange: undefined, timeChange: undefined } : b));
  return { exercise: { bars: cutBars, keySignature, timeSignature }, from, offset, count: cutBars.reduce((n, b) => n + heads(b), 0) };
}

/**
 * Melody cards too long for a page (the whole tune, a run-through, a long section) are read as
 * they are played: repeats unrolled, flowing under a still line. Memory work and parts taken out
 * keep the page, where hiding and naming notes by bar make sense.
 */
const FLOW_BARS = 8;
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const noteWithOctave = (midi: number) => `${NOTE_NAMES[mod(midi)]}${Math.floor(midi / 12) - 1}`;

/** "C3 → A4 → C3", with the low turn when it goes under where it started. */
function passName(pass: readonly number[]): string {
  const top = Math.max(...pass);
  const low = Math.min(...pass);
  return [pass[0], top, ...(low < pass[0] ? [low] : []), pass[pass.length - 1]].map(noteWithOctave).join(" → ");
}

/** Where on the neck this scale exercise is played: the current shape, and the others one click away. */
function ShapePicker({ card, shapes, onShape }: { card: Card; shapes: ShapeOption[]; onShape(shapeId: string): void }) {
  const [open, setOpen] = useState(false);
  const scale = card.context[card.first]?.scale;
  const current = shapes.find((o) => o.id === (card.shape ?? "")) ?? shapes[0];
  const played = card.steps.flatMap((st) => (st ? [st.fret] : []));
  const span = played.length ? (Math.min(...played) === Math.max(...played) ? `fret ${played[0]}` : `frets ${Math.min(...played)}–${Math.max(...played)}`) : "";
  const frets = (o: ShapeOption) => (o.id === (card.shape ?? "") ? span : o.p === null || !scale ? "" : shapeFrets(scale, o));
  return (
    <div className={`ss-shape ${open ? "is-open" : ""}`}>
      <button type="button" className="ss-shape-now" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Guitar menu → Session controls → Shape">
        <span>{current.label}</span>
        <em>{frets(current)}</em>
        <i className="ss-shape-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul className="ss-shape-list" role="menu">
          {shapes.map((o) => (
            <li key={o.id || "default"}>
              <button type="button" role="menuitemradio" aria-checked={o.id === current.id} className={o.id === current.id ? "is-now" : ""} onClick={() => { setOpen(false); if (o.id !== current.id) onShape(o.id); }}>
                <span>{o.label}</span>
                <em>{o.id === "" && o.id !== current.id ? "the deck's own line" : frets(o)}</em>
              </button>
            </li>
          ))}
          <li className="ss-shape-hint" data-nav-skip>guitar menu · Session controls · Shape</li>
        </ul>
      ) : null}
    </div>
  );
}

/** The shapes a scale exercise can be played in (none for other exercises): the default and every shape that holds a line. */
function playableShapes(card: Card, book: ShapeBook): ShapeOption[] {
  const scale = card.family === "scales" && card.base ? card.context[card.first]?.scale : null;
  if (!scale) return [];
  const drill = card.kind as "run" | "thirds" | "triads" | "sevenths";
  return shapeOptions(scale, book).filter((o) => o.id === "" || shapeLine(drill, scale, o).length > 0);
}

function flows(card: Card): boolean {
  return card.view === "score" && card.family === "melody" && !card.memory && !card.spot && (Boolean(card.run) || card.step?.kind === "tune" || card.to - card.from + 1 > FLOW_BARS);
}

const EMPTY_NUMS: readonly number[] = [];

function FlowStage({ card, session: s, sheet: source }: { card: Card; session: SessionApi; sheet: LeadSheet }) {
  const sheet = useMemo(() => card.rhythmPitch !== undefined ? rhythmSheet(source, card.rhythmPitch) : source, [source, card.rhythmPitch]);
  const flow = useMemo(() => flowOf(sheet, card.tl, card.from, card.to, card.first, card.last), [sheet, card]);
  const over = useMemo(() => melodyOverChords(sheet), [sheet]);
  const labels = useMemo(() => flow.printed.map((k) => over.degree[k] ?? null), [flow, over]);
  // each flow note shows the result of the one time through it stands for
  const results = useMemo(() => {
    const out: NoteResult[] = flow.printed.map(() => null);
    flow.notesOf.forEach((ids, i) => {
      const r = s.results[card.first + i];
      if (r) ids.forEach((u) => (out[u] = r));
    });
    return out;
  }, [flow, s.results, card.first]);
  const active = s.active >= card.first ? flow.notesOf[s.active - card.first] ?? EMPTY_NUMS : EMPTY_NUMS;
  const ctx = card.context[Math.max(card.first, Math.min(card.last, s.active))];
  const track = useRef<HTMLDivElement>(null);
  const heads = useMemo(() => flow.exercise.bars.flatMap((b) => b.notes.filter((n) => !n.rest)), [flow]);
  const wrong = useMemo(() => {
    const out: WrongNote[] = [];
    s.shadows.forEach((midi, i) => {
      const n = flow.notesOf[i - card.first]?.[0];
      const t = card.tl.targets[i];
      if (midi == null || n === undefined || !t || results[n] !== "miss" || !heads[n]) return;
      out.push({ n, midi, want: t.midi, vexKey: heads[n].vexKey, name: playedName(card.context[i], midi), wantName: spelled(card, i) });
    });
    return out;
  }, [s.shadows, flow, card, results, heads]);
  const zoom = useScoreZoom(s.box);
  const { beatAt } = s.playback;
  const through = useCallback(() => beatAt(true), [beatAt]);
  const follow = s.phase === "pace" && s.active >= 0 ? card.tl.targets[s.active]?.t ?? null : null;
  return (
    <div className="ss-melody ss-melody--flow">
      <Harm ctx={ctx} />
      <ScoreFlow
        flow={flow}
        results={results}
        active={active}
        clock={s.playback.playing ? through : undefined}
        heard={beatAt}
        follow={follow}
        hold={s.phase === "result"}
        lookahead={zoom.lookahead}
        scale={zoom.scale}
        labels={labels}
        pulse={s.nudge}
        trackRef={track}
        onZoom={zoom.step}
      >
        <ScoreShadows host={track} wrong={wrong} keySignature={flow.exercise.keySignature} />
        <ScoreGlints host={track} results={results} reset={`${card.id}:${s.phase}`} />
      </ScoreFlow>
    </div>
  );
}

function MelodyStage({ card, session: s, sheet: source }: { card: Card; session: SessionApi; sheet: LeadSheet }) {
  const sheet = useMemo(() => card.rhythmPitch !== undefined ? rhythmSheet(source, card.rhythmPitch) : source, [source, card.rhythmPitch]);
  const over = useMemo(() => melodyOverChords(sheet), [sheet]);
  const bars = useMemo(() => {
    const set = new Set<number>();
    for (let i = card.from; i <= card.to; i++) set.add(card.tl.slots[i].bar);
    return [...set];
  }, [card]);
  // only the bars in play are on the page; everything below counts notes and bars from its start
  const cut = useMemo(() => excerptOf(sheet, bars), [sheet, bars]);
  const local = useMemo(() => bars.map((b) => b - cut.from), [bars, cut.from]);
  const memoryBars = useMemo(() => cut.exercise.bars.map((_, index) => index), [cut]);
  const gaps = local.length < cut.exercise.bars.length; // bars in between that this card doesn't play
  const labels = useMemo(() => {
    const degrees = over.degree.slice(cut.offset, cut.offset + cut.count);
    if (!card.spot) return degrees;
    // a part taken out: every note by name
    const names: (string | null)[] = degrees.map(() => null);
    for (let i = card.first; i <= card.last; i++) for (const n of card.tl.targets[i].notes.slice(0, 1)) names[n - cut.offset] = spelled(card, i);
    return names;
  }, [over, cut, card]);
  const cursor = Math.max(card.first, s.active);
  const printed = useMemo(() => printedResults(card.tl, s.results, cursor), [card, s.results, cursor]);
  const results = useMemo(() => Array.from({ length: cut.count }, (_, k) => printed[cut.offset + k] ?? null), [printed, cut]);
  const activeNotes = useMemo(
    () => (s.active >= 0 ? card.tl.targets[s.active]?.notes ?? [] : []).map((n) => n - cut.offset),
    [s.active, card, cut.offset],
  );
  const playingBar = s.playback.playing ? (card.tl.slots[s.playback.activeSlot]?.bar ?? -1) - cut.from : -1;
  const ctx = card.context[Math.max(card.first, Math.min(card.last, s.active))];
  const host = useRef<HTMLDivElement>(null);
  // shadow notes: what was played instead, written next to the note at its own height
  const heads = useMemo(() => sheet.bars.flatMap((b) => b.notes.filter((n) => !n.rest)), [sheet]);
  const wrong = useMemo(() => {
    const out: WrongNote[] = [];
    s.shadows.forEach((midi, i) => {
      const t = card.tl.targets[i];
      const n = t?.notes[0];
      if (midi == null || n === undefined || printed[n] !== "miss" || !heads[n]) return;
      out.push({
        n: n - cut.offset,
        midi,
        want: t.midi,
        vexKey: heads[n].vexKey,
        name: playedName(card.context[i], midi),
        wantName: spelled(card, i),
        spot: card.steps[i] ?? null,
        degree: degreeOf(card.family, card.context[i], mod(t.midi)),
      });
    });
    return out;
  }, [s.shadows, printed, card, heads, cut.offset]);
  return (
    <div className="ss-melody">
      <Harm ctx={ctx} />
      <div className="ss-score" data-scroll-host ref={host} data-pool="rock calm" data-pool-anchor="focus">
        <Score
          exercise={cut.exercise}
          activeStep={activeNotes[0] ?? -1}
          activeNotes={activeNotes}
          results={results}
          showFingering={false}
          autoScroll
          playingBar={playingBar}
          focusBars={gaps ? local : null}
          hideBars={s.memoryStage ? s.memoryStage === "page" ? null : memoryBars : card.memory ? local : null}
          noteVisibility={s.memoryStage === "landmarks" ? "landmarks" : s.memoryStage === "hidden" ? "hidden" : "played"}
          noteLabels={s.memoryStage && s.memoryStage !== "page" ? null : labels}
          cursor
          cursorPulse={s.nudge}
          reentryCue={s.phase === "time" && s.reentry > 0 && s.reentry <= 2}
        />
        {!s.memoryStage || s.memoryStage === "page" ? <ScoreShadows host={host} wrong={wrong} keySignature={cut.exercise.keySignature} /> : null}
        <ScoreGlints host={host} results={results} reset={`${card.id}:${s.phase}`} />
      </div>
      {!s.memoryStage || s.memoryStage === "page" ? <MistakeFlash wrong={wrong} keySignature={cut.exercise.keySignature} /> : null}
      {card.spot ? <SpotNeck card={card} session={s} /> : null}
    </div>
  );
}

function ChordStage({ card, session: s }: { card: Card; session: SessionApi }) {
  const at = Math.max(card.first, Math.min(card.last, s.active >= 0 ? s.active : card.first));
  const ctx = card.context[at];
  const v = card.voicings[at];
  // the next chord that is a change: comping strikes the same one several times
  const nextAt = (() => {
    for (let k = 1; k <= card.last - card.first; k++) {
      const i = card.first + ((at - card.first + k) % (card.last - card.first + 1));
      if (card.context[i]?.chord?.symbol !== ctx?.chord?.symbol) return i;
    }
    return at + 1 <= card.last ? at + 1 : card.first;
  })();
  const next = card.context[nextAt];
  const pacing = s.phase === "pace";
  const heard = pacing ? s.chords.present : [];
  return (
    <div className="ss-chords">
      <div className="ss-chords-pair">
        <div className="ss-chords-now">
          <span className="ss-chord-name">{ctx?.chord ? pretty(ctx.chord.symbol) : ""}</span>
          <span className="ss-chord-roman">{ctx?.roman}</span>
          {v ? <ChordBox voicing={v} heard={heard} /> : null}
          <span className={`ss-tones ${pacing && ctx?.chord ? "" : "is-hidden"}`}>
            {(ctx?.chord?.required ?? []).map((pc) => (
              <i key={pc} className={heard.includes(pc) ? "is-on" : ""}>
                {IV_LABEL[mod(pc - ctx!.chord!.root)]}
              </i>
            ))}
          </span>
        </div>
        {next?.chord && card.last > card.first ? (
          <div className="ss-chords-next">
            <span>then</span>
            <b>{pretty(next.chord.symbol)}</b>
            {card.voicings[nextAt] ? <ChordBox voicing={card.voicings[nextAt]!} size="small" /> : null}
          </div>
        ) : null}
      </div>
      <ol className="ss-strip">
        {card.context.slice(card.first, card.last + 1).map((c, k) => {
          const i = card.first + k;
          return (
            <li key={i} className={`${i === at ? "is-now" : ""} ${s.results[i] ? `is-${s.results[i]}` : ""}`}>
              {c?.chord ? pretty(c.chord.symbol) : ""}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The neck, asked about: one prompt at a time, answered by playing; what was found stays on the neck. */
function PromptStage({ card, session: s, labels }: { card: Card; session: SessionApi; labels: LabelMode }) {
  const at = Math.max(card.first, Math.min(card.last, s.active >= 0 ? s.active : card.last));
  const k = at - card.first;
  const prompt = card.prompts?.[k];
  const pattern = useMemo(() => {
    const found = card.steps.slice(card.first, at).filter((x, i): x is NonNullable<typeof x> => x !== null && s.results[card.first + i] === "hit");
    const shown = prompt?.show ? [{ string: prompt.show.string, fret: prompt.show.fret, pc: 0, midi: 0, startBeat: 0, durationBeats: 1 }] : [];
    return [...found, ...shown];
  }, [card, at, prompt, s.results]);
  const position: Position | undefined = useMemo(() => (card.kind === "onstring" ? undefined : { id: "V", label: "", from: card.p, to: card.p + 3 }), [card]);
  return (
    <div className="ss-prompts">
      <p className="ss-prompt" key={k} aria-live="polite">
        <b>{prompt?.text ?? ""}</b>
        <span>{prompt?.sub ?? ""}</span>
      </p>
      <div className="ss-board ss-board--stage">
        <Fretboard notes={[]} fretCount={12} position={position} labels={labels} pattern={pattern} activeStep={prompt?.show ? pattern.length - 1 : -1} />
      </div>
      <ol className="ss-strip" aria-label="the notes asked for">
        {(card.prompts ?? []).map((_, j) => {
          const i = card.first + j;
          return <li key={i} className={`${i === at ? "is-now" : ""} ${s.results[i] ? `is-${s.results[i]}` : ""}`}>{s.results[i] ? card.prompts![j].text.split(" ")[0] : "·"}</li>;
        })}
      </ol>
    </div>
  );
}

/** Improvising: the chord now and next, its notes lit in the position, the strong beats as they land. */
function ImprovStage({ card, session: s, labels }: { card: Card; session: SessionApi; labels: LabelMode }) {
  const at = Math.max(card.first, Math.min(card.last, s.active >= 0 ? s.active : card.first));
  const ctx = card.context[at] ?? null;
  const p = card.p;
  const lit = useMemo(() => {
    const pcs = new Set(card.tl.targets[at]?.any ?? []);
    const spots = new Set<string>();
    OPEN_MIDI.forEach((open, string) => {
      for (let fret = Math.max(0, p - 1); fret <= p + 4; fret++) if (pcs.has(mod(open + fret))) spots.add(`${string}-${fret}`);
    });
    return spots;
  }, [card, at, p]);
  const notes = useMemo(() => boardNotes(ctx, p, "harmony", lit), [ctx?.chord?.symbol, ctx?.scale.id, p, lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const position: Position = useMemo(() => ({ id: "V", label: "", from: p, to: p + 3 }), [p]);
  const proposal = "proposal" in card ? (card as { proposal?: string }).proposal : undefined;
  return (
    <div className="ss-improv">
      <Harm ctx={ctx} scale />
      {proposal ? <p className="ss-improv-proposal">{proposal}</p> : null}
      <div className="ss-board ss-board--stage">
        <Fretboard notes={notes} fretCount={Math.max(12, p + 5)} position={position} labels={labels} />
      </div>
      <ol className="ss-strip" aria-label="the strong beats">
        {card.tl.targets.slice(card.first, card.last + 1).map((_, k) => {
          const i = card.first + k;
          return <li key={i} className={`${i === at ? "is-now" : ""} ${s.results[i] ? `is-${s.results[i]}` : ""}`}>{k === 0 || card.context[i]?.chord?.symbol !== card.context[i - 1]?.chord?.symbol ? pretty(card.context[i]?.chord?.symbol ?? "") : "·"}</li>;
        })}
      </ol>
    </div>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8 v2.6 M12 18.6 v2.6 M2.8 12 h2.6 M18.6 12 h2.6 M5.5 5.5 l1.9 1.9 M16.6 16.6 l1.9 1.9 M18.5 5.5 l-1.9 1.9 M7.4 16.6 l-1.9 1.9" />
    </svg>
  );
}

// ---------- behind the gear: everything that isn't the exercise ----------

function Switch({ on, onChange, children, tone, lit }: { on: boolean; onChange(on: boolean): void; children: ReactNode; tone?: number | null; lit?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="ss-switch" onClick={() => onChange(!on)}>
      <span>{children}</span>
      <span className="ss-switch-end">
        <ToneTag pc={tone} lit={lit ?? false} />
        <i />
      </span>
    </button>
  );
}

function Seg<T extends string | number | null>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange(v: T): void }) {
  return (
    <div className="ss-row">
      <span>{label}</span>
      <span className="ss-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button type="button" key={String(o.value)} className={o.value === value ? "is-on" : ""} title={o.title} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

const ROOM_LABEL: Record<RoomMode, string> = { still: "still", water: "water", living: "living", "living-power": "living on power" };

function Drawer({
  deck,
  session: s,
  input,
  outputs,
  plan,
  windowP,
  onWindow,
  labels,
  onLabels,
  full,
  onFull,
  tones,
  tapped,
  onClose,
  mix,
  onMix,
}: {
  deck: Deck;
  session: SessionApi;
  input: InputApi;
  outputs: ReturnType<typeof useOutputs>;
  plan: string[];
  windowP: number | null;
  onWindow(p: number | null): void;
  labels: LabelMode;
  onLabels(l: LabelMode): void;
  full: boolean;
  onFull(): void;
  tones: number[];
  tapped: number | null;
  onClose(): void;
  mix: boolean | null; // null: there are no other tunes
  onMix(): void;
}) {
  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  const { settings, updateSettings, store } = s;
  const room = useRoomRender();
  const navSilence = useNavSilence();
  const live = s.running && !s.finished;
  const list = s.running ? s.queue : plan;
  const counts = boxCounts(deck, store);
  const max = Math.max(1, ...counts.boxes, counts.fresh);
  const listening = input.status === "listening";
  return (
    <>
      <div className="ss-scrim" onClick={onClose} />
      <aside className="ss-drawer" aria-label="settings">
        <header>
          <h2>Settings</h2>
          <button type="button" className="ss-icon" onClick={onClose} aria-label="close settings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" />
            </svg>
          </button>
        </header>

        <RecordingRecovery input={input} tones={tones.slice(3)} />

        <section>
          <h3>Listening</h3>
          <div className="ss-listen">
            <Ear input={input} size="small" />
            <div>
              <b>{input.status === "starting" ? "Opening input…" : listening ? (input.paused ? "Audio suspended" : "Guitar listening") : "Input off"}</b>
              <span>{input.error ?? (input.paused ? "Click the circle to resume audio. The session waits here." : listening ? "Play a note. The circle names what it hears." : "Connect your guitar, then click the circle to enable listening.")}</span>
            </div>
          </div>
          {input.devices.length > 0 ? (
            <label className="ss-select">
              <span>Guitar input</span>
              <select value={input.deviceId ?? ""} onChange={(e) => input.setDeviceId(e.target.value)} aria-label="audio input">
                {input.deviceId && !input.devices.some((d) => d.id === input.deviceId) ? <option value={input.deviceId}>Default input</option> : null}
                {input.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {outputs.supported ? (
            <label className="ss-select">
              <span>Sound output</span>
              <select value={outputs.id} onChange={(e) => void outputs.choose(e.target.value)} aria-label="audio output">
                {outputs.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="ss-note">The app's sound follows the system's output: this browser can't send it elsewhere (Chrome and Edge can).</p>
          )}
          <div className="ss-row">
            <span title="Require silence before shell guitar navigation (D♯5) can arm">Nav after silence</span>
            <span className="ss-stepper">
              <button
                type="button"
                onClick={() => navSilence.set(navSilence.seconds - 1)}
                disabled={navSilence.seconds <= MIN_NAV_SILENCE_S}
                aria-label="less silence before guitar navigation"
              >
                −
              </button>
              <b>{navSilence.seconds === 0 ? "off" : `${navSilence.seconds}s`}</b>
              <button
                type="button"
                onClick={() => navSilence.set(navSilence.seconds + 1)}
                disabled={navSilence.seconds >= MAX_NAV_SILENCE_S}
                aria-label="more silence before guitar navigation"
              >
                +
              </button>
            </span>
          </div>
        </section>

        {live ? (
          <section>
            <h3>This exercise</h3>
            <div className="ss-row">
              <span>Tempo</span>
              <span className="ss-stepper">
                <button type="button" onClick={() => s.tempo(-4)} aria-label="slower">
                  −
                </button>
                <b>{s.bpm}</b>
                <button type="button" onClick={() => s.tempo(4)} aria-label="faster">
                  +
                </button>
              </span>
            </div>
            <div className="ss-actions">
              <button type="button" disabled={s.pos === 0} onClick={() => (s.prev?.(), onClose())}>
                Previous exercise
              </button>
              <button type="button" onClick={() => (s.again(), onClose())}>
                Start it again
              </button>
              <button type="button" onClick={() => (s.skip(), onClose())}>
                {s.phase === "time" || s.phase === "result" ? "Skip it" : "Next step"}
              </button>
              {!s.spot && s.card && !s.card.once ? (
                <button type="button" onClick={() => (s.accept?.(), onClose())} title="Mark accepted and exclude from future sessions">
                  Accept &amp; exclude
                </button>
              ) : null}
              <button type="button" onClick={() => (s.finish(), onClose())}>
                Stop now
              </button>
            </div>
          </section>
        ) : null}

        <section>
          <h3>Session</h3>
          <Seg label="New exercises a day" value={settings.newPerSession} options={[2, 3, 4, 6].map((n) => ({ value: n, label: String(n) }))} onChange={(n) => updateSettings({ newPerSession: n })} />
          <Seg
            label="Position"
            value={windowP}
            options={[{ value: null as number | null, label: "auto" }, ...[1, 2, 3, 4, 5, 6].map((p) => ({ value: p as number | null, label: String(p), title: `frets ${p}–${p + 3}` }))]}
            onChange={onWindow}
          />
          <Seg
            label="Note labels"
            value={labels}
            options={[
              { value: "names" as LabelMode, label: "names" },
              { value: "degrees" as LabelMode, label: "degrees" },
            ]}
            onChange={onLabels}
          />
          <Seg
            label="Loop wrap"
            value={s.loopMode}
            options={[
              { value: "adaptive" as LoopMode, label: "adaptive", title: "Continuous circle on short phrases; live-band turnaround on longer sections while learning" },
              { value: "turnaround" as LoopMode, label: "turnaround", title: "Always play a live-band turnaround bar between passes" },
              { value: "continuous" as LoopMode, label: "continuous", title: "Loop continuously with no turnaround bar" },
            ]}
            onChange={s.setLoopMode}
          />
          <Switch on={Boolean(settings.shuffle)} onChange={(v) => updateSettings({ shuffle: v })}>
            Shuffle the session
          </Switch>
          {mix !== null && !live ? (
            <Switch on={mix} onChange={onMix}>
              Mix in my other tunes
            </Switch>
          ) : null}
          <Switch on={s.click} onChange={(v) => s.setClick(v)} tone={tones[0]} lit={tapped === 2}>
            Click with the band
          </Switch>
          <Switch on={Boolean(settings.gapClick)} onChange={(v) => updateSettings({ gapClick: v })}>
            Band dropouts on scales
          </Switch>
          <Switch on={settings.guide} onChange={(v) => updateSettings({ guide: v })} tone={tones[1]} lit={tapped === 3}>
            Always play the melody under me
          </Switch>
          <Switch on={settings.voice} onChange={(v) => updateSettings({ voice: v })} tone={tones[2]} lit={tapped === 4}>
            Say each exercise's name
          </Switch>
          <Switch on={full} onChange={onFull}>
            Full screen
          </Switch>
          <Seg label="Room" value={room.mode} options={ROOM_MODES.map((mode): { value: RoomMode; label: string; title?: string } => ({ value: mode, label: ROOM_LABEL[mode], title: mode === room.mode ? room.value : undefined }))} onChange={room.set} />
        </section>

        <section>
          <h3>{s.running ? "This session" : "Today"}</h3>
          <ol className="ss-plan">
            {list.map((id, i) => {
              const c = byId.get(id);
              const st = store.cards[id];
              return (
                <li key={i} className={`fam-${c?.family ?? "melody"} ${live && i === s.pos ? "is-now" : ""} ${live && i < s.pos ? "is-done" : ""}`}>
                  <i />
                  <span>{c?.title ?? id}</span>
                  <em>{st ? `box ${st.box}` : "new"}</em>
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <h3>Card box</h3>
          <div className="ss-boxes" role="img" aria-label="exercises per box">
            <div className="ss-box is-new">
              <i style={{ height: `${(counts.fresh / max) * 100}%` }} />
              <b>{counts.fresh}</b>
              <span>new</span>
            </div>
            {counts.boxes.map((n, i) => (
              <div key={i} className="ss-box">
                <i style={{ height: `${(n / max) * 100}%` }} />
                <b>{n}</b>
                <span>{i + 1}</span>
              </div>
            ))}
          </div>
          <p className="ss-note">Clean: climbs tempo and moves up a box (graduating to 7–21 day spacing near goal tempo). Missed: steps back gently.</p>
        </section>

        {Object.entries(store.cards).some(([id, st]) => isExcluded(st) && byId.has(id)) ? (
          <section>
            <h3>Accepted &amp; excluded</h3>
            <ul className="ss-excluded-list">
              {Object.entries(store.cards)
                .filter(([id, st]) => isExcluded(st) && byId.has(id))
                .map(([id]) => (
                  <li key={id}>
                    <span>{byId.get(id)?.title ?? id}</span>
                    <button type="button" onClick={() => s.restoreExcluded?.(id)}>
                      Restore
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3>The tune</h3>
          <ul className="ss-map">
            {deck.harmony.centres.map((c) => (
              <li key={c.key.id}>
                <b>{c.key.name}</b>
                <span>
                  {c.scales
                    .filter((x) => x.scale.root === c.key.tonic)
                    .map((x) => x.scale.name)
                    .join(" · ")}
                </span>
              </li>
            ))}
            {deck.harmony.cadences.map((c) => (
              <li key={c.id}>
                <b>{c.label}</b>
                <span>{c.chords.map((x) => pretty(x.symbol)).join(" → ")}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Keys and pedal</h3>
          <p className="ss-keys">
            <kbd>Space</kbd> pause <kbd>→</kbd> skip <kbd>←</kbd> again <kbd>H</kbd> hear it <kbd>B</kbd> this bar alone <kbd>P</kbd> previous <kbd>N</kbd> next <kbd>−</kbd> <kbd>+</kbd> tempo <kbd>C</kbd> click <kbd>G</kbd> melody <kbd>L</kbd> labels <kbd>F</kbd> free play <kbd>S</kbd> settings <kbd>Esc</kbd> leave
          </p>
        </section>
      </aside>
    </>
  );
}

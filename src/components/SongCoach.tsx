import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { useOutputs } from "../audio/output";
import type { FretNote, Position, ReadingBar } from "../core/contract";
import { OPEN_MIDI } from "../core/scales";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { mod, pitchClassToName } from "../musicTheory";
import { melodyOverChords } from "../tunes/learn";
import type { LeadSheet } from "../tunes/musicxml";
import { printedResults, type Timeline } from "../tunes/order";
import { buildDeck, FAMILY_LABEL, familiesOnly, FOCUS_FAMILIES, FOCUS_LABEL, mixDecks, noteName as spelled, rhythmSourceId, type Card, type Context, type Deck, type Focus } from "../song/deck";
import { rhythmSheet } from "../song/rhythm";
import { arrangementIdentity, goalDeck, loadActiveGoal } from "../song/goals";
import { useGoals } from "../song/useGoals";
import { fitTiming, timingTolerance } from "../tunes/scoring";
import { localId } from "../song/ids";
import { KEY_FIFTHS, lineSheet } from "../song/notation";
import { makeScale, nice, pretty, spellIn } from "../song/harmony";
import { allStores, BOXES, boxCounts, loadStore, saveMeta, today, type Store } from "../song/leitner";
import { cardSeconds, LENGTH_MINUTES, LENGTHS, loadArc, planBlocks, saveArc, type SessionPlan } from "../song/planner";
import { currentInputSetup } from "../audio/setup";
import { allAttempts, buildProfile } from "../song/profile";
import { latencyMeasured } from "../audio/latency";
import { fingerFor } from "../song/spot";
import { useSession, type Outcome, type SessionApi } from "../song/useSession";
import { ChordBox } from "./ChordBox";
import { loadProfile } from "../listen/calibration";
import { Calibrate } from "./Calibrate";
import { Ear } from "./Ear";
import { FreePlay } from "./FreePlay";
import { drawerToneKeys, GuitarPad, NoteTag, noteName as keyName, ToneTag, toneKeysFor, useNoteKeys, useSummon, useToneKeys, type PadRow } from "./GuitarPad";
import { Fretboard, type FretGhost, type FretPulse, type LabelMode } from "./Fretboard";
import { BeatPulse, PracticeAtmosphere } from "./PracticeAtmosphere";
import { Score } from "./Score";
import { SessionSummary } from "./SessionSummary";
import { RecordingRecovery, RecordingStatus } from "./RecordingStatus";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import "../song/song.css";
import "../song/coach-flow.css";

// The practice session, full screen and quiet: one exercise at a time, hands on the guitar. The
// guitar runs it: hold a note to begin, play to move on, start over whenever. Single notes the
// exercise doesn't use are keys (hear it again, your pace, in time, next), each shown beside
// what it works; holding the open low E calls the menu. Everything else (settings, the card box,
// the plan) lives behind the gear; keys and a pedal still work.

interface SongCoachProps {
  sheet: LeadSheet;
  tl: Timeline;
  input: InputApi;
  onClose(): void;
  tunes?: { id: string; title: string }[]; // the library, to move to another tune from the guitar
  onTune?(id: string): void;
  others?: { sheet: LeadSheet; tl: Timeline }[]; // the library's other tunes: their exercises can be mixed into the session
  focus?: Focus; // a tutor mode: only that mode's card families
  initialCardId?: string; // an exercise chosen on the overview or a focused mode
}

const FRET_COUNT = 12;
const PAGE = 8; // notes of a long run shown on the fretboard at once
const HOLD_MS = 700; // a note held this long is a "yes"
const HOLD_GAP_MS = 160;
const IDLE_MS = 2600; // then the corner buttons and the cursor fade
const READY_KEYS = [50, 49, 56, 53, 51]; // D: free play · C♯: settings · G♯: mix · F: length · E♭: self-guided
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

const LETTERS = "cdefgab";
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const FLAT_LETTER = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];

/**
 * Where a wrong note sits on the staff relative to the printed one: staff steps up, and the
 * accidental it needs in this key. `vexKey` is the printed note, `want` its sounding pitch.
 */
function staffShadow(midi: number, want: number, vexKey: string, key: string): { steps: number; acc: string } {
  const fifths = KEY_FIFTHS[key] ?? 0;
  const flats = fifths < 0;
  const altered = (flats ? [6, 2, 5, 1, 4, 0, 3] : [3, 0, 4, 1, 5, 2, 6]).slice(0, Math.abs(fifths)); // letters the signature changes
  const m = foldNear(midi, want);
  const pc = mod(m);
  const letter = (flats ? FLAT_LETTER : SHARP_LETTER)[pc];
  const black = pc !== NATURAL_PC[letter];
  const acc = black ? (altered.includes(letter) ? "" : flats ? "♭" : "♯") : altered.includes(letter) ? "♮" : "";
  const wantLetter = Math.max(0, LETTERS.indexOf(vexKey[0]));
  const wantOctave = Math.round((want - NATURAL_PC[wantLetter]) / 12) - 1;
  // a flat C sits in the octave above its pitch's, a sharp B in the one below: only black keys are spelled here
  return { steps: (Math.floor(m / 12) - 1) * 7 + letter - (wantOctave * 7 + wantLetter), acc };
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

/** Prime sound from the opening click; a new microphone permission remains an explicit choice. */
export function openPractice(input: InputApi) {
  ensureAudio();
  void Tone.start().catch(() => undefined);
  if (input.status === "idle" || input.status === "error") input.autoStart();
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => undefined);
}

/** The pitch classes a card plays, chords included: tone keys are picked from outside them. */
function pitchClassesOf(card: Card): number[] {
  return card.tl.targets.slice(card.first, card.last + 1).flatMap((t) => (t.chord ? [...t.chord.voicing, ...t.chord.required] : [t.midi])).map((m) => mod(m));
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

/** The guitar's "yes": a note held for a moment. Fills the ring it returns while the note rings. Notes in `except` (pitch classes) mean something else. */
function useHold(input: InputApi, enabled: boolean, onHold: () => void, except: number[] = []): RefObject<SVGCircleElement> {
  const ring = useRef<SVGCircleElement>(null);
  const cb = useRef(onHold);
  cb.current = onHold;
  const skip = useRef(except);
  skip.current = except;
  const listening = input.status === "listening";
  const { subscribe } = input;
  useEffect(() => {
    const set = (p: number) => {
      if (ring.current) ring.current.style.strokeDashoffset = String(1 - p);
    };
    set(0);
    if (!enabled || !listening) return;
    let pc: number | null = null;
    let since = 0;
    let seen = 0;
    let fired = false;
    return subscribe((f) => {
      if (fired) return;
      const heard = midiOf(f);
      const m = heard !== null && skip.current.includes(mod(heard)) ? null : heard;
      if (m !== null) {
        if (pc === null || mod(m) !== pc) {
          pc = mod(m);
          since = f.now;
        }
        seen = f.now;
      } else if (pc !== null && f.now - seen > HOLD_GAP_MS) pc = null;
      const p = pc === null ? 0 : Math.min(1, (f.now - since) / HOLD_MS);
      set(p);
      if (p >= 1) {
        fired = true;
        cb.current();
      }
    });
  }, [enabled, listening, subscribe]);
  return ring;
}

/** How often each exercise of a tune has been played: decides what its reading exercises bring next. */
const seenIn = (tuneId: string) => Object.fromEntries(Object.entries(loadStore(tuneId).cards).map(([id, st]) => [id, st.seen]));

export function SongCoach(props: SongCoachProps) {
  return <PracticeWindowBoundary onExit={props.onClose}><SongCoachSession {...props} /></PracticeWindowBoundary>;
}

function SongCoachSession({ sheet, tl, input, onClose, tunes = [], onTune, others = NO_TUNES, focus = "all", initialCardId }: SongCoachProps) {
  const [windowP, setWindowP] = useState<number | null>(() => loadStore(sheet.id).settings.window);
  const [mix, setMix] = useState(() => loadStore(sheet.id).settings.mix !== false); // the other tunes' exercises too
  // reading exercises bring new notes whenever this changes: every day, and after every session
  const [round, setRound] = useState(() => `${today()}:${loadStore(sheet.id).sessions.length}`);
  const rawOwn = useMemo(() => buildDeck(sheet, tl, { window: windowP ?? undefined, round, seen: seenIn(sheet.id), rhythmFrom: rhythmSourceId(initialCardId) }), [sheet, tl, windowP, round, initialCardId]);
  const goals = useGoals();
  const activeGoal = useMemo(() => loadActiveGoal(sheet, rawOwn), [sheet, rawOwn, goals]);
  const own = useMemo(() => goalDeck(rawOwn, activeGoal), [rawOwn, activeGoal]);
  const arrangementFingerprint = useMemo(() => arrangementIdentity(sheet).fingerprint, [sheet]);
  const focused = useMemo(() => (focus === "all" ? own : familiesOnly(own, FOCUS_FAMILIES[focus])), [focus, own]);
  const guests = useMemo(
    () =>
      focus !== "all"
        ? []
        : mix
          ? others.map((o) => ({ tuneId: o.sheet.id, sheet: o.sheet, deck: buildDeck(o.sheet, o.tl, { window: loadStore(o.sheet.id).settings.window ?? undefined, round, seen: seenIn(o.sheet.id) }) }))
          : [],
    [focus, mix, others, round],
  );
  const deck = useMemo(() => mixDecks(focused, guests), [focused, guests]);
  const tuneIds = useMemo(() => [sheet.id, ...guests.map((g) => g.tuneId)], [sheet.id, guests]);
  const sheets = useMemo(() => new Map<string, LeadSheet>([[sheet.id, sheet], ...guests.map((g) => [g.tuneId, g.sheet] as [string, LeadSheet])]), [sheet, guests]);
  const arrangementFingerprints = useMemo(() => new Map([...sheets].map(([id, score]) => [id, arrangementIdentity(score).fingerprint])), [sheets]);
  const [gapIds, setGapIds] = useState<ReadonlySet<string>>(() => new Set()); // a focus on time: these play with gaps in the band
  const session = useSession(deck, tuneIds, input, { gap: gapIds, arrangementFingerprint, arrangementFingerprints, tempoBounds: activeGoal?.tempo });
  const outputs = useOutputs();
  const [labels, setLabels] = useState<LabelMode>("names");
  const [menu, setMenu] = useState(false);
  const [free, setFree] = useState(false); // free play: nothing asked, a click that follows the player
  const [full, setFull] = useState(() => Boolean(document.fullscreenElement));
  const [pad, setPad] = useState<number | null>(null); // the guitar's own menu: which page is up
  const [calib, setCalib] = useState(() => !loadProfile() && input.status !== "idle" && input.status !== "error");
  const checkedSetups = useRef(new Set<string>());
  const skippedPendingSetup = useRef(false);
  const idle = useIdle(!menu);
  const pausedByMenu = useRef(false);

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
  const inputSetup = currentInputSetup();
  const setupKey = inputSetup ? `${inputSetup.deviceId}:${inputSetup.sampleRate}` : null;
  useEffect(() => {
    if (running || input.status !== "listening" || input.paused || !setupKey || checkedSetups.current.has(setupKey)) return;
    checkedSetups.current.add(setupKey);
    if (skippedPendingSetup.current) {
      skippedPendingSetup.current = false;
      return;
    }
    if (!loadProfile()) setCalib(true);
  }, [running, input.status, input.paused, setupKey]);
  // the player across every box, and the session planned from it: warm-up, focus, review, music
  const length = store.settings.length ?? "normal";
  const [chosenCard, setChosenCard] = useState(initialCardId);
  const shaped = useMemo<SessionPlan>(() => {
    const chosen = deck.cards.find((card) => card.id === chosenCard);
    if (chosen) {
      const ids = [chosen.id, ...(chosen.followedBy ? [chosen.followedBy] : [])];
      const minutes = Math.max(1, Math.ceil(ids.length * cardSeconds(store)[chosen.family] / 60));
      return { ids, blocks: [{ role: "focus", cards: ids, minutes }], minutes, why: chosen.followedBy ? "Rhythm, then the phrase" : "Selected exercise", arc: null };
    }
    const day = today();
    const profile = buildProfile(allAttempts(allStores()), day, latencyMeasured());
    return planBlocks(deck, store, day, { minutes: LENGTH_MINUTES[length], tuneId: sheet.id, profile, arc: loadArc(), goal: activeGoal });
  }, [chosenCard, deck, store, length, sheet.id, activeGoal]);
  const plan = shaped.ids;
  const cycleLength = () => {
    if (!live) session.updateSettings({ length: LENGTHS[(LENGTHS.indexOf(length) + 1) % LENGTHS.length] });
  };

  const close = () => {
    session.exit();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onClose();
  };
  const beginNow = (self = false) => {
    if (calib || menu || free || !plan.length) return;
    saveArc(shaped.arc);
    const onTime = shaped.arc && ["rushing", "dragging", "unsteady"].includes(shaped.arc.cls);
    setGapIds(new Set(onTime ? shaped.blocks.find((b) => b.role === "focus")?.cards ?? [] : []));
    if (self) session.begin(plan, true);
    else session.begin(plan);
    setChosenCard(undefined);
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  // the session holds still while the settings are open
  const openMenu = () => {
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

  // the pad: called from the guitar by holding the open low E, worked with the six strings
  const openPad = () => {
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
  // between sessions only: the exercise in front of the player may be one of the other tunes'
  const toggleMix = () => {
    if (live || !others.length) return;
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
  /** From free play straight into the exercise that matches what was being played. */
  const practise = (id: string) => {
    setFree(false);
    pausedByMenu.current = false;
    if (running && !finished) session.finish();
    session.begin([id]);
  };

  // not while the low E is part of what is being played
  const lowE = useRef(false);
  const cardNow = session.card;
  lowE.current =
    !cardNow || session.active < 0
      ? false
      : [session.active, session.active - 1].some((i) => {
          const t = cardNow.tl.targets[i];
          return t !== undefined && (t.chord ? t.chord.voicing.includes(40) : t.midi === 40);
        });
  const summonRing = useSummon(input, inExercise && pad === null && !menu && !calib, lowE, openPad);

  // note keys: one note each, held for a moment, and the session does that
  const noteKeys = session.keys;
  // improvising, every note is music: only the low-E menu works (as in free play)
  const held = useNoteKeys(input, inExercise && pad === null && !menu && !calib && !session.paused && session.card?.kind !== "improv", [noteKeys.hear, noteKeys.pace, noteKeys.time, noteKeys.next], (key) => {
    if (key === 0) session.hear();
    else if (key === 1) session.go("pace");
    else if (key === 2) session.go("time");
    else session.next();
  });

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
  // between exercises single notes are the keys, so double taps only work the open drawer there
  const tapped = useToneKeys(input, !calib && !free && (inExercise || menu), [...toneKeys, ...switchTones], (key) => {
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
  const padPages: { title: string; rows: PadRow[]; fire: (() => void)[] }[] = [
    {
      title: `${session.card?.title ?? ""} · ♩ ${session.bpm}`,
      rows: [{ label: "Return to playing" }, { label: "Restart exercise" }, { label: "Hear again" }, { label: "Slower", value: "−4 bpm" }, { label: "Faster", value: "+4 bpm" }, { label: "Session controls" }],
      fire: [() => closePad(), () => (session.again(), closePad()), () => (closePad(false), session.hear()), () => session.tempo(-4), () => session.tempo(4), () => setPad(1)],
    },
    {
      title: "Session",
      rows: [
        { label: "Exercise controls" },
        { label: session.selfGuided ? "Done practising" : "Next exercise" },
        { label: "Click", value: session.click ? "on" : "off" },
        { label: "Support melody", value: session.settings.guide ? "always" : "when needed" },
        { label: session.spot ? "Return to the piece" : "Practise this bar" },
        { label: "Sound & setup" },
      ],
      fire: [
        () => setPad(0),
        () => (closePad(false), session.next()),
        () => session.setClick((c) => !c),
        () => session.updateSettings({ guide: !session.settings.guide }),
        () => (closePad(false), barAlone()),
        () => setPad(2),
      ],
    },
    {
      title: "Sound & setup",
      rows: [
        { label: "Session controls" },
        { label: "Sound output", value: outputs.supported ? outputs.label : "system output" },
        { label: "Free play" },
        { label: "Shuffle", value: session.settings.shuffle ? "on" : "off" },
        { label: "Calibrate guitar" },
        { label: session.ending ? "Finishing after this pass" : "Finish after this pass" },
      ],
      fire: [
        () => setPad(1),
        outputs.cycle,
        openFree,
        () => session.updateSettings({ shuffle: !session.settings.shuffle }),
        () => (setPad(null), setCalib(true)), // stays paused until the guitar has been heard
        () => (closePad(), session.finishAfterPass()),
      ],
    },
  ];

  // keys: all optional. Space pauses, arrows (or a page-turner pedal) skip and go again, −/+ tempo, S settings
  const act = { session, menu, pad, calib, free, endCalib, close, beginNow, openMenu, closeMenu, openPad, closePad, openFree, closeFree, inExercise, barAlone };
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actRef.current;
      const s = a.session;
      const el = e.target as HTMLElement;
      const k = e.key;
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
        if (k === " " || k === "Enter") a.beginNow();
        else return;
      } else if (s.finished) {
        if (k === " " || k === "Enter") s.keepGoing();
        else return;
      } else if (k === " ") s.togglePause();
      else if (k === "ArrowRight" || k === "PageDown") s.skip();
      else if (k === "ArrowLeft" || k === "PageUp") s.again();
      else if (k === "h") s.hear();
      else if (k === "b") a.barAlone();
      else if (k === "n") s.next();
      else if (k === "-" || k === "_") s.tempo(-4);
      else if (k === "+" || k === "=") s.tempo(4);
      else if (k === "c") s.setClick((c) => !c);
      else if (k === "g") s.updateSettings({ guide: !s.settings.guide });
      else if (k === "l") setLabels((l) => (l === "names" ? "degrees" : "names"));
      else return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fam = session.card?.family;
  const between = !menu && !calib; // the screens between exercises listen for their own keys
  return (
    <div
      className={`ss ${idle ? "is-idle" : ""} ${fam ? `fam-${fam}` : ""} ${pad !== null && inExercise ? "has-pad" : ""}`}
      style={{ "--flow": inExercise ? session.flow : 0.5 } as CSSProperties}
      role="dialog"
      aria-label="practice session"
    >
      {!free ? <PracticeAtmosphere input={input} warmth={Math.min(1, session.elapsed() / 180000)} flow={inExercise ? session.flow : 0} playing={inExercise && (session.phase === "pace" || session.phase === "time") && !session.paused && !session.away && !session.listeningOff && pad === null && !menu && !calib} /> : null}
      {free ? (
        <FreePlay input={input} deck={deck} onClose={closeFree} onPractise={practise} />
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
          onBegin={() => beginNow()}
          onSelfBegin={() => beginNow(true)}
          onFree={openFree}
          onSettings={openMenu}
          keysOn={between}
          guests={others.map((o) => o.sheet.title)}
          mix={mix}
          focus={focus}
          onMix={toggleMix}
        />
      ) : finished ? (
        <SessionSummary
          deck={deck}
          session={session}
          input={input}
          title={sheet.title}
          tuneId={sheet.id}
          tunes={tunes}
          onTune={onTune}
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
          earTag={<ToneTag pc={toneKeys[1]} lit={tapped === 1} />}
          held={held}
          onGuitarMenu={openPad}
        />
      )}
      <div className="ss-chrome">
        <button type="button" className="ss-icon" onClick={openMenu} aria-label="settings" title="Settings (S)">
          <Gear />
          <ToneTag pc={inExercise || menu ? toneKeys[0] : null} lit={tapped === 0} />
        </button>
        <button type="button" className="ss-icon" onClick={close} aria-label="leave" title="Leave (Esc)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" />
          </svg>
        </button>
      </div>
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
          mix={others.length ? mix : null}
          onMix={toggleMix}
        />
      ) : null}
    </div>
  );
}

// ---------- before: the tune, and a circle that listens ----------

function Ready({
  deck,
  session,
  sheet,
  input,
  plan,
  shaped,
  length,
  onLength,
  onBegin,
  onSelfBegin,
  onFree,
  onSettings,
  keysOn,
  guests,
  mix,
  onMix,
  focus,
}: {
  deck: Deck;
  session: SessionApi;
  sheet: LeadSheet;
  input: InputApi;
  plan: string[];
  shaped: SessionPlan;
  length: string;
  onLength(): void;
  onBegin(): void;
  onSelfBegin(): void;
  onFree(): void;
  onSettings(): void;
  keysOn: boolean;
  guests: string[]; // the library's other tunes
  mix: boolean;
  onMix(): void;
  focus: Focus;
}) {
  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  // any held note begins, except the ones that mean something else here
  const ring = useHold(input, plan.length > 0 && keysOn, onBegin, READY_KEYS.map((m) => mod(m)));
  const held = useNoteKeys(input, keysOn, [READY_KEYS[0], READY_KEYS[1], guests.length ? READY_KEYS[2] : null, READY_KEYS[3], READY_KEYS[4]], (k) => (k === 0 ? onFree() : k === 1 ? onSettings() : k === 2 ? onMix() : k === 3 ? onLength() : onSelfBegin()), true);
  const from = new Set(plan.map((id) => byId.get(id)?.tune).filter(Boolean));
  const listening = input.status === "listening" && !input.paused;
  const first = byId.get(plan[0]);
  const days = streak(session.store);
  const say = !plan.length
    ? deck.cards.length ? "A little more time for this one" : "No exercise in this score yet"
    : listening
      ? "Ready when you are"
      : input.status === "starting"
        ? "Connecting your guitar…"
        : input.paused
          ? "Wake up the sound"
          : "Let’s hear your guitar";
  const inputLabel = listening ? "Guitar listening" : input.status === "starting" ? "Opening input" : input.paused ? "Audio suspended" : "Input off";
  const startLabel = listening ? "Begin session" : input.status === "starting" ? "Opening input…" : input.paused ? "Resume listening" : input.status === "error" ? "Reconnect input" : "Enable listening";
  return (
    <div className="ss-ready ss-ready-flow">
      <div className="ss-ready-story">
        <p className="ss-kicker">{focus !== "all" ? FOCUS_LABEL[focus] : days > 1 ? `Day ${days} · Your practice` : "Your practice"}</p>
        <h1 className="ss-display">{sheet.title}</h1>
        <p className="ss-sub">
          {plan.length} exercise{plan.length === 1 ? "" : "s"} · about {shaped.minutes} minutes
          {from.size > 1 ? ` · ${from.size} tunes` : ""}
        </p>
        {shaped.why ? <p className="ss-focus">Focus · {shaped.why}</p> : null}
        {first ? (
          <div className="ss-ready-preview">
            <p className="ss-section-label">The opening exercises</p>
            <ol className="ss-ready-queue">
              {plan.slice(0, 3).map((id, i) => {
                const card = byId.get(id);
                if (!card) return null;
                return (
                  <li key={id} className={`fam-${card.family}`}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div><strong>{card.title}</strong><small>{FAMILY_LABEL[card.family]}{from.size > 1 ? ` · ${card.tune}` : ""}</small></div>
                  </li>
                );
              })}
            </ol>
            {plan.length > 3 ? <p className="ss-ready-more">+ {plan.length - 3} more · full plan in settings</p> : null}
          </div>
        ) : null}
      </div>

      <div className="ss-ready-arrival">
        <span className={`ss-connection ${listening ? "is-live" : ""}`}><i />{inputLabel}</span>
        <Ear input={input} size="big" ring={ring} />
        <p className="ss-say" aria-live="polite">{say}</p>
        <p className="ss-ready-instruction">
          {!plan.length
            ? deck.cards.length ? "Hold F below to choose more time, or open free play." : "Free play is always available."
            : listening ? "Hold a note for 0.7 seconds. The circle fills as you hold." : input.paused ? "A click resumes the audio, then the guitar takes over." : "Connect an interface or allow the microphone to begin."}
        </p>
        {input.error ? <p className="ss-input-detail" role="status">{input.error}</p> : null}
        <button
          type="button"
          className="ss-begin"
          disabled={!keysOn || input.status === "starting" || (listening && !plan.length)}
          onClick={listening ? onBegin : () => void input.start()}
        >
          {startLabel}<span aria-hidden="true">↗</span>
        </button>
        <button type="button" onClick={onSelfBegin} disabled={!keysOn || !plan.length}>
          <NoteTag midi={READY_KEYS[4]} held={held === 4} octave={false} /> Practise without scoring
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
          {guests.length ? (
            <li>
              <button type="button" onClick={onMix} title={guests.join(" · ")} disabled={!keysOn}>
                <NoteTag midi={READY_KEYS[2]} held={held === 2} octave={false} />
                <span>{mix ? `Mix · ${guests.length + 1} tunes` : "Mix · this tune"}</span>
              </button>
            </li>
          ) : null}
        </ul>
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
function coachLine(card: Card, s: SessionApi, last: number | undefined): { text: string; tone?: "good" } {
  if (s.paused) return { text: "" };
  if (s.ending) return { text: "Finishing after this pass" };
  if (s.selfGuided) return { text: "Self-guided · no mic score" };
  if (s.phase === "pace") {
    if (card.view === "chords" || !s.follow.done || !s.lastTake) return { text: "" };
    return { text: `${s.lastTake.hit} of ${s.lastTake.total}`, tone: s.lastTake.clean ? "good" : undefined };
  }
  if (s.phase === "time") {
    if (s.waiting) return { text: "The band comes back in on a note." };
    if (s.playback.counting || last === undefined) return { text: "" };
    return { text: `${Math.round(last * 100)}%`, tone: last >= card.pass ? "good" : undefined };
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
  onGuitarMenu,
}: {
  deck: Deck;
  session: SessionApi;
  sheet: LeadSheet;
  input: InputApi;
  labels: LabelMode;
  ring: RefObject<SVGCircleElement>;
  earTag: ReactNode;
  held: number | null; // the note key being held
  onGuitarMenu(): void;
}) {
  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  const card = s.card;
  if (!card) return null;
  const say = coachLine(card, s, s.passes[s.passes.length - 1]);

  // the three ways to work on it: each one a note away
  // improvising, every note is music: the keys are off, so none are shown
  const free = card.kind === "improv";
  const trail = [
    { id: "listen", label: "Hear again", key: s.keys.hear, fire: s.hear },
    { id: "pace", label: card.view === "chords" ? "Your shapes" : "Your pace", key: s.keys.pace, fire: () => s.go("pace") },
    { id: "time", label: "In time", key: s.keys.time, fire: () => s.go("time") },
  ];
  const order = ["intro", "listen", "pace", "time", "result"];
  const stateOf = (id: string) => (s.phase === id ? "is-now" : order.indexOf(s.phase) > order.indexOf(id) ? "is-done" : "");
  const counting = s.phase === "time" && !s.paused ? s.playback.counting : 0;
  const pips = s.phase === "pace" && card.view !== "chords" && s.needClean > 1;
  const own = s.phase === "pace" && s.pulse !== null;
  const mixed = new Set(s.queue.map((id) => byId.get(id)?.tuneId)).size > 1;
  const listening = input.status === "listening" && !input.paused;
  const phaseName = {
    intro: "Getting ready",
    listen: "Listening",
    pace: card.view === "chords" ? "Your shapes" : "Your pace",
    time: free ? "Improvising" : "In time",
    result: "Pass complete",
  }[s.phase];
  const phase = s.paused ? s.away ? "Resting" : s.listeningOff ? "Input paused" : "Paused" : counting ? "Count-in" : phaseName;

  return (
    <div className={`ss-run phase-${s.phase} ${s.paused ? "is-paused" : ""}`}>
      <ol className="ss-progress" aria-label={`exercise ${s.pos + 1} of ${s.queue.length}`}>
        {s.queue.map((id, i) => {
          const o = s.log.find((x) => x.at === i);
          return <li key={i} className={`fam-${byId.get(id)?.family ?? "melody"} ${i === s.pos ? "is-now" : ""} ${o ? `is-${o.result}` : ""}`} />;
        })}
      </ol>

      <header className="ss-head" key={`${s.pos}:${card.id}`}>
        <div className="ss-phasebar">
          <span className="ss-exercise-count">{String(s.pos + 1).padStart(2, "0")} <em>/ {String(s.queue.length).padStart(2, "0")}</em></span>
          <span className="ss-phase-name" aria-live="polite"><i />{phase}</span>
          <span className={`ss-connection ${listening ? "is-live" : ""}`}><i />{s.selfGuided ? "Self-guided · unscored" : listening ? "Input live" : "Input off"}</span>
        </div>
        <p className="ss-kicker">
          <span className="ss-fam">{FAMILY_LABEL[card.family]}</span>
          {mixed ? ` · ${card.tune}` : ""}
          {s.box === 0 ? " · new" : ""}
        </p>
        <h1 className="ss-title">{card.title}</h1>
        {s.spot ? (
          <p className="ss-why ss-spotline" key="spot">
            <b>{barsOf(card, sheet)}</b>
            {s.spot.asked ? " · by " : " came out short twice · here by "}
            {card.to > card.from ? "themselves" : "itself"}
          </p>
        ) : (
          <p className="ss-why">
            {card.detail} {s.box === 0 ? card.why : ""}
          </p>
        )}
      </header>

      <div className="ss-stage">
        <div className="ss-material">
          {card.view === "score" ? (
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
        {counting ? (
          <span className="ss-countin" key={counting} aria-live="off">
            {counting}
          </span>
        ) : null}
        {s.paused ? (
          <span className="ss-veil ss-pause-state">
            <strong>{s.away ? "A moment of quiet" : s.listeningOff ? "Let’s hear you again" : "Paused"}</strong>
            <small>{s.listeningOff ? input.error ?? "The session carries on when the guitar is connected." : s.away ? "A note brings the session back." : "Space to carry on · low E for the guitar menu"}</small>
            {s.listeningOff ? <button type="button" onClick={() => void input.start()} disabled={input.status === "starting"}>{input.status === "starting" ? "Opening input…" : input.paused ? "Resume listening" : "Reconnect input"}</button> : null}
            {s.listeningOff ? <button type="button" onClick={s.continueWithoutScoring}>Continue without scoring</button> : null}
          </span>
        ) : null}
        {s.phase === "result" && s.outcome ? <ResultMark o={s.outcome} titleOf={(id) => byId.get(id)?.title ?? ""} secret={s.outcome.secret} /> : null}
      </div>

      <div className="ss-coach">
        <p className={`ss-say ${say.tone ? `is-${say.tone}` : ""}`} aria-live="polite" key={say.text}>
          {say.text || " "}
        </p>
        <span className={`ss-takes ${pips ? "" : "is-hidden"}`} aria-hidden="true">
          {Array.from({ length: Math.max(1, s.needClean) }, (_, i) => (
            <i key={i} className={i < s.takes.clean ? "is-on" : ""} />
          ))}
        </span>
        <span className="ss-flow" aria-hidden="true" title="how it is going" />
        <span className="ss-meter" aria-hidden="true">
          <span className={`ss-streak ${s.run >= 4 ? "" : "is-hidden"} ${s.run >= 16 ? "is-hot" : s.run >= 8 ? "is-warm" : ""}`} title="notes landed in a row">
            <b key={s.run}>{s.run}</b> in a row
          </span>
          {s.phase === "time" && s.passes.length ? (
            <span className="ss-passes" title="each time through: how much of it landed; the line is what it takes">
              {s.passes.slice(-8).map((share, i) => (
                <i key={i} className={share >= card.pass ? "is-in" : ""} style={{ height: `${Math.max(8, share * 100)}%` }} />
              ))}
              <em style={{ bottom: `${card.pass * 100}%` }} />
            </span>
          ) : null}
          {s.phase === "time" && s.playback.lastPass ? <TimingStrip at={s.playback.lastPass.at} first={card.first} last={card.last} beatMs={60000 / s.bpm} /> : null}
        </span>
      </div>

      <footer className="ss-foot">
        <span className="ss-call">
          <Ear input={input} size="small" ring={ring} tag={earTag} />
          <span className="ss-menu-access">
            <button type="button" onClick={onGuitarMenu}>Guitar menu</button>
            <small>hold open low E · 1.3 s</small>
          </span>
        </span>
        <div className="ss-played-controls">
          <span className="ss-section-label">{free ? "Every note is music · low E opens the menu" : "Hold a shown note · exact octave"}</span>
          {!free ? (
            <ol className="ss-trail">
              {trail.map((r, i) => (
                <li key={r.id} className={stateOf(r.id)}>
                  <button type="button" onClick={r.fire} disabled={s.paused || s.phase === "result"} aria-label={`${r.label}${r.key !== null ? ` · hold ${keyName(r.key)}` : ""}`} aria-current={s.phase === r.id ? "step" : undefined}>
                    <NoteTag midi={r.key} held={held === i} />
                    <span>{r.label}</span>
                  </button>
                </li>
              ))}
              <li className="ss-trail-next">
                <button type="button" onClick={s.next} disabled={s.paused} aria-label={`${s.selfGuided ? "Done practising" : "Next exercise"}${s.keys.next !== null ? ` · hold ${keyName(s.keys.next)}` : ""}`}>
                  <NoteTag midi={s.keys.next} held={held === 3} />
                  <span>{s.selfGuided ? "Done practising" : "Next exercise"}</span>
                </button>
              </li>
            </ol>
          ) : null}
        </div>
        <div className="ss-side">
          <span className="ss-aid" style={{ opacity: s.phase === "time" ? Math.min(1, (s.shadow?.level() ?? 0) * 1.8) : 0 }} title="playing along with you, as much as you need">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0" />
            </svg>
          </span>
          {s.phase === "time" ? <BeatMeter drift={s.playback.drift} beatMs={60000 / s.bpm} /> : null}
          <span className={`ss-tempo-cluster ${own ? "is-own" : ""}`} title={own ? "your own tempo" : s.target > s.bpm ? `the click, on its way to ${s.target}` : "tempo"}>
            <BeatPulse beat={s.beat} bpm={own ? s.pulse ?? s.bpm : s.bpm} compact />
            {s.phase === "time" && s.target > s.bpm ? <em>→ {s.target}</em> : null}
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

function ResultMark({ o, titleOf, secret }: { o: Outcome; titleOf(id: string): string; secret?: string }) {
  const self = o.conditions?.source === "self";
  const text = self ? "Practice noted · unscored" : o.result === "clean" ? `Box ${o.to}` : o.result === "ok" ? `Stays in box ${o.to}` : o.result === "fail" ? "Back to box 1" : "";
  const also = o.also.map((a) => titleOf(a.id)).filter(Boolean);
  return (
    <div className={`ss-result is-${o.result}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" pathLength={1} />
        {o.result === "clean" || o.result === "ok" ? <path d="M31 52 L45 66 L70 37" pathLength={1} /> : o.result === "fail" ? <path d="M33 50 H67" pathLength={1} /> : <path d="M40 34 L60 50 L40 66" pathLength={1} />}
      </svg>
      {secret ? <p className="ss-result-secret">{secret}</p> : null}
      {text ? <p>{text}</p> : null}
      {o.result !== "skip" && !self ? <BoxPips box={o.to} gained={o.to > o.from ? o.to : 0} /> : null}
      {o.result !== "skip" ? (
        <p className="ss-result-facts">
          {!self ? <>{o.conditions?.tempo === "own-pace" ? "reference " : ""}♩ {o.bpm}</> : "Unscored"}
          {o.share !== null ? ` · ${Math.round(o.share * 100)}%` : ""}
        </p>
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
}

interface Ghost {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  acc: string;
  name: string;
  wantName: string;
  wx: number; // the written note: where its name goes
  wy: number;
}

/**
 * The shadow score: a hollow head beside each missed note, at the height that was played, with
 * its name; the written note gets its name too. Seen side by side, the two names stick to the
 * two places. Lives inside the score's scrolling host.
 */
function ScoreShadows({ host, wrong, keySignature }: { host: RefObject<HTMLDivElement>; wrong: WrongNote[]; keySignature: string }) {
  const key = wrong.map((w) => `${w.n}:${w.midi}`).join(",");
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  useEffect(() => {
    const el = host.current;
    if (!el || !wrong.length) {
      setGhosts([]);
      return;
    }
    const h = el.getBoundingClientRect();
    setGhosts(
      wrong.flatMap((w) => {
        const head = el.querySelector(`[data-note="${w.n}"] .vf-notehead`)?.getBoundingClientRect();
        if (!head) return [];
        const { steps, acc } = staffShadow(w.midi, w.want, w.vexKey, keySignature);
        const left = head.left - h.left + el.scrollLeft;
        const top = head.top - h.top + el.scrollTop;
        // a notehead is one staff space tall: half of it is one step
        return [{ key: `${w.n}:${w.midi}`, x: left + head.width * 1.9, y: top - (steps * head.height) / 2, w: head.width, h: head.height, acc, name: w.name, wantName: w.wantName, wx: left + head.width / 2, wy: top + head.height }];
      }),
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {ghosts.map((g) => (
        <Fragment key={g.key}>
          <span className="ss-ghost-note" style={{ left: g.x, top: g.y, width: g.w, height: g.h }} aria-hidden="true">
            {g.acc ? <i>{g.acc}</i> : null}
            <b>{g.name}</b>
          </span>
          <span className="ss-want-name" style={{ left: g.wx, top: g.wy }} aria-hidden="true">
            {g.wantName}
          </span>
        </Fragment>
      ))}
    </>
  );
}

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
  const neck = card.spot || card.family === "scales" || (!card.fresh && s.box < 2) ? "all" : called || astray ? (card.fresh ? "note" : "all") : "away";
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
  const written = useMemo(() => lineSheet(card, sheet.keySignature), [card, sheet.keySignature]);
  const heads = useMemo(() => written.bars.flatMap((b) => b.notes.filter((n) => !n.rest)), [written]);
  const results = useMemo(() => s.results.slice(card.first, card.last + 1), [s.results, card]);
  // under the notes: nothing while reading, the names in a part taken out, degrees when asked for
  const degrees = useMemo(
    () =>
      card.spot
        ? heads.map((_, k) => spelled(card, card.first + k))
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
        out.push({ n: k, midi, want: card.tl.targets[i].midi, vexKey: heads[k].vexKey, name: playedName(card.context[i], midi), wantName: spelled(card, i) });
    }
    return out;
  }, [s.shadows, s.results, card, heads]);
  const host = useRef<HTMLDivElement>(null);
  const playingBar = s.playback.playing ? (card.tl.slots[s.playback.activeSlot] ? s.playback.activeSlot - card.from : -1) : -1;

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
  return (
    <div className="ss-line">
      {card.family === "scales" ? null : <Harm ctx={ctx} scale />}
      <div className="ss-score ss-score--line" data-scroll-host ref={host}>
        <Score
          exercise={written}
          activeStep={s.active >= 0 ? s.active - card.first : -1}
          results={results}
          showFingering={false}
          autoScroll
          playingBar={playingBar}
          hideBars={card.memory ? written.bars.map((_, i) => i) : null}
          noteLabels={degrees}
          cursor
          cursorPulse={s.nudge}
        />
        <ScoreShadows host={host} wrong={wrong} keySignature={sheet.keySignature} />
      </div>
      <div className={`ss-board ss-board--aside ${neck === "away" ? "is-away" : ""} ${card.spot ? "is-spot" : ""}`}>
        <Fretboard
          notes={notes}
          fretCount={FRET_COUNT}
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
  const activeNotes = (s.active >= 0 ? card.tl.targets[s.active]?.notes ?? [] : []).map((n) => n - cut.offset);
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
      out.push({ n: n - cut.offset, midi, want: t.midi, vexKey: heads[n].vexKey, name: playedName(card.context[i], midi), wantName: spelled(card, i) });
    });
    return out;
  }, [s.shadows, printed, card, heads, cut.offset]);
  return (
    <div className="ss-melody">
      <Harm ctx={ctx} />
      <div className="ss-score" data-scroll-host ref={host}>
        <Score
          exercise={cut.exercise}
          activeStep={activeNotes[0] ?? -1}
          activeNotes={activeNotes}
          results={results}
          showFingering={false}
          autoScroll
          playingBar={playingBar}
          focusBars={gaps ? local : null}
          hideBars={card.memory ? local : null}
          noteLabels={labels}
          cursor
          cursorPulse={s.nudge}
        />
        <ScoreShadows host={host} wrong={wrong} keySignature={cut.exercise.keySignature} />
      </div>
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
      <Fretboard notes={[]} fretCount={12} position={position} labels={labels} pattern={pattern} activeStep={prompt?.show ? pattern.length - 1 : -1} />
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
  return (
    <div className="ss-improv">
      <Harm ctx={ctx} scale />
      <Fretboard notes={notes} fretCount={Math.max(12, p + 5)} position={position} labels={labels} />
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
              <button type="button" onClick={() => (s.again(), onClose())}>
                Start it again
              </button>
              <button type="button" onClick={() => (s.skip(), onClose())}>
                {s.phase === "time" || s.phase === "result" ? "Skip it" : "Next step"}
              </button>
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
          <Switch on={settings.guide} onChange={(v) => updateSettings({ guide: v })} tone={tones[1]} lit={tapped === 3}>
            Always play the melody under me
          </Switch>
          <Switch on={settings.voice} onChange={(v) => updateSettings({ voice: v })} tone={tones[2]} lit={tapped === 4}>
            Say each exercise's name
          </Switch>
          <Switch on={full} onChange={onFull}>
            Full screen
          </Switch>
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
          <p className="ss-note">Clean: up a box. Struggled: stays. Missed: back to 1. Box 1 comes every session, then after 1, 3, 7 and 21 days.</p>
        </section>

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
            <kbd>Space</kbd> pause <kbd>→</kbd> skip <kbd>←</kbd> again <kbd>H</kbd> hear it <kbd>B</kbd> this bar alone <kbd>N</kbd> next <kbd>−</kbd> <kbd>+</kbd> tempo <kbd>C</kbd> click <kbd>G</kbd> melody <kbd>L</kbd> labels <kbd>F</kbd> free play <kbd>S</kbd> settings <kbd>Esc</kbd> leave
          </p>
        </section>
      </aside>
    </>
  );
}

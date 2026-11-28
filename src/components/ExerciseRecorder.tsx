import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inputLag } from "../audio/latency";
import type { FretNote, NoteResult, Position } from "../core/contract";
import { OPEN_MIDI } from "../core/scales";
import { createAttacks } from "../listen/attacks";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { mod } from "../musicTheory";
import {
  alternatePositions,
  customExerciseToCard,
  customExerciseToSheet,
  customNoteLabel,
  DURATION_CHOICES,
  formatCustomPitch,
  guessExerciseHub,
  HUB_OPTIONS,
  MAX_CUSTOM_NOTES,
  newCustomExerciseId,
  quantizeRecordedOnsets,
  resolveExerciseSteps,
  scaleForHub,
  SHAPE_TAGS,
  suggestExerciseTitle,
  transposeCustomExercise,
  type CustomExercise,
  type CustomFamily,
  type CustomMeter,
  type CustomNote,
} from "../song/customExercises";
import { fitWindow, windowAt } from "../song/fingering";
import { createOnsets } from "../song/freeplay";
import { spellIn } from "../song/harmony";
import { parseHubId } from "../song/keyStudy";
import { today } from "../song/leitner";
import type { Timeline } from "../tunes/order";
import { usePlayback, type PlaybackMix } from "../tunes/usePlayback";
import { Fretboard } from "./Fretboard";
import { Glyph } from "./Glyph";
import { Score } from "./Score";

type CaptureMode = "grid" | "timed";

const EMPTY_RESULTS: NoteResult[] = [];
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];
const GRID_OPTIONS: { label: string; beats: number }[] = [
  { label: "16ths", beats: 0.25 },
  { label: "Triplets", beats: 1 / 3 },
  { label: "8ths", beats: 0.5 },
  { label: "Quarters", beats: 1 },
];

const EMPTY_TL: Timeline = {
  slots: [{ bar: 0, pass: 1, start: 0, beats: 4, run: 0 }],
  targets: [],
  comp: [],
  total: 4,
};

function makeClickTimeline(beatsPerBar: CustomMeter): Timeline {
  const barBeats = beatsPerBar === 3 ? 3 : beatsPerBar === 6 ? 3 : 4;
  return {
    slots: [{ bar: 0, pass: 1, start: 0, beats: barBeats, run: 0 }],
    targets: [],
    comp: [],
    total: barBeats,
  };
}

function buildFretNotes(hub: string, p: number, steps: readonly { string: number; fret: number; midi: number }[], selectedStep: number): FretNote[] {
  const scale = scaleForHub(hub);
  const w = windowAt(p);
  const bySpot = new Map<string, FretNote>();
  const activeSpot = selectedStep >= 0 ? steps[selectedStep] : undefined;

  // Lightly populate scale tones inside the active fret window so the neck shape reads clearly.
  for (let s = 0; s < 6; s++) {
    for (let f = Math.max(0, w.p - 1); f <= Math.min(18, w.p + 4); f++) {
      const midi = OPEN_MIDI[s] + f;
      const pc = mod(midi);
      const degIdx = scale.pcs.indexOf(pc);
      if (degIdx < 0) continue;
      const inWindow = f >= w.p && f <= w.p + 3;
      bySpot.set(`${s}-${f}`, {
        string: s,
        fret: f,
        midi,
        pc,
        name: spellIn(scale, midi),
        degree: String(degIdx + 1),
        role: pc === scale.root ? "root" : "scale",
        inWindow,
        isNextTarget: false,
      });
    }
  }

  // Highlight every spot used by the exercise itself.
  for (const st of steps) {
    const pc = mod(st.midi);
    const degIdx = scale.pcs.indexOf(pc);
    const isTarget = Boolean(activeSpot && activeSpot.string === st.string && activeSpot.fret === st.fret);
    bySpot.set(`${st.string}-${st.fret}`, {
      string: st.string,
      fret: st.fret,
      midi: st.midi,
      pc,
      name: spellIn(scale, st.midi),
      degree: degIdx >= 0 ? String(degIdx + 1) : "•",
      role: pc === scale.root ? "root" : "chordTone",
      inWindow: true,
      isNextTarget: isTarget,
    });
  }

  return [...bySpot.values()];
}

export interface ExerciseRecorderProps {
  input: InputApi;
  initial?: CustomExercise | null;
  initialInCurriculum?: boolean;
  onSave(exercise: CustomExercise, options: { inCurriculum: boolean; practiceNow: boolean }): void;
  onCancel(): void;
}

export function ExerciseRecorder({
  input,
  initial = null,
  initialInCurriculum = true,
  onSave,
  onCancel,
}: ExerciseRecorderProps) {
  const isEditing = Boolean(initial);
  const [title, setTitle] = useState(() => initial?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(() => Boolean(initial?.title));
  const [family, setFamily] = useState<CustomFamily>(() => initial?.family ?? "scales");
  const [hub, setHub] = useState(() => initial?.hub ?? "M0");
  const [hubTouched, setHubTouched] = useState(() => Boolean(initial));
  const [shape, setShape] = useState(() => initial?.shape ?? "");
  const [p, setP] = useState(() => initial?.p ?? 5);
  const [pTouched, setPTouched] = useState(() => Boolean(initial));
  const [beatsPerBar, setBeatsPerBar] = useState<CustomMeter>(() => initial?.beatsPerBar ?? 4);
  const [bpm, setBpm] = useState(() => initial?.bpm ?? 72);
  const [goalBpm, setGoalBpm] = useState(() => initial?.goalBpm ?? 120);
  const [notes, setNotes] = useState<CustomNote[]>(() => initial?.notes ?? []);
  const [history, setHistory] = useState<CustomNote[][]>([]);
  const [selected, setSelected] = useState<number>(() => (initial?.notes.length ? 0 : -1));
  const [inCurriculum, setInCurriculum] = useState(initialInCurriculum);

  // Capture state
  const [captureMode, setCaptureMode] = useState<CaptureMode>("grid");
  const [grid, setGrid] = useState<number>(0.5);
  const [recording, setRecording] = useState(false);
  const [replacingFromGuitar, setReplacingFromGuitar] = useState(false);
  const [livePitch, setLivePitch] = useState<string | null>(null);
  const [capturedTimedCount, setCapturedTimedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const timedEventsRef = useRef<{ midi: number; ms: number }[]>([]);
  const timedZeroRef = useRef<number | null>(null);
  const wasCountingRef = useRef(false);

  const pushNotes = useCallback((updater: (prev: CustomNote[]) => CustomNote[]) => {
    setNotes((prev) => {
      const next = updater(prev);
      setHistory((h) => [...h.slice(-24), prev]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setNotes(last);
      setSelected((cur) => Math.min(cur, last.length - 1));
      return h.slice(0, -1);
    });
  }, []);

  const draft: CustomExercise = useMemo(() => {
    const day = today();
    return {
      id: initial?.id ?? "custom:scales:draft",
      title: title.trim() || suggestExerciseTitle(hub, shape, family),
      family,
      hub,
      ...(shape ? { shape } : {}),
      p,
      beatsPerBar,
      bpm,
      goalBpm: Math.max(bpm, goalBpm),
      notes,
      createdAt: initial?.createdAt ?? day,
      updatedAt: day,
    };
  }, [initial, title, family, hub, shape, p, beatsPerBar, bpm, goalBpm, notes]);

  const sheetData = useMemo(() => customExerciseToSheet(draft), [draft]);
  const steps = useMemo(() => resolveExerciseSteps(draft), [draft]);
  const previewCard = useMemo(() => customExerciseToCard(draft), [draft]);

  // Listen / loop preview using the existing shared `usePlayback` engine (never a third audio engine).
  const previewTl = previewCard?.tl ?? EMPTY_TL;
  const previewMix: PlaybackMix = useMemo(
    () => ({
      bpm,
      melody: true,
      chords: false,
      click: true,
      countIn: false,
      bass: true,
    }),
    [bpm],
  );
  const preview = usePlayback(previewTl, previewMix, input, false, false);

  // Separate click-only playback for Timed recording mode (count-in + click).
  const clickTl = useMemo(() => makeClickTimeline(beatsPerBar), [beatsPerBar]);
  const clickMix: PlaybackMix = useMemo(
    () => ({
      bpm,
      melody: false,
      chords: false,
      click: true,
      countIn: true,
      bass: false,
    }),
    [bpm],
  );
  const clickPlayer = usePlayback(clickTl, clickMix, input, false, false);

  // Track the exact wall-clock start of beat 0 after count-in finishes in Timed recording mode.
  useEffect(() => {
    if (!recording || captureMode !== "timed") {
      wasCountingRef.current = false;
      return;
    }
    if (clickPlayer.counting > 0) {
      wasCountingRef.current = true;
    } else if (clickPlayer.playing && wasCountingRef.current && timedZeroRef.current === null) {
      timedZeroRef.current = performance.now();
      wasCountingRef.current = false;
    }
  }, [recording, captureMode, clickPlayer.counting, clickPlayer.playing]);

  // Stop audio cleanly on unmount.
  useEffect(() => () => {
    preview.stop();
    clickPlayer.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect key & position window from recorded notes until the user manually picks one.
  useEffect(() => {
    const midis = notes.filter((n) => n.midi !== null).map((n) => n.midi!);
    if (midis.length < 4) return;
    if (!hubTouched) setHub(guessExerciseHub(midis));
    if (!pTouched) {
      const fitted = fitWindow(midis, p, 15);
      setP(fitted.p);
    }
  }, [notes, hubTouched, pTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep auto-suggested title in sync until the player types a custom title.
  useEffect(() => {
    if (!titleTouched) setTitle(suggestExerciseTitle(hub, shape, family));
  }, [hub, shape, family, titleTouched]);

  // Shared-input subscription for Recording (own pace OR timed) AND single-note "Replace from guitar".
  const { subscribe } = input;
  const activeListening = recording || replacingFromGuitar;
  useEffect(() => {
    if (!activeListening) {
      setLivePitch(null);
      return;
    }
    const onsets = createOnsets();
    const attacks = createAttacks();
    return subscribe((frame) => {
      const midi = midiOf(frame);
      if (midi !== null) setLivePitch(formatCustomPitch(midi, hub));
      const hitAttacks = attacks(frame);
      const onset = onsets({ midi, rms: frame.rms, now: frame.now, attacks: hitAttacks });
      if (!onset) return;

      if (replacingFromGuitar) {
        if (selected >= 0) {
          const spots = alternatePositions(onset.midi, p);
          pushNotes((prev) =>
            prev.map((n, i) =>
              i === selected
                ? { ...n, midi: onset.midi, string: spots[0]?.string, fret: spots[0]?.fret }
                : n,
            ),
          );
        }
        setReplacingFromGuitar(false);
        return;
      }

      if (captureMode === "grid") {
        const spots = alternatePositions(onset.midi, p);
        setNotes((prev) => {
          if (prev.length >= MAX_CUSTOM_NOTES) return prev;
          const next = [...prev, { midi: onset.midi, beats: grid, string: spots[0]?.string, fret: spots[0]?.fret }];
          setSelected(next.length - 1);
          return next;
        });
      } else {
        // Timed click recording: wait until count-in completes (or start clock on first note if click started).
        if (clickPlayer.counting > 0) return;
        const zero = timedZeroRef.current ?? onset.at;
        if (timedZeroRef.current === null) timedZeroRef.current = onset.at;
        const relMs = Math.max(0, onset.at - inputLag() - zero);
        timedEventsRef.current.push({ midi: onset.midi, ms: relMs });
        setCapturedTimedCount(timedEventsRef.current.length);
      }
    });
  }, [activeListening, captureMode, grid, hub, p, pushNotes, replacingFromGuitar, selected, subscribe, clickPlayer.counting]);

  const startRecording = async () => {
    setErrorMsg(null);
    preview.stop();
    setReplacingFromGuitar(false);
    if (input.status !== "listening") {
      await input.start();
    }
    if (captureMode === "timed") {
      timedEventsRef.current = [];
      timedZeroRef.current = null;
      setCapturedTimedCount(0);
      setRecording(true);
      await clickPlayer.play(0, 0, true);
    } else {
      setHistory((h) => [...h.slice(-24), notes]);
      setRecording(true);
    }
  };

  const stopRecording = () => {
    setRecording(false);
    clickPlayer.stop();
    if (captureMode === "timed" && timedEventsRef.current.length > 0) {
      const quantized = quantizeRecordedOnsets(timedEventsRef.current, bpm, grid, beatsPerBar, p);
      if (quantized.length > 0) {
        pushNotes((prev) => [...prev, ...quantized].slice(0, MAX_CUSTOM_NOTES));
        setSelected(notes.length);
      }
      timedEventsRef.current = [];
      setCapturedTimedCount(0);
    }
  };

  const togglePreview = () => {
    if (preview.playing) {
      preview.stop();
      return;
    }
    if (recording) stopRecording();
    if (!previewCard) return;
    void preview.play(previewCard.from, previewCard.to, true);
  };

  // ---------- Editing actions for fixing mistakes ----------

  const selNote = selected >= 0 && selected < notes.length ? notes[selected] : null;
  const selScoreIdx = selected >= 0 ? sheetData.noteToScoreIndex[selected] ?? -1 : -1;

  const updateSelected = (fn: (n: CustomNote) => CustomNote) => {
    if (selected < 0 || selected >= notes.length) return;
    pushNotes((prev) => prev.map((n, i) => (i === selected ? fn(n) : n)));
  };

  const shiftSelectedPitch = (delta: number) => {
    if (!selNote || selNote.midi === null) return;
    const nextMidi = Math.max(36, Math.min(96, selNote.midi + delta));
    const spots = alternatePositions(nextMidi, p);
    updateSelected((n) => ({ ...n, midi: nextMidi, string: spots[0]?.string, fret: spots[0]?.fret }));
  };

  const cycleSelectedString = () => {
    if (!selNote || selNote.midi === null) return;
    const spots = alternatePositions(selNote.midi, p);
    if (spots.length < 2) return;
    const idx = spots.findIndex((s) => s.string === selNote.string && s.fret === selNote.fret);
    const next = spots[(idx + 1) % spots.length];
    updateSelected((n) => ({ ...n, string: next.string, fret: next.fret }));
  };

  const toggleSelectedRest = () => {
    if (!selNote) return;
    if (selNote.midi === null) {
      const refMidi = notes.slice(0, selected).reverse().find((n) => n.midi !== null)?.midi ?? (48 + (parseHubId(hub)?.pc ?? 0));
      const spots = alternatePositions(refMidi, p);
      updateSelected((n) => ({ ...n, midi: refMidi, string: spots[0]?.string, fret: spots[0]?.fret }));
    } else {
      updateSelected((n) => ({ midi: null, beats: n.beats }));
    }
  };

  const insertNoteAt = (where: "before" | "after", asRest = false) => {
    const idx = selected < 0 ? notes.length : where === "before" ? selected : selected + 1;
    const refMidi = selNote?.midi ?? notes[notes.length - 1]?.midi ?? (48 + (parseHubId(hub)?.pc ?? 0));
    const spots = alternatePositions(refMidi, p);
    const fresh: CustomNote = asRest
      ? { midi: null, beats: grid }
      : { midi: refMidi, beats: selNote?.beats ?? grid, string: spots[0]?.string, fret: spots[0]?.fret };
    pushNotes((prev) => {
      if (prev.length >= MAX_CUSTOM_NOTES) return prev;
      const copy = [...prev];
      copy.splice(idx, 0, fresh);
      return copy;
    });
    setSelected(idx);
  };

  const deleteSelected = () => {
    if (selected < 0 || selected >= notes.length) return;
    pushNotes((prev) => prev.filter((_, i) => i !== selected));
    setSelected((cur) => Math.max(-1, Math.min(cur, notes.length - 2)));
  };

  const applyGridToAll = () => {
    if (!notes.length) return;
    pushNotes((prev) => prev.map((n) => ({ ...n, beats: grid })));
  };

  const handleFretCellClick = (string: number, fret: number) => {
    const midi = OPEN_MIDI[string] + fret;
    if (selected >= 0 && selected < notes.length) {
      updateSelected((n) => ({ ...n, midi, string, fret }));
    } else {
      pushNotes((prev) => {
        if (prev.length >= MAX_CUSTOM_NOTES) return prev;
        return [...prev, { midi, beats: grid, string, fret }];
      });
      setSelected(notes.length);
    }
  };

  const handleTransposeDraft = (semitones: number) => {
    const shifted = transposeCustomExercise(draft, semitones);
    setHub(shifted.hub);
    setHubTouched(true);
    setP(shifted.p);
    setPTouched(true);
    setTitle(shifted.title);
    pushNotes(() => shifted.notes);
  };

  const handleClearAll = () => {
    if (!notes.length) return;
    pushNotes(() => []);
    setSelected(-1);
  };

  const handleCommit = (practiceNow: boolean) => {
    const pitched = notes.filter((n) => n.midi !== null);
    if (!pitched.length) {
      setErrorMsg("Record or click at least one note before saving.");
      return;
    }
    preview.stop();
    clickPlayer.stop();
    setRecording(false);
    setReplacingFromGuitar(false);
    const day = today();
    const saved: CustomExercise = {
      id: initial?.id ?? newCustomExerciseId(family),
      title: title.trim() || suggestExerciseTitle(hub, shape, family),
      family,
      hub,
      ...(shape ? { shape } : {}),
      p,
      beatsPerBar,
      bpm: Math.max(36, Math.min(220, Math.round(bpm))),
      goalBpm: Math.max(Math.round(bpm), Math.min(240, Math.round(goalBpm))),
      notes,
      createdAt: initial?.createdAt ?? day,
      updatedAt: day,
    };
    onSave(saved, { inCurriculum, practiceNow });
  };

  // Keyboard shortcuts for snappy score editing when not typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "ArrowLeft" && selected > 0) { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
      else if (e.key === "ArrowRight" && selected >= 0 && selected < notes.length - 1) { e.preventDefault(); setSelected((s) => Math.min(notes.length - 1, s + 1)); }
      else if (e.key === "ArrowUp" && selNote?.midi !== null) { e.preventDefault(); shiftSelectedPitch(e.shiftKey ? 12 : 1); }
      else if (e.key === "ArrowDown" && selNote?.midi !== null) { e.preventDefault(); shiftSelectedPitch(e.shiftKey ? -12 : -1); }
      else if ((e.key === "Backspace" || e.key === "Delete") && selected >= 0) { e.preventDefault(); deleteSelected(); }
      else if (e.key === " " && !recording && previewCard) { e.preventDefault(); togglePreview(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // intentional fresh closure for editor shortcuts

  const activeScoreStep = preview.playing ? preview.activeTarget : selScoreIdx;
  const fretNotes = useMemo(() => buildFretNotes(hub, p, steps, activeScoreStep), [hub, p, steps, activeScoreStep]);
  const position: Position = useMemo(() => ({ id: "V", label: `Frets ${p}–${p + 3}`, from: p, to: p + 3 }), [p]);
  const pitchedCount = notes.filter((n) => n.midi !== null).length;

  return (
    <section className="rec-studio" aria-label={isEditing ? "Edit exercise" : "Record exercise"}>
      <header className="rec-head">
        <div>
          <p className="cur-kicker">{isEditing ? "Edit custom exercise" : "Exercise studio"}</p>
          <h2>{isEditing ? draft.title : "Record a loopable exercise"}</h2>
          <p className="rec-byline">
            Play your pattern on guitar (or click the fretboard), fix any misheard note right on the score, and loop it in Practice.
          </p>
        </div>
        <div className="rec-head-actions">
          <button type="button" className="cur-btn" onClick={onCancel}>
            <Glyph name="close" size={15} />Cancel
          </button>
          <button type="button" className="cur-btn" onClick={() => handleCommit(false)} disabled={!pitchedCount}>
            <Glyph name="check" size={15} />Save{inCurriculum ? " to curriculum" : ""}
          </button>
          <button type="button" className="cur-btn is-primary" onClick={() => handleCommit(true)} disabled={!pitchedCount}>
            <Glyph name="play" size={15} />Save &amp; practice
          </button>
        </div>
      </header>

      {errorMsg ? <p className="rec-error" role="alert">{errorMsg}</p> : null}

      {/* 1. Capture & Listen Bar */}
      <div className="rec-capture-bar">
        <div className="rec-capture-main">
          {recording ? (
            <button type="button" className="cur-btn is-recording" onClick={stopRecording}>
              <Glyph name="record" size={16} />
              <span>
                {captureMode === "timed" && clickPlayer.counting > 0
                  ? `Count-in ${clickPlayer.counting}…`
                  : captureMode === "timed"
                    ? `Stop (${capturedTimedCount} heard)`
                    : "Stop recording"}
              </span>
            </button>
          ) : (
            <button type="button" className="cur-btn is-record" onClick={() => void startRecording()}>
              <Glyph name="record" size={16} />
              <span>{notes.length ? "Append by playing" : "Record from guitar"}</span>
            </button>
          )}

          <button type="button" className={`cur-btn ${preview.playing ? "is-active" : ""}`} onClick={togglePreview} disabled={!pitchedCount}>
            <Glyph name={preview.playing ? "close" : "play"} size={15} />
            <span>{preview.playing ? "Stop loop" : "Listen · loop"}</span>
          </button>

          {input.status !== "listening" ? (
            <button type="button" className="cur-btn is-subtle" onClick={() => void input.start()}>
              {input.status === "starting" ? "Connecting mic…" : "Connect guitar mic"}
            </button>
          ) : (
            <span className={`rec-mic-pill ${recording || replacingFromGuitar ? "is-hot" : ""}`}>
              <i aria-hidden="true" />
              {replacingFromGuitar
                ? "Play replacement note…"
                : recording
                  ? livePitch ? `Hearing ${livePitch}` : "Listening…"
                  : "Guitar ready"}
            </span>
          )}
        </div>

        <div className="rec-capture-opts">
          <div className="rec-seg" role="group" aria-label="Capture timing mode">
            <button type="button" className={captureMode === "grid" ? "is-on" : ""} aria-pressed={captureMode === "grid"} onClick={() => setCaptureMode("grid")} title="Every played note snaps cleanly to the chosen grid — ideal for scale patterns like thirds">
              Own pace
            </button>
            <button type="button" className={captureMode === "timed" ? "is-on" : ""} aria-pressed={captureMode === "timed"} onClick={() => setCaptureMode("timed")} title="Records with a count-in and metronome click, capturing rests and mixed rhythms">
              With click
            </button>
          </div>

          <div className="rec-seg" role="group" aria-label="Note grid">
            {GRID_OPTIONS.map((g) => (
              <button
                key={g.label}
                type="button"
                className={Math.abs(grid - g.beats) < 0.02 ? "is-on" : ""}
                aria-pressed={Math.abs(grid - g.beats) < 0.02}
                onClick={() => setGrid(g.beats)}
              >
                {g.label}
              </button>
            ))}
          </div>

          {notes.length > 0 ? (
            <button type="button" className="cur-btn is-subtle" onClick={applyGridToAll} title="Set every note to the chosen grid duration">
              Set all to {GRID_OPTIONS.find((g) => Math.abs(g.beats - grid) < 0.02)?.label ?? "grid"}
            </button>
          ) : null}
        </div>
      </div>

      {/* 2. Score & Mistake-Fixing Workspace */}
      <div className="rec-stage">
        <div className="rec-score-card">
          <div className="rec-card-bar">
            <span className="rec-card-label">Score — click any note to fix it</span>
            <div className="rec-card-mini-actions">
              <button type="button" className="cur-chip" onClick={undo} disabled={!history.length}>Undo</button>
              <button type="button" className="cur-chip" onClick={() => handleTransposeDraft(-1)} disabled={!pitchedCount} title="Transpose down 1 semitone">−1 st</button>
              <button type="button" className="cur-chip" onClick={() => handleTransposeDraft(1)} disabled={!pitchedCount} title="Transpose up 1 semitone">+1 st</button>
              <button type="button" className="cur-chip is-danger" onClick={handleClearAll} disabled={!notes.length}>Clear</button>
            </div>
          </div>

          <div className="rec-score-wrap">
            <Score
              exercise={sheetData.exercise}
              activeStep={activeScoreStep}
              results={EMPTY_RESULTS}
              showFingering={true}
              cursor={activeScoreStep >= 0}
              onNoteClick={(scoreIdx) => {
                const noteIdx = sheetData.scoreToNoteIndex[scoreIdx];
                if (noteIdx !== undefined) {
                  setSelected(noteIdx);
                  setReplacingFromGuitar(false);
                }
              }}
            />
          </div>

          {/* Scrollable note-by-note strip so every note & rest is 1 click away */}
          <div className="rec-strip" role="listbox" aria-label="Recorded notes">
            {notes.length === 0 ? (
              <p className="rec-strip-empty">
                No notes yet — press <strong>Record from guitar</strong> and play your pattern, or click frets on the neck below.
              </p>
            ) : (
              notes.map((n, i) => {
                const on = i === selected;
                const spotText = n.midi !== null && n.string !== undefined && n.fret !== undefined
                  ? `${STRING_LABELS[n.string]}${n.fret}`
                  : "";
                return (
                  <button
                    key={i}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`rec-note-pill ${on ? "is-on" : ""} ${n.midi === null ? "is-rest" : ""}`}
                    onClick={() => { setSelected(i); setReplacingFromGuitar(false); }}
                  >
                    <strong>{customNoteLabel(n, hub)}</strong>
                    {spotText ? <small>{spotText}</small> : null}
                  </button>
                );
              })
            )}
            <button type="button" className="rec-note-pill is-add" onClick={() => insertNoteAt("after", false)} title="Append a note">
              <Glyph name="plus" size={13} />
            </button>
          </div>

          {/* Selected note mistake-fixer bar */}
          {selNote ? (
            <div className="rec-editor-bar" role="group" aria-label="Fix selected note">
              <div className="rec-editor-group">
                <span className="rec-editor-tag">Note #{selected + 1}</span>
                <button type="button" className="cur-chip" onClick={() => shiftSelectedPitch(-12)} disabled={selNote.midi === null} title="Down 1 octave">−8ve</button>
                <button type="button" className="cur-chip" onClick={() => shiftSelectedPitch(-1)} disabled={selNote.midi === null} title="Down 1 semitone (↓)">−1</button>
                <span className="rec-pitch-badge">
                  {customNoteLabel(selNote, hub)}
                  {selNote.midi !== null && selNote.string !== undefined && selNote.fret !== undefined
                    ? ` · ${STRING_LABELS[selNote.string]} str f${selNote.fret}`
                    : ""}
                </span>
                <button type="button" className="cur-chip" onClick={() => shiftSelectedPitch(1)} disabled={selNote.midi === null} title="Up 1 semitone (↑)">+1</button>
                <button type="button" className="cur-chip" onClick={() => shiftSelectedPitch(12)} disabled={selNote.midi === null} title="Up 1 octave">+8ve</button>
              </div>

              <div className="rec-editor-group">
                <button
                  type="button"
                  className={`cur-chip ${replacingFromGuitar ? "is-on" : ""}`}
                  aria-pressed={replacingFromGuitar}
                  onClick={async () => {
                    if (replacingFromGuitar) { setReplacingFromGuitar(false); return; }
                    if (recording) stopRecording();
                    if (input.status !== "listening") await input.start();
                    setReplacingFromGuitar(true);
                  }}
                >
                  {replacingFromGuitar ? "Listening for fix…" : "Re-play on guitar"}
                </button>
                <button
                  type="button"
                  className="cur-chip"
                  onClick={cycleSelectedString}
                  disabled={selNote.midi === null || alternatePositions(selNote.midi, p).length < 2}
                  title="Move this exact pitch to another string/fret"
                >
                  Switch string
                </button>
                <button type="button" className={`cur-chip ${selNote.midi === null ? "is-on" : ""}`} onClick={toggleSelectedRest}>
                  {selNote.midi === null ? "Make note" : "Make rest"}
                </button>
              </div>

              <div className="rec-editor-group">
                {DURATION_CHOICES.slice(0, 6).map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    className={`cur-chip ${Math.abs(selNote.beats - d.beats) < 0.02 ? "is-on" : ""}`}
                    onClick={() => updateSelected((n) => ({ ...n, beats: d.beats }))}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              <div className="rec-editor-group">
                <button type="button" className="cur-chip" onClick={() => insertNoteAt("before", false)}>+ Before</button>
                <button type="button" className="cur-chip" onClick={() => insertNoteAt("after", false)}>+ After</button>
                <button type="button" className="cur-chip" onClick={() => insertNoteAt("after", true)}>+ Rest</button>
                <button type="button" className="cur-chip is-danger" onClick={deleteSelected}>Delete</button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 3. Interactive Fretboard (click any string/fret to fix pitch & exact fingering!) */}
        <div className="rec-neck-card">
          <div className="rec-card-bar">
            <span className="rec-card-label">
              Fretboard — {selected >= 0 ? `click any fret to set Note #${selected + 1}'s exact string & fret` : "click any fret to append a note"}
            </span>
            <span className="rec-card-hint">Fret window: frets {p}–{p + 3} (click fret number below to shift)</span>
          </div>
          <div className="rec-neck-wrap">
            <Fretboard
              notes={fretNotes}
              fretCount={17}
              position={position}
              labels="names"
              pattern={steps.length ? steps : null}
              activeStep={activeScoreStep}
              onFretClick={(fret) => {
                setP(Math.max(0, Math.min(15, fret)));
                setPTouched(true);
              }}
              onCellClick={handleFretCellClick}
            />
          </div>
        </div>
      </div>

      {/* 4. Exercise Details & Curriculum Toggle */}
      <div className="rec-meta-grid">
        <label className="rec-field rec-field--wide">
          <span>Exercise name</span>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
            placeholder="e.g. C major thirds · E shape"
            maxLength={120}
          />
        </label>

        <label className="rec-field">
          <span>Key</span>
          <select value={hub} onChange={(e) => { setHub(e.target.value); setHubTouched(true); }}>
            {HUB_OPTIONS.map((o) => (
              <option key={o.hub} value={o.hub}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="rec-field">
          <span>Shape / position tag</span>
          <select value={shape} onChange={(e) => setShape(e.target.value)}>
            <option value="">None / auto</option>
            {SHAPE_TAGS.filter(Boolean).map((tag) => (
              <option key={tag} value={tag}>{tag} shape</option>
            ))}
          </select>
        </label>

        <label className="rec-field">
          <span>Category</span>
          <select value={family} onChange={(e) => setFamily(e.target.value as CustomFamily)}>
            <option value="scales">Scale pattern</option>
            <option value="technique">Technique drill</option>
            <option value="melody">Melody / lick</option>
          </select>
        </label>

        <label className="rec-field">
          <span>Meter</span>
          <select value={beatsPerBar} onChange={(e) => setBeatsPerBar(Number(e.target.value) as CustomMeter)}>
            <option value={4}>4/4</option>
            <option value={3}>3/4</option>
            <option value={6}>6/8</option>
          </select>
        </label>

        <label className="rec-field">
          <span>Start BPM</span>
          <input
            type="number"
            min={36}
            max={220}
            value={bpm}
            onChange={(e) => setBpm(Math.max(36, Math.min(220, Number(e.target.value) || 72)))}
          />
        </label>

        <label className="rec-field">
          <span>Goal BPM</span>
          <input
            type="number"
            min={40}
            max={240}
            value={goalBpm}
            onChange={(e) => setGoalBpm(Math.max(40, Math.min(240, Number(e.target.value) || 120)))}
          />
        </label>

        <label className="rec-check-field">
          <input type="checkbox" checked={inCurriculum} onChange={(e) => setInCurriculum(e.target.checked)} />
          <span>Include in my active curriculum</span>
        </label>
      </div>
    </section>
  );
}

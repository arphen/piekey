import { useEffect, useMemo, useRef, useState } from "react";
import type { InputApi } from "../listen/useInput";
import { buildThemeCatalog, type ThemeSource } from "../song/theme";
import { useThemePicker } from "../song/useThemePicker";
import { SUMMON_NOTE } from "../song/notekeys";
import { NoteTag, PAD_NOTES, SUMMON_HINT, useNoteKeys, useSummon } from "./GuitarPad";
import "../song/tune-picker.css";

// The guitar menu's layout: each string's first fret, low E string back, high e on.
const KEYS = { cancel: PAD_NOTES[0], previous: PAD_NOTES[1], next: PAD_NOTES[2], review: PAD_NOTES[3], listen: PAD_NOTES[4], all: PAD_NOTES[5] };

/** An explicit practice-room action. Recognising a melody only offers choices; it never selects one. */
export function TunePicker({ input, sources, currentTuneId, onCancel, onChoose }: {
  input: InputApi;
  sources: ThemeSource[];
  currentTuneId?: string;
  onCancel(): void;
  onChoose(id: string): void | Promise<void>;
}) {
  const library = useMemo(() => [...new Map(sources.map((source) => [source.id, source])).values()], [sources]);
  const catalog = useMemo(() => buildThemeCatalog(library), [library]);
  const [stage, setStage] = useState<"browse" | "listen" | "confirm">("browse");
  const [matchedIds, setMatchedIds] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState(() => library.find((source) => source.id !== currentTuneId)?.id ?? library[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choosing = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const match = useThemePicker(input, catalog, stage === "listen");
  const choices = matchedIds ? library.filter((source) => matchedIds.includes(source.id)) : library;
  const selected = choices.find((source) => source.id === selectedId) ?? (stage === "confirm" ? undefined : choices[0]);
  const move = (step: number) => {
    if (!choices.length) return;
    const at = Math.max(0, choices.findIndex((source) => source.id === selected?.id));
    setSelectedId(choices[(at + step + choices.length) % choices.length].id);
    setError(null);
  };
  const review = () => {
    if (!selected || selected.id === currentTuneId) return;
    setSelectedId(selected.id);
    setError(null);
    setStage("confirm");
  };
  const listen = () => {
    match.reset();
    setError(null);
    setStage("listen");
  };
  const reviewMatches = () => {
    const ids = match.candidates.map((candidate) => candidate.id);
    setMatchedIds(ids.length ? ids : null);
    setSelectedId(ids.find((id) => id !== currentTuneId) ?? ids[0] ?? selectedId);
    setStage("browse");
  };
  const allTunes = () => { setMatchedIds(null); setError(null); };
  const back = () => {
    if (busy) return;
    if (stage === "confirm") { setStage("browse"); setError(null); }
    else onCancel();
  };
  const confirm = async () => {
    if (!selected || selected.id === currentTuneId || choosing.current) return;
    choosing.current = true;
    setBusy(true);
    setError(null);
    try { await onChoose(selected.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change tune. Your practice stays here; try again."); }
    finally { choosing.current = false; setBusy(false); }
  };
  useEffect(() => { panel.current?.focus(); }, [stage]);
  const keyboard = useRef({ stage, reviewMatches, back });
  keyboard.current = { stage, reviewMatches, back };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        const action = keyboard.current;
        if (action.stage === "listen") action.reviewMatches();
        else action.back();
      } else if (event.key === "Tab") {
        const controls = [...panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)") ?? []];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const browseHeld = useNoteKeys(input, stage === "browse" && !busy, Object.values(KEYS), (key) => {
    if (key === 0) onCancel();
    else if (key === 1) move(-1);
    else if (key === 2) move(1);
    else if (key === 3) review();
    else if (key === 4) listen();
    else allTunes();
  });
  // A separate subscription arms afresh after reviewing a choice. Neither the opening melody
  // nor the held G♯ that opened confirmation can also confirm the switch.
  const confirmHeld = useNoteKeys(input, stage === "confirm" && !busy, [KEYS.cancel, KEYS.all], (key) => key === 0 ? back() : void confirm());
  useSummon(input, stage === "listen", reviewMatches);

  return (
    <section ref={panel} tabIndex={-1} className="ss-tune-picker" role="dialog" aria-modal="true" aria-label="Choose tune">
      <div className="ss-tune-picker-body">
        <p className="ss-kicker">Practice room · choose tune</p>
        <h1>{stage === "confirm" ? "Ready to change tune?" : stage === "listen" ? "Play the opening melody" : "Choose tune"}</h1>
        {stage === "listen" ? <>
          <p>Play the first melody notes in the score’s key, in any octave. Take your own time.</p>
          <p className="ss-tune-picker-status" role="status">{input.status !== "listening" || input.paused ? "Input is not listening. The tune list is available below." : `${match.heard.length} notes heard · ${match.candidates.length ? `${match.candidates.length} possible tune${match.candidates.length === 1 ? "" : "s"}` : "waiting for a matching opening"}`}</p>
          {match.candidates.length ? <ul className="ss-tune-matches">{match.candidates.map((candidate) => <li key={candidate.id}><strong>{candidate.title}</strong><span>{candidate.matchedNotes} opening notes matched</span></li>)}</ul> : null}
          <p className="ss-tune-picker-detail">Similar openings can match more than one tune. Nothing changes until you choose and confirm.</p>
          <button type="button" onClick={reviewMatches}><NoteTag midi={SUMMON_NOTE} held={false} />{match.candidates.length ? "Review matches" : "Return to tune list"}<small>{SUMMON_HINT}</small></button>
        </> : stage === "confirm" ? <>
          <p className="ss-tune-picked">{selected?.title ?? "This tune is no longer available. Choose another tune."}</p>
          <p>Completed practice will be kept. Any unfinished pass ends without credit.</p>
          {error ? <p className="ss-tune-picker-error" role="alert">{error}</p> : null}
          <div className="ss-tune-picker-actions">
            <button type="button" onClick={back} disabled={busy}><NoteTag midi={KEYS.cancel} held={confirmHeld === 0} />Back to choices</button>
            <button type="button" className="ss-tune-primary" onClick={() => void confirm()} disabled={busy || !selected}><NoteTag midi={KEYS.all} held={confirmHeld === 1} />{busy ? "Saving practice…" : error ? "Retry change" : "Change tune"}</button>
          </div>
          <p className="ss-tune-picker-detail">Release the last note, then hold F4 (high e, fret 1) to confirm.</p>
        </> : <>
          <p>{matchedIds ? "Matching openings · choose the tune you meant." : "Your library stays inside the practice room."}</p>
          <label className="ss-tune-select">Tune<select aria-label="Tune to practise" value={selected?.id ?? ""} onChange={(event) => { setSelectedId(event.target.value); setError(null); }}>{choices.map((source) => <option key={source.id} value={source.id}>{source.title}{source.id === currentTuneId ? " · current tune" : ""}</option>)}</select></label>
          <p className="ss-tune-picker-detail">Hold the shown note for a moment. A♯ and D♯ move through every choice; G♯ reviews it.</p>
          <div className="ss-tune-picker-actions">
            <button type="button" onClick={() => move(-1)} disabled={choices.length < 2}><NoteTag midi={KEYS.previous} held={browseHeld === 1} />Previous tune</button>
            <button type="button" onClick={() => move(1)} disabled={choices.length < 2}><NoteTag midi={KEYS.next} held={browseHeld === 2} />Next tune</button>
            <button type="button" className="ss-tune-primary" onClick={review} disabled={!selected || selected.id === currentTuneId}><NoteTag midi={KEYS.review} held={browseHeld === 3} />Review choice</button>
          </div>
          <div className="ss-tune-picker-actions">
            <button type="button" onClick={listen} disabled={!catalog.themes.length}><NoteTag midi={KEYS.listen} held={browseHeld === 4} />Listen to opening</button>
            {matchedIds ? <button type="button" onClick={allTunes}><NoteTag midi={KEYS.all} held={browseHeld === 5} />All tunes</button> : null}
            <button type="button" onClick={onCancel}><NoteTag midi={KEYS.cancel} held={browseHeld === 0} />Return to practice</button>
          </div>
          <p className="ss-tune-picker-detail">Opening recognition compares pitch classes only, in the original key.{catalog.omitted ? ` ${catalog.omitted} tune${catalog.omitted === 1 ? " is" : "s are"} available through the list only.` : ""}</p>
        </>}
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { buildDeck, familiesOnly, FOCUS_FAMILIES, type Focus } from "../song/deck";
import { loadStore, today } from "../song/leitner";
import { nextUnits } from "../overview/summary";
import { relativeDay } from "../overview/visual";
import type { GlyphName } from "../overview/modes";
import type { InputApi } from "../listen/useInput";
import { getLibraryIssues, loadCurrentTuneId, loadLibrary, loadLibraryAsync, parseTuneEntry, saveCurrentTuneId, subscribeLibraryIssues, type TuneEntry } from "../tunes/library";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline, type Timeline } from "../tunes/order";
import { Glyph } from "./Glyph";
import { UnitCard } from "./UnitCard";
import { openPractice, SongCoach } from "./SongCoach";
import "../overview/focus.css";

type Mode = Exclude<Focus, "all">;

const COPY: Record<Mode, { label: string; empty: string; glyph: GlyphName }> = {
  changes: { label: "Changes", empty: "No chord exercises in this tune.", glyph: "chords" },
  scales: { label: "Scales", empty: "No scale exercises in this tune.", glyph: "scales" },
  ear: { label: "Ear", empty: "No ear exercises in this tune.", glyph: "ear" },
  reading: { label: "Reading", empty: "No reading exercises in this tune.", glyph: "reading" },
};

/**
 * A tutor mode that works on one slice of the current tune: the full-screen session runs with the
 * deck narrowed to the mode's card families (`FOCUS_FAMILIES`). Progress shares the tune's store.
 */
export function FocusView({ focus, input, onOpenTunes, extra }: { focus: Mode; input: InputApi; onOpenTunes?: () => void; extra?: { label: string; onOpen: () => void } }) {
  const copy = COPY[focus];
  const [library, setLibrary] = useState<TuneEntry[]>(() => loadLibrary());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [initialCardId, setInitialCardId] = useState<string>();
  const [selected, setSelected] = useState<string | null>(() => loadCurrentTuneId());
  const [coach, setCoach] = useState(false);
  const [revision, setRevision] = useState(0);
  const libraryIssues = useSyncExternalStore(subscribeLibraryIssues, getLibraryIssues, getLibraryIssues);

  const entry = library.find((tune) => tune.id === selected) ?? library[0] ?? null;
  useEffect(() => {
    let gone = false;
    void loadLibraryAsync().then((entries) => {
      if (!gone) setLibrary(entries);
    }).catch(() => { if (!gone) setLoadError(true); }).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, []);
  const parsed = useMemo((): { sheet: LeadSheet; tl: Timeline } | null => {
    if (!entry) return null;
    try {
      const sheet = parseTuneEntry(entry);
      return { sheet, tl: buildTimeline(sheet) };
    } catch {
      return null;
    }
  }, [entry]);
  const sheet = parsed?.sheet ?? null;
  const tl = parsed?.tl ?? null;

  const deck = useMemo(() => (sheet && tl ? familiesOnly(buildDeck(sheet, tl), FOCUS_FAMILIES[focus]) : null), [sheet, tl, focus]);
  const store = useMemo(() => (sheet ? loadStore(sheet.id) : null), [sheet, revision]);
  const next = useMemo(() => (deck && store ? nextUnits(deck, store, 3) : []), [deck, store]);
  const chords = useMemo(
    () =>
      sheet
        ? [...new Set(sheet.bars.flatMap((bar) => bar.chordSymbols).filter((symbol) => symbol && symbol !== "N.C."))]
        : [],
    [sheet],
  );
  const lastPlayed = store?.sessions[store.sessions.length - 1]?.date ?? null;

  const start = (cardId?: string) => {
    if (loading || loadError || !sheet || !tl || !next.length) return;
    openPractice(input);
    setInitialCardId(cardId);
    setCoach(true);
  };

  const closeCoach = () => {
    setCoach(false);
    setRevision((value) => value + 1);
  };

  if (coach && sheet && tl) {
    return (
      <SongCoach
        key={sheet.id}
        sheet={sheet}
        tl={tl}
        input={input}
        onClose={closeCoach}
        tunes={library.map((tune) => ({ id: tune.id, title: tune.name }))}
        onTune={(id) => {
          setInitialCardId(undefined);
          saveCurrentTuneId(id);
          setSelected(id);
        }}
        focus={focus}
        initialCardId={initialCardId}
      />
    );
  }

  return (
    <main className="focus-song">
      <header className="focus-song-head">
        <h2><Glyph name={copy.glyph} size={28} />{copy.label}</h2>
        <div className="focus-song-actions">
          {sheet ? (
            <button type="button" className="focus-song-start" onClick={() => start()} disabled={loading || loadError || !next.length} aria-label={`Start ${copy.label.toLowerCase()} for ${sheet.title}`}>
              <Glyph name="play" size={15} />Start
            </button>
          ) : null}
          {extra ? <button type="button" className="focus-song-secondary" onClick={extra.onOpen}>{extra.label}<Glyph name="arrow" size={14} /></button> : null}
          {sheet && onOpenTunes ? <button type="button" className="focus-song-library" onClick={onOpenTunes} aria-label="Open tune library"><Glyph name="library" size={17} /></button> : null}
        </div>
      </header>

      {!loading && libraryIssues.length ? <p className="focus-song-empty" role="status">
        {libraryIssues.map((issue) => issue.name).join(", ")} {libraryIssues.length === 1 ? "needs" : "need"} a score repair. Healthy tunes remain available.
        {onOpenTunes ? <> <button type="button" className="focus-song-secondary" onClick={onOpenTunes}>Repair in library</button></> : null}
      </p> : null}

      {sheet && store ? (
        <>
          <div className="focus-song-tune" aria-label="current tune">
            <strong>{sheet.title}</strong>
            <span>{sheet.keySignature}{sheet.composer ? ` · ${sheet.composer}` : ""} · {relativeDay(lastPlayed, today())}</span>
          </div>
          {focus === "changes" && chords.length ? (
            <div className="focus-song-chords" aria-label="Chords in this tune">
              <Glyph name="harmony" size={18} />
              {chords.slice(0, 9).map((chord) => <span key={chord}>{chord}</span>)}
              {chords.length > 9 ? <small>+{chords.length - 9}</small> : null}
            </div>
          ) : null}
          <section className="focus-song-plan" aria-label={`${copy.label} exercises`}>
            <div className="focus-song-plan-head"><h3>Exercises</h3><span>{next.length || "—"}</span></div>
            {next.length ? next.map((unit) => <UnitCard key={unit.id} unit={unit} onOpen={() => start(unit.id)} />) : <p className="focus-song-empty">{copy.empty}</p>}
          </section>
        </>
      ) : (
        <section className="focus-song-empty-state">
          <Glyph name="library" size={30} />
          <div>
            <strong>{loading ? "Opening library…" : loadError ? "Library unavailable" : libraryIssues.length ? "Scores need repair" : entry ? "Unreadable score" : "No tunes"}</strong>
            {loadError || entry ? <p>{loadError ? "Your saved tunes are unchanged." : "Import the MusicXML file again."}</p> : null}
          </div>
          {onOpenTunes ? <button type="button" className="focus-song-start" onClick={onOpenTunes}>Open library<Glyph name="arrow" size={15} /></button> : null}
        </section>
      )}
    </main>
  );
}

import { useMemo, useRef, useState, type CSSProperties } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { today } from "../song/leitner";
import type { NoteResult } from "../core/contract";
import { TUTOR_MODES, type TutorTargetTab } from "../overview/modes";
import { pickGlobalUnits } from "../overview/summary";
import { cachedSong, useSongSummaries } from "../overview/useSongSummaries";
import { relativeDay } from "../overview/visual";
import { loadLibraryAsync, parseTuneEntry, saveLibrary } from "../tunes/library";
import { BLUE_HOUR_ENTRY, DEMO_TUNES } from "../tunes/demos";
import { Glyph } from "./Glyph";
import { UnitCard } from "./UnitCard";
import { Score } from "./Score";
import { GoalChooser } from "./GoalChooser";
import "../overview/overview.css";

const SONG_LIMIT = 4;
const NO_RESULTS: NoteResult[] = [];

function BoxBar({ boxes, total }: { boxes: number[]; total: number }) {
  return (
    <span className="tutor-boxbar" aria-label="box progress">
      {boxes.map((count, index) =>
        count ? (
          <i
            key={index}
            data-box={index + 1}
            style={{ width: `${total ? (count / total) * 100 : 0}%` }}
            title={`box ${index + 1}: ${count}`}
          />
        ) : null,
      )}
    </span>
  );
}

function EmptyLibrary({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="tutor-empty">
      <Glyph name="library" size={26} />
      <div>
        <strong>Your own music</strong>
        <p>MusicXML · .xml · .mxl</p>
      </div>
      <button type="button" className="tutor-primary" onClick={onOpen}>
        Import tune <Glyph name="arrow" size={16} />
      </button>
    </div>
  );
}

export function OverviewView({
  onOpenMode,
  onOpenSong,
  onListenSong,
  onOpenProgress,
  onStartPractice,
  onPreparePractice,
}: {
  onOpenMode: (target: TutorTargetTab) => void;
  onOpenSong: (tuneId: string) => void;
  onListenSong?: (tuneId: string) => void;
  onOpenProgress?: () => void;
  onStartPractice: (tuneId: string, cardId?: string, prepared?: boolean) => void;
  onPreparePractice?: () => void;
}) {
  const { songs, currentTuneId, loading, error, issues = [] } = useSongSummaries();
  const [showAll, setShowAll] = useState(false);
  const [starting, setStarting] = useState(false);
  const demoBusy = useRef(false);
  const [demoId, setDemoId] = useState(BLUE_HOUR_ENTRY.id);
  const demo = DEMO_TUNES.find((item) => item.entry.id === demoId) ?? DEMO_TUNES[0];
  const current = songs.find((song) => song.tuneId === currentTuneId) ?? songs[0] ?? null;
  const currentMusic = current ? cachedSong(current.tuneId) : undefined;
  const mixed = pickGlobalUnits(songs, current?.tuneId ?? null, 3);
  const visibleSongs = showAll ? songs : songs.slice(0, SONG_LIMIT);
  const day = today();
  const example = useMemo(() => !current && !loading ? parseTuneEntry(demo.entry) : null, [current, loading, demo]);
  const excerpt = current?.excerpt ?? (example ? { bars: example.bars.slice(0, 2), keySignature: example.keySignature, timeSignature: example.timeSignature } : null);
  const title = current?.title ?? example?.title ?? (loading ? "Loading…" : "Library unavailable");
  const key = current?.key ?? example?.keySignature;
  const tempo = current?.tempo ?? example?.tempo;
  const barCount = current?.barCount ?? example?.bars.length;
  const openDemo = async (action: "open" | "listen" | "practice") => {
    if (demoBusy.current) return;
    demoBusy.current = true;
    if (action === "practice") onPreparePractice?.();
    if (action === "listen") { ensureAudio(); void Tone.start().catch(() => undefined); }
    setStarting(true);
    try {
      const entries = await loadLibraryAsync();
      if (!entries.some((entry) => entry.id === demo.entry.id)) await saveLibrary([...entries, demo.entry]);
    } catch {
      // The bundled original can be previewed even when the saved library is unavailable.
    } finally {
      demoBusy.current = false;
      setStarting(false);
    }
    if (action === "practice") onStartPractice(demo.entry.id, undefined, Boolean(onPreparePractice));
    else if (action === "listen" && onListenSong) onListenSong(demo.entry.id);
    else onOpenSong(demo.entry.id);
  };

  return (
    <main className="tutor">
      <header className="tutor-hero">
        <div className="tutor-hero-copy">
          <p className="tutor-eyebrow">{current ? "Practice" : demo.label}</p>
          <h2>{title}</h2>
          <div className="tutor-tune-meta">
            {key ? <span>{key}</span> : null}
            {excerpt ? <span>{excerpt.timeSignature}</span> : null}
            {tempo ? <span><Glyph name="free" size={15} />{tempo}</span> : null}
            {barCount ? <span>{barCount} bars</span> : null}
          </div>
          {current?.composer ? <p className="tutor-composer">{current.composer}</p> : null}
          {!current && !loading ? <>
            <p className="tutor-demo-description">{demo.description}</p>
            <div className="tutor-demo-choices" role="group" aria-label="Try an original study">
              {DEMO_TUNES.map((item) => <button key={item.entry.id} type="button" aria-pressed={demoId === item.entry.id} disabled={starting} onClick={() => setDemoId(item.entry.id)}>{item.title}</button>)}
            </div>
          </> : null}
          {error ? <p className="tutor-error" role="alert">{error}</p> : null}
          <div className="tutor-actions">
            <button
              type="button"
              className="tutor-primary"
              disabled={loading || starting}
              onClick={() => current ? onStartPractice(current.tuneId) : void openDemo("practice")}
            >
              <Glyph name="play" size={18} />{starting ? "Loading…" : current ? "Start practice" : "Try practice"}
            </button>
            <button type="button" className="tutor-secondary" disabled={loading || starting} onClick={() => current ? onOpenMode("tunes") : void openDemo(onListenSong ? "listen" : "open")}>
              <Glyph name={current ? "library" : "ear"} size={19} />{current ? "Library" : "Listen"}
            </button>
          </div>
        </div>

        <div className="tutor-manuscript">
          {excerpt ? <div className="tutor-excerpt"><Score exercise={excerpt} activeStep={-1} results={NO_RESULTS} showFingering={false} barsPerLine={2} /></div> : <div className="tutor-staff-placeholder" aria-hidden="true" />}
          {current?.path.total ? (
            <ol className="tutor-path" aria-label={`${current.path.ready} of ${current.path.total} performance milestones`}>
              {current.path.milestones.map((milestone) => <li key={milestone.id} className={milestone.ready ? "is-ready" : ""} title={milestone.ready ? `${milestone.label} achieved` : `${milestone.label} not yet achieved`}><span>{milestone.ready ? <Glyph name="check" size={13} /> : <i />}</span><small>{milestone.label}</small></li>)}
            </ol>
          ) : null}
        </div>
      </header>

      {currentMusic ? <GoalChooser sheet={currentMusic.sheet} deck={currentMusic.deck} /> : null}

      {issues.length ? <section className="tutor-library-issues" aria-label="Scores needing repair"><h3>Scores needing repair</h3>{issues.map((issue) => <div key={issue.id}><span>{issue.name}</span><small>{issue.message}</small><button type="button" className="tutor-link" onClick={() => onOpenSong(issue.id)}>Repair score <Glyph name="arrow" size={15} /></button></div>)}</section> : null}

      <div className="tutor-workbench">
      {loading || songs.length > 0 ? (
        <section className="tutor-section tutor-next" aria-labelledby="tutor-mixed-title">
          <div className="tutor-section-head">
            <h3 id="tutor-mixed-title">Next</h3>
            <span className="tutor-section-count">{mixed.length ? String(mixed.length).padStart(2, "0") : ""}</span>
          </div>
          {loading ? (
            <div className="tutor-loading">Loading…</div>
          ) : (
            <div className="tutor-mixed">
              {mixed.map((unit) => (
                <UnitCard
                  key={`${unit.tuneId}:${unit.id}`}
                  unit={unit}
                  label={songs.length > 1 ? unit.tuneTitle : undefined}
                  reason={unit.reason}
                  onOpen={() => onStartPractice(unit.tuneId, unit.id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="tutor-section tutor-mode-section" aria-labelledby="tutor-modes-title">
        <div className="tutor-section-head">
          <h3 id="tutor-modes-title">Explore</h3>
        </div>
        <div className="tutor-modes">
          {TUTOR_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="tutor-mode"
              style={{ "--mode": mode.color } as CSSProperties}
              onClick={() => onOpenMode(mode.targetTab)}
              title={mode.blurb}
            >
              <span className="tutor-mode-icon">
                <Glyph name={mode.glyph} size={30} />
              </span>
              <span className="tutor-mode-copy">
                <strong>{mode.label}</strong>
              </span>
              {mode.requiresTune && !current ? <span className="tutor-mode-note">choose a song</span> : null}
            </button>
          ))}
        </div>
      </section>
      </div>

      {onOpenProgress ? <button type="button" className="tutor-link tutor-progress-link" onClick={onOpenProgress}><Glyph name="progress" size={18} />Progress & recordings <Glyph name="arrow" size={16} /></button> : null}


      <section className="tutor-section" aria-labelledby="tutor-songs-title">
        <div className="tutor-section-head">
          <h3 id="tutor-songs-title"><Glyph name="library" size={19} />Tunes</h3>
          <div className="tutor-section-actions">
            {songs.length > SONG_LIMIT ? (
              <button type="button" className="tutor-link" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show less" : `All ${songs.length}`}
              </button>
            ) : null}
            <button type="button" className="tutor-link" onClick={() => onOpenMode("tunes")}>
              Open library <Glyph name="arrow" size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="tutor-loading">Loading…</div>
        ) : visibleSongs.length ? (
          <div className="tutor-song-list">
            {visibleSongs.map((song) => (
              <article key={song.tuneId} className="tutor-song">
                <header className="tutor-song-head">
                  <Glyph name="melody" size={23} />
                  <div className="tutor-song-name">
                    <h4>{song.title}</h4>
                    <p>
                      {[song.key, song.composer, relativeDay(song.lastPlayed, day)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {song.boxes.some(Boolean) ? <div className="tutor-song-progress"><BoxBar boxes={song.boxes} total={song.total} /></div> : null}
                  <button type="button" className="tutor-link" aria-label={`Open ${song.title}`} onClick={() => onOpenSong(song.tuneId)}>
                    <Glyph name="arrow" size={19} />
                  </button>
                </header>
              </article>
            ))}
          </div>
        ) : (
          <EmptyLibrary onOpen={() => onOpenMode("tunes")} />
        )}
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listTakes, takeAudio, type TakeMeta } from "../audio/recorder";
import { latencyMeasured } from "../audio/latency";
import { allStores, today } from "../song/leitner";
import { allAttempts, buildProfile, type Axis } from "../song/profile";
import { weeklyMinutes } from "../overview/progress";
import type { NoteResult } from "../core/contract";
import { TUTOR_MODES, type TutorTargetTab } from "../overview/modes";
import { pickGlobalUnits } from "../overview/summary";
import { useSongSummaries } from "../overview/useSongSummaries";
import { relativeDay } from "../overview/visual";
import { loadLibraryAsync, parseTuneEntry, saveLibrary } from "../tunes/library";
import { STARTER_ENTRY } from "../tunes/starter";
import { Glyph } from "./Glyph";
import { UnitCard } from "./UnitCard";
import { Score } from "./Score";
import "../overview/overview.css";

const SONG_LIMIT = 4;
const NO_RESULTS: NoteResult[] = [];
const AXIS_LABEL: Record<Axis, string> = { pitch: "First-try notes", time: "Timing consistency", tempo: "Clean scale tempo / goal", chords: "Chord accuracy", reading: "Reading accuracy", ear: "Echo accuracy" };
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** The tune's first run-through and its latest, to be heard one after the other. */
function Takes({ tuneId, day }: { tuneId: string; day: string }) {
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    let gone = false;
    void listTakes(tuneId).then((t) => !gone && setTakes(t));
    return () => {
      gone = true;
      audio.current?.pause();
    };
  }, [tuneId]);
  if (!takes.length) return null;
  const first = takes[0];
  const latest = takes.length > 1 ? takes[takes.length - 1] : null;
  const play = async (t: TakeMeta) => {
    audio.current?.pause();
    if (playing === t.id) return setPlaying(null);
    const blob = await takeAudio(tuneId, t.id);
    if (!blob) return;
    const a = new Audio(URL.createObjectURL(blob));
    a.onended = () => setPlaying(null);
    audio.current = a;
    setPlaying(t.id);
    void a.play().catch(() => setPlaying(null));
  };
  const label = (t: TakeMeta) => `${relativeDay(t.day, day)} · ♩ ${t.bpm}${t.share !== null ? ` · ${pct(t.share)}` : ""}`;
  return (
    <div className="tutor-takes" aria-label="run-throughs, recorded">
      {[first, latest].filter((t): t is TakeMeta => t !== null).map((t, i) => (
        <button key={t.id} type="button" className={`tutor-link ${playing === t.id ? "is-playing" : ""}`} onClick={() => void play(t)}>
          {playing === t.id ? "■" : "▶"} {i === 0 ? "first take" : "latest take"} · {label(t)}
        </button>
      ))}
    </div>
  );
}

/** How the playing is going across every tune: skills, the mistakes that keep coming back, minutes. */
function Playing({ day }: { day: string }) {
  const { profile, weeks } = useMemo(() => {
    const stores = allStores();
    return { profile: buildProfile(allAttempts(stores), day, latencyMeasured()), weeks: weeklyMinutes(stores.map((s) => s.store), day) };
  }, [day]);
  const axes = (Object.keys(AXIS_LABEL) as Axis[]).filter((a) => profile.axes[a].n > 0);
  if (!axes.length) return null;
  const most = Math.max(1, ...weeks);
  return (
    <section className="tutor-section" aria-labelledby="tutor-playing-title">
      <div className="tutor-section-head">
        <div>
          <h3 id="tutor-playing-title">Playing</h3>
        </div>
      </div>
      <div className="tutor-playing">
        <ul className="tutor-axes">
          {axes.map((a) => {
            const x = profile.axes[a];
            return (
              <li key={a}>
                <span>{AXIS_LABEL[a]}</span>
                <i style={{ "--level": x.level } as CSSProperties} />
                <b>{pct(x.level)}</b>
                <em className={x.trend === null ? "" : x.trend >= 0 ? "is-up" : "is-down"}>{x.trend === null ? "" : `${x.trend >= 0 ? "+" : "−"}${Math.round(Math.abs(x.trend) * 100)}`}</em>
              </li>
            );
          })}
        </ul>
        <div className="tutor-weeks" aria-label="minutes played, the last four weeks">
          {weeks.map((m, i) => (
            <span key={i} title={`${m} min`}>
              <i style={{ height: `${Math.max(4, (m / most) * 100)}%` }} />
              <small>{m}</small>
            </span>
          ))}
          <p>minutes a week</p>
        </div>
        {profile.weaknesses.length ? (
          <ul className="tutor-weak">
            {profile.weaknesses.slice(0, 3).map((w) => (
              <li key={w.cls}>{w.fact}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

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
        <strong>No tunes yet</strong>
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
  onStartPractice,
}: {
  onOpenMode: (target: TutorTargetTab) => void;
  onOpenSong: (tuneId: string) => void;
  onStartPractice: (tuneId: string, cardId?: string) => void;
}) {
  const { songs, currentTuneId, loading, error } = useSongSummaries();
  const [showAll, setShowAll] = useState(false);
  const [starting, setStarting] = useState(false);
  const current = songs.find((song) => song.tuneId === currentTuneId) ?? songs[0] ?? null;
  const mixed = pickGlobalUnits(songs, current?.tuneId ?? null, 3);
  const visibleSongs = showAll ? songs : songs.slice(0, SONG_LIMIT);
  const day = today();
  const example = useMemo(() => !current && !loading && !error ? parseTuneEntry(STARTER_ENTRY) : null, [current, loading, error]);
  const excerpt = current?.excerpt ?? (example ? { bars: example.bars.slice(0, 2), keySignature: example.keySignature, timeSignature: example.timeSignature } : null);
  const title = current?.title ?? example?.title ?? (loading ? "Loading…" : "Library unavailable");
  const key = current?.key ?? example?.keySignature;
  const tempo = current?.tempo ?? example?.tempo;
  const barCount = current?.barCount ?? example?.bars.length;
  const starter = async () => {
    setStarting(true);
    try {
      const entries = await loadLibraryAsync();
      if (!entries.some((entry) => entry.id === STARTER_ENTRY.id) && !await saveLibrary([...entries, STARTER_ENTRY])) return;
      onStartPractice(STARTER_ENTRY.id);
    } catch {
      // The shared save notice reports the error and preserves the current library.
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="tutor">
      <header className="tutor-hero">
        <div className="tutor-hero-copy">
          <p className="tutor-eyebrow">{current ? "Practice" : "Guitar study"}</p>
          <h2>{title}</h2>
          <div className="tutor-tune-meta">
            {key ? <span>{key}</span> : null}
            {excerpt ? <span>{excerpt.timeSignature}</span> : null}
            {tempo ? <span><Glyph name="free" size={15} />{tempo}</span> : null}
            {barCount ? <span>{barCount} bars</span> : null}
          </div>
          {current?.composer ? <p className="tutor-composer">{current.composer}</p> : null}
          {error ? <p className="tutor-error" role="alert">{error}</p> : null}
          <div className="tutor-actions">
            <button
              type="button"
              className="tutor-primary"
              disabled={loading || starting || Boolean(error)}
              onClick={() => current ? onStartPractice(current.tuneId) : void starter()}
            >
              <Glyph name="play" size={18} />{starting ? "Loading…" : "Start practice"}
            </button>
            <button type="button" className="tutor-secondary" onClick={() => onOpenMode("tunes")}>
              <Glyph name="library" size={19} />Library
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

      {!loading ? <Playing day={day} /> : null}

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
                <Takes tuneId={song.tuneId} day={day} />
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

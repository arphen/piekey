import { useMemo, useState } from "react";
import type { InputApi } from "../listen/useInput";
import { mod } from "../musicTheory";
import { songFill } from "../overview/map";
import type { TutorTargetTab } from "../overview/modes";
import { useSongSummaries } from "../overview/useSongSummaries";
import {
  addCurriculumCustom,
  addCurriculumScale,
  CURRICULUM_STUDY_ID,
  curriculumCount,
  curriculumSummaryLabel,
  hubForScaleCardId,
  labelForScaleCardId,
  removeCurriculumCustom,
  scaleCardOptionsForHub,
  toggleCurriculumCustom,
  toggleCurriculumFoundation,
  toggleCurriculumScale,
  useCurriculum,
} from "../song/curriculum";
import {
  deleteCustomExercise,
  HUB_OPTIONS,
  saveCustomExercise,
  transposeCustomExercise,
  useCustomExercises,
  type CustomExercise,
} from "../song/customExercises";
import { keyStudyId, parseHubId } from "../song/keyStudy";
import { BOXES, loadSharedSkills, today } from "../song/leitner";
import { useSessionSet } from "../song/sessionSet";
import { FOUNDATION_GROUPS, TECHNIQUE_TRACKS, type FoundationGroup } from "../song/technique";
import { ExerciseRecorder } from "./ExerciseRecorder";
import { Glyph } from "./Glyph";
import type { PracticeLaunchOptions } from "./TuneView";
import "../song/curriculum.css";

const GROUP_ORDER: FoundationGroup[] = ["fingers", "picking", "time", "phrasing"];

function BoxDots({ box }: { box: number }) {
  return (
    <span className="cur-pips" aria-label={box > 0 ? `Box ${box} of ${BOXES}` : "New"}>
      {Array.from({ length: BOXES }, (_, i) => (
        <i key={i} className={i < box ? "is-on" : ""} />
      ))}
    </span>
  );
}

export interface CurriculumViewProps {
  input: InputApi;
  onPracticeCurriculum(): void;
  onStartPractice(tuneId: string, cardId?: string, prepared?: boolean, options?: PracticeLaunchOptions): void;
  onOpenSong(tuneId: string): void;
  onOpenLibrary(): void;
  onOpenMode(target: TutorTargetTab): void;
}

export function CurriculumView({
  input,
  onPracticeCurriculum,
  onStartPractice,
  onOpenSong,
  onOpenLibrary,
  onOpenMode,
}: CurriculumViewProps) {
  const { songs, loading } = useSongSummaries(0);
  const libraryIds = useMemo(() => songs.map((s) => s.tuneId), [songs]);
  const session = useSessionSet(libraryIds);
  const curriculum = useCurriculum();
  const customExercises = useCustomExercises();
  const shared = useMemo(() => loadSharedSkills(), [customExercises, curriculum, songs]);

  const [studioOpen, setStudioOpen] = useState(false);
  const [editing, setEditing] = useState<CustomExercise | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [transposeOpenId, setTransposeOpenId] = useState<string | null>(null);
  const [scaleHub, setScaleHub] = useState("M0");

  const counts = useMemo(
    () => curriculumCount(session.ids, curriculum, customExercises),
    [session.ids, curriculum, customExercises],
  );
  const summaryText = curriculumSummaryLabel(counts);
  const scaleChoices = useMemo(() => scaleCardOptionsForHub(scaleHub), [scaleHub]);

  const openNewRecorder = () => {
    setEditing(null);
    setStudioOpen(true);
  };

  const openEditRecorder = (ex: CustomExercise) => {
    setEditing(ex);
    setStudioOpen(true);
  };

  const handleSaveExercise = (
    exercise: CustomExercise,
    options: { inCurriculum: boolean; practiceNow: boolean },
  ) => {
    saveCustomExercise(exercise);
    if (options.inCurriculum) addCurriculumCustom(exercise.id);
    else removeCurriculumCustom(exercise.id);
    setStudioOpen(false);
    setEditing(null);
    if (options.practiceNow) {
      onStartPractice(CURRICULUM_STUDY_ID, exercise.id, false, { autoStart: true, mixIds: [] });
    }
  };

  const handleDeleteExercise = (id: string) => {
    deleteCustomExercise(id);
    removeCurriculumCustom(id);
    setConfirmDeleteId(null);
  };

  const handleCopyToKey = (ex: CustomExercise, targetHub: string) => {
    const src = parseHubId(ex.hub);
    const dst = parseHubId(targetHub);
    if (!src || !dst) return;
    let delta = mod(dst.pc - src.pc);
    if (delta > 6) delta -= 12;
    const copy = transposeCustomExercise(ex, delta, { newId: true, day: today() });
    saveCustomExercise(copy);
    addCurriculumCustom(copy.id);
    setTransposeOpenId(null);
  };

  const practiceCustom = (ex: CustomExercise) => {
    onStartPractice(CURRICULUM_STUDY_ID, ex.id, false, { autoStart: true, mixIds: [] });
  };

  const practiceScale = (scaleId: string) => {
    const hub = hubForScaleCardId(scaleId) ?? "M0";
    onStartPractice(keyStudyId(hub), scaleId, false, { focus: "scales", mixIds: [], studyHubIds: [hub], autoStart: true });
  };

  const practiceFoundation = (trackId: string, hub: string) => {
    onStartPractice(keyStudyId(hub), trackId, false, { focus: "technique", mixIds: [], studyHubIds: [hub], autoStart: true });
  };

  if (studioOpen) {
    return (
      <main className="cur-page">
        <ExerciseRecorder
          input={input}
          initial={editing}
          initialInCurriculum={editing ? curriculum.customIds.includes(editing.id) : true}
          onSave={handleSaveExercise}
          onCancel={() => { setStudioOpen(false); setEditing(null); }}
        />
      </main>
    );
  }

  return (
    <main className="cur-page" aria-label="Curriculum overview">
      <header className="cur-hero">
        <div className="cur-hero-copy">
          <p className="cur-kicker">Total curriculum</p>
          <h2>What you practise</h2>
          <p className="cur-byline">
            Add or remove songs, your own recorded exercises, scales, and foundations. Hitting <strong>Practice</strong> blends everything active here — no need to pick a song first.
          </p>
          <div className="cur-stat-strip" aria-label="Curriculum contents">
            <span className={counts.songs ? "is-lit" : ""}><strong>{counts.songs}</strong> song{counts.songs === 1 ? "" : "s"}</span>
            <span className={counts.custom ? "is-lit" : ""}><strong>{counts.custom}</strong> recorded exercise{counts.custom === 1 ? "" : "s"}</span>
            <span className={counts.scales ? "is-lit" : ""}><strong>{counts.scales}</strong> scale drill{counts.scales === 1 ? "" : "s"}</span>
            <span className={counts.foundations ? "is-lit" : ""}><strong>{counts.foundations}</strong> foundation{counts.foundations === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="cur-hero-actions">
          <button
            type="button"
            className="cur-btn is-primary"
            onClick={onPracticeCurriculum}
            disabled={counts.total === 0}
            title={counts.total ? `Practice everything in your curriculum (${summaryText})` : "Add at least one item to your curriculum first"}
          >
            <Glyph name="play" size={16} />
            <span>Practice curriculum</span>
          </button>
          <button type="button" className="cur-btn is-record" onClick={openNewRecorder}>
            <Glyph name="record" size={16} />
            <span>Record exercise</span>
          </button>
        </div>
      </header>

      {/* Section 1: Recorded / Custom Exercises */}
      <section className="cur-section" aria-labelledby="cur-custom-heading">
        <div className="cur-section-head">
          <div>
            <h3 id="cur-custom-heading">My recorded exercises</h3>
            <p>Loop your own scale-in-thirds shapes, patterns, and phrases — scored with tempo climbs and Leitner boxes.</p>
          </div>
          <button type="button" className="cur-btn" onClick={openNewRecorder}>
            <Glyph name="plus" size={15} />Record new
          </button>
        </div>

        {customExercises.length === 0 ? (
          <div className="cur-empty-box">
            <p>No custom exercises yet. Record your own scale in thirds, shape pattern, or lick on guitar and fix any note right on the score.</p>
            <button type="button" className="cur-btn is-record" onClick={openNewRecorder}>
              <Glyph name="record" size={15} />Record your first exercise
            </button>
          </div>
        ) : (
          <div className="cur-list" role="list" aria-label="Custom exercises">
            {customExercises.map((ex) => {
              const active = curriculum.customIds.includes(ex.id);
              const st = shared.cards[ex.id];
              const box = st?.box ?? 0;
              const bpm = st?.bestCleanBpm ?? st?.bpm ?? ex.bpm;
              const keyInfo = parseHubId(ex.hub);
              const pitched = ex.notes.filter((n) => n.midi !== null).length;
              const confirming = confirmDeleteId === ex.id;
              const transposing = transposeOpenId === ex.id;
              const sameModeHubs = HUB_OPTIONS.filter((o) => o.minor === Boolean(keyInfo?.minor) && o.hub !== ex.hub);

              return (
                <article key={ex.id} role="listitem" className={`cur-row ${active ? "is-in" : "is-out"}`}>
                  <div className="cur-row-main">
                    <span className="cur-badge is-key">{keyInfo?.shortName ?? "C"}</span>
                    <div className="cur-row-copy">
                      <strong>{ex.title}</strong>
                      <small>
                        {[
                          ex.shape ? `${ex.shape} shape` : null,
                          `frets ${ex.p}–${ex.p + 3}`,
                          `${pitched} notes`,
                          `♩${bpm} → ${ex.goalBpm}`,
                        ].filter(Boolean).join(" · ")}
                      </small>
                    </div>
                    <BoxDots box={box} />
                  </div>

                  <div className="cur-row-actions">
                    <button
                      type="button"
                      className={`cur-toggle ${active ? "is-on" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleCurriculumCustom(ex.id)}
                    >
                      <Glyph name={active ? "check" : "plus"} size={14} />
                      <span>{active ? "In curriculum" : "Add"}</span>
                    </button>
                    <button type="button" className="cur-chip" onClick={() => practiceCustom(ex)} title="Practice this exercise now">
                      <Glyph name="play" size={13} />Play
                    </button>
                    <button type="button" className="cur-chip" onClick={() => openEditRecorder(ex)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`cur-chip ${transposing ? "is-on" : ""}`}
                      aria-expanded={transposing}
                      onClick={() => setTransposeOpenId(transposing ? null : ex.id)}
                      title="Copy this exact shape into another key"
                    >
                      Copy to key
                    </button>
                    {confirming ? (
                      <span className="cur-confirm-inline">
                        <button type="button" className="cur-chip is-danger" onClick={() => handleDeleteExercise(ex.id)}>Delete</button>
                        <button type="button" className="cur-chip" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="cur-chip is-danger" onClick={() => setConfirmDeleteId(ex.id)} aria-label={`Delete ${ex.title}`}>
                        <Glyph name="close" size={13} />
                      </button>
                    )}
                  </div>

                  {transposing ? (
                    <div className="cur-transpose-tray" role="group" aria-label={`Copy ${ex.title} to another key`}>
                      <span>Copy shape to:</span>
                      {sameModeHubs.map((o) => (
                        <button key={o.hub} type="button" className="cur-chip" onClick={() => handleCopyToKey(ex, o.hub)}>
                          {o.short}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Songs in Library */}
      <section className="cur-section" aria-labelledby="cur-songs-heading">
        <div className="cur-section-head">
          <div>
            <h3 id="cur-songs-heading">Songs</h3>
            <p>Toggle which songs from your songbook are mixed into your daily curriculum.</p>
          </div>
          <div className="cur-section-btns">
            {songs.length > 0 ? (
              <button
                type="button"
                className="cur-chip"
                onClick={() => {
                  if (session.ids.length === songs.length) songs.forEach((s) => session.remove(s.tuneId));
                  else songs.forEach((s) => session.add(s.tuneId));
                }}
              >
                {session.ids.length === songs.length ? "Remove all songs" : "Add all songs"}
              </button>
            ) : null}
            <button type="button" className="cur-btn" onClick={onOpenLibrary}>
              <Glyph name="library" size={15} />Song library
            </button>
          </div>
        </div>

        {loading ? (
          <p className="cur-muted">Loading songbook…</p>
        ) : songs.length === 0 ? (
          <div className="cur-empty-box is-compact">
            <p>No songs in your library yet — you can practise purely with recorded exercises, scales &amp; foundations, or import a score anytime.</p>
          </div>
        ) : (
          <div className="cur-list" role="list" aria-label="Songs">
            {songs.map((song) => {
              const active = session.has(song.tuneId);
              const pct = Math.round(songFill(song) * 100);
              return (
                <article key={song.tuneId} role="listitem" className={`cur-row ${active ? "is-in" : "is-out"}`}>
                  <div className="cur-row-main">
                    <span className="cur-badge is-song">{song.key || "—"}</span>
                    <div className="cur-row-copy">
                      <strong>{song.title}</strong>
                      <small>{[song.composer || null, song.barCount ? `${song.barCount} bars` : null, `${pct}% grown`].filter(Boolean).join(" · ")}</small>
                    </div>
                    <span className="cur-meter" aria-label={`${pct}% mastered`}>
                      <i style={{ width: `${Math.max(pct, pct > 0 ? 6 : 0)}%` }} />
                    </span>
                  </div>
                  <div className="cur-row-actions">
                    <button
                      type="button"
                      className={`cur-toggle ${active ? "is-on" : ""}`}
                      aria-pressed={active}
                      onClick={() => session.toggle(song.tuneId)}
                    >
                      <Glyph name={active ? "check" : "plus"} size={14} />
                      <span>{active ? "In curriculum" : "Add"}</span>
                    </button>
                    <button type="button" className="cur-chip" onClick={() => onStartPractice(song.tuneId, undefined, false, { mixIds: [] })}>
                      <Glyph name="play" size={13} />Solo
                    </button>
                    <button type="button" className="cur-chip" onClick={() => onOpenSong(song.tuneId)}>
                      Score
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: Scales & Keys */}
      <section className="cur-section" aria-labelledby="cur-scales-heading">
        <div className="cur-section-head">
          <div>
            <h3 id="cur-scales-heading">Scales &amp; keys</h3>
            <p>Add specific key drills directly into your curriculum without needing a song in that key.</p>
          </div>
        </div>

        <div className="cur-scale-picker" role="group" aria-label="Add scale drill to curriculum">
          <label className="cur-inline-select">
            <span>Key</span>
            <select value={scaleHub} onChange={(e) => setScaleHub(e.target.value)} aria-label="Choose key for scale drills">
              {HUB_OPTIONS.map((o) => (
                <option key={o.hub} value={o.hub}>{o.label}</option>
              ))}
            </select>
          </label>
          <div className="cur-scale-chips">
            {scaleChoices.map((choice) => {
              const active = curriculum.scaleIds.includes(choice.id);
              return (
                <button
                  key={choice.id}
                  type="button"
                  className={`cur-toggle ${active ? "is-on" : ""}`}
                  aria-pressed={active}
                  onClick={() => (active ? toggleCurriculumScale(choice.id) : addCurriculumScale(choice.id))}
                >
                  <Glyph name={active ? "check" : "plus"} size={13} />
                  <span>{choice.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {curriculum.scaleIds.length > 0 ? (
          <div className="cur-list" role="list" aria-label="Active scale drills">
            {curriculum.scaleIds.map((scaleId) => {
              const info = labelForScaleCardId(scaleId);
              const st = shared.cards[scaleId];
              const box = st?.box ?? 0;
              const bpm = st?.bestCleanBpm ?? st?.bpm ?? null;
              return (
                <article key={scaleId} role="listitem" className="cur-row is-in">
                  <div className="cur-row-main">
                    <span className="cur-badge is-scale">{info.key.split(" ")[0] || "Scale"}</span>
                    <div className="cur-row-copy">
                      <strong>{info.key} · {info.drill}</strong>
                      <small>{bpm ? `♩${bpm}` : "Ready in your chosen CAGED / default shape"}</small>
                    </div>
                    <BoxDots box={box} />
                  </div>
                  <div className="cur-row-actions">
                    <button type="button" className="cur-chip" onClick={() => practiceScale(scaleId)}>
                      <Glyph name="play" size={13} />Play
                    </button>
                    <button type="button" className="cur-chip is-danger" onClick={() => toggleCurriculumScale(scaleId)}>
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="cur-muted">No standalone scale drills added yet — pick a key and click any drill above to add it.</p>
        )}
      </section>

      {/* Section 4: Foundations & Technique */}
      <section className="cur-section" aria-labelledby="cur-foundations-heading">
        <div className="cur-section-head">
          <div>
            <h3 id="cur-foundations-heading">Foundations &amp; technique</h3>
            <p>Include specific mechanics drills (spiders, string skipping, rhythm pyramid, shifting, enclosures) in your curriculum.</p>
          </div>
        </div>

        <div className="cur-found-groups">
          {GROUP_ORDER.map((group) => {
            const tracks = TECHNIQUE_TRACKS.filter((t) => t.group === group);
            return (
              <div key={group} className="cur-found-group">
                <h4>{FOUNDATION_GROUPS[group].label} <small>· {FOUNDATION_GROUPS[group].trains}</small></h4>
                <div className="cur-found-grid">
                  {tracks.map((track) => {
                    const active = curriculum.foundationIds.includes(track.id);
                    const st = shared.cards[track.id];
                    const box = st?.box ?? 0;
                    const bpm = st?.bestCleanBpm ?? st?.bpm ?? track.bpm;
                    return (
                      <div key={track.id} className={`cur-found-card ${active ? "is-in" : ""}`} data-family={track.group}>
                        <div className="cur-found-top">
                          <strong>{track.short}</strong>
                          <BoxDots box={box} />
                        </div>
                        <small>♩{bpm} → {track.goalBpm}</small>
                        <div className="cur-found-actions">
                          <button
                            type="button"
                            className={`cur-toggle ${active ? "is-on" : ""}`}
                            aria-pressed={active}
                            onClick={() => toggleCurriculumFoundation(track.id)}
                          >
                            <Glyph name={active ? "check" : "plus"} size={13} />
                            <span>{active ? "In curriculum" : "Add"}</span>
                          </button>
                          <button type="button" className="cur-chip" onClick={() => practiceFoundation(track.id, track.hub)}>
                            <Glyph name="play" size={12} />Play
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Standalone trainers quick bar */}
      <section className="cur-trainers" aria-label="Standalone trainers">
        <span>Standalone drills:</span>
        <button type="button" className="cur-chip" onClick={() => onOpenMode("triads")}>
          <Glyph name="chords" size={13} />Triads trainer
        </button>
        <button type="button" className="cur-chip" onClick={() => onOpenMode("ear")}>
          <Glyph name="ear" size={13} />Ear training
        </button>
      </section>
    </main>
  );
}

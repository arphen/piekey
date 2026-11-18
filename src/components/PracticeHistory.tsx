import { useId, useMemo, useState } from "react";
import { FAMILY_LABEL, type Deck } from "../song/deck";
import { arrangementIdentity } from "../song/goals";
import type { Attempt, AttemptConditions } from "../song/leitner";
import type { ExerciseHistory, PracticeTempoPoint } from "../song/practiceHistory";
import { familyOf } from "../song/stats";
import { usePracticeHistory } from "../song/usePracticeHistory";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline, type Timeline } from "../tunes/order";
import { parsePassageId, passageLabel } from "../tunes/passage";

type Music = Readonly<{ sheet: LeadSheet; deck: Deck }>;
const PLOT_SIZE = 200;
const PAGE_SIZE = 12;
const RESULT = { clean: "Recorded clean", ok: "Completed", fail: "Not passed", skip: "Skipped" };
const ARCHIVE_UNKNOWN = {
  unavailable: "The practice archive could not be read. History completeness is unknown.",
  "too-large": "The practice archive exceeds the current reading limit. History completeness is unknown.",
  conflicted: "Some practice records conflict. History completeness is unknown.",
};

function dated(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function help(c?: AttemptConditions): string {
  if (!c) return "Audio and visual help unknown";
  return [c.support === "none" ? "no audio guide" : c.support === "guide" ? "guide melody" : c.support === "adaptive" ? "adaptive audio help" : "audio help unknown",
    c.notation === "hidden" ? "notes hidden" : c.notation === "visible" ? "score shown" : c.notation === "faded" ? "score faded or revealed" : "visual help unknown"].join(" · ");
}

function conditions(c?: AttemptConditions): string {
  if (!c) return "Tempo policy, exposure, continuity and detector confidence unknown";
  return [c.tempo === "fixed" ? "fixed tempo" : c.tempo === "adaptive" ? "adaptive tempo" : c.tempo === "own-pace" ? "own pace" : "tempo policy unknown",
    c.exposure === "first" ? "first exposure in visit" : c.exposure === "repeated" ? "repeated exposure" : "exposure unknown",
    c.uninterrupted === true ? "uninterrupted" : c.uninterrupted === false ? "interrupted or repeated" : "continuity unknown",
    `detector confidence ${c.confidence}`].join(" · ");
}

function tempoLabel(attempt: Attempt): string {
  if (!Number.isFinite(attempt.bpm) || attempt.bpm <= 0) return "Tempo unknown";
  if (attempt.conditions?.source === "self" || attempt.conditions?.tempo === "own-pace") return `${attempt.bpm} bpm reference`;
  return `${attempt.bpm} bpm${!attempt.conditions?.tempo ? " · basis unknown" : ""}`;
}

function exerciseLabel(exercise: ExerciseHistory, music: Music | undefined, tl: Timeline | undefined, currentVersion: string | undefined, index: number): string {
  const passage = parsePassageId(exercise.cardId);
  if (passage) return passage.fingerprint === currentVersion && music && tl
    ? passageLabel(music.sheet, tl, passage)
    : `Selected passage · playing order ${passage.start + 1}${passage.end === passage.start ? "" : `–${passage.end + 1}`} · earlier arrangement`;
  const card = music?.deck.cards.find((candidate) => candidate.id === exercise.cardId);
  if (card) return card.title;
  const range = /^mel:(?:new|review|join|section|memory|tune):(\d+)-(\d+)$/.exec(exercise.cardId);
  return `Earlier ${FAMILY_LABEL[familyOf(exercise.cardId)].toLowerCase()} exercise${range ? ` · playing order ${Number(range[1]) + 1}–${Number(range[2]) + 1}` : ` ${index + 1}`}`;
}

/** Available archived observations, separate from the planner's recent display store. */
export function PracticeHistory({ tuneId, music }: { tuneId: string; music?: Music }) {
  const { result, retry } = usePracticeHistory(tuneId);
  const titleId = useId();
  return <section className="tutor-section progress-history" aria-labelledby={titleId}>
    <div className="tutor-section-head"><h3 id={titleId}>Exercise history</h3></div>
    <p className="progress-caption">Available archived attempts for this tune, including records beyond the recent practice summary. Shared scale work across tunes is not included.</p>
    {result.status === "checking" ? <p className="progress-empty" role="status">Reading the practice archive…</p>
      : result.status !== "ready" ? <div className="progress-history-status"><p role="status">{ARCHIVE_UNKNOWN[result.status]}</p><button type="button" className="tutor-link" onClick={retry}>Retry history</button></div>
        : !result.exercises.length ? <p className="progress-empty">No tune-specific attempts are available in this archive yet.</p>
          : <ArchivedExercises key={tuneId} exercises={result.exercises} music={music} />}
  </section>;
}

function ArchivedExercises({ exercises, music }: { exercises: ExerciseHistory[]; music?: Music }) {
  const [selected, setSelected] = useState(() => {
    const candidates = exercises.some((exercise) => exercise.tempo.length) ? exercises.filter((exercise) => exercise.tempo.length) : exercises;
    return [...candidates].sort((a, b) => {
      const lastDay = (exercise: ExerciseHistory) => [...exercise.attempts].reverse().find((attempt) => dated(attempt.day))?.day ?? "";
      return lastDay(b).localeCompare(lastDay(a));
    })[0]?.cardId ?? "";
  });
  const tl = useMemo(() => music ? buildTimeline(music.sheet) : undefined, [music]);
  const currentVersion = useMemo(() => music ? arrangementIdentity(music.sheet).fingerprint : undefined, [music]);
  const exercise = exercises.find((entry) => entry.cardId === selected) ?? exercises[0];
  const labels = useMemo(() => new Map(exercises.map((entry, index) => [entry.cardId, exerciseLabel(entry, music, tl, currentVersion, index)])), [exercises, music, tl, currentVersion]);
  return <>
    <label className="progress-history-choice">Exercise<select value={exercise.cardId} onChange={(event) => setSelected(event.target.value)}>
      {exercises.map((entry) => <option key={entry.cardId} value={entry.cardId}>{labels.get(entry.cardId)} · {entry.attempts.length} attempts</option>)}
    </select></label>
    <ExerciseObservations key={exercise.cardId} exercise={exercise} label={labels.get(exercise.cardId) ?? "Exercise"} currentVersion={currentVersion} />
  </>;
}

function ExerciseObservations({ exercise, label, currentVersion }: { exercise: ExerciseHistory; label: string; currentVersion?: string }) {
  const [filter, setFilter] = useState("all");
  const [plotPage, setPlotPage] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [logPage, setLogPage] = useState(0);
  const logId = useId();
  const versions = useMemo(() => {
    const labels = new Map<string, string>();
    let earlier = 0;
    for (const attempt of exercise.attempts) if (attempt.arrangementFingerprint && !labels.has(attempt.arrangementFingerprint))
      labels.set(attempt.arrangementFingerprint, attempt.arrangementFingerprint === currentVersion ? "Current score" : `${currentVersion ? "Earlier" : "Saved"} score ${++earlier}`);
    return labels;
  }, [exercise, currentVersion]);
  const versionOf = (attempt: Attempt) => attempt.arrangementFingerprint ? versions.get(attempt.arrangementFingerprint) ?? "Saved score" : "Score version unknown";
  const groups = useMemo(() => {
    const entries = new Map<string, PracticeTempoPoint[]>();
    for (const point of exercise.tempo) {
      const key = point.comparisonKey ?? "unknown";
      const group = entries.get(key);
      if (group) group.push(point);
      else entries.set(key, [point]);
    }
    return entries;
  }, [exercise]);
  const activeFilter = filter === "all" || groups.has(filter) ? filter : "all";
  const points = activeFilter === "all" ? exercise.tempo : groups.get(activeFilter) ?? [];
  const plottedPage = Math.min(plotPage, Math.max(0, Math.ceil(points.length / PLOT_SIZE) - 1));
  const plotEnd = Math.max(0, points.length - plottedPage * PLOT_SIZE);
  const plotStart = Math.max(0, plotEnd - PLOT_SIZE);
  const plotted = points.slice(plotStart, plotEnd);
  const newest = useMemo(() => [...exercise.attempts.filter((attempt) => dated(attempt.day))].reverse().concat(exercise.attempts.filter((attempt) => !dated(attempt.day))), [exercise]);
  const tablePage = Math.min(logPage, Math.max(0, Math.ceil(newest.length / PAGE_SIZE) - 1));
  const pageStart = tablePage * PAGE_SIZE;
  const page = newest.slice(pageStart, pageStart + PAGE_SIZE);
  const groupSample = activeFilter !== "all" ? points[0]?.attempt : undefined;
  return <div className="progress-history-observations">
    <p className="progress-history-counts"><span>{exercise.measured.length} mic checked</span><span>{exercise.selfGuided.length} self-guided</span><span>{exercise.unknown.length} assessment unknown</span>{exercise.skipped.length ? <span>{exercise.skipped.length} skipped</span> : null}</p>
    {exercise.tempo.length ? <>
      <label className="progress-history-choice">Performance conditions<select value={activeFilter} onChange={(event) => { setFilter(event.target.value); setPlotPage(0); }}>
        <option value="all">All qualifying observations · separate points</option>
        {[...groups].map(([key, entries], index) => <option key={key} value={key}>{key === "unknown" ? "Some conditions unknown" : `Set ${index + 1} · ${versionOf(entries[0].attempt)} · ${help(entries[0].attempt.conditions)}`} · {entries.length} passes</option>)}
      </select></label>
      <p className="progress-caption">{groupSample ? `${versionOf(groupSample)} · ${help(groupSample.conditions)} · ${conditions(groupSample.conditions)}` : "Help and score versions can differ. Each point stands on its own."}</p>
      <TempoPlot points={plotted} label={label} versionOf={versionOf} />
      <div className="progress-history-paging"><span>Showing {plotStart + 1}–{plotEnd} of {points.length} clean timed observations</span>{points.length > PLOT_SIZE ? <div><button type="button" disabled={plotStart === 0} onClick={() => setPlotPage((value) => value + 1)}>Earlier observations</button><button type="button" disabled={plottedPage === 0} onClick={() => setPlotPage((value) => value - 1)}>Later observations</button></div> : null}</div>
    </> : <p className="progress-empty">No dated, mic-checked clean timed passes are recorded for this exercise. Self-guided, own-pace and older observations remain in the attempt log.</p>}
    <p className="progress-caption">Tempo dots require a recorded clean microphone assessment and timing samples at fixed or adaptive tempo. Reference tempos and unknown assessment types are excluded. These observations describe this task under its recorded conditions.</p>
    <button type="button" className="tutor-link progress-history-log-toggle" aria-expanded={logOpen} aria-controls={logId} onClick={() => setLogOpen((value) => !value)}>{logOpen ? "Hide" : "Show"} attempt log · {exercise.attempts.length}</button>
    {logOpen ? <div id={logId} className="progress-history-log">
      <table className="progress-history-table">
        <caption>All available attempts for this exercise, newest dated first; undated records last. The chart filter does not hide log entries.</caption>
        <thead><tr><th scope="col">Attempt</th><th scope="col">Tempo</th><th scope="col">Assessment and help</th><th scope="col">Score version</th><th scope="col">Timing</th></tr></thead>
        <tbody>{page.map((attempt, index) => <tr key={attempt.uid ?? `${pageStart + index}`}>
          <td><span className="progress-history-cell-label" aria-hidden="true">Attempt</span><strong>{dated(attempt.day) ? <time dateTime={attempt.day}>{attempt.day}</time> : "Date unknown"}</strong><small>{attempt.conditions?.source === "self" ? "Self-guided activity" : RESULT[attempt.result]}</small></td>
          <td><span className="progress-history-cell-label" aria-hidden="true">Tempo</span>{tempoLabel(attempt)}{attempt.conditions?.tempo === "own-pace" ? <small>{familyOf(attempt.id) === "ear" ? "Call tempo; response at own pace" : "Own pace; no timed-speed proof"}</small> : attempt.conditions?.source === "self" ? <small>Practice setting; unscored</small> : null}</td>
          <td><span className="progress-history-cell-label" aria-hidden="true">Assessment and help</span><strong>{attempt.conditions?.source === "measured" ? "Mic checked" : attempt.conditions?.source === "self" ? "Self-guided · unscored" : "Assessment unknown"}</strong><small>{help(attempt.conditions)}</small><small>{conditions(attempt.conditions)}</small></td>
          <td><span className="progress-history-cell-label" aria-hidden="true">Score version</span>{versionOf(attempt)}</td>
          <td><span className="progress-history-cell-label" aria-hidden="true">Timing</span>{attempt.conditions?.source === "self" ? "Unscored" : attempt.ev?.time?.n ? <>{attempt.ev.time.n} onsets<small>±{attempt.ev.time.spread} ms spread · {attempt.ev.time.mean >= 0 ? "+" : ""}{attempt.ev.time.mean} ms alignment</small><small>{attempt.timingMeasured === true ? "Latency check recorded" : attempt.timingMeasured === false ? "Estimated latency correction" : "Latency provenance unknown"}</small></> : "No onset timing recorded"}</td>
        </tr>)}</tbody>
      </table>
      <div className="progress-history-paging"><span>{pageStart + 1}–{pageStart + page.length} of {newest.length} attempts</span>{newest.length > PAGE_SIZE ? <div><button type="button" disabled={tablePage === 0} onClick={() => setLogPage((value) => value - 1)}>Previous page</button><button type="button" disabled={pageStart + PAGE_SIZE >= newest.length} onClick={() => setLogPage((value) => value + 1)}>Next page</button></div> : null}</div>
    </div> : null}
  </div>;
}

function TempoPlot({ points, label, versionOf }: { points: PracticeTempoPoint[]; label: string; versionOf(attempt: Attempt): string }) {
  const titleId = useId();
  const descriptionId = useId();
  if (!points.length) return null;
  const xs = points.map((point) => Date.parse(`${point.day}T00:00:00Z`));
  const first = Math.min(...xs);
  const last = Math.max(...xs);
  const low = Math.max(0, Math.floor((Math.min(...points.map((point) => point.bpm)) - 4) / 10) * 10);
  const high = Math.ceil((Math.max(...points.map((point) => point.bpm)) + 4) / 10) * 10;
  const x = (stamp: number) => first === last ? 338 : 52 + (stamp - first) / (last - first) * 566;
  const y = (bpm: number) => 174 - (bpm - low) / (high - low) * 148;
  return <figure className="progress-history-plot">
    <svg viewBox="0 0 640 220" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>{label}: dated clean timed observations</title>
      <desc id={descriptionId}>{points.length} observations from {points[0].day} to {points[points.length - 1].day}, between {Math.min(...points.map((point) => point.bpm))} and {Math.max(...points.map((point) => point.bpm))} bpm. Conditions may differ. Exact attempts and assistance are available in the attempt log.</desc>
      <text x="10" y="14" className="progress-history-axis-unit">BPM</text>
      {[low, (low + high) / 2, high].map((bpm) => <g key={bpm} className="progress-history-grid"><line x1="52" x2="618" y1={y(bpm)} y2={y(bpm)} /><text x="40" y={y(bpm) + 4} textAnchor="end">{bpm}</text></g>)}
      {points.map((point, index) => <circle key={point.attempt.uid ?? index} cx={x(xs[index])} cy={y(point.bpm)} r="4" className={point.comparisonKey ? "progress-history-point" : "progress-history-point is-unknown"}><title>{point.day} · {point.bpm} bpm · {versionOf(point.attempt)} · {help(point.attempt.conditions)} · {conditions(point.attempt.conditions)}</title></circle>)}
      <text x={first === last ? 338 : 52} y="202" textAnchor={first === last ? "middle" : "start"} className="progress-history-date">{points[0].day}</text>
      {first !== last ? <text x="618" y="202" textAnchor="end" className="progress-history-date">{points[points.length - 1].day}</text> : null}
    </svg>
    <figcaption><span><i />Recorded conditions</span><span><i className="is-unknown" />Some conditions unknown</span></figcaption>
  </figure>;
}

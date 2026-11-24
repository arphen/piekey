import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { listTakes, takeAudio, type TakeMeta } from "../audio/recorder";
import { latencyMeasured } from "../audio/latency";
import { useTakePlayback } from "../audio/useTakePlayback";
import { allStores, BOXES, loadStore, today } from "../song/leitner";
import type { AttemptConditions } from "../song/leitner";
import { AXES, type Axis, type SkillProfile } from "../song/profile";
import { buildPracticeDashboard, explainScheduling, type DailyPracticeCell, type PracticeDashboard, type SchedulerExplanation } from "../overview/dashboard";
import { cachedSong, useSongSummaries } from "../overview/useSongSummaries";
import { relativeDay } from "../overview/visual";
import { songFill } from "../overview/map";
import { wholeTuneCard } from "../song/deck";
import { Glyph } from "./Glyph";
import { GoalChooser } from "./GoalChooser";
import { PracticeHistory } from "./PracticeHistory";
import "../overview/overview.css";
import "../overview/progress.css";

const AXIS_LABEL: Record<Axis, string> = {
  pitch: "First-try notes",
  time: "Timing steadiness",
  tempo: "Clean scale speed",
  chords: "Chord accuracy",
  reading: "Sight reading",
  ear: "Playing by ear",
};
const AXIS_SHORT: Record<Axis, string> = {
  pitch: "Pitch",
  time: "Time",
  tempo: "Speed",
  chords: "Chords",
  reading: "Read",
  ear: "Ear",
};
const BOX_NAMES = ["Box 1 · New", "Box 2 · Settling", "Box 3 · Growing", "Box 4 · Solid", "Box 5 · Mastered"];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const conditionLabel = (conditions?: AttemptConditions): string => conditions ? [
  conditions.source === "self" ? "Self-guided" : "Mic checked",
  conditions.tempo === "fixed" ? "fixed tempo" : conditions.tempo === "adaptive" ? "adaptive tempo" : conditions.tempo === "own-pace" ? "own pace" : "tempo unknown",
  conditions.support === "guide" ? "guide melody" : conditions.support === "adaptive" ? "adaptive support" : conditions.support === "none" ? "no audio guide" : "support unknown",
  conditions.notation === "visible" ? "score shown" : conditions.notation === "hidden" ? "score hidden" : conditions.notation === "faded" ? "score fades" : "visual help unknown",
  `detector confidence ${conditions.confidence}`,
].join(" · ") : "Assistance and assessment conditions unknown";

/** Each player owns its object URL and releases it when the selection changes. */
function TakePlayer({ take, tuneId, caption, day, playback }: { take: TakeMeta; tuneId: string; caption: string; day: string; playback: ReturnType<typeof useTakePlayback> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [extension, setExtension] = useState("webm");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const { release } = playback;
  useEffect(() => {
    let disposed = false;
    let owned: string | null = null;
    setUrl(null);
    setError(false);
    void takeAudio(tuneId, take.id).then((blob) => {
      if (disposed) return;
      if (!blob) { setError(true); return; }
      setExtension(blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "webm");
      owned = URL.createObjectURL(blob);
      setUrl(owned);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; if (owned) { release(owned); URL.revokeObjectURL(owned); } };
  }, [take.id, tuneId, retry, release]);
  const active = playback.id === take.id;
  const playing = active && (playback.phase === "playing" || playback.phase === "starting");
  const position = active ? playback.position : 0;
  const duration = active ? playback.duration : null;
  return <figure className="progress-take">
    <figcaption><strong>{caption}</strong><span>{relativeDay(take.day, day)} · ♩ {take.bpm}</span></figcaption>
    {url ? <div className="progress-audio" role="group" aria-label={`${caption} recording controls`}>
      <div className="progress-audio-actions">
        <button type="button" className="progress-audio-play" aria-label={`${playing ? "Pause" : "Play"} ${caption.toLowerCase()} recording`} onClick={() => playing ? playback.pause() : void playback.play(take.id, url)}>{playing ? <span className="progress-audio-pause" aria-hidden="true" /> : <Glyph name="play" size={16} />}{playing ? "Pause" : "Play"}</button>
        <button type="button" aria-label={`Restart ${caption.toLowerCase()} recording`} onClick={() => void playback.play(take.id, url, true)}>Restart</button>
        <button type="button" aria-label={`${caption}: back 10 seconds`} disabled={!active || position <= 0} onClick={() => playback.seek(-10)}>−10 s</button>
        <button type="button" aria-label={`${caption}: forward 10 seconds`} disabled={!active || !playback.seekEnd || position >= playback.seekEnd} onClick={() => playback.seek(10)}>+10 s</button>
      </div>
      <div className="progress-audio-position"><progress aria-label={`${caption} recording progress`} max={duration ?? 1} value={duration ? position : 0} /><output aria-label={`${caption} playback position`}>{clock(position)} / {duration ? clock(duration) : "—"}</output></div>
      {active && playback.error ? <p role="alert">{playback.error}</p> : null}
    </div> : <p role="status">{error ? "This recording could not be read." : "Loading recording…"}</p>}
    {error ? <button type="button" className="tutor-link" onClick={() => setRetry((value) => value + 1)}>Retry audio</button> : null}
    <p className="progress-caption">{conditionLabel(take.conditions)}</p>
    {url ? <a className="tutor-link" href={url} download={`guitar-take-${take.day}-${take.id.replace(/[^a-zA-Z0-9-]/g, "_")}.${extension}`}><Glyph name="download" size={14} />Save audio</a> : null}
  </figure>;
}

/** Compare the same stored task. The original tempo and audio are preserved. */
function Takes({ tuneId, day }: { tuneId: string; day: string }) {
  const playback = useTakePlayback();
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [selected, setSelected] = useState<[string, string]>(["", ""]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    setTakes([]);
    setError(false);
    setLoading(true);
    void listTakes(tuneId).then((rows) => {
      if (disposed) return;
      setTakes(rows);
      const latest = rows[rows.length - 1];
      const first = rows.find((row) => row.cardId === latest?.cardId);
      setSelected([first?.id ?? "", latest?.id ?? ""]);
    }).catch(() => { if (!disposed) setError(true); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [tuneId, retry]);
  if (loading) return <p className="progress-empty" role="status">Loading saved recordings…</p>;
  if (error) return <div className="progress-empty"><p role="alert">Recordings could not be opened. Your saved files have not been changed.</p><button type="button" className="tutor-link" onClick={() => setRetry((value) => value + 1)}>Retry recordings</button></div>;
  if (!takes.length) return <p className="progress-empty">A completed run-through can keep a recording here.</p>;
  const first = takes.find((take) => take.id === selected[0]);
  const latest = takes.find((take) => take.id === selected[1]);
  const sameTask = first?.cardId === latest?.cardId;
  const arrangementKnown = Boolean(first?.arrangementFingerprint && latest?.arrangementFingerprint);
  const sameArrangement = arrangementKnown && first?.arrangementFingerprint === latest?.arrangementFingerprint;
  return <div className="progress-comparison">
    <div className="progress-take-choices">
      {([0, 1] as const).map((side) => <label key={side}>{side ? "Compare with" : "Reference"}<select value={selected[side]} onChange={(event) => { playback.stop(); setSelected((current) => side ? [current[0], event.target.value] : [event.target.value, current[1]]); }}>
        {takes.map((take, index) => <option key={take.id} value={take.id}>{index === 0 ? "First" : `Take ${index + 1}`} · {take.day} · {take.bpm} bpm</option>)}
      </select></label>)}
    </div>
    <div className="progress-take-pair">
      {first ? <TakePlayer key={`reference:${first.id}`} take={first} tuneId={tuneId} caption="Reference" day={day} playback={playback} /> : null}
      {latest && latest.id !== first?.id ? <TakePlayer key={`comparison:${latest.id}`} take={latest} tuneId={tuneId} caption="Comparison" day={day} playback={playback} /> : null}
    </div>
    <p className="progress-caption">{!sameTask ? "These recordings cover different tasks. " : ""}{first?.bpm !== latest?.bpm ? "Different tempos. " : ""}{arrangementKnown ? sameArrangement ? "Same score version. " : "Different score versions. " : "Score version unknown for an older take. "}Compare the tempo and help shown with each recording.</p>
    <p className="progress-caption">Guitar controls work here too. Use headphones so a recording stays out of the navigation microphone.</p>
    <p className="progress-caption">The first take and ten most recent are kept on this browser. A full .fretpack export includes audio.</p>
  </div>;
}

/** 12-week bioluminescent practice heatmap (84 days, 12 weeks × 7 days). */
function PracticeHeatmap({ cells, weekly }: { cells: DailyPracticeCell[]; weekly: number[] }) {
  const weeks = useMemo(() => {
    const cols: DailyPracticeCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
    return cols;
  }, [cells]);
  const maxWeek = Math.max(1, ...weekly);
  return (
    <div className="pr-heatmap-wrap">
      <div className="pr-heatmap" role="img" aria-label={`Practice activity over the last 12 weeks: ${cells.filter((c) => c.intensity > 0).length} active days`}>
        {weeks.map((col, wi) => (
          <div key={wi} className="pr-hm-col">
            {col.map((cell) => (
              <span
                key={cell.day}
                className={`pr-hm-cell lvl-${cell.intensity}`}
                title={`${cell.day}: ${cell.minutes ? `${cell.minutes} min` : "Rest day"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="pr-week-bars" aria-label="Minutes per week, last 12 weeks">
        {weekly.map((m, i) => (
          <span key={i} className="pr-week-bar" title={`Week ${i + 1}: ${m} min`}>
            <i style={{ height: `${Math.max(m > 0 ? 12 : 4, (m / maxWeek) * 100)}%` }} className={i === weekly.length - 1 ? "is-now" : ""} />
          </span>
        ))}
      </div>
      <div className="pr-hm-legend">
        <span>12 weeks ago</span>
        <div className="pr-hm-scale" aria-hidden="true">
          <small>Less</small>
          <i className="lvl-0" /><i className="lvl-1" /><i className="lvl-2" /><i className="lvl-3" /><i className="lvl-4" />
          <small>More</small>
        </div>
        <span>Today</span>
      </div>
    </div>
  );
}

/** Glowing hexagonal SVG skill radar over abyssal concentric webs. */
function SkillRadar({ profile }: { profile: SkillProfile }) {
  const cx = 110;
  const cy = 110;
  const r = 74;
  const point = (index: number, share: number): [number, number] => {
    const angle = -Math.PI / 2 + (index / AXES.length) * Math.PI * 2;
    return [cx + Math.cos(angle) * r * share, cy + Math.sin(angle) * r * share];
  };
  const ring = (share: number) =>
    AXES.map((_, i) => point(i, share).map((n) => n.toFixed(1)).join(",")).join(" ");
  const hasAny = AXES.some((a) => profile.axes[a].n > 0);
  const poly = AXES.map((a, i) => {
    const val = profile.axes[a].n > 0 ? Math.max(0.14, profile.axes[a].level) : 0.08;
    return point(i, val).map((n) => n.toFixed(1)).join(",");
  }).join(" ");

  return (
    <svg viewBox="0 0 220 220" className="pr-radar-svg" role="img" aria-label="Six-axis skill profile radar">
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <polygon key={s} points={ring(s)} className="pr-radar-ring" />
      ))}
      {AXES.map((a, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = point(i, 1.24);
        const has = profile.axes[a].n > 0;
        return (
          <g key={a}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="pr-radar-spoke" />
            <text x={lx} y={ly + 3} textAnchor="middle" className={`pr-radar-label ${has ? "is-active" : ""}`}>
              {AXIS_SHORT[a]}
            </text>
          </g>
        );
      })}
      {hasAny ? (
        <>
          <polygon points={poly} className="pr-radar-area" />
          {AXES.map((a, i) => {
            const xAxis = profile.axes[a];
            if (!xAxis.n) return null;
            const [px, py] = point(i, Math.max(0.14, xAxis.level));
            return <circle key={a} cx={px} cy={py} r="3.6" className="pr-radar-dot" />;
          })}
        </>
      ) : null}
    </svg>
  );
}

/** Transparent explanation of why the app schedules your next session & what friction it sees. */
function SchedulerDiagnostics({
  insight,
  tuneTitle,
  tuneId,
  onDrill,
}: {
  insight: SchedulerExplanation;
  tuneTitle: string;
  tuneId: string;
  onDrill(tuneId: string, cardId?: string): void;
}) {
  return (
    <section className="pr-card pr-diagnostics" aria-labelledby="pr-diag-title">
      <div className="pr-card-head">
        <div>
          <p className="pr-kicker">Scheduler intelligence</p>
          <h3 id="pr-diag-title">Why your sessions look like this</h3>
        </div>
        <span className="pr-tune-chip">{tuneTitle}</span>
      </div>

      <div className="pr-diag-grid">
        {/* Column 1: How the planner shapes your next session */}
        <div className="pr-diag-col">
          <div className={`pr-driver-box is-${insight.focusKind}`}>
            <div className="pr-driver-top">
              <span className="pr-driver-tag">
                {insight.focusKind === "weakness-arc"
                  ? "Active Focus Arc"
                  : insight.focusKind === "run-bars"
                    ? "Run-Through Repair"
                    : insight.focusKind === "goal"
                      ? "Goal Priority"
                      : insight.focusKind === "neglected"
                        ? "Skill Refresh"
                        : "Balanced Review"}
              </span>
              {insight.arcDay ? (
                <span className="pr-arc-day">Day {insight.arcDay} / {insight.arcMaxDays}</span>
              ) : null}
            </div>
            <h4>{insight.focusHeadline}</h4>
            <p>{insight.focusReason}</p>
            {insight.arcDay ? (
              <div className="pr-arc-bar" aria-hidden="true">
                <i style={{ width: `${(insight.arcDay / insight.arcMaxDays) * 100}%` }} />
              </div>
            ) : null}
          </div>

          <div className="pr-pacing-box">
            <div className="pr-driver-top">
              <span className="pr-driver-tag">New-Card Pacing</span>
              <span className={`pr-pace-badge is-${insight.pacingZone}`}>{insight.pacingLabel}</span>
            </div>
            <p>{insight.pacingReason}</p>
            <div className="pr-zone-meter" aria-label={insight.recentCleanPct !== null ? `Recent clean rate ${insight.recentCleanPct}%` : "Collecting baseline attempts"}>
              <span className="pr-zone-seg is-low" title="<60%: Consolidating (0 new)" />
              <span className="pr-zone-seg is-mid" title="60–85%: Steady" />
              <span className="pr-zone-seg is-high" title=">85%: Cruising (+2 new)" />
              {insight.recentCleanPct !== null ? (
                <i className="pr-zone-pin" style={{ left: `${Math.max(2, Math.min(98, insight.recentCleanPct))}%` }} />
              ) : null}
            </div>
            <div className="pr-zone-labels">
              <span>0% Pause new</span>
              <span>60%</span>
              <span>85%</span>
              <span>+2 extra</span>
            </div>
          </div>

          {insight.sideStudyReason ? (
            <div className="pr-side-note">
              <Glyph name="spark" size={14} />
              <span><strong>Side study woven in:</strong> {insight.sideStudyReason}</span>
            </div>
          ) : null}

          {insight.blocks.length ? (
            <div className="pr-blueprint">
              <div className="pr-blueprint-head">
                <span>Next ~{insight.totalMinutes} min session blueprint</span>
                <button type="button" className="pr-text-btn" onClick={() => onDrill(tuneId)}>
                  Launch session <Glyph name="arrow" size={13} />
                </button>
              </div>
              <div className="pr-block-strip" aria-hidden="true">
                {insight.blocks.map((block) => (
                  <span
                    key={block.role}
                    className={`pr-block-seg role-${block.role}`}
                    style={{ flexGrow: Math.max(1, block.minutes) }}
                    title={`${block.label}: ~${block.minutes} min`}
                  />
                ))}
              </div>
              <ul className="pr-block-list">
                {insight.blocks.map((block) => (
                  <li key={block.role} className={`role-${block.role}`}>
                    <div className="pr-block-meta">
                      <b>{block.label}</b>
                      <small>~{block.minutes}m</small>
                    </div>
                    <div className="pr-block-cards">
                      {block.cards.slice(0, 4).map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          className="pr-card-chip"
                          onClick={() => onDrill(tuneId, card.id)}
                          title={`Practise ${card.title}`}
                        >
                          <span>{card.title}</span>
                          {card.box > 0 ? <small>B{card.box}</small> : <small>New</small>}
                        </button>
                      ))}
                      {block.cards.length > 4 ? <span className="pr-more-chip">+{block.cards.length - 4}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Column 2: Weaknesses & Friction Radar */}
        <div className="pr-diag-col">
          <div className="pr-weak-header">
            <span className="pr-driver-tag">Detected Friction Points</span>
            <small>Rolling 60-day detector evidence</small>
          </div>
          {insight.diagnoses.length ? (
            <ul className="pr-weak-list">
              {insight.diagnoses.map((w) => (
                <li key={w.cls} className={`pr-weak-item ${w.isActiveArc ? "is-active" : ""}`}>
                  <div className="pr-weak-top">
                    <div>
                      <strong>{w.title}</strong>
                      <span className="pr-weak-fact">{w.fact}</span>
                    </div>
                    {w.isActiveArc ? <span className="pr-active-pill">Active arc</span> : null}
                  </div>
                  <div className="pr-weak-meter" aria-hidden="true">
                    <i style={{ width: `${Math.max(12, Math.round(w.strength * 100))}%` }} />
                  </div>
                  <p>{w.explanation}</p>
                  <div className="pr-weak-foot">
                    <small>{w.samples} observations</small>
                    {w.drillTuneId && w.drillCardId ? (
                      <button
                        type="button"
                        className="pr-drill-btn"
                        onClick={() => onDrill(w.drillTuneId!, w.drillCardId!)}
                      >
                        <Glyph name="play" size={12} />
                        <span>Drill {w.drillLabel}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="pr-weak-empty">
              <Glyph name="check" size={22} />
              <h4>No recurring bottlenecks flagged</h4>
              <p>
                As you log scored passes, the detector watches for wide-leap misses, string crossings,
                position shifts, repeated semitone slips, timing spread over 50 ms, and ear gaps — and
                pins them here when a pattern emerges.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Ego-bliss KPI strip + Heatmap + Skill Radar + Leitner Ladder. */
function GlobalDashboard({
  dashboard,
  songCount,
  totalMilestones,
  readyMilestones,
}: {
  dashboard: PracticeDashboard;
  songCount: number;
  totalMilestones: number;
  readyMilestones: number;
}) {
  const weekDelta = dashboard.weekMinutes - dashboard.prevWeekMinutes;
  const maxBox = Math.max(1, dashboard.startedCards);
  const axesWithData = AXES.filter((a) => dashboard.profile.axes[a].n > 0);

  return (
    <>
      {/* Hero Ego-Bliss KPIs */}
      <section className="pr-kpi-grid" aria-label="Practice highlights">
        <article className="pr-kpi">
          <span className="pr-kpi-label">Time on the neck</span>
          <strong className="pr-kpi-value">{formatDuration(dashboard.totalMinutes)}</strong>
          <small className="pr-kpi-sub">
            {dashboard.weekMinutes}m this week
            {dashboard.prevWeekMinutes > 0 ? (
              <em className={weekDelta >= 0 ? "is-up" : "is-down"}>
                {weekDelta >= 0 ? ` (+${weekDelta}m)` : ` (${weekDelta}m)`}
              </em>
            ) : null}
          </small>
        </article>

        <article className="pr-kpi">
          <span className="pr-kpi-label">Practice rhythm</span>
          <strong className="pr-kpi-value">
            {dashboard.currentStreak}
            <span className="pr-kpi-unit"> day{dashboard.currentStreak === 1 ? "" : "s"}</span>
          </strong>
          <small className="pr-kpi-sub">
            Best streak {dashboard.bestStreak}d · {dashboard.activeDays84}/84 active days
          </small>
        </article>

        <article className="pr-kpi">
          <span className="pr-kpi-label">Clean accuracy</span>
          <strong className="pr-kpi-value">
            {dashboard.cleanRate !== null ? pct(dashboard.cleanRate) : "—"}
          </strong>
          <small className="pr-kpi-sub">
            {dashboard.measuredAttempts
              ? `${dashboard.measuredAttempts} mic-checked attempts`
              : "Play a timed pass to score"}
          </small>
        </article>

        <article className="pr-kpi">
          <span className="pr-kpi-label">Mastery &amp; repertoire</span>
          <strong className="pr-kpi-value">
            {dashboard.masteredCards}
            <span className="pr-kpi-unit"> / {dashboard.startedCards || 0}</span>
          </strong>
          <small className="pr-kpi-sub">
            {songCount} song{songCount === 1 ? "" : "s"} · {readyMilestones}/{totalMilestones} milestones
          </small>
        </article>
      </section>

      {/* Heatmap + Skill Radar & Axes + Leitner Box Distribution */}
      <section className="pr-analytics-grid" aria-label="Practice consistency and skills">
        <article className="pr-card pr-card-heatmap">
          <div className="pr-card-head">
            <div>
              <p className="pr-kicker">Consistency</p>
              <h3>12-week practice bloom</h3>
            </div>
            <span className="pr-stat-pill">{dashboard.totalSessions} session{dashboard.totalSessions === 1 ? "" : "s"}</span>
          </div>
          <PracticeHeatmap cells={dashboard.heatmap} weekly={dashboard.weeklySeries} />
        </article>

        <article className="pr-card pr-card-ladder">
          <div className="pr-card-head">
            <div>
              <p className="pr-kicker">Spaced retention</p>
              <h3>Leitner mastery ladder</h3>
            </div>
            {dashboard.dueCards > 0 ? <span className="pr-stat-pill is-warm">{dashboard.dueCards} ready for review</span> : null}
          </div>

          <div className="pr-box-bar" role="img" aria-label={`Box distribution across ${dashboard.startedCards} started exercises`}>
            {dashboard.boxCounts.map((count, idx) => (
              count > 0 ? (
                <span
                  key={idx}
                  className={`pr-box-seg b-${idx + 1}`}
                  style={{ width: `${(count / maxBox) * 100}%` }}
                  title={`${BOX_NAMES[idx]}: ${count}`}
                />
              ) : null
            ))}
          </div>

          <div className="pr-box-legend">
            {dashboard.boxCounts.map((count, idx) => (
              <div key={idx} className={`pr-box-stat b-${idx + 1}`}>
                <i />
                <span>B{idx + 1}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>

          {dashboard.familyBreakdown.length ? (
            <ul className="pr-family-list">
              {dashboard.familyBreakdown.map((fam) => (
                <li key={fam.family}>
                  <span>{fam.label}</span>
                  <div className="pr-fam-bar">
                    <i style={{ width: `${(fam.avgBox / BOXES) * 100}%` }} />
                  </div>
                  <small>avg B{fam.avgBox.toFixed(1)} · {fam.mastered}/{fam.started}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="progress-empty">Exercises climb from Box 1 to Box 5 as clean passes stack up.</p>
          )}
        </article>
      </section>

      {/* Six-Axis Skill Constellation */}
      <section className="pr-card pr-skills-card" aria-labelledby="tutor-playing-title">
        <div className="pr-card-head">
          <div>
            <p className="pr-kicker">Observed patterns</p>
            <h3 id="tutor-playing-title">Skill constellation</h3>
          </div>
          <p className="pr-caveat">Measured detector observations on played material — not an overall guitar grade.</p>
        </div>

        <div className="pr-skills-body">
          <div className="pr-radar-wrap">
            <SkillRadar profile={dashboard.profile} />
          </div>

          {axesWithData.length ? (
            <ul className="pr-axes-list">
              {AXES.map((a) => {
                const x = dashboard.profile.axes[a];
                const has = x.n > 0;
                return (
                  <li key={a} className={has ? "" : "is-empty"}>
                    <div className="pr-axis-label">
                      <strong>{AXIS_LABEL[a]}</strong>
                      <small>{has ? `${x.n} attempts` : "No samples yet"}</small>
                    </div>
                    <div className="pr-axis-track">
                      <i style={{ "--level": has ? x.level : 0 } as CSSProperties} />
                    </div>
                    <b className="pr-axis-val">{has ? pct(x.level) : "—"}</b>
                    <em className={x.trend === null ? "" : x.trend >= 0 ? "is-up" : "is-down"}>
                      {x.trend === null ? "" : `${x.trend >= 0 ? "+" : "−"}${Math.round(Math.abs(x.trend) * 100)}%`}
                    </em>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="pr-weak-empty">
              <Glyph name="progress" size={22} />
              <h4>Skill bars awaken after your first scored passes</h4>
              <p>Play any tune or foundation in Guitar mode to populate pitch, timing, speed, chord, reading, and ear metrics.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export function ProgressView({ onOpenSong, onStartPractice }: { onOpenSong(tuneId: string): void; onStartPractice(tuneId: string, cardId?: string): void }) {
  const { songs, currentTuneId, loading, error } = useSongSummaries();
  const [selected, setSelected] = useState<string | null>(null);
  const current = songs.find((song) => song.tuneId === selected) ?? songs.find((song) => song.tuneId === currentTuneId) ?? songs[0];
  const music = current ? cachedSong(current.tuneId) : undefined;
  const wholeId = music ? wholeTuneCard(music.deck)?.id : undefined;
  const fill = current ? songFill(current) : 0;
  const day = today();

  const dashboard = useMemo(() => {
    const stores = allStores();
    return buildPracticeDashboard(stores, day, latencyMeasured());
  }, [day, songs.length]);

  const schedulerInsight = useMemo(() => {
    if (!music) return null;
    const store = loadStore(music.sheet.id);
    return explainScheduling({
      sheet: music.sheet,
      deck: music.deck,
      store,
      profile: dashboard.profile,
      day,
    });
  }, [music, dashboard.profile, day]);

  const milestoneTotals = useMemo(() => {
    let total = 0;
    let ready = 0;
    for (const s of songs) {
      total += s.path?.total ?? 0;
      ready += s.path?.ready ?? 0;
    }
    return { total, ready };
  }, [songs]);

  return (
    <main className="tutor progress-view">
      <header className="progress-heading">
        <div>
          <p className="tutor-eyebrow">Practice analytics &amp; diagnostics</p>
          <h2>Progress</h2>
        </div>
        {songs.length > 1 ? (
          <div className="progress-song-pills" role="tablist" aria-label="Choose a song">
            {songs.map((song) => (
              <button
                key={song.tuneId}
                type="button"
                role="tab"
                aria-selected={current?.tuneId === song.tuneId}
                className={current?.tuneId === song.tuneId ? "is-on" : ""}
                onClick={() => setSelected(song.tuneId)}
              >
                <span>{song.title}</span>
                <small>{Math.round(songFill(song) * 100)}%</small>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {!loading ? (
        <GlobalDashboard
          dashboard={dashboard}
          songCount={songs.length}
          totalMilestones={milestoneTotals.total}
          readyMilestones={milestoneTotals.ready}
        />
      ) : null}

      {!loading && schedulerInsight && current ? (
        <SchedulerDiagnostics
          insight={schedulerInsight}
          tuneTitle={current.title}
          tuneId={current.tuneId}
          onDrill={onStartPractice}
        />
      ) : null}

      {loading ? (
        <p role="status">Loading practice history…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !current ? (
        <section className="progress-welcome">
          <Glyph name="melody" size={32} />
          <h3>No tunes in your collection yet</h3>
          <p>Add a song in Library to track milestones, tempo progression, and recordings.</p>
        </section>
      ) : (
        <>
          <section className="progress-music" aria-label="music and performances">
            <div className="progress-hero-card">
              <div className="progress-ring" aria-label={`${Math.round(fill * 100)}% grown`}>
                <svg viewBox="0 0 84 84" aria-hidden="true">
                  <circle className="pr-track" cx="42" cy="42" r="35" />
                  <circle className="pr-fill" cx="42" cy="42" r="35" pathLength={1} strokeDasharray={`${Math.max(fill, fill > 0 ? 0.04 : 0).toFixed(3)} 1`} transform="rotate(-90 42 42)" />
                </svg>
                <strong>{Math.round(fill * 100)}<small>%</small></strong>
              </div>
              <div className="progress-hero-body">
                <div className="progress-song-heading">
                  <label>Music<select value={current.tuneId} onChange={(event) => setSelected(event.target.value)}>{songs.map((song) => <option key={song.tuneId} value={song.tuneId}>{song.title}</option>)}</select></label>
                  <button type="button" className="tutor-link" onClick={() => onOpenSong(current.tuneId)}>Open score <Glyph name="arrow" size={16} /></button>
                </div>
                <div className="progress-musical-facts">
                  <div><span>Last played</span><strong>{relativeDay(current.lastPlayed, day) || "No recorded practice"}</strong></div>
                  <div><span>Milestones</span><strong>{current.path.ready} / {current.path.total}</strong></div>
                  <div className="progress-hero-actions">
                    {wholeId ? <button type="button" className="progress-primary-btn" onClick={() => onStartPractice(current.tuneId, wholeId)}><Glyph name="play" size={15} />Play whole tune</button> : null}
                    <button type="button" className="tutor-secondary" onClick={() => onStartPractice(current.tuneId)}>Practise this tune <Glyph name="play" size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
            {current.path.milestones.length ? <ul className="progress-milestones">{current.path.milestones.map((milestone) => <li key={milestone.id} className={milestone.ready ? "is-ready" : ""}><Glyph name={milestone.ready ? "check" : "clock"} size={16} /><span>{milestone.label}</span><small>{milestone.ready ? "Recorded clean at target" : "No qualifying take recorded"}</small></li>)}</ul> : null}
            <p className="progress-caption">Historical task records can include earlier score versions or help that was not recorded. A fresh goal check tracks the current arrangement.</p>
            {music ? <GoalChooser key={music.sheet.id} sheet={music.sheet} deck={music.deck} /> : null}
          </section>

          <div className="pr-card pr-archive-card">
            <PracticeHistory key={current.tuneId} tuneId={current.tuneId} music={music} />
          </div>

          <section className="pr-card tutor-section" aria-labelledby="progress-listen">
            <div className="tutor-section-head">
              <h3 id="progress-listen"><Glyph name="ear" size={18} />Listen back</h3>
            </div>
            <Takes key={current.tuneId} tuneId={current.tuneId} day={day} />
          </section>
        </>
      )}
    </main>
  );
}

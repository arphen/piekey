import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { listTakes, takeAudio, type TakeMeta } from "../audio/recorder";
import { latencyMeasured } from "../audio/latency";
import { allStores, today } from "../song/leitner";
import type { AttemptConditions } from "../song/leitner";
import { allAttempts, buildProfile, type Axis } from "../song/profile";
import { weeklyMinutes } from "../overview/progress";
import { cachedSong, useSongSummaries } from "../overview/useSongSummaries";
import { relativeDay } from "../overview/visual";
import { Glyph } from "./Glyph";
import { GoalChooser } from "./GoalChooser";
import "../overview/overview.css";
import "../overview/progress.css";

const AXIS_LABEL: Record<Axis, string> = { pitch: "First-try notes", time: "Timing consistency", tempo: "Clean scale tempo / goal", chords: "Chord accuracy", reading: "Reading accuracy", ear: "Echo accuracy" };
const pct = (x: number) => `${Math.round(x * 100)} %`;
const conditionLabel = (conditions?: AttemptConditions): string => conditions ? [
  conditions.source === "self" ? "Self-guided" : "Mic checked",
  conditions.tempo === "fixed" ? "fixed tempo" : conditions.tempo === "adaptive" ? "adaptive tempo" : conditions.tempo === "own-pace" ? "own pace" : "tempo unknown",
  conditions.support === "guide" ? "guide melody" : conditions.support === "adaptive" ? "adaptive support" : conditions.support === "none" ? "no audio guide" : "support unknown",
  conditions.notation === "visible" ? "score shown" : conditions.notation === "hidden" ? "score hidden" : conditions.notation === "faded" ? "score fades" : "visual help unknown",
  `detector confidence ${conditions.confidence}`,
].join(" · ") : "Assistance and assessment conditions unknown";

/** Each player owns its object URL and releases it when the selection changes. */
function TakePlayer({ take, tuneId, caption, day }: { take: TakeMeta; tuneId: string; caption: string; day: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [extension, setExtension] = useState("webm");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
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
    return () => { disposed = true; if (owned) URL.revokeObjectURL(owned); };
  }, [take.id, tuneId, retry]);
  return <figure className="progress-take">
    <figcaption><strong>{caption}</strong><span>{relativeDay(take.day, day)} · ♩ {take.bpm}</span></figcaption>
    {url ? <audio controls preload="none" src={url} aria-label={`${caption}, ${take.day}, ${take.bpm} bpm`} /> : <p role="status">{error ? "This recording could not be read." : "Loading recording…"}</p>}
    {error ? <button type="button" className="tutor-link" onClick={() => setRetry((value) => value + 1)}>Retry audio</button> : null}
    <p className="progress-caption">{conditionLabel(take.conditions)}</p>
    {url ? <a className="tutor-link" href={url} download={`guitar-take-${take.day}-${take.id.replace(/[^a-zA-Z0-9-]/g, '_')}.${extension}`}><Glyph name="download" size={14} />Save audio</a> : null}
  </figure>;
}

/** Compare the same stored task. The original tempo and audio are preserved. */
function Takes({ tuneId, day }: { tuneId: string; day: string }) {
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
      {([0, 1] as const).map((side) => <label key={side}>{side ? "Compare with" : "Reference"}<select value={selected[side]} onChange={(event) => setSelected((current) => side ? [current[0], event.target.value] : [event.target.value, current[1]])}>
        {takes.map((take, index) => <option key={take.id} value={take.id}>{index === 0 ? "First · " : ""}{take.day} · {take.bpm} bpm</option>)}
      </select></label>)}
    </div>
    <div className="progress-take-pair">
      {first ? <TakePlayer key={`reference:${first.id}`} take={first} tuneId={tuneId} caption="Reference" day={day} /> : null}
      {latest && latest.id !== first?.id ? <TakePlayer key={`comparison:${latest.id}`} take={latest} tuneId={tuneId} caption="Comparison" day={day} /> : null}
    </div>
    <p className="progress-caption">{!sameTask ? "These recordings cover different tasks. " : ""}{first?.bpm !== latest?.bpm ? "Different tempos. " : ""}{arrangementKnown ? sameArrangement ? "Same score version. " : "Different score versions. " : "Score version unknown for an older take. "}Compare the tempo and help shown with each recording.</p>
    <p className="progress-caption">The first take and ten most recent are kept on this browser. A full .fretpack export includes audio.</p>
  </div>;
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
          <h3 id="tutor-playing-title">Observed patterns</h3>
        </div>
      </div>
      <p className="progress-caption">Detector observations on the material you played. These percentages describe those tasks; they do not rate your guitar level.</p>
      <div className="tutor-playing">
        <ul className="tutor-axes">
          {axes.map((a) => {
            const x = profile.axes[a];
            return (
              <li key={a}>
                <span title={`${x.n} retained attempts`}>{AXIS_LABEL[a]}<small className="progress-samples">{x.n} attempts</small></span>
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


export function ProgressView({ onOpenSong, onStartPractice }: { onOpenSong(tuneId: string): void; onStartPractice(tuneId: string, cardId?: string): void }) {
  const { songs, currentTuneId, loading, error } = useSongSummaries();
  const [selected, setSelected] = useState<string | null>(null);
  const current = songs.find((song) => song.tuneId === selected) ?? songs.find((song) => song.tuneId === currentTuneId) ?? songs[0];
  const music = current ? cachedSong(current.tuneId) : undefined;
  const day = today();
  return <main className="tutor progress-view">
    <header className="progress-heading"><p className="tutor-eyebrow">Your playing</p><h2>Progress</h2></header>
    {loading ? <p role="status">Loading practice history…</p> : error ? <p role="alert">{error}</p> : !current ? <section className="progress-welcome"><Glyph name="melody" size={32} /><h3>No practice recorded</h3><p>Choose a tune in Songs to start.</p></section> : <>
      <section className="progress-music" aria-label="music and performances">
        <div className="progress-song-heading"><label>Music<select value={current.tuneId} onChange={(event) => setSelected(event.target.value)}>{songs.map((song) => <option key={song.tuneId} value={song.tuneId}>{song.title}</option>)}</select></label><button type="button" className="tutor-link" onClick={() => onOpenSong(current.tuneId)}>Open score <Glyph name="arrow" size={16} /></button></div>
        <div className="progress-musical-facts"><div><span>Last played</span><strong>{relativeDay(current.lastPlayed, day) || "No recorded practice"}</strong></div><div><span>Historical milestones</span><strong>{current.path.ready} / {current.path.total}</strong></div><button type="button" className="tutor-secondary" onClick={() => onStartPractice(current.tuneId)}>Practise this tune <Glyph name="play" size={16} /></button></div>
        {current.path.milestones.length ? <ul className="progress-milestones">{current.path.milestones.map((milestone) => <li key={milestone.id}><Glyph name={milestone.ready ? "check" : "clock"} size={17} /><span>{milestone.label}</span><small>{milestone.ready ? "Recorded clean at target" : "No qualifying take recorded"}</small></li>)}</ul> : null}
        <p className="progress-caption">Historical task records can include earlier score versions or help that was not recorded. A fresh goal check tracks the current arrangement. Review boxes schedule practice; related-exercise credit is preparation.</p>
        {music ? <GoalChooser key={music.sheet.id} sheet={music.sheet} deck={music.deck} /> : null}
      </section>
      <section className="tutor-section" aria-labelledby="progress-listen"><div className="tutor-section-head"><h3 id="progress-listen"><Glyph name="ear" size={18} />Listen back</h3></div><Takes key={current.tuneId} tuneId={current.tuneId} day={day} /></section>
    </>}
    {!loading ? <Playing day={day} /> : null}
  </main>;
}

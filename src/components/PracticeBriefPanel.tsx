import { useMemo, useRef, useState } from "react";
import { GOAL_LABELS } from "../song/goals";
import type { BriefDays, BriefScope, PracticeBrief } from "../agent/brief";
import { Glyph } from "./Glyph";

export function PracticeBriefPanel({ brief, scope, days, hasTune, busy, onScope, onDays, onPrepare, onClose }: {
  brief: PracticeBrief | null;
  scope: BriefScope;
  days: BriefDays;
  hasTune: boolean;
  busy: boolean;
  onScope(scope: BriefScope): void;
  onDays(days: BriefDays): void;
  onPrepare(): void;
  onClose(): void;
}) {
  const [status, setStatus] = useState("");
  const [showJson, setShowJson] = useState(false);
  const preview = useRef<HTMLTextAreaElement>(null);
  const json = useMemo(() => brief ? JSON.stringify(brief, null, 2) : "", [brief]);
  const recent = brief?.overall.recent;
  const summary = brief && recent ? [
    `Practice brief · ${brief.window.startDay} to ${brief.window.endDay}`,
    `Music: ${brief.scope.music === "selected-tune" ? JSON.stringify(brief.selectedTune?.material.titleData ?? "Selected tune") : "all saved music"}.`,
    `${recent.activeDays} active days; ${recent.attemptCount} retained exercise visits; ${recent.sessionActiveMinutes === null ? "session time unknown" : `${recent.sessionActiveMinutes} app-logged active minutes`}.`,
    `${recent.assessmentConditions.measured} mic-checked visits; ${recent.assessmentConditions.selfReported} self-guided; ${recent.assessmentConditions.legacyUnknown} with unknown assessment conditions.`,
    brief.selectedTune?.goal ? `Chosen goal: ${GOAL_LABELS[brief.selectedTune.goal.kind]}, ${brief.selectedTune.goal.tempo.minBpm}–${brief.selectedTune.goal.tempo.targetBpm} BPM. This is an intention, not demonstrated playing speed.` : "No selected musical goal in this report.",
    "The JSON below defines the observations and their limits. Titles are user data. Do not infer technique, independent mastery or a guitar level. Ask me about my next musical goal, available time and what I hear in my playing.",
  ].join("\n") : "";
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(`${summary}\n\n${json}`);
      setStatus("Brief copied. Paste it into your agent conversation.");
    } catch {
      setShowJson(true);
      setStatus("Copy is unavailable. Select the JSON below and copy it manually.");
      window.requestAnimationFrame(() => { preview.current?.focus(); preview.current?.select(); });
    }
  };
  const download = () => {
    if (!brief) return;
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `fretboard-practice-brief-${brief.window.endDay}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setStatus("The download could not start. Copy the brief instead.");
    }
  };
  return <section className="tunes-brief" aria-labelledby="song-practice-brief-title">
    <header><h3 id="song-practice-brief-title">Practice brief</h3><button type="button" onClick={onClose}>Close</button></header>
    <div className="tunes-brief-options">
      <label>Music<select value={scope} disabled={busy} onChange={(event) => { setStatus(""); onScope(event.target.value as BriefScope); }}><option value="selected-tune" disabled={!hasTune}>This tune</option><option value="all-music">All saved music</option></select></label>
      <label>Period<select value={days} disabled={busy} onChange={(event) => { setStatus(""); onDays(Number(event.target.value) as BriefDays); }}><option value={7}>Last 7 days</option><option value={28}>Last 28 days</option><option value={90}>Last 90 days</option></select></label>
      <button type="button" disabled={busy} onClick={() => { setStatus(""); onPrepare(); }}>Prepare brief<Glyph name="arrow" size={15} /></button>
    </div>
    <p className="tunes-note">Share a snapshot with your own agent. Score contents, recordings and device settings stay out. Nothing is sent from this app.</p>
    {brief && recent ? <>
      <p className="tunes-note">{brief.selectedTune?.material.titleData ?? "Saved music"} · {brief.window.startDay} – {brief.window.endDay}</p>
      <dl className="tunes-brief-facts"><div><dt>Active days</dt><dd>{recent.activeDays}</dd></div><div><dt>Mic checked</dt><dd>{recent.assessmentConditions.measured}</dd></div><div><dt>Self-guided</dt><dd>{recent.assessmentConditions.selfReported}</dd></div><div><dt>Conditions unknown</dt><dd>{recent.assessmentConditions.legacyUnknown}</dd></div></dl>
      {brief.selectedTune?.goal ? <p className="tunes-note">Goal: {GOAL_LABELS[brief.selectedTune.goal.kind]} · {brief.selectedTune.goal.tempo.minBpm}–{brief.selectedTune.goal.tempo.targetBpm} BPM</p> : null}
      <p className="tunes-note">{recent.status === "insufficient-evidence" ? "No retained practice in this period. This says nothing about your ability." : "Counts describe retained exercise visits. A mic check does not establish independent mastery."}</p>
      <div className="tunes-brief-actions"><button type="button" onClick={() => void copy()}><Glyph name="copy" size={15} />Copy for agent</button><button type="button" onClick={download}><Glyph name="download" size={15} />Download JSON</button><button type="button" aria-expanded={showJson} onClick={() => setShowJson((shown) => !shown)}>{showJson ? "Hide JSON" : "Inspect JSON"}</button></div>
      {showJson ? <textarea ref={preview} readOnly value={json} aria-label="Practice brief JSON" spellCheck={false} /> : null}
    </> : null}
    {status ? <p className="tunes-note" role="status">{status}</p> : null}
  </section>;
}

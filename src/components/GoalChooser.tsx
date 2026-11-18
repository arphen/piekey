import { useEffect, useId, useMemo, useState } from "react";
import type { Deck } from "../song/deck";
import { createGoal, GOAL_LABELS, goalMatches, LOCAL_GOAL_LIMIT, saveGoal, setActiveGoal, type GoalKind } from "../song/goals";
import { useGoals } from "../song/useGoals";
import { useGoalEvidence } from "../song/useGoalEvidence";
import type { LeadSheet } from "../tunes/musicxml";
import "./goal-chooser.css";

export function GoalChooser({ sheet, deck, onChanged }: { sheet: LeadSheet; deck: Deck; onChanged?: () => void }) {
  const goals = useGoals();
  const bucket = goals.byTune[sheet.id];
  const active = bucket?.activeId ? bucket.goals[bucket.activeId] : null;
  const stale = Boolean(active && !goalMatches(sheet, deck, active));
  const initial = Math.round(Math.max(30, Math.min(240, sheet.tempo ?? 96)));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GoalKind>(active?.kind ?? "melody");
  const [minBpm, setMinBpm] = useState(active?.tempo.minBpm ?? Math.min(60, initial));
  const [targetBpm, setTargetBpm] = useState(active?.tempo.targetBpm ?? initial);
  const [message, setMessage] = useState("");
  const id = useId();
  useEffect(() => {
    setKind(active?.kind ?? "melody");
    setMinBpm(active?.tempo.minBpm ?? Math.min(60, initial));
    setTargetBpm(active?.tempo.targetBpm ?? initial);
    setMessage("");
  }, [sheet.id, active?.id, initial]);
  const preview = useMemo(() => {
    if (active && active.kind === kind && active.tempo.minBpm === minBpm && active.tempo.targetBpm === targetBpm && goalMatches(sheet, deck, active))
      return { goal: active, error: "" };
    try { return { goal: createGoal(sheet, deck, { kind, minBpm, targetBpm }), error: "" }; }
    catch (error) { return { goal: null, error: error instanceof Error ? error.message : "This outcome is unavailable for this score." }; }
  }, [sheet, deck, kind, minBpm, targetBpm, active]);
  const byId = new Map(deck.cards.map((card) => [card.id, card]));
  const shown = open ? preview.goal : null;
  const atLimit = Object.keys(bucket?.goals ?? {}).length >= LOCAL_GOAL_LIMIT;
  const reusing = Boolean(active && preview.goal?.id === active.id);
  const evidence = useGoalEvidence(active && !stale ? active : null);
  const progress = active && !stale && evidence.result.status === "ready" ? evidence.result.progress : null;
  const bpmChoices = [...new Set([...Array.from({ length: 211 }, (_, index) => index + 30), minBpm, targetBpm])].sort((a, b) => a - b);

  return <section className="goal-chooser" aria-label="Musical goal">
    <div className="goal-chooser-summary">
      <div>
        <span className="goal-chooser-kicker">Musical goal</span>
        <p>{active ? <><strong>{GOAL_LABELS[active.kind]}</strong> · {active.kind === "ear" ? "call " : ""}{active.tempo.minBpm}–{active.tempo.targetBpm} BPM</> : "Choose what you want to be able to play."}</p>
        {progress ? <p className="goal-chooser-note">{progress.demonstrated} of {progress.total} {progress.evidenceKind === "echo" ? "echo tasks completed." : "tasks marked clean at target."}</p> : null}
        {active && !stale && evidence.result.status !== "ready" ? <p className="goal-chooser-note" role="status">{evidence.result.status === "checking" ? "Checking saved goal evidence…" : evidence.result.status === "too-large" ? "The saved history exceeds this check’s limit. Goal progress is unknown here." : evidence.result.status === "conflicted" ? "Saved history has conflicting or overlapping records. Goal progress is unknown until that history is reviewed." : "Saved goal evidence could not be checked. Goal progress is unknown; your existing history is unchanged."}</p> : null}
        {active && !stale && evidence.result.status === "unavailable" ? <button type="button" onClick={evidence.retry}>Check evidence again</button> : null}
      </div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close goals" : active ? "Change goal" : "Choose goal"}</button>
    </div>
    {stale ? <p className="goal-chooser-warning" role="status">The arrangement changed, or a required task is unavailable. This goal is paused. Choose a new goal for this version; earlier playing stays in your history.</p> : null}
    {open ? <div id={id} className="goal-chooser-body">
      {bucket && Object.keys(bucket.goals).length ? <label>Active goal
        <select value={bucket.activeId ?? ""} onChange={(event) => {
          setActiveGoal(sheet.id, event.target.value || null);
          onChanged?.();
        }}>
          <option value="">No active goal · explore freely</option>
          {Object.values(bucket.goals).map((goal) => <option key={goal.id} value={goal.id}>{GOAL_LABELS[goal.kind]} · {goal.tempo.targetBpm} BPM{goalMatches(sheet, deck, goal) ? "" : " · earlier arrangement"}</option>)}
        </select>
      </label> : null}
      <div className="goal-chooser-fields">
        <label>Outcome<select value={kind} onChange={(event) => setKind(event.target.value as GoalKind)}>
          {(Object.entries(GOAL_LABELS) as [GoalKind, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>{kind === "ear" ? "Call starts at" : "Start at"} (BPM)<select value={minBpm} onChange={(event) => setMinBpm(Number(event.target.value))}>{bpmChoices.map((bpm) => <option key={bpm} value={bpm}>{bpm}</option>)}</select></label>
        <label>{kind === "ear" ? "Call target" : "Target"} (BPM)<select value={targetBpm} onChange={(event) => setTargetBpm(Number(event.target.value))}>{bpmChoices.map((bpm) => <option key={bpm} value={bpm}>{bpm}</option>)}</select></label>
      </div>
      <p className="goal-chooser-note">This fixes a short route for this arrangement. Optional drills stay optional. The target belongs to you; the score’s tempo stays as imported.</p>
      <p className="goal-chooser-note">Progress counts microphone-checked takes of this arrangement since the goal was created. Earlier or unknown evidence stays in history.</p>
      {kind === "ear" ? <p className="goal-chooser-note">Echoes cover short phrases of the tune, up to six notes each. BPM sets the call’s reference tempo. Successful echoes count as completed tasks; your response is checked at your own pace, without a performed-tempo claim.</p> : null}
      {kind === "improv" ? <p className="goal-chooser-note">Guide tones prepare each section. These tasks measure note choices in the changes; they do not grade musical expression.</p> : null}
      {kind === "reading" ? <p className="goal-chooser-note">The route keeps the same tasks while their notes change each visit.</p> : null}
      {preview.error ? <p className="goal-chooser-warning" role="status">{preview.error}</p> : null}
      {atLimit && !reusing ? <p className="goal-chooser-warning">This tune has reached its local creation limit. Choose an existing goal above; imported goal history stays available.</p> : null}
      <button type="button" className="goal-chooser-save" disabled={!preview.goal || (atLimit && !reusing)} onClick={() => {
        if (!preview.goal) return;
        const saved = saveGoal(preview.goal);
        setMessage(saved ? "Goal selected." : "Goal save needs attention. Check the storage notice.");
        onChanged?.();
        if (saved) setOpen(false);
      }}>Use this goal</button>
    </div> : null}
    {shown && (!stale || open) ? <div className="goal-chooser-route">
      <p>{shown.essentialTasks.length} fixed {shown.essentialTasks.length === 1 ? "task" : "tasks"} · {reusing ? "selected route" : "proposed route"}</p>
      <ol>{shown.essentialTasks.map((task) => <li key={task.cardId}><span>{byId.get(task.cardId)?.title ?? task.cardId}{byId.get(task.cardId)?.where ? ` · ${byId.get(task.cardId)!.where}` : ""}</span><span>{task.targetBpm} BPM{shown.kind === "ear" ? " call" : ""}</span></li>)}</ol>
    </div> : null}
    {message ? <p className="goal-chooser-note" role="status">{message}</p> : null}
  </section>;
}

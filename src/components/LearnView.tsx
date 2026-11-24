import { useEffect, useMemo, useState } from "react";
import type { InputApi } from "../listen/useInput";
import { pitchClassToName } from "../musicTheory";
import { setNavMuted } from "../nav/useGuitarNav";
import { buildPlan, chordLandings, melodyOverChords, type Step } from "../tunes/learn";
import type { LeadSheet } from "../tunes/musicxml";
import { printedResults, type Timeline } from "../tunes/order";
import { useCoach, type Phase } from "../tunes/useCoach";
import { Score } from "./Score";

interface LearnViewProps {
  sheet: LeadSheet;
  tl: Timeline;
  input: InputApi;
  anyOctave: boolean;
  showFingering: boolean;
  bpm: number;
  onBpm: (bpm: number) => void;
}

const KIND_LABEL: Record<Step["kind"], string> = {
  hear: "Hear",
  new: "New",
  review: "Review",
  join: "Join",
  section: "Section",
  memory: "Memory",
  tune: "Whole tune",
};

const pretty = (s: string) => s.replace(/maj7/g, "Δ7").replace(/(^|\/)([A-G])b/g, "$1$2♭").replace(/(^|\/)([A-G])#/g, "$1$2♯").replace(/b(\d)/g, "♭$1");
const noteLabel = (midi: number) => `${pitchClassToName(midi).replace("#", "♯")}${Math.floor(midi / 12) - 1}`;

export function LearnView({ sheet, tl, input, anyOctave, showFingering, bpm, onBpm }: LearnViewProps) {
  const plan = useMemo(() => buildPlan(sheet, tl).filter((step) => step.kind !== "hear"), [sheet, tl]);
  const over = useMemo(() => melodyOverChords(sheet), [sheet]);
  const [guide, setGuide] = useState(false);
  const [degrees, setDegrees] = useState(true);
  const coach = useCoach({ tuneId: sheet.id, tl, plan, input, anyOctave, bpm, guide });
  const { step, phase } = coach;
  // listening, reading and playing in time all hear the guitar: the shell's note keys stay quiet
  const busy = phase === "listen" || phase === "read" || phase === "time";
  useEffect(() => {
    setNavMuted(busy);
    return () => setNavMuted(false);
  }, [busy]);
  const listening = input.status === "listening";

  const bars = useMemo(() => {
    if (!step) return [];
    const set = new Set<number>();
    for (let s = step.from; s <= step.to; s++) set.add(tl.slots[s].bar);
    return [...set];
  }, [step, tl]);
  const landings = useMemo(() => (step ? chordLandings(sheet, tl, step, over) : []), [sheet, tl, step, over]);
  const noteResults = useMemo(() => printedResults(tl, coach.results, Math.max(0, coach.active)), [tl, coach.results, coach.active]);
  const activeNotes = coach.active >= 0 ? tl.targets[coach.active]?.notes ?? [] : [];
  const playingBar = coach.playback.playing ? tl.slots[coach.playback.activeSlot]?.bar ?? -1 : -1;
  const labels = degrees ? over.degree : null;

  if (!step) return <p className="reading-hint">This tune has no notes to learn.</p>;

  const next = plan[coach.index + 1];
  const need = Math.round(step.pass * 100);
  const passes = coach.passes.map((p) => `${Math.round(p * 100)}%`);
  const struggling = coach.passes.length >= 3 && coach.passes.slice(-3).every((p) => p < step.pass);

  const phases: { id: Phase; label: string; on: boolean }[] = [
    { id: "listen", label: "Listen", on: step.listen },
    { id: "read", label: `Read it slowly${phase === "read" || coach.clean ? ` · ${coach.clean}/${coach.cleanNeeded} clean` : ""}`, on: step.read },
    { id: "time", label: `In time · ${need}%`, on: true },
  ];
  const order: Phase[] = ["ready", "listen", "read", "time", "passed"];
  const stateOf = (id: Phase) => (phase === id ? "is-now" : order.indexOf(phase) > order.indexOf(id) ? "is-done" : "");

  let say: string;
  switch (phase) {
    case "ready":
      say = step.listen ? "Press Start: you'll hear it once, then it's your turn." : "Press Start when your hands are on the guitar.";
      break;
    case "listen":
      say = "Listen first. Hear how the melody sits on the chords.";
      break;
    case "read":
      say =
        coach.follow.wrong !== null && !coach.follow.done
          ? `Heard ${noteLabel(coach.follow.wrong)}. Find the lit note and carry on.`
          : coach.follow.done
            ? coach.clean
              ? `Clean take! ${coach.clean} of ${coach.cleanNeeded}.`
              : "Nearly. Once more from the top of the chunk."
            : "At your own pace: every note first time, no going back. The cursor waits for you.";
      break;
    case "time":
      say = !listening
        ? "Start listening (top bar) so the passes can be scored."
        : struggling
          ? "This one's tricky. Take it 10 bpm slower, it'll come."
          : `With the band now, ${need}% of the notes in one pass. It loops until you've got it.`;
      break;
    default:
      say = next ? `Got it! Next up: ${next.title}.` : "That's the whole plan. Beautiful work.";
  }

  const skip = () => {
    if (phase === "listen") coach.setPhase(step.read ? "read" : "time");
    else if (phase === "read") coach.setPhase("time");
    else coach.goTo(coach.index + 1);
  };

  return (
    <>
      <section className={`learn ${phase === "passed" ? "is-passed" : ""}`} aria-label="learning coach">
        <div className="learn-map" role="list" aria-label="plan">
          {plan.map((s, i) => (
            <button
              type="button"
              role="listitem"
              key={i}
              className={`learn-dot kind-${s.kind} ${i === coach.index ? "is-now" : ""} ${coach.done.includes(i) ? "is-done" : ""}`}
              title={`${i + 1}. ${s.title}`}
              onClick={() => coach.goTo(i)}
            />
          ))}
        </div>

        <div className="learn-head">
          <div>
            <p className="learn-kicker">
              {KIND_LABEL[step.kind]} · {step.section || sheet.title} · step {coach.index + 1} of {plan.length}
            </p>
            <h3 className="learn-title">{step.title}</h3>
            <p className="learn-detail">{step.detail}</p>
          </div>
          <div className="learn-nav">
            <button type="button" className="coach-btn" onClick={() => coach.goTo(coach.index - 1)} disabled={coach.index === 0}>
              ◀ Back
            </button>
            <button type="button" className="coach-btn" onClick={skip}>
              Skip ▶
            </button>
          </div>
        </div>

        <ol className="learn-phases">
          {phases
            .filter((p) => p.on)
            .map((p) => (
              <li key={p.id} className={stateOf(p.id)}>
                {p.label}
              </li>
            ))}
        </ol>

        <p className="learn-say" aria-live="polite">
          {say}
          {phase === "time" && passes.length ? <span className="learn-passes"> Passes: {passes.slice(-5).join(" · ")}</span> : null}
        </p>

        {landings.length ? (
          <p className="learn-chords">
            <span className="learn-chords-k">Over the chords</span>
            {landings.map((l, i) => (
              <span key={i} className="learn-landing">
                <b>{pretty(l.chord)}</b> {l.note}
                {l.degree ? <em>{l.degree}</em> : null}
              </span>
            ))}
          </p>
        ) : null}

        <div className="learn-controls">
          {phase === "ready" ? (
            <button type="button" className="tunes-play" onClick={coach.start}>
              ▶ Start
            </button>
          ) : (
            <button type="button" className="coach-btn" onClick={coach.replay}>
              {phase === "time" ? (coach.playback.playing ? "Restart the loop" : "▶ Play the loop") : "Hear it again"}
            </button>
          )}
          <div className="tunes-tempo" role="group" aria-label="tempo">
            <button type="button" onClick={() => onBpm(Math.max(30, bpm - 5))} aria-label="slower">
              −
            </button>
            <span>
              <b>{bpm}</b> bpm
            </span>
            <button type="button" onClick={() => onBpm(Math.min(240, bpm + 5))} aria-label="faster">
              +
            </button>
          </div>
          {struggling ? (
            <button type="button" className="coach-btn" onClick={() => onBpm(Math.max(30, bpm - 10))}>
              10 bpm slower
            </button>
          ) : null}
          <button type="button" className={`pill ${guide ? "is-on" : ""}`} onClick={() => setGuide((v) => !v)} title="Hear the melody while you play in time">
            Guide melody
          </button>
          <button type="button" className={`pill ${degrees ? "is-on" : ""}`} onClick={() => setDegrees((v) => !v)} title="Each note's degree over the chord">
            Degrees
          </button>
          <button type="button" className="pill learn-reset" onClick={coach.reset} title="Start the plan over">
            Start plan over
          </button>
        </div>
      </section>

      <div className="score-wrap">
        <Score
          exercise={sheet}
          activeStep={activeNotes[0] ?? -1}
          activeNotes={activeNotes}
          results={noteResults}
          showFingering={showFingering}
          autoScroll
          playingBar={playingBar}
          focusBars={bars}
          hideBars={step.kind === "memory" ? bars : null}
          noteLabels={labels}
          onBarClick={(bar) => {
            const i = plan.findIndex((s) => (s.kind === "new" || s.kind === "review") && tl.slots.slice(s.from, s.to + 1).some((sl) => sl.bar === bar));
            if (i >= 0) coach.goTo(i);
          }}
        />
      </div>
    </>
  );
}

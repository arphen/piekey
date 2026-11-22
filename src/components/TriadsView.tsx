import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Accidental, Formatter, Renderer, Stave, StaveNote, Voice } from "vexflow";
import type { InputApi } from "../listen/useInput";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import { TOP_BOX } from "../triads/box";
import { keyName, LAYERS, MINOR_KEYS, noteName, TRIAD_KEYS, vexOf, type Naming, type Triad } from "../triads/triads";
import { useTriads } from "../triads/useTriads";
import "../triads/triads.css";

const STAFF_W = 132;
const STAFF_H = 112;

/** One triad on a treble staff, accidentals written out: no key signature to lean on. */
function TriadStaff({ triad }: { triad: Triad }) {
  const host = useRef<HTMLDivElement>(null);
  const id = triad.notes.join("-");
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = "";
    try {
      const renderer = new Renderer(el, Renderer.Backends.SVG);
      renderer.resize(STAFF_W, STAFF_H);
      const ctx = renderer.getContext();
      const ink = getComputedStyle(el).color || "#f3ece2";
      ctx.setFillStyle(ink);
      ctx.setStrokeStyle(ink);
      const stave = new Stave(0, 6, STAFF_W - 2).addClef("treble");
      stave.setContext(ctx).draw();
      const { keys, accidentals } = vexOf(triad);
      const chord = new StaveNote({ keys, duration: "w", clef: "treble" });
      accidentals.forEach((a, i) => { if (a) chord.addModifier(new Accidental(a), i); });
      const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables([chord]);
      new Formatter().joinVoices([voice]).format([voice], STAFF_W - stave.getNoteStartX() - 12);
      voice.draw(ctx, stave);
      el.querySelector("svg")?.setAttribute("viewBox", `0 0 ${STAFF_W} ${STAFF_H}`);
    } catch {
      // no layout (tests): the names below still answer
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="triad-staff" ref={host} aria-hidden="true" />;
}

const names = (t: Triad, naming: Naming) => t.notes.map((n) => noteName(n, naming)).join(" · ");
const INVERSION = ["", "first inversion", "second inversion"];

/** "ii", with its figure for an inversion: ii⁶, ii⁶₄. */
function Roman({ roman, inversion }: { roman: string; inversion: 0 | 1 | 2 }) {
  return (
    <>
      {roman}
      {inversion ? <span className="triads-figure">{inversion === 1 ? <sup>6</sup> : <><sup>6</sup><sub>4</sub></>}</span> : null}
    </>
  );
}

function TriadDrill({ input }: { input: InputApi }) {
  const t = useTriads(input);
  const { card, choices, correct, answer, naming, session, counts } = t;
  const quick = session.fastMs.length ? session.fastMs.reduce((a, b) => a + b, 0) / session.fastMs.length / 1000 : null;
  const of = naming === "german" ? "in" : "of";
  const right = choices[correct];
  const answerText = right?.triad ? names(right.triad, naming) : right?.roman ?? "";
  return (
    <main className="triads" style={{ "--triad-box": t.state?.box ?? 0 } as CSSProperties}>
      <header className="triads-head">
        <ol className="triads-boxes" aria-label="Card box">
          {counts.map((n, box) => (
            <li key={box} className={`${(t.state?.box ?? 0) === box ? "is-here" : ""} ${box === 0 ? "is-new" : ""}`} title={box === 0 ? "open, not yet seen" : `box ${box}`}>
              <i style={{ height: `${Math.min(100, (n / 13) * 100)}%` }} />
              <span>{box === 0 ? "new" : box}</span>
              <b>{n}</b>
            </li>
          ))}
        </ol>
        <ol className="triads-layers" aria-label="What is open, round the circle of fifths">
          {LAYERS.map((layer, l) => (
            <li key={layer.label} className={l === card.layer ? "is-here" : ""}>
              <span>{layer.label}</span>
              <span className="triads-rings">{t.open[l].map((on, r) => <i key={r} className={on ? "is-open" : ""} title={(layer.mode === "major" ? TRIAD_KEYS : MINOR_KEYS).filter((k) => k.ring === r).map((k) => keyName(k, naming)).join(", ")} />)}</span>
            </li>
          ))}
        </ol>
      </header>

      {card.ask === "degree" ? (
        <section className="triads-ask is-degree" aria-live="polite">
          <div className="triads-shown"><TriadStaff triad={card.triad} /><span className="triads-names">{names(card.triad, naming)}</span></div>
          <p className="triads-of">{of} {keyName(card.key, naming)}: which degree?</p>
        </section>
      ) : (
        <section className="triads-ask" aria-live="polite">
          <p className="triads-roman"><Roman roman={card.roman} inversion={card.inversion} /></p>
          <p className="triads-of">{of} {keyName(card.key, naming)}{card.inversion ? <small>{INVERSION[card.inversion]}</small> : null}</p>
        </section>
      )}

      {t.playOnly ? (
        <section className="triads-play" aria-live="polite">
          <span className="triads-play-ring" aria-hidden="true"><i /><i /></span>
          <p>Play it</p>
          <button type="button" onClick={t.reveal}>show choices</button>
        </section>
      ) : (
        <div className={`triads-choices ${card.ask === "degree" ? "is-romans" : ""} ${answer ? "is-answered" : ""}`} role="group" aria-label={card.ask === "degree" ? "Choose the degree" : "Choose the triad"}>
          {choices.map((choice, i) => {
            const state = !answer ? "" : i === correct ? "is-right" : i === answer.picked ? "is-wrong" : "is-other";
            const label = choice.triad ? names(choice.triad, naming) : choice.roman ?? "";
            return (
              <button key={`${card.id}:${i}`} type="button" className={`triads-choice ${state}`} onClick={() => (answer ? t.skipAhead() : t.choose(i))} aria-label={`${i + 1}: ${label}`}>
                {choice.triad ? <><TriadStaff triad={choice.triad} /><span className="triads-names">{label}</span></> : <span className="triads-choice-roman">{label}</span>}
                <kbd>{i + 1}</kbd>
                {state === "is-right" ? <span className="triads-glint" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span> : null}
              </button>
            );
          })}
        </div>
      )}

      <footer className="triads-foot">
        <p className={`triads-result ${answer ? (answer.right ? "is-right" : "is-wrong") : ""}`} aria-live="polite">
          {answer ? (answer.right ? `${(answer.ms / 1000).toFixed(1)} s${answer.ms > 3000 ? " · again until it is instant" : ""}` : answerText) : t.playOnly ? "from memory, on the strings" : t.listening && card.ask === "name" && !card.inversion ? "tap, 1–4, or strum it" : "tap or 1–4"}
        </p>
        <p className="triads-stats">
          <span>{session.right}/{session.asked}</span>
          <span>streak {session.streak}{session.best > session.streak ? ` · best ${session.best}` : ""}</span>
          {quick !== null ? <span>{quick.toFixed(1)} s</span> : null}
          <span>box {t.state?.box ?? 0}/{TOP_BOX}</span>
        </p>
        <div className="triads-naming" role="group" aria-label="Note names">
          <button type="button" aria-pressed={naming === "german"} onClick={() => t.setNaming("german")}>H</button>
          <button type="button" aria-pressed={naming === "english"} onClick={() => t.setNaming("english")}>B</button>
        </div>
      </footer>
    </main>
  );
}

/** Triads by heart, in its own practice boundary: one writer of the card box at a time. */
export function TriadsView({ input, onExit }: { input: InputApi; onExit?: () => void }) {
  return (
    <PracticeWindowBoundary onExit={onExit ?? (() => undefined)}>
      <TriadDrill input={input} />
    </PracticeWindowBoundary>
  );
}

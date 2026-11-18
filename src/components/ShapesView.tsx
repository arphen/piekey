import { memo, useEffect, useMemo, useState } from "react";
import { usePlayer } from "../audio/usePlayer";
import { DRILL_LABELS, fretboardNotes, harmonicMinorShapes, parentScales, rootShape, shapeDrill, spell, type ScaleShape, type ShapeDrill } from "../core";
import type { ChordInBar, FretNote, Position } from "../core/contract";

import { buildMinorVamp } from "../core/tunes/autumnLeaves";
import { intervalToDegree, mod } from "../musicTheory";
import { Fretboard, type LabelMode } from "./Fretboard";
import { useKey } from "./keyContext";
import { ChordSymbol } from "./LeadSheet";
import { Transport } from "./Transport";

const DRILLS: ShapeDrill[] = ["run", "threes", "thirds"];

/** Three-notes-per-string harmonic minor shapes, drilled over an i(maj7)–V7 vamp. */
export function ShapesView() {
  const key = useKey();
  // the root-to-root shape first, then the seven 3NPS shapes up the neck
  const shapes = useMemo(() => [rootShape(key), ...harmonicMinorShapes(key)], [key]);
  const [shapeIdx, setShapeIdx] = useState(0);
  const [drill, setDrill] = useState<ShapeDrill | null>("run");
  const [labels, setLabels] = useState<LabelMode>("degrees");
  const [hideNotes, setHideNotes] = useState(false);
  const [audible, setAudible] = useState(true);

  const shape = shapes[shapeIdx];
  const drilled = useMemo(() => (drill ? shapeDrill(shape, drill) : null), [shape, drill]);
  const vamp = useMemo(() => buildMinorVamp(key, drilled?.bars ?? 4), [key, drilled?.bars]);
  const player = usePlayer(vamp);

  const { setLoop, setPattern } = player;
  useEffect(() => setLoop(0, vamp.bars.length - 1), [vamp, setLoop]);
  useEffect(() => setPattern(drilled?.steps ?? null, audible), [drilled, audible, setPattern]);

  // ← / → step through the shapes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowRight") setShapeIdx((i) => (i + 1) % 8);
      if (e.key === "ArrowLeft") setShapeIdx((i) => (i + 7) % 8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const playing = player.isPlaying && player.currentBar >= 0;
  const barIdx = playing ? player.currentBar : 0;
  const chord = vamp.bars[barIdx].chords[0];
  const nextChord = vamp.bars[(barIdx + 1) % vamp.bars.length].chords[0];
  const fretCount = Math.min(22, Math.max(...shapes.map((s) => s.to)) + 1);
  const notes = useMemo(
    () => shapeNotes(shape, fretboardNotes({ chord, position: { id: "V", label: "", from: shape.from, to: shape.to }, fretCount, key }), key.tonicPc),
    [shape, chord, fretCount, key],
  );

  const scale = parentScales(key).harmMinor;
  const lt = mod(key.tonicPc - 1);
  const stretch = augSecond(shape, key.tonicPc);

  return (
    <main className="shapes-view scale-harmMinor">
      <section className="card shapes-head">
        <div>
          <h2 className="shapes-title">{scale.name}</h2>
          <p className="shapes-sub">
            3 notes per string · root-to-root + 7 shapes ·{" "}
            {scale.pcs
              .slice()
              .sort((a, b) => mod(a - key.tonicPc) - mod(b - key.tonicPc))
              .map((pc) => (
                <span key={pc} className={`shapes-pc ${pc === lt ? "is-lt" : pc === key.tonicPc ? "is-tonic" : ""}`}>
                  {spell(pc, "harmMinor", key)}
                </span>
              ))}
          </p>
        </div>
        <Transport player={player} tune={vamp} guideAudible={audible} onGuideAudible={setAudible} />
      </section>

      <section className="card shapes-main">
        <ShapePicker shapes={shapes} selected={shapeIdx} onSelect={setShapeIdx} chord={vamp.bars[0].chords[0]} />

        <header className="shapes-now">
          <div className="focus-chord">
            <span className="focus-bar">
              {shape.number === 0 ? "root to root, 2 octaves" : `shape ${shape.number}`} · frets {shape.from}–{shape.to}
            </span>
            <h2 className="focus-symbol">
              <ChordSymbol symbol={chord.symbol} />
            </h2>
            <span className="focus-next">
              <span className="focus-next-k">next</span>
              <ChordSymbol symbol={nextChord.symbol} />
            </span>
          </div>
          <ul className="shapes-tips">
            {shape.number === 0 ? (
              <li>
                Root on the A string → root on the high e. The shift happens on the G string, where the raised 7th moves up from the D
                string.
              </li>
            ) : null}
            <li>
              Starts on <strong>{shape.startName}</strong>, the {shape.startDegree} of the scale. Root{" "}
              <strong>{spell(key.tonicPc, "harmMinor", key)}</strong> appears{" "}
              {shape.notes.filter((n) => n.pc === key.tonicPc).length}×.
            </li>
            {stretch ? (
              <li>
                {stretch.from} → {stretch.to} on the <strong>{STRING_NAMES[stretch.string]}</strong> string is a 3-fret gap (index to
                pinky, not a stretch): the augmented 2nd that gives harmonic minor its sound.
              </li>
            ) : null}
            <li>
              <strong>{spell(lt, "harmMinor", key)}</strong> is the raised 7th: the 7th of {vamp.bars[0].chords[0].symbol} and the 3rd of{" "}
              {vamp.bars[1 % vamp.bars.length].chords[0].symbol}. It wants to rise a half step to {spell(key.tonicPc, "harmMinor", key)}.
            </li>
          </ul>
        </header>

        <div className="focus-board">
          <Fretboard
            notes={hideNotes ? notes.filter((n) => n.pc === key.tonicPc && n.inWindow) : notes}
            fretCount={fretCount}
            labels={labels}
            pattern={hideNotes ? null : drilled?.steps ?? null}
            activeStep={playing ? player.patternStepIndex : -1}
          />
        </div>

        <div className="focus-controls">
          <div className="seg" role="group" aria-label="drill">
            <button type="button" className={drill === null ? "is-on" : ""} onClick={() => setDrill(null)}>
              Notes
            </button>
            {DRILLS.map((d) => (
              <button type="button" key={d} className={drill === d ? "is-on" : ""} onClick={() => setDrill(d)}>
                {DRILL_LABELS[d]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="labels">
            <button type="button" className={labels === "names" ? "is-on" : ""} onClick={() => setLabels("names")}>
              C D E
            </button>
            <button type="button" className={labels === "degrees" ? "is-on" : ""} onClick={() => setLabels("degrees")}>
              1 3 5
            </button>
          </div>
          <div className="seg" role="group" aria-label="memory">
            <button type="button" className={hideNotes ? "is-on" : ""} onClick={() => setHideNotes((h) => !h)}>
              Hide notes
            </button>
          </div>
        </div>
        <p className="shapes-hint">
          ← → switch shape · space play/stop · runs and groups of 3 are triplets: one beat per string. Degrees count from{" "}
          {spell(key.tonicPc, "harmMinor", key)}; colours follow the chord that's sounding.
        </p>
      </section>
    </main>
  );
}

/** The 8 shape cards. Memoised: playback re-renders the view on every note, the thumbnails never change. */
const ShapePicker = memo(function ShapePicker({
  shapes,
  selected,
  onSelect,
  chord,
}: {
  shapes: ScaleShape[];
  selected: number;
  onSelect: (i: number) => void;
  chord: ChordInBar;
}) {
  const key = useKey();
  const thumbs = useMemo(
    () =>
      shapes.map((s) => {
        const position: Position = { id: "V", label: "", from: s.from, to: s.to };
        return { position, notes: shapeNotes(s, fretboardNotes({ chord, position, fretCount: s.to + 1, key }), key.tonicPc) };
      }),
    [shapes, chord, key],
  );
  return (
    <ol className="shape-picker" aria-label="shapes">
      {shapes.map((s, i) => (
        <li key={s.label}>
          <button
            type="button"
            className={`${i === selected ? "is-on" : ""} ${s.number === 0 ? "is-root-shape" : ""}`}
            onClick={() => onSelect(i)}
            aria-label={s.number === 0 ? `Root to root, from ${s.startName}` : `Shape ${s.number}, from ${s.startName}`}
          >
            <span className="shape-num">{s.label}</span>
            <span className="shape-from">
              {s.number === 0 ? (
                <>
                  root to root <small>({s.startName})</small>
                </>
              ) : (
                <>
                  from {s.startName} <small>({s.startDegree})</small>
                </>
              )}
            </span>
            <Fretboard notes={thumbs[i].notes} fretCount={s.to + 1} position={thumbs[i].position} compact />
          </button>
        </li>
      ))}
    </ol>
  );
});

const STRING_NAMES = ["high e", "B", "G", "D", "A", "low E"];

/** Mark the shape's own notes as "in window"; everything else in the scale stays as faint context. Degrees from the tonic. */
function shapeNotes(shape: ScaleShape, all: FretNote[], tonicPc: number): FretNote[] {
  const inShape = new Set(shape.notes.map((n) => `${n.string}-${n.fret}`));
  return all.map((n) => ({ ...n, inWindow: inShape.has(`${n.string}-${n.fret}`), degree: intervalToDegree(n.pc - tonicPc), isNextTarget: false }));
}

/** The string where the shape crosses the augmented 2nd (♭6 → 7). */
function augSecond(shape: ScaleShape, tonicPc: number) {
  for (let i = 0; i + 1 < shape.notes.length; i++) {
    const a = shape.notes[i];
    const b = shape.notes[i + 1];
    if (a.string === b.string && b.midi - a.midi === 3 && mod(b.pc - tonicPc) === 11) {
      return { string: a.string, from: intervalToDegree(a.pc - tonicPc), to: intervalToDegree(b.pc - tonicPc) };
    }
  }
  return null;
}

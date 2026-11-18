import { Fragment, memo, useContext, useEffect, useMemo, useRef } from "react";
import { fretboardNotes, parentScales, romanNumeral } from "../core";
import { legendDemo } from "../core/demos";
import { KeyContext, RomanContext, useKey } from "./keyContext";
import type { Bar, KeyInfo, ParentScaleId, Position, Tune } from "../core/contract";
import { Fretboard } from "./Fretboard";
import { HoverDemo } from "./HoverDemo";

interface LeadSheetProps {
  tune: Tune;
  position: Position;
  selectedBar: number;
  currentBar: number; // -1 when stopped
  loop: { start: number; end: number };
  onSelectBar: (index: number, extendLoop: boolean) => void;
  onLoop: (start: number, end: number) => void;
}

interface SectionGroup {
  name: string;
  start: number;
  bars: Bar[];
}

function groupSections(bars: Bar[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const bar of bars) {
    const last = groups[groups.length - 1];
    if (last && last.name === bar.section) last.bars.push(bar);
    else groups.push({ name: bar.section, start: bar.index, bars: [bar] });
  }
  return groups;
}

export function LeadSheet({ tune, position, selectedBar, currentBar, loop, onSelectBar, onLoop }: LeadSheetProps) {
  const key = useKey();
  const scales = parentScales(key);
  const sections = useMemo(() => groupSections(tune.bars), [tune]);
  const isFullLoop = loop.start === 0 && loop.end === tune.bars.length - 1;

  return (
    <section className="sheet card" aria-label="lead sheet">
      <header className="sheet-head">
        <div>
          <h2 className="sheet-title">{tune.title}</h2>
          <p className="sheet-sub">
            {tune.key} · {tune.bars.length} bars · click a bar to loop it alone · shift-click to loop a range
          </p>
        </div>
        <div className="sheet-legend">
          {Array.from(new Set(tune.bars.flatMap((b) => b.chords.map((c) => c.parentScale)))).map((id) => (
            <HoverDemo key={id} className={`scale-chip scale-${id}`} demo={() => parentDemo(tune, id, key)}>
              {scales[id].short}
            </HoverDemo>
          ))}
          {!isFullLoop ? (
            <button type="button" className="ghost-btn" onClick={() => onLoop(0, tune.bars.length - 1)}>
              Play whole tune
            </button>
          ) : null}
        </div>
      </header>

      <div className="sheet-sections">
        {sections.map((section) => (
          <div className="sheet-section" key={section.name + section.start}>
            <button
              type="button"
              className="section-tag"
              title={`Loop section ${section.name}`}
              onClick={() => onLoop(section.start, section.start + section.bars.length - 1)}
            >
              {section.name.replace(/\d$/, "")}
              <small>{section.name.match(/\d$/)?.[0] ?? ""}</small>
            </button>
            <div className="sheet-bars">
              {section.bars.map((bar) => (
                <BarCell
                  key={bar.index}
                  bar={bar}
                  prevBar={tune.bars[bar.index - 1]}
                  nextBar={tune.bars[bar.index + 1] ?? tune.bars[0]}
                  position={position}
                  selected={bar.index === selectedBar}
                  playing={bar.index === currentBar}
                  inLoop={!isFullLoop && bar.index >= loop.start && bar.index <= loop.end}
                  loopStart={!isFullLoop && bar.index === loop.start}
                  loopEnd={!isFullLoop && bar.index === loop.end}
                  onSelect={onSelectBar}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface BarCellProps {
  bar: Bar;
  prevBar?: Bar;
  nextBar: Bar;
  position: Position;
  selected: boolean;
  playing: boolean;
  inLoop: boolean;
  loopStart: boolean;
  loopEnd: boolean;
  onSelect: (index: number, extendLoop: boolean) => void;
}

const BarCell = memo(function BarCell({
  bar,
  prevBar,
  nextBar,
  position,
  selected,
  playing,
  inLoop,
  loopStart,
  loopEnd,
  onSelect,
}: BarCellProps) {
  const key = useKey();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // "start" (with scroll-margin-top clearing the pinned focus panel) keeps the playing row at the
    // top so the rows coming next stay in view; "nearest" parked it at the bottom edge.
    if (playing) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [playing]);
  const chord = bar.chords[0];
  const prevChord = prevBar?.chords[prevBar.chords.length - 1];
  const scaleChanged = prevChord !== undefined && prevChord.parentScale !== chord.parentScale;
  const notes = useMemo(
    () => fretboardNotes({ chord, prevChord, position, fretCount: position.to + 2, key }),
    [chord, prevChord, position, key],
  );

  const classes = [
    "bar",
    `scale-${chord.parentScale}`,
    selected && "is-selected",
    playing && "is-playing",
    inLoop && "in-loop",
    loopStart && "loop-start",
    loopEnd && "loop-end",
    scaleChanged && "is-switch",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      onClick={(e) => onSelect(bar.index, e.shiftKey)}
      aria-pressed={selected}
      aria-label={`Bar ${bar.index + 1}: ${bar.chords.map((c) => c.symbol).join(" ")}`}
    >
      <span className="bar-num">{bar.index + 1}</span>
      {scaleChanged ? (
        <HoverDemo
          className="bar-switch"
          demo={() => {
            const d = legendDemo("changed", { chord, prevChord, key });
            return d && { ...d, title: "Key shift: the parent scale changes" };
          }}
        >
          key shift
        </HoverDemo>
      ) : null}
      <span className="bar-chords">
        {bar.chords.map((c, i) => (
          <span key={i} className={`bar-chord ${bar.chords.length > 1 ? "is-split" : ""}`}>
            <ChordSymbol symbol={c.symbol} />
          </span>
        ))}
      </span>
      <span className="bar-scale">
        <HoverDemo demo={() => legendDemo("parent", { chord, nextChord: bar.chords[1] ?? nextBar.chords[0], key })}>
          {parentScales(key)[chord.parentScale].short}
        </HoverDemo>
      </span>
      <span className="bar-mode">
        {bar.chords.map((c, i) => (
          <Fragment key={i}>
            {i > 0 ? " · " : null}
            <HoverDemo demo={() => legendDemo("mode", { chord: c, key })}>{c.modeName}</HoverDemo>
          </Fragment>
        ))}
      </span>
      <span className="bar-mini">
        <Fretboard notes={notes} fretCount={position.to + 2} position={position} compact />
      </span>
    </button>
  );
});

/** Parent-scale chip demo: the first chord in that colour and the chord after it. */
function parentDemo(tune: Tune, id: ParentScaleId, key: KeyInfo) {
  const chords = tune.bars.flatMap((b) => b.chords);
  const i = chords.findIndex((c) => c.parentScale === id);
  return legendDemo("parent", { chord: chords[i], nextChord: chords[i + 1] ?? chords[0], key });
}

// Split "Bm7b5" into root + quality so the quality can be set as a superscript, lead-sheet style.
// With Roman numerals on, the numeral (relative to the key) sits above the symbol.
export function ChordSymbol({ symbol }: { symbol: string }) {
  const key = useContext(KeyContext);
  const roman = useContext(RomanContext);
  const match = symbol.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return <>{symbol}</>;
  const [, root, quality] = match;
  const pretty = quality.replace(/b(\d)/g, "♭$1").replace(/#(\d)/g, "♯$1").replace("maj7", "Δ7");
  const name = (
    <>
      <span className="chord-root">{root.replace("b", "♭").replace("#", "♯")}</span>
      {pretty ? <sup className="chord-qual">{pretty}</sup> : null}
    </>
  );
  const rn = roman && key ? romanNumeral(symbol, key.tonicPc) : null;
  if (!rn) return <span className="chord-sym">{name}</span>;
  return (
    <span className="chord-sym has-rn">
      <span className="chord-rn">
        {rn.numeral}
        {rn.quality ? <sup>{rn.quality}</sup> : null}
      </span>
      <span className="chord-name">{name}</span>
    </span>
  );
}

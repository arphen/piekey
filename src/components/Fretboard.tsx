import { memo, useMemo } from "react";
import type { FretNote, PatternStep, Position } from "../core/contract";

export type LabelMode = "names" | "degrees";

/** A note played by mistake, drawn as a shadow that points at the note that was meant. */
export interface FretGhost {
  key: string;
  string: number;
  fret: number;
  to: { string: number; fret: number };
}

/** A one-off ripple on a spot: the note just played. */
export interface FretPulse {
  key: string;
  string: number;
  fret: number;
  kind: "hit" | "miss";
}

interface FretboardProps {
  notes: FretNote[];
  fretCount: number;
  position?: Position;
  labels?: LabelMode;
  pattern?: PatternStep[] | null;
  activeStep?: number; // index into pattern, -1 for none
  compact?: boolean; // mini diagram: window frets only, no labels
  onFretClick?: (fret: number) => void; // makes the fret numbers clickable
  onCellClick?: (string: number, fret: number) => void; // makes every string/fret spot clickable
  ghosts?: FretGhost[];
  pulse?: FretPulse | null;
}

const STRING_NAMES = ["e", "B", "G", "D", "A", "E"];
const INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAYS = new Set([12, 24]);

interface Geometry {
  width: number;
  height: number;
  firstFret: number;
  lastFret: number;
  showNut: boolean;
  wireX: (fret: number) => number; // x of the wire at the high side of `fret`
  noteX: (fret: number) => number;
  stringY: (s: number) => number;
  radius: number;
  boardTop: number;
  boardBottom: number;
}

function buildGeometry(fretCount: number, compact: boolean, position?: Position): Geometry {
  if (compact) {
    const firstFret = Math.max(0, (position?.from ?? 1) - 1);
    const lastFret = (position?.to ?? 5) + 1;
    const cell = 22;
    const pad = 6;
    const spacing = 9;
    const boardTop = pad;
    const showNut = firstFret === 0;
    const left = pad + (showNut ? 12 : 0);
    const wireX = (fret: number) => left + (fret - firstFret) * cell;
    return {
      width: wireX(lastFret) + pad,
      height: boardTop * 2 + spacing * 5,
      firstFret,
      lastFret,
      showNut,
      wireX,
      noteX: (fret) => (fret === 0 ? left - 7 : wireX(fret) - cell / 2),
      stringY: (s) => boardTop + s * spacing,
      radius: 3.6,
      boardTop,
      boardBottom: boardTop + spacing * 5,
    };
  }

  const width = 1000;
  const nutX = 52;
  const right = 14;
  const boardW = width - nutX - right;
  const spacing = 34;
  const boardTop = 28;
  const scale = 1 - Math.pow(2, -fretCount / 12);
  const wireX = (fret: number) => nutX + ((1 - Math.pow(2, -fret / 12)) / scale) * boardW;
  return {
    width,
    height: boardTop + spacing * 5 + 40,
    firstFret: 0,
    lastFret: fretCount,
    showNut: true,
    wireX,
    noteX: (fret) => (fret === 0 ? nutX - 24 : (wireX(fret - 1) + wireX(fret)) / 2),
    stringY: (s) => boardTop + s * spacing,
    radius: 13,
    boardTop,
    boardBottom: boardTop + spacing * 5,
  };
}

export function Fretboard({
  notes,
  fretCount,
  position,
  labels = "names",
  pattern = null,
  activeStep = -1,
  compact = false,
  onFretClick,
  onCellClick,
  ghosts,
  pulse = null,
}: FretboardProps) {
  const g = useMemo(() => buildGeometry(fretCount, compact, position), [fretCount, compact, position]);
  const board = (
    <Board g={g} notes={notes} position={position} labels={labels} pattern={pattern} compact={compact} onFretClick={onFretClick} onCellClick={onCellClick} />
  );
  if (compact || !pattern || pattern.length === 0) return board;
  // The playhead lives on its own small SVG layer: a moving ring inside the board would repaint the
  // whole fretboard on every note, several times a second for as long as the loop runs.
  return (
    <div className="fb-stack">
      {board}
      <Playhead g={g} pattern={pattern} activeStep={activeStep} ghosts={ghosts} pulse={pulse} />
    </div>
  );
}

const Playhead = memo(function Playhead({
  g,
  pattern,
  activeStep,
  ghosts,
  pulse,
}: {
  g: Geometry;
  pattern: PatternStep[];
  activeStep: number;
  ghosts?: FretGhost[];
  pulse: FretPulse | null;
}) {
  const active = activeStep >= 0 ? pattern[activeStep] : undefined;
  const upcoming = activeStep >= 0 ? pattern.slice(activeStep + 1, activeStep + 3) : [];
  const start = activeStep < 0 ? pattern[0] : undefined;
  return (
    <svg className="fb fb-overlay" viewBox={`0 0 ${g.width.toFixed(0)} ${g.height.toFixed(0)}`} aria-hidden="true">
      {start ? (
        <g className="fb-start">
          <circle cx={g.noteX(start.fret)} cy={g.stringY(start.string)} r={g.radius + 6} />
          <text x={g.noteX(start.fret)} y={g.stringY(start.string) - g.radius - 10}>
            start
          </text>
        </g>
      ) : null}

      {upcoming.map((p, i) => (
        <circle
          key={`up-${i}`}
          className={`fb-upcoming fb-upcoming-${i}`}
          cx={g.noteX(p.fret)}
          cy={g.stringY(p.string)}
          r={g.radius + 4}
        />
      ))}

      {(ghosts ?? []).map((gh) => {
        if (gh.fret < g.firstFret || gh.fret > g.lastFret) return null;
        const x = g.noteX(gh.fret);
        const y = g.stringY(gh.string);
        const tx = g.noteX(gh.to.fret);
        const ty = g.stringY(gh.to.string);
        const len = Math.hypot(tx - x, ty - y);
        const r = g.radius;
        // the thread runs from the edge of the shadow to the edge of the note that was meant
        const ux = len ? (tx - x) / len : 0;
        const uy = len ? (ty - y) / len : 0;
        return (
          <g key={gh.key} className="fb-ghost">
            {len > 2 * r + 12 ? <line x1={x + ux * (r + 2)} y1={y + uy * (r + 2)} x2={tx - ux * (r + 9)} y2={ty - uy * (r + 9)} /> : null}
            <circle cx={x} cy={y} r={r} />
          </g>
        );
      })}

      {pulse ? <circle key={pulse.key} className={`fb-pulse is-${pulse.kind}`} cx={g.noteX(pulse.fret)} cy={g.stringY(pulse.string)} r={g.radius + 6} /> : null}

      {active ? (
        <circle
          key={`active-${activeStep}`}
          className="fb-active"
          cx={g.noteX(active.fret)}
          cy={g.stringY(active.string)}
          r={g.radius + 6}
        />
      ) : null}
    </svg>
  );
});

/** Everything that only changes with the chord, not with each note. */
const Board = memo(function Board({
  g,
  notes,
  position,
  labels,
  pattern,
  compact,
  onFretClick,
  onCellClick,
}: {
  g: Geometry;
  notes: FretNote[];
  position?: Position;
  labels: LabelMode;
  pattern: PatternStep[] | null;
  compact: boolean;
  onFretClick?: (fret: number) => void;
  onCellClick?: (string: number, fret: number) => void;
}) {
  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (n) => n.fret >= g.firstFret && n.fret <= g.lastFret && (!compact || n.inWindow),
      ),
    [notes, g, compact],
  );

  const frets: number[] = [];
  for (let f = g.firstFret; f <= g.lastFret; f += 1) frets.push(f);

  const windowRect =
    position && !compact
      ? {
          x: position.from === 0 ? g.noteX(0) - g.radius - 6 : g.wireX(position.from - 1),
          w: g.wireX(position.to) - (position.from === 0 ? g.noteX(0) - g.radius - 6 : g.wireX(position.from - 1)),
        }
      : null;

  const patternPath =
    pattern && pattern.length > 1 && !compact
      ? pattern.map((p, i) => `${i === 0 ? "M" : "L"}${g.noteX(p.fret).toFixed(1)},${g.stringY(p.string).toFixed(1)}`).join(" ")
      : null;

  return (
    <svg
      className={`fb ${compact ? "fb--compact" : "fb--full"}`}
      viewBox={`0 0 ${g.width.toFixed(0)} ${g.height.toFixed(0)}`}
      role="img"
      aria-label="fretboard"
    >
      <rect
        className="fb-wood"
        x={g.showNut ? g.wireX(0) : g.wireX(g.firstFret)}
        y={g.boardTop - (compact ? 3 : 10)}
        width={g.wireX(g.lastFret) - (g.showNut ? g.wireX(0) : g.wireX(g.firstFret))}
        height={g.boardBottom - g.boardTop + (compact ? 6 : 20)}
        rx={compact ? 2 : 6}
      />

      {windowRect ? (
        <rect
          className="fb-window"
          x={windowRect.x}
          y={g.boardTop - 16}
          width={windowRect.w}
          height={g.boardBottom - g.boardTop + 32}
          rx={10}
        />
      ) : null}

      {!compact &&
        frets
          .filter((f) => INLAYS.has(f) || DOUBLE_INLAYS.has(f))
          .map((f) => {
            const x = g.noteX(f);
            const mid = (g.boardTop + g.boardBottom) / 2;
            return DOUBLE_INLAYS.has(f) ? (
              <g key={`inlay-${f}`} className="fb-inlay">
                <circle cx={x} cy={g.stringY(1) + 17} r={5} />
                <circle cx={x} cy={g.stringY(3) + 17} r={5} />
              </g>
            ) : (
              <circle key={`inlay-${f}`} className="fb-inlay" cx={x} cy={mid} r={5} />
            );
          })}

      {frets
        .filter((f) => f > 0 || !g.showNut)
        .map((f) => (
          <line
            key={`wire-${f}`}
            className="fb-wire"
            x1={g.wireX(f)}
            x2={g.wireX(f)}
            y1={g.boardTop - (compact ? 3 : 10)}
            y2={g.boardBottom + (compact ? 3 : 10)}
          />
        ))}

      {g.showNut ? (
        <rect
          className="fb-nut"
          x={g.wireX(0) - (compact ? 1.5 : 4)}
          y={g.boardTop - (compact ? 3 : 10)}
          width={compact ? 3 : 7}
          height={g.boardBottom - g.boardTop + (compact ? 6 : 20)}
          rx={1.5}
        />
      ) : null}

      {STRING_NAMES.map((name, s) => (
        <g key={name + s}>
          <line
            className="fb-string"
            x1={g.showNut ? (compact ? g.wireX(0) : g.noteX(0) - g.radius) : g.wireX(g.firstFret)}
            x2={g.wireX(g.lastFret)}
            y1={g.stringY(s)}
            y2={g.stringY(s)}
            strokeWidth={compact ? 0.6 + s * 0.12 : 1 + s * 0.35}
          />
          {!compact ? (
            <text className="fb-string-name" x={10} y={g.stringY(s) + 4}>
              {name}
            </text>
          ) : null}
        </g>
      ))}

      {!compact &&
        frets
          .filter((f) => f > 0)
          .map((f) => {
            const num = (
              <text
                className={`fb-fret-num ${position && f >= position.from && f <= position.to ? "is-in" : ""}`}
                x={g.noteX(f)}
                y={g.boardBottom + 32}
              >
                {f}
              </text>
            );
            if (!onFretClick) return <g key={`num-${f}`}>{num}</g>;
            return (
              <g
                key={`num-${f}`}
                className="fb-fret-hit"
                role="button"
                tabIndex={0}
                aria-label={`Move the window to fret ${f}`}
                onClick={() => onFretClick(f)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onFretClick(f);
                  }
                }}
              >
                <rect x={g.noteX(f) - 16} y={g.boardBottom + 14} width={32} height={26} rx={6} />
                {num}
              </g>
            );
          })}

      {patternPath ? <path className="fb-path" d={patternPath} /> : null}

      {visibleNotes.map((n) => {
        const x = g.noteX(n.fret);
        const y = g.stringY(n.string);
        const big = n.role !== "scale";
        const r = compact ? (big ? g.radius : g.radius * 0.7) : big ? g.radius : g.radius * 0.78;
        return (
          <g
            key={`${n.string}-${n.fret}`}
            className={`fb-note role-${n.role} ${n.inWindow ? "" : "is-out"} ${n.isNextTarget ? "is-target" : ""}`}
          >
            {n.isNextTarget && !compact ? <circle className="fb-target-ring" cx={x} cy={y} r={r + 5} /> : null}
            {n.role === "changed" && !compact ? <circle className="fb-changed-pulse" cx={x} cy={y} r={r + 3} /> : null}
            <circle className="fb-dot" cx={x} cy={y} r={r} />
            {!compact ? (
              <text className="fb-label" x={x} y={y + 4}>
                {labels === "names" ? n.name : n.degree}
              </text>
            ) : null}
          </g>
        );
      })}

      {!compact && onCellClick ? (
        <g className="fb-cell-hits">
          {STRING_NAMES.map((sName, s) =>
            frets.map((f) => {
              const left = f === 0 ? g.noteX(0) - 18 : g.wireX(f - 1);
              const right = f === 0 ? g.wireX(0) : g.wireX(f);
              const y = g.stringY(s) - 16;
              return (
                <rect
                  key={`cell-${s}-${f}`}
                  className="fb-cell-hit"
                  x={left}
                  y={y}
                  width={Math.max(12, right - left)}
                  height={32}
                  rx={4}
                  role="button"
                  tabIndex={0}
                  aria-label={`${sName} string, ${f === 0 ? "open" : `fret ${f}`}`}
                  onClick={() => onCellClick(s, f)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCellClick(s, f);
                    }
                  }}
                />
              );
            }),
          )}
        </g>
      ) : null}
    </svg>
  );
});

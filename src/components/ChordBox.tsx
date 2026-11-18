import { memo } from "react";
import type { Voicing } from "../song/voicings";

// A chord box as guitarists read them: strings upright (low E on the left), frets going down,
// each fretted note labelled with its job in the chord. Strings left out are marked ×.

interface ChordBoxProps {
  voicing: Voicing;
  heard?: number[]; // pitch classes ringing now: their dots light up
  size?: "big" | "small";
}

const FRETS = 5;

export const ChordBox = memo(function ChordBox({ voicing, heard, size = "big" }: ChordBoxProps) {
  const frets = voicing.notes.map((n) => n.fret);
  const fretted = frets.filter((f) => f > 0);
  const lowest = fretted.length ? Math.min(...fretted) : 1;
  const base = Math.max(1, Math.max(...frets) <= FRETS ? 1 : lowest);
  const rows = Math.max(FRETS, Math.max(...frets) - base + 1);
  const W = 150;
  const H = 190;
  const left = 22;
  const top = 34;
  const gap = (W - left - 14) / 5;
  const row = (H - top - 14) / rows;
  const x = (string: number) => left + (5 - string) * gap; // string 5 (low E) on the left
  const used = new Set(voicing.notes.map((n) => n.string));
  const lit = new Set(heard ?? []);

  return (
    <svg className={`chordbox chordbox--${size}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="chord shape">
      {base === 1 ? <rect className="cb-nut" x={left - 1} y={top - 5} width={gap * 5 + 2} height={5} rx={1} /> : null}
      {base > 1 ? (
        <text className="cb-base" x={4} y={top + row / 2 + 4}>
          {base}
        </text>
      ) : null}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line key={`f${i}`} className="cb-fret" x1={left} x2={left + gap * 5} y1={top + i * row} y2={top + i * row} />
      ))}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={`s${s}`} className="cb-string" x1={x(s)} x2={x(s)} y1={top} y2={top + rows * row} />
      ))}
      {Array.from({ length: 6 }, (_, s) =>
        used.has(s) ? null : (
          <text key={`x${s}`} className="cb-mute" x={x(s)} y={top - 11}>
            ×
          </text>
        ),
      )}
      {voicing.notes.map((n) =>
        n.fret === 0 ? (
          <circle key={n.string} className={`cb-open ${lit.has(n.midi % 12) ? "is-lit" : ""}`} cx={x(n.string)} cy={top - 14} r={6} />
        ) : (
          <g key={n.string} className={`cb-note ${n.label === "R" ? "is-root" : ""} ${lit.has(n.midi % 12) ? "is-lit" : ""}`}>
            <circle cx={x(n.string)} cy={top + (n.fret - base + 0.5) * row} r={11} />
            <text x={x(n.string)} y={top + (n.fret - base + 0.5) * row + 4}>
              {n.label}
            </text>
          </g>
        ),
      )}
    </svg>
  );
});

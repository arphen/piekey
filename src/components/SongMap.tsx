import type { CSSProperties } from "react";
import { R_MAJOR, R_MINOR, R_TUNES, TREE_SIZE, type TreeNode } from "../song/tree";
import { MAP_VIEW, type PracticeMap } from "../overview/map";

// The home map, drawn: the circle of fifths with each key's drills growing out of it and the
// library's songs hanging off the rim beside the key they are in. Keys light up as their songs
// and drills climb the card box. Songs are real buttons laid over the drawing, so the mouse,
// touch and the played cursor all reach them.

const MID = TREE_SIZE / 2;
const pct = (value: number, from: number, size: number) => `${(((value - from) / size) * 100).toFixed(3)}%`;
const short = (label: string) => (label.length > 24 ? `${label.slice(0, 23)}…` : label);

/** Which way a song's name runs from its node: outwards from the circle. */
function side(n: TreeNode): "left" | "right" | "top" | "bottom" {
  const dx = n.x - MID;
  if (Math.abs(dx) < 70) return n.y < MID ? "top" : "bottom";
  return dx > 0 ? "right" : "left";
}

export function SongMap({ map, sessionIds, leadId, selectedId, onSelect }: {
  map: PracticeMap;
  sessionIds: ReadonlySet<string>;
  leadId: string | null;
  selectedId: string | null;
  onSelect(id: string | null): void;
}) {
  const at = new Map(map.nodes.map((n) => [n.id, n]));
  const songs = map.nodes.filter((n) => n.kind === "tune");
  const sessionHubs = new Set(map.edges.filter((e) => e.to.startsWith("tune:") && sessionIds.has(e.to.slice(5))).map((e) => e.from));
  return (
    <div className="hm-map" onClick={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
      <div className="hm-stage" style={{ "--vw": MAP_VIEW.w, "--vh": MAP_VIEW.h } as CSSProperties}>
        <svg viewBox={`${MAP_VIEW.x} ${MAP_VIEW.y} ${MAP_VIEW.w} ${MAP_VIEW.h}`} aria-hidden="true" onClick={() => onSelect(null)}>
          <defs>
            <radialGradient id="hm-core">
              <stop offset="0" stopColor="#e0a956" stopOpacity="0.13" />
              <stop offset="0.55" stopColor="#e0a956" stopOpacity="0.035" />
              <stop offset="1" stopColor="#e0a956" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={MID} cy={MID} r={R_TUNES + 40} fill="url(#hm-core)" />
          <circle className="hm-track" cx={MID} cy={MID} r={R_TUNES} />
          <circle className="hm-track is-strong" cx={MID} cy={MID} r={R_MAJOR} />
          <circle className="hm-track" cx={MID} cy={MID} r={R_MINOR} />
          <g className="hm-edges">
            {map.edges.map((e) => {
              const a = at.get(e.from);
              const b = at.get(e.to);
              if (!a || !b) return null;
              const toSong = b.kind === "tune";
              const inSession = toSong && sessionIds.has(b.id.slice(5));
              return <line key={`${e.from}>${e.to}`} className={`${e.on ? "is-on" : ""} ${toSong ? "to-song" : ""} ${inSession ? "is-session" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </g>
          {map.nodes.filter((n) => n.kind !== "tune").map((n) => {
            const hub = n.kind === "major" || n.kind === "minor";
            return (
              <g key={n.id} className={`hm-node hm-${n.kind} ${n.fill > 0 ? "is-seen" : ""} ${sessionHubs.has(n.id) ? "is-session" : ""}`} transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`}>
                <circle className="hm-dot" r={n.r} style={{ fillOpacity: hub ? 0.06 + 0.3 * n.fill : 0.15 + 0.85 * n.fill } as CSSProperties} />
                {hub && n.fill > 0 ? <circle className="hm-arc" r={n.r} pathLength={1} strokeDasharray={`${n.fill.toFixed(3)} 1`} transform="rotate(-90)" /> : null}
                {hub ? <text dy="0.36em">{n.label}</text> : null}
              </g>
            );
          })}
        </svg>
        {songs.map((n) => {
          const id = n.id.slice(5);
          const where = side(n);
          return (
            <button
              key={n.id}
              type="button"
              className={`hm-song is-${where} ${sessionIds.has(id) ? "is-session" : ""} ${leadId === id ? "is-lead" : ""} ${selectedId === id ? "is-selected" : ""}`}
              style={{ left: pct(n.x, MAP_VIEW.x, MAP_VIEW.w), top: pct(n.y, MAP_VIEW.y, MAP_VIEW.h), "--fill": n.fill.toFixed(3) } as CSSProperties}
              aria-pressed={selectedId === id}
              aria-label={`${n.label}${sessionIds.has(id) ? ", in next session" : ""}`}
              onClick={() => onSelect(selectedId === id ? null : id)}
            >
              <span className="hm-song-disc" aria-hidden="true"><i /></span>
              <span className="hm-song-name">{short(n.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

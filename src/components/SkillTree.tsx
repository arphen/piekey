import { TREE_SIZE, type TreeEdge, type TreeNode } from "../song/tree";

// The player's map, drawn: keys on the circle of fifths, their skills growing out of them, tunes
// hanging off the key they are in. What a node holds shows as how full it is; what moved in the
// session just played gets a ring.

const MID = TREE_SIZE / 2;
const PAD = 96; // room either side for the tunes' names
const short = (label: string) => (label.length > 16 ? `${label.slice(0, 15)}…` : label);

/** A tune's name, set outside the rim: beside the node at the sides of the circle, above or below it at the top and bottom. */
function tuneLabel(n: TreeNode) {
  const dx = n.x - MID;
  if (Math.abs(dx) < 70) return { x: 0, y: n.y < MID ? -n.r - 7 : n.r + 15, anchor: "middle" as const };
  return { x: dx > 0 ? n.r + 6 : -n.r - 6, y: 4, anchor: dx > 0 ? ("start" as const) : ("end" as const) };
}

export function SkillTree({ nodes, edges }: { nodes: TreeNode[]; edges: TreeEdge[] }) {
  const at = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg className="st" viewBox={`${-PAD} -22 ${TREE_SIZE + 2 * PAD} ${TREE_SIZE + 44}`} role="img" aria-label="what has been practised, on the circle of fifths">
      <g className="st-edges">
        {edges.map((e) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          return a && b ? <line key={`${e.from}>${e.to}`} className={e.on ? "is-on" : ""} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null;
        })}
      </g>
      {nodes.map((n) => {
        const hub = n.kind === "major" || n.kind === "minor";
        return (
          <g key={n.id} className={`st-node st-${n.kind} ${n.fill > 0 ? "is-seen" : ""} ${n.lit ? "is-lit" : ""}`} transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`}>
            <title>{`${n.title}${n.fill > 0 ? ` · ${Math.round(n.fill * 100)}%` : ""}`}</title>
            <circle className="st-dot" r={n.r} style={{ fillOpacity: hub ? 0.05 + 0.2 * n.fill : n.fill }} />
            {hub && n.fill > 0 ? <circle className="st-arc" r={n.r} pathLength={1} strokeDasharray={`${n.fill.toFixed(3)} 1`} transform="rotate(-90)" /> : null}
            {hub ? <text dy="0.36em">{n.label}</text> : null}
            {n.kind === "tune" ? (
              <text x={tuneLabel(n).x} y={tuneLabel(n).y} textAnchor={tuneLabel(n).anchor}>
                {short(n.label)}
              </text>
            ) : null}
            {n.lit ? <circle className="st-halo" r={n.r + 4} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

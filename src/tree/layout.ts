import type { Heading, LinkShape, PlacedEdge, PlacedGroup, PlacedNode, ResolvedTree, TreeLinkSpec, TreeSpec } from "./model";

// Derives every position and link path from a tree spec. Pure and deterministic.

const RAD = Math.PI / 180;
const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Bearing of b seen from a: degrees clockwise from up. */
export function bearingOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return norm(Math.atan2(b.x - a.x, -(b.y - a.y)) / RAD);
}

/** A point at a bearing and distance from a centre. */
export function polarPoint(cx: number, cy: number, radius: number, bearing: number): { x: number; y: number } {
  return { x: cx + Math.sin(bearing * RAD) * radius, y: cy - Math.cos(bearing * RAD) * radius };
}

const f = (n: number) => n.toFixed(1);

/** A path between two points that do not share an orbit. */
export function linkPath(a: { x: number; y: number }, b: { x: number; y: number }, shape: LinkShape = "line", bend = 0): string {
  if (shape === "line" || (shape === "curve" && !bend)) return `M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}`;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  if (shape === "s") {
    const k = bend || 14;
    return `M ${f(a.x)} ${f(a.y)} C ${f(a.x + dx * 0.34 + nx * k)} ${f(a.y + dy * 0.34 + ny * k)}, ${f(a.x + dx * 0.72 - nx * k * 0.75)} ${f(a.y + dy * 0.72 - ny * k * 0.75)}, ${f(b.x)} ${f(b.y)}`;
  }
  return `M ${f(a.x)} ${f(a.y)} Q ${f((a.x + b.x) / 2 + nx * bend)} ${f((a.y + b.y) / 2 + ny * bend)} ${f(b.x)} ${f(b.y)}`;
}

/** The shorter arc along a circle between two points on it. */
export function orbitPath(radius: number, a: PlacedNode, b: PlacedNode): string {
  const delta = norm(b.bearing - a.bearing);
  const sweep = delta <= 180 ? 1 : 0; // clockwise when the short way round is clockwise
  return `M ${f(a.x)} ${f(a.y)} A ${f(radius)} ${f(radius)} 0 0 ${sweep} ${f(b.x)} ${f(b.y)}`;
}

function headingFor(heading: Heading | undefined, origin: { x: number; y: number }, at: { x: number; y: number }): number {
  if (typeof heading === "number") return heading;
  if (!heading) return 0;
  const out = Math.hypot(at.x - origin.x, at.y - origin.y) < 1e-6 ? 0 : bearingOf(origin, at);
  return heading === "outward" ? out : norm(out + 180);
}

export function resolveTree<D>(spec: TreeSpec<D>): ResolvedTree<D> {
  const byGroup = new Map<string, TreeSpec<D>["nodes"][number][]>();
  for (const n of spec.nodes) byGroup.set(n.group, [...(byGroup.get(n.group) ?? []), n]);

  const groups = new Map<string, PlacedGroup>();
  const byId = new Map<string, PlacedNode<D>>();
  const nodes: PlacedNode<D>[] = [];
  for (const g of spec.groups) {
    const anchor = g.anchor ? byId.get(g.anchor) : undefined;
    if (g.anchor && !anchor) continue; // its anchor is not in this tree: neither is the group
    const centre = anchor ? { x: anchor.x, y: anchor.y } : { x: g.x ?? spec.origin.x, y: g.y ?? spec.origin.y };
    const heading = headingFor(g.heading, spec.origin, centre);
    const placedGroup: PlacedGroup = { id: g.id, ...centre, heading, orbits: g.orbits };
    groups.set(g.id, placedGroup);
    for (const n of byGroup.get(g.id) ?? []) {
      const bearing = norm(heading + n.angle);
      const p = polarPoint(centre.x, centre.y, g.orbits[n.orbit] ?? 0, bearing);
      const placed: PlacedNode<D> = { ...n, ...p, bearing, outward: bearingOf(spec.origin, p) };
      byId.set(n.id, placed);
      nodes.push(placed);
    }
  }

  const edges: PlacedEdge[] = [];
  for (const a of nodes)
    for (const raw of a.out ?? []) {
      const link: TreeLinkSpec = typeof raw === "string" ? { to: raw } : raw;
      const b = byId.get(link.to);
      if (!b) continue;
      const group = groups.get(a.group)!;
      const radius = group.orbits[a.orbit] ?? 0;
      const sameOrbit = a.group === b.group && a.orbit === b.orbit && radius > 0;
      edges.push({
        id: `${a.id}>${b.id}`,
        from: a.id,
        to: b.id,
        d: sameOrbit ? orbitPath(radius, a, b) : linkPath(a, b, link.shape, link.bend),
        shape: sameOrbit ? "orbit" : link.shape ?? "line",
        kind: link.kind,
      });
    }

  const bounds = nodes.reduce(
    (acc, n) => ({ minX: Math.min(acc.minX, n.x - n.size), minY: Math.min(acc.minY, n.y - n.size), maxX: Math.max(acc.maxX, n.x + n.size), maxY: Math.max(acc.maxY, n.y + n.size) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return { nodes, byId, edges, groups, bounds };
}

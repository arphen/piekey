// A passive tree described the way Path of Building describes Path of Exile's: groups placed in
// tree space, each with a set of orbit radii; nodes sit on an orbit of their group at an angle;
// `out` lists the links a node grows. Positions are derived, never stored, so a layout change is a
// change to the spec, and a new kind of node is a new entry, not new drawing code.
//
// Angles are degrees clockwise from straight up (PoB's convention: x = sin, y = −cos). A group may
// be pinned to a node placed before it and turned to face away from (or towards) the tree's origin,
// which is how a key's branch grows outward from its hub wherever the hub happens to be.
//
// Progress (how far a node has come) is kept apart from the spec: the spec is static layout and
// meaning, progress changes with every session.

/** What a node is, which decides its frame: PoB's ClassStart / Keystone / Normal / Notable / Socket. */
export type TreeNodeKind =
  | "core" // the centre the session launches from
  | "petal" // a discipline orbiting the core
  | "hub" // a key on the circle of fifths
  | "skill" // a small exercise growing from a hub
  | "notable" // a larger, named exercise (a foundation) hung on a branch
  | "song"; // a tune, on the rim

export type Heading = number | "outward" | "inward";

export interface TreeGroupSpec {
  id: string;
  /** Centre in tree space; ignored when `anchor` is set. */
  x?: number;
  y?: number;
  /** Place the group on an earlier group's node. */
  anchor?: string;
  /** Where local angle 0 points: a bearing, or away from / towards the origin (for anchored groups). */
  heading?: Heading;
  /** Radius of each orbit, by index; nodes name the index. */
  orbits: readonly number[];
}

export type LinkShape = "line" | "curve" | "s";

export interface TreeLinkSpec {
  to: string;
  /** Path between nodes that do not share an orbit. Shared orbits always draw as an arc. */
  shape?: LinkShape;
  /** Sideways offset of a curve's control point, in tree units (sign picks the side). */
  bend?: number;
  /** Free tag for styling (`data-link`), e.g. "fifth", "relative", "chain". */
  kind?: string;
}

export interface TreeNodeSpec<D = unknown> {
  id: string;
  kind: TreeNodeKind;
  group: string;
  orbit: number;
  /** Degrees from the group's heading, clockwise. */
  angle: number;
  label: string;
  /** Long form for tooltips and accessible names. */
  title?: string;
  /** Colour family (`data-family`): what kind of practice this is, so groups read at a glance. */
  family: string;
  /** Drawn radius in tree units. */
  size: number;
  out?: readonly (string | TreeLinkSpec)[];
  /** Domain payload, passed through layout untouched. */
  data?: D;
}

export interface TreeSpec<D = unknown> {
  /** The point "outward" and "inward" headings are measured from. */
  origin: { x: number; y: number };
  /** Resolved in order: an anchored group must come after the group holding its anchor. */
  groups: readonly TreeGroupSpec[];
  nodes: readonly TreeNodeSpec<D>[];
}

export interface PlacedNode<D = unknown> extends TreeNodeSpec<D> {
  x: number;
  y: number;
  /** Absolute bearing the node sits at from its group centre. */
  bearing: number;
  /** Bearing of the node from the tree's origin, for placing labels outward. */
  outward: number;
}

export interface PlacedEdge {
  id: string;
  from: string;
  to: string;
  /** SVG path in tree space. */
  d: string;
  shape: LinkShape | "orbit";
  kind?: string;
}

export interface PlacedGroup {
  id: string;
  x: number;
  y: number;
  heading: number;
  orbits: readonly number[];
}

export interface ResolvedTree<D = unknown> {
  nodes: PlacedNode<D>[];
  byId: ReadonlyMap<string, PlacedNode<D>>;
  edges: PlacedEdge[];
  groups: ReadonlyMap<string, PlacedGroup>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** How far a node has come, apart from where it is. */
export interface NodeProgress {
  /** 0..1: how far up the card box. */
  fill: number;
  /** Tempo now, where it started and where it is going. */
  tempo?: { bpm: number; start: number; goal: number };
  box?: number;
  /** Not open yet: what it builds on is not far enough along. */
  locked?: boolean;
  /** Moved in the session just played. */
  lit?: boolean;
  /** Extra state for styling, rendered as `is-<tag>` classes. */
  tags?: readonly string[];
}

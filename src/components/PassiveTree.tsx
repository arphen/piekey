import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { NodeProgress, PlacedEdge, PlacedNode, ResolvedTree, TreeNodeKind } from "../tree/model";

// Draws a resolved passive tree. It knows nothing of music: each node kind has a skin that draws it
// (an SVG part at the node, an HTML part with the node's real buttons), and the host says which
// state classes a node or link carries. Everything drawn carries `data-kind`, `data-family` and,
// for links, `data-link`/`data-shape`, so the look can be restyled from CSS and skins alone.

export interface TreeView {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeSkinProps<D> {
  node: PlacedNode<D>;
  progress: NodeProgress | undefined;
  /** State classes chosen by the host ("is-selected is-focus …"). */
  state: string;
  /** The node's place in the HTML layer, as stage percentages. */
  at: CSSProperties;
}

export interface NodeSkin<D> {
  /** Drawn inside a group translated to the node. */
  svg?(props: NodeSkinProps<D>): ReactNode;
  /** Real buttons over the node, so the mouse and the guitar cursor both reach it. */
  html?(props: NodeSkinProps<D>): ReactNode;
}

export type TreeSkins<D> = Partial<Record<TreeNodeKind, NodeSkin<D>>>;

/** Lower layers first: links under everything, then the small nodes, then the large. */
const LAYERS: TreeNodeKind[] = ["skill", "notable", "hub", "core", "petal", "song"];

const pct = (value: number, from: number, size: number) => `${(((value - from) / size) * 100).toFixed(3)}%`;

export function stagePoint(view: TreeView, x: number, y: number): CSSProperties {
  return { left: pct(x, view.x, view.w), top: pct(y, view.y, view.h) };
}

/** `is-<tag>` classes from a node's progress. */
export function progressClasses(p: NodeProgress | undefined): string {
  if (!p) return "";
  return [p.fill > 0 ? "is-seen" : "", p.locked ? "is-locked" : "", p.lit ? "is-lit" : "", ...(p.tags ?? []).map((t) => `is-${t}`)].filter(Boolean).join(" ");
}

export function PassiveTree<D>({
  tree,
  view,
  progress,
  skins,
  nodeState,
  edgeState,
  defs,
  underlay,
  overlay,
  children,
  className = "",
  onBackground,
}: {
  tree: ResolvedTree<D>;
  view: TreeView;
  progress: ReadonlyMap<string, NodeProgress>;
  skins: TreeSkins<D>;
  nodeState?(node: PlacedNode<D>): string;
  edgeState?(edge: PlacedEdge, from: PlacedNode<D>, to: PlacedNode<D>): string;
  defs?: ReactNode;
  /** SVG drawn under the links (guides, auras). */
  underlay?: ReactNode;
  /** SVG drawn between the links and the nodes (live conduits). */
  overlay?: ReactNode;
  /** HTML drawn on top (popovers, the core's button). */
  children?: ReactNode;
  className?: string;
  onBackground?(): void;
}) {
  const states = new Map(tree.nodes.map((n) => [n.id, `${progressClasses(progress.get(n.id))} ${nodeState?.(n) ?? ""}`.trim()]));
  const layered = LAYERS.flatMap((kind) => tree.nodes.filter((n) => n.kind === kind));
  const props = (node: PlacedNode<D>): NodeSkinProps<D> => ({ node, progress: progress.get(node.id), state: states.get(node.id) ?? "", at: stagePoint(view, node.x, node.y) });

  return (
    <div className={`pt-stage ${className}`} style={{ "--vw": view.w, "--vh": view.h } as CSSProperties}>
      <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} aria-hidden="true" onClick={onBackground}>
        {defs ? <defs>{defs}</defs> : null}
        {underlay}
        <g className="pt-edges">
          {tree.edges.map((e) => {
            const a = tree.byId.get(e.from)!;
            const b = tree.byId.get(e.to)!;
            return (
              <path
                key={e.id}
                d={e.d}
                className={`pt-edge ${edgeState?.(e, a, b) ?? ""}`}
                data-link={e.kind}
                data-shape={e.shape}
                data-family={b.family}
                data-from-kind={a.kind}
                data-to-kind={b.kind}
              />
            );
          })}
        </g>
        {overlay}
        <g className="pt-nodes">
          {layered.map((n) => {
            const skin = skins[n.kind];
            if (!skin?.svg) return null;
            return (
              <g key={n.id} className={`pt-node ${states.get(n.id) ?? ""}`} data-kind={n.kind} data-family={n.family} transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`}>
                {skin.svg(props(n))}
              </g>
            );
          })}
        </g>
      </svg>
      {layered.map((n) => {
        const html = skins[n.kind]?.html;
        return html ? <Fragment key={n.id}>{html(props(n))}</Fragment> : null;
      })}
      {children}
    </div>
  );
}

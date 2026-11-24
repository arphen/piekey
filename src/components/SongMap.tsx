import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MID, homeTreeProgress, homeTreeSpec, homeView, tempoShare, type HomeNodeData, type KeystoneFocus } from "../overview/homeTree";
import type { MapSong, PracticeMap } from "../overview/map";
import type { CenterPlan, TreeFocus } from "../song/keyStudy";
import type { CardState } from "../song/leitner";
import type { TechniqueKind } from "../song/technique";
import { linkPath, polarPoint, resolveTree } from "../tree/layout";
import type { PlacedEdge, PlacedNode } from "../tree/model";
import { Glyph, type UtilityGlyphName } from "./Glyph";
import type { GlyphName } from "../overview/modes";
import { PassiveTree, stagePoint, type TreeSkins, type TreeView } from "./PassiveTree";
import {
  CoreMedallion,
  HubMedallion,
  KeystoneFrame,
  NotableFrame,
  PetalCradle,
  SkillBlossom,
  SongMedallion,
  TravelBead,
  WisteriaDefs,
  WisteriaUnderlay,
} from "./WisteriaArt";

// Home's passive tree: the circle of fifths with each key's exercises growing from it, the
// foundations hung in the keys tunes rarely visit, the songs on the rim and the launch core at the
// centre. Layout comes from `homeTreeSpec`, drawing from `PassiveTree`; this file decides what
// each node looks like (its skin), which state it is in, and what clicking it does.

type Node = PlacedNode<HomeNodeData>;
type Hovered = { id: string; hubId: string | null; title: string; detail: string };

const short = (label: string) => (label.length > 24 ? `${label.slice(0, 23)}…` : label);
const additive = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, mix: boolean) => event.shiftKey || event.metaKey || event.ctrlKey || mix;

function side(node: { x: number; y: number }): "left" | "right" | "top" | "bottom" {
  const dx = node.x - MID;
  if (Math.abs(dx) < 70) return node.y < MID ? "top" : "bottom";
  return dx > 0 ? "right" : "left";
}

function kinshipHubs(hubId: string | null): Set<string> {
  const out = new Set<string>();
  const match = hubId ? /^(M|m)(\d+)$/.exec(hubId) : null;
  if (!match) return out;
  const minor = match[1] === "m";
  const pc = Number(match[2]);
  out.add(`${minor ? "M" : "m"}${minor ? (pc + 3) % 12 : (pc + 9) % 12}`);
  out.add(`${match[1]}${(pc + 7) % 12}`);
  out.add(`${match[1]}${(pc + 5) % 12}`);
  return out;
}

/** An arc of a circle around the origin, by bearing (clockwise from up). */
function arc(r: number, from: number, to: number): string {
  const a = polarPoint(0, 0, r, from);
  const b = polarPoint(0, 0, r, to);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** What a foundation trains, drawn small inside its disc. */
function FoundationGlyph({ kind, s }: { kind: TechniqueKind; s: number }) {
  const k = s / 10;
  switch (kind) {
    case "spider": // one finger per fret, climbing
      return <g>{[-4.5, -1.5, 1.5, 4.5].map((x, i) => <circle key={x} cx={x * k} cy={(3 - i * 2) * k} r={1.25 * k} />)}</g>;
    case "pyramid": // one bar, then two, three, four notes to the beat
      return <g>{[0, 1, 2, 3].map((row) => <rect key={row} x={-(1.6 + row * 1.5) * k} y={(-4.6 + row * 2.5) * k} width={(3.2 + row * 3) * k} height={1.5 * k} rx={0.7 * k} />)}</g>;
    case "skip": // across the strings
      return <g><path d={`M ${-5 * k} ${3 * k} L ${-2 * k} ${-3 * k} L ${1 * k} ${3 * k} L ${4.5 * k} ${-3 * k}`} /></g>;
    case "shift": // along the neck
      return <g><path d={`M ${-5 * k} 0 H ${5 * k} M ${2.2 * k} ${-2.6 * k} L ${5 * k} 0 L ${2.2 * k} ${2.6 * k} M ${-2.2 * k} ${-2.6 * k} L ${-5 * k} 0 L ${-2.2 * k} ${2.6 * k}`} /></g>;
    case "enclose": // into a chord tone from both sides
      return <g><circle r={1.7 * k} /><path d={`M ${-3.4 * k} ${-3.6 * k} Q ${-5.6 * k} 0 ${-3.4 * k} ${3.6 * k} M ${3.4 * k} ${-3.6 * k} Q ${5.6 * k} 0 ${3.4 * k} ${3.6 * k}`} /></g>;
  }
}

/** Icon inside each orbiting discipline petal gem. */
const PETAL_GLYPH: Record<TreeFocus, GlyphName | UtilityGlyphName> = {
  ear: "ear",
  technique: "spark",
  changes: "chords",
  triads: "harmony",
  scales: "scales",
  reading: "reading",
};

/** Three stacked notes: a triad. */
function TriadGlyph() {
  return (
    <g className="hm-k-triad">
      <path d="M 0 -6.4 L 6 4 L -6 4 Z" />
      <circle cx={0} cy={-6.4} r={2.3} />
      <circle cx={6} cy={4} r={2.3} />
      <circle cx={-6} cy={4} r={2.3} />
    </g>
  );
}

/**
 * The card for a selected node, kept inside the map: beside the node, on its outer side, or hanging
 * below it (songs, whose names sit beside them).
 */
function Popover({ node, view, below, inward, children }: { node: { x: number; y: number }; view: TreeView; below?: boolean; inward?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const toRight = (node.x >= MID) !== Boolean(inward);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const world = el.closest(".hm-world")?.getBoundingClientRect();
      if (!world) return;
      el.style.setProperty("--dx", "0px");
      el.style.setProperty("--dy", "0px");
      const r = el.getBoundingClientRect();
      const m = 14;
      const dx = r.left < world.left + m ? world.left + m - r.left : r.right > world.right - m ? world.right - m - r.right : 0;
      const dy = r.top < world.top + m ? world.top + m - r.top : r.bottom > world.bottom - m ? world.bottom - m - r.bottom : 0;
      el.style.setProperty("--dx", `${dx}px`);
      el.style.setProperty("--dy", `${dy}px`);
    };
    place();
    window.addEventListener("resize", place);
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    watch?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      watch?.disconnect();
    };
  });
  return (
    <div ref={ref} className={`hm-pop ${toRight ? "is-right" : "is-left"} ${below ? "is-below" : ""} ${inward ? "is-inward" : ""}`} style={stagePoint(view, node.x, node.y)} onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}

export function SongMap({
  songs,
  map,
  shared,
  sessionIds,
  leadId,
  selectedSongIds,
  selectedKeyIds,
  selectedFocus,
  selectedFoundation,
  centerPlan,
  mixMode,
  popover,
  onToggleMixMode,
  onClickSong,
  onClickKey,
  onClickFocus,
  onClickFoundation,
  onLaunchCenter,
  onClearSelection,
  onToggleSession,
  onAddSong,
  keystones,
}: {
  songs: readonly MapSong[];
  map: PracticeMap;
  shared: { cards: Record<string, CardState>; credit: Record<string, number> };
  sessionIds: ReadonlySet<string>;
  leadId: string | null;
  selectedSongIds: ReadonlySet<string>;
  selectedKeyIds: ReadonlySet<string>;
  selectedFocus: TreeFocus | null;
  selectedFoundation: string | null;
  centerPlan: CenterPlan;
  mixMode: boolean;
  /** A card for the selection, placed beside the node it is about ("core" for a mix). */
  popover?: { anchor: string; content: ReactNode } | null;
  onToggleMixMode(): void;
  onClickSong(id: string, additive: boolean): void;
  onClickKey(hubId: string, additive: boolean): void;
  onClickFocus(focus: TreeFocus): void;
  onClickFoundation(id: string): void;
  onLaunchCenter(): void;
  onClearSelection(): void;
  onToggleSession?(songId: string): void;
  onAddSong?(): void;
  /** 0..1 per keystone: how far its own trainer has come. */
  keystones?: Partial<Record<KeystoneFocus, number>>;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const spec = useMemo(() => homeTreeSpec(songs), [songs]);
  const tree = useMemo(() => resolveTree(spec), [spec]);
  const progress = useMemo(() => homeTreeProgress(spec, map, shared, map.tempo, keystones), [spec, map, shared, keystones]);
  const view = useMemo(() => homeView(tree), [tree]);

  const activeHubs = useMemo(() => new Set(centerPlan.activeHubIds), [centerPlan.activeHubIds]);
  const activeSongs = useMemo(() => new Set(centerPlan.activeSongIds), [centerPlan.activeSongIds]);
  const sessionHubs = useMemo(() => {
    const out = new Set<string>();
    for (const n of tree.nodes) if (n.data?.type === "song" && sessionIds.has(n.data.songId)) out.add(n.data.hubId);
    return out;
  }, [tree, sessionIds]);
  const primaryFocusHub = hovered?.hubId ?? (selectedKeyIds.size === 1 ? [...selectedKeyIds][0] : null) ?? (centerPlan.activeHubIds.length === 1 ? centerPlan.activeHubIds[0] : null);
  const kin = useMemo(() => kinshipHubs(primaryFocusHub), [primaryFocusHub]);
  const selectionCount = selectedKeyIds.size + selectedSongIds.size + (selectedFocus ? 1 : 0) + (selectedFoundation ? 1 : 0);
  const canLaunchCenter = Boolean(centerPlan.openTab || centerPlan.tuneIds.length || centerPlan.studyHubIds.length);
  const techniqueLit = selectedFocus === "technique";

  const hubFocus = (hubId: string) => primaryFocusHub === hubId || activeHubs.has(hubId);
  const hover = (h: Hovered) => () => setHovered(h);
  const unhover = (id: string) => () => setHovered((cur) => (cur?.id === id ? null : cur));

  const nodeState = (n: Node): string => {
    const d = n.data;
    if (!d) return "";
    const isHover = hovered?.id === n.id ? "is-hover" : "";
    if (d.type === "hub") {
      const active = activeHubs.has(n.id);
      return [selectedKeyIds.has(n.id) ? "is-selected" : "", hubFocus(n.id) ? "is-focus" : "", !active && kin.has(n.id) ? "is-kin" : "", sessionHubs.has(n.id) ? "is-session" : "", d.minor ? "is-minor" : "", isHover].join(" ");
    }
    if (d.type === "skill") {
      const fill = progress.get(n.id)?.fill ?? 0;
      return [hubFocus(d.hubId) ? "is-focus" : "", fill >= 0.8 ? "is-mastered" : fill >= 0.18 ? "is-growing" : fill > 0 ? "is-kinship" : "", isHover].join(" ");
    }
    if (d.type === "foundation") return [selectedFoundation === n.id ? "is-selected" : "", techniqueLit || hubFocus(d.hubId) ? "is-focus" : "", isHover].join(" ");
    if (d.type === "keystone") return [selectedFocus === d.focus ? "is-selected" : "", isHover].join(" ");
    if (d.type === "travel") return selectedFocus === d.focus ? "is-focus" : "";
    return isHover;
  };

  const edgeState = (e: PlacedEdge, a: Node, b: Node): string => {
    const pa = progress.get(a.id);
    const pb = progress.get(b.id);
    const hubA = a.data?.type === "hub" ? a.id : a.data && "hubId" in a.data ? a.data.hubId : null;
    const hubB = b.data?.type === "hub" ? b.id : b.data && "hubId" in b.data ? b.data.hubId : null;
    const focus = (hubA && hubFocus(hubA)) || (hubB && hubFocus(hubB));
    const out = [focus ? "is-focus" : ""];
    if (e.kind === "fifth" || e.kind === "relative") {
      out.push((pa?.fill ?? 0) > 0 && (pb?.fill ?? 0) > 0 ? "is-on" : "");
      if (primaryFocusHub && ((a.id === primaryFocusHub && kin.has(b.id)) || (b.id === primaryFocusHub && kin.has(a.id)))) out.push("is-kin");
    } else if (e.kind === "branch") {
      out.push((pb?.fill ?? 0) >= 0.18 ? "is-on" : "", ...(progress.get(hubB ?? "")?.tags ?? []).map((t) => `is-${t}`));
    } else if (e.kind === "foundation" || e.kind === "chain") {
      out.push((pb?.box ?? 0) > 0 ? "is-on" : "", pb?.locked ? "is-locked" : "", techniqueLit || selectedFoundation === b.id ? "is-lit" : "");
    } else if (e.kind === "keystone" && (b.data?.type === "keystone" || b.data?.type === "travel")) {
      out.push((pb?.fill ?? 0) > 0 ? "is-on" : "", selectedFocus === b.data.focus ? "is-lit" : "");
    } else if (e.kind === "song" && b.data?.type === "song") {
      const id = b.data.songId;
      out.push((pb?.fill ?? 0) > 0 ? "is-on" : "", sessionIds.has(id) ? "is-session" : "", activeSongs.has(id) ? "is-targeted" : "");
    }
    return out.filter(Boolean).join(" ");
  };

  const skins: TreeSkins<HomeNodeData> = {
    hub: {
      svg: ({ node: n, progress: p, state }) => {
        const d = n.data as Extract<HomeNodeData, { type: "hub" }>;
        const fill = p?.fill ?? 0;
        const tier = p?.tags?.find((t) => t.startsWith("rhythm-"))?.slice(7);
        return (
          <HubMedallion
            size={n.size}
            minor={d.minor}
            outward={n.outward}
            fill={fill}
            label={n.label}
            selected={state.includes("is-selected")}
            focus={state.includes("is-focus")}
            kin={state.includes("is-kin")}
            session={state.includes("is-session")}
            rhythmTier={tier}
          />
        );
      },
      html: ({ node: n, progress: p, state, at }) => {
        const selected = state.includes("is-selected");
        const tier = p?.tags?.find((t) => t.startsWith("rhythm-"))?.slice(7);
        return (
          <button
            type="button"
            className={`hm-hub-btn hm-hub-${n.size > 15 ? "major" : "minor"} ${selected ? "is-selected" : ""}`}
            style={at}
            aria-pressed={selected}
            aria-label={`Select key ${n.label}${p && p.fill > 0 ? `, ${Math.round(p.fill * 100)}% grown` : ""}`}
            onMouseEnter={hover({ id: n.id, hubId: n.id, title: n.title ?? n.label, detail: mixMode ? (selected ? "In mix" : "Add to mix") : tier === "sixteenths" ? "16ths" : tier === "triplets" ? "Triplets" : selected ? "Selected" : "Key" })}
            onMouseLeave={unhover(n.id)}
            onClick={(event) => onClickKey(n.id, additive(event, mixMode))}
          />
        );
      },
    },
    skill: {
      svg: ({ node: n, progress: p, state }) => {
        const fill = p?.fill ?? 0;
        const growing = fill >= 0.18;
        const mastered = state.includes("is-mastered");
        const isHover = state.includes("is-hover");
        const focus = state.includes("is-focus");
        const r = (isHover ? n.size + 2.4 : focus ? n.size + 1.2 : n.size) + (growing ? fill * 1.6 : 0);
        const lx = Math.sin((n.outward * Math.PI) / 180) * (r + 10);
        const ly = -Math.cos((n.outward * Math.PI) / 180) * (r + 10) + 3;
        const anchor = Math.abs(lx) < 4 ? "middle" : lx > 0 ? "start" : "end";
        return (
          <>
            <SkillBlossom r={r} outward={n.outward} fill={fill} growing={growing} mastered={mastered} focus={focus} isHover={isHover} />
            {isHover ? (
              <text className="hm-skill-label" x={lx} y={ly} textAnchor={anchor}>
                {n.label}
                {p?.tempo ? <tspan className="hm-skill-bpm"> ♩{p.tempo.bpm}</tspan> : null}
              </text>
            ) : null}
          </>
        );
      },
      html: ({ node: n, progress: p, at }) => {
        const d = n.data as Extract<HomeNodeData, { type: "skill" }>;
        const fill = p?.fill ?? 0;
        return (
          <button
            type="button"
            className="hm-skill-btn"
            style={at}
            data-nav-skip
            aria-label={`${n.title}${p?.tempo ? `, ${p.tempo.bpm} bpm` : ""}`}
            onMouseEnter={hover({ id: n.id, hubId: d.hubId, title: n.title ?? n.label, detail: [fill >= 0.8 ? "Mastered" : p?.box ? `Box ${p.box}/5` : fill > 0 ? "Kinship" : "New", p?.tempo ? `♩${p.tempo.bpm}` : ""].filter(Boolean).join(" · ") })}
            onMouseLeave={unhover(n.id)}
            onClick={(event) => onClickKey(d.hubId, additive(event, mixMode))}
          />
        );
      },
    },
    notable: {
      svg: ({ node: n, progress: p, state }) => {
        const d = n.data as Extract<HomeNodeData, { type: "foundation" }>;
        const s = n.size;
        const share = tempoShare(p?.tempo);
        // the name goes outward, but never straight above or below: there it would run into the rim
        const ox = Math.sin((n.outward * Math.PI) / 180);
        const oy = -Math.cos((n.outward * Math.PI) / 180);
        const level = Math.abs(ox) < 0.35;
        const lx = level ? s + 10 : ox * (s + 17);
        const ly = level ? 3 : oy * (s + 17) + 3;
        const anchor = level || lx > 0 ? "start" : "end";
        return (
          <>
            <NotableFrame
              s={s}
              share={share}
              fill={p?.fill ?? 0}
              mastered={state.includes("is-mastered")}
              active={state.includes("is-selected") || state.includes("is-hover")}
              arcPath={arc}
            />
            <g className="hm-f-glyph">
              <FoundationGlyph kind={d.track.kind} s={s} />
            </g>
            {p?.tempo ? <text className="hm-f-bpm" y={s + 8.8}>{p.tempo.bpm}</text> : null}
            <text className="hm-f-name" x={lx} y={ly} textAnchor={anchor}>{n.label}</text>
          </>
        );
      },
      html: ({ node: n, progress: p, state, at }) => {
        const d = n.data as Extract<HomeNodeData, { type: "foundation" }>;
        const selected = state.includes("is-selected");
        const tempo = p?.tempo;
        return (
          <button
            type="button"
            className={`hm-f-btn ${selected ? "is-selected" : ""}`}
            style={at}
            data-family={n.family}
            aria-pressed={selected}
            aria-label={`${d.track.short}, ${d.keyName}${tempo ? `, ${tempo.bpm} of ${tempo.goal} bpm` : ""}${p?.locked ? ", not open yet" : ""}`}
            onMouseEnter={hover({ id: n.id, hubId: d.hubId, title: `${d.track.short} · ${d.keyName}`, detail: [d.groupLabel, tempo ? `♩${tempo.bpm} → ${tempo.goal}` : "", p?.box ? `Box ${p.box}/5` : p?.locked ? "Not open yet" : "New"].filter(Boolean).join(" · ") })}
            onMouseLeave={unhover(n.id)}
            onClick={(event) => {
              event.stopPropagation();
              onClickFoundation(n.id);
            }}
          />
        );
      },
    },
    keystone: {
      svg: ({ node: n, progress: p }) => {
        const d = n.data as Extract<HomeNodeData, { type: "keystone" }>;
        const s = n.size;
        const fill = p?.fill ?? 0;
        return (
          <>
            <KeystoneFrame s={s} fill={fill} label={n.label} />
            <g className="hm-k-glyph">{d.focus === "triads" ? <TriadGlyph /> : <g transform="translate(-11 -11)"><Glyph name="ear" size={22} /></g>}</g>
          </>
        );
      },
      html: ({ node: n, progress: p, state, at }) => {
        const d = n.data as Extract<HomeNodeData, { type: "keystone" }>;
        const selected = state.includes("is-selected");
        const pct = Math.round((p?.fill ?? 0) * 100);
        return (
          <button
            type="button"
            className={`hm-k-btn ${selected ? "is-selected" : ""}`}
            style={at}
            data-family={n.family}
            aria-pressed={selected}
            aria-label={`${n.label} keystone${pct ? `, ${pct}% grown` : ""}`}
            onMouseEnter={hover({ id: n.id, hubId: null, title: n.label, detail: [d.blurb, pct ? `${pct}%` : "New"].join(" · ") })}
            onMouseLeave={unhover(n.id)}
            onClick={(event) => {
              event.stopPropagation();
              onClickFocus(d.focus);
            }}
          />
        );
      },
    },
    travel: {
      svg: ({ node: n }) => <TravelBead size={n.size} />,
    },
    petal: {
      svg: ({ node: n }) => {
        const d = n.data as Extract<HomeNodeData, { type: "petal" }>;
        return <PetalCradle outward={n.outward} active={selectedFocus === d.focus} />;
      },
      html: ({ node: n, at }) => {
        const d = n.data as Extract<HomeNodeData, { type: "petal" }>;
        const active = selectedFocus === d.focus;
        const pos = n.y < MID - 20 ? "is-top" : n.y > MID + 20 ? "is-bottom" : n.x < MID ? "is-left" : "is-right";
        return (
          <button
            type="button"
            className={`hm-orbit-btn ${pos} ${active ? "is-on" : ""}`}
            data-family={n.family}
            style={at}
            aria-pressed={active}
            aria-label={`Filter by ${n.label}`}
            onMouseEnter={hover({ id: n.id, hubId: null, title: n.label, detail: active ? "Active filter" : "Combines with any key or song" })}
            onMouseLeave={unhover(n.id)}
            onClick={() => onClickFocus(d.focus)}
          >
            <span className="hm-orbit-icon" aria-hidden="true"><Glyph name={PETAL_GLYPH[d.focus]} size={13} /></span>
            <span className="hm-orbit-label">{n.label}</span>
          </button>
        );
      },
    },
    core: {
      svg: () => <CoreMedallion kind={centerPlan.kind} targeted={selectionCount > 0} />,
      html: ({ at }) => {
        const full = centerPlan.kind === "full-mix";
        return (
          <button
            type="button"
            className={`hm-scion-btn is-${centerPlan.kind} ${selectionCount > 0 ? "is-targeted" : ""}`}
            style={at}
            disabled={!canLaunchCenter}
            aria-label={full ? `Guitar mode · ${centerPlan.orbSub}` : `Play ${centerPlan.headline}`}
            onMouseEnter={hover({ id: "core", hubId: null, title: full ? "Guitar mode" : `Play · ${centerPlan.headline}`, detail: centerPlan.summary })}
            onMouseLeave={unhover("core")}
            onClick={onLaunchCenter}
          >
            <span className="hm-scion-play" aria-hidden="true"><Glyph name="play" size={12} /></span>
            <strong className="hm-scion-label">{full ? "Guitar mode" : centerPlan.orbLabel}</strong>
            <small className="hm-scion-sub">{centerPlan.orbSub}</small>
          </button>
        );
      },
    },
    song: {
      svg: ({ node: n, progress: p }) => {
        const d = n.data as Extract<HomeNodeData, { type: "song" }>;
        const id = d.songId;
        return (
          <SongMedallion
            fill={p?.fill ?? 0}
            outward={n.outward}
            inSession={sessionIds.has(id)}
            isLead={leadId === id}
            isSelected={selectedSongIds.has(id)}
            isTargeted={activeSongs.has(id)}
          />
        );
      },
      html: ({ node: n, progress: p, at }) => {
        const d = n.data as Extract<HomeNodeData, { type: "song" }>;
        const id = d.songId;
        const where = side(n);
        const inSession = sessionIds.has(id);
        const isSelected = selectedSongIds.has(id);
        const flags = `${inSession ? "is-session" : ""} ${leadId === id ? "is-lead" : ""} ${isSelected ? "is-selected" : ""} ${activeSongs.has(id) ? "is-targeted" : ""}`;
        return (
          <div className={`hm-song-wrap is-${where} ${flags}`} style={{ ...at, "--fill": (p?.fill ?? 0).toFixed(3) } as CSSProperties}>
            <button
              type="button"
              className={`hm-song is-${where} ${flags}`}
              aria-pressed={isSelected}
              aria-label={`${n.label}${isSelected ? ", selected" : leadId === id ? ", the session starts here" : inSession ? ", in next session" : ""}`}
              onMouseEnter={hover({ id: n.id, hubId: d.hubId, title: n.label, detail: leadId === id ? "Session starts here" : inSession ? "In next session" : "Not in next session" })}
              onMouseLeave={unhover(n.id)}
              onClick={(event) => onClickSong(id, additive(event, mixMode))}
            >
              <span className="hm-song-disc" aria-hidden="true"><i /></span>
              <span className="hm-song-name">{short(n.label)}</span>
            </button>
            {onToggleSession ? (
              <button
                type="button"
                className={`hm-song-pick ${inSession ? "is-in" : ""}`}
                aria-pressed={inSession}
                aria-label={inSession ? `Remove ${n.label} from next session` : `Include ${n.label} in next session`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSession(id);
                }}
              >
                {inSession ? "✓" : "+"}
              </button>
            ) : null}
          </div>
        );
      },
    },
  };

  const core = tree.byId.get("core")!;
  const conduits = (
    <g className="hm-conduits">
      {centerPlan.activeHubIds.map((hubId, i) => {
        const h = tree.byId.get(hubId);
        if (!h) return null;
        const d = linkPath(h, core, "curve", i % 2 ? -18 : 18);
        return (
          <g key={hubId}>
            <path d={d} className={`hm-center-vein-glow is-${centerPlan.kind}`} />
            <path d={d} className={`hm-center-vein is-${centerPlan.kind}`} />
          </g>
        );
      })}
      {selectedFocus ? (() => {
        const petal = tree.byId.get(`petal:${selectedFocus}`);
        if (!petal) return null;
        const d = linkPath(petal, core);
        return (
          <g>
            <path d={d} className="hm-center-vein-glow is-focus" />
            <path d={d} className="hm-center-vein is-focus" />
          </g>
        );
      })() : null}
      {selectedFoundation ? (() => {
        const f = tree.byId.get(selectedFoundation);
        if (!f) return null;
        const d = linkPath(f, core, "curve", 22);
        return (
          <g data-family={f.family}>
            <path d={d} className="hm-center-vein-glow is-foundation" />
            <path d={d} className="hm-center-vein is-foundation" />
          </g>
        );
      })() : null}
    </g>
  );

  const anchorNode = popover && popover.anchor !== "core" ? tree.byId.get(popover.anchor) : undefined;
  const anchor = popover ? (popover.anchor === "core" ? { x: view.x + 40, y: MID } : anchorNode) : undefined;

  return (
    <div className="hm-map" onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }}>
      <div className="hm-map-tools">
        {onAddSong ? (
          <button type="button" className="hm-map-add" onClick={onAddSong} title="Import or add a song to the map">
            <Glyph name="plus" size={15} />
            <span>Add song</span>
          </button>
        ) : null}
        <button type="button" className={`hm-map-mix ${mixMode ? "is-on" : ""}`} aria-pressed={mixMode} onClick={onToggleMixMode} title="Click several keys or songs to blend them (or hold Shift while clicking)">
          <span className="hm-mix-dot" aria-hidden="true" />
          <span>{mixMode ? "Mixing" : "Mix select"}</span>
        </button>
        {selectionCount > 0 ? (
          <button type="button" className="hm-map-clear" onClick={onClearSelection}>
            <Glyph name="close" size={13} />
            <span>Reset</span>
          </button>
        ) : null}
      </div>

      {hovered ? (
        <div className="hm-hover-pill" aria-hidden="true">
          <strong>{hovered.title}</strong>
          <span>{hovered.detail}</span>
        </div>
      ) : null}

      <PassiveTree
        className="hm-stage"
        tree={tree}
        view={view}
        progress={progress}
        skins={skins}
        nodeState={nodeState}
        edgeState={edgeState}
        onBackground={onClearSelection}
        defs={<WisteriaDefs />}
        underlay={<WisteriaUnderlay />}
        overlay={conduits}
      >
        {popover && anchor ? <Popover key={popover.anchor} node={anchor} view={view} below={anchorNode?.kind === "song"} inward={anchorNode?.kind === "keystone"}>{popover.content}</Popover> : null}
      </PassiveTree>
    </div>
  );
}


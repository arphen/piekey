import { useMemo, useState, type CSSProperties } from "react";
import { R_TUNES, TREE_SIZE, type TreeNode } from "../song/tree";
import { MAP_VIEW, type PracticeMap } from "../overview/map";
import type { CenterPlan, TreeFocus } from "../song/keyStudy";
import { Glyph } from "./Glyph";

// The circle of fifths as a living harmonic selector:
// - 12 Major hubs on the outer ring, 12 relative Minor hubs inside.
// - Each key blooms 4 spacious pattern nodes (Scale, 3rds, Chords, Arps); rhythm progress
//   (straight -> triplets -> 16ths) is encoded via luminous color rings.
// - At the heart sits the dynamic Scion / Nexus Launch Core: it adapts to whatever you select
//   (nothing -> full mix, key -> all tunes & scales in that key, song -> solo focus, multi -> custom mix).

const MID = TREE_SIZE / 2;
const VIEW_MAJOR = 208;
const VIEW_MINOR = 140;
const VIEW_TUNES = 304;
const SCION_R = 37;
const ORBIT_R = 66;

const pct = (value: number, from: number, size: number) => `${(((value - from) / size) * 100).toFixed(3)}%`;
const short = (label: string) => (label.length > 24 ? `${label.slice(0, 23)}…` : label);

const polar = (radius: number, degrees: number) => {
  const a = ((degrees - 90) * Math.PI) / 180;
  return { x: MID + radius * Math.cos(a), y: MID + radius * Math.sin(a) };
};

const PATTERN_SLOTS: { skill: string; label: string; dR: number; dA: number; parent: string | null }[] = [
  { skill: "run", label: "Scale", dR: 25, dA: 0, parent: null },
  { skill: "thirds", label: "3rds", dR: 42, dA: -6.5, parent: "run" },
  { skill: "triads", label: "Chords", dR: 42, dA: 6.5, parent: "run" },
  { skill: "sevenths", label: "Arps", dR: 58, dA: 0, parent: "thirds" },
];

const MINOR_SLOTS: { skill: string; label: string; dR: number; dA: number; parent: string | null }[] = [
  { skill: "run", label: "Scale", dR: -19, dA: 0, parent: null },
  { skill: "thirds", label: "3rds", dR: -31, dA: -7, parent: "run" },
  { skill: "triads", label: "Chords", dR: -31, dA: 7, parent: "run" },
  { skill: "sevenths", label: "Arps", dR: -42, dA: 0, parent: "thirds" },
];

const SCION_MODES: { id: TreeFocus; label: string; angle: number }[] = [
  { id: "scales", label: "Scales", angle: -90 },
  { id: "changes", label: "Changes", angle: -18 },
  { id: "triads", label: "Triads", angle: 54 },
  { id: "ear", label: "Ear", angle: 126 },
  { id: "reading", label: "Reading", angle: 198 },
];

type RhythmTier = "none" | "straight" | "triplets" | "sixteenths";

function rhythmTierOf(hubId: string, byId: Map<string, TreeNode>): RhythmTier {
  const sixteenths = byId.get(`${hubId}/run:sixteenths`)?.fill ?? 0;
  const triplets = byId.get(`${hubId}/run:triplets`)?.fill ?? 0;
  const run = byId.get(`${hubId}/run`)?.fill ?? 0;
  if (sixteenths >= 0.18) return "sixteenths";
  if (triplets >= 0.18) return "triplets";
  if (run >= 0.18) return "straight";
  return "none";
}

function side(x: number, y: number): "left" | "right" | "top" | "bottom" {
  const dx = x - MID;
  if (Math.abs(dx) < 70) return y < MID ? "top" : "bottom";
  return dx > 0 ? "right" : "left";
}

function kinshipHubs(hubId: string | null): Set<string> {
  const out = new Set<string>();
  if (!hubId) return out;
  const match = /^(M|m)(\d+)$/.exec(hubId);
  if (!match) return out;
  const minor = match[1] === "m";
  const pc = Number(match[2]);
  const prefix = minor ? "m" : "M";
  const relPrefix = minor ? "M" : "m";
  const relPc = minor ? (pc + 3) % 12 : (pc + 9) % 12;
  out.add(`${relPrefix}${relPc}`);
  out.add(`${prefix}${(pc + 7) % 12}`);
  out.add(`${prefix}${(pc + 5) % 12}`);
  return out;
}

function angleOf(n: { x: number; y: number }): number {
  return ((Math.atan2(n.y - MID, n.x - MID) * 180) / Math.PI + 90 + 360) % 360;
}

function curveBetween(ax: number, ay: number, bx: number, by: number, bend: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${(mx + nx * bend).toFixed(1)} ${(my + ny * bend).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

function songCurve(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${(ax + dx * 0.34 + nx * 16).toFixed(1)} ${(ay + dy * 0.34 + ny * 16).toFixed(1)}, ${(ax + dx * 0.72 - nx * 12).toFixed(1)} ${(ay + dy * 0.72 - ny * 12).toFixed(1)}, ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

interface VisualPattern {
  id: string;
  hubId: string;
  skill: string;
  label: string;
  title: string;
  x: number;
  y: number;
  r: number;
  fill: number;
  rhythm: RhythmTier;
  parentId: string;
}

export function SongMap({
  map,
  sessionIds,
  leadId,
  selectedSongIds,
  selectedKeyIds,
  selectedFocus,
  centerPlan,
  mixMode,
  onToggleMixMode,
  onClickSong,
  onClickKey,
  onClickFocus,
  onLaunchCenter,
  onClearSelection,
  onToggleSession,
  onAddSong,
}: {
  map: PracticeMap;
  sessionIds: ReadonlySet<string>;
  leadId: string | null;
  selectedSongIds: ReadonlySet<string>;
  selectedKeyIds: ReadonlySet<string>;
  selectedFocus: TreeFocus | null;
  centerPlan: CenterPlan;
  mixMode: boolean;
  onToggleMixMode(): void;
  onClickSong(id: string, additive: boolean): void;
  onClickKey(hubId: string, additive: boolean): void;
  onClickFocus(focus: TreeFocus): void;
  onLaunchCenter(): void;
  onClearSelection(): void;
  onToggleSession?(songId: string): void;
  onAddSong?(): void;
}) {
  const [hovered, setHovered] = useState<{ id: string; hubId: string | null; title: string; detail: string } | null>(null);

  const layout = useMemo(() => {
    const rawById = new Map(map.nodes.map((n) => [n.id, n]));
    const rawHubs = map.nodes.filter((n) => n.kind === "major" || n.kind === "minor");
    const hubs = rawHubs.map((n) => {
      const deg = angleOf(n);
      const pos = polar(n.kind === "minor" ? VIEW_MINOR : VIEW_MAJOR, deg);
      return {
        ...n,
        ...pos,
        deg,
        r: n.kind === "minor" ? 13 : 17.5,
        rhythm: rhythmTierOf(n.id, rawById),
      };
    });
    const hubMap = new Map(hubs.map((h) => [h.id, h]));

    // 4 clean pattern nodes per key (Scale, 3rds, Chords, Arps) with rhythm encoded as color
    const patterns: VisualPattern[] = [];
    for (const h of hubs) {
      const slots = h.kind === "minor" ? MINOR_SLOTS : PATTERN_SLOTS;
      for (const s of slots) {
        const id = `${h.id}/${s.skill}`;
        const raw = rawById.get(id);
        const pos = polar((h.kind === "minor" ? VIEW_MINOR : VIEW_MAJOR) + s.dR, h.deg + s.dA);
        patterns.push({
          id,
          hubId: h.id,
          skill: s.skill,
          label: s.label,
          title: `${h.label} · ${s.label}`,
          x: pos.x,
          y: pos.y,
          r: h.kind === "minor" ? 4.1 : 5,
          fill: raw?.fill ?? 0,
          rhythm: h.rhythm,
          parentId: s.parent ? `${h.id}/${s.parent}` : h.id,
        });
      }
    }
    const patternMap = new Map(patterns.map((p) => [p.id, p]));

    // Reposition songs onto VIEW_TUNES preserving angular fanning
    const songs = map.nodes
      .filter((n) => n.kind === "tune")
      .map((n) => {
        const edge = map.edges.find((e) => e.to === n.id);
        const deg = angleOf(n);
        const origR = Math.hypot(n.x - MID, n.y - MID);
        const staggered = origR > R_TUNES + 10;
        const pos = polar(VIEW_TUNES + (staggered ? 36 : 0), deg);
        return { ...n, ...pos, hubId: edge?.from ?? null };
      });

    return { hubs, hubMap, patterns, patternMap, songs };
  }, [map]);

  const sessionHubs = useMemo(
    () => new Set(layout.songs.filter((s) => sessionIds.has(s.id.slice(5)) && s.hubId).map((s) => s.hubId!)),
    [layout.songs, sessionIds],
  );
  const activeHubs = useMemo(() => new Set(centerPlan.activeHubIds), [centerPlan.activeHubIds]);
  const activeSongs = useMemo(() => new Set(centerPlan.activeSongIds), [centerPlan.activeSongIds]);

  const primaryFocusHub = hovered?.hubId ?? (selectedKeyIds.size === 1 ? [...selectedKeyIds][0] : null) ?? (centerPlan.activeHubIds.length === 1 ? centerPlan.activeHubIds[0] : null);
  const kin = useMemo(() => kinshipHubs(primaryFocusHub), [primaryFocusHub]);
  const selectionCount = selectedKeyIds.size + selectedSongIds.size + (selectedFocus ? 1 : 0);
  const canLaunchCenter = Boolean(centerPlan.openTab || centerPlan.tuneIds.length || centerPlan.studyHubIds.length);

  return (
    <div className="hm-map" onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }}>
      <div className="hm-map-tools">
        {onAddSong ? (
          <button type="button" className="hm-map-add" onClick={onAddSong} title="Import or add a song to the map">
            <Glyph name="plus" size={15} />
            <span>Add song</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`hm-map-mix ${mixMode ? "is-on" : ""}`}
          aria-pressed={mixMode}
          onClick={onToggleMixMode}
          title="Click multiple keys or songs to blend them (or hold Shift while clicking)"
        >
          <span className="hm-mix-dot" aria-hidden="true" />
          <span>{mixMode ? "Mixing · click nodes" : "Mix select"}</span>
        </button>
        {selectionCount > 0 ? (
          <button type="button" className="hm-map-clear" onClick={onClearSelection} title="Return center core to full mix">
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

      <div className="hm-stage" style={{ "--vw": MAP_VIEW.w, "--vh": MAP_VIEW.h } as CSSProperties}>
        <svg viewBox={`${MAP_VIEW.x} ${MAP_VIEW.y} ${MAP_VIEW.w} ${MAP_VIEW.h}`} aria-hidden="true" onClick={onClearSelection}>
          <defs>
            <radialGradient id="hm-core">
              <stop offset="0" stopColor="#72e854" stopOpacity="0.22" />
              <stop offset="0.32" stopColor="#287430" stopOpacity="0.08" />
              <stop offset="0.7" stopColor="#0f2818" stopOpacity="0.03" />
              <stop offset="1" stopColor="#050a08" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hm-bloom">
              <stop offset="0" stopColor="#9cff63" stopOpacity="0.44" />
              <stop offset="0.55" stopColor="#58d640" stopOpacity="0.14" />
              <stop offset="1" stopColor="#58d640" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="hm-kin-glow">
              <stop offset="0" stopColor="#dfc068" stopOpacity="0.3" />
              <stop offset="1" stopColor="#dfc068" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Abyssal harbor core + minimal concentric guides */}
          <circle cx={MID} cy={MID} r={VIEW_TUNES + 48} fill="url(#hm-core)" />
          <circle className="hm-track hm-track--outer" cx={MID} cy={MID} r={VIEW_TUNES} />
          <circle className="hm-track is-strong" cx={MID} cy={MID} r={VIEW_MAJOR} />
          <circle className="hm-track" cx={MID} cy={MID} r={VIEW_MINOR} />
          <circle className="hm-track hm-track--inner" cx={MID} cy={MID} r={ORBIT_R} />

          {/* Circle of fifths arcs + relative major/minor bridges */}
          <g className="hm-edges">
            {map.edges
              .filter((e) => !e.to.includes("/") && !e.to.startsWith("tune:"))
              .map((e) => {
                const a = layout.hubMap.get(e.from);
                const b = layout.hubMap.get(e.to);
                if (!a || !b) return null;
                const isFifth = a.kind === "major" && b.kind === "major";
                const d = isFifth
                  ? `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${VIEW_MAJOR} ${VIEW_MAJOR} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
                  : `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
                const isFocus = primaryFocusHub === a.id || primaryFocusHub === b.id || activeHubs.has(a.id) || activeHubs.has(b.id);
                const isKin = Boolean(primaryFocusHub && ((a.id === primaryFocusHub && kin.has(b.id)) || (b.id === primaryFocusHub && kin.has(a.id))));
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={d}
                    className={`hm-vein ${e.on ? "is-on" : ""} ${isFocus ? "is-focus" : ""} ${isKin ? "is-kin" : ""}`}
                  />
                );
              })}

            {/* Live energy conduits from every selected hub & active discipline into the Center Core */}
            {centerPlan.activeHubIds.map((hubId, idx) => {
              const h = layout.hubMap.get(hubId);
              if (!h) return null;
              return (
                <path
                  key={`conduit:${hubId}`}
                  d={curveBetween(h.x, h.y, MID, MID, idx % 2 === 0 ? 18 : -18)}
                  className={`hm-center-vein is-${centerPlan.kind}`}
                />
              );
            })}
            {selectedFocus ? (() => {
              const m = SCION_MODES.find((item) => item.id === selectedFocus);
              if (!m) return null;
              const pos = polar(ORBIT_R, m.angle);
              return <line className="hm-center-vein is-focus" x1={pos.x} y1={pos.y} x2={MID} y2={MID} />;
            })() : null}

            {/* 4 clean botanical tendrils per key */}
            {layout.patterns.map((p) => {
              const parent = layout.patternMap.get(p.parentId) ?? layout.hubMap.get(p.parentId);
              if (!parent) return null;
              const isFocus = primaryFocusHub === p.hubId || activeHubs.has(p.hubId);
              const bend = p.skill === "thirds" ? -5 : p.skill === "triads" ? 5 : 0;
              return (
                <path
                  key={`${p.parentId}>${p.id}`}
                  d={curveBetween(parent.x, parent.y, p.x, p.y, bend)}
                  className={`hm-vein is-rhythm-${p.rhythm} ${p.fill >= 0.18 ? "is-on" : ""} ${isFocus ? "is-focus" : ""}`}
                />
              );
            })}

            {/* Sweeping S-curves out to tunes */}
            {layout.songs.map((s) => {
              const hub = s.hubId ? layout.hubMap.get(s.hubId) : null;
              if (!hub) return null;
              const songId = s.id.slice(5);
              const inSession = sessionIds.has(songId);
              const isTargeted = activeSongs.has(songId);
              const isFocus = primaryFocusHub === hub.id || isTargeted;
              return (
                <path
                  key={`${hub.id}>${s.id}`}
                  d={songCurve(hub.x, hub.y, s.x, s.y)}
                  className={`hm-vein to-song ${s.fill > 0 ? "is-on" : ""} ${inSession ? "is-session" : ""} ${isFocus ? "is-focus" : ""} ${isTargeted ? "is-targeted" : ""}`}
                />
              );
            })}
          </g>

          {/* 4 pattern nodes per key, with rhythm tier shown via color */}
          {layout.patterns.map((p) => {
            const isFocus = primaryFocusHub === p.hubId || activeHubs.has(p.hubId);
            const isHover = hovered?.id === p.id;
            const mastered = p.fill >= 0.8;
            const growing = p.fill >= 0.18;
            const kinship = !growing && p.fill > 0;
            const r = (isHover ? p.r + 2.4 : isFocus ? p.r + 1.2 : p.r) + (growing ? p.fill * 1.6 : 0);
            const dx = p.x - MID;
            const dy = p.y - MID;
            const len = Math.hypot(dx, dy) || 1;
            const lx = (dx / len) * (r + 9);
            const ly = (dy / len) * (r + 9) + 3;
            const anchor = Math.abs(dx) < 28 ? ("middle" as const) : dx > 0 ? ("start" as const) : ("end" as const);
            return (
              <g
                key={p.id}
                className={`hm-node hm-skill is-rhythm-${p.rhythm} ${growing ? "is-seen" : ""} ${mastered ? "is-mastered" : ""} ${kinship ? "is-kinship" : ""} ${isFocus ? "is-focus" : ""} ${isHover ? "is-hover" : ""}`}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                onMouseEnter={() =>
                  setHovered({
                    id: p.id,
                    hubId: p.hubId,
                    title: p.title,
                    detail: mastered ? "Mastered" : growing ? `Box ${Math.min(5, Math.max(1, Math.round(p.fill * 5)))}/5` : kinship ? "Kinship boost" : "Click to focus key",
                  })
                }
                onMouseLeave={() => setHovered((cur) => (cur?.id === p.id ? null : cur))}
                onClick={(event) => {
                  event.stopPropagation();
                  onClickKey(p.hubId, event.shiftKey || event.metaKey || event.ctrlKey || mixMode);
                }}
              >
                <circle className="hm-hit" r={11} />
                {mastered || isHover ? <circle className="hm-skill-halo" r={r + 5} fill="url(#hm-bloom)" /> : null}
                <circle
                  className="hm-dot"
                  r={r}
                  style={{ fillOpacity: growing ? 0.48 + 0.52 * p.fill : kinship ? 0.45 : isFocus ? 0.28 : 0.12 } as CSSProperties}
                />
                {mastered ? <circle className="hm-spore-core" r={1.8} /> : null}
                {isHover ? (
                  <text className="hm-skill-label" x={lx} y={ly} textAnchor={anchor}>
                    {p.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Key hubs: multi-ring botanical cores with rhythm-color outer rim */}
          {layout.hubs.map((n) => {
            const isSelected = selectedKeyIds.has(n.id);
            const isActive = activeHubs.has(n.id);
            const isFocus = primaryFocusHub === n.id || isActive;
            const isKin = !isActive && kin.has(n.id);
            const inSession = sessionHubs.has(n.id);
            return (
              <g
                key={n.id}
                className={`hm-node hm-${n.kind} is-rhythm-${n.rhythm} ${n.fill > 0 ? "is-seen" : ""} ${inSession ? "is-session" : ""} ${isSelected ? "is-selected" : ""} ${isFocus ? "is-focus" : ""} ${isKin ? "is-kin" : ""}`}
                transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`}
              >
                {isSelected || isFocus || n.fill > 0.2 ? (
                  <circle className="hm-hub-glow" r={n.r + (isSelected ? 19 : 12)} fill="url(#hm-bloom)" />
                ) : isKin ? (
                  <circle className="hm-hub-glow" r={n.r + 12} fill="url(#hm-kin-glow)" />
                ) : null}
                {isSelected || inSession ? <circle className="hm-hub-pulse" r={n.r + 5} /> : null}
                <circle className="hm-dot" r={n.r} style={{ fillOpacity: 0.08 + 0.36 * n.fill } as CSSProperties} />
                {n.fill > 0 ? (
                  <circle className="hm-arc" r={n.r} pathLength={1} strokeDasharray={`${n.fill.toFixed(3)} 1`} transform="rotate(-90)" />
                ) : null}
                <text dy="0.36em">{n.label}</text>
              </g>
            );
          })}

          {/* Dynamic Scion / Nexus Launch Core SVG rings */}
          <g className={`hm-scion-svg is-${centerPlan.kind} ${selectionCount > 0 ? "is-targeted" : ""}`} transform={`translate(${MID} ${MID})`}>
            <circle className="hm-scion-aura" r={SCION_R + 22} fill={centerPlan.kind === "custom-mix" ? "url(#hm-kin-glow)" : "url(#hm-bloom)"} />
            <circle className="hm-scion-pulse" r={SCION_R + 6} />
            <circle className="hm-scion-ring" r={SCION_R} />
            <circle className="hm-scion-inner" r={SCION_R - 7} />
          </g>
        </svg>

        {/* Dynamic Center Launch Core: transforms to match the active selection */}
        <button
          type="button"
          className={`hm-scion-btn is-${centerPlan.kind} ${selectionCount > 0 ? "is-targeted" : ""}`}
          style={{ left: pct(MID, MAP_VIEW.x, MAP_VIEW.w), top: pct(MID, MAP_VIEW.y, MAP_VIEW.h) }}
          disabled={!canLaunchCenter}
          aria-label={`Play ${centerPlan.headline}`}
          onMouseEnter={() =>
            setHovered({
              id: "scion",
              hubId: null,
              title: `Play · ${centerPlan.headline}`,
              detail: centerPlan.summary,
            })
          }
          onMouseLeave={() => setHovered((cur) => (cur?.id === "scion" ? null : cur))}
          onClick={onLaunchCenter}
        >
          <span className="hm-scion-play" aria-hidden="true"><Glyph name="play" size={11} /></span>
          <strong className="hm-scion-label">{centerPlan.orbLabel}</strong>
          <small className="hm-scion-sub">{centerPlan.orbSub}</small>
        </button>

        {/* 5 integrated drill petals orbiting the center core */}
        {SCION_MODES.map((m) => {
          const pos = polar(ORBIT_R, m.angle);
          const active = selectedFocus === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className={`hm-orbit-btn ${active ? "is-on" : ""}`}
              style={{ left: pct(pos.x, MAP_VIEW.x, MAP_VIEW.w), top: pct(pos.y, MAP_VIEW.y, MAP_VIEW.h) }}
              aria-pressed={active}
              aria-label={`Filter by ${m.label}`}
              title={active ? `${m.label} active · click center core to play, or click again to clear` : `Focus on ${m.label}`}
              onMouseEnter={() =>
                setHovered({
                  id: `mode:${m.id}`,
                  hubId: null,
                  title: m.label,
                  detail: active ? "Active filter · click center orb to launch" : "Click to focus · combines with any key or song",
                })
              }
              onMouseLeave={() => setHovered((cur) => (cur?.id === `mode:${m.id}` ? null : cur))}
              onClick={() => onClickFocus(m.id)}
            >
              <span>{m.label}</span>
            </button>
          );
        })}

        {/* Interactive key hub buttons */}
        {layout.hubs.map((n) => {
          const isSelected = selectedKeyIds.has(n.id);
          return (
            <button
              key={n.id}
              type="button"
              className={`hm-hub-btn hm-hub-${n.kind} ${isSelected ? "is-selected" : ""}`}
              style={{ left: pct(n.x, MAP_VIEW.x, MAP_VIEW.w), top: pct(n.y, MAP_VIEW.y, MAP_VIEW.h) }}
              aria-pressed={isSelected}
              aria-label={`Select key ${n.label}${n.fill > 0 ? `, ${Math.round(n.fill * 100)}% grown` : ""}`}
              onMouseEnter={() =>
                setHovered({
                  id: n.id,
                  hubId: n.id,
                  title: n.label,
                  detail: mixMode
                    ? isSelected ? "In mix · click to remove" : "Click to add to mix"
                    : isSelected
                      ? "Selected · Shift-click another to mix"
                      : n.rhythm === "sixteenths"
                        ? "16ths rhythm · click to focus"
                        : n.rhythm === "triplets"
                          ? "Triplets rhythm · click to focus"
                          : "Click to focus · Shift-click to mix",
                })
              }
              onMouseLeave={() => setHovered((cur) => (cur?.id === n.id ? null : cur))}
              onClick={(event) => onClickKey(n.id, event.shiftKey || event.metaKey || event.ctrlKey || mixMode)}
            />
          );
        })}

        {/* Floating song orbs around the outer rim */}
        {layout.songs.map((n) => {
          const id = n.id.slice(5);
          const where = side(n.x, n.y);
          const inSession = sessionIds.has(id);
          const isSelected = selectedSongIds.has(id);
          const isTargeted = activeSongs.has(id);
          return (
            <div
              key={n.id}
              className={`hm-song-wrap is-${where} ${inSession ? "is-session" : ""} ${leadId === id ? "is-lead" : ""} ${isSelected ? "is-selected" : ""} ${isTargeted ? "is-targeted" : ""}`}
              style={{ left: pct(n.x, MAP_VIEW.x, MAP_VIEW.w), top: pct(n.y, MAP_VIEW.y, MAP_VIEW.h), "--fill": n.fill.toFixed(3) } as CSSProperties}
            >
              <button
                type="button"
                className={`hm-song is-${where} ${inSession ? "is-session" : ""} ${leadId === id ? "is-lead" : ""} ${isSelected ? "is-selected" : ""} ${isTargeted ? "is-targeted" : ""}`}
                aria-pressed={isSelected}
                aria-label={`${n.label}${isSelected ? ", selected" : inSession ? ", in next session" : ""}`}
                onMouseEnter={() =>
                  setHovered({
                    id: n.id,
                    hubId: n.hubId,
                    title: n.label,
                    detail: mixMode
                      ? isSelected ? "In mix · click to remove" : "Click to add to mix"
                      : isSelected
                        ? "Solo selected · click center orb to play"
                        : "Click for solo focus · Shift-click to mix",
                  })
                }
                onMouseLeave={() => setHovered((cur) => (cur?.id === n.id ? null : cur))}
                onClick={(event) => onClickSong(id, event.shiftKey || event.metaKey || event.ctrlKey || mixMode)}
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
                  title={inSession ? "In next session · click to remove" : "Add to next session"}
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
        })}
      </div>
    </div>
  );
}

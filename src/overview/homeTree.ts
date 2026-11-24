import { mod } from "../musicTheory";
import { parseKey, TREE_SIZE } from "../song/tree";
import { BOXES, type CardState } from "../song/leitner";
import { parseHubId, type TreeFocus } from "../song/keyStudy";
import { FOUNDATION_GROUPS, TECHNIQUE_TRACKS, type TechniqueMeta } from "../song/technique";
import type { NodeProgress, ResolvedTree, TreeGroupSpec, TreeLinkSpec, TreeNodeSpec, TreeSpec } from "../tree/model";
import type { MapSong, PracticeMap } from "./map";

// Home's passive tree as data. One wheel group holds the core, the discipline petals, the circle of
// fifths (minors inside majors), the song rim and the keystones: the disciplines with a trainer of
// their own (Triads, Ear), each at the end of a short path that leaves the circle between two keys. Each key has a branch group pinned to its hub and
// facing away from the centre (towards it for minors); the key's exercises sit on its orbits, and
// the foundations hung on that key take the branch's outer orbit, spread evenly, so adding a
// foundation to the catalogue places it without touching this file.
//
// `homeTreeSpec` is layout and meaning (it changes when the library does); `homeTreeProgress` is
// how far each node has come (it changes after every session).

export const MID = TREE_SIZE / 2;
/** Wheel orbits: 0 core, 1 petals, 2 minor keys, 3 major keys, 4 songs, 5 songs pushed out, 6–7 the steps to a keystone, 8 keystones. */
export const WHEEL_ORBITS = [0, 66, 140, 208, 304, 346, 282, 356, 430] as const;
export const ORBIT = { core: 0, petals: 1, minor: 2, major: 3, songs: 4, songsOut: 5, step1: 6, step2: 7, keystone: 8 } as const;
/** The map's frame in tree space before fitting: the wheel, the song rim and room for the songs' names. */
export const HOME_VIEW = { x: -176, y: -66, w: TREE_SIZE + 352, h: TREE_SIZE + 128 };

/**
 * The frame fitted to what is on the tree: as tall as its nodes and their labels need (a name
 * above a song at the top, a name below a foundation), so the tree is drawn as large as the screen
 * allows; wide enough for songs' names at either side.
 */
export function homeView(tree: ResolvedTree<HomeNodeData>): { x: number; y: number; w: number; h: number } {
  let top = MID - WHEEL_ORBITS[ORBIT.major] - 40;
  let bottom = MID + WHEEL_ORBITS[ORBIT.major] + 40;
  for (const n of tree.nodes) {
    const below = n.kind === "notable" ? 16 : n.kind === "song" && n.y > MID + 200 ? 30 : 4;
    const above = n.kind === "song" && n.y < MID - 200 ? 30 : n.kind === "notable" ? 10 : 4;
    top = Math.min(top, n.y - n.size - above);
    bottom = Math.max(bottom, n.y + n.size + below);
  }
  return { x: HOME_VIEW.x, y: top, w: HOME_VIEW.w, h: bottom - top };
}

/** A key's branch: exercises on the first orbits, foundations on the last. */
const BRANCH_ORBITS = { major: [26, 46, 60, 94], minor: [20, 34, 45, 60] } as const;
const FOUNDATION_ORBIT = 3;
/** Angles for 1, 2, 3… foundations on one key, spread around the branch's axis. */
const FOUNDATION_SPREAD = 27;

export type RhythmTier = "none" | "straight" | "triplets" | "sixteenths";

export type HomeNodeData =
  | { type: "core" }
  | { type: "petal"; focus: TreeFocus }
  | { type: "hub"; hubId: string; minor: boolean; fullName: string }
  | { type: "skill"; hubId: string; skill: string }
  | { type: "foundation"; track: TechniqueMeta; hubId: string; keyName: string; groupLabel: string }
  | { type: "song"; songId: string; hubId: string }
  | { type: "keystone"; focus: KeystoneFocus; blurb: string }
  | { type: "travel"; focus: KeystoneFocus };

export type HomeTreeSpec = TreeSpec<HomeNodeData>;

/** Petals with a keystone point at it: Triads east, Ear west. */
export const PETALS: { focus: TreeFocus; label: string; angle: number; family: string }[] = [
  { focus: "ear", label: "Ear", angle: 270, family: "ear" },
  { focus: "technique", label: "Technique", angle: 330, family: "foundations" },
  { focus: "changes", label: "Changes", angle: 30, family: "changes" },
  { focus: "triads", label: "Triads", angle: 90, family: "triads" },
  { focus: "scales", label: "Scales", angle: 150, family: "scales" },
  { focus: "reading", label: "Reading", angle: 210, family: "reading" },
];

export type KeystoneFocus = Extract<TreeFocus, "ear" | "triads">;

/**
 * Disciplines with a trainer of their own. Each sits beyond the song rim, between two major keys
 * (half a spoke off, so no key's branch or songs are in the way), and is reached by a path that
 * leaves the circle of fifths there: a socket on the major ring, two steps, the keystone.
 */
export const KEYSTONES: { focus: KeystoneFocus; label: string; angle: number; family: string; blurb: string }[] = [
  { focus: "triads", label: "Triads", angle: 75, family: "triads", blurb: "Every triad on the neck, by heart, round the circle of fifths." },
  { focus: "ear", label: "Ear training", angle: 285, family: "ear", blurb: "Hear the chords behind songs: progressions and their names." },
];
export const keystoneId = (focus: KeystoneFocus) => `ks:${focus}`;

/** A key's exercises in the order they open: orbit, angle off the branch axis, what it grows from. */
export const BRANCH_SKILLS: { skill: string; label: string; orbit: number; angle: number; parent: string | null }[] = [
  { skill: "run", label: "Scale", orbit: 0, angle: 0, parent: null },
  { skill: "thirds", label: "3rds", orbit: 1, angle: -30, parent: "run" },
  { skill: "triads", label: "Triads", orbit: 1, angle: 30, parent: "run" },
  { skill: "sevenths", label: "Arps", orbit: 2, angle: 0, parent: "thirds" },
];

/** Where a major key sits: C at the top, fifths clockwise. */
const slotAngle = (pc: number) => mod(pc * 7) * 30;
const hubOf = (pc: number, minor: boolean) => `${minor ? "m" : "M"}${pc}`;

/** The branch node a foundation at this angle grows from: the nearer side, or the tip. */
const foundationParent = (angle: number) => (angle < 0 ? "thirds" : angle > 0 ? "triads" : "sevenths");

/** Foundations per key, in catalogue order, with their angles on the branch. */
export function foundationSlots(tracks: readonly TechniqueMeta[] = TECHNIQUE_TRACKS): Map<string, number> {
  const byHub = new Map<string, TechniqueMeta[]>();
  for (const t of tracks) byHub.set(t.hub, [...(byHub.get(t.hub) ?? []), t]);
  const out = new Map<string, number>();
  byHub.forEach((list) => list.forEach((t, i) => out.set(t.id, (i - (list.length - 1) / 2) * FOUNDATION_SPREAD * (list.length > 2 ? 0.85 : 1))));
  return out;
}

export function homeTreeSpec(songs: readonly MapSong[], tracks: readonly TechniqueMeta[] = TECHNIQUE_TRACKS): HomeTreeSpec {
  const groups: TreeGroupSpec[] = [{ id: "wheel", x: MID, y: MID, heading: 0, orbits: WHEEL_ORBITS }];
  const nodes: TreeNodeSpec<HomeNodeData>[] = [];
  const foundationHubs = new Set(tracks.map((t) => t.hub));

  nodes.push({ id: "core", kind: "core", group: "wheel", orbit: ORBIT.core, angle: 0, label: "", family: "core", size: 37, data: { type: "core" } });
  for (const p of PETALS)
    nodes.push({ id: `petal:${p.focus}`, kind: "petal", group: "wheel", orbit: ORBIT.petals, angle: p.angle, label: p.label, family: p.family, size: 12, data: { type: "petal", focus: p.focus } });

  // the circle of fifths: majors outside, each relative minor inside it on the same spoke
  for (let pc = 0; pc < 12; pc++) {
    const angle = slotAngle(pc);
    for (const minor of [false, true]) {
      const root = minor ? mod(pc + 9) : pc;
      const hub = hubOf(root, minor);
      const info = parseHubId(hub)!;
      const out: TreeLinkSpec[] = [{ to: `${hub}/run`, kind: "branch" }];
      if (!minor) out.push({ to: hubOf(mod(pc + 7), false), kind: "fifth" }, { to: hubOf(mod(pc + 9), true), kind: "relative" });
      nodes.push({ id: hub, kind: "hub", group: "wheel", orbit: minor ? ORBIT.minor : ORBIT.major, angle, label: info.shortName, title: info.fullName, family: "key", size: minor ? 13 : 17.5, out, data: { type: "hub", hubId: hub, minor, fullName: info.fullName } });
      groups.push({ id: `branch:${hub}`, anchor: hub, heading: minor ? "inward" : "outward", orbits: minor ? BRANCH_ORBITS.minor : BRANCH_ORBITS.major });
      for (const s of BRANCH_SKILLS) {
        const children = BRANCH_SKILLS.filter((c) => c.parent === s.skill).map((c): TreeLinkSpec => ({ to: `${hub}/${c.skill}`, shape: "curve", bend: c.angle < 0 ? -4 : c.angle > 0 ? 4 : 0, kind: "branch" }));
        nodes.push({ id: `${hub}/${s.skill}`, kind: "skill", group: `branch:${hub}`, orbit: s.orbit, angle: s.angle, label: s.label, title: `${info.shortName} · ${s.label}`, family: "scales", size: minor ? 4.1 : 5, out: children, data: { type: "skill", hubId: hub, skill: s.skill } });
      }
    }
  }

  // foundations: notables on the outer orbit of the key they live in, chained in the order they open
  const slots = foundationSlots(tracks);
  const ids = new Set(tracks.map((t) => t.id));
  for (const t of tracks) {
    const info = parseHubId(t.hub);
    if (!info) continue;
    const angle = slots.get(t.id) ?? 0;
    const parent = nodes.find((n) => n.id === `${t.hub}/${foundationParent(angle)}`);
    if (parent) parent.out = [...(parent.out ?? []), { to: t.id, shape: "curve", bend: angle < 0 ? -6 : angle > 0 ? 6 : 0, kind: "foundation" }];
    const next = tracks.filter((o) => o.needs === t.id && ids.has(o.id)).map((o): TreeLinkSpec => ({ to: o.id, shape: "curve", bend: 10, kind: "chain" }));
    nodes.push({
      id: t.id,
      kind: "notable",
      group: `branch:${t.hub}`,
      orbit: FOUNDATION_ORBIT,
      angle,
      label: t.short,
      title: `${t.short} · ${info.fullName}`,
      family: t.group,
      size: info.minor ? 10.5 : 12.5,
      out: next,
      data: { type: "foundation", track: t, hubId: t.hub, keyName: info.fullName, groupLabel: FOUNDATION_GROUPS[t.group].label },
    });
  }

  // keystones: a socket on the major ring, two steps out, then the keystone itself
  for (const k of KEYSTONES) {
    const id = keystoneId(k.focus);
    const steps = [ORBIT.major, ORBIT.step1, ORBIT.step2];
    steps.forEach((orbit, i) => {
      const to = i + 1 < steps.length ? `${id}/${i + 1}` : id;
      nodes.push({ id: `${id}/${i}`, kind: "travel", group: "wheel", orbit, angle: k.angle, label: "", title: k.label, family: k.family, size: i === 0 ? 3.4 : 2.8, out: [{ to, kind: "keystone" }], data: { type: "travel", focus: k.focus } });
    });
    nodes.push({ id, kind: "keystone", group: "wheel", orbit: ORBIT.keystone, angle: k.angle, label: k.label, title: k.label, family: k.family, size: 21, data: { type: "keystone", focus: k.focus, blurb: k.blurb } });
  }

  // songs on the rim: a major key's on its own spoke, a minor key's between that spoke and the next;
  // pushed further out where foundations already hang, and every other one when a key has several
  const byHub = new Map<string, MapSong[]>();
  for (const s of songs) {
    const k = parseKey(s.key);
    if (k) byHub.set(hubOf(k.pc, k.minor), [...(byHub.get(hubOf(k.pc, k.minor)) ?? []), s]);
  }
  byHub.forEach((list, hub) => {
    const minor = hub.startsWith("m");
    const pc = Number(hub.slice(1));
    const angle = slotAngle(minor ? mod(pc + 3) : pc);
    const crowded = foundationHubs.has(hub) || (minor && foundationHubs.has(hubOf(mod(pc + 3), false)));
    list.forEach((s, i) => {
      const fan = i - (list.length - 1) / 2;
      const out = crowded || i % 2 === 1;
      const id = `tune:${s.id}`;
      const at = nodes.find((n) => n.id === hub)!;
      at.out = [...(at.out ?? []), { to: id, shape: "s", bend: 16, kind: "song" }];
      nodes.push({ id, kind: "song", group: "wheel", orbit: out ? ORBIT.songsOut : ORBIT.songs, angle: minor ? angle + 15 + fan * 5 : angle + fan * 9, label: s.title, title: s.title, family: "song", size: 13, data: { type: "song", songId: s.id, hubId: hub } });
    });
  });

  return { origin: { x: MID, y: MID }, groups, nodes };
}

function rhythmTier(fill: (id: string) => number, hub: string): RhythmTier {
  if (fill(`${hub}/run:sixteenths`) >= 0.18) return "sixteenths";
  if (fill(`${hub}/run:triplets`) >= 0.18) return "triplets";
  if (fill(`${hub}/run`) >= 0.18) return "straight";
  return "none";
}

/**
 * How far each node has come. Keys and their exercises come from the practice map; foundations from
 * the shared card box (their tempo travels with the card); songs from their tunes' boxes.
 */
export function homeTreeProgress(
  spec: HomeTreeSpec,
  map: PracticeMap,
  shared: { cards: Record<string, CardState>; credit: Record<string, number> },
  skillBpm: ReadonlyMap<string, number> = new Map(),
  keystones: Partial<Record<KeystoneFocus, number>> = {},
): Map<string, NodeProgress> {
  const raw = new Map(map.nodes.map((n) => [n.id, n]));
  const fill = (id: string) => raw.get(id)?.fill ?? 0;
  const out = new Map<string, NodeProgress>();
  for (const n of spec.nodes) {
    const d = n.data;
    if (!d) continue;
    if (d.type === "hub") out.set(n.id, { fill: fill(n.id), lit: raw.get(n.id)?.lit, tags: [`rhythm-${rhythmTier(fill, d.hubId)}`] });
    else if (d.type === "skill") {
      const bpm = skillBpm.get(n.id);
      out.set(n.id, { fill: fill(n.id), lit: raw.get(n.id)?.lit, box: fill(n.id) >= 0.18 ? Math.min(BOXES, Math.max(1, Math.round(fill(n.id) * BOXES))) : 0, ...(bpm ? { tempo: { bpm, start: bpm, goal: bpm } } : {}), tags: [`rhythm-${rhythmTier(fill, d.hubId)}`] });
    } else if (d.type === "song") out.set(n.id, { fill: fill(n.id) });
    else if (d.type === "keystone" || d.type === "travel") {
      const f = Math.max(0, Math.min(1, keystones[d.focus] ?? 0));
      out.set(n.id, { fill: d.type === "keystone" ? f : f > 0 ? 1 : 0, tags: f >= 0.8 ? ["mastered"] : [] });
    }
    else if (d.type === "foundation") {
      const t = d.track;
      const st = shared.cards[t.id];
      const box = st?.box ?? 0;
      const bpm = st?.bpm ?? t.bpm;
      const locked = Boolean(t.needs) && (shared.cards[t.needs!]?.box ?? 0) < 2 && (shared.credit[t.id] ?? 0) < 1;
      out.set(n.id, { fill: box / BOXES, box, locked, tempo: { bpm, start: t.bpm, goal: t.goalBpm }, tags: box >= 4 ? ["mastered"] : box > 0 ? ["growing"] : [] });
    }
  }
  return out;
}

/** 0..1 along a tempo's road from where it started to its goal. */
export function tempoShare(tempo: NodeProgress["tempo"]): number {
  if (!tempo || tempo.goal <= tempo.start) return 0;
  return Math.max(0, Math.min(1, (tempo.bpm - tempo.start) / (tempo.goal - tempo.start)));
}

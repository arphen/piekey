import { mod } from "../musicTheory";
import type { FreeEntry } from "./freeplay";
import { parseScaleId } from "./kin";
import { BOXES, type CardState } from "./leitner";

// The player's map: everything practised, laid out on the circle of fifths. Each major key is a
// hub on the outer ring with its relative minor inside it. From a hub grow its skills, in the
// order they open: the scale's notes first, then one branch of melodic patterns (thirds, triads,
// 7th arpeggios) and one of rhythm (triplets, 16ths). Tunes hang off the key they are in. A node
// fills as its exercise climbs the card box, and since neighbours on the circle share six of
// their seven notes, what is learned in one place can be seen spreading to the next.

export interface TreeNode {
  id: string;
  kind: "major" | "minor" | "skill" | "tune";
  label: string;
  title: string; // the long form, for a tooltip
  x: number;
  y: number;
  r: number;
  fill: number; // 0..1: how far up the box
  lit: boolean; // touched in the session just played
}

export interface TreeEdge {
  from: string;
  to: string;
  on: boolean; // both ends have something in them
}

export interface TreeInput {
  cards: Record<string, CardState>;
  credit: Record<string, number>;
  tunes: { id: string; title: string; key: string; fill: number }[]; // key: "D-minor"
  free: FreeEntry[];
  lit: Set<string>; // card ids that moved this session
  stagger?: boolean; // several tunes in one key: every other one further out, so their names clear each other
}

export const TREE_SIZE = 640;
const C = TREE_SIZE / 2;
export const R_MAJOR = 196;
export const R_MINOR = 118;
export const R_TUNES = R_MAJOR + 104;
const STAGGER = 40;
const MAJOR_NAMES = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
const MINOR_NAMES = ["Am", "Em", "Bm", "F♯m", "C♯m", "G♯m", "E♭m", "B♭m", "Fm", "Cm", "Gm", "Dm"];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The skills of a key in the order they open: [drill id, label, steps out from the hub, degrees aside]. */
const SKILLS: [string, string, number, number, string | null][] = [
  ["run", "scale", 1, 0, null],
  ["thirds", "3rds", 2, -6, "run"],
  ["triads", "triads", 3, -8, "thirds"],
  ["sevenths", "7ths", 4, -9, "triads"],
  ["run:triplets", "triplets", 2, 6, "run"],
  ["run:sixteenths", "16ths", 3, 8, "run:triplets"],
];

/** Where a major key sits on the circle: C at the top, fifths clockwise. */
const slot = (pc: number) => mod(pc * 7);
const polar = (radius: number, degrees: number) => {
  const a = ((degrees - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(a), y: C + radius * Math.sin(a) };
};

/** "D-minor", "Bb-major" → the pitch class of its tonic and its mode. */
export function parseKey(id: string): { pc: number; minor: boolean } | null {
  const m = /^([A-G])([b#]*)-(major|minor)$/.exec(id);
  if (!m) return null;
  const alter = [...m[2]].reduce((n, ch) => n + (ch === "b" ? -1 : 1), 0);
  return { pc: mod(LETTER_PC[m[1]] + alter), minor: m[3] === "minor" };
}

export function buildTree(input: TreeInput): { nodes: TreeNode[]; edges: TreeEdge[] } {
  // per hub and skill: the furthest any of its scales has come (a minor key has three)
  const fill = new Map<string, number>();
  const lit = new Set<string>();
  const note = (key: string, value: number, touched: boolean) => {
    fill.set(key, Math.max(fill.get(key) ?? 0, value));
    if (touched) lit.add(key);
  };
  const hubOf = (root: number, minor: boolean) => `${minor ? "m" : "M"}${root}`;
  for (const [id, st] of Object.entries(input.cards)) {
    const t = parseScaleId(id);
    if (!t) continue;
    const skill = t.rhythm ? `${t.drill}:${t.rhythm}` : t.drill;
    note(`${hubOf(t.root, t.kind !== "major")}/${skill}`, st.box / BOXES, input.lit.has(id));
  }
  // what relatives have carried over shows as a first glimmer on exercises not yet met
  for (const [id, c] of Object.entries(input.credit)) {
    const t = parseScaleId(id);
    if (!t || input.cards[id]) continue;
    note(`${hubOf(t.root, t.kind !== "major")}/${t.rhythm ? `${t.drill}:${t.rhythm}` : t.drill}`, Math.min(1, c) * 0.12, false);
  }
  // playing a pattern freely counts as having been there
  for (const e of input.free) {
    const t = parseScaleId(`scale:${e.key}:${e.pattern === "melody" ? "run" : e.pattern}`);
    if (t) note(`${hubOf(t.root, t.kind !== "major")}/${t.drill}`, 0.1, false);
  }

  // a key also grows with the tunes played in it, not only with its drills
  const tuneFill = new Map<string, number[]>();
  for (const t of input.tunes) {
    const k = parseKey(t.key);
    if (k) tuneFill.set(hubOf(k.pc, k.minor), [...(tuneFill.get(hubOf(k.pc, k.minor)) ?? []), t.fill]);
  }
  const tunesOf = (hub: string) => {
    const fills = tuneFill.get(hub);
    return fills?.length ? fills.reduce((a, b) => a + b, 0) / fills.length : 0;
  };
  const hubHas = (hub: string) => skillsOf(fill, hub) > 0 || tunesOf(hub) > 0;

  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  const filled = (id: string) => (fill.get(id) ?? 0) > 0;
  for (let pc = 0; pc < 12; pc++) {
    const angle = slot(pc) * 30;
    for (const minor of [false, true]) {
      const root = minor ? mod(pc + 9) : pc; // the relative minor sits inside its major
      const hub = hubOf(root, minor);
      const radius = minor ? R_MINOR : R_MAJOR;
      const out = minor ? -1 : 1; // minors grow towards the middle
      const skills = SKILLS.map(([skill, label, steps, aside, parent]) => {
        const id = `${hub}/${skill}`;
        const p = polar(radius + out * (10 + steps * (minor ? 15 : 19)), angle + aside * (minor ? 1.7 : 1));
        nodes.push({ id, kind: "skill", label, title: `${(minor ? MINOR_NAMES : MAJOR_NAMES)[slot(pc)]} · ${label}`, ...p, r: 5, fill: fill.get(id) ?? 0, lit: lit.has(id) });
        edges.push({ from: parent ? `${hub}/${parent}` : hub, to: id, on: filled(id) });
        return fill.get(id) ?? 0;
      });
      const mean = Math.max(skills.reduce((a, b) => a + b, 0) / skills.length, tunesOf(hub));
      const name = (minor ? MINOR_NAMES : MAJOR_NAMES)[slot(pc)];
      nodes.push({ id: hub, kind: minor ? "minor" : "major", label: name, title: name, ...polar(radius, angle), r: minor ? 13 : 17, fill: mean, lit: SKILLS.some(([s]) => lit.has(`${hub}/${s}`)) });
      if (minor) edges.push({ from: hubOf(pc, false), to: hub, on: mean > 0 && hubHas(hubOf(pc, false)) });
      else edges.push({ from: hub, to: hubOf(mod(pc + 7), false), on: mean > 0 && hubHas(hubOf(mod(pc + 7), false)) });
    }
  }

  // tunes: fanned out when a key has several
  const byHub = new Map<string, TreeInput["tunes"]>();
  for (const t of input.tunes) {
    const k = parseKey(t.key);
    if (!k) continue;
    const hub = hubOf(k.pc, k.minor);
    byHub.set(hub, [...(byHub.get(hub) ?? []), t]);
  }
  byHub.forEach((tunes, hub) => {
    const at = nodes.find((n) => n.id === hub)!;
    const minor = hub.startsWith("m");
    const pc = Number(hub.slice(1));
    const angle = slot(minor ? mod(pc + 3) : pc) * 30;
    tunes.forEach((t, i) => {
      // on the rim: a major key's tunes on its own spoke, a minor key's between that spoke and the next
      const fan = i - (tunes.length - 1) / 2;
      const p = polar(R_TUNES + (input.stagger && i % 2 ? STAGGER : 0), minor ? angle + 15 + fan * 5 : angle + fan * 9);
      const id = `tune:${t.id}`;
      nodes.push({ id, kind: "tune", label: t.title, title: t.title, ...p, r: 8, fill: t.fill, lit: false });
      edges.push({ from: at.id, to: id, on: t.fill > 0 });
    });
  });
  return { nodes, edges };
}

function skillsOf(fill: Map<string, number>, hub: string): number {
  return SKILLS.reduce((n, [skill]) => n + (fill.get(`${hub}/${skill}`) ?? 0), 0);
}

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Accidental, BarlineType, Beam, Curve, Dot, Formatter, Renderer, Stave, StaveNote, StaveTie, Tuplet, VibratoBracket, Voice } from "vexflow";
import type { Note } from "vexflow";
import type { NoteResult, ReadingBar } from "../core/contract";
import type { Flow } from "../tunes/flow";
import { registerNoteBoxes, type NoteBox } from "../song/noteBoxes";
import { drawChord } from "./Score";
import "../song/score-flow.css";

// The score as a river: the tune as it is played, on one line that flows right to left under a
// still line where the music is now. Notes are spaced by time, so while the band plays the line
// glides smoothly locked to the heard clock (with a light phase-locked velocity filter so audio
// buffer quantums never jitter the river); at the player's own pace it eases on to each note.
// Rendered once per flow into small isolated chunks; playback only translates the track and
// incrementally toggles the 1–2 changed notes — zero per-note reflows, zero layout thrashing.

interface ScoreFlowProps {
  flow: Flow;
  results: readonly NoteResult[]; // per flow note
  active: readonly number[]; // flow notes of the note in play
  clock?: () => number | null; // the timeline beat the music is at, while it plays (through gaps too)
  heard?: () => number | null; // the same, but nothing while the band leaves a gap: the line rests then
  follow: number | null; // the timeline beat of the note being looked for, while nothing sounds
  hold?: boolean; // stay put: a pass has just finished
  lookahead: number; // beats in view ahead of the line
  scale?: number; // but never smaller than this
  labels?: readonly (string | null)[] | null; // under each flow note
  pulse?: number; // changes when the line should call for attention
  trackRef?: RefObject<HTMLDivElement>; // overlays drawn by note position travel inside it
  children?: ReactNode;
  onZoom?: (step: 1 | -1) => void; // closer (1) or wider (-1)
}

const STAVE_Y = 54; // section names above, then chord symbols, then the staff
const SECTION_Y = 20;
const STAFF_TOP = STAVE_Y + 40;
const STAFF_BOTTOM = STAVE_Y + 80;
const PAD_R = 14; // generous breathing room after the last note of a bar before its barline
const HEAD = 5.5; // half a notehead: where a note is
const MIN_GAP = 36; // the closest two of the commonest short notes may sit without crowding accidentals
const Z_MIN = 0.72;
const Z_MAX = 2.6;
const CHUNK = 640; // small ~2-bar pieces: a note turning green repaints a tiny tile, never a huge wall
const JUMP_BEATS = 0.32; // a real seek or loop wrap snaps cleanly instead of chasing
const SHOWN_MARGIN = 1800; // river units kept visible ahead of the view (a quarter behind)

/** Width of a beat: room for the shortest note value the tune uses often, in a calm range. */
function beatWidth(bars: readonly ReadingBar[]): number {
  const counts = new Map<number, number>();
  let all = 0;
  for (const b of bars) for (const n of b.notes) if (!n.rest) {
    const d = Math.round(n.durationBeats * 96) / 96;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    all++;
  }
  const common = [...counts.entries()].filter(([, c]) => c >= Math.max(4, all * 0.06)).map(([d]) => d);
  const shortest = common.length ? Math.min(...common) : 1;
  return Math.max(64, Math.min(128, MIN_GAP / Math.max(1 / 8, shortest)));
}

interface Chunk {
  el: HTMLDivElement;
  x0: number; // where it starts in the river's own units
  width: number;
}

interface Layout {
  width: number;
  height: number;
  chunks: Chunk[]; // small isolated SVG pieces of 1–2 bars each
  base: number[]; // x of each bar's first beat, plus one past the end
  starts: number[]; // timeline beat of each bar's start, plus the end
  lead0: number; // the opening clef and key: past this the sticky clef takes over
  keys: string[]; // the key in force in each bar
  notes: SVGElement[];
  boxes: NoteBox[]; // river-unit notehead coordinates cached once from VexFlow
}

function render(host: HTMLDivElement, flow: Flow, labels: readonly (string | null)[] | null | undefined): Layout {
  const css = getComputedStyle(host);
  const ink = css.getPropertyValue("--flow-ink").trim() || "#efe8d8";
  const soft = css.getPropertyValue("--flow-soft").trim() || "#8f8a7c";
  const chordInk = css.getPropertyValue("--flow-chord").trim() || "#e3b45e";
  const { bars } = flow.exercise;
  const ppb = beatWidth(bars);
  const labelRoom = labels ? 26 : 0;
  const height = STAFF_BOTTOM + 68 + labelRoom;

  // where every bar goes: a barline, its own clef/key/meter if any, then its beats in proportion
  let key = flow.exercise.keySignature;
  const keys: string[] = [];
  const modifiers = (stave: Stave, b: ReadingBar, j: number) => {
    if (j === 0) {
      stave.addClef("treble").addKeySignature(key);
      if (flow.exercise.timeSignature) stave.addTimeSignature(flow.exercise.timeSignature);
    } else {
      if (b.keyChange) stave.addKeySignature(b.keyChange, key);
      if (b.timeChange) stave.addTimeSignature(b.timeChange);
    }
    if (b.keyChange) key = b.keyChange;
  };
  const lead = bars.map((b, j) => {
    const probe = new Stave(0, STAVE_Y, 100);
    modifiers(probe, b, j);
    keys.push(key);
    return probe.getNoteStartX();
  });
  const padL = bars.map((b) => (b.notes[0] && !b.notes[0].rest && b.notes[0].accidental ? 18 : 8));
  const beatsOf = flow.bars.map((fb) => fb.beats);
  const base: number[] = [];
  const barline: number[] = [];
  bars.forEach((_, j) => {
    base[j] = j === 0 ? 2 + lead[0] + padL[0] : base[j - 1] + beatsOf[j - 1] * ppb + PAD_R + lead[j] + padL[j];
    barline[j] = base[j] - padL[j] - lead[j];
  });
  const n = bars.length;
  const endLine = n ? base[n - 1] + beatsOf[n - 1] * ppb + PAD_R : 0;
  base[n] = endLine + 8;
  barline[n] = endLine;
  const width = Math.ceil(endLine + 40);

  // Build every piece off-DOM in a fragment so mounting a 100-bar tune commits once.
  const chunkOf: number[] = [];
  const pieces: { from: number; x0: number; x1: number }[] = [];
  bars.forEach((_, j) => {
    const open = pieces[pieces.length - 1];
    if (!open || barline[j + 1] - open.x0 > CHUNK) pieces.push({ from: j, x0: j === 0 ? 0 : barline[j], x1: barline[j + 1] });
    else open.x1 = barline[j + 1];
    chunkOf.push(pieces.length - 1);
  });
  if (pieces.length) pieces[pieces.length - 1].x1 = width;
  const frag = document.createDocumentFragment();
  const ctxs = pieces.map((piece) => {
    const el = document.createElement("div");
    el.className = "flow-chunk";
    frag.appendChild(el);
    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(piece.x1 - piece.x0, height);
    const c = renderer.getContext();
    c.setFillStyle(ink);
    c.setStrokeStyle(ink);
    return { c, el, svg: el.querySelector("svg")! };
  });
  let ctx = ctxs[0]?.c;
  let svg = ctxs[0]?.svg;
  const xAt = (j: number, rel: number) => base[j] + (rel / beatsOf[j]) * (base[j + 1] - base[j]);

  key = flow.exercise.keySignature;
  const drawn: { sn: StaveNote; n: ReadingBar["notes"][number]; run: number; bar: number; ctx: typeof ctx }[] = [];
  const els: SVGElement[] = [];
  const boxes: NoteBox[] = [];
  const sectionAt = new Map(flow.sections.map((s) => [s.from, s]));
  let chordEnd = -Infinity;
  let labelEnd = -Infinity;
  bars.forEach((bar, j) => {
    ({ c: ctx, svg } = ctxs[chunkOf[j]]);
    const stave = new Stave(barline[j], STAVE_Y, barline[j + 1] - barline[j]);
    modifiers(stave, bar, j);
    if (j === n - 1) stave.setEndBarType(BarlineType.END);
    stave.setContext(ctx).draw();

    const section = sectionAt.get(j);
    const fb = flow.bars[j];
    const prev = flow.bars[j - 1];
    if (section) {
      const seam = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      seam.setAttribute("x", String(barline[j] - 0.75));
      seam.setAttribute("y", String(SECTION_Y - 12));
      seam.setAttribute("width", "1.5");
      seam.setAttribute("height", String(STAFF_BOTTOM + 10 - (SECTION_Y - 12)));
      seam.setAttribute("class", "flow-seam");
      svg.insertBefore(seam, svg.firstChild);
      const tx = barline[j] + (j === 0 ? 4 : 7);
      ctx.save();
      ctx.setFont("Fraunces, Georgia, serif", 19, "600", "italic");
      ctx.setFillStyle(chordInk);
      ctx.fillText(section.label, tx, SECTION_Y + 2);
      const w = ctx.measureText(section.label).width;
      if (section.pass > 1) {
        ctx.setFont("JetBrains Mono, monospace", 9, "normal");
        ctx.fillText(`×${section.pass}`, tx + w + 4, SECTION_Y - 5);
      }
      ctx.restore();
    }
    if (section || (prev && prev.run !== fb.run)) {
      ctx.save();
      ctx.setFont("JetBrains Mono, monospace", 9, "normal");
      ctx.setFillStyle(soft);
      ctx.fillText(fb.number, barline[j] + 3, STAFF_TOP - 5);
      ctx.restore();
    }

    const notes = bar.notes.map((m) => {
      const sn = new StaveNote({ keys: [m.rest ? "b/4" : m.vexKey], duration: m.duration, type: m.rest ? "r" : undefined, auto_stem: !m.rest });
      if (!m.rest && m.accidental) sn.addModifier(new Accidental(m.accidental), 0);
      if (m.dotted) Dot.buildAndAttach([sn], { all: true });
      return sn;
    });
    const tuplets: Tuplet[] = [];
    let group: StaveNote[] = [];
    bar.notes.forEach((m, ni) => {
      if (!m.tuplet) {
        group = [];
        return;
      }
      if (m.tuplet.edge === "start") group = [];
      group.push(notes[ni]);
      const closes = m.tuplet.edge === "stop" || (!bar.notes.some((o) => o.tuplet?.edge) && group.length === m.tuplet.actual);
      if (closes) {
        tuplets.push(new Tuplet(group, { num_notes: m.tuplet.actual, notes_occupied: m.tuplet.normal }));
        group = [];
      }
    });
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(notes);
    const beams = Beam.generateBeams(notes, { maintain_stem_directions: false });
    new Formatter().joinVoices([voice]).format([voice], Math.max(40, barline[j + 1] - stave.getNoteStartX() - 12));
    const barStart = bar.notes[0]?.startBeat ?? 0;
    const lone = bar.notes.length === 1 && bar.notes[0].rest;
    notes.forEach((sn, ni) => {
      sn.setStave(stave);
      const tc = sn.getTickContext();
      const want = lone ? (base[j] + base[j + 1]) / 2 - 8 : xAt(j, bar.notes[ni].startBeat - barStart);
      tc.setX(tc.getX() + want - sn.getAbsoluteX());
    });
    voice.draw(ctx, stave);
    ctx.openGroup("score-note-links");
    beams.forEach((b) => b.setContext(ctx).draw());
    tuplets.forEach((t) => t.setContext(ctx).draw());
    ctx.closeGroup();

    let chordBeat = 0;
    bar.chordSymbols.forEach((symbol, ci) => {
      chordBeat = bar.chordBeats?.[ci] ?? chordBeat;
      chordEnd = drawChord(ctx, symbol, Math.max(xAt(j, chordBeat) - 2, chordEnd + 12), STAVE_Y + 4, chordInk);
      chordBeat += fb.beats / bar.chordSymbols.length;
    });

    if (labels) {
      ctx.save();
      ctx.setFont("JetBrains Mono, monospace", 11, "bold");
      ctx.setFillStyle(chordInk);
      let k = drawn.length;
      bar.notes.forEach((m, ni) => {
        if (m.rest) return;
        const label = labels[k++];
        const lx = notes[ni].getAbsoluteX() - 2;
        if (!label || lx < labelEnd + 4) return;
        ctx.fillText(label, lx, STAFF_BOTTOM + 58);
        labelEnd = lx + label.length * 7;
      });
      ctx.restore();
    }

    bar.notes.forEach((m, ni) => {
      if (m.rest) return;
      const sn = notes[ni];
      const w = typeof sn.getGlyphWidth === "function" ? sn.getGlyphWidth() || 11 : 11;
      const ys = sn.getYs();
      boxes.push({ x: sn.getAbsoluteX(), y: (ys[0] ?? STAFF_TOP + 20) - 5, w, h: 10 });
      drawn.push({ sn, n: m, run: fb.run, bar: j, ctx });
    });
  });

  const openSlurs = new Map<number, (typeof drawn)[number]>();
  let openVibrato: (typeof drawn)[number] | null = null;
  ctxs.forEach(({ c }) => c.openGroup("score-note-links"));
  drawn.forEach((d, k) => {
    const next = drawn[k + 1];
    if (d.n.tieToNext && next) new StaveTie({ first_note: d.sn, last_note: next.sn, first_indices: [0], last_indices: [0] }).setContext(d.ctx).draw();
    if (d.n.slur?.stop !== undefined) {
      const from = openSlurs.get(d.n.slur.stop);
      if (from && from.run === d.run && d.bar - from.bar <= 2) new Curve(from.sn as Note, d.sn as Note, { cps: [{ x: 0, y: 12 }, { x: 0, y: 12 }] }).setContext(from.ctx).draw();
      openSlurs.delete(d.n.slur.stop);
    }
    if (d.n.slur?.start !== undefined) openSlurs.set(d.n.slur.start, d);
    if (d.n.vibrato === "both") new VibratoBracket({ start: d.sn, stop: next ? next.sn : null }).setContext(d.ctx).draw();
    if (d.n.vibrato === "start") openVibrato = d;
    if (d.n.vibrato === "stop" && openVibrato) {
      new VibratoBracket({ start: openVibrato.sn, stop: d.sn }).setContext(openVibrato.ctx).draw();
      openVibrato = null;
    }
  });
  ctxs.forEach(({ c }) => c.closeGroup());
  const chunks = pieces.map((piece, i) => {
    const { svg: own, el } = ctxs[i];
    own.setAttribute("viewBox", `${piece.x0} 0 ${piece.x1 - piece.x0} ${height}`);
    own.setAttribute("preserveAspectRatio", "xMinYMin meet");
    return { el, x0: piece.x0, width: piece.x1 - piece.x0 };
  });
  // Commit all chunks once, then resolve VexFlow SVGElements (VexFlow looks them up via document.getElementById).
  host.replaceChildren(frag);
  drawn.forEach((d) => {
    const el = d.sn.getSVGElement();
    if (el) els.push(el);
  });
  els.forEach((el, i) => el.setAttribute("data-note", String(i)));
  return { width, height, chunks, base, starts: [...flow.bars.map((b) => b.start), flow.end], lead0: lead[0] ?? 0, keys, notes: els, boxes };
}

/** The bar a timeline beat falls in. */
function barAt(starts: readonly number[], beat: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (starts[mid] <= beat + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, starts.length - 2);
}

/** A little stave with the clef and the key in force, where the river's left edge is. */
const StickyClef = memo(function StickyClef({ keySpec, z, visible }: { keySpec: string; z: number; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const stage = document.createElement("div");
    const probe = new Stave(0, STAVE_Y, 100).addClef("treble").addKeySignature(keySpec);
    const width = Math.ceil(probe.getNoteStartX() + 14);
    const renderer = new Renderer(stage, Renderer.Backends.SVG);
    renderer.resize(width, STAFF_BOTTOM + 20);
    const stave = new Stave(0, STAVE_Y, width).addClef("treble").addKeySignature(keySpec);
    stave.setBegBarType(BarlineType.NONE).setEndBarType(BarlineType.NONE);
    stave.setContext(renderer.getContext()).draw();
    const svg = stage.querySelector("svg");
    svg?.setAttribute("viewBox", `0 0 ${width} ${STAFF_BOTTOM + 20}`);
    if (svg) el.replaceChildren(svg);
    setW(width);
  }, [keySpec]);
  useLayoutEffect(() => {
    const svg = host.current?.querySelector("svg");
    if (!svg || !w) return;
    svg.style.width = `${w * z}px`;
    svg.style.height = `${(STAFF_BOTTOM + 20) * z}px`;
  }, [w, z]);
  return <div className={`flow-clef ${visible ? "is-on" : ""}`} ref={host} aria-hidden="true" />;
});

export const ScoreFlow = memo(function ScoreFlow({ flow, results, active, clock, heard, follow, hold = false, lookahead, scale = 1, labels = null, pulse = 0, trackRef, children, onZoom }: ScoreFlowProps) {
  const river = useRef<HTMLDivElement>(null);
  const ownTrack = useRef<HTMLDivElement>(null);
  const track = trackRef ?? ownTrack;
  const svgHost = useRef<HTMLDivElement>(null);
  const nowLine = useRef<HTMLDivElement>(null);
  const formFill = useRef<HTMLSpanElement>(null);
  const formParts = useRef<HTMLSpanElement[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [keyNow, setKeyNow] = useState(flow.exercise.keySignature);
  const [sticky, setSticky] = useState(false);
  const pos = useRef<number | null>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const applied = useRef<{ active: Set<number>; results: NoteResult[]; hits: number }>({ active: new Set(), results: [], hits: 0 });

  useLayoutEffect(() => {
    const el = river.current;
    if (!el) return;
    const measure = (width = el.clientWidth) => setBox({ w: Math.floor(width), h: window.innerHeight });
    if (typeof ResizeObserver === "undefined") {
      const resized = () => measure();
      measure();
      window.addEventListener("resize", resized);
      return () => window.removeEventListener("resize", resized);
    }
    const ro = new ResizeObserver(([entry]) => measure(entry?.contentRect.width ?? el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasWidth = box.w >= 120;
  useEffect(() => {
    const host = svgHost.current;
    if (!host || !hasWidth) return;
    const l = render(host, flow, labels);
    applied.current = { active: new Set(), results: [], hits: 0 };
    setLayout(l);
    pos.current = null;
  }, [flow, labels, hasWidth]);

  // how close the river is: the beats ahead of the line fill what is in front of it
  const narrow = box.w < 700;
  const anchor = narrow ? 0.2 : 0.28;
  const ppb = useMemo(() => beatWidth(flow.exercise.bars), [flow]);
  const fit = layout ? (box.h * (narrow ? 0.5 : 0.42)) / layout.height : Z_MAX;
  const z = layout ? Math.max(Z_MIN, Math.min(Z_MAX, fit, Math.max(scale * (narrow ? 0.85 : 1), (box.w * (1 - anchor)) / (lookahead * ppb)))) : 1;

  useLayoutEffect(() => {
    if (!layout) return;
    for (const chunk of layout.chunks) {
      chunk.el.style.left = `${chunk.x0 * z}px`;
      const svg = chunk.el.firstElementChild as SVGSVGElement | null;
      if (!svg) continue;
      svg.style.width = `${chunk.width * z}px`;
      svg.style.height = `${layout.height * z}px`;
    }
    if (track.current) {
      const scaled = layout.boxes.map((b) => ({ x: b.x * z, y: b.y * z, w: b.w * z, h: b.h * z }));
      registerNoteBoxes(track.current, () => scaled);
    }
  }, [layout, z, track]);

  // Incremental note state toggling: O(changed) instead of touching all 400+ SVG notes on every beat.
  const activeKey = active.join(",");
  useEffect(() => {
    if (!layout) return;
    const prev = applied.current;
    const nextActive = new Set(active);
    const notes = layout.notes;

    for (const i of prev.active) if (!nextActive.has(i)) notes[i]?.classList.remove("is-active");
    for (const i of nextActive) if (!prev.active.has(i)) notes[i]?.classList.add("is-active");
    prev.active = nextActive;

    let hitDelta = 0;
    const n = notes.length;
    for (let i = 0; i < n; i++) {
      const r = results[i] ?? null;
      const old = prev.results[i] ?? null;
      if (r === old) continue;
      const el = notes[i];
      if (!el) continue;
      el.classList.toggle("is-hit", r === "hit");
      el.classList.toggle("is-miss", r === "miss");
      if (r === "hit" && old !== "hit") hitDelta++;
      else if (old === "hit" && r !== "hit") hitDelta--;
    }
    prev.results = results.slice(0, n);
    prev.hits += hitDelta;

    // Pure compositor flare on hit via WAAPI: zero offsetWidth reflow, zero box-shadow repaint.
    if (hitDelta > 0 && nowLine.current && typeof nowLine.current.animate === "function") {
      if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        nowLine.current.animate(
          [
            { opacity: 1, transform: "scaleX(2.1) scaleY(1.05)" },
            { opacity: 0.86, transform: "scaleX(1) scaleY(1)" },
          ],
          { duration: 300, easing: "cubic-bezier(0.16, 0.82, 0.28, 1)" },
        );
      }
    }
  }, [layout, activeKey, results]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = nowLine.current;
    if (!el || !pulse || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ opacity: 1, transform: "scaleX(2)" }, { opacity: 0.55, transform: "scaleX(1)" }, { opacity: 1, transform: "scaleX(1.6)" }, { opacity: 0.86, transform: "scaleX(1)" }],
      { duration: 1400, easing: "ease-out" },
    );
  }, [pulse]);

  // Smooth PLL-driven scrolling loop: stays alive across follow/hold/clock updates without tearing down.
  const live = useRef({ clock, heard, follow, hold });
  live.current = { clock, heard, follow, hold };
  useEffect(() => {
    wakeRef.current();
  }, [clock, heard, follow, hold]);

  useEffect(() => {
    const el = track.current;
    if (!el || !layout || !box.w) return;
    const { base, starts } = layout;
    const xOf = (beat: number) => {
      const j = barAt(starts, beat);
      const span = starts[j + 1] - starts[j];
      const f = span > 0 ? Math.max(0, Math.min(1, (beat - starts[j]) / span)) : 0;
      return base[j] + f * (base[j + 1] - base[j]);
    };
    const ax = box.w * anchor;
    const txOf = (x: number) => ax - (x + HEAD) * z;
    const total = Math.max(1e-6, flow.end - flow.start);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let x = pos.current ?? Number.NaN;
    let lastTx = Number.NaN;
    let part = -1;
    let keyShown = "";
    let stickyShown: boolean | null = null;
    let gapShown = false;
    let fillShown = -1;
    const near = layout.chunks.map(() => true);
    let last = 0;
    let frame = 0;

    // Phase-locked beat tracker: eliminates CoreAudio buffer staircase jitter without Web Animation
    // cancel/recreate hitches, gliding seamlessly at 60Hz or 120Hz.
    let smoothBeat = Number.NaN;
    let beatVel = 0; // beats per second
    let lastRawBeat = Number.NaN;
    let lastRawT = 0;

    const fadeTurn = () => {
      if (reduced || typeof el.animate !== "function") return;
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 650, easing: "ease-out" });
    };

    const step = (now: number) => {
      frame = 0;
      const { clock: music, heard: sounding, follow: wanted, hold: still } = live.current;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const rawBeat = music?.() ?? null;

      const silent = rawBeat !== null && sounding !== undefined && sounding() === null;
      if (silent !== gapShown) {
        gapShown = silent;
        nowLine.current?.classList.toggle("is-gap", silent);
      }

      let beatForPos: number | null = null;
      if (rawBeat !== null) {
        if (Number.isNaN(smoothBeat) || Math.abs(rawBeat - smoothBeat) > JUMP_BEATS) {
          smoothBeat = rawBeat;
          lastRawBeat = rawBeat;
          lastRawT = now;
          beatVel = 0;
        } else {
          if (rawBeat > lastRawBeat + 1e-5) {
            const elapsedS = (now - lastRawT) / 1000;
            if (elapsedS > 0.004 && elapsedS < 0.8) {
              const inst = (rawBeat - lastRawBeat) / elapsedS;
              if (inst > 0.25 && inst < 12) {
                beatVel = beatVel > 0 ? beatVel + (inst - beatVel) * Math.min(1, elapsedS / 0.3) : inst;
              }
            }
            lastRawBeat = rawBeat;
            lastRawT = now;
          }
          smoothBeat += beatVel * dt;
          smoothBeat += (rawBeat - smoothBeat) * (1 - Math.exp(-dt / 0.12));
        }
        beatForPos = smoothBeat;
      } else {
        smoothBeat = Number.NaN;
        lastRawBeat = Number.NaN;
        beatVel = 0;
      }

      const target = beatForPos !== null ? xOf(beatForPos) : still ? x : wanted !== null ? xOf(wanted) : xOf(flow.start);
      const gap = target - x;
      const far = !Number.isNaN(x) && Math.abs(gap) * z > box.w * 1.2;
      if (far) fadeTurn();

      if (far || Number.isNaN(x) || reduced || (beatForPos !== null && Math.abs(gap) < 36 / z)) {
        x = target;
      } else {
        x += gap * (1 - Math.exp(-dt / (beatForPos !== null ? 0.12 : 0.2)));
      }

      const tx = txOf(x);
      if (Number.isNaN(lastTx) || Math.abs(tx - lastTx) > 0.05) {
        el.style.transform = `translate3d(${tx.toFixed(2)}px, 0, 0)`;
        lastTx = tx;
      }
      pos.current = x;

      // Cull off-screen chunks with visibility:hidden (never display:none, which triggers layout/rebuild spikes).
      const from = -tx / z - SHOWN_MARGIN / 4;
      const to = (box.w - tx) / z + SHOWN_MARGIN;
      for (let i = 0; i < layout.chunks.length; i++) {
        const c = layout.chunks[i];
        const on = c.x0 + c.width >= from && c.x0 <= to;
        if (on === near[i]) continue;
        near[i] = on;
        c.el.style.visibility = on ? "" : "hidden";
      }

      const at = rawBeat ?? (still ? null : wanted) ?? flow.start;
      const shownBeat = rawBeat !== null ? rawBeat : Math.max(flow.start, Math.min(flow.end, at));
      const fill = Math.max(0, Math.min(1, (shownBeat - flow.start) / total));
      if (formFill.current && Math.abs(fill - fillShown) > 0.002) {
        formFill.current.style.transform = `scaleX(${fill})`;
        fillShown = fill;
      }
      const p = flow.sections.findIndex((s) => shownBeat >= s.start - 1e-9 && shownBeat < s.start + s.beats - 1e-9);
      if (p !== part) {
        formParts.current.forEach((s, i) => {
          s?.classList.toggle("is-now", i === p);
          s?.classList.toggle("is-past", p >= 0 && i < p);
        });
        part = p;
      }
      const k = layout.keys[barAt(starts, shownBeat)] ?? flow.exercise.keySignature;
      if (k !== keyShown) {
        keyShown = k;
        setKeyNow(k);
      }
      const stick = tx + (layout.lead0 + 6) * z < 0;
      if (stick !== stickyShown) {
        stickyShown = stick;
        setSticky(stick);
      }

      const settled = rawBeat === null && Math.abs(target - x) < 0.05;
      if (!settled || music) frame = requestAnimationFrame(step);
    };

    const wake = () => {
      if (!frame) {
        last = 0;
        frame = requestAnimationFrame(step);
      }
    };
    wakeRef.current = wake;
    wake();
    return () => {
      wakeRef.current = () => undefined;
      cancelAnimationFrame(frame);
      frame = 0;
    };
  }, [layout, box.w, z, anchor, flow, track]);

  // zoom by hand: pinch on a trackpad (ctrl/⌘ + wheel) or two fingers on a screen
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  useEffect(() => {
    const el = river.current;
    if (!el) return;
    let wheel = 0;
    let pinch: number | null = null;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) > 40) {
        zoomRef.current?.(wheel < 0 ? 1 : -1);
        wheel = 0;
      }
    };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        pinch = null;
        return;
      }
      const d = dist(e.touches);
      if (pinch === null) pinch = d;
      else if (d / pinch > 1.25 || d / pinch < 0.8) {
        zoomRef.current?.(d > pinch ? 1 : -1);
        pinch = d;
      }
      e.preventDefault();
    };
    const end = () => (pinch = null);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouch, { passive: false });
    el.addEventListener("touchend", end);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouch);
      el.removeEventListener("touchend", end);
    };
  }, []);

  const total = Math.max(1e-6, flow.end - flow.start);
  const style = {
    "--z": z,
    "--anchor": `${anchor * 100}%`,
    "--now-top": `${(STAFF_TOP - 22) * z}px`,
    "--now-height": `${(STAFF_BOTTOM - STAFF_TOP + 44) * z}px`,
    "--river-height": `${(layout?.height ?? 180) * z}px`,
  } as CSSProperties;
  return (
    <div className="flow" style={style}>
      {flow.sections.length > 1 ? (
        <div className="flow-form" aria-label="form of the tune">
          {flow.sections.map((s, i) => (
            <span key={`${s.from}`} ref={(el) => { if (el) formParts.current[i] = el; }} style={{ flexGrow: s.beats / total }}>
              <b>{s.label}</b>
              {s.pass > 1 ? <i>×{s.pass}</i> : null}
            </span>
          ))}
          <span className="flow-form-fill" ref={formFill} aria-hidden="true" />
        </div>
      ) : null}
      <div className="flow-river" ref={river} data-pool="rock calm" data-pool-anchor="focus">
        <div className="flow-sky">
          <div className="flow-track" ref={track}>
            <div className="flow-paper" ref={svgHost} aria-label="score" />
            {children}
          </div>
        </div>
        <StickyClef keySpec={keyNow} z={z} visible={sticky} />
        <div className="flow-now" ref={nowLine} aria-hidden="true" />
      </div>
      {onZoom ? (
        <div className="flow-zoom">
          <button type="button" onClick={() => onZoom(-1)} aria-label="Wider: more of what is coming">−</button>
          <button type="button" onClick={() => onZoom(1)} aria-label="Closer: larger notes">+</button>
        </div>
      ) : null}
    </div>
  );
});

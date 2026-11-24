import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Accidental,
  BarlineType,
  Beam,
  Curve,
  Dot,
  Formatter,
  Glyph,
  Renderer,
  Repetition,
  Stave,
  StaveNote,
  StaveTie,
  Tuplet,
  VibratoBracket,
  Voice,
  VoltaType,
} from "vexflow";
import type { Note } from "vexflow";
import type { NoteResult, ReadingBar, ReadingExercise } from "../core/contract";

interface ScoreProps {
  exercise: Pick<ReadingExercise, "bars" | "keySignature" | "timeSignature">;
  activeStep: number; // index among non-rest notes, -1 for none
  activeNotes?: number[]; // all heads of the active note (a tied note), when more than activeStep
  results: NoteResult[]; // parallel to non-rest notes
  showFingering: boolean;
  autoScroll?: boolean; // keep the active note in view (long tunes)
  onBarClick?: (bar: number, extend: boolean) => void;
  marked?: { start: number; end: number } | null; // printed bars to highlight, e.g. a loop
  playingBar?: number; // printed bar under the playhead
  focusBars?: number[] | null; // notes outside these bars fade back
  hideBars?: number[] | null; // notes in these bars stay hidden until played (from memory)
  noteVisibility?: "played" | "landmarks" | "hidden"; // concealed bars: reveal results, bar starts only, or no notes
  noteLabels?: (string | null)[] | null; // a label under each note, e.g. its degree over the chord
  cursor?: boolean; // a lit column behind the active note: where the eyes come back to
  cursorPulse?: number; // changes when the cursor should call for attention
  reentryCue?: boolean; // last 2 beats before Bar 1 loops back: softly highlight note 0 as the landing target
  barsPerLine?: number; // short excerpts can fill their available width
  playhead?: () => number | null; // where the heard music is, as a printed note index and the way to the next (3.4): a faint line glides there
}

const BARS_PER_LINE_WIDE = 4;
const BARS_PER_LINE_NARROW = 2;
const LINE_HEIGHT = 156; // crisp balance: clears low guitar ledger lines without leaving a dead-space void
const TOP_PAD = 48; // generous headroom above top stave so high notes (G5-B5) and cursor never clip
const BOTTOM_PAD = 30; // prevents low ledger lines / stems from ever clipping at SVG bottom
const MARK_ROOM = 34; // above the staff for endings and rehearsal marks
const STRING_MARKS = ["①", "②", "③", "④", "⑤", "⑥"]; // string 0 = high e
const CURSOR_WIDTH = 30;
const PLAYHEAD_WIDTH = 2;

function prettyChord(symbol: string): string {
  return symbol
    .replace(/b(\d)/g, "♭$1")
    .replace(/#(\d)/g, "♯$1")
    .replace("maj7", "Δ7")
    .replace(/(^|\/)([A-G])b/g, "$1$2♭")
    .replace(/(^|\/)([A-G])#/g, "$1$2♯");
}

const CHORD_SIZE = 16;

const GLYPHS: Record<string, { code: string; point: number; dx: number; dy: number }> = {
  "♭": { code: "accidentalFlat", point: 26, dx: 1, dy: -5 },
  "♯": { code: "accidentalSharp", point: 26, dx: 1, dy: -6 },
  "Δ": { code: "csymMajorSeventh", point: 30, dx: -3, dy: -1 },
};

/** Right edge of the text element just drawn, from its rendered box (estimates misjudge fallback glyphs such as Δ). */
function drawnRight(ctx: ReturnType<Renderer["getContext"]>, text: string, x: number): number {
  const el = (ctx as unknown as { parent?: Element }).parent?.lastElementChild as SVGTextElement | null | undefined;
  try {
    const box = el?.getBBox?.();
    if (box && box.width > 0 && box.x >= x - 2) return box.x + box.width;
  } catch {
    // not laid out (tests)
  }
  return x + ctx.measureText(text).width;
}

/** Draws a chord symbol, ♭ ♯ Δ as music-font glyphs (text fonts set them loosely); returns its right edge. */
export function drawChord(ctx: ReturnType<Renderer["getContext"]>, symbol: string, x: number, y: number, color: string): number {
  let cx = x;
  ctx.save();
  ctx.setFillStyle(color);
  for (const part of prettyChord(symbol).split(/([♭♯Δ])/)) {
    if (!part) continue;
    const glyph = GLYPHS[part];
    if (glyph) {
      Glyph.renderGlyph(ctx, cx + glyph.dx, y + glyph.dy, glyph.point, glyph.code);
      cx += glyph.dx + Glyph.getWidth(glyph.code, glyph.point) + 2;
    } else {
      ctx.setFont("Fraunces, Georgia, serif", CHORD_SIZE, "bold", "italic");
      ctx.fillText(part, cx, y);
      cx = drawnRight(ctx, part, cx);
    }
  }
  ctx.restore();
  return cx;
}

function repetitionFor(kind: string, text: string): number {
  const t = text.toLowerCase();
  const R = Repetition.type;
  switch (kind) {
    case "segno":
      return R.SEGNO_LEFT;
    case "coda":
      return R.CODA_LEFT;
    case "toCoda":
      return R.TO_CODA;
    case "fine":
      return R.FINE;
    case "dc":
      return /fine/.test(t) ? R.DC_AL_FINE : /coda/.test(t) ? R.DC_AL_CODA : R.DC;
    default:
      return /fine/.test(t) ? R.DS_AL_FINE : /coda/.test(t) ? R.DS_AL_CODA : R.DS;
  }
}

/** Build StaveNotes, tuplets, voice and beams for one bar so we can both measure and draw it accurately. */
function buildBarVoice(bar: ReadingBar) {
  const notes = bar.notes.map((n) => {
    const sn = new StaveNote({
      keys: [n.rest ? "b/4" : n.vexKey],
      duration: n.duration,
      type: n.rest ? "r" : undefined,
      auto_stem: !n.rest,
      align_center: n.rest && n.duration === "w" && bar.notes.length === 1,
    });
    if (!n.rest && n.accidental) sn.addModifier(new Accidental(n.accidental), 0);
    if (n.dotted) Dot.buildAndAttach([sn], { all: true });
    return sn;
  });

  // Tuplets first: they change the notes' ticks before the voice counts them.
  const tuplets: Tuplet[] = [];
  let group: StaveNote[] = [];
  bar.notes.forEach((n, ni) => {
    if (!n.tuplet) {
      group = [];
      return;
    }
    if (n.tuplet.edge === "start") group = [];
    group.push(notes[ni]);
    const closes = n.tuplet.edge === "stop" || (!bar.notes.some((m) => m.tuplet?.edge) && group.length === n.tuplet.actual);
    if (closes) {
      tuplets.push(new Tuplet(group, { num_notes: n.tuplet.actual, notes_occupied: n.tuplet.normal }));
      group = [];
    }
  });

  const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(notes);
  const beams = Beam.generateBeams(notes, { maintain_stem_directions: false });
  const formatter = new Formatter().joinVoices([voice]);
  let minNoteWidth = 64;
  try {
    minNoteWidth = Math.max(64, formatter.preCalculateMinTotalWidth([voice]));
  } catch {
    // jsdom fallback where text metrics are unavailable
  }
  return { notes, tuplets, voice, beams, formatter, minNoteWidth };
}

/** Measure the actual modifier width (clef + key signature + time signature) of a stave. */
function modifierWidth(first: boolean, key: string, prevKey: string, bar: ReadingBar, isFirstBar: boolean, time?: string): number {
  const probe = new Stave(0, 0, 300);
  if (first) probe.addClef("treble").addKeySignature(key);
  else if (bar.keyChange) probe.addKeySignature(key, prevKey);
  if ((isFirstBar && time) || bar.timeChange) probe.addTimeSignature(time!);
  if (bar.repeatStart) probe.setBegBarType(BarlineType.REPEAT_BEGIN);
  return Math.max(0, probe.getNoteStartX());
}

/** Bars per line; a rehearsal mark starts a new line, and dense bars wrap early instead of spilling past barlines. */
function layout(bars: ReadingBar[], perLine: number, minWidths: number[], firstExtra: number, usable: number): { line: number; col: number }[] {
  let line = 0;
  let col = 0;
  let lineUsed = 0;
  return bars.map((b, i) => {
    const need = minWidths[i] + (col === 0 ? firstExtra : 0);
    const overflowsLine = col > 0 && lineUsed + need > usable * 0.98;
    if (i > 0 && (col === perLine || (b.section && col > 0) || overflowsLine)) {
      line++;
      col = 0;
      lineUsed = 0;
    }
    lineUsed += col === 0 ? minWidths[i] + firstExtra : minWidths[i];
    return { line, col: col++ };
  });
}

// Renders the exercise once per (exercise, width, fingering); playback state is applied
// afterwards by toggling classes on the note groups, so the score never re-lays out while playing.
export function Score({
  exercise,
  activeStep,
  activeNotes,
  results,
  showFingering,
  autoScroll = false,
  onBarClick,
  marked = null,
  playingBar = -1,
  focusBars = null,
  hideBars = null,
  noteVisibility = "played",
  noteLabels = null,
  cursor = false,
  cursorPulse = 0,
  reentryCue = false,
  barsPerLine,
  playhead,
}: ScoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const noteEls = useRef<SVGElement[]>([]);
  const noteBars = useRef<number[]>([]);
  const barEls = useRef<SVGRectElement[]>([]);
  const noteSpans = useRef<{ top: number; height: number }[]>([]); // the staff each note sits on
  const cursorEl = useRef<SVGRectElement | null>(null);
  const playheadEl = useRef<SVGRectElement | null>(null);
  const [width, setWidth] = useState(0);
  const hasPlayhead = Boolean(playhead);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || width < 200) return;
    host.innerHTML = "";

    const css = getComputedStyle(host);
    const ink = css.getPropertyValue("--ink").trim() || "#edf4ea";
    const soft = css.getPropertyValue("--ink-faint").trim() || "#6f8574";
    const chordInk = css.getPropertyValue("--brass").trim() || "#dfc068";

    const maxPerLine = barsPerLine ?? (width < 640 ? BARS_PER_LINE_NARROW : BARS_PER_LINE_WIDE);
    const usable = width - 8;

    // Pre-build each bar's voice so we know exact note + accidental widths before placing staves.
    const built = exercise.bars.map((bar) => buildBarVoice(bar));
    const minNoteWidths = built.map((b) => Math.ceil(b.minNoteWidth) + 14);
    const firstMod = modifierWidth(true, exercise.keySignature, exercise.keySignature, exercise.bars[0] ?? ({ notes: [], chordSymbols: [], barIndex: 0 } as ReadingBar), true, exercise.timeSignature);
    const places = layout(exercise.bars, maxPerLine, minNoteWidths, firstMod, usable);
    const lines = (places[places.length - 1]?.line ?? 0) + 1;

    // Compute exact per-line bar widths weighted by each bar's note density + actual clef/key/time modifiers,
    // so dense 8th/16th bars with accidentals get the space they need and NEVER spill past barlines.
    const lineGroups: number[][] = Array.from({ length: lines }, () => []);
    places.forEach((p, idx) => lineGroups[p.line].push(idx));

    const barGeom: { x: number; w: number; modW: number }[] = new Array(exercise.bars.length);
    let trackKey = exercise.keySignature;
    let trackTime = exercise.timeSignature;
    const barMods: number[] = exercise.bars.map((bar, i) => {
      const prev = trackKey;
      if (bar.keyChange) trackKey = bar.keyChange;
      if (bar.timeChange) trackTime = bar.timeChange;
      return modifierWidth(places[i].col === 0, trackKey, prev, bar, i === 0, trackTime);
    });

    // If a line's total minimum required width still exceeds `usable` (very narrow viewport + dense bar),
    // render into a slightly wider viewBox and scale smoothly into `width` so zero clipping occurs.
    let renderWidth = usable;
    for (const indices of lineGroups) {
      const needed = indices.reduce((sum, idx) => sum + barMods[idx] + minNoteWidths[idx], 0);
      if (needed > renderWidth) renderWidth = Math.ceil(needed + 16);
    }

    for (const indices of lineGroups) {
      const targetLineWidth = indices.length < maxPerLine && lines > 1
        ? Math.min(renderWidth, Math.max(
            indices.reduce((sum, idx) => sum + barMods[idx] + minNoteWidths[idx], 0),
            (renderWidth * indices.length) / maxPerLine + barMods[indices[0]],
          ))
        : renderWidth;
      const totalMod = indices.reduce((sum, idx) => sum + barMods[idx], 0);
      const totalMinNotes = indices.reduce((sum, idx) => sum + minNoteWidths[idx], 0);
      const extra = Math.max(0, targetLineWidth - totalMod - totalMinNotes);
      let cx = 4;
      for (const idx of indices) {
        const share = extra * (minNoteWidths[idx] / Math.max(1, totalMinNotes));
        const w = barMods[idx] + minNoteWidths[idx] + share;
        barGeom[idx] = { x: cx, w, modW: barMods[idx] };
        cx += w;
      }
    }

    const hasMarks = exercise.bars.some((b) => b.volta || b.section || b.tempo || b.jumps?.length);
    const markRoom = hasMarks ? MARK_ROOM : 0;
    const fingerRoom = showFingering ? 24 : 0;
    const labelRoom = noteLabels ? 22 : 0;
    const lineHeight = LINE_HEIGHT + fingerRoom + labelRoom + markRoom;
    const totalHeight = lines * lineHeight + BOTTOM_PAD;

    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(renderWidth + 8, totalHeight);
    const ctx = renderer.getContext();
    ctx.setFillStyle(ink);
    ctx.setStrokeStyle(ink);
    const svg = host.querySelector("svg")!;
    svg.setAttribute("viewBox", `0 0 ${renderWidth + 8} ${totalHeight}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
    svg.style.width = "100%";
    svg.style.height = "auto";

    const els: SVGElement[] = [];
    const rects: SVGRectElement[] = [];
    const drawn: { sn: StaveNote; line: number; bar: number; n: ReadingBar["notes"][number]; top: number; height: number }[] = [];
    let key = exercise.keySignature;
    let time = exercise.timeSignature;
    let chordEnd = -Infinity;

    exercise.bars.forEach((bar, i) => {
      const { line, col } = places[i];
      const first = col === 0;
      const { x, w } = barGeom[i];
      const y = line * lineHeight + TOP_PAD + markRoom;
      const last = i === exercise.bars.length - 1;

      const stave = new Stave(x, y, w);
      if (first) chordEnd = -Infinity;
      const prevKey = key;
      if (bar.keyChange) key = bar.keyChange;
      if (bar.timeChange) time = bar.timeChange;
      if (first) stave.addClef("treble").addKeySignature(key);
      else if (bar.keyChange) stave.addKeySignature(key, prevKey);
      if ((i === 0 && time) || bar.timeChange) stave.addTimeSignature(time!);
      if (bar.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
      if (bar.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
      else if (bar.barline === "final" || last) stave.setEndBarType(BarlineType.END);
      else if (bar.barline === "double") stave.setEndBarType(BarlineType.DOUBLE);
      if (bar.volta) {
        const v = bar.volta;
        const type = v.begin && v.end && v.closed ? VoltaType.BEGIN_END : v.begin ? VoltaType.BEGIN : v.end && v.closed ? VoltaType.END : VoltaType.MID;
        stave.setVoltaType(type, v.begin ? v.label : "", -14);
      }
      for (const j of bar.jumps ?? []) stave.setRepetitionType(repetitionFor(j.kind, j.text), -6);
      stave.setContext(ctx).draw();

      // highlight band behind the bar (loop, playhead); clicks are mapped to bars by position
      const top = stave.getYForLine(0) - 16;
      const bottom = stave.getYForLine(4) + 18;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(stave.getNoteStartX() - 6));
      rect.setAttribute("y", String(top));
      rect.setAttribute("width", String(Math.max(10, x + w - stave.getNoteStartX() + 2)));
      rect.setAttribute("height", String(bottom - top));
      rect.setAttribute("rx", "8");
      rect.setAttribute("class", "score-bar");
      rect.dataset.bar = String(i);
      svg.insertBefore(rect, svg.firstChild);
      rects.push(rect);

      // rehearsal mark and tempo, above everything else
      if (bar.section || bar.tempo) {
        let tx = x + (first ? 2 : 4);
        const ty = y - markRoom + 10;
        ctx.save();
        if (bar.section) {
          ctx.setFont("Inter, sans-serif", 12, "bold");
          const label = bar.section;
          const tw = ctx.measureText(label).width;
          ctx.setStrokeStyle(chordInk);
          ctx.setLineWidth(1.2);
          ctx.rect(tx, ty - 12, tw + 10, 18);
          ctx.stroke();
          ctx.setFillStyle(chordInk);
          ctx.fillText(label, tx + 5, ty + 1);
          tx += tw + 20;
        }
        if (bar.tempo && i === 0) {
          ctx.setFont("Inter, sans-serif", 12, "normal");
          ctx.setFillStyle(soft);
          ctx.fillText(`♩ = ${bar.tempo}`, tx, ty + 1);
        }
        ctx.restore();
      }

      const { notes, tuplets, voice, beams, formatter } = built[i];
      const endMargin = last || bar.repeatEnd || bar.barline === "final" ? 22 : 16;
      formatter.format([voice], Math.max(40, x + w - stave.getNoteStartX() - endMargin));
      voice.draw(ctx, stave);
      ctx.openGroup("score-note-links");
      beams.forEach((b) => b.setContext(ctx).draw());
      tuplets.forEach((t) => t.setContext(ctx).draw());
      ctx.closeGroup();

      // Chord symbols above the staff, at their beat: never overlapping.
      const barStartBeat = bar.notes[0]?.startBeat ?? 0;
      const barBeats = bar.beats ?? bar.notes.reduce((a, n) => a + n.durationBeats, 0);
      const points = [
        ...bar.notes.map((n, ni) => ({ beat: n.startBeat - barStartBeat, x: notes[ni].getAbsoluteX() - 4 })),
        { beat: barBeats, x: x + w - 8 },
      ];
      let chordBeat = 0;
      bar.chordSymbols.forEach((symbol, ci) => {
        chordBeat = bar.chordBeats?.[ci] ?? chordBeat;
        const next = points.findIndex((p) => p.beat >= chordBeat - 1e-6);
        const after = points[Math.max(0, next)];
        const before = points[Math.max(0, next - 1)];
        const at =
          Math.abs(after.beat - chordBeat) < 1e-6 || next <= 0
            ? after.x
            : before.x + ((chordBeat - before.beat) / (after.beat - before.beat)) * (after.x - before.x);
        chordEnd = drawChord(ctx, symbol, Math.max(at, chordEnd + 10), y + 4, chordInk);
        chordBeat += 4 / bar.chordSymbols.length;
      });

      // Optional fingering hint under each note: circled string number + fret.
      if (showFingering) {
        ctx.save();
        ctx.setFont("JetBrains Mono, monospace", 10, "normal");
        ctx.setFillStyle(soft);
        bar.notes.forEach((n, ni) => {
          if (n.rest) return;
          const nx = notes[ni].getAbsoluteX();
          ctx.fillText(`${STRING_MARKS[n.string]}${n.fret}`, nx - 6, stave.getYForLine(4) + 52 + fingerRoom / 2);
        });
        ctx.restore();
      }

      // Optional label under each note (its degree over the chord), below any fingering and low ledger lines.
      if (noteLabels) {
        ctx.save();
        ctx.setFont("JetBrains Mono, monospace", 11, "bold");
        ctx.setFillStyle(chordInk);
        let k = drawn.length;
        bar.notes.forEach((n, ni) => {
          if (n.rest) return;
          const label = noteLabels[k++];
          if (label) ctx.fillText(label, notes[ni].getAbsoluteX() - 3, stave.getYForLine(4) + 54 + fingerRoom + 6);
        });
        ctx.restore();
      }

      bar.notes.forEach((n, ni) => {
        if (n.rest) return;
        const el = notes[ni].getSVGElement();
        if (el) els.push(el);
        drawn.push({ sn: notes[ni], line, bar: i, n, top: top - 4, height: bottom - top + 12 });
      });
    });

    // Ties, slurs and vibrato lines; one that crosses a line break is drawn as two halves.
    const span = (a: (typeof drawn)[number], b: (typeof drawn)[number], make: (from: StaveNote | null, to: StaveNote | null) => { setContext(c: typeof ctx): { draw(): void } }) => {
      const parts = a.line === b.line ? [make(a.sn, b.sn)] : [make(a.sn, null), make(null, b.sn)];
      parts.forEach((p) => p.setContext(ctx).draw());
    };
    const openSlurs = new Map<number, (typeof drawn)[number]>();
    let openVibrato: (typeof drawn)[number] | null = null;
    ctx.openGroup("score-note-links");
    drawn.forEach((d, k) => {
      const next = drawn[k + 1];
      const nextOnLine = next && next.line === d.line ? next.sn : null;
      if (d.n.tieToNext && next)
        span(d, next, (f, t) => new StaveTie({ first_note: f, last_note: t, first_indices: [0], last_indices: [0] }));
      if (d.n.slur?.stop !== undefined) {
        const from = openSlurs.get(d.n.slur.stop);
        if (from) span(from, d, (f, t) => new Curve(f as Note, t as Note, { cps: [{ x: 0, y: 12 }, { x: 0, y: 12 }] }));
        openSlurs.delete(d.n.slur.stop);
      }
      if (d.n.slur?.start !== undefined) openSlurs.set(d.n.slur.start, d);
      if (d.n.vibrato === "both") new VibratoBracket({ start: d.sn, stop: nextOnLine }).setContext(ctx).draw();
      if (d.n.vibrato === "start") openVibrato = d;
      if (d.n.vibrato === "stop" && openVibrato) {
        span(openVibrato, d, (f, t) => new VibratoBracket({ start: f, stop: t }));
        openVibrato = null;
      }
    });
    ctx.closeGroup();

    els.forEach((el, i) => el.setAttribute("data-note", String(i))); // for overlays drawn by the host
    noteEls.current = els;
    noteBars.current = drawn.map((d) => d.bar);
    barEls.current = rects;
    noteSpans.current = drawn.map((d) => ({ top: d.top, height: d.height }));
    cursorEl.current = null;
    playheadEl.current = null;
    if (hasPlayhead) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      g.setAttribute("class", "score-playhead");
      g.setAttribute("width", String(PLAYHEAD_WIDTH));
      g.setAttribute("rx", "1.5");
      svg.insertBefore(g, svg.firstChild);
      playheadEl.current = g;
    }
    if (cursor) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      c.setAttribute("class", "score-cursor");
      c.setAttribute("width", String(CURSOR_WIDTH));
      c.setAttribute("rx", "10");
      svg.insertBefore(c, svg.firstChild);
      cursorEl.current = c;
    }
  }, [exercise, width, barsPerLine, showFingering, noteLabels, cursor, hasPlayhead]);

  // The ghost playhead: read on every frame from the heard music, moved, never redrawn.
  useEffect(() => {
    const el = playheadEl.current;
    if (!el || !playhead) return;
    const heads: (number | null)[] = noteEls.current.map((note) => {
      try {
        const b = note.querySelector<SVGGraphicsElement>(".vf-notehead")?.getBBox?.();
        return b ? b.x + b.width / 2 : null;
      } catch {
        return null;
      }
    });
    const barEnd = (bar: number) => {
      const r = barEls.current.find((x) => x.dataset.bar === String(bar));
      return r ? Number(r.getAttribute("x")) + Number(r.getAttribute("width")) : null;
    };
    let frame = 0;
    let shown = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const at = playhead();
      const k = at === null ? -1 : Math.max(0, Math.min(heads.length - 1, Math.floor(at)));
      const from = k >= 0 ? heads[k] : null;
      const span = noteSpans.current[k];
      if (at === null || from === null || !span) {
        if (shown !== "off") el.classList.remove("is-on");
        shown = "off";
        return;
      }
      const next = noteSpans.current[k + 1]?.top === span.top ? heads[k + 1] : barEnd(noteBars.current[k]);
      const x = from + ((next ?? from) - from) * Math.max(0, Math.min(1, at - k)) - PLAYHEAD_WIDTH / 2;
      const key = `${x.toFixed(1)}:${span.top}`;
      if (key === shown) return;
      if (shown === "off" || shown === "") el.classList.add("is-on");
      shown = key;
      el.setAttribute("height", String(span.height));
      el.style.transform = `translate(${x}px, ${span.top}px)`;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playhead, exercise, width, barsPerLine, showFingering, noteLabels]);

  // Playback cursor + mic results, applied without re-rendering.
  const activeKey = (activeNotes ?? [activeStep]).join(",");
  const focusKey = focusBars?.join(",") ?? "";
  const hideKey = hideBars?.join(",") ?? "";
  useEffect(() => {
    const active = new Set(activeKey.split(",").map(Number));
    const focus = focusKey ? new Set(focusKey.split(",").map(Number)) : null;
    const hide = hideKey ? new Set(hideKey.split(",").map(Number)) : null;
    const firstInBar = new Map<number, number>();
    noteBars.current.forEach((bar, i) => { if (!firstInBar.has(bar)) firstInBar.set(bar, i); });
    noteEls.current.forEach((el, i) => {
      const bar = noteBars.current[i];
      el.classList.toggle("is-active", active.has(i));
      el.classList.toggle("is-reentry", Boolean(reentryCue && i === 0));
      el.classList.toggle("is-hit", results[i] === "hit");
      el.classList.toggle("is-miss", results[i] === "miss");
      el.classList.toggle("is-dim", focus !== null && !focus.has(bar));
      const concealed = noteVisibility === "played" ? !results[i] : noteVisibility === "hidden" || firstInBar.get(bar) !== i;
      el.classList.toggle("is-hidden", hide !== null && hide.has(bar) && concealed);
    });
    hostRef.current?.querySelectorAll(".vf-score-note-links").forEach((el) => el.setAttribute("opacity", hide !== null && noteVisibility !== "played" ? "0" : "1"));
  }, [activeKey, focusKey, hideKey, noteVisibility, results, reentryCue, exercise, width, barsPerLine, showFingering, noteLabels]);

  // The cursor slides to the active note; it is moved, never redrawn.
  useEffect(() => {
    const c = cursorEl.current;
    if (!c) return;
    const span = noteSpans.current[activeStep];
    let x: number | null = null;
    try {
      const head = noteEls.current[activeStep]?.querySelector<SVGGraphicsElement>(".vf-notehead")?.getBBox?.();
      if (head) x = head.x + head.width / 2 - CURSOR_WIDTH / 2;
    } catch {
      // not laid out (tests)
    }
    if (span && x !== null) {
      c.setAttribute("height", String(span.height));
      c.style.transform = `translate(${x}px, ${span.top}px)`;
    }
    c.classList.toggle("is-on", Boolean(span) && x !== null);
  }, [activeStep, exercise, width, barsPerLine, showFingering, noteLabels, cursor]);

  useEffect(() => {
    const c = cursorEl.current;
    if (!c || !cursorPulse) return;
    c.classList.remove("is-calling");
    void c.getBoundingClientRect();
    c.classList.add("is-calling");
  }, [cursorPulse]);

  useEffect(() => {
    barEls.current.forEach((el, i) => {
      el.classList.toggle("is-marked", marked !== null && i >= marked.start && i <= marked.end);
      el.classList.toggle("is-playing", i === playingBar);
    });
  }, [marked, playingBar, exercise, width, barsPerLine, showFingering]);

  // Keep the cursor's line in view.
  useEffect(() => {
    const el = noteEls.current[activeStep];
    if (!autoScroll || !el) return;
    const r = el.getBoundingClientRect();
    const host = hostRef.current?.closest<HTMLElement>("[data-scroll-host]");
    if (host) {
      const h = host.getBoundingClientRect();
      if (r.top < h.top + 20 || r.bottom > h.bottom - 20) host.scrollBy({ top: r.top - h.top - h.height * 0.3, behavior: "smooth" });
      return;
    }
    const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    if (r.top < top + 60 || r.bottom > window.innerHeight - 90)
      window.scrollBy({ top: r.top - top - window.innerHeight * 0.25, behavior: "smooth" });
  }, [activeStep, autoScroll]);

  const onClick = (e: React.MouseEvent) => {
    if (!onBarClick) return;
    const hit = barEls.current.find((r) => {
      const b = r.getBoundingClientRect();
      return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top - 30 && e.clientY <= b.bottom;
    });
    if (hit) onBarClick(Number(hit.dataset.bar), e.shiftKey);
  };

  return (
    <div
      className={`score ${onBarClick ? "is-clickable" : ""}`}
      ref={hostRef}
      aria-label="sight reading score"
      onClick={onClick}
    />
  );
}

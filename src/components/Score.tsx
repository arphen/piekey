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
  barsPerLine?: number; // short excerpts can fill their available width
  playhead?: () => number | null; // where the heard music is, as a printed note index and the way to the next (3.4): a faint line glides there
}

const BARS_PER_LINE_WIDE = 4;
const BARS_PER_LINE_NARROW = 2;
const LINE_HEIGHT = 150;
const MARK_ROOM = 34; // above the staff for endings and rehearsal marks
const FIRST_BAR_EXTRA = 70; // room for clef + key signature
const STRING_MARKS = ["①", "②", "③", "④", "⑤", "⑥"]; // string 0 = high e
const CURSOR_WIDTH = 34;
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
function drawChord(ctx: ReturnType<Renderer["getContext"]>, symbol: string, x: number, y: number, color: string): number {
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

/** Bars per line; a rehearsal mark starts a new line, like a printed lead sheet. */
function layout(bars: ReadingBar[], perLine: number): { line: number; col: number }[] {
  let line = 0;
  let col = 0;
  return bars.map((b, i) => {
    if (i > 0 && (col === perLine || (b.section && col > 0))) {
      line++;
      col = 0;
    }
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
    const ink = css.getPropertyValue("--ink").trim() || "#f3ece2";
    const soft = css.getPropertyValue("--ink-faint").trim() || "#7a7068";
    const chordInk = css.getPropertyValue("--brass").trim() || "#e0a956";

    const perLine = barsPerLine ?? (width < 640 ? BARS_PER_LINE_NARROW : BARS_PER_LINE_WIDE);
    const places = layout(exercise.bars, perLine);
    const lines = (places[places.length - 1]?.line ?? 0) + 1;
    const hasMarks = exercise.bars.some((b) => b.volta || b.section || b.tempo || b.jumps?.length);
    const markRoom = hasMarks ? MARK_ROOM : 0;
    const fingerRoom = showFingering ? 24 : 0;
    const labelRoom = noteLabels ? 20 : 0;
    const lineHeight = LINE_HEIGHT + fingerRoom + labelRoom + markRoom;

    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(width, lines * lineHeight + 10);
    const ctx = renderer.getContext();
    ctx.setFillStyle(ink);
    ctx.setStrokeStyle(ink);
    const svg = host.querySelector("svg")!;

    const els: SVGElement[] = [];
    const rects: SVGRectElement[] = [];
    const drawn: { sn: StaveNote; line: number; bar: number; n: ReadingBar["notes"][number]; top: number; height: number }[] = []; // non-rest notes
    const usable = width - 2;
    const barW = (usable - FIRST_BAR_EXTRA) / perLine;
    let key = exercise.keySignature;
    let time = exercise.timeSignature;
    let chordEnd = -Infinity; // right edge of the last chord symbol on this line

    exercise.bars.forEach((bar, i) => {
      const { line, col } = places[i];
      const first = col === 0;
      const x = first ? 0 : FIRST_BAR_EXTRA + col * barW;
      const w = first ? barW + FIRST_BAR_EXTRA : barW;
      const y = line * lineHeight + 30 + markRoom;
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
      const top = stave.getYForLine(0) - 14;
      const bottom = stave.getYForLine(4) + 14;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(stave.getNoteStartX() - 6));
      rect.setAttribute("y", String(top));
      rect.setAttribute("width", String(Math.max(10, x + w - stave.getNoteStartX() + 4)));
      rect.setAttribute("height", String(bottom - top));
      rect.setAttribute("rx", "6");
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
      new Formatter().joinVoices([voice]).format([voice], Math.max(40, x + w - stave.getNoteStartX() - 16));
      voice.draw(ctx, stave);
      ctx.openGroup("score-note-links");
      beams.forEach((b) => b.setContext(ctx).draw());
      tuplets.forEach((t) => t.setContext(ctx).draw());
      ctx.closeGroup();

      // Chord symbols above the staff, at their beat: over the note starting there, or in
      // proportion between notes (a chord can change under a held note). Never overlapping.
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
          ctx.fillText(`${STRING_MARKS[n.string]}${n.fret}`, nx - 6, stave.getYForLine(4) + 42 + fingerRoom / 2);
        });
        ctx.restore();
      }

      // Optional label under each note (its degree over the chord), below any fingering.
      if (noteLabels) {
        ctx.save();
        ctx.setFont("JetBrains Mono, monospace", 11, "bold");
        ctx.setFillStyle(chordInk);
        let k = drawn.length;
        bar.notes.forEach((n, ni) => {
          if (n.rest) return;
          const label = noteLabels[k++];
          if (label) ctx.fillText(label, notes[ni].getAbsoluteX() - 3, stave.getYForLine(4) + 40 + fingerRoom + 6);
        });
        ctx.restore();
      }

      bar.notes.forEach((n, ni) => {
        if (n.rest) return;
        const el = notes[ni].getSVGElement();
        if (el) els.push(el);
        drawn.push({ sn: notes[ni], line, bar: i, n, top: top - 12, height: bottom - top + 24 });
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
      if (d.n.vibrato === "both") new VibratoBracket({ start: d.sn, stop: nextOnLine }).setContext(ctx).draw(); // over the held note
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
      g.setAttribute("rx", "1");
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

  // The ghost playhead: read on every frame from the heard music, moved, never redrawn. Between two
  // notes on a line it glides from one head to the next; after a line's last note, to its bar's end.
  useEffect(() => {
    const el = playheadEl.current;
    if (!el || !playhead) return;
    const heads: (number | null)[] = noteEls.current.map((note) => {
      try {
        const b = note.querySelector<SVGGraphicsElement>(".vf-notehead")?.getBBox?.();
        return b ? b.x + b.width / 2 : null;
      } catch {
        return null; // not laid out (tests)
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
      el.classList.toggle("is-hit", results[i] === "hit");
      el.classList.toggle("is-miss", results[i] === "miss");
      el.classList.toggle("is-dim", focus !== null && !focus.has(bar));
      const concealed = noteVisibility === "played" ? !results[i] : noteVisibility === "hidden" || firstInBar.get(bar) !== i;
      el.classList.toggle("is-hidden", hide !== null && hide.has(bar) && concealed);
    });
    // Beams, ties and slurs can disclose hidden pitches even without their noteheads.
    hostRef.current?.querySelectorAll(".vf-score-note-links").forEach((el) => el.setAttribute("opacity", hide !== null && noteVisibility !== "played" ? "0" : "1"));
  }, [activeKey, focusKey, hideKey, noteVisibility, results, exercise, width, barsPerLine, showFingering, noteLabels]);

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
    void c.getBoundingClientRect(); // restart the animation
    c.classList.add("is-calling");
  }, [cursorPulse]);

  useEffect(() => {
    barEls.current.forEach((el, i) => {
      el.classList.toggle("is-marked", marked !== null && i >= marked.start && i <= marked.end);
      el.classList.toggle("is-playing", i === playingBar);
    });
  }, [marked, playingBar, exercise, width, barsPerLine, showFingering]);

  // Keep the cursor's line in view: scroll once it nears the bottom, or after a jump back up.
  // Inside a scrolling panel (marked data-scroll-host) the panel scrolls instead of the page.
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

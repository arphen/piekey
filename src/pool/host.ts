import photoUrl from "../assets/water-texture.webp";
import leafUrl from "../assets/leaf-texture.webp";
import type { InputFrame } from "../listen/useInput";
import { midiOf, pitchOf } from "../listen/pitch";
import type { PoolBus, PoolAnchor } from "./bus";
import { markLivingDegraded } from "./mode";
import { readPower } from "./power";
import { createGroove } from "./groove";
import { goldenSpread, GOLDEN_ANGLE, phyllotaxis, spiral, wander } from "./golden";
import { poolParams, tintFor } from "./params";
import { CALM, GLASS, Renderer, ROCK, TIERS, type Flash, type FrameState, type PoolRect, type Ring, type Stone, type Swirl, type Vec3, type Vortex } from "./engine/renderer";

// Owns the renderer's life: when it draws, how often, at what quality, and what it hears. The
// pool is decoration: nothing here is read by scoring, tempo, scheduling, evidence or goals.

const TIER_KEY = "guitar-pool-tier"; // device-local, outside sync and backup
const HIDDEN_RELEASE_MS = 30000;
const RETIRE_RELEASE_MS = 10000;
const PHRASE_GAP_MS = 2000;
const FLAGS: Record<string, number> = { rock: ROCK, calm: CALM, glass: GLASS };

interface Anchor { x: number; y: number; r: number }
interface Tune { cents: number | null; frequency: number | null; at: number }

function storedTier(): number {
  try {
    const n = Number(localStorage.getItem(TIER_KEY));
    return Number.isInteger(n) && n >= 0 && n < TIERS.length && localStorage.getItem(TIER_KEY) !== null ? n : 2;
  } catch { return 2; }
}

function saveTier(tier: number) {
  try { localStorage.setItem(TIER_KEY, String(tier)); } catch { /* a preference only */ }
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob);
}

export function createHost(bus: PoolBus, options: { animate: boolean }): PoolHost {
  return new PoolHost(bus, options.animate);
}

export class PoolHost {
  private canvas = document.createElement("canvas");
  private renderer: Renderer | null = null;
  private images: [ImageBitmap, ImageBitmap] | null = null;
  private ready = false;
  private disposed = false;
  private retired = false;
  private losses = 0;
  private frame = 0;
  private last = 0;
  private time = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private adopted: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private resize: ResizeObserver | null = null;
  private mutations: MutationObserver | null = null;
  private anchorsDue = true;
  private anchorsAt = 0;
  private rects: PoolRect[] = [];
  private anchors = new Map<PoolAnchor, Anchor>();
  private changedSize = true;
  private readonly groove = createGroove();
  private override: number | null = null;
  private phrase = { n: 0, at: -Infinity, centre: { x: 0.9, y: 0.5 }, count: 0 };
  private stones: Stone[] = [];
  private swirls: Swirl[] = [];
  private rings: Ring[] = [];
  private flashes: (Flash & { age: number; strength: number })[] = [];
  private push: [number, number] = [0, 0];
  private beatSerial = -1;
  private beatAt: number | undefined;
  private beatKick = 0; // a heard beat lurches the whole pool, decaying within a fraction of a beat
  private beatSway = 0; // which way the eddies were last thrown: they swing back on the next beat
  private beatDance = 0; // a beat waiting to throw the eddies, at its strength
  private tune: Tune = { cents: null, frequency: null, at: -Infinity };
  private tunerPhase = 0;
  private tunerAmount = 0;
  private calm = 0;
  private glassy = 0;
  private turn = 0;
  private drift: [number, number] = [0, 0];
  private driftVelocity: [number, number] = [0, 0];
  private lastEvent = -Infinity;
  private cssAt = 0;
  private css = { glow: -1, tint: "" };
  private tier = storedTier();
  private samples: number[] = [];
  private gpu: number[] = [];
  private cpu: number[] = [];
  private windowAt = 0;
  private steadySince = 0;
  private downAt = -Infinity;
  private slowWindows = 0;

  constructor(private readonly bus: PoolBus, private animate: boolean) {
    this.canvas.className = "pa-pool";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.addEventListener("webglcontextlost", this.lost);
    this.canvas.addEventListener("webglcontextrestored", this.restored);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { this.changedSize = true; this.anchorsDue = true; this.wake(); });
    this.resize?.observe(this.canvas);
    window.addEventListener("resize", this.layout);
    window.addEventListener("scroll", this.layout, true);
    bus.sink = { frame: (f) => this.hear(f), publishers: () => this.adopt() };
    // Development only, removed from production builds: drive the visuals without a guitar.
    if (import.meta.env.DEV) {
      (window as unknown as { __pool: unknown }).__pool = {
        setGroove: (g: number | null) => { this.override = g; this.wake(); },
        note: (midi = 64, velocity = 0.8) => { this.note(midi, velocity, performance.now()); this.wake(); },
        beat: (downbeat = false) => {
          const dial = this.anchors.get("metronome") ?? { x: this.aspect() / 2, y: 0.5, r: 0.15 };
          this.stones.push({ x: dial.x, y: dial.y, radius: 0.014, amp: downbeat ? 0.8 : 0.45, tint: downbeat ? [0.95, 0.78, 0.45] : [0.7, 0.82, 0.62], ring: dial.r * 0.92 });
          this.flash(dial, downbeat ? 1 : 0.55);
          this.swirls.push({ x: dial.x, y: dial.y, impulse: (this.time % 2 < 1 ? 1 : -1) * 0.025, radius: dial.r * 1.6 });
          this.lastEvent = performance.now();
          this.wake();
        },
        tune: (cents: number | null, frequency = 110) => { this.tune = { cents, frequency: cents === null ? null : frequency, at: performance.now() }; this.wake(); },
        bloom: () => { this.bus.emit({ kind: "bloom", strength: 1 }); this.wake(); },
        stats: () => ({ tier: this.tier, ready: this.ready, gpuMs: this.renderer?.gpuMs ?? null, groove: this.level(), size: [this.canvas.width, this.canvas.height], rects: this.rects.length, anchors: [...this.anchors.keys()] }),
      };
    }
    this.adopt();
    void this.init();
  }

  // ---------- life ----------

  private async init(): Promise<void> {
    try {
      this.images ??= await Promise.all([loadImage(photoUrl), loadImage(leafUrl)]);
      if (this.disposed) return;
      const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
      if (!gl) throw new Error("webgl2");
      const half = gl.getExtension("EXT_color_buffer_half_float");
      const floats = gl.getExtension("EXT_color_buffer_float") !== null;
      if (!half && !floats) throw new Error("no renderable half floats");
      const renderer = new Renderer(gl, floats);
      renderer.setImages(this.images[0], this.images[1]);
      this.renderer = renderer;
      this.sizeCanvas();
      renderer.setTier(this.tier);
      this.ready = true;
      this.drawStill();
      this.mark();
      this.wake();
    } catch {
      // Living needs WebGL2 with float targets: rest as Water for this visit.
      this.ready = false;
      this.renderer?.dispose();
      this.renderer = null;
      if (!this.disposed) markLivingDegraded();
    }
  }

  private release(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.ready = false;
    this.renderer?.dispose();
    this.renderer = null;
    // A deliberate loss is not a GPU failure; drawing again starts on a fresh canvas.
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.restored);
    this.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    this.mark();
  }

  retire(): void {
    if (this.disposed) return;
    this.retired = true;
    this.mark(); // crossfade back to the room underneath
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.clearTimer();
    this.releaseTimer = setTimeout(() => this.release(), RETIRE_RELEASE_MS);
  }

  revive(): void {
    if (this.disposed) return;
    this.retired = false;
    this.clearTimer();
    if (!this.renderer) void this.reinit();
    else { this.mark(); this.wake(); }
  }

  private async reinit(): Promise<void> {
    // A context lost on purpose needs a fresh canvas before it can draw again.
    const fresh = document.createElement("canvas");
    fresh.className = this.canvas.className;
    fresh.setAttribute("aria-hidden", "true");
    this.canvas.replaceWith(fresh);
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.restored);
    this.resize?.unobserve(this.canvas);
    this.canvas = fresh;
    fresh.addEventListener("webglcontextlost", this.lost);
    fresh.addEventListener("webglcontextrestored", this.restored);
    this.resize?.observe(fresh);
    this.changedSize = true;
    this.adopt();
    await this.init();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.release();
    this.bus.sink = null;
    this.clearCss();
    this.adopted?.removeAttribute("data-pool");
    this.canvas.remove();
    this.resize?.disconnect();
    this.mutations?.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("resize", this.layout);
    window.removeEventListener("scroll", this.layout, true);
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.restored);
    this.images?.forEach((bitmap) => bitmap.close());
    if (import.meta.env.DEV) delete (window as { __pool?: unknown }).__pool;
  }

  setAnimate(animate: boolean): void {
    this.animate = animate;
    this.drawStill();
    this.wake();
  }

  private clearTimer() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }

  private readonly visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.clearTimer();
      if (!this.retired) this.releaseTimer = setTimeout(() => this.release(), HIDDEN_RELEASE_MS);
    } else if (!this.retired) {
      this.clearTimer();
      if (!this.renderer && !this.disposed) void this.reinit();
      else this.wake();
    }
  };

  private readonly lost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.ready = false;
    this.renderer = null; // its objects died with the context
    this.mark();
    if (++this.losses >= 2) markLivingDegraded();
  };

  private readonly restored = () => {
    if (this.losses >= 2 || this.disposed) return;
    void this.init();
  };

  // ---------- where the canvas lives ----------

  private adopt(): void {
    if (this.disposed) return;
    const top = this.bus.top();
    const host = top?.host ?? null;
    if (host !== this.adopted) {
      this.adopted?.removeAttribute("data-pool");
      this.clearCss();
      this.adopted = host;
      this.root = host?.parentElement ?? null;
      const slot = host?.querySelector<HTMLElement>(".pa-pool-slot");
      if (slot) slot.appendChild(this.canvas);
      else this.canvas.remove();
      this.watch();
      this.changedSize = true;
      this.beatSerial = top?.props.beat?.serial ?? -1;
    }
    this.mark();
    this.wake();
  }

  /** The atmosphere hides its photographic layers once the pool really draws. */
  private mark(): void {
    const show = this.ready && !this.retired && this.canvas.isConnected;
    if (show) this.adopted?.setAttribute("data-pool", "ready");
    else this.adopted?.removeAttribute("data-pool");
  }

  private watch(): void {
    this.mutations?.disconnect();
    this.anchorsDue = true;
    if (!this.root || typeof MutationObserver === "undefined") return;
    this.mutations = new MutationObserver(() => { this.anchorsDue = true; });
    this.mutations.observe(this.root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-pool", "hidden"] });
  }

  private readonly layout = () => { this.anchorsDue = true; };

  private sizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // At most 0.75 × device pixels and 1,600 pixels on the long edge.
    const scale = Math.min(0.75 * (window.devicePixelRatio || 1), 1600 / Math.max(rect.width, rect.height));
    this.canvas.width = Math.max(1, Math.round(rect.width * scale));
    this.canvas.height = Math.max(1, Math.round(rect.height * scale));
    this.renderer?.resize(this.canvas.width, this.canvas.height);
    this.changedSize = false;
  }

  /** Rocks, calm lenses and glass from [data-pool] elements of the room, at most 4 times a second. */
  private collect(now: number): void {
    if (!this.root || (!this.anchorsDue && now - this.anchorsAt < 1000) || now - this.anchorsAt < 250) return;
    this.anchorsDue = false;
    this.anchorsAt = now;
    const c = this.canvas.getBoundingClientRect();
    if (!c.height) return;
    const found: (PoolRect & { area: number })[] = [];
    this.anchors.clear();
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-pool], [data-pool-anchor]")) {
      if (el.closest("[hidden]") || (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true }))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const x = ((r.left + r.right) / 2 - c.left) / c.height;
      const y = (c.bottom - (r.top + r.bottom) / 2) / c.height;
      const hx = r.width / 2 / c.height;
      const hy = r.height / 2 / c.height;
      const anchor = el.dataset.poolAnchor as PoolAnchor | undefined;
      if (anchor) this.anchors.set(anchor, { x, y, r: Math.min(hx, hy) });
      const flags = (el.dataset.pool ?? "").split(/\s+/).reduce((sum, token) => sum | (FLAGS[token] ?? 0), 0);
      if (!flags) continue;
      const radius = Math.min(hx, hy, (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) / c.height);
      found.push({ x, y, hx, hy, radius: flags & GLASS ? Math.min(hx, hy) : radius, flags, area: hx * hy });
    }
    this.rects = found.sort((a, b) => b.area - a.area).slice(0, 16);
  }

  // ---------- what the pool hears ----------

  private hear(frame: InputFrame): void {
    const top = this.bus.top();
    const props = top?.props;
    const playing = Boolean(props?.playing);
    const beat = props?.beat;
    if (beat?.active && beat.serial !== this.beatSerial) this.beatAt = frame.now;
    // Pitch is read from the shared per-frame cache, and only during the player's turn.
    let midi: number | null = null;
    let clarity = 0;
    if (playing && frame.rms > 0.004) {
      clarity = pitchOf(frame).clarity;
      midi = midiOf(frame);
    }
    const bpm = props?.bpm;
    const onset = this.groove.step(
      { now: frame.now, rms: frame.rms, midi, clarity, playing },
      { ...(beat?.active && bpm && this.beatAt !== undefined ? { beatAt: this.beatAt, beatMs: 60000 / bpm } : {}), ...(props && props.flow > 0 ? { flow: props.flow } : {}) },
    );
    if (onset) this.note(onset.midi, onset.velocity, frame.now);
    if (playing || this.groove.state.groove > 0.01) this.wake();
  }

  private aspect(): number {
    return this.canvas.width && this.canvas.height ? this.canvas.width / this.canvas.height : 16 / 10;
  }

  private inLens(x: number, y: number): boolean {
    return this.rects.some((r) => r.flags & (CALM | ROCK) && Math.abs(x - r.x) < r.hx + 0.02 && Math.abs(y - r.y) < r.hy + 0.02);
  }

  /** A note drops a stone on the n-th seed of the phrase's sunflower. */
  private note(midi: number, velocity: number, now: number): void {
    const aspect = this.aspect();
    const p = this.phrase;
    if (now - p.at > PHRASE_GAP_MS) {
      p.n = 0;
      for (let k = 0; k < 8; k++) {
        p.count++;
        const centre = { x: aspect * (0.12 + 0.76 * goldenSpread(p.count)), y: 0.2 + 0.6 * goldenSpread(p.count * 2 + 1) };
        p.centre = centre;
        if (!this.inLens(centre.x, centre.y)) break;
      }
    }
    p.at = now;
    let point = { x: p.centre.x, y: p.centre.y };
    for (let tries = 0; tries < 5; tries++) {
      const seed = phyllotaxis(p.n++, 0.3, this.time * 0.05);
      point = { x: p.centre.x + seed.x, y: p.centre.y + seed.y };
      if (!this.inLens(point.x, point.y)) break;
    }
    const g = this.level();
    const state = this.groove.state;
    this.stones.push({
      x: point.x, y: point.y,
      radius: Math.max(0.008, 0.035 * Math.pow(2, -(midi - 40) / 24)),
      amp: velocity * (0.6 + 0.4 * g) * (0.7 + 0.3 * state.energy),
      tint: tintFor(state.tonic, state.mode),
    });
    this.lastEvent = now;
  }

  private level(): number { return this.override ?? this.groove.state.groove; }

  private flash(at: Anchor, strength: number): void {
    this.flashes.push({ x: at.x, y: at.y, radius: at.r * 0.92, amount: strength * 0.35, age: 0, strength });
    if (this.flashes.length > 2) this.flashes.shift();
  }

  private events(now: number): void {
    const aspect = this.aspect();
    for (const event of this.bus.drain()) {
      if (event.kind === "tune") this.tune = { cents: event.cents, frequency: event.frequency, at: now };
      else if (event.kind === "bloom") {
        const at = this.anchors.get(event.at ?? "focus") ?? this.anchors.get("cursor") ?? { x: aspect / 2, y: 0.5, r: 0 };
        this.rings.push({ x: at.x, y: at.y, age: 0, strength: event.strength });
        if (this.rings.length > 4) this.rings.shift();
        this.lastEvent = now;
      } else if (event.kind === "sweep") {
        this.push = [event.direction * 0.07, 0.012];
        this.lastEvent = now;
      }
    }
    // A heard beat, never a timer: a stone at the dial, and the pool sloshes with the pendulum.
    const beat = this.bus.top()?.props.beat;
    if (beat?.active && beat.index >= 0 && beat.serial !== this.beatSerial) {
      this.beatSerial = beat.serial;
      const dial = this.anchors.get("metronome");
      const amp = beat.counting ? 0.35 : beat.index === 0 ? 1 : 0.55;
      const tint: Vec3 = beat.counting ? [0.45, 0.7, 0.75] : beat.index === 0 ? [0.95, 0.78, 0.45] : [0.7, 0.82, 0.62];
      if (dial) {
        // the ring is already at the rim on the beat's own frame, and the rim lights at once
        this.stones.push({ x: dial.x, y: dial.y, radius: 0.014, amp: amp * 0.5, tint, ring: dial.r * 0.92 });
        this.flash(dial, amp);
        this.swirls.push({ x: dial.x, y: dial.y, impulse: (beat.serial % 2 ? 1 : -1) * 0.025 * amp, radius: dial.r * 1.6 });
      } else this.stones.push({ x: aspect / 2, y: 0.02, radius: 0.06, amp: amp * 0.35, tint });
      // and the whole pool dances to it, more as the playing earns it
      if (!beat.counting) {
        this.beatKick = Math.max(this.beatKick, amp);
        this.beatDance = amp;
        this.beatSway = beat.serial % 2 ? 1 : -1;
      }
      this.lastEvent = now;
    } else if (!beat?.active) this.beatSerial = beat?.serial ?? -1;
  }

  // ---------- drawing ----------

  private wake(): void {
    if (this.disposed || this.retired || !this.ready || this.frame || document.hidden || !this.adopted) return;
    if (!this.animate) { this.drawStill(); return; }
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private fps(now: number): number {
    const playing = Boolean(this.bus.top()?.props.playing);
    const quiet = !playing && this.level() < 0.02 && now - this.lastEvent > 4000 && this.calm < 0.05;
    return quiet ? 20 : TIERS[this.tier].fps; // idle and visible: a slow pond
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    if (this.disposed || this.retired || !this.ready || document.hidden || !this.adopted || !this.renderer) return;
    this.frame = requestAnimationFrame(this.tick);
    const interval = 1000 / this.fps(now);
    if (this.last && now - this.last < interval - 3) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    const interval0 = this.last ? now - this.last : 0;
    this.last = now;
    const began = performance.now();
    if (this.changedSize) this.sizeCanvas();
    this.collect(now);
    this.events(now);
    const state = this.frameState(dt, now);
    this.renderer.step(state);
    this.renderer.render(state);
    if (interval0) this.sample(interval0, performance.now() - began);
    this.stones = [];
    this.swirls = [];
    this.push = [0, 0];
    this.styleRoom(now, state);
  };

  /** Reduced motion and the first frame: one still composite, redrawn only on resize or mode change. */
  private drawStill(): void {
    if (!this.ready || !this.renderer || this.animate || !this.adopted) return;
    this.sizeCanvas();
    this.collect(performance.now() + 1000);
    this.renderer.render(this.frameState(0, performance.now()));
  }

  private frameState(dt: number, now: number): FrameState {
    const aspect = this.aspect();
    const g = this.level();
    const params = poolParams(g);
    const state = this.groove.state;
    const tint = tintFor(state.tonic, state.mode);
    this.time += dt;
    const t = this.time;
    const calmTarget = this.bus.calmed ? 1 : 0;
    this.calm += (calmTarget - this.calm) * (1 - Math.exp(-dt / 0.7));

    // the tuner: two ring sets whose moiré runs at the string's real beat frequency
    const tuner = this.anchors.get("tuner");
    const reading = now - this.tune.at < 1500 && this.tune.cents !== null && this.tune.frequency !== null;
    this.tunerAmount += ((reading && tuner ? 1 : 0) - this.tunerAmount) * (1 - Math.exp(-dt / 0.4));
    const cents = this.tune.cents ?? 0;
    const inTune = reading && Math.abs(cents) <= 3;
    if (reading && !inTune) this.tunerPhase += 2 * Math.PI * (this.tune.frequency ?? 0) * (Math.pow(2, cents / 1200) - 1) * dt;
    else this.tunerPhase *= Math.exp(-dt / 0.5);
    this.glassy += ((inTune ? 1 : 0) - this.glassy) * (1 - Math.exp(-dt / 0.8));
    const still = Math.max(this.calm, this.glassy * 0.8);

    // ambient vortices on a slowly turning golden spiral; onsets spin them up, heard beats throw them
    this.beatKick *= Math.exp(-dt / 0.22);
    const kick = Math.min(1.8, state.kick + this.beatKick * (0.25 + 0.75 * g) * (1 - this.calm));
    this.turn += params.orbit * (1 + kick) * dt;
    const count = params.vortices * (1 - still);
    const vortices: Vortex[] = [];
    for (let i = 0; i < Math.ceil(count) && i < 8; i++) {
      const weight = Math.min(1, count - i);
      const s = spiral(i, 0.07, this.turn + i * GOLDEN_ANGLE * 0.1);
      let x = aspect / 2 + s.x + 0.03 * wander(t, 23, i);
      let y = 0.5 + s.y + 0.03 * wander(t, 23 * 1.3, i + 2);
      for (const r of this.rects) {
        if (!(r.flags & ROCK)) continue;
        const dx = x - r.x;
        const dy = y - r.y;
        const ox = r.hx + 0.04 - Math.abs(dx);
        const oy = r.hy + 0.04 - Math.abs(dy);
        if (ox > 0 && oy > 0) { if (ox < oy) x += Math.sign(dx || 1) * ox; else y += Math.sign(dy || 1) * oy; }
      }
      vortices.push({ x, y, spin: (i % 2 ? -1 : 1) * weight * (0.35 + 0.45 * g) * (1 + kick * 0.8), radius: 0.11 + 0.025 * i });
    }
    // a beat throws the eddies one way, the next swings them back: the algae sway on the pulse
    if (this.beatDance > 0) {
      const strength = this.beatDance * (0.2 + 0.8 * g) * (1 - still);
      vortices.slice(0, 3).forEach((v, i) => this.swirls.push({ x: v.x, y: v.y, impulse: this.beatSway * (i % 2 ? -1 : 1) * 0.03 * strength, radius: v.radius * 1.4 }));
      this.beatDance = 0;
    }

    // the constellation drifts, wandering on golden-ratio periods
    const heading = -0.35 + 0.9 * wander(t, 23);
    const speed = (params.drift * aspect) / 60;
    this.driftVelocity = [Math.cos(heading) * speed, Math.sin(heading) * speed * 0.6];
    this.drift = [this.drift[0] + this.driftVelocity[0] * dt, this.drift[1] + this.driftVelocity[1] * dt];

    const heat = Math.max(0, g - 0.35) * (0.4 + state.energy) * params.lava;
    const emitters = heat > 0.001 ? Array.from({ length: 5 }, (_, k) => ({ x: aspect * goldenSpread(k + 1), y: 0.015, rate: heat * 1.6 * (0.6 + 0.4 * wander(t, 23 * (k + 1) * 0.37, k)), radius: 0.045 })) : [];
    this.rings = this.rings.map((r) => ({ ...r, age: r.age + dt })).filter((r) => r.age < 6);
    // a beat's light is brightest on its own frame and gone within a fraction of a beat
    const flashes = this.flashes.map((f) => ({ ...f, amount: f.strength * 0.35 * Math.exp(-f.age / 0.09) }));
    this.flashes = this.flashes.map((f) => ({ ...f, age: f.age + dt })).filter((f) => f.age < 0.5);

    return {
      dt, params, velocityHalfLife: params.velocityHalfLife * (1 - 0.7 * still), kick: kick * 0.6, tint,
      dawn: 0.1 + 0.5 * g, drift: [this.drift[0] - aspect * 0.62, this.drift[1] - 0.5], driftVelocity: this.driftVelocity,
      vortices, stones: this.stones, swirls: this.swirls, push: this.push, emitters, buoyancy: 0.03, rings: this.rings, flashes, rects: this.rects,
      tuner: tuner && this.tunerAmount > 0.01 ? { x: tuner.x, y: tuner.y, radius: Math.max(0.12, tuner.r * 4), amount: this.tunerAmount, phase: this.tunerPhase, ratio: inTune ? 1 : 1 + 0.004 * cents } : null,
    };
  }

  /** --pool-glow and --pool-tint on the room: colour and opacity only, at most 8 Hz. */
  private styleRoom(now: number, state: FrameState): void {
    if (!this.root || now - this.cssAt < 125) return;
    this.cssAt = now;
    const glow = Math.min(1, state.params.emission); // slow: a per-note value would restyle the room constantly
    const tint = state.tint.map((v) => Math.round(v * 255)).join(", ");
    if (Math.abs(glow - this.css.glow) > 0.02) { this.root.style.setProperty("--pool-glow", glow.toFixed(2)); this.css.glow = glow; }
    if (tint !== this.css.tint) { this.root.style.setProperty("--pool-tint", tint); this.css.tint = tint; }
  }

  private clearCss(): void {
    this.root?.style.removeProperty("--pool-glow");
    this.root?.style.removeProperty("--pool-tint");
    this.css = { glow: -1, tint: "" };
  }

  // ---------- governor ----------

  /** Frame interval, the pool's own JS time, and GPU time when a timer query exists. */
  private sample(interval: number, work: number): void {
    this.samples.push(interval);
    this.cpu.push(work);
    const gpu = this.renderer?.gpuMs;
    if (gpu != null) this.gpu.push(gpu);
    const now = performance.now();
    if (!this.windowAt) this.windowAt = now;
    if (now - this.windowAt < 3000) return;
    const p90 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.9)] ?? 0;
    const frame = p90(this.samples);
    const gpuMs = this.gpu.length ? p90(this.gpu) : null;
    const cpuMs = p90(this.cpu);
    const target = 1000 / TIERS[this.tier].fps;
    this.samples = [];
    this.gpu = [];
    this.cpu = [];
    this.windowAt = now;
    if (this.fps(now) < TIERS[this.tier].fps) return; // resting at idle fps says nothing
    // With a GPU timer, judge the pool's own cost: a page busy elsewhere must not lower the tier.
    const slow = gpuMs !== null ? gpuMs > target * 0.6 || cpuMs > target * 0.35 : frame > Math.max(18, target * 1.5);
    if (slow) {
      this.steadySince = now;
      if (this.tier > 0) { this.setTier(this.tier - 1); this.downAt = now; this.slowWindows = 0; }
      else if (frame > 40 && ++this.slowWindows >= 2) {
        // even the lowest tier cannot keep up: rest as Water for this visit
        this.adopted?.setAttribute("data-renderer", "degraded");
        markLivingDegraded();
      }
      return;
    }
    this.slowWindows = 0;
    const maxTier = readPower() === "plugged" ? 3 : 2;
    const roomy = gpuMs === null ? frame < target * 1.05 : gpuMs < target * 0.3 && cpuMs < target * 0.15;
    if (!roomy) this.steadySince = now;
    else if (now - this.steadySince > 10000 && now - this.downAt > 60000 && this.tier < maxTier) { this.setTier(this.tier + 1); this.steadySince = now; }
  }

  private setTier(tier: number): void {
    this.tier = tier;
    this.renderer?.setTier(tier);
    saveTier(tier);
  }
}

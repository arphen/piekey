import { complete, compile, formats, image, pair, release, releasePair, target, type Format, type Pair, type Program, type Target } from "./gl";
import * as S from "./shaders";
import type { PoolParams } from "../params";
import { mulberry32 } from "../golden";

// The living pool's GPU side. It never touches window or document, so it can move into a worker
// with an OffscreenCanvas if profiling ever asks for it. No readPixels and no getError per frame.

export interface Tier { sim: number; jacobi: number; marble: number; waves: number; bloom: number; floaters: number; fps: number }
export const TIERS: readonly Tier[] = [
  { sim: 96, jacobi: 8, marble: 384, waves: 192, bloom: 0, floaters: 0, fps: 30 },
  { sim: 128, jacobi: 12, marble: 512, waves: 256, bloom: 0.5, floaters: 21, fps: 30 },
  { sim: 192, jacobi: 18, marble: 768, waves: 384, bloom: 1, floaters: 34, fps: 60 },
  { sim: 256, jacobi: 24, marble: 1024, waves: 512, bloom: 1, floaters: 34, fps: 60 },
];

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export interface Stone { x: number; y: number; radius: number; amp: number; tint: Vec3; ring?: number }
export interface Flash { x: number; y: number; radius: number; amount: number }
export interface Vortex { x: number; y: number; spin: number; radius: number }
export interface Swirl { x: number; y: number; impulse: number; radius: number }
export interface Emitter { x: number; y: number; rate: number; radius: number }
export interface Ring { x: number; y: number; age: number; strength: number }
export interface PoolRect { x: number; y: number; hx: number; hy: number; radius: number; flags: number }
export const ROCK = 1;
export const CALM = 2;
export const GLASS = 4;

/** Everything one frame needs, in height units (y up from the bottom edge, x across to the aspect). */
export interface FrameState {
  dt: number;
  params: PoolParams;
  velocityHalfLife: number;
  kick: number;
  tint: Vec3;
  dawn: number;
  drift: Vec2;
  driftVelocity: Vec2;
  vortices: readonly Vortex[];
  stones: readonly Stone[];
  swirls: readonly Swirl[];
  push: Vec2;
  emitters: readonly Emitter[];
  buoyancy: number;
  rings: readonly Ring[];
  flashes: readonly Flash[];
  rects: readonly PoolRect[];
  tuner: { x: number; y: number; radius: number; amount: number; phase: number; ratio: number } | null;
  morph: { amount: number; seed: Vec2 } | null; // the pond turning into the next photograph, 0–1
}

// Yellow and orange leaves in water-texture.webp (image space, y down), found once by analysis.
const SPRITES = [
  [0.515, 0.3463, 0.5983, 0.3987], [0.5317, 0.6687, 0.605, 0.7188], [0.615, 0.6863, 0.705, 0.7238],
  [0.3117, 0.9012, 0.365, 0.9587], [0.245, 0.5387, 0.3017, 0.5988], [0.4883, 0.8013, 0.5383, 0.8438],
];
export const PHOTO_SCALE = 1.7; // one photograph height in screen heights
const PARTICLES = 34;
const LN2 = Math.LN2;

type Programs = Record<"curl" | "forces" | "divergence" | "pressure" | "gradient" | "advect" | "heat" | "marble" | "waves" | "dye" | "particles" | "floaters" | "bright" | "blur" | "composite" | "copy", Program>;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly f: ReturnType<typeof formats>;
  private readonly p: Programs;
  private readonly vao: WebGLVertexArrayObject;
  private photo: WebGLTexture | null = null; // the pond as it is now
  private pond: WebGLTexture | null = null; // the photograph it is becoming
  private origin: WebGLTexture | null = null; // the first photograph: its leaves float as sprites
  private leaf: WebGLTexture | null = null;
  private black: WebGLTexture;
  private tier: Tier = TIERS[2];
  private width = 1;
  private height = 1;
  private aspect = 1;
  private velocity: Pair | null = null;
  private pressure: Pair | null = null;
  private heat: Pair | null = null;
  private marble: Pair | null = null;
  private waves: Pair | null = null;
  private dye: Pair | null = null;
  private particles: Pair | null = null;
  private curl: Target | null = null;
  private divergence: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;
  private floaterLayer: Target | null = null;
  private heatIdle = 0;
  private flowPhase = 0.25; // both flow fields start part-way, so neither restarts at once
  private flowMix = 0.5;
  private readonly arrays = { rects: new Float32Array(64), meta: new Float32Array(64), a8: new Float32Array(32), b8: new Float32Array(32), c4: new Float32Array(16), t8: new Float32Array(24), r8: new Float32Array(8), f2: new Float32Array(8), sprites: new Float32Array(SPRITES.flat()) };
  private readonly timer: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null; free: WebGLQuery[]; busy: WebGLQuery[]; ms: number | null };

  constructor(gl: WebGL2RenderingContext, readonly floats: boolean) {
    this.gl = gl;
    this.f = formats(gl, floats);
    const make = (fragment: string, vertex = S.VERTEX) => compile(gl, vertex, fragment);
    this.p = {
      curl: make(S.CURL), forces: make(S.FORCES), divergence: make(S.DIVERGENCE), pressure: make(S.PRESSURE),
      gradient: make(S.GRADIENT), advect: make(S.ADVECT), heat: make(S.HEAT), marble: make(S.MARBLE), waves: make(S.WAVES),
      dye: make(S.DYE), particles: make(S.PARTICLES), floaters: make(S.FLOATER_FRAGMENT, S.FLOATER_VERTEX),
      bright: make(S.BRIGHT), blur: make(S.BLUR), composite: make(S.COMPOSITE), copy: make(S.COPY),
    };
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("vao");
    this.vao = vao;
    gl.bindVertexArray(vao);
    const black = gl.createTexture();
    if (!black) throw new Error("texture");
    gl.bindTexture(gl.TEXTURE_2D, black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.black = black;
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    this.timer = { ext, free: [], busy: [], ms: null };
  }

  /** Last GPU frame time from a non-blocking timer query, when the browser offers one. */
  get gpuMs(): number | null { return this.timer.ms; }

  setImages(photo: TexImageSource, leaf: TexImageSource): void {
    this.origin = image(this.gl, photo);
    this.photo = this.origin;
    this.leaf = image(this.gl, leaf);
  }

  /** The next photograph the pond turns into; `morph` in the frame state says how far. */
  setPond(next: TexImageSource): void {
    if (this.pond && this.pond !== this.photo && this.pond !== this.origin) this.gl.deleteTexture(this.pond);
    this.pond = image(this.gl, next);
  }

  /** The turn is complete: the photograph it became is now the pond. */
  settlePond(): void {
    if (!this.pond) return;
    if (this.photo && this.photo !== this.origin) this.gl.deleteTexture(this.photo);
    this.photo = this.pond;
    this.pond = null;
  }

  setTier(index: number): void {
    this.tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, index))];
    this.allocate();
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.velocity) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.aspect = this.width / this.height;
    this.allocate();
  }

  private dims(long: number): [number, number] {
    return this.aspect >= 1 ? [long, Math.max(8, Math.round(long / this.aspect))] : [Math.max(8, Math.round(long * this.aspect)), long];
  }

  /** (Re)builds fields at the tier's resolution, resampling what the pool already holds. */
  private allocate(): void {
    const gl = this.gl;
    const { r, rg, rgba, rgba8, rgba32 } = this.f;
    const [sw, sh] = this.dims(this.tier.sim);
    const [mw, mh] = this.dims(this.tier.marble);
    const [ww, wh] = this.dims(this.tier.waves);
    const carry = (old: Pair | null, w: number, h: number, format: Format) => {
      if (old && old.read.width === w && old.read.height === h) return old;
      const next = pair(gl, w, h, format);
      if (old) { this.run(this.p.copy, next.read, (u) => this.bind(u, "uSource", old.read.texture, 0)); releasePair(gl, old); }
      return next;
    };
    this.velocity = carry(this.velocity, sw, sh, rg);
    this.pressure = carry(this.pressure, sw, sh, r);
    this.heat = carry(this.heat, sw, sh, r);
    this.marble = carry(this.marble, mw, mh, rgba);
    this.waves = carry(this.waves, ww, wh, rg);
    this.dye = carry(this.dye, Math.max(8, mw >> 1), Math.max(8, mh >> 1), rgba);
    release(gl, this.curl); release(gl, this.divergence);
    this.curl = target(gl, sw, sh, r);
    this.divergence = target(gl, sw, sh, r);
    const scale = this.tier.bloom >= 1 ? 4 : 8;
    release(gl, this.bloomA); release(gl, this.bloomB); release(gl, this.floaterLayer);
    this.bloomA = target(gl, Math.max(8, Math.round(this.width / scale)), Math.max(8, Math.round(this.height / scale)), rgba);
    this.bloomB = target(gl, this.bloomA.width, this.bloomA.height, rgba);
    this.floaterLayer = target(gl, Math.max(8, this.width >> 1), Math.max(8, this.height >> 1), rgba8);
    if (rgba32 && !this.particles) {
      const random = mulberry32(34);
      const seed = new Float32Array(PARTICLES * 4);
      for (let i = 0; i < PARTICLES; i++) seed.set([random() * this.aspect, random(), random() * 6.283, 0], i * 4);
      this.particles = { read: target(gl, PARTICLES, 1, rgba32, gl.CLAMP_TO_EDGE, seed), write: target(gl, PARTICLES, 1, rgba32), swap() { const t = this.read; this.read = this.write; this.write = t; } };
    }
    if (!complete(gl, this.velocity.read) || !complete(gl, this.marble.read) || !complete(gl, this.dye.read)) throw new Error("half-float render targets are incomplete");
  }

  private uniform(u: Program, name: string): WebGLUniformLocation | null { return u.uniforms.get(name) ?? null; }
  private bind(u: Program, name: string, texture: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(u, name), unit);
  }
  private f1(u: Program, name: string, x: number) { this.gl.uniform1f(this.uniform(u, name), x); }
  private f2(u: Program, name: string, x: number, y: number) { this.gl.uniform2f(this.uniform(u, name), x, y); }

  private run(program: Program, out: Target | null, set: (u: Program) => void): void {
    const gl = this.gl;
    gl.useProgram(program.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
    gl.viewport(0, 0, out ? out.width : this.width, out ? out.height : this.height);
    set(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private simUniforms(u: Program, t: Target) {
    this.f2(u, "uTexel", 1 / t.width, 1 / t.height);
    this.f1(u, "uCell", 1 / t.height);
    this.f1(u, "uAspect", this.aspect);
  }

  private rects(u: Program, rects: readonly PoolRect[]) {
    const { rects: r, meta } = this.arrays;
    const n = Math.min(16, rects.length);
    for (let i = 0; i < n; i++) {
      const x = rects[i];
      r.set([x.x, x.y, x.hx, x.hy], i * 4);
      meta.set([x.radius, x.flags, 0, 0], i * 4);
    }
    this.gl.uniform4fv(this.uniform(u, "uRects"), r);
    this.gl.uniform4fv(this.uniform(u, "uRectMeta"), meta);
    this.gl.uniform1i(this.uniform(u, "uRectCount"), n);
  }

  private stones(u: Program, stones: readonly Stone[], amount: (s: Stone) => number, radius: (s: Stone) => number, tints = false, rings = false) {
    const { a8, t8, r8 } = this.arrays;
    const n = Math.min(8, stones.length);
    for (let i = 0; i < n; i++) {
      const s = stones[i];
      a8.set([s.x, s.y, radius(s), amount(s)], i * 4);
      if (tints) t8.set(s.tint, i * 3);
      r8[i] = s.ring ?? 0;
    }
    this.gl.uniform4fv(this.uniform(u, "uStone"), a8);
    if (tints) this.gl.uniform3fv(this.uniform(u, "uStoneTint"), t8);
    if (rings) this.gl.uniform1fv(this.uniform(u, "uStoneRing"), r8);
    this.gl.uniform1i(this.uniform(u, "uStoneCount"), n);
  }

  /** One simulation step. */
  step(s: FrameState): void {
    const gl = this.gl;
    const { velocity, pressure, heat, marble, waves, dye, curl, divergence } = this;
    if (!velocity || !pressure || !heat || !marble || !waves || !dye || !curl || !divergence) return;
    const dt = Math.min(1 / 15, s.dt);
    if (dt <= 0) return;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    this.beginTimer();
    const P = this.p;
    const params = s.params;

    this.run(P.curl, curl, (u) => { this.simUniforms(u, velocity.read); this.bind(u, "uVelocity", velocity.read.texture, 0); });
    this.run(P.forces, velocity.write, (u) => {
      this.simUniforms(u, velocity.read);
      this.bind(u, "uVelocity", velocity.read.texture, 0);
      this.bind(u, "uCurl", curl.texture, 1);
      this.bind(u, "uWaves", waves.read.texture, 2);
      this.bind(u, "uHeat", heat.read.texture, 3);
      this.f1(u, "uDt", dt);
      this.f1(u, "uEpsilon", params.vorticity);
      this.f1(u, "uBuoyancy", s.buoyancy);
      this.f1(u, "uRipple", 0.02);
      const { a8, b8, c4 } = this.arrays;
      const nv = Math.min(8, s.vortices.length);
      s.vortices.slice(0, nv).forEach((v, i) => b8.set([v.x, v.y, v.spin, v.radius], i * 4));
      gl.uniform4fv(this.uniform(u, "uVortex"), b8);
      gl.uniform1i(this.uniform(u, "uVortexCount"), nv);
      const ns = Math.min(8, s.stones.length);
      s.stones.slice(0, ns).forEach((st, i) => a8.set([st.x, st.y, st.radius * 2.5, st.amp * 0.035], i * 4));
      gl.uniform4fv(this.uniform(u, "uStone"), a8);
      gl.uniform1i(this.uniform(u, "uStoneCount"), ns);
      const nw = Math.min(4, s.swirls.length);
      s.swirls.slice(0, nw).forEach((w, i) => c4.set([w.x, w.y, w.impulse, w.radius], i * 4));
      gl.uniform4fv(this.uniform(u, "uSwirl"), c4);
      gl.uniform1i(this.uniform(u, "uSwirlCount"), nw);
      this.f2(u, "uPush", s.push[0], s.push[1]);
      this.rects(u, s.rects);
    });
    velocity.swap();
    this.run(P.divergence, divergence, (u) => { this.simUniforms(u, velocity.read); this.bind(u, "uVelocity", velocity.read.texture, 0); });
    for (let i = 0; i < this.tier.jacobi; i++) {
      this.run(P.pressure, pressure.write, (u) => {
        this.simUniforms(u, pressure.read);
        this.bind(u, "uPressure", pressure.read.texture, 0);
        this.bind(u, "uDivergence", divergence.texture, 1);
        this.f1(u, "uScale", i === 0 ? 0.8 : 1);
      });
      pressure.swap();
    }
    this.run(P.gradient, velocity.write, (u) => {
      this.simUniforms(u, velocity.read);
      this.bind(u, "uPressure", pressure.read.texture, 0);
      this.bind(u, "uVelocity", velocity.read.texture, 1);
      this.rects(u, s.rects);
    });
    velocity.swap();
    const advect = (field: Pair, decay: number) => {
      this.run(P.advect, field.write, (u) => {
        this.bind(u, "uVelocity", velocity.read.texture, 0);
        this.bind(u, "uSource", field.read.texture, 1);
        this.f1(u, "uDt", dt);
        this.f1(u, "uAspect", this.aspect);
        this.f1(u, "uDecay", decay);
      });
      field.swap();
    };
    advect(velocity, Math.exp((-LN2 * dt) / Math.max(0.2, s.velocityHalfLife)));

    // Heat only runs while there is lava, and for a while after so the blobs can cool and sink.
    this.heatIdle = params.lava > 0.001 || s.emitters.length ? 0 : this.heatIdle + dt;
    if (this.heatIdle < 20) {
      this.run(P.heat, heat.write, (u) => {
        this.bind(u, "uVelocity", velocity.read.texture, 0);
        this.bind(u, "uSource", heat.read.texture, 1);
        this.f1(u, "uDt", dt);
        this.f1(u, "uAspect", this.aspect);
        this.f1(u, "uDecay", Math.exp(-dt / 9));
        const { b8 } = this.arrays;
        const n = Math.min(8, s.emitters.length);
        s.emitters.slice(0, n).forEach((e, i) => b8.set([e.x, e.y, e.rate, e.radius], i * 4));
        gl.uniform4fv(this.uniform(u, "uEmitter"), b8);
        gl.uniform1i(this.uniform(u, "uEmitterCount"), n);
      });
      heat.swap();
    }

    // two flow phases half a period apart: each restarts from the plain photograph while unseen
    const before = this.flowPhase;
    this.flowPhase += dt / Math.max(1, params.flowPeriod);
    const resetA = Math.floor(this.flowPhase) !== Math.floor(before) ? 1 : 0;
    const resetB = Math.floor(this.flowPhase + 0.5) !== Math.floor(before + 0.5) ? 1 : 0;
    this.flowMix = 1 - Math.abs(2 * (this.flowPhase - Math.floor(this.flowPhase)) - 1);
    this.run(P.marble, marble.write, (u) => {
      this.bind(u, "uVelocity", velocity.read.texture, 0);
      this.bind(u, "uMarble", marble.read.texture, 1);
      this.f1(u, "uDt", dt);
      this.f1(u, "uAspect", this.aspect);
      this.f2(u, "uReset", resetA, resetB);
    });
    marble.swap();

    // ripples: sub-stepped so a ring crosses the screen at the same speed on every tier
    const steps = Math.max(1, Math.min(6, Math.round((dt * 0.26 * waves.read.height) / 0.67)));
    const damp = Math.exp((-LN2 * dt) / steps / Math.max(0.1, params.rippleHalfLife));
    for (let i = 0; i < steps; i++) {
      this.run(P.waves, waves.write, (u) => {
        this.f2(u, "uTexel", 1 / waves.read.width, 1 / waves.read.height);
        this.f1(u, "uAspect", this.aspect);
        this.bind(u, "uWaves", waves.read.texture, 0);
        this.f1(u, "uK", 0.45);
        this.f1(u, "uDamp", damp);
        this.stones(u, i === 0 ? s.stones : [], (st) => st.amp * 0.035, (st) => st.radius, false, true);
        this.rects(u, s.rects);
      });
      waves.swap();
    }

    this.run(P.dye, dye.write, (u) => {
      this.bind(u, "uVelocity", velocity.read.texture, 0);
      this.bind(u, "uSource", dye.read.texture, 1);
      this.f1(u, "uDt", dt);
      this.f1(u, "uAspect", this.aspect);
      this.f1(u, "uDecay", Math.exp((-LN2 * dt) / 2.6));
      this.stones(u, s.stones, (st) => st.amp * 0.5, (st) => st.radius * 1.4, true);
    });
    dye.swap();

    const particles = this.particles;
    if (particles && this.tier.floaters > 0) {
      this.run(P.particles, particles.write, (u) => {
        this.bind(u, "uParticles", particles.read.texture, 0);
        this.bind(u, "uVelocity", velocity.read.texture, 1);
        this.bind(u, "uCurl", curl.texture, 2);
        this.f1(u, "uDt", dt);
        this.f1(u, "uAspect", this.aspect);
        this.f2(u, "uDriftVelocity", s.driftVelocity[0], s.driftVelocity[1]);
      });
      particles.swap();
    }
  }

  /** Draws the pool to the canvas. Safe to call without a step (a still frame). */
  render(s: FrameState): void {
    const gl = this.gl;
    const { marble, waves, heat, dye, bloomA, bloomB, floaterLayer, photo, leaf } = this;
    if (!marble || !waves || !heat || !dye || !bloomA || !bloomB || !floaterLayer || !photo || !leaf) return;
    gl.bindVertexArray(this.vao);
    const params = s.params;
    const visible = this.particles ? Math.min(this.tier.floaters, params.floaters) : 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, floaterLayer.fbo);
    gl.viewport(0, 0, floaterLayer.width, floaterLayer.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (visible > 0.01 && this.particles) {
      const u = this.p.floaters;
      gl.useProgram(u.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.bind(u, "uParticles", this.particles.read.texture, 0);
      this.bind(u, "uWaves", waves.read.texture, 1);
      this.bind(u, "uPhoto", this.origin ?? photo, 2);
      this.f1(u, "uAspect", this.aspect);
      this.f1(u, "uPhotoScale", PHOTO_SCALE);
      this.f1(u, "uVisible", visible);
      gl.uniform4fv(this.uniform(u, "uSprite"), this.arrays.sprites);
      gl.uniform1i(this.uniform(u, "uSpriteCount"), SPRITES.length);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.ceil(visible));
      gl.disable(gl.BLEND);
    }

    const scene = (u: Program) => {
      this.bind(u, "uPhoto", photo, 0);
      this.bind(u, "uLeaf", leaf, 1);
      this.bind(u, "uMarble", marble.read.texture, 2);
      this.bind(u, "uWaves", waves.read.texture, 3);
      this.bind(u, "uHeat", heat.read.texture, 4);
      this.bind(u, "uDye", dye.read.texture, 5);
      this.bind(u, "uFloaters", floaterLayer.texture, 6);
      this.f1(u, "uAspect", this.aspect);
      this.f2(u, "uDrift", s.drift[0], s.drift[1]);
      this.f1(u, "uPhotoScale", PHOTO_SCALE);
      this.f1(u, "uSaturation", params.saturation);
      this.f1(u, "uSepia", params.sepia);
      this.f1(u, "uBrightness", params.brightness);
      this.f1(u, "uContrast", params.contrast);
      this.f1(u, "uSpread", params.spread);
      this.f1(u, "uDawn", s.dawn);
      this.f1(u, "uEmission", params.emission);
      this.f1(u, "uKick", s.kick);
      this.f1(u, "uLava", Math.min(1, params.lava * 1.5));
      this.f1(u, "uRefract", 0.05);
      this.f1(u, "uDyeGain", 0.12 + params.emission * 0.25);
      this.f1(u, "uCalmDepth", Math.min(1, params.spread * 1.4));
      gl.uniform3f(this.uniform(u, "uTint"), s.tint[0], s.tint[1], s.tint[2]);
      this.f2(u, "uWaveTexel", 1 / waves.read.width, 1 / waves.read.height);
      this.f1(u, "uWaveCell", 1 / waves.read.height);
      const { c4 } = this.arrays;
      const n = Math.min(4, s.rings.length);
      s.rings.slice(0, n).forEach((r, i) => c4.set([r.x, r.y, r.age, r.strength], i * 4));
      gl.uniform4fv(this.uniform(u, "uRings"), c4);
      gl.uniform1i(this.uniform(u, "uRingCount"), n);
      const { f2 } = this.arrays;
      const nf = Math.min(2, s.flashes.length);
      s.flashes.slice(0, nf).forEach((f, i) => f2.set([f.x, f.y, f.radius, f.amount], i * 4));
      gl.uniform4fv(this.uniform(u, "uFlash"), f2);
      gl.uniform1i(this.uniform(u, "uFlashCount"), nf);
      this.f1(u, "uFlowMix", this.flowMix);
      const turning = this.pond && s.morph ? s.morph : null;
      this.bind(u, "uPhotoB", this.pond ?? photo, 8);
      this.f1(u, "uMorph", turning ? Math.max(0, Math.min(1, turning.amount)) : 0);
      this.f2(u, "uMorphSeed", turning?.seed[0] ?? 0, turning?.seed[1] ?? 0);
      this.rects(u, s.rects);
    };

    const bloom = params.bloom * (this.tier.bloom > 0 ? 1 : 0);
    if (bloom > 0.001) {
      this.run(this.p.bright, bloomA, scene);
      this.run(this.p.blur, bloomB, (u) => { this.bind(u, "uSource", bloomA.texture, 0); this.f2(u, "uStep", 1 / bloomA.width, 0); });
      this.run(this.p.blur, bloomA, (u) => { this.bind(u, "uSource", bloomB.texture, 0); this.f2(u, "uStep", 0, 1 / bloomA.height); });
    }
    this.run(this.p.composite, null, (u) => {
      scene(u);
      this.bind(u, "uBloom", bloom > 0.001 ? bloomA.texture : this.black, 7);
      this.f1(u, "uBloomGain", bloom);
      const t = s.tuner;
      gl.uniform4f(this.uniform(u, "uTuner"), t?.x ?? 0, t?.y ?? 0, t?.radius ?? 0.1, t?.amount ?? 0);
      this.f2(u, "uTunerWave", t?.phase ?? 0, t?.ratio ?? 1);
      this.f2(u, "uResolution", this.width, this.height);
    });
    this.endTimer();
  }

  private beginTimer(): void {
    const { ext, free } = this.timer;
    if (!ext || this.timer.busy.length > 3) return;
    const q = free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.timer.busy.push(q);
    this.timing = true;
  }

  private timing = false;
  private endTimer(): void {
    const gl = this.gl;
    const { ext, busy, free } = this.timer;
    if (!ext) return;
    if (this.timing) { gl.endQuery(ext.TIME_ELAPSED_EXT); this.timing = false; }
    const q = busy[0];
    if (q && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      busy.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) this.timer.ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      free.push(q);
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (this.timing && this.timer.ext) gl.endQuery(this.timer.ext.TIME_ELAPSED_EXT);
    [...this.timer.free, ...this.timer.busy].forEach((q) => gl.deleteQuery(q));
    [this.velocity, this.pressure, this.heat, this.marble, this.waves, this.dye, this.particles].forEach((p) => releasePair(gl, p));
    [this.curl, this.divergence, this.bloomA, this.bloomB, this.floaterLayer].forEach((t) => release(gl, t));
    Object.values(this.p).forEach((program) => gl.deleteProgram(program.program));
    [...new Set([this.photo, this.pond, this.origin, this.leaf, this.black])].forEach((t) => t && gl.deleteTexture(t));
    gl.deleteVertexArray(this.vao);
    this.velocity = this.pressure = this.heat = this.marble = this.waves = this.dye = this.particles = null;
  }
}

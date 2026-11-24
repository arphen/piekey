import { useEffect, useRef, useState, type MutableRefObject } from "react";
import swirlUrl from "../assets/pond-swirl.webp";
import marbleUrl from "../assets/pond-marble.webp";
import neonUrl from "../assets/pond-neon.webp";
import bandsUrl from "../assets/pond-bands.webp";
import waterUrl from "../assets/water-texture.webp";
import type { BeatSignal } from "../song/pulse";

const PONDS = [swirlUrl, marbleUrl, neonUrl, bandsUrl, waterUrl];
const POND_STAY = 18; // seconds resting on one pond photograph before morphing into the next
const POND_TURN = 16; // seconds for the spiral algae morph to complete

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// Direct photographic algae morphing: no artificial water surface. Two of the owner's
// Tempelhofer Hafenbecken pond photographs are domain-warped by counter-rotating spiral eddies
// and height-blended by algae thickness so poison-green swirls organically morph into one another
// over dark abyssal water, brightening with bioluminescent chlorophyll as the player hits notes.
const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float energy;
uniform float bloom;
uniform float hit;
uniform float strike;
uniform float downbeat;
uniform float morph;
uniform float hasTexA;
uniform float hasTexB;
uniform vec2 morphSeed;
uniform vec2 notePos;
uniform float notePulse;
uniform float noteHue;
uniform sampler2D texA;
uniform sampler2D texB;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.04 + vec2(4.3, 2.7);
    a *= 0.5;
  }
  return v;
}

// Spiral vortex displacement centered at c: twists the real algae photograph in fluid eddies.
vec2 spiralEddy(vec2 p, vec2 c, float radius, float spin) {
  vec2 d = p - c;
  float r2 = dot(d, d);
  float w = exp(-r2 / (radius * radius));
  float a = spin * w;
  float cs = cos(a);
  float sn = sin(a);
  return vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs) - d;
}

vec2 photoUv(vec2 p) {
  // Generous scale keeps the real photograph's interior framed across widescreen viewports without visible seams.
  vec2 q = p * vec2(0.36, 0.48) + vec2(0.5, 0.5);
  return abs(mod(q + 1.0, 2.0) - 1.0);
}

float algaeHeight(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return luma + 1.15 * max(0.0, c.g - max(c.r, c.b));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // Slow harbor drift plus three counter-rotating spiral eddies that accelerate as you play.
  float t = time;
  float vigor = 1.0 + bloom * 0.95 + hit * 0.75 + energy * 0.45;
  vec2 drift = vec2(sin(t * 0.037) * 0.14 + t * 0.008, cos(t * 0.029) * 0.11 - t * 0.005);

  vec2 c1 = vec2(sin(t * 0.08) * 0.42, cos(t * 0.065) * 0.28);
  vec2 c2 = vec2(cos(t * 0.06 + 2.1) * 0.48, sin(t * 0.075 + 1.3) * 0.32);
  vec2 c3 = vec2(sin(t * 0.05 + 4.2) * 0.30, cos(t * 0.09 + 3.4) * 0.26);

  float beatTwist = strike * (0.09 + 0.14 * bloom) * (downbeat > 0.5 ? 1.35 : -0.85);
  vec2 swirl = vec2(0.0);
  swirl += spiralEddy(p, c1, 0.58, (0.42 + 0.35 * sin(t * 0.11)) * vigor + beatTwist);
  swirl += spiralEddy(p, c2, 0.52, (-0.38 + 0.28 * cos(t * 0.09)) * vigor - beatTwist * 0.7);
  swirl += spiralEddy(p, c3, 0.42, (0.32 * sin(t * 0.13 + 1.2)) * vigor);
  // Live guitar pitch vortex: every note spins up a localized spiral right in the real algae photo
  swirl += spiralEddy(p, notePos, 0.34, (noteHue > 0.5 ? 1.0 : -1.0) * notePulse * (0.95 + 0.5 * bloom));

  // Curl of low-frequency noise adds organic filament stretching between spirals.
  vec2 q = p * 1.45 + drift * 0.6;
  float f0 = fbm(q + vec2(t * 0.025, -t * 0.018));
  float fx = fbm(q + vec2(0.06 + t * 0.025, -t * 0.018));
  float fy = fbm(q + vec2(t * 0.025, 0.06 - t * 0.018));
  vec2 curl = vec2(fy - f0, -(fx - f0)) * (0.45 + 0.45 * bloom + 0.25 * hit);

  vec2 coord = p + drift + swirl * 0.48 + curl * 0.16;

  vec3 abyss = vec3(0.018, 0.036, 0.027);
  vec3 raw = abyss;

  if (hasTexA > 0.5) {
    float front = clamp(morph * 1.65 - fbm(p * 1.5 + morphSeed * 13.0) * 0.65, 0.0, 1.0);
    vec2 mCurl = curl * 0.22;
    vec3 colA = texture2D(texA, photoUv(coord + mCurl * front)).rgb;
    if (hasTexB > 0.5 && morph > 0.001) {
      vec3 colB = texture2D(texB, photoUv(coord - mCurl * (1.0 - front))).rgb;
      float k = (2.0 * front - 1.0) * 1.35 + (algaeHeight(colB) - algaeHeight(colA)) * 1.05 * 4.0 * front * (1.0 - front);
      raw = mix(colA, colB, smoothstep(-0.16, 0.16, k));
    } else {
      raw = colA;
    }
  } else {
    // Immediate abyssal fallback for the brief moment before the first WebP decodes.
    float w = smoothstep(0.32, 0.78, f0);
    raw = mix(abyss, vec3(0.11, 0.34, 0.14), w * 0.55);
  }

  // Abyssal harbor grading: keep dark water voids ink-black, let poison-green algae glow.
  float luma = dot(raw, vec3(0.2126, 0.7152, 0.0722));
  float greenness = max(0.0, raw.g - max(raw.r * 0.92, raw.b));
  float algaeMask = smoothstep(0.035, 0.22, greenness) * smoothstep(0.14, 0.58, luma);

  // Deepen shadows so the center stays abyssal while algae ridges pop with toxic clarity.
  vec3 graded = mix(vec3(luma), raw, 1.18 + bloom * 0.52 + hit * 0.38);
  graded = pow(max(graded, 0.0), vec3(1.58 - bloom * 0.22));

  // Center calm lens so score notation and text remain effortlessly legible.
  float centerDist = length((uv - vec2(0.5, 0.48)) * vec2(1.12, 1.0));
  float rimPresence = smoothstep(0.14, 0.78, centerDist);
  float visibility = mix(0.26 + bloom * 0.20 + hit * 0.14, 0.72 + bloom * 0.26 + hit * 0.16, rimPresence);

  vec3 color = mix(abyss, graded, clamp(visibility, 0.0, 0.96));

  // Poison-green bioluminescent bloom: shifts subtly from deep emerald (low notes) to chartreuse-gold (high notes)
  vec3 poisonNeon = mix(vec3(0.24, 0.94, 0.36), vec3(0.56, 1.0, 0.22), noteHue);
  vec3 birchGold = vec3(0.88, 0.75, 0.38);
  float noteNear = exp(-dot(p - notePos, p - notePos) / 0.14) * notePulse;
  float glowStrength = 0.06 + bloom * 0.62 + hit * 0.58 + energy * 0.16 + noteNear * 0.65;
  color += poisonNeon * algaeMask * raw.g * glowStrength * (0.45 + 0.75 * rimPresence);

  // Subtle golden pulse on downbeats, cool toxic-emerald surge on beats.
  vec3 beatColor = mix(poisonNeon, birchGold, downbeat * 0.78);
  color += beatColor * algaeMask * strike * (0.14 + 0.22 * bloom) * (0.35 + 0.65 * rimPresence);

  // Soft filmic knee so bright poison highlights never clip harsh white.
  vec3 over = max(color - 0.58, 0.0);
  color = min(color, 0.58) + over / (1.0 + over / 0.36);

  // Subtle dither against dark-water banding.
  float dither = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(max(color + dither, 0.0), 1.0);
}
`;

export interface RenderedWaterProps {
  playing: boolean;
  warmth: number;
  flow: number;
  hitSerial?: number;
  beat?: BeatSignal;
  level: MutableRefObject<{ level: number; heard: number; played: number; noteX?: number; noteY?: number; noteHue?: number; noteAt?: number; wake?: () => void }>;
}

function makeTexture(gl: WebGLRenderingContext): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 16, 12, 255]));
  return tex;
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Bounded single-pass GPU algae-morphing layer. The score and musical clock never depend on it. */
export function RenderedWater({ playing, warmth, flow, hitSerial = 0, beat, level }: RenderedWaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ playing, warmth, flow, hitSerial, beat });
  latest.current = { playing, warmth, flow, hitSerial, beat };
  const wake = useRef<() => void>(() => undefined);
  const [restored, setRestored] = useState(0);
  useEffect(() => { wake.current(); }, [playing, beat?.active, beat?.serial, warmth, flow, hitSerial]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let gl: WebGLRenderingContext | null = null;
    try { gl = el.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false }); }
    catch { /* The photographic room remains available when GPU access is denied. */ }
    if (!gl) { el.dataset.renderer = "unavailable"; return; }
    const gpu = gl;
    let disposed = false;
    let failed = false;
    let frame = 0;
    let previous = 0;
    let elapsed = 0;
    let serial = -1;
    let lastHitSerial = latest.current.hitSerial;
    let struck = -Infinity;
    let smoothEnergy = 0;
    let bloom = 0;
    let hitPulse = 0;
    let changedSize = true;
    let painted = false;

    // Pond photograph morph state: continuously turns from one real photograph into the next.
    let pondIndex = 0;
    let pondPhase = 0;
    let turning = false;
    let loadingNext = false;
    let hasTexA = false;
    let hasTexB = false;
    let nextImg: HTMLImageElement | null = null;
    let morphSeed: [number, number] = [0.27, 0.71];

    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gpu.createShader(type);
      if (!shader) return null;
      shaders.push(shader);
      gpu.shaderSource(shader, source);
      gpu.compileShader(shader);
      return gpu.getShaderParameter(shader, gpu.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gpu.VERTEX_SHADER, VERTEX);
    const fragment = compile(gpu.FRAGMENT_SHADER, FRAGMENT);
    const program = gpu.createProgram();
    const buffer = gpu.createBuffer();
    const texA = makeTexture(gpu);
    const texB = makeTexture(gpu);
    const release = () => {
      cancelAnimationFrame(frame);
      if (texA) gpu.deleteTexture(texA);
      if (texB) gpu.deleteTexture(texB);
      gpu.deleteBuffer(buffer);
      if (program) gpu.deleteProgram(program);
      shaders.forEach((shader) => gpu.deleteShader(shader));
    };
    if (!vertex || !fragment || !program || !buffer || !texA || !texB) { release(); el.dataset.renderer = "unavailable"; return; }
    gpu.attachShader(program, vertex);
    gpu.attachShader(program, fragment);
    gpu.linkProgram(program);
    if (!gpu.getProgramParameter(program, gpu.LINK_STATUS)) { release(); el.dataset.renderer = "unavailable"; return; }
    gpu.useProgram(program);
    gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
    gpu.bufferData(gpu.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gpu.STATIC_DRAW);
    const position = gpu.getAttribLocation(program, "position");
    gpu.enableVertexAttribArray(position);
    gpu.vertexAttribPointer(position, 2, gpu.FLOAT, false, 0, 0);
    const u = Object.fromEntries(
      ["resolution", "time", "energy", "bloom", "hit", "strike", "downbeat", "morph", "hasTexA", "hasTexB", "morphSeed", "notePos", "notePulse", "noteHue", "texA", "texB"].map((key) => [key, gpu.getUniformLocation(program, key)]),
    );
    gpu.uniform1i(u.texA, 0);
    gpu.uniform1i(u.texB, 1);

    const upload = (slot: number, tex: WebGLTexture, img: HTMLImageElement) => {
      if (disposed || gpu.isContextLost()) return;
      gpu.activeTexture(gpu.TEXTURE0 + slot);
      gpu.bindTexture(gpu.TEXTURE_2D, tex);
      gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, gpu.RGBA, gpu.UNSIGNED_BYTE, img);
    };

    const cachedImages = new Map<number, HTMLImageElement>();
    const fetchPond = (index: number, onReady: (img: HTMLImageElement) => void) => {
      const i = index % PONDS.length;
      const existing = cachedImages.get(i);
      if (existing) { onReady(existing); return; }
      void loadImg(PONDS[i]).then((img) => {
        if (disposed) return;
        cachedImages.set(i, img);
        onReady(img);
      }).catch(() => undefined);
    };

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const paint = (now: number) => {
      frame = 0;
      if (disposed || failed || document.hidden || gpu.isContextLost()) return;
      const s = latest.current;
      const moving = !motion?.matches;
      const active = (s.playing && now - level.current.heard < 1200) || Boolean(s.beat?.active) || hitPulse > 0.02 || bloom > 0.02;
      const targetFps = active ? 30 : 18;
      if (moving && previous && now - previous < 1000 / targetFps) { frame = requestAnimationFrame(paint); return; }
      const dtMs = previous ? Math.min(100, now - previous) : 33;
      const dt = dtMs / 1000;
      previous = now;
      if (moving) elapsed += dt;

      if (s.beat?.active && s.beat.serial !== serial) { serial = s.beat.serial; struck = now; }
      if (s.hitSerial !== lastHitSerial) {
        lastHitSerial = s.hitSerial;
        hitPulse = Math.min(1, hitPulse + 0.55);
      }
      hitPulse *= Math.exp(-dt / 1.4);

      if (changedSize) {
        const rect = el.getBoundingClientRect();
        const scale = Math.min(0.7, 1000 / Math.max(rect.width, rect.height, 1));
        el.width = Math.max(1, Math.round(rect.width * scale));
        el.height = Math.max(1, Math.round(rect.height * scale));
        gpu.viewport(0, 0, el.width, el.height);
        changedSize = false;
      }

      const heard = s.playing && now - level.current.heard < 1400;
      smoothEnergy += ((heard ? level.current.level : 0) - smoothEnergy) * (1 - Math.exp(-dtMs / 280));
      // Immediate positive reinforcement: flow and active playing visibly awaken the algae within seconds.
      const engaged = s.playing ? Math.max(0.25, Math.min(1, s.warmth * 1.4 + level.current.played / 18000)) : 0;
      const flowBoost = s.playing ? Math.max(0, Math.min(1, (s.flow - 0.25) / 0.65)) : 0;
      const targetBloom = heard ? Math.min(1, engaged * (0.45 + 0.55 * flowBoost) + hitPulse * 0.35) : hitPulse * 0.4;
      bloom += (targetBloom - bloom) * (1 - Math.exp(-dtMs / (targetBloom > bloom ? 1800 : 5200)));

      // Advance organic photo-to-photo spiral morph.
      let morphAmount = 0;
      if (moving && hasTexA) {
        const pace = 1 + bloom * 1.35 + hitPulse * 0.6;
        if (!turning) {
          pondPhase += (dt * pace) / POND_STAY;
          if (pondPhase > 0.35 && !nextImg && !loadingNext) {
            loadingNext = true;
            fetchPond(pondIndex + 1, (img) => {
              nextImg = img;
              loadingNext = false;
            });
          }
          if (pondPhase >= 1 && nextImg) {
            upload(1, texB, nextImg);
            hasTexB = true;
            nextImg = null;
            turning = true;
            pondPhase = 0;
            morphSeed = [((pondIndex * 0.37 + 0.19) % 1), ((pondIndex * 0.61 + 0.43) % 1)];
          }
        } else {
          pondPhase += (dt * pace) / POND_TURN;
          if (pondPhase >= 1) {
            pondIndex = (pondIndex + 1) % PONDS.length;
            const settled = cachedImages.get(pondIndex);
            if (settled) upload(0, texA, settled);
            turning = false;
            pondPhase = 0;
            hasTexB = false;
          } else {
            morphAmount = pondPhase * pondPhase * (3 - 2 * pondPhase);
          }
        }
      }

      let smoothNoteX = 0;
      let smoothNoteY = 0;
      let smoothNoteHue = 0.5;
      if (level.current.noteX !== undefined) smoothNoteX = level.current.noteX;
      if (level.current.noteY !== undefined) smoothNoteY = level.current.noteY;
      if (level.current.noteHue !== undefined) smoothNoteHue = level.current.noteHue;
      const noteAge = level.current.noteAt !== undefined ? Math.max(0, (now - level.current.noteAt) / 1000) : 99;
      const notePulse = motion?.matches ? 0 : Math.exp(-noteAge / 0.85) * Math.max(0.25, smoothEnergy);

      gpu.activeTexture(gpu.TEXTURE0);
      gpu.bindTexture(gpu.TEXTURE_2D, texA);
      gpu.activeTexture(gpu.TEXTURE1);
      gpu.bindTexture(gpu.TEXTURE_2D, texB);
      gpu.uniform2f(u.resolution, el.width, el.height);
      gpu.uniform1f(u.time, elapsed);
      gpu.uniform1f(u.energy, motion?.matches ? 0 : smoothEnergy);
      gpu.uniform1f(u.bloom, bloom);
      gpu.uniform1f(u.hit, motion?.matches ? 0 : hitPulse);
      gpu.uniform1f(u.strike, motion?.matches || !s.beat?.active ? 0 : Math.exp(-(now - struck) / 340));
      gpu.uniform1f(u.downbeat, s.beat?.index === 0 ? 1 : 0);
      gpu.uniform1f(u.morph, morphAmount);
      gpu.uniform1f(u.hasTexA, hasTexA ? 1 : 0);
      gpu.uniform1f(u.hasTexB, hasTexB ? 1 : 0);
      gpu.uniform2f(u.morphSeed, morphSeed[0], morphSeed[1]);
      gpu.uniform2f(u.notePos, smoothNoteX, smoothNoteY);
      gpu.uniform1f(u.notePulse, notePulse);
      gpu.uniform1f(u.noteHue, smoothNoteHue);
      gpu.drawArrays(gpu.TRIANGLES, 0, 6);
      painted = true;
      el.dataset.renderer = "ready";
      if (moving) frame = requestAnimationFrame(paint);
    };

    const start = () => {
      if (motion?.matches && painted && !changedSize) return;
      if (!disposed && !failed && !document.hidden && !frame) { previous = 0; frame = requestAnimationFrame(paint); }
    };

    fetchPond(0, (img) => {
      upload(0, texA, img);
      hasTexA = true;
      start();
    });

    wake.current = start;
    level.current.wake = start;
    const resized = () => { changedSize = true; start(); };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resized);
    resize?.observe(el);
    if (!resize) window.addEventListener("resize", resized);
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; previous = 0; } else start(); };
    const lost = (event: Event) => { event.preventDefault(); failed = true; cancelAnimationFrame(frame); frame = 0; el.dataset.renderer = "unavailable"; };
    const regained = () => setRestored((n) => n + 1);
    document.addEventListener("visibilitychange", visibility);
    motion?.addEventListener("change", start);
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", regained);
    start();
    return () => {
      disposed = true;
      wake.current = () => undefined;
      level.current.wake = undefined;
      resize?.disconnect();
      if (!resize) window.removeEventListener("resize", resized);
      document.removeEventListener("visibilitychange", visibility);
      motion?.removeEventListener("change", start);
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", regained);
      release();
    };
  }, [level, restored]);

  return <canvas className="pa-rendered-water" ref={canvas} aria-hidden="true" />;
}

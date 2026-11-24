import { useEffect, useRef, useState, type MutableRefObject } from "react";
import swirlUrl from "../assets/pond-swirl.webp";
import marbleUrl from "../assets/pond-marble.webp";
import neonUrl from "../assets/pond-neon.webp";
import bandsUrl from "../assets/pond-bands.webp";
import waterUrl from "../assets/water-texture.webp";
import type { BeatSignal } from "../song/pulse";

const PONDS = [swirlUrl, marbleUrl, neonUrl, bandsUrl, waterUrl];
const POND_STAY = 24; // seconds resting on one pond photograph before morphing into the next
const POND_TURN = 20; // seconds for the slow algae morph to complete

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// Photographic algae shader with deep marine inertia: rests as dark, almost-still harbor water
// with algae hovering at the far rim. As the player locks in over tens of seconds, an old-engine
// flywheel spins up; notes send delayed, far-away propeller swells gliding through the water,
// ebbing gently if they falter, and opening into a lush bioluminescent algae embrace only at
// sustained peak performance.
const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float energy;
uniform float bloom;
uniform float zone;
uniform float sway;
uniform float downbeat;
uniform float morph;
uniform float hasTexA;
uniform float hasTexB;
uniform vec2 morphSeed;
uniform vec2 notePos;
uniform float noteWarmth;
uniform float noteHue;
uniform vec4 swells[3]; // xy origin, z age (s), w strength
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

  // Nearly still dark water at rest; slow, hypnotic currents wake gradually with bloom and zone.
  float t = time;
  float vigor = 0.18 + bloom * 0.58 + zone * 0.52 + energy * 0.14;
  vec2 drift = vec2(sin(t * 0.022) * 0.12 + t * 0.004, cos(t * 0.017) * 0.09 - t * 0.003);

  vec2 c1 = vec2(sin(t * 0.045) * 0.44, cos(t * 0.038) * 0.28);
  vec2 c2 = vec2(cos(t * 0.036 + 2.1) * 0.48, sin(t * 0.042 + 1.3) * 0.32);
  vec2 c3 = vec2(sin(t * 0.03 + 4.2) * 0.32, cos(t * 0.05 + 3.4) * 0.26);

  // Gentle underwater tide sway once warm — never a sharp snap.
  float tide = sway * (0.04 + 0.1 * zone) * (downbeat > 0.5 ? 1.15 : -0.75);
  vec2 swirl = vec2(0.0);
  swirl += spiralEddy(p, c1, 0.64, (0.28 + 0.22 * sin(t * 0.07)) * vigor + tide);
  swirl += spiralEddy(p, c2, 0.58, (-0.25 + 0.18 * cos(t * 0.06)) * vigor - tide * 0.7);
  swirl += spiralEddy(p, c3, 0.48, (0.2 * sin(t * 0.08 + 1.2)) * vigor);
  // Softly drifting harmonic eddy that only opens up once warmed.
  swirl += spiralEddy(p, notePos, 0.46, (noteHue > 0.5 ? 1.0 : -1.0) * noteWarmth * (0.14 + 0.34 * bloom));

  // Delayed far-away propeller swells gliding across the pond.
  vec2 waveShift = vec2(0.0);
  float swellLight = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 sw = swells[i];
    if (sw.w <= 0.001) continue;
    vec2 d = p - sw.xy;
    float dist = length(d) + 1e-4;
    float radius = sw.z * 0.24; // slow deep-water propagation
    float band = dist - radius;
    float env = exp(-band * band / 0.022) * exp(-sw.z * 0.42) * sw.w;
    float wave = sin(band * 24.0) * env;
    waveShift += (d / dist) * wave * 0.028;
    swellLight += env * (0.5 + 0.5 * cos(band * 18.0));
  }

  vec2 q = p * 1.35 + drift * 0.5;
  float f0 = fbm(q + vec2(t * 0.014, -t * 0.01));
  float fx = fbm(q + vec2(0.06 + t * 0.014, -t * 0.01));
  float fy = fbm(q + vec2(t * 0.014, 0.06 - t * 0.01));
  vec2 curl = vec2(fy - f0, -(fx - f0)) * (0.22 + 0.36 * bloom + 0.25 * zone);

  vec2 coord = p + drift + swirl * 0.42 + curl * 0.14 + waveShift;

  vec3 abyss = vec3(0.016, 0.032, 0.024);
  vec3 raw = abyss;

  if (hasTexA > 0.5) {
    if (hasTexB > 0.5 && morph > 0.001) {
      float front = clamp(morph * 1.65 - fbm(p * 1.5 + morphSeed * 13.0) * 0.65, 0.0, 1.0);
      vec2 mCurl = curl * 0.22;
      vec3 colA = texture2D(texA, photoUv(coord + mCurl * front)).rgb;
      vec3 colB = texture2D(texB, photoUv(coord - mCurl * (1.0 - front))).rgb;
      float k = (2.0 * front - 1.0) * 1.35 + (algaeHeight(colB) - algaeHeight(colA)) * 1.05 * 4.0 * front * (1.0 - front);
      raw = mix(colA, colB, smoothstep(-0.16, 0.16, k));
    } else {
      raw = texture2D(texA, photoUv(coord)).rgb;
    }
  } else {
    float w = smoothstep(0.35, 0.8, f0);
    raw = mix(abyss, vec3(0.08, 0.26, 0.11), w * 0.45);
  }

  float luma = dot(raw, vec3(0.2126, 0.7152, 0.0722));
  float greenness = max(0.0, raw.g - max(raw.r * 0.92, raw.b));
  float algaeMask = smoothstep(0.035, 0.22, greenness) * smoothstep(0.16, 0.58, luma);

  // Restrained, dark and inviting at rest; rich, saturated and luminous as you earn the zone.
  vec3 graded = mix(vec3(luma), raw, 0.82 + bloom * 0.48 + zone * 0.56);
  graded = pow(max(graded, 0.0), vec3(1.68 - bloom * 0.14 - zone * 0.18));

  // At rest the algae hover at the distant perimeter; as you enter the zone they creep in and embrace the room.
  float centerDist = length((uv - vec2(0.5, 0.48)) * vec2(1.08, 1.0));
  float innerRim = mix(0.32, 0.10, zone);
  float rimPresence = smoothstep(innerRim, 0.84, centerDist);
  float visibility = mix(0.12 + bloom * 0.18 + zone * 0.24, 0.36 + bloom * 0.32 + zone * 0.30, rimPresence);

  vec3 color = mix(abyss, graded, clamp(visibility, 0.0, 0.96));

  // Bioluminescence: barely a distant whisper early on, blossoming into intoxicating emerald-gold radiance in the zone.
  vec3 poisonNeon = mix(vec3(0.22, 0.92, 0.38), vec3(0.56, 1.0, 0.22), noteHue);
  vec3 birchGold = vec3(0.88, 0.75, 0.38);
  float noteNear = exp(-dot(p - notePos, p - notePos) / 0.24) * noteWarmth;
  float glowStrength = 0.015 + bloom * 0.18 + zone * 0.92 + swellLight * (0.14 + 0.34 * bloom) + noteNear * (0.08 + 0.26 * zone);
  color += poisonNeon * algaeMask * raw.g * glowStrength * (0.35 + 0.85 * rimPresence);

  // Subtle golden warmth breathing softly in the deep zone on downbeats.
  vec3 tideColor = mix(poisonNeon, birchGold, downbeat * 0.65);
  color += tideColor * algaeMask * sway * zone * 0.24 * (0.35 + 0.65 * rimPresence);

  // Soft filmic knee so peak bioluminescence glows richly without clipping harsh white.
  vec3 over = max(color - 0.58, 0.0);
  color = min(color, 0.58) + over / (1.0 + over / 0.38);

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

const unit = (n: number) => Math.max(0, Math.min(1, n));

/** Bounded single-pass GPU algae shader. Slow engine warm-up, delayed swells, earned peak embrace. */
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
    let smoothEnergy = 0;
    let engineMs = 0; // accumulated real playing time spinning up the flywheel
    let bloom = 0;
    let beatSway = 0;
    let beatTarget = 0;
    let smoothNoteX = 0;
    let smoothNoteY = 0;
    let smoothNoteHue = 0.5;
    let smoothNoteWarmth = 0;
    let swellCounter = 0;
    let changedSize = true;
    let painted = false;

    // Delayed far-away propeller swells: queued on landed hits, gliding across the pond once they arrive.
    const pendingSwells: { due: number; x: number; y: number; strength: number }[] = [];
    const activeSwells: { x: number; y: number; age: number; strength: number }[] = [];
    const swellBuf = new Float32Array(12);

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
      ["resolution", "time", "energy", "bloom", "zone", "sway", "downbeat", "morph", "hasTexA", "hasTexB", "morphSeed", "notePos", "noteWarmth", "noteHue", "swells", "texA", "texB"].map((key) => [key, gpu.getUniformLocation(program, key)]),
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
      const active = (s.playing && now - level.current.heard < 1800) || bloom > 0.02 || activeSwells.length > 0 || pendingSwells.length > 0;
      const targetFps = active ? 30 : 15;
      if (moving && previous && now - previous < 1000 / targetFps) { frame = requestAnimationFrame(paint); return; }
      const dtMs = previous ? Math.min(100, now - previous) : 33;
      const dt = dtMs / 1000;
      previous = now;
      if (moving) elapsed += dt;

      if (s.beat?.active && s.beat.serial !== serial) {
        serial = s.beat.serial;
        beatTarget = s.beat.index === 0 ? 1 : 0.55;
      }
      beatTarget *= Math.exp(-dt / 0.65);
      beatSway += (beatTarget - beatSway) * (1 - Math.exp(-dt / 0.26));

      // Queue a delayed far-away swell when a note lands cleanly (never an instant violent flash).
      if (s.hitSerial !== lastHitSerial) {
        lastHitSerial = s.hitSerial;
        const delayMs = 950 - 650 * bloom;
        const angle = (++swellCounter * 2.39996) % (Math.PI * 2);
        const dist = 0.52 - 0.22 * bloom; // arrives from farther out when cold, closer as you warm up
        pendingSwells.push({
          due: now + delayMs,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.65,
          strength: 0.24 + 0.76 * bloom,
        });
        if (pendingSwells.length > 6) pendingSwells.shift();
      }
      while (pendingSwells.length && pendingSwells[0].due <= now) {
        const next = pendingSwells.shift()!;
        activeSwells.push({ x: next.x, y: next.y, age: 0, strength: next.strength });
        if (activeSwells.length > 3) activeSwells.shift();
      }
      for (let i = activeSwells.length - 1; i >= 0; i--) {
        activeSwells[i].age += dt;
        if (activeSwells[i].age > 6.5) activeSwells.splice(i, 1);
      }

      if (changedSize) {
        const rect = el.getBoundingClientRect();
        const scale = Math.min(0.65, 960 / Math.max(rect.width, rect.height, 1));
        el.width = Math.max(1, Math.round(rect.width * scale));
        el.height = Math.max(1, Math.round(rect.height * scale));
        gpu.viewport(0, 0, el.width, el.height);
        changedSize = false;
      }

      // Heavy old-engine flywheel: spins up slowly with sustained clean playing, ebbs gracefully on silence or mistakes.
      const heard = s.playing && now - level.current.heard < 2200;
      if (heard) engineMs = Math.min(45000, engineMs + dtMs);
      else engineMs = Math.max(0, engineMs - dtMs * 0.28);

      smoothEnergy += ((heard ? level.current.level : 0) - smoothEnergy) * (1 - Math.exp(-dtMs / 650));
      const spunUp = Math.pow(unit(engineMs / 36000), 1.65); // convex: whisper-quiet first 6s, strong after 30-36s
      const quality = 0.28 + 0.72 * unit((s.flow - 0.35) / 0.58);
      const targetBloom = heard ? unit(spunUp * quality) : 0;
      bloom += (targetBloom - bloom) * (1 - Math.exp(-dtMs / (targetBloom > bloom ? 6800 : 11500)));
      // Transcendent algae embrace opens non-linearly only in the upper zone.
      const zone = Math.pow(unit(bloom), 2.15);

      let morphAmount = 0;
      if (moving && hasTexA) {
        const pace = 0.65 + bloom * 0.75 + zone * 0.65;
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

      // Smoothly drift harmonic centre instead of snapping on every note.
      const noteEase = 1 - Math.exp(-dtMs / 1600);
      if (level.current.noteX !== undefined) smoothNoteX += (level.current.noteX - smoothNoteX) * noteEase;
      if (level.current.noteY !== undefined) smoothNoteY += (level.current.noteY - smoothNoteY) * noteEase;
      if (level.current.noteHue !== undefined) smoothNoteHue += (level.current.noteHue - smoothNoteHue) * noteEase;
      const noteAge = level.current.noteAt !== undefined ? Math.max(0, (now - level.current.noteAt) / 1000) : 99;
      const wantWarmth = motion?.matches || !heard ? 0 : Math.exp(-noteAge / 2.6) * (0.2 + 0.8 * bloom);
      smoothNoteWarmth += (wantWarmth - smoothNoteWarmth) * (1 - Math.exp(-dtMs / 700));

      swellBuf.fill(0);
      for (let i = 0; i < 3 && i < activeSwells.length; i++) {
        const sw = activeSwells[i];
        swellBuf[i * 4] = sw.x;
        swellBuf[i * 4 + 1] = sw.y;
        swellBuf[i * 4 + 2] = sw.age;
        swellBuf[i * 4 + 3] = motion?.matches ? 0 : sw.strength;
      }

      gpu.activeTexture(gpu.TEXTURE0);
      gpu.bindTexture(gpu.TEXTURE_2D, texA);
      gpu.activeTexture(gpu.TEXTURE1);
      gpu.bindTexture(gpu.TEXTURE_2D, texB);
      gpu.uniform2f(u.resolution, el.width, el.height);
      gpu.uniform1f(u.time, elapsed);
      gpu.uniform1f(u.energy, motion?.matches ? 0 : smoothEnergy);
      gpu.uniform1f(u.bloom, bloom);
      gpu.uniform1f(u.zone, zone);
      gpu.uniform1f(u.sway, motion?.matches || !s.beat?.active ? 0 : beatSway * bloom);
      gpu.uniform1f(u.downbeat, s.beat?.index === 0 ? 1 : 0);
      gpu.uniform1f(u.morph, morphAmount);
      gpu.uniform1f(u.hasTexA, hasTexA ? 1 : 0);
      gpu.uniform1f(u.hasTexB, hasTexB ? 1 : 0);
      gpu.uniform2f(u.morphSeed, morphSeed[0], morphSeed[1]);
      gpu.uniform2f(u.notePos, smoothNoteX, smoothNoteY);
      gpu.uniform1f(u.noteWarmth, smoothNoteWarmth);
      gpu.uniform1f(u.noteHue, smoothNoteHue);
      gpu.uniform4fv(u.swells, swellBuf);
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

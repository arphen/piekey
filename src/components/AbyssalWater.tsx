import { useEffect, useRef, useState } from "react";
import swirlUrl from "../assets/pond-swirl.webp";
import abyssUrl from "../assets/pond-abyss.webp";
import currentUrl from "../assets/pond-current.webp";
import bloomUrl from "../assets/pond-bloom.webp";
import neonUrl from "../assets/pond-neon.webp";

export type WaterScene = "home" | "library" | "song" | "progress";

interface SceneConfig {
  panX: number; // horizontal station along the continuous algae lagoon strip
  primary: string;
  secondary: string;
  abyssRgb: [number, number, number]; // deep dark-blue water base
  glowRgb: [number, number, number]; // primary bioluminescent chlorophyll hue
  flareRgb: [number, number, number]; // violent interaction surge hue
  calmCenter: number; // how much to soften the center for text/score legibility
}

const SCENES: Record<WaterScene, SceneConfig> = {
  home: {
    panX: 0.0,
    primary: swirlUrl,
    secondary: abyssUrl,
    abyssRgb: [0.008, 0.024, 0.052], // nocturnal harbor deep navy
    glowRgb: [0.18, 0.88, 0.48],
    flareRgb: [0.54, 1.0, 0.34],
    calmCenter: 0.56,
  },
  library: {
    panX: 1.05,
    primary: abyssUrl,
    secondary: currentUrl,
    abyssRgb: [0.008, 0.024, 0.062], // abyssal Prussian dark blue
    glowRgb: [0.12, 0.86, 0.64], // bioluminescent cyan-emerald
    flareRgb: [0.24, 0.98, 0.92], // violent electric aqua surge
    calmCenter: 0.58,
  },
  song: {
    panX: 1.55,
    primary: currentUrl,
    secondary: abyssUrl,
    abyssRgb: [0.007, 0.021, 0.054],
    glowRgb: [0.16, 0.84, 0.58],
    flareRgb: [0.62, 0.98, 0.38],
    calmCenter: 0.68,
  },
  progress: {
    panX: 2.25,
    primary: bloomUrl,
    secondary: neonUrl,
    abyssRgb: [0.009, 0.022, 0.060], // deep abyssal indigo-blue
    glowRgb: [0.24, 0.92, 0.38], // poisonous bioluminescent emerald-lime
    flareRgb: [0.92, 0.84, 0.32], // violent chartreuse-gold flare
    calmCenter: 0.56,
  },
};

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// Continuously deforming abyssal dark-blue water with bioluminescent algae.
// Glides horizontally across a multi-photograph lagoon strip on tab transitions,
// swirls around live pointer wakes, and flares violently on clicks and surges.
const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float panX;
uniform float panVel;
uniform float scrollY;
uniform float scrollVel;
uniform float morph;
uniform float hasTexA;
uniform float hasTexB;
uniform vec3 abyssColor;
uniform vec3 glowColor;
uniform vec3 flareColor;
uniform float calmCenter;
uniform float surge;
uniform vec2 wake0;
uniform vec2 wake1;
uniform vec2 wake2;
uniform vec2 wake3;
uniform vec4 wakeSpin;
uniform vec4 wakeEnergy;
uniform vec2 burstPos;
uniform float burstAge;
uniform float burstPower;
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
    p = rot * p * 2.03 + vec2(3.7, 2.3);
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
  vec2 q = p * vec2(0.38, 0.50) + vec2(0.5, 0.5);
  return abs(mod(q + 1.0, 2.0) - 1.0);
}

float algaeHeight(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return luma + 1.25 * max(0.0, c.g - max(c.r * 0.9, c.b));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  float t = time;
  float speed = abs(panVel);
  float agitation = clamp(surge + speed * 0.65 + abs(scrollVel) * 0.45 + burstPower * exp(-burstAge * 1.4), 0.0, 2.2);

  // Slow stagnant-harbor drift + horizontal lagoon pan + vertical scroll drag.
  vec2 drift = vec2(
    panX * 0.62 + sin(t * 0.041) * 0.12 + t * 0.007,
    -scrollY * 0.24 + cos(t * 0.033) * 0.09 - t * 0.004
  );

  // Ambient counter-rotating harbor eddies that twist harder during transitions & interactions.
  vec2 c1 = vec2(sin(t * 0.072) * 0.46, cos(t * 0.058) * 0.30);
  vec2 c2 = vec2(cos(t * 0.054 + 2.2) * 0.52, sin(t * 0.068 + 1.1) * 0.34);
  vec2 c3 = vec2(sin(t * 0.048 + 4.1) * 0.32, cos(t * 0.082 + 3.0) * 0.28);

  float shear = panVel * 0.26 * sin(p.y * 3.4 + t * 0.8);
  vec2 swirl = vec2(shear, scrollVel * 0.14 * cos(p.x * 3.0));
  float vigor = 1.0 + agitation * 0.75;
  swirl += spiralEddy(p, c1, 0.62, (0.38 + 0.28 * sin(t * 0.11)) * vigor);
  swirl += spiralEddy(p, c2, 0.54, (-0.34 + 0.24 * cos(t * 0.09)) * vigor);
  swirl += spiralEddy(p, c3, 0.44, (0.28 * sin(t * 0.14 + 1.5)) * vigor);

  // 4-node viscous pointer wake: swirling algae left and right along the user's movement.
  swirl += spiralEddy(p, wake0, 0.28, wakeSpin.x * 1.45);
  swirl += spiralEddy(p, wake1, 0.34, wakeSpin.y * 1.15);
  swirl += spiralEddy(p, wake2, 0.40, wakeSpin.z * 0.85);
  swirl += spiralEddy(p, wake3, 0.46, wakeSpin.w * 0.60);

  // Violent localized click/interaction shock-vortex & expanding ring ripple.
  float burstDecay = burstPower * exp(-burstAge * 1.35);
  float distB = length(p - burstPos);
  float ringRadius = burstAge * 0.58;
  float ringWave = exp(-pow((distB - ringRadius) / 0.095, 2.0)) * burstDecay;
  swirl += spiralEddy(p, burstPos, 0.38, burstDecay * 2.15 * sin(burstAge * 4.5 + 1.1));
  swirl += normalize(p - burstPos + vec2(0.0001)) * ringWave * 0.075;

  // Curl of low-frequency noise stretches organic algae filaments across the abyss.
  vec2 q = p * 1.5 + drift * 0.55;
  float f0 = fbm(q + vec2(t * 0.022, -t * 0.017));
  float fx = fbm(q + vec2(0.06 + t * 0.022, -t * 0.017));
  float fy = fbm(q + vec2(t * 0.022, 0.06 - t * 0.017));
  vec2 curl = vec2(fy - f0, -(fx - f0)) * (0.48 + agitation * 0.52);

  vec2 coord = p + drift + swirl * 0.46 + curl * 0.18;

  vec3 raw = abyssColor;
  if (hasTexA > 0.5) {
    float waveMorph = clamp(morph + 0.18 * sin(t * 0.09 + f0 * 3.0) * (1.0 - step(0.99, morph)), 0.0, 1.0);
    float front = clamp(waveMorph * 1.55 - fbm(p * 1.45 + vec2(panX * 0.7, 0.31)) * 0.55, 0.0, 1.0);
    vec2 mCurl = curl * 0.24;
    vec3 colA = texture2D(texA, photoUv(coord + mCurl * front)).rgb;
    if (hasTexB > 0.5 && front > 0.002) {
      vec3 colB = texture2D(texB, photoUv(coord - mCurl * (1.0 - front))).rgb;
      float k = (2.0 * front - 1.0) * 1.3 + (algaeHeight(colB) - algaeHeight(colA)) * 1.1 * 4.0 * front * (1.0 - front);
      raw = mix(colA, colB, smoothstep(-0.18, 0.18, k));
    } else {
      raw = colA;
    }
  } else {
    float w = smoothstep(0.32, 0.78, f0);
    raw = mix(abyssColor, glowColor * 0.35, w * 0.55);
  }

  // Isolate bright algae veins and thick floating mats from darker water channels.
  float luma = dot(raw, vec3(0.2126, 0.7152, 0.0722));
  float greenness = max(0.0, raw.g - max(raw.r * 0.90, raw.b * 0.95));
  float matMask = smoothstep(0.04, 0.19, greenness) * smoothstep(0.18, 0.55, luma);
  float veinMask = smoothstep(0.11, 0.27, greenness) * smoothstep(0.32, 0.68, luma);

  // Nocturnal abyssal dark-blue water: deep Prussian/midnight-blue currents with dark-teal submerged mats.
  vec3 deepOcean = abyssColor * (0.75 + 0.75 * smoothstep(0.12, 0.82, f0));
  vec3 waterSheen = vec3(0.012, 0.046, 0.105) * smoothstep(0.35, 0.85, f0) * (0.55 + 0.45 * sin(t * 0.25 + p.x * 2.0));
  vec3 baseWater = deepOcean + waterSheen;

  // Sculpt the real algae photograph into dark, nocturnal floating emerald mats (never bright daylight green).
  vec3 darkMat = mix(
    vec3(0.012, 0.052, 0.076),
    vec3(0.048, 0.195, 0.145),
    smoothstep(0.15, 0.72, luma)
  );
  // Blend subtle photographic micro-texture into the dark mats so real organic ripples stay tactile.
  vec3 photoDetail = pow(max(raw, 0.0), vec3(2.35)) * vec3(0.42, 0.68, 0.58);
  vec3 algaeBody = mix(darkMat, photoDetail, 0.55);

  // Calm center lens keeps UI headers & text razor-sharp while framing edges in rich swirling algae.
  float centerDist = length((uv - vec2(0.5, 0.48)) * vec2(1.06, 0.96));
  float rim = smoothstep(0.14, 0.88, centerDist);
  float matVis = mix(0.22 * (1.0 - calmCenter * 0.45), 0.64, rim);
  vec3 color = mix(baseWater, algaeBody, clamp(matMask * matVis, 0.0, 0.72));

  // Bioluminescence Layer 1: slow "stinking" anaerobic ambient pulse on the thickest algae veins.
  float breath = 0.5 + 0.5 * sin(t * 0.52 + f0 * 6.2831 + p.x * 1.6);
  float stenchGlow = veinMask * (0.12 + 0.18 * breath) * (0.40 + 0.78 * rim);
  color += glowColor * stenchGlow;

  // Bioluminescence Layer 2: viscous pointer wake — parts the dark water and lights up algae along the trail.
  float wakeLight =
    exp(-dot(p - wake0, p - wake0) / 0.048) * wakeEnergy.x +
    exp(-dot(p - wake1, p - wake1) / 0.078) * wakeEnergy.y * 0.78 +
    exp(-dot(p - wake2, p - wake2) / 0.112) * wakeEnergy.z * 0.52 +
    exp(-dot(p - wake3, p - wake3) / 0.150) * wakeEnergy.w * 0.30;
  color += mix(glowColor, flareColor, 0.48) * (0.18 + 1.45 * matMask + 0.9 * veinMask) * wakeLight * 0.52;

  // Bioluminescence Layer 3: violent click shockwave + expanding bioluminescent ring.
  float burstCore = exp(-distB * distB / 0.095) * burstDecay;
  float burstLight = (burstCore * 0.95 + ringWave * 1.25) * (0.24 + 1.55 * matMask);
  color += mix(glowColor, flareColor, 0.72) * burstLight * 0.82;

  // Directional transition wash: sweeps glowing emerald-cyan currents across the abyss on tab switches.
  float sweepGlow = (surge * 0.44 + speed * 0.32 + abs(scrollVel) * 0.16) * (0.16 + 1.35 * matMask);
  color += mix(glowColor, flareColor, clamp(surge, 0.0, 1.0) * 0.58) * sweepGlow * (0.42 + 0.68 * rim);

  // Subtle dark-blue vignette + filmic highlight knee so violent flares glow like real bioluminescence.
  float vig = smoothstep(1.32, 0.22, centerDist);
  color *= mix(0.62, 1.02, vig);
  vec3 over = max(color - 0.48, 0.0);
  color = min(color, 0.48) + over / (1.0 + over / 0.34);

  // Subtle dither against dark-blue banding.
  float dither = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(max(color + dither, 0.0), 1.0);
}
`;

function makeTexture(gl: WebGLRenderingContext): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([4, 10, 20, 255]));
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function AbyssalWater({ scene, suspended = false }: { scene: WaterScene; suspended?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WaterScene>(scene);
  const suspendedRef = useRef(suspended);
  const wakeRef = useRef<() => void>(() => undefined);
  const transitionRef = useRef<((next: WaterScene) => void) | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    suspendedRef.current = suspended;
    if (!suspended) wakeRef.current();
  }, [suspended]);

  useEffect(() => {
    if (sceneRef.current !== scene) {
      sceneRef.current = scene;
      transitionRef.current?.(scene);
      wakeRef.current();
    }
  }, [scene]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let gl: WebGLRenderingContext | null = null;
    if (typeof WebGLRenderingContext !== "undefined") {
      try {
        gl = el.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          powerPreference: "low-power",
          preserveDrawingBuffer: false,
        });
      } catch {
        gl = null;
      }
    }
    if (!gl) {
      setFallback(true);
      return;
    }
    const gpu = gl;

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
      if (texA) gpu.deleteTexture(texA);
      if (texB) gpu.deleteTexture(texB);
      gpu.deleteBuffer(buffer);
      if (program) gpu.deleteProgram(program);
      shaders.forEach((s) => gpu.deleteShader(s));
    };
    if (!vertex || !fragment || !program || !buffer || !texA || !texB) {
      release();
      setFallback(true);
      return;
    }

    gpu.attachShader(program, vertex);
    gpu.attachShader(program, fragment);
    gpu.linkProgram(program);
    if (!gpu.getProgramParameter(program, gpu.LINK_STATUS)) {
      release();
      setFallback(true);
      return;
    }
    gpu.useProgram(program);
    gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
    gpu.bufferData(gpu.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gpu.STATIC_DRAW);
    const position = gpu.getAttribLocation(program, "position");
    gpu.enableVertexAttribArray(position);
    gpu.vertexAttribPointer(position, 2, gpu.FLOAT, false, 0, 0);

    const names = [
      "resolution", "time", "panX", "panVel", "scrollY", "scrollVel",
      "morph", "hasTexA", "hasTexB", "abyssColor", "glowColor", "flareColor",
      "calmCenter", "surge", "wake0", "wake1", "wake2", "wake3",
      "wakeSpin", "wakeEnergy", "burstPos", "burstAge", "burstPower", "texA", "texB",
    ];
    const u = Object.fromEntries(names.map((name) => [name, gpu.getUniformLocation(program, name)]));
    gpu.uniform1i(u.texA, 0);
    gpu.uniform1i(u.texB, 1);

    let disposed = false;
    let failed = false;
    let frame = 0;
    let previous = 0;
    let elapsed = 0;
    let changedSize = true;
    let painted = false;
    let lastInteraction = performance.now();

    const initCfg = SCENES[sceneRef.current];
    let curPanX = initCfg.panX;
    let panVel = 0;
    let curAbyss: [number, number, number] = [...initCfg.abyssRgb];
    let curGlow: [number, number, number] = [...initCfg.glowRgb];
    let curFlare: [number, number, number] = [...initCfg.flareRgb];
    let curCalm = initCfg.calmCenter;
    let surge = 0.28;
    let curScrollY = typeof window !== "undefined" ? window.scrollY / 900 : 0;
    let scrollVel = 0;

    // 4-node trailing pointer wake in normalized aspect space
    const wakes = Array.from({ length: 4 }, () => ({ x: 9, y: 9, spin: 0, energy: 0 }));
    let lastPtr = { x: 0, y: 0, at: 0 };
    let burst = { x: 0, y: 0, age: 10, power: 0 };

    // Texture cache and smooth cross-morph on scene changes
    const imgCache = new Map<string, HTMLImageElement>();
    let texAUrl = "";
    let texBUrl = "";
    let hasTexA = false;
    let hasTexB = false;
    let morph = 0;
    let targetMorph = 0.25;

    const upload = (slot: number, tex: WebGLTexture, img: HTMLImageElement) => {
      if (disposed || gpu.isContextLost()) return;
      gpu.activeTexture(gpu.TEXTURE0 + slot);
      gpu.bindTexture(gpu.TEXTURE_2D, tex);
      gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, gpu.RGBA, gpu.UNSIGNED_BYTE, img);
    };

    const ensureImg = (url: string, onReady: (img: HTMLImageElement) => void) => {
      const cached = imgCache.get(url);
      if (cached) {
        onReady(cached);
        return;
      }
      void loadImg(url).then((img) => {
        if (disposed) return;
        imgCache.set(url, img);
        onReady(img);
      }).catch(() => undefined);
    };

    const applySceneTextures = (next: WaterScene, immediate: boolean) => {
      const cfg = SCENES[next];
      if (!immediate) {
        surge = Math.min(1.5, surge + 0.95);
        lastInteraction = performance.now();
      }
      ensureImg(cfg.primary, (imgA) => {
        if (sceneRef.current !== next) return;
        if (texAUrl !== cfg.primary) {
          upload(0, texA, imgA);
          texAUrl = cfg.primary;
          hasTexA = true;
          if (!immediate) morph = 0.1;
        }
        start();
      });
      ensureImg(cfg.secondary, (imgB) => {
        if (sceneRef.current !== next) return;
        if (texBUrl !== cfg.secondary) {
          upload(1, texB, imgB);
          texBUrl = cfg.secondary;
          hasTexB = true;
          targetMorph = 0.34;
        }
        start();
      });
    };

    const toAspectPos = (clientX: number, clientY: number): [number, number] => {
      const w = Math.max(window.innerWidth, 1);
      const h = Math.max(window.innerHeight, 1);
      const aspect = w / h;
      const nx = (clientX / w - 0.5) * aspect;
      const ny = -(clientY / h - 0.5);
      return [nx, ny];
    };

    const onPointerMove = (event: PointerEvent) => {
      if (suspendedRef.current) return;
      const now = performance.now();
      const [x, y] = toAspectPos(event.clientX, event.clientY);
      const dx = x - lastPtr.x;
      const dy = y - lastPtr.y;
      const dt = Math.max(8, now - lastPtr.at);
      const dist = Math.hypot(dx, dy);
      if (dist < 0.004 && now - lastPtr.at < 45) return;
      const vel = Math.min(2.4, (dist / (dt / 1000)) * 0.55);
      const sign = dx * 0.8 - dy * 0.5 >= 0 ? 1 : -1;
      for (let i = wakes.length - 1; i > 0; i--) {
        wakes[i] = { ...wakes[i - 1] };
      }
      wakes[0] = { x, y, spin: sign * (0.42 + vel * 0.85), energy: Math.min(1.4, 0.26 + vel * 0.68) };
      lastPtr = { x, y, at: now };
      lastInteraction = now;
      start();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (suspendedRef.current) return;
      const [x, y] = toAspectPos(event.clientX, event.clientY);
      burst = { x, y, age: 0, power: 1.25 };
      surge = Math.min(1.4, surge + 0.35);
      lastInteraction = performance.now();
      start();
    };

    const onScroll = () => {
      if (suspendedRef.current) return;
      const nextScroll = window.scrollY / Math.max(window.innerHeight, 600);
      const delta = nextScroll - curScrollY;
      scrollVel = Math.max(-2.2, Math.min(2.2, scrollVel + delta * 3.8));
      curScrollY = nextScroll;
      lastInteraction = performance.now();
      start();
    };

    const onKeyDown = () => {
      if (suspendedRef.current) return;
      surge = Math.min(1.1, surge + 0.14);
      lastInteraction = performance.now();
      start();
    };

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const paint = (now: number) => {
      frame = 0;
      if (disposed || failed || document.hidden || gpu.isContextLost() || suspendedRef.current) return;
      if (document.querySelector(".ss:not(.is-parked)")) return;
      const moving = !motion?.matches;
      const active = now - lastInteraction < 2800 || surge > 0.04 || Math.abs(panVel) > 0.015 || burst.age < 2.2;
      const targetFps = active ? 30 : 15;
      if (moving && previous && now - previous < 1000 / targetFps) {
        frame = requestAnimationFrame(paint);
        return;
      }
      const dtMs = previous ? Math.min(100, now - previous) : 33;
      const dt = dtMs / 1000;
      previous = now;
      if (moving) elapsed += dt;

      if (changedSize) {
        const rect = el.getBoundingClientRect();
        const longEdge = Math.max(rect.width, rect.height, 1);
        const scale = Math.min(0.62, 920 / longEdge);
        el.width = Math.max(1, Math.round(rect.width * scale));
        el.height = Math.max(1, Math.round(rect.height * scale));
        gpu.viewport(0, 0, el.width, el.height);
        changedSize = false;
      }

      const cfg = SCENES[sceneRef.current];
      const spring = 1 - Math.exp(-dt * 4.4);
      const nextPan = lerp(curPanX, cfg.panX, spring);
      const instantVel = (nextPan - curPanX) / Math.max(dt, 0.016);
      panVel = lerp(panVel, instantVel, 1 - Math.exp(-dt * 10));
      curPanX = nextPan;

      const colorEase = 1 - Math.exp(-dt * 2.6);
      for (let i = 0; i < 3; i++) {
        curAbyss[i] = lerp(curAbyss[i], cfg.abyssRgb[i], colorEase);
        curGlow[i] = lerp(curGlow[i], cfg.glowRgb[i], colorEase);
        curFlare[i] = lerp(curFlare[i], cfg.flareRgb[i], colorEase);
      }
      curCalm = lerp(curCalm, cfg.calmCenter, colorEase);

      surge *= Math.exp(-dt * 1.45);
      scrollVel *= Math.exp(-dt * 4.2);
      burst.age += dt;
      morph = lerp(morph, targetMorph + Math.sin(elapsed * 0.12) * 0.22, 1 - Math.exp(-dt * 0.9));

      for (const w of wakes) {
        w.energy *= Math.exp(-dt * 1.85);
        w.spin *= Math.exp(-dt * 1.35);
      }

      gpu.activeTexture(gpu.TEXTURE0);
      gpu.bindTexture(gpu.TEXTURE_2D, texA);
      gpu.activeTexture(gpu.TEXTURE1);
      gpu.bindTexture(gpu.TEXTURE_2D, texB);
      gpu.uniform2f(u.resolution, el.width, el.height);
      gpu.uniform1f(u.time, elapsed);
      gpu.uniform1f(u.panX, curPanX);
      gpu.uniform1f(u.panVel, moving ? panVel : 0);
      gpu.uniform1f(u.scrollY, curScrollY);
      gpu.uniform1f(u.scrollVel, moving ? scrollVel : 0);
      gpu.uniform1f(u.morph, Math.max(0, Math.min(1, morph)));
      gpu.uniform1f(u.hasTexA, hasTexA ? 1 : 0);
      gpu.uniform1f(u.hasTexB, hasTexB ? 1 : 0);
      gpu.uniform3f(u.abyssColor, curAbyss[0], curAbyss[1], curAbyss[2]);
      gpu.uniform3f(u.glowColor, curGlow[0], curGlow[1], curGlow[2]);
      gpu.uniform3f(u.flareColor, curFlare[0], curFlare[1], curFlare[2]);
      gpu.uniform1f(u.calmCenter, curCalm);
      gpu.uniform1f(u.surge, moving ? surge : 0);
      gpu.uniform2f(u.wake0, wakes[0].x, wakes[0].y);
      gpu.uniform2f(u.wake1, wakes[1].x, wakes[1].y);
      gpu.uniform2f(u.wake2, wakes[2].x, wakes[2].y);
      gpu.uniform2f(u.wake3, wakes[3].x, wakes[3].y);
      gpu.uniform4f(u.wakeSpin, wakes[0].spin, wakes[1].spin, wakes[2].spin, wakes[3].spin);
      gpu.uniform4f(u.wakeEnergy, wakes[0].energy, wakes[1].energy, wakes[2].energy, wakes[3].energy);
      gpu.uniform2f(u.burstPos, burst.x, burst.y);
      gpu.uniform1f(u.burstAge, burst.age);
      gpu.uniform1f(u.burstPower, moving ? burst.power : 0);
      gpu.drawArrays(gpu.TRIANGLES, 0, 6);
      painted = true;

      if (moving) frame = requestAnimationFrame(paint);
    };

    const start = () => {
      if (motion?.matches && painted && !changedSize) return;
      if (!disposed && !failed && !document.hidden && !suspendedRef.current && !frame) {
        previous = 0;
        frame = requestAnimationFrame(paint);
      }
    };

    wakeRef.current = start;
    transitionRef.current = (next) => applySceneTextures(next, false);
    applySceneTextures(sceneRef.current, true);

    const resized = () => { changedSize = true; start(); };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resized);
    resize?.observe(el);
    if (!resize) window.addEventListener("resize", resized);
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; previous = 0; }
      else start();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      failed = true;
      cancelAnimationFrame(frame);
      frame = 0;
      setFallback(true);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKeyDown, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    motion?.addEventListener("change", start);
    el.addEventListener("webglcontextlost", lost);

    start();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      wakeRef.current = () => undefined;
      transitionRef.current = null;
      resize?.disconnect();
      if (!resize) window.removeEventListener("resize", resized);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", visibility);
      motion?.removeEventListener("change", start);
      el.removeEventListener("webglcontextlost", lost);
      release();
    };
  }, []);

  if (fallback) {
    return <div className={`abyssal-water-fallback is-${scene}`} aria-hidden="true" />;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`abyssal-water is-${scene} ${suspended ? "is-suspended" : ""}`}
      aria-hidden="true"
    />
  );
}

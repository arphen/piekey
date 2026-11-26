import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import swirlUrl from "../assets/pond-swirl.webp";
import abyssUrl from "../assets/pond-abyss.webp";
import currentUrl from "../assets/pond-current.webp";
import bloomUrl from "../assets/pond-bloom.webp";
import neonUrl from "../assets/pond-neon.webp";

export type WaterScene =
  | "home"
  | "library"
  | "song"
  | "progress"
  | "practice"
  | "free"
  | "tuner"
  | "metronome";

/** Decorative playing state published by PracticeAtmosphere so AbyssalWater arouses smoothly with playing. */
export interface WaterDrive {
  playing: boolean;
  level: number;
  heardAt: number;
  flow: number;
  hitSerial: number;
  noteX: number;
  noteY: number;
  noteHue: number;
  noteAt: number;
  beatSerial: number;
  beatIndex: number;
  beatActive: boolean;
  beatCounting: boolean;
  decay?: number;
  missSerial?: number;
}

const waterDrives: { current: WaterDrive }[] = [];
const waterDriveWakers = new Set<() => void>();
const liveListeners = new Set<() => void>();
const notifyLive = () => { liveListeners.forEach((fn) => fn()); };

/** Registers the active decorative driver (last mounted wins; nested tools cleanly push/pop). */
export function publishWaterDrive(drive: { current: WaterDrive }): () => void {
  waterDrives.push(drive);
  waterDriveWakers.forEach((fn) => fn());
  return () => {
    const i = waterDrives.lastIndexOf(drive);
    if (i >= 0) waterDrives.splice(i, 1);
    waterDriveWakers.forEach((fn) => fn());
  };
}

/** Wakes AbyssalWater when new decorative playing input, hits, or beats arrive. */
export function wakeWaterDrive(): void {
  waterDriveWakers.forEach((fn) => fn());
}

/** True while AbyssalWater's live WebGL canvas is mounted, so rooms avoid running a duplicate WebGL water pass. */
export function hasLiveAbyssalWater(): boolean {
  return waterDriveWakers.size > 0;
}

const subscribeLive = (listener: () => void) => {
  liveListeners.add(listener);
  return () => { liveListeners.delete(listener); };
};

/** Reactive subscription to whether AbyssalWater's shared WebGL canvas is live. */
export function useLiveAbyssalWater(): boolean {
  return useSyncExternalStore(subscribeLive, hasLiveAbyssalWater, hasLiveAbyssalWater);
}

const activeWaterDrive = (): WaterDrive | null =>
  waterDrives.length ? waterDrives[waterDrives.length - 1].current : null;

interface SceneConfig {
  panX: number; // horizontal station along the continuous algae lagoon strip
  primary: string;
  secondary: string;
  abyssRgb: [number, number, number]; // deep dark-blue water base
  glowRgb: [number, number, number]; // primary bioluminescent chlorophyll hue
  flareRgb: [number, number, number]; // violent interaction surge hue
  calmCenter: number; // how much to soften the center for text/score legibility
  vortex: number; // centered spiral vortex pull (strongest behind Home's circle-of-fifths tree)
}

const SCENES: Record<WaterScene, SceneConfig> = {
  home: {
    panX: 0.0,
    primary: swirlUrl,
    secondary: abyssUrl,
    abyssRgb: [0.008, 0.025, 0.058], // nocturnal harbor deep navy
    glowRgb: [0.22, 0.94, 0.46],
    flareRgb: [0.58, 1.0, 0.34],
    calmCenter: 0.14,
    vortex: 1.0,
  },
  library: {
    panX: 1.05,
    primary: abyssUrl,
    secondary: currentUrl,
    abyssRgb: [0.008, 0.024, 0.062], // abyssal Prussian dark blue
    glowRgb: [0.12, 0.86, 0.64], // bioluminescent cyan-emerald
    flareRgb: [0.24, 0.98, 0.92], // violent electric aqua surge
    calmCenter: 0.46,
    vortex: 0.28,
  },
  song: {
    panX: 1.55,
    primary: currentUrl,
    secondary: abyssUrl,
    abyssRgb: [0.007, 0.021, 0.054],
    glowRgb: [0.16, 0.84, 0.58],
    flareRgb: [0.62, 0.98, 0.38],
    calmCenter: 0.62,
    vortex: 0.16,
  },
  progress: {
    panX: 2.25,
    primary: bloomUrl,
    secondary: neonUrl,
    abyssRgb: [0.009, 0.022, 0.060], // deep abyssal indigo-blue
    glowRgb: [0.24, 0.92, 0.38], // poisonous bioluminescent emerald-lime
    flareRgb: [0.92, 0.84, 0.32], // violent chartreuse-gold flare
    calmCenter: 0.44,
    vortex: 0.25,
  },
  practice: {
    panX: 3.15,
    primary: currentUrl,
    secondary: bloomUrl,
    abyssRgb: [0.007, 0.024, 0.064], // deep nocturnal harbor sapphire
    glowRgb: [0.20, 0.94, 0.50], // luminous chlorophyll-emerald
    flareRgb: [0.54, 1.0, 0.42], // bright bioluminescent lime-aqua surge
    calmCenter: 0.48,
    vortex: 0.24,
  },
  free: {
    panX: 3.95,
    primary: swirlUrl,
    secondary: neonUrl,
    abyssRgb: [0.007, 0.025, 0.068], // deep midnight pelagic blue
    glowRgb: [0.14, 0.92, 0.72], // electric bioluminescent cyan-jade
    flareRgb: [0.34, 1.0, 0.88], // vivid aqua surge
    calmCenter: 0.40,
    vortex: 0.34,
  },
  tuner: {
    panX: 4.70,
    primary: abyssUrl,
    secondary: neonUrl,
    abyssRgb: [0.007, 0.023, 0.068], // deep oceanic cobalt-navy
    glowRgb: [0.18, 0.96, 0.56], // glowing emerald-mint lock hue
    flareRgb: [0.62, 1.0, 0.36], // chartreuse in-tune flare
    calmCenter: 0.36,
    vortex: 0.46,
  },
  metronome: {
    panX: 5.45,
    primary: bloomUrl,
    secondary: currentUrl,
    abyssRgb: [0.008, 0.022, 0.064], // deep abyssal indigo-navy
    glowRgb: [0.16, 0.88, 0.64], // bioluminescent seafoam-emerald
    flareRgb: [0.92, 0.82, 0.36], // warm downbeat gold flare
    calmCenter: 0.36,
    vortex: 0.38,
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
uniform float vortex;
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
uniform float playEnergy;
uniform float bloom;
uniform float zone;
uniform float decay;
uniform float miss;
uniform float sway;
uniform float downbeat;
uniform vec2 notePos;
uniform float noteWarmth;
uniform float noteHue;
uniform vec4 swells[3]; // xy origin, z age (s), w strength: delayed far-away propeller swells
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
  float agitation = clamp(
    surge * 0.42 + speed * 0.24 + abs(scrollVel) * 0.16 + burstPower * exp(-burstAge * 1.1) * 0.35,
    0.0,
    0.85
  );

  // Slow stagnant-harbor drift + horizontal lagoon pan + vertical scroll drag.
  vec2 drift = vec2(
    panX * 0.56 + sin(t * 0.032) * 0.10 + t * 0.005,
    -scrollY * 0.18 + cos(t * 0.026) * 0.08 - t * 0.003
  );

  // Ambient counter-rotating harbor eddies: serene at rest, waking slowly like an old engine in the zone.
  vec2 c1 = vec2(sin(t * 0.055) * 0.46, cos(t * 0.044) * 0.30);
  vec2 c2 = vec2(cos(t * 0.042 + 2.2) * 0.52, sin(t * 0.052 + 1.1) * 0.34);
  vec2 c3 = vec2(sin(t * 0.038 + 4.1) * 0.32, cos(t * 0.062 + 3.0) * 0.28);

  float shear = panVel * 0.11 * sin(p.y * 2.8 + t * 0.5);
  vec2 swirl = vec2(shear, scrollVel * 0.05 * cos(p.x * 2.6));
  float vigor = 1.0 + agitation * 0.28 + bloom * 0.52 + zone * 0.46 + playEnergy * 0.08;
  // Concentric central vortex wrapping the Home circle-of-fifths tree in flowing algae tendrils.
  // Beats never twist or jerk the eddies; currents only deepen smoothly as the engine warms up.
  swirl += spiralEddy(p, vec2(0.0, 0.0), 0.82, (0.68 + 0.16 * sin(t * 0.11)) * vortex * (1.0 + agitation * 0.16));
  swirl += spiralEddy(p, c1, 0.62, (0.34 + 0.18 * sin(t * 0.09)) * vigor);
  swirl += spiralEddy(p, c2, 0.54, (-0.30 + 0.16 * cos(t * 0.07)) * vigor);
  swirl += spiralEddy(p, c3, 0.44, (0.24 * sin(t * 0.11 + 1.5)) * vigor);
  // Softly drifting harmonic eddy that glides smoothly without sign flips.
  swirl += spiralEddy(p, notePos, 0.48, (noteHue * 2.0 - 1.0) * noteWarmth * (0.10 + 0.28 * bloom));

  // Delayed far-away propeller swells gliding slowly across the harbor as notes land cleanly.
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

  // 4-node viscous pointer wake: silky, weighted swirl trailing smoothly behind the cursor.
  swirl += spiralEddy(p, wake0, 0.30, wakeSpin.x * 0.36);
  swirl += spiralEddy(p, wake1, 0.36, wakeSpin.y * 0.28);
  swirl += spiralEddy(p, wake2, 0.42, wakeSpin.z * 0.20);
  swirl += spiralEddy(p, wake3, 0.48, wakeSpin.w * 0.13);

  // Calm click stone-drop: smooth attack envelope (zero 1-frame flash) + single expanding ripple.
  float burstEnv = smoothstep(0.0, 0.28, burstAge) * exp(-burstAge * 1.15);
  float burstDecay = burstPower * burstEnv;
  float distB = length(p - burstPos);
  float ringRadius = burstAge * 0.30;
  float ringWave = exp(-pow((distB - ringRadius) / 0.12, 2.0)) * burstDecay;
  swirl += spiralEddy(p, burstPos, 0.36, burstDecay * 0.32);
  swirl += normalize(p - burstPos + vec2(0.0001)) * ringWave * 0.018;

  // Curl of low-frequency noise stretches organic algae filaments across the abyss.
  vec2 q = p * 1.5 + drift * 0.55;
  float f0 = fbm(q + vec2(t * 0.017, -t * 0.013));
  float fx = fbm(q + vec2(0.06 + t * 0.017, -t * 0.013));
  float fy = fbm(q + vec2(t * 0.017, 0.06 - t * 0.013));
  vec2 curl = vec2(fy - f0, -(fx - f0)) * (0.42 + agitation * 0.22 + bloom * 0.28 + zone * 0.22);

  vec2 coord = p + drift + swirl * 0.44 + curl * 0.16 + waveShift;

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
  vec3 deepOcean = abyssColor * (0.85 + 0.95 * smoothstep(0.08, 0.84, f0));
  vec3 waterSheen = vec3(0.010, 0.048, 0.135) * smoothstep(0.28, 0.86, f0) * (0.62 + 0.38 * sin(t * 0.25 + p.x * 2.0));
  vec3 baseWater = deepOcean + waterSheen;

  // Sculpt the real algae photograph into dark, nocturnal floating emerald mats over deep blue voids,
  // subtly shifting toward warm olive-ochre and umber as decay rises.
  float decayAmt = clamp(decay + miss * 0.45, 0.0, 1.0);
  vec3 coolMat = mix(
    vec3(0.008, 0.048, 0.105),
    vec3(0.036, 0.175, 0.145),
    smoothstep(0.16, 0.72, luma)
  );
  vec3 decayMat = mix(
    vec3(0.032, 0.024, 0.012),
    vec3(0.145, 0.092, 0.036),
    smoothstep(0.16, 0.72, luma)
  );
  vec3 darkMat = mix(coolMat, decayMat, clamp(decay * 0.72 + miss * 0.20, 0.0, 0.85));
  // Blend subtle photographic micro-texture into the dark mats; enriches organically as you enter the zone.
  vec3 photoTint = mix(vec3(0.36, 0.64, 0.68), vec3(0.72, 0.50, 0.24), clamp(decay * 0.78 + miss * 0.22, 0.0, 0.90));
  vec3 photoDetail = pow(max(raw, 0.0), vec3(2.45 - bloom * 0.28 - zone * 0.22)) * photoTint;
  vec3 algaeBody = mix(darkMat, photoDetail, 0.48 + bloom * 0.22 + zone * 0.20);

  // Calm center keeps text crisp; at rest algae hover gently, then creep inward to embrace the room in the zone.
  float centerDist = length((uv - vec2(0.5, 0.48)) * vec2(1.06, 0.96));
  float rim = smoothstep(mix(0.10, 0.02, zone), 0.86, centerDist);
  float matVis = mix(0.42 * (1.0 - calmCenter * (0.52 - zone * 0.26)) + bloom * 0.12 + zone * 0.18, 0.74 + bloom * 0.10 + zone * 0.12, rim);
  vec3 color = mix(baseWater, algaeBody, clamp(matMask * matVis, 0.0, 0.88));

  // Yellowing amber tension -> ochre-rust / warm umber decay palette, contrasting against emerald-teal bloom.
  vec3 amberWilt = vec3(0.72, 0.54, 0.18);
  vec3 umberRust = vec3(0.48, 0.26, 0.10);
  vec3 decayGlow = mix(amberWilt, umberRust, smoothstep(0.25, 0.90, decayAmt));

  // Bioluminescence Layer 1: slow languid ambient pulse on the thickest algae veins.
  float breath = 0.5 + 0.5 * sin(t * 0.36 + f0 * 6.2831 + p.x * 1.4);
  float stenchGlow = veinMask * (0.11 + 0.13 * breath) * (0.48 + 0.66 * rim);
  color += mix(glowColor, decayGlow, decayAmt * 0.68) * stenchGlow * (1.0 - decayAmt * 0.22);

  // Bioluminescence Layer 1b: earned zone embrace — distant calling early, lush emerald-gold radiance at peak performance.
  vec3 poisonNeon = mix(vec3(0.16, 0.88, 0.64), vec3(0.54, 1.0, 0.30), noteHue);
  vec3 liveNeon = mix(poisonNeon, decayGlow, decayAmt * 0.72);
  vec3 birchGold = vec3(0.90, 0.78, 0.42);
  float noteNear = exp(-dot(p - notePos, p - notePos) / 0.24) * noteWarmth;
  float zoneGlow = bloom * 0.24 + zone * 0.96 + swellLight * (0.16 + 0.34 * bloom) + noteNear * (0.10 + 0.26 * zone);
  color += liveNeon * veinMask * raw.g * zoneGlow * (1.0 - decayAmt * 0.35) * (0.38 + 0.82 * rim);
  // Subtle organic amber-umber rim wash during decay, keeping center calm for foreground notation.
  color += decayGlow * (decay * 0.11 + miss * 0.09) * (0.14 + 0.86 * rim) * (0.35 + 0.65 * matMask);
  // Subtle golden warmth breathing softly in the deep zone on heard downbeats.
  vec3 tideColor = mix(liveNeon, birchGold, downbeat * 0.65);
  color += tideColor * veinMask * sway * zone * 0.26 * (0.35 + 0.65 * rim);

  // Bioluminescence Layer 2: subtle, silky pointer wake shimmer along the trailing eddies.
  float wakeLight =
    exp(-dot(p - wake0, p - wake0) / 0.065) * wakeEnergy.x +
    exp(-dot(p - wake1, p - wake1) / 0.095) * wakeEnergy.y * 0.72 +
    exp(-dot(p - wake2, p - wake2) / 0.130) * wakeEnergy.z * 0.46 +
    exp(-dot(p - wake3, p - wake3) / 0.170) * wakeEnergy.w * 0.24;
  color += mix(glowColor, flareColor, 0.32) * (0.14 + 1.05 * matMask + 0.65 * veinMask) * wakeLight * 0.20;

  // Bioluminescence Layer 3: understated click ripple & gentle bloom (no abrupt flash).
  float burstCore = exp(-distB * distB / 0.12) * burstDecay;
  float burstLight = (burstCore * 0.45 + ringWave * 0.75) * (0.18 + 0.95 * matMask);
  color += mix(glowColor, flareColor, 0.38) * burstLight * 0.20;

  // Directional transition wash: calm luminous current sweeping across the abyss on tab switches.
  float sweepGlow = (surge * 0.18 + speed * 0.14 + abs(scrollVel) * 0.06) * (0.14 + 1.05 * matMask);
  color += mix(glowColor, flareColor, clamp(surge, 0.0, 1.0) * 0.38) * sweepGlow * (0.40 + 0.60 * rim);

  // Subtle dark-blue vignette + filmic highlight knee so earned peak glow feels lush without clipping.
  float vig = smoothstep(1.32, 0.22, centerDist);
  color *= mix(0.62, 1.02, vig);
  float knee = mix(0.48, 0.60, zone);
  vec3 over = max(color - knee, 0.0);
  color = min(color, knee) + over / (1.0 + over / 0.36);

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
  const wakeRef = useRef<(gentleSurge?: boolean) => void>(() => undefined);
  const transitionRef = useRef<((next: WaterScene) => void) | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const wasSuspended = suspendedRef.current;
    suspendedRef.current = suspended;
    if (!suspended) wakeRef.current(wasSuspended);
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
          preserveDrawingBuffer: true,
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
      "calmCenter", "vortex", "surge", "wake0", "wake1", "wake2", "wake3",
      "wakeSpin", "wakeEnergy", "burstPos", "burstAge", "burstPower",
      "playEnergy", "bloom", "zone", "decay", "miss", "sway", "downbeat", "notePos", "noteWarmth", "noteHue", "swells",
      "texA", "texB",
    ];
    const u = Object.fromEntries(names.map((name) => [name, gpu.getUniformLocation(program, name)]));
    if (!u.swells) u.swells = gpu.getUniformLocation(program, "swells[0]");
    gpu.uniform1i(u.texA, 0);
    gpu.uniform1i(u.texB, 1);

    let disposed = false;
    let failed = false;
    let frame = 0;
    let previous = 0;
    let elapsed = 0;
    let changedSize = true;
    let painted = false;

    const initCfg = SCENES[sceneRef.current];
    let curPanX = initCfg.panX;
    let panVel = 0;
    let curAbyss: [number, number, number] = [...initCfg.abyssRgb];
    let curGlow: [number, number, number] = [...initCfg.glowRgb];
    let curFlare: [number, number, number] = [...initCfg.flareRgb];
    let curCalm = initCfg.calmCenter;
    let curVortex = initCfg.vortex;
    let surge = 0.12;
    let curScrollY = typeof window !== "undefined" ? window.scrollY / 900 : 0;
    let targetScrollY = curScrollY;
    let scrollVel = 0;

    // 4-node viscous spring-followed pointer wake in normalized aspect space (never snaps discretely)
    const wakes = Array.from({ length: 4 }, () => ({ x: 9, y: 9, spin: 0, energy: 0 }));
    let ptrTarget = { x: 9, y: 9, initialized: false };
    let ptrEnergyTarget = 0;
    let ptrSpinTarget = 0;
    let lastPtr = { x: 0, y: 0, at: 0 };
    let burst = { x: 0, y: 0, age: 10, power: 0 };

    // Heavy old-engine flywheel + delayed far-away propeller swells (decorative only).
    let engineMs = 0;
    let bloom = 0;
    let smoothDecay = 0;
    let missPulse = 0;
    let lastMissSerial = -1;
    let smoothEnergy = 0;
    let beatTarget = 0;
    let beatSway = 0;
    let beatDownbeat = 0;
    let lastBeatSerial = -1;
    let lastHitSerial = -1;
    let smoothNoteX = 0;
    let smoothNoteY = 0;
    let smoothNoteHue = 0.5;
    let smoothNoteWarmth = 0;
    let swellCounter = 0;
    const pendingSwells: { due: number; x: number; y: number; strength: number }[] = [];
    const activeSwells: { x: number; y: number; age: number; strength: number }[] = [];
    const swellBuf = new Float32Array(12);

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
        surge = Math.min(0.65, surge + 0.34);
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
      if (!ptrTarget.initialized) {
        ptrTarget = { x, y, initialized: true };
        for (const w of wakes) { w.x = x; w.y = y; }
        lastPtr = { x, y, at: now };
        return;
      }
      const dx = x - lastPtr.x;
      const dy = y - lastPtr.y;
      const dist = Math.hypot(dx, dy);
      ptrTarget.x = x;
      ptrTarget.y = y;
      // Smoothly accumulate gentle spin & energy proportional to pointer travel (no abrupt sign flips)
      ptrEnergyTarget = Math.min(0.75, ptrEnergyTarget + dist * 1.15);
      ptrSpinTarget = Math.max(-0.55, Math.min(0.55, ptrSpinTarget + (dx - dy * 0.55) * 0.9));
      lastPtr = { x, y, at: now };
      start();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (suspendedRef.current) return;
      const [x, y] = toAspectPos(event.clientX, event.clientY);
      // Only start a fresh ripple if the prior one has mostly settled, avoiding abrupt glow jumps
      if (burst.age > 0.35 || burst.power < 0.05) {
        burst = { x, y, age: 0, power: 0.32 };
      }
      surge = Math.min(0.45, surge + 0.06);
      start();
    };

    const onScroll = () => {
      if (suspendedRef.current) return;
      targetScrollY = window.scrollY / Math.max(window.innerHeight, 600);
      start();
    };

    const onKeyDown = () => {
      if (suspendedRef.current) return;
      surge = Math.min(0.5, surge + 0.04);
      start();
    };

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const paint = (now: number) => {
      frame = 0;
      if (disposed || failed || document.hidden || gpu.isContextLost() || suspendedRef.current) return;
      const moving = !motion?.matches;
      const targetFps = 30;
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
      const spring = 1 - Math.exp(-dt * 2.4);
      const nextPan = lerp(curPanX, cfg.panX, spring);
      const instantVel = (nextPan - curPanX) / Math.max(dt, 0.016);
      panVel = lerp(panVel, Math.max(-1.2, Math.min(1.2, instantVel)), 1 - Math.exp(-dt * 5.0));
      curPanX = nextPan;

      // Smooth inertial vertical scroll drag
      const nextScroll = lerp(curScrollY, targetScrollY, 1 - Math.exp(-dt * 4.5));
      const instantScrollVel = (nextScroll - curScrollY) / Math.max(dt, 0.016);
      scrollVel = lerp(scrollVel, Math.max(-0.7, Math.min(0.7, instantScrollVel)), 1 - Math.exp(-dt * 5.0));
      curScrollY = nextScroll;

      const colorEase = 1 - Math.exp(-dt * 1.8);
      for (let i = 0; i < 3; i++) {
        curAbyss[i] = lerp(curAbyss[i], cfg.abyssRgb[i], colorEase);
        curGlow[i] = lerp(curGlow[i], cfg.glowRgb[i], colorEase);
        curFlare[i] = lerp(curFlare[i], cfg.flareRgb[i], colorEase);
      }
      curCalm = lerp(curCalm, cfg.calmCenter, colorEase);
      curVortex = lerp(curVortex, cfg.vortex, colorEase);

      surge *= Math.exp(-dt * 1.15);
      burst.age += dt;
      morph = lerp(morph, targetMorph + Math.sin(elapsed * 0.08) * 0.18, 1 - Math.exp(-dt * 0.55));

      // Heavy old-engine flywheel: spins up slowly with sustained clean playing, ebbs gracefully on silence or mistakes.
      const drive = activeWaterDrive();
      const heard = Boolean(drive && drive.playing && now - drive.heardAt < 2200);
      if (heard) engineMs = Math.min(45000, engineMs + dtMs);
      else engineMs = Math.max(0, engineMs - dtMs * 0.28);

      smoothEnergy += ((heard ? drive?.level ?? 0 : 0) - smoothEnergy) * (1 - Math.exp(-dtMs / 1200));
      const spunUp = Math.pow(Math.max(0, Math.min(1, engineMs / 36000)), 1.65); // convex: whisper-quiet first 6s, strong after 30-36s
      const quality = drive ? 0.28 + 0.72 * Math.max(0, Math.min(1, (drive.flow - 0.35) / 0.58)) : 0.28;
      const targetBloom = heard ? Math.max(0, Math.min(1, spunUp * quality)) : 0;
      bloom += (targetBloom - bloom) * (1 - Math.exp(-dtMs / (targetBloom > bloom ? 6800 : 11500)));
      // Transcendent algae embrace opens non-linearly only in the upper zone.
      const zone = Math.pow(Math.max(0, Math.min(1, bloom)), 2.15);

      // Decay-to-bloom color drift: warms quickly on mistakes/drift, recovers gently as clean playing returns.
      const targetDecay = drive && drive.playing ? Math.max(0, Math.min(1, drive.decay ?? 0)) : 0;
      smoothDecay += (targetDecay - smoothDecay) * (1 - Math.exp(-dtMs / (targetDecay > smoothDecay ? 600 : 3500)));
      if (!drive) {
        lastMissSerial = -1;
      } else {
        const curMissSerial = drive.missSerial ?? 0;
        if (curMissSerial !== lastMissSerial) {
          if (lastMissSerial >= 0 && drive.playing && curMissSerial > lastMissSerial) {
            missPulse = Math.min(1, missPulse * 0.35 + 0.82);
          }
          lastMissSerial = curMissSerial;
        }
      }
      missPulse *= Math.exp(-dtMs / 1800);

      // Slow, silky luminescence breath on heard beats once deep in the zone (never twists or snaps).
      if (drive && drive.beatActive && drive.beatIndex >= 0 && drive.beatSerial !== lastBeatSerial) {
        lastBeatSerial = drive.beatSerial;
        beatTarget = Math.max(beatTarget, drive.beatIndex === 0 ? 0.85 : 0.42);
      }
      beatTarget *= Math.exp(-dt / 0.95);
      beatSway += (beatTarget - beatSway) * (1 - Math.exp(-dt / 0.55));
      const wantDownbeat = drive && drive.beatActive && drive.beatIndex === 0 ? 1 : 0;
      beatDownbeat += (wantDownbeat - beatDownbeat) * (1 - Math.exp(-dt / 0.45));

      // Queue a delayed far-away propeller swell when a note lands cleanly (never an instant violent flash).
      if (drive && drive.hitSerial !== lastHitSerial) {
        if (lastHitSerial >= 0 && drive.playing) {
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
        lastHitSerial = drive.hitSerial;
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

      // Smoothly drift harmonic centre instead of snapping on every note.
      const noteEase = 1 - Math.exp(-dtMs / 1600);
      if (drive) {
        smoothNoteX = lerp(smoothNoteX, drive.noteX, noteEase);
        smoothNoteY = lerp(smoothNoteY, drive.noteY, noteEase);
        smoothNoteHue = lerp(smoothNoteHue, drive.noteHue, noteEase);
      }
      const noteAge = drive ? Math.max(0, (now - drive.noteAt) / 1000) : 99;
      const wantWarmth = !moving || !heard ? 0 : Math.exp(-noteAge / 2.6) * (0.2 + 0.8 * bloom);
      smoothNoteWarmth += (wantWarmth - smoothNoteWarmth) * (1 - Math.exp(-dtMs / 700));

      swellBuf.fill(0);
      for (let i = 0; i < 3 && i < activeSwells.length; i++) {
        const sw = activeSwells[i];
        swellBuf[i * 4] = sw.x;
        swellBuf[i * 4 + 1] = sw.y;
        swellBuf[i * 4 + 2] = sw.age;
        swellBuf[i * 4 + 3] = moving ? sw.strength : 0;
      }

      // Viscous spring-integrated pointer wake chain (zero jumps, silky drag)
      ptrEnergyTarget *= Math.exp(-dt * 2.4);
      ptrSpinTarget *= Math.exp(-dt * 1.8);
      if (ptrTarget.initialized) {
        const leadEase = 1 - Math.exp(-dt * 3.8);
        wakes[0].x = lerp(wakes[0].x, ptrTarget.x, leadEase);
        wakes[0].y = lerp(wakes[0].y, ptrTarget.y, leadEase);
        wakes[0].energy = lerp(wakes[0].energy, ptrEnergyTarget, 1 - Math.exp(-dt * 3.2));
        wakes[0].spin = lerp(wakes[0].spin, ptrSpinTarget, 1 - Math.exp(-dt * 2.6));
        for (let i = 1; i < wakes.length; i++) {
          const prev = wakes[i - 1];
          const follow = 1 - Math.exp(-dt * Math.max(1.2, 3.0 - i * 0.55));
          wakes[i].x = lerp(wakes[i].x, prev.x, follow);
          wakes[i].y = lerp(wakes[i].y, prev.y, follow);
          wakes[i].energy = lerp(wakes[i].energy, prev.energy * 0.8, follow);
          wakes[i].spin = lerp(wakes[i].spin, prev.spin * 0.8, follow);
        }
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
      gpu.uniform1f(u.vortex, curVortex);
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
      gpu.uniform1f(u.playEnergy, moving ? smoothEnergy : 0);
      gpu.uniform1f(u.bloom, bloom);
      gpu.uniform1f(u.zone, zone);
      gpu.uniform1f(u.decay, smoothDecay);
      gpu.uniform1f(u.miss, moving ? missPulse : 0);
      gpu.uniform1f(u.sway, moving && drive?.beatActive ? beatSway * bloom * bloom : 0);
      gpu.uniform1f(u.downbeat, beatDownbeat);
      gpu.uniform2f(u.notePos, smoothNoteX, smoothNoteY);
      gpu.uniform1f(u.noteWarmth, moving ? smoothNoteWarmth : 0);
      gpu.uniform1f(u.noteHue, smoothNoteHue);
      gpu.uniform4fv(u.swells, swellBuf);
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

    wakeRef.current = (gentleSurge) => {
      if (gentleSurge) surge = Math.min(0.45, surge + 0.16);
      start();
    };
    const wakeFromDrive = () => start();
    const wasLive = waterDriveWakers.size > 0;
    waterDriveWakers.add(wakeFromDrive);
    if (!wasLive) notifyLive();
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
      waterDriveWakers.delete(wakeFromDrive);
      if (waterDriveWakers.size === 0) notifyLive();
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
      waterDriveWakers.delete(wakeFromDrive);
      if (waterDriveWakers.size === 0) notifyLive();
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

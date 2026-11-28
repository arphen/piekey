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
  flow?: number;
  hitSerial: number;
  onsetSerial?: number;
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
uniform float beatRingAge;
uniform float beatRingPower;
uniform vec2 notePos;
uniform float noteWarmth;
uniform float noteHue;
uniform vec4 swells[3]; // xy origin, z age (s), w strength: responsive liquid note swells
uniform vec4 wounds[4]; // xy pos, z radius, w severity: localized dying algae patches
uniform vec4 healWave; // xy pos, z age (s), w strength: bioluminescent restoration wave
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
  float vigor = 1.0 + agitation * 0.36 + bloom * 0.82 + zone * 0.92 + playEnergy * 0.28 + sway * (0.16 + 0.34 * bloom);
  // Concentric central vortex wrapping the Home tree and breathing rhythmically with the groove.
  swirl += spiralEddy(p, vec2(0.0, 0.0), 0.82, (0.68 + 0.16 * sin(t * 0.11)) * vortex * (1.0 + agitation * 0.18 + sway * 0.24));
  swirl += spiralEddy(p, c1, 0.62, (0.34 + 0.18 * sin(t * 0.09)) * vigor);
  swirl += spiralEddy(p, c2, 0.54, (-0.30 + 0.16 * cos(t * 0.07)) * vigor);
  swirl += spiralEddy(p, c3, 0.44, (0.24 * sin(t * 0.11 + 1.5)) * vigor);
  // Expressive harmonic note eddy that follows the player's pitch smoothly across the lagoon.
  swirl += spiralEddy(p, notePos, 0.50, (noteHue * 2.0 - 1.0) * noteWarmth * (0.18 + 0.46 * bloom));

  // Responsive liquid swells gliding across the harbor as notes land.
  vec2 waveShift = vec2(0.0);
  float swellLight = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 sw = swells[i];
    if (sw.w <= 0.001) continue;
    vec2 d = p - sw.xy;
    float dist = length(d) + 1e-4;
    float radius = sw.z * 0.29; // organic deep-water propagation
    float band = dist - radius;
    float env = exp(-band * band / 0.026) * exp(-sw.z * 0.48) * sw.w;
    float wave = sin(band * 22.0) * env;
    waveShift += (d / dist) * wave * 0.036;
    swellLight += env * (0.5 + 0.5 * cos(band * 16.0));
  }

  // Rhythmic concentric tide wave expanding gently from center on heard beats (metronome & timed play).
  float beatWaveLight = 0.0;
  if (beatRingPower > 0.005 && beatRingAge < 3.2) {
    float bd = length(p);
    float bRadius = 0.12 + beatRingAge * 0.36;
    float bBand = bd - bRadius;
    float bEnv = exp(-bBand * bBand / 0.020) * exp(-beatRingAge * 1.15) * beatRingPower;
    waveShift += normalize(p + vec2(1e-4)) * sin(bBand * 20.0) * bEnv * 0.018;
    beatWaveLight = bEnv;
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
  vec2 curl = vec2(fy - f0, -(fx - f0)) * (0.42 + agitation * 0.26 + bloom * 0.44 + zone * 0.48 + playEnergy * 0.14);

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
  float veinMask = smoothstep(0.10, 0.26, greenness) * smoothstep(0.30, 0.66, luma);

  // Nocturnal abyssal dark-blue water: deep Prussian/midnight-blue currents with dark-teal submerged mats.
  vec3 deepOcean = abyssColor * (0.85 + 0.95 * smoothstep(0.08, 0.84, f0));
  vec3 waterSheen = vec3(0.010, 0.048, 0.135) * smoothstep(0.28, 0.86, f0) * (0.62 + 0.38 * sin(t * 0.25 + p.x * 2.0));
  vec3 baseWater = deepOcean + waterSheen;

  // Localized dying patches ("wounds") left by mistakes: only those few patches wither while the rest of the lagoon keeps shining.
  float woundMask = 0.0;
  float woundRim = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 wd = wounds[i];
    if (wd.w <= 0.005) continue;
    float d = length(p - wd.xy);
    float organic = (f0 - 0.5) * wd.z * 0.68;
    float core = (1.0 - smoothstep(wd.z * 0.22, wd.z * 1.15, d + organic)) * wd.w;
    woundMask = max(woundMask, core);
    woundRim = max(woundRim, exp(-pow((d + organic - wd.z * 0.85) / max(wd.z * 0.32, 0.025), 2.0)) * wd.w);
  }
  float globalVeil = clamp(decay * 0.10 + miss * 0.06, 0.0, 0.18);
  float wilt = clamp(woundMask * 0.95 + globalVeil, 0.0, 1.0);
  float alive = 1.0 - woundMask * 0.72;

  // Sculpt the real algae photograph into dark nocturnal emerald mats over deep blue voids,
  // withering locally inside wound patches without turning the whole lagoon brown.
  vec3 coolMat = mix(
    vec3(0.008, 0.048, 0.105),
    vec3(0.036, 0.185, 0.155),
    smoothstep(0.16, 0.72, luma)
  );
  vec3 decayMat = mix(
    vec3(0.024, 0.015, 0.008),
    vec3(0.135, 0.072, 0.026),
    smoothstep(0.16, 0.72, luma)
  );
  vec3 darkMat = mix(coolMat, decayMat, wilt * 0.88);
  // Blend subtle photographic micro-texture into the dark mats; enriches organically as you enter the zone.
  vec3 photoTint = mix(vec3(0.38, 0.68, 0.72), vec3(0.70, 0.42, 0.18), wilt * 0.82);
  vec3 photoDetail = pow(max(raw, 0.0), vec3(2.40 - bloom * 0.34 - zone * 0.28)) * photoTint;
  vec3 algaeBody = mix(darkMat, photoDetail, 0.48 + bloom * 0.24 + zone * 0.24);

  // Calm center keeps text crisp; at rest algae hover gently, then embrace the whole room at peak.
  float centerDist = length((uv - vec2(0.5, 0.48)) * vec2(1.06, 0.96));
  float rim = smoothstep(mix(0.10, 0.02, zone), 0.86, centerDist);
  float matVis = mix(0.42 * (1.0 - calmCenter * (0.50 - zone * 0.28)) + bloom * 0.14 + zone * 0.20, 0.76 + bloom * 0.12 + zone * 0.12, rim);
  vec3 color = mix(baseWater, algaeBody, clamp(matMask * matVis, 0.0, 0.90));
  color *= (1.0 - woundMask * 0.35);

  // Localized withered ember palette for dying wound edges/cores.
  vec3 amberWilt = vec3(0.76, 0.52, 0.16);
  vec3 umberRust = vec3(0.46, 0.22, 0.08);
  vec3 woundGlow = mix(amberWilt, umberRust, woundMask);

  // Bioluminescence Layer 1: languid ambient pulse on the thickest algae veins.
  float breath = 0.5 + 0.5 * sin(t * 0.36 + f0 * 6.2831 + p.x * 1.4);
  float stenchGlow = veinMask * (0.11 + 0.14 * breath) * (0.48 + 0.66 * rim);
  color += mix(glowColor, woundGlow, woundMask * 0.78) * stenchGlow * alive;

  // Bioluminescence Layer 1b: dynamic attunement -> ecstatic iridescent emerald-cyan-gold peak!
  vec3 electricCyan = vec3(0.14, 0.92, 0.76);
  vec3 chlorophyll = vec3(0.28, 1.0, 0.44);
  vec3 moltenLime = vec3(0.74, 1.0, 0.28);
  vec3 poisonNeon = mix(mix(electricCyan, chlorophyll, noteHue), moltenLime, clamp(zone * 0.55 + f0 * 0.35 * bloom, 0.0, 0.82));
  vec3 liveNeon = mix(poisonNeon, woundGlow, woundMask * 0.80);
  vec3 birchGold = vec3(0.96, 0.82, 0.42);
  float noteNear = exp(-dot(p - notePos, p - notePos) / 0.28) * noteWarmth;
  float zoneGlow = bloom * 0.46 + zone * 1.48 + swellLight * (0.28 + 0.58 * bloom) + noteNear * (0.20 + 0.44 * bloom + 0.34 * zone) + playEnergy * bloom * 0.34;
  color += liveNeon * veinMask * raw.g * zoneGlow * alive * (0.40 + 0.82 * rim);
  // Subtle translucent peak aurora wash over floating mats when deep in the zone (calm center stays legible).
  color += mix(glowColor, flareColor, 0.45) * matMask * zone * (0.14 + 0.18 * playEnergy + 0.16 * sway) * alive * (0.22 + 0.78 * rim);
  // Bruised amber rim strictly around localized dying wounds.
  color += vec3(0.72, 0.38, 0.12) * woundRim * (0.14 + 0.28 * matMask) * (0.25 + 0.75 * rim);

  // Active healing wave: fresh ecstatic emerald-gold life surging out as clean playing knits a wound.
  if (healWave.w > 0.005 && healWave.z < 3.6) {
    float hd = length(p - healWave.xy);
    float hRadius = healWave.z * 0.30;
    float hRing = exp(-pow((hd - hRadius) / 0.065, 2.0)) * exp(-healWave.z * 1.0);
    float hCore = exp(-(hd * hd) / 0.055) * exp(-healWave.z * 1.5);
    vec3 healCol = mix(vec3(0.28, 1.0, 0.60), vec3(0.90, 1.0, 0.40), hCore);
    color += healCol * (hRing * 0.52 + hCore * 0.38) * healWave.w * (0.45 + 0.85 * matMask);
  }

  // Rhythmic heard-beat tide: silky golden-emerald pulse in Metronome and timed play, blooming dynamically with groove.
  vec3 tideColor = mix(mix(glowColor, liveNeon, bloom), birchGold, downbeat * 0.72);
  color += tideColor * veinMask * sway * (0.28 + 0.62 * bloom + 0.68 * zone) * alive * (0.35 + 0.65 * rim);
  color += tideColor * beatWaveLight * (0.22 + 0.65 * matMask + 0.55 * veinMask) * (0.26 + 0.42 * bloom);

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

  // Subtle dark-blue vignette + dynamic filmic highlight knee so ecstatic peaks truly shine without clipping.
  float vig = smoothstep(1.32, 0.22, centerDist);
  color *= mix(0.64, 1.04, vig);
  float knee = mix(0.50, 0.82, zone);
  vec3 over = max(color - knee, 0.0);
  color = min(color, knee) + over / (1.0 + over / 0.46);

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
      "playEnergy", "bloom", "zone", "decay", "miss", "sway", "downbeat", "beatRingAge", "beatRingPower", "notePos", "noteWarmth", "noteHue", "swells", "wounds", "healWave",
      "texA", "texB",
    ];
    const u = Object.fromEntries(names.map((name) => [name, gpu.getUniformLocation(program, name)]));
    if (!u.swells) u.swells = gpu.getUniformLocation(program, "swells[0]");
    if (!u.wounds) u.wounds = gpu.getUniformLocation(program, "wounds[0]");
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

    // Responsive flywheel + localized dying wounds + active healing waves + rhythmic beat tide (decorative only).
    let engineMs = 0;
    let bloom = 0;
    let smoothDecay = 0;
    let prevTargetDecay = 0;
    let missPulse = 0;
    let lastMissSerial = -1;
    let woundCounter = 0;
    const wounds: { x: number; y: number; radius: number; severity: number }[] = [];
    const woundBuf = new Float32Array(16);
    let healWave = { x: 0, y: 0, age: 10, strength: 0 };
    let smoothEnergy = 0;
    let beatTarget = 0;
    let beatSway = 0;
    let beatDownbeat = 0;
    let beatRingAge = 10;
    let beatRingPower = 0;
    let lastBeatSerial = -1;
    let lastHitSerial = -1;
    let lastOnsetSerial = -1;
    let lastSwellQueuedAt = -Infinity;
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

      // Dynamic marine flywheel: calm dark low at rest, responsive climb, sustained excitement through minor slips, ecstatic peak!
      const drive = activeWaterDrive();
      const heard = Boolean(drive && drive.playing && now - drive.heardAt < 2200);
      if (heard) engineMs = Math.min(30000, engineMs + dtMs);
      else engineMs = Math.max(0, engineMs - dtMs * 0.25);

      smoothEnergy += ((heard ? drive?.level ?? 0 : 0) - smoothEnergy) * (1 - Math.exp(-dtMs / 550));
      const spunUp = Math.pow(Math.max(0, Math.min(1, engineMs / 22000)), 1.18);
      // Unscored rooms (Metronome, un-gridded Free Play: flow === undefined) can reach full peak; scored rooms keep momentum across minor slips.
      const quality = drive
        ? drive.flow === undefined
          ? 1
          : 0.52 + 0.48 * Math.max(0, Math.min(1, (drive.flow - 0.25) / 0.65))
        : 0.52;
      const targetBloom = heard ? Math.max(0, Math.min(1, spunUp * quality)) : 0;
      bloom += (targetBloom - bloom) * (1 - Math.exp(-dtMs / (targetBloom > bloom ? 3400 : 11500)));
      // Transcendent algae embrace builds naturally from mid-groove and soars dynamically at the top.
      const zone = Math.pow(Math.max(0, Math.min(1, bloom)), 1.55);

      // Localized dying wounds + active healing waves (mistakes scar discrete spots instead of browning the whole lagoon).
      const targetDecay = drive && drive.playing ? Math.max(0, Math.min(1, drive.decay ?? 0)) : 0;
      if (prevTargetDecay > 0.12 && targetDecay === 0 && wounds.length) {
        const w = wounds[0];
        healWave = { x: w.x, y: w.y, age: 0, strength: 1.0 };
        wounds.length = 0;
      }
      prevTargetDecay = targetDecay;
      smoothDecay += (targetDecay - smoothDecay) * (1 - Math.exp(-dtMs / (targetDecay > smoothDecay ? 550 : 2800)));
      if (!drive) {
        lastMissSerial = -1;
      } else {
        const curMissSerial = drive.missSerial ?? 0;
        if (curMissSerial !== lastMissSerial) {
          if (lastMissSerial >= 0 && drive.playing && curMissSerial > lastMissSerial) {
            missPulse = Math.min(1, missPulse * 0.35 + 0.72);
            // Spawn a localized dying algae wound outside the calm center.
            const angle = (++woundCounter * 2.39996 + 0.7) % (Math.PI * 2);
            const dist = 0.38 + 0.24 * ((woundCounter * 0.6180339) % 1);
            const wx = Math.cos(angle) * dist * 1.15;
            const wy = Math.sin(angle) * dist * 0.72;
            const radius = 0.20 + 0.08 * ((woundCounter * 0.381966) % 1);
            if (wounds.length < 4) {
              wounds.push({ x: wx, y: wy, radius, severity: 0.85 });
            } else {
              const oldest = wounds.shift()!;
              wounds.push({ x: wx, y: wy, radius: Math.max(oldest.radius, radius), severity: 1.0 });
            }
          }
          lastMissSerial = curMissSerial;
        }
      }
      missPulse *= Math.exp(-dtMs / 1500);
      for (let i = wounds.length - 1; i >= 0; i--) {
        wounds[i].severity *= Math.exp(-dt / 26);
        if (wounds[i].severity <= 0.04) wounds.splice(i, 1);
      }
      healWave.age += dt;

      // Rhythmic luminescence tide + subtle concentric pulse on heard beats (alive in Metronome and timed play!).
      if (drive && drive.beatActive && drive.beatIndex >= 0 && drive.beatSerial !== lastBeatSerial) {
        lastBeatSerial = drive.beatSerial;
        const amp = drive.beatCounting ? 0.42 : drive.beatIndex === 0 ? 1.0 : 0.58;
        beatTarget = Math.max(beatTarget, amp);
        beatRingAge = 0;
        beatRingPower = amp;
      }
      beatRingAge += dt;
      beatTarget *= Math.exp(-dt / 0.72);
      beatSway += (beatTarget - beatSway) * (1 - Math.exp(-dt / 0.24));
      const wantDownbeat = drive && drive.beatActive && drive.beatIndex === 0 ? 1 : 0;
      beatDownbeat += (wantDownbeat - beatDownbeat) * (1 - Math.exp(-dt / 0.32));

      const queueSwell = (x: number, y: number, strength: number, delayMs: number) => {
        pendingSwells.push({ due: now + delayMs, x, y, strength });
        if (pendingSwells.length > 6) pendingSwells.shift();
        lastSwellQueuedAt = now;
      };

      // Clean hits actively HEAL localized wounds and send responsive luminous swells across the lagoon.
      if (drive && drive.hitSerial !== lastHitSerial) {
        if (lastHitSerial >= 0 && drive.playing) {
          if (wounds.length) {
            const target = wounds[0];
            target.severity = Math.max(0, target.severity - 0.30);
            const healed = target.severity <= 0.05;
            healWave = { x: target.x, y: target.y, age: 0, strength: healed ? 1.0 : 0.68 };
            if (healed) wounds.shift();
            bloom = Math.min(1, bloom + (healed ? 0.04 : 0.02));
          }
          const delayMs = 180 - 130 * bloom;
          const angle = (++swellCounter * 2.39996) % (Math.PI * 2);
          const dist = 0.46 - 0.18 * bloom;
          queueSwell(Math.cos(angle) * dist, Math.sin(angle) * dist * 0.65, 0.36 + 0.74 * bloom, delayMs);
        }
        lastHitSerial = drive.hitSerial;
      }
      // Pitched guitar note attacks also ripple the water in Metronome, Free Play, and improvised phrases!
      if (drive && drive.onsetSerial !== undefined && drive.onsetSerial !== lastOnsetSerial) {
        if (lastOnsetSerial >= 0 && drive.playing && now - lastSwellQueuedAt > 110) {
          const delayMs = 200 - 140 * bloom;
          queueSwell(drive.noteX * 0.72, drive.noteY * 0.72, 0.32 + 0.68 * bloom, delayMs);
        }
        lastOnsetSerial = drive.onsetSerial;
      }
      while (pendingSwells.length && pendingSwells[0].due <= now) {
        const next = pendingSwells.shift()!;
        activeSwells.push({ x: next.x, y: next.y, age: 0, strength: next.strength });
        if (activeSwells.length > 3) activeSwells.shift();
      }
      for (let i = activeSwells.length - 1; i >= 0; i--) {
        activeSwells[i].age += dt;
        if (activeSwells[i].age > 6.0) activeSwells.splice(i, 1);
      }

      // Smoothly drift harmonic centre instead of snapping on every note.
      const noteEase = 1 - Math.exp(-dtMs / 950);
      if (drive) {
        smoothNoteX = lerp(smoothNoteX, drive.noteX, noteEase);
        smoothNoteY = lerp(smoothNoteY, drive.noteY, noteEase);
        smoothNoteHue = lerp(smoothNoteHue, drive.noteHue, noteEase);
      }
      const noteAge = drive ? Math.max(0, (now - drive.noteAt) / 1000) : 99;
      const wantWarmth = !moving || !heard ? 0 : Math.exp(-noteAge / 2.6) * (0.35 + 0.65 * bloom);
      smoothNoteWarmth += (wantWarmth - smoothNoteWarmth) * (1 - Math.exp(-dtMs / 420));

      swellBuf.fill(0);
      for (let i = 0; i < 3 && i < activeSwells.length; i++) {
        const sw = activeSwells[i];
        swellBuf[i * 4] = sw.x;
        swellBuf[i * 4 + 1] = sw.y;
        swellBuf[i * 4 + 2] = sw.age;
        swellBuf[i * 4 + 3] = moving ? sw.strength : 0;
      }
      woundBuf.fill(0);
      for (let i = 0; i < 4 && i < wounds.length; i++) {
        const wd = wounds[i];
        woundBuf[i * 4] = wd.x;
        woundBuf[i * 4 + 1] = wd.y;
        woundBuf[i * 4 + 2] = wd.radius;
        woundBuf[i * 4 + 3] = wd.severity;
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
      gpu.uniform1f(u.sway, moving && drive?.beatActive ? beatSway * (0.26 + 0.74 * bloom) : 0);
      gpu.uniform1f(u.downbeat, beatDownbeat);
      gpu.uniform1f(u.beatRingAge, beatRingAge);
      gpu.uniform1f(u.beatRingPower, moving && drive?.beatActive ? beatRingPower : 0);
      gpu.uniform2f(u.notePos, smoothNoteX, smoothNoteY);
      gpu.uniform1f(u.noteWarmth, moving ? smoothNoteWarmth : 0);
      gpu.uniform1f(u.noteHue, smoothNoteHue);
      gpu.uniform4fv(u.swells, swellBuf);
      gpu.uniform4fv(u.wounds, woundBuf);
      gpu.uniform4f(u.healWave, healWave.x, healWave.y, healWave.age, moving ? healWave.strength : 0);
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

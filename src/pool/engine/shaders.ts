// GLSL ES 3.00 sources for the living pool. Original project code (AGPL-3.0-only), written from
// the published stable-fluids method (Stam, 1999) and GPU Gems ch. 38; no third-party shader code.
//
// Space: every pass works in "height units": y runs 0..1 up the screen, x runs 0..aspect.
// Velocity is in height units per second. Textures are sampled in their own 0..1 UV.

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
`;

export const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Up to 16 rounded rects from the room: rock (1) diverts the fluid, calm (2) quiets the pool for
// reading, glass (4) magnifies it. xy centre and zw half size in height units; meta x = corner radius.
const RECTS = `
uniform vec4 uRects[16];
uniform vec4 uRectMeta[16];
uniform int uRectCount;
bool flag(float flags, float bit) { return mod(floor(flags / bit), 2.0) >= 1.0; }
float rectSdf(vec2 p, vec4 r, float radius) {
  vec2 q = abs(p - r.xy) - (r.zw - radius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
float rockSdf(vec2 p, bool glass) {
  float d = 1e3;
  for (int i = 0; i < 16; i++) {
    if (i >= uRectCount) break;
    if (!flag(uRectMeta[i].y, 1.0) || (!glass && flag(uRectMeta[i].y, 4.0))) continue;
    d = min(d, rectSdf(p, uRects[i], uRectMeta[i].x));
  }
  return d;
}
float rockSdf(vec2 p) { return rockSdf(p, true); }
// Free slip: water may run along a rock but not into it.
vec2 slip(vec2 p, vec2 v) {
  float d = rockSdf(p);
  if (d > 0.04) return v;
  float e = 0.004;
  vec2 g = vec2(rockSdf(p + vec2(e, 0.0)) - rockSdf(p - vec2(e, 0.0)), rockSdf(p + vec2(0.0, e)) - rockSdf(p - vec2(0.0, e)));
  vec2 n = g / (length(g) + 1e-6);
  float vn = dot(v, n);
  if (vn < 0.0) v -= n * vn * (1.0 - smoothstep(0.0, 0.04, d));
  if (d < 0.0) v *= 0.85;
  return v;
}
`;

export const CURL = `${HEAD}
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uCell;
void main() {
  float l = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float r = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float b = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  o = vec4(((r - l) - (t - b)) / (2.0 * uCell), 0.0, 0.0, 1.0);
}
`;

export const FORCES = `${HEAD}${RECTS}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform sampler2D uWaves;
uniform sampler2D uHeat;
uniform vec2 uTexel;
uniform float uCell;
uniform float uAspect;
uniform float uDt;
uniform float uEpsilon;
uniform float uBuoyancy;
uniform float uRipple;
uniform vec4 uVortex[8]; // xy centre, z spin (signed, 1/s), w radius
uniform int uVortexCount;
uniform vec4 uStone[8]; // xy, z radius, w outward impulse
uniform int uStoneCount;
uniform vec4 uSwirl[4]; // xy, z tangential impulse (signed), w radius
uniform int uSwirlCount;
uniform vec2 uPush;
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  vec2 v = texture(uVelocity, vUv).xy;
  float c = texture(uCurl, vUv).x;
  float cl = abs(texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x);
  float cr = abs(texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x);
  float cb = abs(texture(uCurl, vUv - vec2(0.0, uTexel.y)).x);
  float ct = abs(texture(uCurl, vUv + vec2(0.0, uTexel.y)).x);
  vec2 n = vec2(cr - cl, ct - cb);
  n /= length(n) + 1e-5;
  v += uEpsilon * uCell * c * vec2(n.y, -n.x) * uDt;
  for (int i = 0; i < 8; i++) {
    if (i >= uVortexCount) break;
    vec2 d = p - uVortex[i].xy;
    v += uVortex[i].z * vec2(-d.y, d.x) * exp(-dot(d, d) / (uVortex[i].w * uVortex[i].w)) * uDt;
  }
  for (int i = 0; i < 8; i++) {
    if (i >= uStoneCount) break;
    vec2 d = p - uStone[i].xy;
    float r = uStone[i].z;
    v += uStone[i].w * d / r * exp(-dot(d, d) / (r * r));
  }
  for (int i = 0; i < 4; i++) {
    if (i >= uSwirlCount) break;
    vec2 d = p - uSwirl[i].xy;
    float r = uSwirl[i].w;
    v += uSwirl[i].z * vec2(-d.y, d.x) / r * exp(-dot(d, d) / (r * r));
  }
  float hl = texture(uWaves, vUv - vec2(uTexel.x, 0.0)).x;
  float hr = texture(uWaves, vUv + vec2(uTexel.x, 0.0)).x;
  float hb = texture(uWaves, vUv - vec2(0.0, uTexel.y)).x;
  float ht = texture(uWaves, vUv + vec2(0.0, uTexel.y)).x;
  v -= uRipple * vec2(hr - hl, ht - hb) / (2.0 * uCell) * uDt;
  v.y += uBuoyancy * texture(uHeat, vUv).x * uDt;
  v += uPush;
  float speed = length(v);
  if (speed > 0.3) v *= 0.3 / speed; // a pond, not a river: bounded speed keeps the photograph whole
  o = vec4(slip(p, v), 0.0, 1.0);
}
`;

export const DIVERGENCE = `${HEAD}
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uCell;
void main() {
  float l = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  o = vec4(0.5 * ((r - l) + (t - b)) / uCell, 0.0, 0.0, 1.0);
}
`;

export const PRESSURE = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
uniform float uCell;
uniform float uScale; // the first iteration warm-starts from the previous frame's pressure, scaled down
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((uScale * (l + r + b + t) - div * uCell * uCell) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT = `${HEAD}${RECTS}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uCell;
uniform float uAspect;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVelocity, vUv).xy - 0.5 * vec2(r - l, t - b) / uCell;
  o = vec4(slip(vUv * vec2(uAspect, 1.0), v), 0.0, 1.0);
}
`;

export const ADVECT = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform float uAspect;
uniform float uDecay;
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  o = texture(uSource, vUv - uDt * v / vec2(uAspect, 1.0)) * uDecay;
}
`;

// Warm water: advected, cooling, fed by emitters along the bottom edge.
export const HEAT = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform float uAspect;
uniform float uDecay;
uniform vec4 uEmitter[8]; // xy, z rate, w radius
uniform int uEmitterCount;
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  vec2 v = texture(uVelocity, vUv).xy;
  float t = texture(uSource, vUv - uDt * v / vec2(uAspect, 1.0)).x * uDecay;
  for (int i = 0; i < 8; i++) {
    if (i >= uEmitterCount) break;
    vec2 d = (p - uEmitter[i].xy) / uEmitter[i].w;
    t += uEmitter[i].z * exp(-dot(d, d)) * uDt;
  }
  o = vec4(min(t, 1.5), 0.0, 0.0, 1.0);
}
`;

// The photograph is never advected as dye. Two displacement fields are: the photo is sampled at
// x + drift + D(x), and advecting that coordinate gives D'(x) = D(x - v·dt) - v·dt. Each field
// (xy and zw) restarts from zero every flow period, half a period apart, and the composite blends
// them so the image keeps flowing without ever stretching apart (a two-phase flow map).
export const MARBLE = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uMarble;
uniform float uDt;
uniform float uAspect;
uniform vec2 uReset;
void main() {
  vec2 v = texture(uVelocity, vUv).xy;
  vec4 d = texture(uMarble, vUv - uDt * v / vec2(uAspect, 1.0)) - vec4(v * uDt, v * uDt);
  o = d * vec4(vec2(1.0 - uReset.x), vec2(1.0 - uReset.y));
}
`;

// A height field ripple: h' = (2h - h_prev + k·∇²h)·damping. r holds h, g the previous h.
export const WAVES = `${HEAD}${RECTS}
uniform sampler2D uWaves;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uK;
uniform float uDamp;
uniform vec4 uStone[8]; // xy, z radius, w height
uniform float uStoneRing[8]; // > 0: a ring of this radius, already spread (a beat at the dial's rim)
uniform int uStoneCount;
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  vec2 c = texture(uWaves, vUv).xy;
  float lap = texture(uWaves, vUv - vec2(uTexel.x, 0.0)).x + texture(uWaves, vUv + vec2(uTexel.x, 0.0)).x
            + texture(uWaves, vUv - vec2(0.0, uTexel.y)).x + texture(uWaves, vUv + vec2(0.0, uTexel.y)).x - 4.0 * c.x;
  float h = (2.0 * c.x - c.y + uK * lap) * uDamp;
  for (int i = 0; i < 8; i++) {
    if (i >= uStoneCount) break;
    float r = (length(p - uStone[i].xy) - uStoneRing[i]) / uStone[i].z;
    h += uStone[i].w * exp(-r * r);
  }
  vec2 edge = min(vUv, 1.0 - vUv);
  h *= smoothstep(0.0, 0.03, min(edge.x, edge.y)); // the screen's edge absorbs
  h *= smoothstep(-0.004, 0.006, rockSdf(p, false)); // rocks reflect; ripples pass under glass
  o = vec4(h, c.x, 0.0, 1.0);
}
`;

export const DYE = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform float uAspect;
uniform float uDecay;
uniform vec4 uStone[8]; // xy, z radius, w amount
uniform vec3 uStoneTint[8];
uniform int uStoneCount;
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  vec2 v = texture(uVelocity, vUv).xy;
  vec4 c = texture(uSource, vUv - uDt * v / vec2(uAspect, 1.0)) * uDecay;
  for (int i = 0; i < 8; i++) {
    if (i >= uStoneCount) break;
    vec2 d = (p - uStone[i].xy) / uStone[i].z;
    float a = uStone[i].w * exp(-dot(d, d));
    c += vec4(uStoneTint[i] * a, a);
  }
  o = min(c, vec4(4.0));
}
`;

// Floating leaves: pos.xy, angle, spin, one texel each.
export const PARTICLES = `${HEAD}
uniform sampler2D uParticles;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uDt;
uniform float uAspect;
uniform vec2 uDriftVelocity;
void main() {
  vec4 s = texelFetch(uParticles, ivec2(gl_FragCoord.xy), 0);
  vec2 uv = s.xy / vec2(uAspect, 1.0);
  vec2 v = texture(uVelocity, uv).xy;
  float curl = texture(uCurl, uv).x;
  s.xy += (v * 0.85 - uDriftVelocity) * uDt;
  s.w = mix(s.w, curl * 0.5, 1.0 - exp(-uDt / 1.2));
  s.z += s.w * uDt;
  if (s.x < -0.12) s.x += uAspect + 0.24;
  if (s.x > uAspect + 0.12) s.x -= uAspect + 0.24;
  if (s.y < -0.12) s.y += 1.24;
  if (s.y > 1.12) s.y -= 1.24;
  o = s;
}
`;

export const FLOATER_VERTEX = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uParticles;
uniform sampler2D uWaves;
uniform float uAspect;
uniform float uPhotoScale;
uniform float uVisible;
uniform vec4 uSprite[8]; // image-space rects (y down)
uniform int uSpriteCount;
out vec2 vSprite;
out vec2 vCorner;
out float vAlpha;
void main() {
  int id = gl_InstanceID;
  vec4 s = texelFetch(uParticles, ivec2(id, 0), 0);
  vec4 sprite = uSprite[id % uSpriteCount];
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float bob = 1.0 + 3.0 * texture(uWaves, s.xy / vec2(uAspect, 1.0)).x;
  vec2 size = (sprite.zw - sprite.xy) * vec2(1200.0, 1600.0) / 1600.0 * uPhotoScale * bob;
  vec2 local = (corner - 0.5) * size;
  float c = cos(s.z), n = sin(s.z);
  vec2 p = s.xy + vec2(c * local.x - n * local.y, n * local.x + c * local.y);
  gl_Position = vec4(p / vec2(uAspect, 1.0) * 2.0 - 1.0, 0.0, 1.0);
  vSprite = mix(sprite.xy, sprite.zw, vec2(corner.x, 1.0 - corner.y));
  vCorner = corner;
  vAlpha = clamp(uVisible - float(id), 0.0, 1.0);
}
`;

export const FLOATER_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPhoto;
in vec2 vSprite;
in vec2 vCorner;
in float vAlpha;
out vec4 o;
void main() {
  vec3 c = texture(uPhoto, vSprite).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // yellow and orange: high red and green, low blue, red close to green
  float key = smoothstep(0.08, 0.2, c.r - c.b) * smoothstep(0.0, 0.08, c.g - c.b)
            * smoothstep(0.7, 0.85, c.r / max(c.g, 1e-3)) * smoothstep(0.2, 0.32, luma);
  vec2 e = min(vCorner, 1.0 - vCorner);
  float a = key * vAlpha * smoothstep(0.0, 0.12, min(e.x, e.y));
  o = vec4(c * a, a);
}
`;

// What is seen at one point of the pool: shared by the bright pass (glow only) and the composite.
const SCENE = `${RECTS}
uniform sampler2D uPhoto;
uniform sampler2D uLeaf;
uniform sampler2D uMarble;
uniform sampler2D uWaves;
uniform sampler2D uHeat;
uniform sampler2D uDye;
uniform sampler2D uFloaters;
uniform float uAspect;
uniform vec2 uDrift;
uniform float uPhotoScale;
uniform float uSaturation;
uniform float uSepia;
uniform float uBrightness;
uniform float uContrast;
uniform float uSpread;
uniform float uDawn;
uniform float uEmission;
uniform float uKick;
uniform float uLava;
uniform float uRefract;
uniform float uDyeGain;
uniform vec3 uTint;
uniform vec2 uWaveTexel;
uniform float uWaveCell;
uniform vec4 uRings[4]; // xy, z age (s), w strength
uniform int uRingCount;
uniform vec4 uFlash[2]; // xy, z radius, w brightness: a heard beat lights the dial's rim that frame
uniform int uFlashCount;
uniform float uFlowMix; // weight of the first flow phase
uniform float uCalmDepth; // at rest the room is already quiet; lenses deepen with the groove
uniform sampler2D uPhotoB; // the photograph the pond is turning into
uniform float uMorph; // how far, 0–1 (0: no turn under way)
uniform vec2 uMorphSeed; // this turn's own front and currents

const float TURN_C = 0.97815; // the room's photograph is turned −12°
const float TURN_S = -0.20791;

vec2 photoUv(vec2 c) {
  vec2 r = vec2(TURN_C * c.x - TURN_S * c.y, TURN_S * c.x + TURN_C * c.y);
  return vec2(r.x / (uPhotoScale * 0.75), -r.y / uPhotoScale) + vec2(0.5, 0.46);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.1) + 0.2 * vnoise(p * 4.11 + 3.7); }

// How thick the algae are: bright and greener than anything else.
float algaeHeight(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)) + 0.8 * max(0.0, c.g - max(c.r, c.b)); }

// The pond turning into another photograph is never a crossfade. Each place turns at its own time,
// on a slow front of noise; the old algae stream away along a curl of it while the new arrive
// against it; and where the new algae are thick they surface first and where the old are thick
// they linger (height blending), so the new shapes grow out of the old ones.
float morphAt(vec2 n) {
  if (uMorph <= 0.0) return 0.0;
  return clamp(uMorph * 1.7 - fbm3(n * 1.6 + uMorphSeed * 17.0) * 0.7, 0.0, 1.0);
}
vec2 morphCurrent(vec2 n) {
  vec2 q = n * 2.2 + uMorphSeed * 11.0;
  float f = fbm3(q);
  vec2 g = vec2(fbm3(q + vec2(0.05, 0.0)) - f, fbm3(q + vec2(0.0, 0.05)) - f) / 0.05;
  return vec2(g.y, -g.x) * 0.05;
}
vec3 pondAt(vec2 c, float m, vec2 w) {
  vec3 a = texture(uPhoto, photoUv(c + w * m)).rgb;
  if (m <= 0.0) return a;
  vec3 b = texture(uPhotoB, photoUv(c - w * (1.0 - m))).rgb;
  float k = (2.0 * m - 1.0) * 1.3 + (algaeHeight(b) - algaeHeight(a)) * 0.9 * 4.0 * m * (1.0 - m);
  return mix(a, b, smoothstep(-0.14, 0.14, k));
}

vec3 grade(vec3 c, float saturation, float sepia) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  return max(mix(c, s, sepia), 0.0); // saturation above 1 extrapolates; keep pow() away from negatives
}

// The photographic room's own mask: an ellipse off the lower right, widening to the whole pool.
float roomMaskAtRest(vec2 uv) {
  vec2 s = vec2(uv.x, 1.0 - uv.y);
  float d = length(vec2((s.x - 1.03) / 0.833, (s.y - 0.72) / 3.61));
  return d < 0.06 ? 1.0 : d < 0.4 ? mix(1.0, 0.6, (d - 0.06) / 0.34) : mix(0.6, 0.0, clamp((d - 0.4) / 0.32, 0.0, 1.0));
}
float roomMask(vec2 uv) { return mix(roomMaskAtRest(uv), 1.0, uSpread); }

vec4 dawnLayer(vec2 s, vec2 c, vec2 radii, float stop, vec3 colour, float alpha, vec4 under) {
  float a = alpha * clamp(1.0 - length((s - c) / radii) / stop, 0.0, 1.0);
  return vec4(colour * a + under.rgb * (1.0 - a), a + under.a * (1.0 - a));
}

// The room's dawn gradients, at their CSS positions in a box 12% larger than the screen (premultiplied).
vec4 dawn(vec2 uv) {
  vec2 s = (vec2(uv.x, 1.0 - uv.y) + 0.12) / 1.24;
  vec4 l = vec4(0.0);
  l = dawnLayer(s, vec2(0.14, 0.15), vec2(1.17, 1.254), 0.47, vec3(0.898, 0.643, 0.333), 1.0, l);
  l = dawnLayer(s, vec2(0.78, 0.95), vec2(4.25, 0.967), 0.44, vec3(0.282, 0.62, 0.671), 1.0, l);
  l = dawnLayer(s, vec2(0.8, 0.14), vec2(1.466, 1.026), 0.46, vec3(0.502, 0.627, 0.545), 0.14, l);
  l = dawnLayer(s, vec2(0.08, 0.8), vec2(0.974, 2.435), 0.43, vec3(0.639, 0.451, 0.302), 0.231, l);
  return l;
}
const vec3 WATER = vec3(0.008, 0.024, 0.058);

void lenses(vec2 p, out float calm, out float glass, out vec2 centre, out float rim) {
  calm = 0.0; glass = 0.0; centre = p; rim = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uRectCount) break;
    vec4 r = uRects[i];
    float flags = uRectMeta[i].y;
    if (flag(flags, 2.0)) calm = max(calm, 1.0 - smoothstep(-0.02, 0.06, rectSdf(p, r, uRectMeta[i].x)));
    if (flag(flags, 4.0)) {
      float radius = min(r.z, r.w);
      float d = length(p - r.xy) - radius;
      float g = 1.0 - smoothstep(-0.004, 0.004, d);
      if (g > glass) { glass = g; centre = r.xy; }
      rim = max(rim, exp(-abs(d) * 350.0));
    }
  }
}

void scene(vec2 uv, out vec3 colour, out vec3 glow, out float lens) {
  vec2 p = uv * vec2(uAspect, 1.0);
  float calm; float glass; vec2 centre; float rim;
  lenses(p, calm, glass, centre, rim);
  float hl = texture(uWaves, uv - vec2(uWaveTexel.x, 0.0)).x;
  float hr = texture(uWaves, uv + vec2(uWaveTexel.x, 0.0)).x;
  float hb = texture(uWaves, uv - vec2(0.0, uWaveTexel.y)).x;
  float ht = texture(uWaves, uv + vec2(0.0, uWaveTexel.y)).x;
  vec2 grad = vec2(hr - hl, ht - hb) / (2.0 * uWaveCell);
  vec4 marble = texture(uMarble, uv);
  float refraction = uRefract * mix(1.0, 0.3, calm) * (1.0 + 2.0 * glass);
  vec2 still = p + grad * refraction;
  vec2 a = mix(still + marble.xy, centre + (still + marble.xy - centre) / 1.15, glass);
  vec2 b = mix(still + marble.zw, centre + (still + marble.zw - centre) / 1.15, glass);
  vec2 here = p + uDrift; // where on the drifting pond: a turn's front travels with the water
  float m = morphAt(here);
  vec2 w = m > 0.0 && m < 1.0 ? morphCurrent(here) : vec2(0.0);
  vec3 raw = mix(pondAt(b + uDrift, m, w), pondAt(a + uDrift, m, w), uFlowMix);
  vec2 local = mix(b, a, uFlowMix);
  float mask = roomMask(uv);

  // Nocturnal abyssal dark-blue lagoon base, matching Home, Library & Progress.
  float luma = dot(raw, vec3(0.2126, 0.7152, 0.0722));
  float greenness = max(0.0, raw.g - max(raw.r * 0.90, raw.b * 0.95));
  float matMask = smoothstep(0.035, 0.20, greenness) * smoothstep(0.16, 0.56, luma);
  float waterNoise = fbm3(here * 1.15);
  vec3 base = WATER * (0.86 + 0.85 * smoothstep(0.10, 0.86, waterNoise))
    + vec3(0.009, 0.044, 0.125) * smoothstep(0.26, 0.86, waterNoise) * 0.75;
  vec3 darkMat = mix(vec3(0.008, 0.048, 0.105), vec3(0.036, 0.185, 0.155), smoothstep(0.16, 0.72, luma));
  vec3 photoDetail = pow(grade(raw, uSaturation, uSepia), vec3(uContrast)) * vec3(0.46, 0.78, 0.84);
  vec3 pond = mix(darkMat, photoDetail, 0.45 + 0.35 * smoothstep(0.28, 0.88, uBrightness));
  float matVis = clamp(matMask * (0.48 + 0.52 * uBrightness) * mask, 0.0, 0.86);
  colour = mix(base, pond, matVis);
  // what this point looked like at rest: calm lenses lean back toward deep abyssal water so text keeps contrast
  vec3 rest = mix(base, darkMat, matMask * 0.32 * roomMaskAtRest(uv));
  float quiet = mix(1.0, 0.25, calm);
  calm *= uCalmDepth;
  lens = calm;

  // the algae glow softly in cyan-emerald at rest and blossom into bioluminescent radiance in the zone
  float algae = smoothstep(0.05, 0.23, greenness) * smoothstep(0.20, 0.58, luma);
  vec3 neon = mix(vec3(0.18, 0.90, 0.58), mix(vec3(0.38, 1.0, 0.28), uTint, 0.32), smoothstep(0.05, 0.65, uEmission));
  glow = algae * neon * raw.g * (0.065 + uEmission * 1.28) * (1.0 + uKick * 0.55) * (0.45 + 0.55 * mask) * quiet;

  // ripples catch cool nocturnal moonlight and cyan-emerald sheen
  vec3 n = normalize(vec3(-grad, 1.0));
  float spec = pow(max(dot(n, normalize(vec3(-0.25, 0.35, 1.0))), 0.0), 60.0);
  float sheen = clamp(length(grad) * 0.22, 0.0, 0.1);
  colour += vec3(0.56, 0.84, 0.90) * (spec * 0.35 + sheen) * mix(1.0, 0.3, calm);

  // warm blobs rise: translucent, backlit leaf veins glowing through
  float t = texture(uHeat, uv).x;
  float blob = smoothstep(0.42, 0.58, t) * uLava;
  float halo = exp(-abs(t - 0.5) * 12.0) * smoothstep(0.05, 0.2, t) * uLava;
  vec3 leaf = texture(uLeaf, vec2(local.x, -local.y) * 0.55 + uDrift * 0.4).rgb;
  vec3 backlit = leaf * vec3(1.2, 1.05, 0.62) + uTint * 0.12;
  colour = mix(colour, backlit * 0.7, blob * 0.55 * mix(1.0, 0.5, calm));
  glow += (backlit * blob * 0.3 + uTint * halo * 0.25) * quiet;

  // notes leave luminous trails
  glow += texture(uDye, uv).rgb * uDyeGain * quiet;

  for (int i = 0; i < 4; i++) {
    if (i >= uRingCount) break;
    float age = uRings[i].z;
    float d = length(p - uRings[i].xy) - age * 0.32;
    glow += uTint * uRings[i].w * exp(-d * d / 0.0015) * exp(-age / 2.2) * quiet;
  }
  glow += vec3(0.75, 0.85, 0.7) * rim * 0.06;
  for (int i = 0; i < 2; i++) {
    if (i >= uFlashCount) break;
    float d = length(p - uFlash[i].xy) - uFlash[i].z;
    glow += mix(vec3(0.8, 0.9, 0.72), uTint, 0.3) * uFlash[i].w * exp(-d * d / 0.00035);
  }

  vec4 f = texture(uFloaters, uv);
  vec3 leafColour = grade(f.rgb / max(f.a, 1e-3), mix(0.3, 1.0, uSaturation / 1.35), uSepia);
  colour = mix(colour, leafColour, f.a * (0.05 + 0.6 * smoothstep(0.15, 0.5, uBrightness)));

  // calm lenses keep text readable: back toward the quiet room, darker and greyer
  colour = mix(colour, rest, calm * 0.85);
}
`;

export const BRIGHT = `${HEAD}${SCENE}
void main() {
  vec3 colour; vec3 glow; float lens;
  scene(vUv, colour, glow, lens);
  o = vec4((glow + max(colour - 0.55, 0.0) * 0.5) * (1.0 - 0.8 * lens), 1.0);
}
`;

export const BLUR = `${HEAD}
uniform sampler2D uSource;
uniform vec2 uStep;
void main() {
  o = texture(uSource, vUv) * 0.227
    + (texture(uSource, vUv + uStep * 1.385) + texture(uSource, vUv - uStep * 1.385)) * 0.316
    + (texture(uSource, vUv + uStep * 3.231) + texture(uSource, vUv - uStep * 3.231)) * 0.07;
}
`;

export const COMPOSITE = `${HEAD}${SCENE}
uniform sampler2D uBloom;
uniform float uBloomGain;
uniform vec4 uTuner; // xy, z radius, w amount
uniform vec2 uTunerWave; // x phase, y wavelength ratio
uniform vec2 uResolution;
void main() {
  vec3 colour; vec3 glow; float lens;
  scene(vUv, colour, glow, lens);
  vec3 bloom = texture(uBloom, vUv).rgb * uBloomGain * (1.0 - 0.75 * lens);
  vec3 tunerGlow = vec3(0.0);
  if (uTuner.w > 0.001) {
    // Two ring sets, the second detuned; their moiré moves at the string's real beat frequency.
    float r = length(vUv * vec2(uAspect, 1.0) - uTuner.xy);
    float lambda = 0.016;
    float a = 0.5 + 0.5 * cos(6.2832 * r / lambda);
    float b = 0.5 + 0.5 * cos(6.2832 * r / (lambda * uTunerWave.y) + uTunerWave.x);
    tunerGlow = vec3(0.54, 0.96, 0.68) * a * b * exp(-r * r / (uTuner.z * uTuner.z)) * uTuner.w * 0.14;
  }
  // Keep AbyssalWater visible underneath at rest; the living pool's fluid, ripples, tuner rings
  // and earned bioluminescence emerge transparently over the continuous lagoon.
  float earned = clamp(smoothstep(0.008, 0.56, uEmission) * 0.78 + smoothstep(0.015, 0.48, uLava) * 0.28, 0.0, 0.92) * (1.0 - 0.65 * lens);
  vec3 light = (glow * 1.25) + bloom + tunerGlow;
  vec3 rgb = colour * earned + light;
  // soft knee: dark values pass untouched, bright glow never clips
  vec3 over = max(rgb - 0.6, 0.0);
  rgb = min(rgb, 0.6) + over / (1.0 + over / 0.4);
  float alpha = clamp(max(earned, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 0.94);
  // dither the dark gradients against banding
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 outRgb = min(max(rgb + (noise - 0.5) / 255.0 * alpha, 0.0), vec3(alpha));
  o = vec4(outRgb, alpha);
}
`;

export const COPY = `${HEAD}
uniform sampler2D uSource;
void main() { o = texture(uSource, vUv); }
`;

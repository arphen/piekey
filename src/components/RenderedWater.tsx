import { useEffect, useRef, type MutableRefObject } from "react";
import type { BeatSignal } from "../song/pulse";

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// A shallow pool seen in low evening light. Analytic waves, rather than a fluid simulation:
// fixed work per pixel, no feedback buffers, no textures and no additional audio analysis.
const FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float energy;
uniform float warmth;
uniform float strike;
uniform float downbeat;

float water(vec2 p) {
  float a = .36;
  float h = 0.;
  mat2 turn = mat2(.80, -.60, .60, .80);
  for (int i = 0; i < 5; i++) {
    p = turn * p;
    h += a * sin(p.x + sin(p.y * .76 + time * .13))
           * cos(p.y + time * (.07 + float(i) * .012));
    p = p * 1.83 + vec2(1.7, 3.1);
    a *= .48;
  }
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = (uv - .5) * vec2(resolution.x / resolution.y, 1.);
  p.y *= .76;
  p += vec2(time * .014, -time * .008);
  vec2 q = p * 3.3;
  float h = water(q);
  vec2 normal = vec2(water(q + vec2(.025, 0.)) - h,
                     water(q + vec2(0., .025)) - h) / .025;
  float light = max(0., dot(normalize(vec3(-normal * .62, 1.)), normalize(vec3(-.45, .75, .62))));
  float caustic = pow(max(0., 1. - abs(sin(h * 12. + p.y * 3.))), 18.);
  float thread = pow(max(0., 1. - abs(sin(h * 19. + p.x * 2.4))), 38.);
  float distance = length((uv - vec2(.5, .46)) * vec2(1.15, 1.));
  float ripple = sin(distance * 48. - (1. - strike) * 12.);
  ripple = pow(max(0., ripple), 12.) * strike * exp(-distance * 2.8);
  vec3 deep = vec3(.026, .058, .055);
  vec3 silver = vec3(.28, .36, .30);
  vec3 bronze = vec3(.46, .30, .16);
  vec3 jade = vec3(.10, .34, .29);
  vec3 glimmer = mix(silver, mix(bronze, jade, uv.x), warmth * .78);
  vec3 color = deep + glimmer * (light * .11 + caustic * .34 + thread * .12);
  color += mix(vec3(.25, .34, .28), vec3(.45, .34, .20), downbeat) * ripple * .16;
  color += glimmer * energy * light * .035;
  float vignette = 1. - smoothstep(.08, .85, distance);
  color *= .54 + vignette * .64;
  gl_FragColor = vec4(color, 1.);
}
`;

export interface RenderedWaterProps {
  playing: boolean;
  warmth: number;
  flow: number;
  beat?: BeatSignal;
  level: MutableRefObject<{ level: number; heard: number; played: number; wake?: () => void }>;
}

/** An explicitly enabled, bounded GPU layer. The score and the musical clock never depend on it. */
export function RenderedWater({ playing, warmth, flow, beat, level }: RenderedWaterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ playing, warmth, flow, beat });
  latest.current = { playing, warmth, flow, beat };
  const wake = useRef<() => void>(() => undefined);
  useEffect(() => { wake.current(); }, [playing, beat?.active, beat?.serial, warmth, flow]);

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
    let struck = -Infinity;
    let smoothEnergy = 0;
    let bloom = 0;
    let changedSize = true;
    let painted = false;
    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const release = () => {
      cancelAnimationFrame(frame);
      gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach((shader) => gl.deleteShader(shader));
    };
    if (!vertex || !fragment || !program || !buffer) { release(); el.dataset.renderer = "unavailable"; return; }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { release(); el.dataset.renderer = "unavailable"; return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(["resolution", "time", "energy", "warmth", "strike", "downbeat"].map((key) => [key, gl.getUniformLocation(program, key)]));
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const paint = (now: number) => {
      frame = 0;
      if (disposed || failed || document.hidden || gpu.isContextLost()) return;
      const s = latest.current;
      const active = (s.playing && now - level.current.heard < 900) || Boolean(s.beat?.active);
      if (!motion?.matches && active && previous && now - previous < 1000 / 30) { frame = requestAnimationFrame(paint); return; }
      const dt = previous ? Math.min(100, now - previous) : 33;
      previous = now;
      if (active && !motion?.matches) elapsed += dt / 1000;
      if (s.beat?.active && s.beat.serial !== serial) { serial = s.beat.serial; struck = now; }
      if (changedSize) {
        const rect = el.getBoundingClientRect();
        // Half resolution, capped at 1,000 pixels on the long edge, regardless of device DPR.
        const scale = Math.min(.65, 1000 / Math.max(rect.width, rect.height, 1));
        el.width = Math.max(1, Math.round(rect.width * scale));
        el.height = Math.max(1, Math.round(rect.height * scale));
        gl.viewport(0, 0, el.width, el.height);
        changedSize = false;
      }
      const heard = s.playing && now - level.current.heard < 900;
      smoothEnergy += ((heard ? level.current.level : 0) - smoothEnergy) * (1 - Math.exp(-dt / 350));
      const earned = Math.min(s.warmth, level.current.played / 150000);
      const target = heard ? Math.pow(Math.max(0, earned), 1.6) * Math.max(0, Math.min(1, (s.flow - .48) / .44)) : 0;
      bloom += (target - bloom) * (1 - Math.exp(-dt / 11000));
      gl.uniform2f(u.resolution, el.width, el.height);
      gl.uniform1f(u.time, elapsed);
      gl.uniform1f(u.energy, motion?.matches || !active ? 0 : smoothEnergy);
      gl.uniform1f(u.warmth, active ? bloom : 0);
      gl.uniform1f(u.strike, motion?.matches || !s.beat?.active ? 0 : Math.exp(-(now - struck) / 360));
      gl.uniform1f(u.downbeat, s.beat?.index === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      painted = true;
      el.dataset.renderer = "ready";
      if (!motion?.matches && active) frame = requestAnimationFrame(paint);
    };
    const start = () => {
      if (motion?.matches && painted && !changedSize) return;
      if (!disposed && !failed && !document.hidden && !frame) { previous = 0; frame = requestAnimationFrame(paint); }
    };
    wake.current = start;
    level.current.wake = start;
    const resized = () => { changedSize = true; start(); };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resized);
    resize?.observe(el);
    if (!resize) window.addEventListener("resize", resized);
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; previous = 0; } else start(); };
    const lost = (event: Event) => { event.preventDefault(); failed = true; cancelAnimationFrame(frame); frame = 0; el.dataset.renderer = "unavailable"; };
    document.addEventListener("visibilitychange", visibility);
    motion?.addEventListener("change", start);
    el.addEventListener("webglcontextlost", lost);
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
      release();
    };
  }, [level]);

  return <canvas className="pa-rendered-water" ref={canvas} aria-hidden="true" />;
}

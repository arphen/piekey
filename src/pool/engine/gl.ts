// Small raw-WebGL2 helpers: programs, render targets and ping-pong pairs. DOM-free.

export interface Program { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation> }

export interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

export interface Pair { read: Target; write: Target; swap(): void }

export interface Format { internal: number; format: number; type: number; filter: number }

export function formats(gl: WebGL2RenderingContext, floats: boolean): { r: Format; rg: Format; rgba: Format; rgba8: Format; rgba32: Format | null } {
  const half = gl.HALF_FLOAT;
  return {
    r: { internal: gl.R16F, format: gl.RED, type: half, filter: gl.LINEAR },
    rg: { internal: gl.RG16F, format: gl.RG, type: half, filter: gl.LINEAR },
    rgba: { internal: gl.RGBA16F, format: gl.RGBA, type: half, filter: gl.LINEAR },
    rgba8: { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR },
    // particle state needs full precision; only used when 32-bit colour buffers are renderable
    rgba32: floats ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST } : null,
  };
}

export function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("shader");
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader: ${log}`);
    }
    return s;
  };
  const vs = shader(gl.VERTEX_SHADER, vertex);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error("program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`link: ${log}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, "");
    const location = gl.getUniformLocation(program, info.name);
    if (location) uniforms.set(name, location);
  }
  return { program, uniforms };
}

export function target(gl: WebGL2RenderingContext, width: number, height: number, f: Format, wrap: number = gl.CLAMP_TO_EDGE, data: ArrayBufferView | null = null): Target {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!texture || !fbo) throw new Error("texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, width, height, 0, f.format, f.type, data);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  if (!data) gl.clear(gl.COLOR_BUFFER_BIT);
  return { texture, fbo, width, height };
}

export function pair(gl: WebGL2RenderingContext, width: number, height: number, f: Format, wrap?: number): Pair {
  const p = { read: target(gl, width, height, f, wrap), write: target(gl, width, height, f, wrap), swap() { const t = p.read; p.read = p.write; p.write = t; } };
  return p;
}

/** Checked once while building, never in the frame loop. */
export function complete(gl: WebGL2RenderingContext, t: Target): boolean {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
}

export function release(gl: WebGL2RenderingContext, t: Target | null | undefined): void {
  if (!t) return;
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.fbo);
}

export function releasePair(gl: WebGL2RenderingContext, p: Pair | null | undefined): void {
  if (!p) return;
  release(gl, p.read);
  release(gl, p.write);
}

/** A mipmapped photograph, mirrored at its edges. */
export function image(gl: WebGL2RenderingContext, source: TexImageSource): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Row 0 is the image's top: shaders sample in image coordinates (y down).
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  return texture;
}

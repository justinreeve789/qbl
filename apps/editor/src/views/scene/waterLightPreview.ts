import { RIPPLES_FRAG, SHAFTS_FRAG, waterLightSettings, type SceneWaterLight, type WaterLightSettings } from '@qbl/shared';

/**
 * Underwater light (layout.water_lights) moving on the scene canvas, with the game's own shaders
 * (shared waterLightShaders.ts) in a small WebGL canvas over its box. One canvas per light, kept
 * across redraws of the scene (the canvas is redrawn on every change; a new WebGL context each time
 * would soon run out). Animated while on the page, held still for people who ask for less motion.
 */

const VERTEX = `
attribute vec2 inPosition;
varying vec2 outTexCoord;
void main() {
  outTexCoord = vec2(inPosition.x, 1.0 - inPosition.y);
  gl_Position = vec4(inPosition * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}
`;

/** The longest side of a preview canvas, in its own pixels: enough to see, light to draw. */
const MAX_SIDE = 480;

interface Preview {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  programs: Partial<Record<'ripples' | 'shafts', WebGLProgram>>;
  light: SceneWaterLight;
  s: WaterLightSettings;
  time: number;
}

const previews = new Map<string, Preview>();
let frame = 0;
let last = 0;

function stillMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function compile(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const shader = (type: number, source: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[qbl] underwater light preview:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'inPosition');
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function draw(p: Preview) {
  const { gl, s, light } = p;
  let program = p.programs[s.kind];
  if (program === undefined) {
    program = compile(gl, s.kind === 'shafts' ? SHAFTS_FRAG : RIPPLES_FRAG) ?? undefined;
    if (!program) return;
    p.programs[s.kind] = program;
  }
  gl.viewport(0, 0, p.canvas.width, p.canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  const u = (name: string) => gl.getUniformLocation(program!, name);
  gl.uniform1f(u('uTime'), p.time);
  gl.uniform2f(u('uBox'), light.width, light.height);
  gl.uniform1f(u('uSize'), s.size);
  gl.uniform1f(u('uShape'), s.kind === 'shafts' ? s.spread : s.tilt);
  gl.uniform1f(u('uOval'), s.edge === 'oval' ? 1 : 0);
  gl.uniform4f(u('uColor'), ...rgb(s.color), s.strength);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function tick(now: number) {
  frame = 0;
  const dt = last ? Math.min(100, now - last) / 1000 : 0;
  last = now;
  let live = false;
  for (const p of previews.values()) {
    if (!p.canvas.isConnected) continue;
    live = true;
    p.time = (p.time + dt * p.s.speed) % 3600;
    draw(p);
  }
  if (live && !stillMotion()) frame = requestAnimationFrame(tick);
  else last = 0;
}

function start() {
  if (!frame && !stillMotion()) frame = requestAnimationFrame(tick);
}

/**
 * The preview canvas for one underwater light, up to date with its settings, or null where the
 * browser has no WebGL. `key` tells lights apart across redraws (its place in the scene's list).
 */
export function waterLightPreview(key: string, light: SceneWaterLight): HTMLCanvasElement | null {
  let p = previews.get(key);
  if (!p || p.gl.isContextLost()) {
    const canvas = document.createElement('canvas');
    canvas.className = 'water-light-preview';
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    p = { canvas, gl, programs: {}, light, s: waterLightSettings(light), time: 7.3 + previews.size * 11.3 };
    previews.set(key, p);
  }
  p.light = light;
  p.s = waterLightSettings(light);
  const scale = Math.min(1, MAX_SIDE / Math.max(light.width, light.height, 1));
  const w = Math.max(1, Math.round(light.width * scale));
  const h = Math.max(1, Math.round(light.height * scale));
  if (p.canvas.width !== w || p.canvas.height !== h) {
    p.canvas.width = w;
    p.canvas.height = h;
  }
  draw(p);
  start();
  return p.canvas;
}

import { FOG_FRAG, fogArea, fogCornerData, fogDirectionVector, fogRadial, fogSettings, fogTravelWrap, type FogArea, type FogSettings, type SceneFog } from '@qbl/shared';
import { compile, rgb, stillMotion } from './waterLightPreview';

/**
 * Fog (layout.fogs) drifting on the scene canvas, with the game's own shader (shared fog.ts) in a
 * small WebGL canvas over its outline's bounds. One canvas per fog, kept across redraws of the scene
 * (a new WebGL context on every change would soon run out). Animated while on the page, held still
 * for people who ask for less motion. The same as underwater light's preview (waterLightPreview.ts).
 */

/** The longest side of a preview canvas, in its own pixels: fog is soft, so this is plenty. */
const MAX_SIDE = 400;

interface Preview {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram | null | undefined;
  s: FogSettings;
  area: FogArea;
  time: number;
  travel: number;
}

const previews = new Map<string, Preview>();
let frame = 0;
let last = 0;

function draw(p: Preview) {
  const { gl, s, area } = p;
  if (p.program === undefined) p.program = compile(gl, FOG_FRAG);
  const program = p.program;
  if (!program || !area.corners) return;
  gl.viewport(0, 0, p.canvas.width, p.canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  const u = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1f(u('uTime'), p.time);
  gl.uniform1f(u('uTravel'), p.travel);
  gl.uniform2f(u('uBox'), area.width, area.height);
  gl.uniform1f(u('uSize'), s.size);
  gl.uniform2f(u('uDir'), ...fogDirectionVector(s.direction));
  gl.uniform1f(u('uRadial'), fogRadial(s.direction) ? 1 : 0);
  gl.uniform2f(u('uOrigin'), s.origin.x - area.x, s.origin.y - area.y);
  gl.uniform1f(u('uDensity'), s.density);
  gl.uniform4f(u('uColor'), ...rgb(s.color), s.opacity);
  gl.uniform4fv(u('uPoly'), fogCornerData(area));
  gl.uniform1f(u('uCorners'), area.corners.length);
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
    p.time = (p.time + dt) % 3600;
    const wrap = fogTravelWrap(p.s.size);
    p.travel = (((p.travel + (p.s.direction === 'inward' ? -1 : 1) * p.s.speed * dt) % wrap) + wrap) % wrap;
    draw(p);
  }
  if (live && !stillMotion()) frame = requestAnimationFrame(tick);
  else last = 0;
}

function start() {
  if (!frame && !stillMotion()) frame = requestAnimationFrame(tick);
}

/**
 * The preview canvas for one fog, up to date with its settings, or null where the browser has no
 * WebGL or the fog has no outline yet. `key` tells fogs apart across redraws (its place in the list).
 */
export function fogPreview(key: string, fog: SceneFog): HTMLCanvasElement | null {
  const area = fogArea(fog);
  if (!area.corners || !(area.width > 0) || !(area.height > 0)) return null;
  let p = previews.get(key);
  if (!p || p.gl.isContextLost()) {
    const canvas = document.createElement('canvas');
    canvas.className = 'fog-preview';
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    p = { canvas, gl, program: undefined, s: fogSettings(fog), area, time: 23.7 + previews.size * 17.1, travel: 0 };
    previews.set(key, p);
  }
  p.s = fogSettings(fog);
  p.area = area;
  const scale = Math.min(1, MAX_SIDE / Math.max(area.width, area.height, 1));
  const w = Math.max(1, Math.round(area.width * scale));
  const h = Math.max(1, Math.round(area.height * scale));
  if (p.canvas.width !== w || p.canvas.height !== h) {
    p.canvas.width = w;
    p.canvas.height = h;
  }
  draw(p);
  start();
  return p.canvas;
}

/**
 * Fog (Scene.fogs): its defaults, in one place, for the game, the editor's preview and the
 * validator; and the shader that draws it (GLSL ES 1.0, WebGL 1).
 */
import type { FogDirection, Point, SceneFog } from './types.js';
import { WATER_LIGHT_MAX_CORNERS, waterLightCornerData, type WaterLightArea } from './waterLight.js';

export const FOG_DIRECTIONS: readonly FogDirection[] = ['right', 'left', 'up', 'down', 'outward', 'inward'];
/** The most corners a fog's outline may have (the shader takes them as a fixed-size list, as underwater light does). */
export const FOG_MAX_CORNERS = WATER_LIGHT_MAX_CORNERS;

/** A fog with every setting filled in. Percentages become 0 to 1. */
export interface FogSettings {
  color: string;
  /** 0 to 1. */
  opacity: number;
  /** 0 to 1. */
  density: number;
  /** Pixels. */
  size: number;
  /** Pixels per second. */
  speed: number;
  direction: FogDirection;
  /** Outward and inward: where from (to), in scene pixels. */
  origin: Point;
  layer: 'front' | 'behind';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const goodPoint = (p: unknown): p is Point =>
  !!p && typeof (p as Point).x === 'number' && Number.isFinite((p as Point).x) && typeof (p as Point).y === 'number' && Number.isFinite((p as Point).y);

/** Where a fog is drawn: its outline's bounds, with the outline's corners (null when it has too few to draw). */
export type FogArea = WaterLightArea;

export function fogArea(f: Pick<SceneFog, 'shape'>): FogArea {
  const corners = (Array.isArray(f.shape) ? f.shape : []).filter(goodPoint).slice(0, FOG_MAX_CORNERS);
  if (corners.length < 3) return { x: 0, y: 0, width: 0, height: 0, corners: null };
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, corners };
}

/** The outline's corners for the shader, as underwater light takes them (waterLightCornerData). */
export const fogCornerData = (area: FogArea): Float32Array => waterLightCornerData(area);

export function fogSettings(f: SceneFog): FogSettings {
  const area = fogArea(f);
  return {
    color: f.color && /^#[0-9a-fA-F]{6}$/.test(f.color) ? f.color : '#e8edf2',
    opacity: clamp(num(f.opacity, 60), 0, 100) / 100,
    density: clamp(num(f.density, 55), 0, 100) / 100,
    size: clamp(num(f.size, 220), 20, 2000),
    speed: clamp(num(f.speed, 25), 0, 1000),
    direction: (FOG_DIRECTIONS as readonly string[]).includes(f.direction as string) ? f.direction! : 'right',
    origin: goodPoint(f.origin) ? { x: f.origin.x, y: f.origin.y } : { x: area.x + area.width / 2, y: area.y + area.height / 2 },
    layer: f.layer === 'behind' ? 'behind' : 'front',
  };
}

/** Whether a fog spreads from (or gathers to) a point, rather than drifting across. */
export const fogRadial = (d: FogDirection) => d === 'outward' || d === 'inward';

/** Which way fog drifting across moves, as a unit step in scene pixels (y down). Zero for outward and inward. */
export function fogDirectionVector(d: FogDirection): [number, number] {
  switch (d) {
    case 'left': return [-1, 0];
    case 'up': return [0, -1];
    case 'down': return [0, 1];
    case 'right': return [1, 0];
    default: return [0, 0];
  }
}

/**
 * How far fog has drifted, in pixels, is kept below this (fogTravelWrap), so it never grows past what
 * a GPU's floats keep exact: a whole number of 64 of the shader's cycles (0.6 of a wisp's size each,
 * its layers' offsets repeating every 64), so fog spreading from a point never jumps. Fog drifting
 * across jumps once when it wraps, after over a thousand sizes (more than half an hour at 25 px/s).
 */
export function fogTravelWrap(size: number): number {
  return 64 * 32 * 0.6 * size;
}

/** A first outline for new fog: a rectangle (four corners, more added on the canvas). */
export function fogStartShape(box: { x: number; y: number; width: number; height: number }): Point[] {
  const x0 = Math.round(box.x);
  const y0 = Math.round(box.y);
  const x1 = Math.round(box.x + box.width);
  const y1 = Math.round(box.y + box.height);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * The fog, drawn over the bounds of its outline (a Phaser Shader game object in the game, a small
 * WebGL canvas in the editor). Soft fractal noise, its shape bent by a slower noise so the wisps
 * curl and churn, carried along as the fog drifts. Fog spreading from a point is carried outward by
 * two layers in turn, each moving out a little way and fading as the other takes over (as a flow map
 * is), so it streams out for ever without stretching. It fades out, wispily, inside the outline.
 * Writes premultiplied colour, for the usual (NORMAL) blend.
 *
 * Uniforms:
 * - uTime: seconds, for its slow churning (wrapped).
 * - uTravel: how far it has drifted, in pixels (negative gathering inward), wrapped at FOG_TRAVEL_CYCLES sizes.
 * - uBox: the bounds' size in scene pixels.
 * - uSize: the size of its wisps, in pixels.
 * - uDir: drifting across, the unit direction (y down); uRadial 1 spreading from or gathering to uOrigin.
 * - uOrigin: that point, in pixels from the bounds' top left.
 * - uDensity: how much of the outline it covers, 0 to 1.
 * - uColor: its colour (rgb, 0 to 1) and its opacity now (a).
 * - uPoly, uCorners: the outline's corners, in pixels from the bounds' top left, two to a vec4 (fogCornerData).
 *
 * outTexCoord runs 0 to 1 across the bounds, with y = 1 at the top.
 */
export const FOG_FRAG = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;
uniform float uTravel;
uniform vec2 uBox;
uniform float uSize;
uniform vec2 uDir;
uniform float uRadial;
uniform vec2 uOrigin;
uniform float uDensity;
uniform vec4 uColor;
uniform vec4 uPoly[9];
uniform float uCorners;

varying vec2 outTexCoord;

// A hash without a sine, which loses precision far from 0 on some GPUs.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 7.7);
    amp *= 0.45;
  }
  return sum / 0.8718;
}

// The fog's thickness at q (in wisps), 0 to about 1: curling as a slower noise bends it.
float fogAt(vec2 q) {
  float t = uTime;
  vec2 bend = vec2(fbm(q * 0.55 + vec2(0.0, t * 0.045)), fbm(q * 0.55 + vec2(5.2, 1.3) - vec2(t * 0.038, 0.0)));
  return fbm(q + 1.1 * (bend - 0.5) + vec2(t * 0.012, -t * 0.009));
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * t);
}

// One side of the outline: its fade on p (0 on it, 1 a feather's width in), and whether a ray from p
// to the right crosses it. The fades of all the sides multiplied round the corners off.
void side(vec2 p, vec2 a, vec2 b, float feather, float rag, inout float fade, inout bool inside) {
  fade *= smoothstep(0.0, feather, segmentDistance(p, a, b) + rag);
  if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
}

// Inside the outline, rising from 0 at its edge to 1 a feather's width in (raggedly, by rag); 0 outside.
float inOutline(vec2 p, float feather, float rag) {
  float fade = 1.0;
  bool inside = false;
  vec2 first = uPoly[0].xy;
  for (int k = 0; k < 8; k++) {
    float i = float(2 * k);
    if (i >= uCorners) break;
    vec2 a = uPoly[k].xy;
    bool more = i + 1.0 < uCorners;
    vec2 b = more ? uPoly[k].zw : first;
    side(p, a, b, feather, rag, fade, inside);
    if (more) side(p, b, i + 2.0 < uCorners ? uPoly[k + 1].xy : first, feather, rag, fade, inside);
  }
  return inside ? fade : 0.0;
}

void main() {
  vec2 px = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uBox;
  float n;
  if (uRadial > 0.5) {
    // Two layers, each carried out (or in) a little way and fading as the other takes over. Near the
    // point they move slower, so nothing is carried across it (which would mirror the fog into rings).
    vec2 d = px - uOrigin;
    float r = length(d);
    vec2 dir = r > 0.001 ? d / r : vec2(0.0);
    float cycle = 0.6 * uSize;
    float ease = r / (r + cycle);
    float ph = uTravel / cycle;
    float a = fract(ph);
    float b = fract(ph + 0.5);
    float ka = mod(floor(ph), 64.0);
    float kb = mod(floor(ph + 0.5), 64.0);
    vec2 qa = (px - dir * a * cycle * ease) / uSize + vec2(hash(vec2(ka, 1.7)), hash(vec2(ka, 9.1))) * 40.0;
    vec2 qb = (px - dir * b * cycle * ease) / uSize + vec2(hash(vec2(kb, 4.3)), hash(vec2(kb, 2.9))) * 40.0 + vec2(31.7, 11.3);
    float wa = 1.0 - abs(2.0 * a - 1.0);
    float wb = 1.0 - wa;
    n = fogAt(qa) * wa + fogAt(qb) * wb;
    // Two noises mixed are flatter than one: give back some of the wisps' contrast.
    n = 0.5 + (n - 0.5) * inversesqrt(sqrt(wa * wa + wb * wb));
  } else {
    n = fogAt((px - uDir * uTravel) / uSize);
  }

  // Thin wisps with clear air between, or a bank with hardly a gap.
  float lo = mix(0.66, 0.12, uDensity);
  float fog = smoothstep(lo, lo + 0.38, n);
  fog = max(fog, smoothstep(0.55, 1.0, uDensity) * 0.55 * smoothstep(lo - 0.25, lo + 0.2, n));

  // Fading out inside the outline, raggedly, as fog does.
  float feather = min(uSize * 0.6, 0.3 * min(uBox.x, uBox.y));
  float edge = inOutline(px, feather, -(1.0 - n) * feather * 0.9);

  // Thicker and thinner even where it covers everything, so a bank is never a flat sheet.
  fog *= 0.72 + 0.28 * smoothstep(0.25, 0.8, n);
  float alpha = clamp(fog, 0.0, 1.0) * edge * uColor.a;
  vec3 tint = uColor.rgb * (0.92 + 0.08 * fog);
  gl_FragColor = vec4(tint * alpha, alpha);
}
`;

/**
 * Fragment shaders for light under water (Scene.water_lights), in GLSL ES 1.0 (WebGL 1). The game
 * (apps/client WaterLightSystem) draws them onto the box of a Phaser Shader game object with the ADD
 * blend, so they only ever brighten what is under them; the editor's canvas runs the same shaders in
 * a small preview. Both write premultiplied colour.
 *
 * Uniforms, shared by both:
 * - uTime: seconds, already scaled by the light's speed.
 * - uBox: the box's size in scene pixels.
 * - uSize: ripples, a cell's size at the front of the box; shafts, the gap between beams (pixels).
 * - uShape: ripples, how far the floor leans away (0 to 1); shafts, how much they fan out (0 to 1).
 * - uOval: 1 fades the light out in an oval, 0 at the box's edges.
 * - uColor: the light's colour (rgb, 0 to 1) and its strength now (a).
 * - Ripples only, uPoly and uCorners: an outline of its own (SceneWaterLight.shape), its corners in
 *   pixels from the box's top left, two to a vec4 (waterLightCornerData); uCorners 0 for the box.
 *
 * outTexCoord runs 0 to 1 across the box, with y = 1 at its top.
 */

const HEAD = `
#pragma phaserTemplate(shaderName)
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;
uniform vec2 uBox;
uniform float uSize;
uniform float uShape;
uniform float uOval;
uniform vec4 uColor;

varying vec2 outTexCoord;

// How far in from the edges, 0 at an edge rising to 1 (or inside an oval).
float edgeFade(float u, float v) {
  if (uOval > 0.5) {
    float r = length(vec2(u - 0.5, v - 0.5) * 2.0);
    return 1.0 - smoothstep(0.7, 1.0, r);
  }
  float band = min(80.0, 0.25 * min(uBox.x, uBox.y));
  vec2 m = min(vec2(u, v), 1.0 - vec2(u, v)) * uBox;
  return smoothstep(0.0, band, m.x) * smoothstep(0.0, band, m.y);
}
`;

/**
 * Ripples: the bright web of light on the floor of a pool. Cells whose centres wander; the light is
 * where two cells meet. Two webs of different sizes moving different ways, their walls bent by a
 * slow wave, make the light merge and split as real caustics do. The floor leans away: cells grow
 * smaller toward the top of the box (a true perspective, so the far floor is not stretched).
 *
 * `ripplesAt(u, v, lift, shift)` is the light at a point of the floor (u, v from 0 to 1 across the box, v 0
 * at its top), before its strength: both the floor (RIPPLES_FRAG) and the people and things standing
 * on it (RIPPLES_ON_FIGURE_FRAG) are lit by it, so the light on them is the light on the floor.
 * `lift` is how far above the floor, in scene pixels, a point of someone standing there is, and
 * `shift` moves the pattern (in ripples): on a body it is moved, so the light on it is not the floor
 * behind it carried on, which would make it look see-through.
 */
const RIPPLES_LIB = `
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

uniform vec4 uPoly[9];
uniform float uCorners;

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(p - a - ab * t);
}

// One side of the outline: how near p is to it, and whether a ray from p to the right crosses it.
void side(vec2 p, vec2 a, vec2 b, inout float near, inout bool inside) {
  near = min(near, segmentDistance(p, a, b));
  if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
}

// Inside the outline, rising from 0 at its edge to 1 a little way in; 0 outside. p in box pixels.
float shapeFade(vec2 p) {
  float near = 1.0e9;
  bool inside = false;
  vec2 first = uPoly[0].xy;
  for (int k = 0; k < 8; k++) {
    float i = float(2 * k);
    if (i >= uCorners) break;
    vec2 a = uPoly[k].xy;
    bool more = i + 1.0 < uCorners;
    vec2 b = more ? uPoly[k].zw : first;
    side(p, a, b, near, inside);
    if (more) side(p, b, i + 2.0 < uCorners ? uPoly[k + 1].xy : first, near, inside);
  }
  if (!inside) return 0.0;
  return smoothstep(0.0, min(80.0, 0.25 * min(uBox.x, uBox.y)), near);
}

// How far p is from the nearest wall between two cells: 0 on a wall.
float walls(vec2 p, float t) {
  vec2 g = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 h = hash2(g + o);
      vec2 c = o + 0.5 + 0.38 * sin(t * (0.55 + 0.5 * h.yx) + 6.2831 * h);
      float d = length(c - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}

float ripplesAt(float u, float v, float lift, vec2 shift) {
  float lean = uShape * 0.75;
  float depth = (1.0 - lean) + lean * v; // 1 at the front, smaller further off
  float z = 1.0 / depth;
  vec2 p = vec2((u - 0.5) * uBox.x * z, ((v - 1.0) * uBox.y - lift) * z) / uSize + shift;
  float t = uTime;
  // Bend the walls with two slow waves: real caustics are never straight.
  p += 0.32 * vec2(sin(p.y * 1.7 + t * 0.7), sin(p.x * 1.5 - t * 0.6));
  p += 0.12 * vec2(sin(p.y * 4.1 - t * 1.1), sin(p.x * 3.7 + t * 0.9));

  // Lines are a little wider far off, where the cells are small, so they do not shimmer; and thicker
  // and thinner along their length, as light gathers and spreads.
  float swell = 0.65 + 0.7 * (0.5 + 0.5 * sin(p.x * 1.9 + p.y * 1.3 - t * 0.8));
  float w = 0.085 * sqrt(z) * swell;
  float e1 = walls(p, t);
  float e2 = walls(p * 0.7 + vec2(5.2, 1.3), 3.0 - t * 0.7);
  float a = 1.0 - smoothstep(0.0, w, e1);
  float b = 1.0 - smoothstep(0.0, w * 2.2, e2);
  float glow = 1.0 - smoothstep(0.0, w * 4.0, e1);
  float light = a * a * (0.55 + 0.45 * swell) + 0.22 * b * b + 0.14 * glow;

  float far = mix(1.0, 0.55 + 0.45 * v, uShape);
  float edge = uCorners >= 3.0 ? shapeFade(vec2(u, v) * uBox) : edgeFade(u, v);
  return clamp(light, 0.0, 1.0) * edge * far;
}
`;

export const RIPPLES_FRAG = `${HEAD}${RIPPLES_LIB}
void main() {
  float u = outTexCoord.x;
  float v = 1.0 - outTexCoord.y; // 0 at the top (far), 1 at the bottom (near)
  float alpha = ripplesAt(u, v, 0.0, vec2(0.0)) * uColor.a;
  gl_FragColor = vec4(uColor.rgb * alpha, alpha);
}
`;

/**
 * The rippling light on someone or something standing in it: a Phaser filter (apps/client
 * waterLightFilter.ts) on a figure's own picture, so only the picture is lit, never the air around it.
 * The floor's light is behind every figure, so without this they would stand in it unlit.
 *
 * Someone standing up is lit by the light where their feet are, carried up their body and stretched
 * as light is on an upright surface, and brightening their own colours; something lying on the floor
 * (uFlat) by the floor's light under each point of it, so it carries on the floor's pattern. A little
 * of the light washes evenly over whoever stands in it, so they look lit between the bright lines too.
 *
 * Uniforms, besides those of the ripples (uColor.a is the strength on figures):
 * - uMainSampler: the figure's picture, premultiplied.
 * - uArea: the top left of the light's box, in scene pixels.
 * - uRect: the figure's picture in the scene (x, y, width, height); uFlipX 1 when it is mirrored.
 * - uFeet: where its feet are (the bottom of its picture), in scene pixels.
 * - uFlat: 1 for something lying on the floor, 0 for someone standing.
 */
export const RIPPLES_ON_FIGURE_FRAG = `${HEAD}
uniform sampler2D uMainSampler;
uniform vec2 uArea;
uniform vec4 uRect;
uniform float uFeet;
uniform float uFlat;
uniform float uFlipX;
${RIPPLES_LIB}
void main() {
  vec4 picture = texture2D(uMainSampler, outTexCoord);
  float across = uFlipX > 0.5 ? 1.0 - outTexCoord.x : outTexCoord.x;
  vec2 at = vec2(uRect.x + across * uRect.z, uRect.y + (1.0 - outTexCoord.y) * uRect.w);
  float u = (at.x - uArea.x) / uBox.x;
  float lift = uFeet - at.y;
  float v = (uFlat > 0.5 ? at.y : uFeet) - uArea.y;
  v /= uBox.y;
  vec3 added = vec3(0.0);
  if (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0) {
    if (uFlat > 0.5) {
      // Lying on the floor: lit just as the floor is, so it carries the floor's light on.
      added = uColor.rgb * (ripplesAt(u, v, 0.0, vec2(0.0)) * uColor.a * picture.a);
    } else {
      // Standing up: the light runs up the body slower than across, stretched as on a wall, with an
      // even wash so they look lit between the bright lines too. It brightens their own colours, as
      // light on a coloured surface does, with only a little white, so they never look pale or ghostly.
      float wash = uCorners >= 3.0 ? shapeFade(vec2(u, v) * uBox) : edgeFade(u, v);
      float light = (ripplesAt(u, v, lift * 0.6, vec2(13.7, 7.9)) + 0.15 * wash) * uColor.a;
      added = uColor.rgb * light * (1.1 * picture.rgb + 0.1 * picture.a);
    }
  }
  gl_FragColor = vec4(picture.rgb + added, picture.a);
}
`;

/**
 * Shafts: beams of light slanting down from the surface. Each pixel follows its beam back up to the
 * top of the box; soft noise along the top makes the beams, drifting and slowly brightening and
 * fading. They fan out from a point above the box: far above for side by side, closer to spread.
 */
export const SHAFTS_FRAG = `${HEAD}
float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}

void main() {
  float u = outTexCoord.x;
  float v = 1.0 - outTexCoord.y; // 0 at the top, 1 at the bottom
  vec2 px = vec2(u, v) * uBox;
  // Where they come from: high above (side by side) or just above the box (fanning wide).
  float d = uBox.y * (0.25 + 0.15 / max(uShape, 0.01));
  float sx = 0.5 * uBox.x + (px.x - 0.5 * uBox.x) * d / (px.y + d);
  float k = sx / uSize;
  float t = uTime;

  float n = 0.5 * noise(k + t * 0.15) + 0.3 * noise(k * 2.3 - t * 0.11 + 17.0) + 0.2 * noise(k * 5.1 + t * 0.07 + 41.0);
  float beams = pow(smoothstep(0.38, 0.95, n), 2.2);
  beams *= 0.6 + 0.4 * sin(t * 0.8 + k * 1.7);
  beams *= 0.85 + 0.15 * noise(v * 6.0 - t * 0.5 + k * 3.0);

  // In quickly at the top, fading out toward the bottom.
  float fall = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.3, 1.0, v)) * (1.0 - 0.35 * v);
  float side = uOval > 0.5 ? edgeFade(u, v) : smoothstep(0.0, 0.12, u) * smoothstep(0.0, 0.12, 1.0 - u);
  float alpha = clamp(beams, 0.0, 1.0) * fall * side * uColor.a;
  gl_FragColor = vec4(uColor.rgb * alpha, alpha);
}
`;

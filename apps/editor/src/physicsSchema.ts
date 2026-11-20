import { PHYSICS_MATERIALS, PHYSICS_MEASURES, PHYSICS_OPS } from '@qbl/shared';
import type { Field, Values } from './fields';

/**
 * The forms of a physics experiment (`physics` in a scene's layout). Keys with a dot are one
 * level down: `controls.play` is `physics.controls.play`. See packages/shared/src/physics.ts.
 */

const materials = Object.entries(PHYSICS_MATERIALS).map(([key, m]) => [key, m.label] as const);
const materialOf = (v: Values) => PHYSICS_MATERIALS[String(v.material ?? 'wood')] ?? PHYSICS_MATERIALS.wood!;
const is = (key: string, ...values: string[]) => (v: Values) => values.includes(String(v[key] ?? ''));

export const PHYSICS_SETTINGS_FIELDS: Field[] = [
  {
    key: 'mode', label: 'Who shares the experiment', kind: 'select', default: 'individual', wide: true, structural: true,
    options: [['individual', 'Each player has their own'], ['shared', 'Everyone in the scene (of a team) shares one']],
    hint: 'Each their own: the experiment runs in each player’s browser and nobody else sees what they do. Shared: the game server runs one experiment for everyone in the scene, so a team builds and tests together and sees the same thing. Testing a scene from the editor always runs it on your own.',
  },
  { key: 'gravity', label: 'Gravity (m/s²)', kind: 'number', min: 0, max: 100, step: 0.01, placeholder: '9.81 (Earth)', slider: { min: 0, max: 25, step: 0.01 }, hint: 'Earth 9.81, the Moon 1.62, Mars 3.71, Jupiter 24.79.' },
  {
    key: 'pixels_per_meter', label: 'Scene pixels in a metre', kind: 'number', min: 1, placeholder: '100', slider: { min: 20, max: 2000, step: 10 },
    hint: 'Sets the size of the world. 100: a 1920 px scene is 19 m wide, right for a bridge. 2000: it is about 1 m wide, right for a glass on a table. Things fall and swing as they would at that size.',
  },
  { key: 'depth', label: 'How thick everything is (m)', kind: 'number', min: 0.001, step: 0.01, placeholder: '0.1', slider: { min: 0.01, max: 1, step: 0.01 }, hint: 'The scene is flat, so masses and volumes of water need a thickness front to back.' },
  {
    key: '_floor', label: 'Floor', kind: 'select', default: 'bottom', structural: true,
    options: [['bottom', 'Along the bottom of the scene'], ['at', 'At a height I choose'], ['none', 'None: things fall out of the scene']],
  },
  { key: 'floor_y', label: 'Floor at (px from the top)', kind: 'number', when: is('_floor', 'at'), slider: { min: 0, max: 'scene' } },
  { key: 'walls', label: 'Walls up the left and right edges', kind: 'bool', default: true },
  { key: 'paused', label: 'Start paused: players press Play', kind: 'bool' },
  { key: 'controls.play', label: 'Play and pause button', kind: 'bool', default: true },
  { key: 'controls.reset', label: 'Reset button', kind: 'bool', default: true },
  { key: 'controls.slow', label: 'Slow motion button', kind: 'bool', default: true },
  { key: 'controls.gravity', label: 'Gravity chooser (Earth, Moon, Mars…)', kind: 'bool' },
  {
    key: 'controls.drop', label: 'Drop button', kind: 'tristate', placeholder: 'When something is held in place', options: [['true', 'Always'], ['false', 'Never']],
    hint: 'Drop lets go of everything that is held in place, all at once: for a fair race.',
  },
  { key: 'press.enabled', label: 'Press tool: hold on something to push down on it', kind: 'bool', wide: true, structural: true },
  { key: 'press.rate', label: 'Pushes harder by (N a second)', kind: 'number', min: 1, placeholder: '100', when: (v) => v['press.enabled'] === true },
  { key: 'press.max', label: 'Pushes at most (N)', kind: 'number', min: 1, placeholder: '5000', when: (v) => v['press.enabled'] === true },
];

/** What a body is made of and how it looks: shared by bodies and what the tray holds. */
const BODY_SHAPE_FIELDS: Field[] = [
  { key: 'shape', label: 'Shape', kind: 'select', default: 'circle', structural: true, options: [['circle', 'Circle (a ball)'], ['box', 'Box'], ['polygon', 'Polygon'], ['cup', 'Cup (a glass, a tank)']] },
  { key: 'radius', label: 'Radius (px)', kind: 'number', min: 1, placeholder: '40', slider: { min: 2, max: 400 }, when: is('shape', 'circle', '') },
  { key: 'width', label: 'Width (px)', kind: 'number', min: 1, placeholder: '80', slider: { min: 2, max: 'scene' }, when: is('shape', 'box', 'cup') },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 1, placeholder: '80', slider: { min: 2, max: 'scene' }, when: is('shape', 'box', 'cup') },
  { key: 'wall', label: 'Wall thickness (px)', kind: 'number', min: 1, placeholder: '12', slider: { min: 2, max: 60 }, when: is('shape', 'cup') },
  {
    key: 'points', label: 'Corners', kind: 'text', wide: true, when: is('shape', 'polygon'), placeholder: '-40,-30  40,-30  0,40',
    hint: 'Pairs of x,y from the middle of the body, separated by spaces. The shape is made convex if it is not.',
  },
  { key: 'material', label: 'Material', kind: 'select', default: 'wood', structural: true, options: materials },
  { key: 'mass', label: 'Mass (kg)', kind: 'number', min: 0.001, step: 0.1, placeholder: 'From the material and size' },
  { key: 'bounciness', label: 'Bounciness (0 to 1)', kind: 'number', min: 0, max: 1, step: 0.01, slider: { min: 0, max: 1 } },
  { key: 'friction', label: 'Friction', kind: 'number', min: 0, step: 0.01, slider: { min: 0, max: 1.5 } },
  { key: 'density', label: 'Density (kg/m³)', kind: 'number', min: 1 },
  { key: 'color', label: 'Colour', kind: 'color', placeholder: 'The material’s' },
  { key: 'media_id', label: 'Picture over it', kind: 'media', mediaType: 'image', placeholder: 'None: drawn as its shape', hint: 'Stretched over the body’s box.' },
  { key: 'label', label: 'Text on it', kind: 'text', placeholder: 'None' },
];

/** The material's own numbers, shown as what an empty box means. */
export function withMaterialPlaceholders(fields: Field[], values: Values): Field[] {
  const m = materialOf(values);
  return fields.map((f) =>
    f.key === 'bounciness' ? { ...f, placeholder: `${m.label}: ${m.bounciness}` }
      : f.key === 'friction' ? { ...f, placeholder: `${m.label}: ${m.friction}` }
        : f.key === 'density' ? { ...f, placeholder: `${m.label}: ${m.density}` }
          : f.key === 'color' ? { ...f, placeholder: `${m.label}’s` }
            : f);
}

export const PHYSICS_BODY_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'x', label: 'Middle X', kind: 'number', spot: { y: 'y', prompt: 'Click where the middle of the body goes' } },
  { key: 'y', label: 'Middle Y', kind: 'number' },
  { key: 'angle', label: 'Turned by (degrees)', kind: 'number', placeholder: '0', slider: { min: -180, max: 180, step: 1 } },
  ...BODY_SHAPE_FIELDS,
  { key: 'fixed', label: 'Fixed in place: never moves', kind: 'bool', structural: true, hint: 'A floor, a shelf, a cliff, a glass on a table.' },
  { key: 'held', label: 'Held in place until Drop', kind: 'bool', when: (v) => v.fixed !== true, hint: 'Stays where it is until players press Drop (or a physics action lets it go). Players can still move it to set it up.' },
  { key: 'draggable', label: 'Players can pick it up', kind: 'bool', default: true, when: (v) => v.fixed !== true },
  { key: 'damping', label: 'Slows down by itself', kind: 'number', min: 0, step: 0.1, placeholder: '0', slider: { min: 0, max: 5, step: 0.1 }, when: (v) => v.fixed !== true, hint: 'Air resistance or a stiff hinge. Around 2 settles a balance in a few swings.' },
  { key: 'hidden', label: 'Not drawn: the background shows it', kind: 'bool', hint: 'Still solid. For cliffs, tables and floors painted into the background.' },
  { key: 'marks', label: 'Ruler along it', kind: 'bool', hint: 'A tick every 10 cm from its middle, numbered every 50 cm.' },
];

export const PHYSICS_TRAY_FIELDS: Field[] = [
  { key: 'label', label: 'Name on the button', kind: 'text', placeholder: 'The material’s name' },
  { key: 'count', label: 'How many players can take', kind: 'number', min: 0, step: 1, placeholder: 'As many as they like' },
  ...BODY_SHAPE_FIELDS.map((f) => ({ ...f, key: `body.${f.key}`, when: f.when ? (v: Values) => f.when!(inner(v, 'body')) : undefined })),
];

export const PHYSICS_WATER_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'body_id', label: 'Fills the cup', kind: 'physics', physics: 'cups', placeholder: 'No cup: a tank in the background', structural: true, wide: true },
  { key: 'x', label: 'Left', kind: 'number', when: (v) => !v.body_id, spot: { y: 'y', prompt: 'Click the top left corner of the tank' } },
  { key: 'y', label: 'Top', kind: 'number', when: (v) => !v.body_id },
  { key: 'width', label: 'Width (px)', kind: 'number', min: 1, when: (v) => !v.body_id, slider: { min: 10, max: 'scene' } },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 1, when: (v) => !v.body_id, slider: { min: 10, max: 'scene' } },
  { key: 'level', label: 'Depth of water (px)', kind: 'number', min: 0, slider: { min: 0, max: 'scene' } },
  { key: 'density', label: 'Density (kg/m³)', kind: 'number', min: 1, placeholder: '1000 (fresh water)', hint: 'Sea water is 1025: things float a little higher in it.' },
  { key: 'color', label: 'Colour', kind: 'color', placeholder: 'Blue' },
  { key: 'marks', label: 'Scale up the side, in millilitres', kind: 'bool' },
];

export const PHYSICS_JOINT_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  {
    key: 'type', label: 'Kind', kind: 'select', default: 'pin', structural: true, wide: true,
    options: [['pin', 'Pin: turns about one point (a hinge, a pivot)'], ['weld', 'Weld: stuck together'], ['string', 'String: always the same length (a pendulum)'], ['spring', 'Spring: stretches and bounces back'], ['rope', 'Rope: at most its length, goes slack']],
  },
  { key: 'body_a', label: 'Joins', kind: 'physics', physics: 'bodies', placeholder: 'Choose a body', structural: true },
  { key: 'body_b', label: 'To', kind: 'physics', physics: 'bodies', placeholder: 'The world (a fixed point)', structural: true },
  { key: 'x', label: 'At X', kind: 'number', spot: { y: 'y', prompt: 'Click where the joint is (on the first body)' } },
  { key: 'y', label: 'At Y', kind: 'number' },
  { key: 'x2', label: 'Other end X', kind: 'number', when: is('type', 'string', 'spring', 'rope'), spot: { y: 'y2', prompt: 'Click where the other end is tied' } },
  { key: 'y2', label: 'Other end Y', kind: 'number', when: is('type', 'string', 'spring', 'rope') },
  { key: 'strength', label: 'Breaks at (N)', kind: 'number', min: 1, placeholder: 'Never breaks' },
  { key: 'min_angle', label: 'Turns at most this far one way (degrees)', kind: 'number', when: is('type', 'pin'), placeholder: 'No limit' },
  { key: 'max_angle', label: '… and the other way (degrees)', kind: 'number', when: is('type', 'pin'), placeholder: 'No limit' },
  { key: 'stiffness', label: 'Stiffness (bounces a second)', kind: 'number', min: 0.1, step: 0.1, placeholder: '2', when: is('type', 'spring') },
  { key: 'damping', label: 'Settles (0 bounces for ever, 1 at once)', kind: 'number', min: 0, max: 1, step: 0.05, placeholder: '0.3', when: is('type', 'spring'), slider: { min: 0, max: 1 } },
  { key: 'visible', label: 'Drawn', kind: 'bool', default: true },
];

export const PHYSICS_BUILD_FIELDS: Field[] = [
  { key: 'x', label: 'Left', kind: 'number', spot: { y: 'y', prompt: 'Click the top left corner of the building area' } },
  { key: 'y', label: 'Top', kind: 'number' },
  { key: 'width', label: 'Width (px)', kind: 'number', min: 1, slider: { min: 40, max: 'scene' } },
  { key: 'height', label: 'Height (px)', kind: 'number', min: 1, slider: { min: 40, max: 'scene' } },
  { key: 'grid', label: 'Beam ends snap every (px)', kind: 'number', min: 5, placeholder: '25', slider: { min: 10, max: 100, step: 5 } },
  { key: 'max_length', label: 'Longest beam (px)', kind: 'number', min: 1, placeholder: '250' },
  { key: 'budget', label: 'Budget', kind: 'number', min: 0, placeholder: 'No limit', hint: 'Each kind of beam costs so much a metre. A design may not cost more than this.' },
];

export const PHYSICS_BEAM_FIELDS: Field[] = [
  { key: 'label', label: 'Name', kind: 'text', placeholder: 'The material’s name' },
  { key: 'material', label: 'Material', kind: 'select', default: 'wood', options: materials, hint: 'Rope only pulls: it goes slack when pushed.' },
  { key: 'deck', label: 'Road: loads rest on it', kind: 'bool', hint: 'Other beams only hold the bridge up; weights pass through them.' },
  { key: 'cost_per_meter', label: 'Cost a metre', kind: 'number', min: 0, placeholder: '0' },
  { key: 'strength', label: 'Its joints break at (N)', kind: 'number', min: 1, placeholder: 'The material’s' },
  { key: 'thickness', label: 'Thickness (px)', kind: 'number', min: 1, placeholder: '12' },
];

const measures = Object.entries(PHYSICS_MEASURES).map(([key, m]) => [key, `${m.label}${m.unit ? ` (${m.unit})` : ''}`] as const);
const needs = (what: 'body' | 'water') => (v: Values) => PHYSICS_MEASURES[String(v.measure) as keyof typeof PHYSICS_MEASURES]?.needs === what;

export const PHYSICS_READOUT_FIELDS: Field[] = [
  { key: 'measure', label: 'Measures', kind: 'select', default: 'height', options: measures, structural: true, wide: true },
  { key: 'label', label: 'Shown as', kind: 'text', placeholder: 'The measure’s name' },
  { key: 'body_id', label: 'Of', kind: 'physics', physics: 'bodies', placeholder: 'Choose a body', when: needs('body') },
  { key: 'water_id', label: 'Of', kind: 'physics', physics: 'water', placeholder: 'The first water', when: needs('water') },
  { key: 'decimals', label: 'Decimal places', kind: 'number', min: 0, max: 4, step: 1 },
  { key: 'variable', label: 'Keep it in the variable', kind: 'variable', hint: 'So events, objectives and reports can use it: “Bounce height {{rubber_bounce}} m”.' },
  { key: 'hidden', label: 'Not shown on screen', kind: 'bool' },
];

const WHEN = [
  ['break', 'Something breaks'], ['enter', 'Something goes into a place or the water'], ['reading', 'A reading passes a value'],
  ['rest', 'Everything stops moving'], ['balanced', 'A body stays level'], ['spill', 'Water spills over'],
] as const;

export const PHYSICS_WATCH_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text', wide: true },
  { key: 'when', label: 'When', kind: 'select', default: 'break', options: WHEN, structural: true, wide: true, hint: '“Stops moving” and “stays level” wait until a player has done something, so they do not happen as the scene opens.' },
  { key: 'joint_id', label: 'Which joint', kind: 'physics', physics: 'joints', placeholder: 'Any joint or beam', when: is('when', 'break') },
  { key: 'body_id', label: 'Which body', kind: 'physics', physics: 'bodies', placeholder: 'Any that moves', when: is('when', 'enter', 'balanced') },
  { key: 'water_id', label: 'Which water', kind: 'physics', physics: 'water', placeholder: 'A place I mark (below)', when: is('when', 'enter', 'spill') },
  { key: 'region.x', label: 'Place: left', kind: 'number', when: (v) => v.when === 'enter' && !v.water_id, spot: { y: 'region.y', prompt: 'Click the top left corner of the place' } },
  { key: 'region.y', label: 'Place: top', kind: 'number', when: (v) => v.when === 'enter' && !v.water_id },
  { key: 'region.width', label: 'Place: width', kind: 'number', min: 1, when: (v) => v.when === 'enter' && !v.water_id },
  { key: 'region.height', label: 'Place: height', kind: 'number', min: 1, when: (v) => v.when === 'enter' && !v.water_id },
  { key: 'readout_id', label: 'Reading', kind: 'physics', physics: 'readouts', placeholder: 'Choose a readout', when: is('when', 'reading') },
  { key: 'operator', label: 'Is', kind: 'select', default: '>=', options: [['>', 'more than'], ['>=', 'at least'], ['<', 'less than'], ['<=', 'at most'], ['=', 'exactly']], when: is('when', 'reading') },
  { key: 'value', label: 'Value', kind: 'number', step: 0.01, when: is('when', 'reading', 'balanced'), placeholder: '2 (degrees)' },
  { key: 'hold', label: 'For (seconds)', kind: 'number', min: 0, step: 0.1, placeholder: '1.5', when: is('when', 'rest', 'balanced') },
  { key: 'event_id', label: 'Then run', kind: 'event', eventKinds: ['indirect'], placeholder: 'No event' },
  { key: 'variable', label: 'Then set the variable', kind: 'variable' },
  { key: 'set', label: 'To', kind: 'value', placeholder: 'The reading (or 1)', when: (v) => !!v.variable },
  { key: 'repeat', label: 'Again after a reset', kind: 'bool', default: true },
];

export const PHYSICS_ACTION_FIELDS: Field[] = [
  { key: 'op', label: 'Do', kind: 'select', default: 'play', options: PHYSICS_OPS, structural: true, wide: true },
  { key: 'value', label: 'Gravity (m/s²)', kind: 'number', min: 0, max: 100, step: 0.01, slider: { min: 0, max: 25, step: 0.01 }, when: is('op', 'gravity'), hint: 'Earth 9.81, the Moon 1.62, Mars 3.71, Jupiter 24.79.' },
  { key: 'entry_id', label: 'What, from the tray', kind: 'physics', physics: 'tray', placeholder: 'Choose', when: is('op', 'spawn') },
  { key: 'position_x', label: 'At X', kind: 'number', when: is('op', 'spawn'), spot: { y: 'position_y', prompt: 'Click where it appears' }, placeholder: 'The middle' },
  { key: 'position_y', label: 'At Y', kind: 'number', when: is('op', 'spawn'), placeholder: 'A third of the way down' },
  { key: 'body_id', label: 'Body', kind: 'physics', physics: 'bodies', when: is('op', 'remove', 'release'), placeholder: 'Every held body' },
];

// ------------------------------------------------------------------ dotted keys

/** The values of an object one level down (`body.shape` → `shape`), for `when` tests. */
export function inner(values: Values, prefix: string): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(values)) if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  return out;
}

/** An object's values with those of its objects one level down as dotted keys. */
export function flatten(obj: Record<string, unknown>, keys: string[]): Values {
  const out: Values = { ...obj };
  for (const key of keys) {
    const sub = obj[key];
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) for (const [k, v] of Object.entries(sub)) out[`${key}.${k}`] = v;
  }
  return out;
}

/** Set a value at a (possibly dotted) key of a copy of an object. Empty values are removed. */
export function setPath<T extends Record<string, unknown>>(obj: T, key: string, value: unknown): T {
  const empty = value == null || value === '';
  const [head, rest] = key.includes('.') ? [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)] : [key, null];
  const next: Record<string, unknown> = { ...obj };
  if (rest == null) {
    if (empty) delete next[head];
    else next[head] = value;
  } else {
    const sub = { ...((next[head] as Record<string, unknown> | undefined) ?? {}) };
    if (empty) delete sub[rest];
    else sub[rest] = value;
    if (Object.keys(sub).length) next[head] = sub;
    else delete next[head];
  }
  return next as T;
}

/** Corners typed as "x,y x,y …", or null if they cannot be read. */
export function parsePoints(text: string): Array<{ x: number; y: number }> | null {
  const pairs = text.trim().split(/[\s;]+/).filter(Boolean).map((p) => p.split(',').map(Number));
  if (pairs.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) return null;
  return pairs.map(([x, y]) => ({ x: x!, y: y! }));
}

export function showPoints(points: unknown): string {
  return Array.isArray(points) ? (points as Array<{ x: number; y: number }>).map((p) => `${p.x},${p.y}`).join('  ') : '';
}

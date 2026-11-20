/**
 * Makes the Physics Lab demo: a hall with doors to five physics experiments.
 *
 *   node tools/make-physics-lab.mjs
 *
 * Writes scenarios/physics-lab.json (the game server's file backend reads it), the backgrounds
 * in scenarios/assets/physicslab/backgrounds/ (from SVG, with rsvg-convert and ImageMagick), and
 * apps/api/database/seeders/scenarios/physics-lab.zip, which `qbl:seed` imports.
 *
 * Once seeded, the scenario is changed in the editor like any other. To ship a changed version,
 * export it as a ZIP from the editor and put it in place of physics-lab.zip, as for the
 * starship demo. This script is only how the first version was made.
 *
 * Ids are in the 750000s so the seeded rows cannot collide with ones a server already has.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const W = 1920;
const H = 1080;
let nextId = 750_000;
const id = () => ++nextId;

// ------------------------------------------------------------------ art

const font = `font-family="Montserrat, 'DejaVu Sans', sans-serif"`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
const wall = (top = '#eaf0f8', bottom = '#d3dcea') => `
  <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#wall)"/>`;

function hallArt() {
  const doors = DOORS.map((d) => `
    <g transform="translate(${d.x - 110} 410)">
      <rect x="-14" y="-14" width="248" height="398" rx="10" fill="#5b4a3f"/>
      <rect width="220" height="370" rx="6" fill="${d.color}"/>
      <rect x="20" y="22" width="180" height="140" rx="8" fill="#ffffff" opacity="0.22"/>
      <rect x="20" y="190" width="180" height="150" rx="8" fill="#000000" opacity="0.08"/>
      <circle cx="190" cy="200" r="9" fill="#f6d36b" stroke="#7a5a1d" stroke-width="3"/>
      <g transform="translate(110 92)">${d.icon}</g>
    </g>`).join('');
  return svg(`${wall()}
    <rect y="0" width="${W}" height="90" fill="#2c3e73"/>
    <text x="${W / 2}" y="62" text-anchor="middle" ${font} font-size="44" font-weight="800" fill="#ffffff" letter-spacing="8">PHYSICS LAB</text>
    <rect y="700" width="${W}" height="80" fill="#c2ccdc"/>
    <rect y="776" width="${W}" height="10" fill="#8f9bb0"/>
    <polygon points="0,786 ${W},786 ${W},${H} 0,${H}" fill="#9fb0c8"/>
    ${Array.from({ length: 13 }, (_, i) => `<line x1="${(i - 6) * 330 + W / 2}" y1="${H}" x2="${(i - 6) * 150 + W / 2}" y2="786" stroke="#8597b3" stroke-width="3"/>`).join('')}
    ${[850, 930, 1020].map((y) => `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#8597b3" stroke-width="3"/>`).join('')}
    ${doors}`);
}

const ICONS = {
  bounce: `<circle cx="-38" cy="18" r="16" fill="#e94b3c"/><path d="M -60 40 Q -38 -60 -6 34 Q 14 -24 34 34 Q 48 6 60 34" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12"/><rect x="-70" y="40" width="140" height="8" rx="4" fill="#ffffff"/>`,
  water: `<path d="M -42 -50 L -36 50 L 36 50 L 42 -50" fill="#ffffff" opacity="0.5" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/><rect x="-36" y="0" width="72" height="48" fill="#3d9be0"/><circle cx="0" cy="18" r="16" fill="#7d7468"/>`,
  bridge: `<path d="M -70 30 L 70 30 M -70 30 L -35 -20 L 0 30 L 35 -20 L 70 30 M -35 -20 L 35 -20" fill="none" stroke="#ffffff" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/><rect x="-80" y="30" width="22" height="30" fill="#ffffff"/><rect x="58" y="30" width="22" height="30" fill="#ffffff"/>`,
  pendulum: `<line x1="-60" y1="-50" x2="60" y2="-50" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/><line x1="0" y1="-50" x2="34" y2="36" stroke="#ffffff" stroke-width="5"/><circle cx="34" cy="36" r="18" fill="#f6d36b"/><path d="M -40 30 A 70 70 0 0 0 40 30" fill="none" stroke="#ffffff" stroke-width="4" stroke-dasharray="6 8"/>`,
  balance: `<polygon points="0,-6 -22,54 22,54" fill="#ffffff"/><rect x="-74" y="-18" width="148" height="12" rx="6" fill="#ffffff"/><rect x="-70" y="-46" width="30" height="28" fill="#f6d36b"/><rect x="40" y="-46" width="30" height="28" fill="#e94b3c"/>`,
};

const DOORS = [
  { key: 'bounce', x: 260, color: '#e9823c', label: 'Bounce lab', icon: ICONS.bounce },
  { key: 'water', x: 600, color: '#3d8fd6', label: 'Sink or float', icon: ICONS.water },
  { key: 'bridge', x: 960, color: '#7b5bd6', label: 'Bridge builders', icon: ICONS.bridge },
  { key: 'pendulum', x: 1320, color: '#2fa36b', label: 'Pendulums', icon: ICONS.pendulum },
  { key: 'balance', x: 1660, color: '#d6457a', label: 'Balance beam', icon: ICONS.balance },
];

function bounceArt() {
  // 200 px to a metre; the floor at y = 980.
  const floor = 980;
  let ruler = '';
  for (let cm = 0; cm <= 400; cm += 10) {
    const y = floor - cm * 2;
    const major = cm % 50 === 0;
    ruler += `<line x1="120" y1="${y}" x2="${major ? 200 : 168}" y2="${y}" stroke="#1b1b2f" stroke-width="${major ? 4 : 2}"/>`;
    if (major && cm > 0) ruler += `<text x="210" y="${y + 9}" ${font} font-size="26" font-weight="700" fill="#1b1b2f">${(cm / 100).toFixed(1)} m</text>`;
    if (cm % 100 === 0 && cm > 0) ruler += `<line x1="300" y1="${y}" x2="${W - 40}" y2="${y}" stroke="#7d8db0" stroke-width="2" stroke-dasharray="14 12" opacity="0.6"/>`;
  }
  return svg(`${wall('#eef3f9', '#dbe3ef')}
    <rect x="110" y="${floor - 820}" width="20" height="820" fill="#f6d36b" stroke="#1b1b2f" stroke-width="3"/>
    ${ruler}
    <rect y="${floor}" width="${W}" height="${H - floor}" fill="#c99a63"/>
    ${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 130}" y1="${floor}" x2="${i * 130 - 40}" y2="${H}" stroke="#a77b48" stroke-width="3"/>`).join('')}
    <rect y="${floor}" width="${W}" height="6" fill="#8d6538"/>`);
}

function waterArt() {
  const table = 900;
  return svg(`${wall('#f1f6f2', '#d9e6dd')}
    ${Array.from({ length: 9 }, (_, r) => Array.from({ length: 21 }, (_, c) => `<rect x="${c * 96 + (r % 2) * 48 - 48}" y="${r * 100}" width="92" height="96" rx="6" fill="#ffffff" opacity="0.35"/>`).join('')).join('')}
    <rect x="1480" y="120" width="320" height="240" rx="14" fill="#9cc7ea" stroke="#5b6b8c" stroke-width="10"/>
    <line x1="1640" y1="120" x2="1640" y2="360" stroke="#5b6b8c" stroke-width="8"/>
    <rect y="${table}" width="${W}" height="44" fill="#8a5a33"/>
    <rect y="${table}" width="${W}" height="8" fill="#b07a48"/>
    <rect y="${table + 44}" width="${W}" height="${H - table - 44}" fill="#4f3a2a"/>
    <rect x="120" y="${table + 44}" width="60" height="${H}" fill="#3e2d20"/>
    <rect x="${W - 180}" y="${table + 44}" width="60" height="${H}" fill="#3e2d20"/>`);
}

function bridgeArt() {
  const top = 600;
  const cliff = (x0, x1, flip) => {
    const edge = flip ? x0 : x1;
    const out = flip ? x1 : x0;
    return `<polygon points="${out},${top} ${edge},${top} ${edge + (flip ? 30 : -30)},${top + 160} ${edge + (flip ? -10 : 10)},${top + 300} ${edge + (flip ? 50 : -50)},${H} ${out},${H}" fill="#8a7a66"/>
      <rect x="${Math.min(x0, x1)}" y="${top - 18}" width="${Math.abs(x1 - x0)}" height="26" fill="#5fa35a"/>
      <rect x="${Math.min(x0, x1)}" y="${top - 18}" width="${Math.abs(x1 - x0)}" height="8" fill="#7fc27a"/>
      ${[0, 1, 2, 3].map((i) => `<ellipse cx="${(x0 + x1) / 2 + (i - 1.5) * 110}" cy="${top + 120 + i * 90}" rx="70" ry="28" fill="#776856"/>`).join('')}`;
  };
  return svg(`
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0f5"/><stop offset="1" stop-color="#e6f5ff"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <polygon points="0,560 260,380 520,520 760,330 1060,540 1300,360 1600,520 1920,400 1920,1080 0,1080" fill="#b9c9dc"/>
    <polygon points="0,640 300,520 640,620 980,500 1300,630 1620,520 1920,620 1920,1080 0,1080" fill="#9fb3c9"/>
    <rect y="980" width="${W}" height="100" fill="#3d8fd6"/>
    ${[1000, 1030, 1060].map((y) => `<path d="M 560 ${y} q 40 -10 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="#bfe0ff" stroke-width="4" opacity="0.7"/>`).join('')}
    ${cliff(0, 560, false)}
    ${cliff(1920, 1360, true)}
    <circle cx="200" cy="150" r="70" fill="#fff4b0"/>`);
}

function pendulumArt() {
  return svg(`${wall('#f3eefa', '#ddd5ea')}
    <rect x="240" y="120" width="1440" height="26" rx="8" fill="#5f6670"/>
    <rect x="240" y="120" width="1440" height="8" rx="4" fill="#8d99a6"/>
    ${[260, 1640].map((x) => `<rect x="${x}" y="60" width="20" height="100" fill="#3e444c"/>`).join('')}
    ${[['A', 380, '0.5 m'], ['B', 760, '1 m'], ['C', 1140, '1 m'], ['D', 1520, '2 m']].map(([l, x, len]) => `<text x="${x}" y="100" text-anchor="middle" ${font} font-size="30" font-weight="800" fill="#2c3e73">${l} · ${len}</text>`).join('')}
    <rect y="1060" width="${W}" height="20" fill="#9a8cb6"/>`);
}

function balanceArt() {
  const floor = 1000;
  return svg(`${wall('#fdf1f4', '#efd9e0')}
    <rect y="${floor}" width="${W}" height="${H - floor}" fill="#b98aa0"/>
    <rect x="1560" y="${floor - 30}" width="220" height="30" rx="6" fill="#4a3f55"/>
    <rect x="1655" y="400" width="30" height="${floor - 400}" fill="#5c4f6b"/>
    <rect x="940" y="396" width="745" height="28" rx="6" fill="#5c4f6b"/>
    <rect x="954" y="420" width="12" height="48" fill="#5c4f6b"/>`);
}

// ------------------------------------------------------------------ the document

const media = [];
function background(key, art) {
  const mediaId = id();
  media.push({ id: mediaId, type: 'image', url: `backgrounds/${key}.jpg`, filename: `${key}.jpg`, width: W, height: H, scale_x: 1, scale_y: 1, priority: 1, art });
  return mediaId;
}

const variables = [];
function variable(name, value = 0, scope = 'player') {
  variables.push({ id: id(), variable_name: name, default_value: value, scope, persist: true });
  return name;
}

const scenes = [];
function action(type, attrs) {
  return { id: id(), type, blocking: true, ...attrs };
}
function event(sceneId, actions, extra = {}) {
  const eventId = id();
  return { id: eventId, scene_id: sceneId, overridable: false, block_hotspots: false, conditions: [], ...extra, actions: actions.map((a, i) => ({ ...a, event_id: eventId, sequence: i + 1 })) };
}
function textOverlay(text, duration = 9000, alignment = 'bottom center') {
  return action('text_overlay', { text, alignment, text_font_size: 26, duration });
}
function labelled(sceneId, x, y, radius, text, actions, labelY = y) {
  const e = event(sceneId, actions, { position_x: x, position_y: y, radius, activate_by_trigger: true });
  e.labels = [{ id: id(), event_id: e.id, type: 'text', position_x: x, position_y: labelY, scale_x: 1, scale_y: 1, text, placement: 'front' }];
  return e;
}

const SCENARIO_ID = 750_001;
const sceneIds = { hall: id(), bounce: id(), water: id(), bridge: id(), pendulum: id(), balance: id() };

/**
 * What an experiment says, at the top of the screen: its instructions on arriving, then what
 * the player found out. Each is an overridable event, so a newer message takes the older's place.
 */
function message(sceneId, text, duration, shortname) {
  return event(sceneId, [textOverlay(text, duration, 'top center')], { overridable: true, ...(shortname ? { shortname } : {}) });
}

function experiment(key, subtitle, physics, intro, extraEvents = []) {
  const sceneId = sceneIds[key];
  const indirect = extraEvents.map((make) => make(sceneId));
  const back = labelled(sceneId, 190, 1040, 70, '← Back to the hall', [action('jump', { scene_id: sceneIds.hall, spawn_point: `from-${key}` })]);
  // Watches name their events by shortname here; they are given ids below.
  for (const w of physics.watches ?? []) {
    if (typeof w.event_id === 'string') w.event_id = indirect.find((e) => e.shortname === w.event_id)?.id ?? null;
  }
  scenes.push({
    id: sceneId, shortname: key, scenario_id: SCENARIO_ID, sequence: scenes.length + 1, subtitle,
    is_intro_scene: false, zoom: 1, show_avatars: false, width: W, height: H,
    background_media: [{ media_id: background(key, ART[key]), display_width: W, display_height: H }], foreground_media: [],
    walkable_areas: [], blocked_areas: [], spawn_points: [{ name: 'default', position_x: 960, position_y: 1000 }], scale_areas: [], items: [], characters: [],
    physics,
    start_events: [message(sceneId, intro, 15000)],
    end_events: [], hotspots: [back], indirect_events: indirect,
  });
}

const ART = { hall: hallArt(), bounce: bounceArt(), water: waterArt(), bridge: bridgeArt(), pendulum: pendulumArt(), balance: balanceArt() };

// The hall: walk to a door and click it.
{
  const sceneId = sceneIds.hall;
  scenes.push({
    id: sceneId, shortname: 'hall', scenario_id: SCENARIO_ID, sequence: 1, subtitle: 'The physics lab',
    is_intro_scene: false, zoom: 1, show_avatars: true, width: W, height: H,
    background_media: [{ media_id: background('hall', ART.hall), display_width: W, display_height: H }], foreground_media: [],
    walkable_areas: [[{ x: 0, y: 800 }, { x: W, y: 800 }, { x: W, y: H }, { x: 0, y: H }]], blocked_areas: [],
    spawn_points: [{ name: 'default', position_x: 960, position_y: 960 }, ...DOORS.map((d) => ({ name: `from-${d.key}`, position_x: d.x, position_y: 870 }))],
    scale_areas: [], items: [], characters: [],
    start_events: [event(sceneId, [textOverlay('Welcome to the physics lab. Walk up to a door and click it to try an experiment.', 8000, 'top center')], {
      conditions: [{ id: id(), type: 'variable', variable: 'visited_lab', operator: '=', operand: 0 }],
    }), event(sceneId, [action('variable', { name: 'visited_lab', operator: 'set', operand: 1 })])],
    end_events: [],
    hotspots: DOORS.map((d) => labelled(sceneId, d.x, 600, 140, d.label, [action('jump', { scene_id: sceneIds[d.key], spawn_point: 'default' })], 380)),
    indirect_events: [],
  });
}
variable('visited_lab');

// 1. Bounce: five balls of different materials held 2 m above the floor (200 px to a metre).
{
  const balls = [['rubber', 560], ['plastic', 760], ['glass', 960], ['wood', 1160], ['clay', 1360]];
  variable('bounce_done');
  variable('rubber_bounce');
  experiment('bounce', 'Which ball bounces highest?', {
    enabled: true, mode: 'individual', pixels_per_meter: 200, floor_y: 980,
    controls: { gravity: true },
    bodies: balls.map(([material, x]) => ({ id: material, name: `${material} ball`, shape: 'circle', x, y: 980 - 400 - 34, radius: 34, material, held: true, label: material[0].toUpperCase() + material.slice(1) })),
    readouts: balls.map(([material]) => ({ id: `${material}-bounce`, label: `${material[0].toUpperCase() + material.slice(1)} bounced`, measure: 'bounce_height', body_id: material, ...(material === 'rubber' ? { variable: 'rubber_bounce' } : {}) })),
    watches: [{ id: 'all-still', name: 'Every ball has stopped', when: 'rest', hold: 1.5, variable: 'bounce_done', set: 1, event_id: 'compare' }],
  }, 'Five balls, each of a different material, 2 m above the floor. Press Drop and read how high each one bounces. Drag a ball up or down first to drop it from somewhere else.', [
    (sceneId) => message(sceneId, 'Compare the bounce heights. A bouncy ball gives back most of the energy it hits the floor with; clay keeps almost none. Reset and drop them from higher, or try the Moon’s gravity.', 12000, 'compare'),
  ]);
}

// 2. Sink or float: a glass of water and a brim-full overflow can on a table (2000 px to a metre).
{
  variable('water_rise');
  variable('spilled');
  variable('eureka');
  const rock = (r) => Array.from({ length: 7 }, (_, i) => ({ x: Math.round(Math.cos((i / 7) * Math.PI * 2) * r * (0.85 + 0.15 * Math.sin(i * 2.3))), y: Math.round(Math.sin((i / 7) * Math.PI * 2) * r * (0.8 + 0.2 * Math.cos(i * 1.7))) }));
  experiment('water', 'Sink or float', {
    enabled: true, mode: 'individual', pixels_per_meter: 2000, depth: 0.08, floor_y: 900,
    bodies: [
      { id: 'glass', name: 'Glass', shape: 'cup', x: 640, y: 900 - 210, width: 320, height: 420, wall: 14, fixed: true, material: 'glass' },
      { id: 'can', name: 'Overflow can', shape: 'cup', x: 1300, y: 900 - 180, width: 260, height: 360, wall: 14, fixed: true, material: 'steel', color: '#c3ccd6' },
      { id: 'rock', name: 'Rock', shape: 'polygon', x: 1700, y: 860, points: rock(40), material: 'rock' },
    ],
    water: [
      { id: 'glass-water', name: 'Water in the glass', body_id: 'glass', level: 180, marks: true },
      { id: 'can-water', name: 'Water in the overflow can', body_id: 'can', level: 342 },
    ],
    tray: [
      { id: 'small-rock', label: 'Small rock', count: 3, body: { shape: 'polygon', points: rock(34), material: 'rock' } },
      { id: 'big-rock', label: 'Big rock', count: 2, body: { shape: 'polygon', points: rock(70), material: 'rock' } },
      { id: 'steel-ball', label: 'Steel ball', count: 3, body: { shape: 'circle', radius: 32, material: 'steel' } },
      { id: 'cork', label: 'Cork', count: 3, body: { shape: 'box', width: 90, height: 50, material: 'cork' } },
      { id: 'wood', label: 'Wood block', count: 3, body: { shape: 'box', width: 80, height: 80, material: 'wood' } },
      { id: 'ice', label: 'Ice cube', count: 3, body: { shape: 'box', width: 70, height: 70, material: 'ice' } },
    ],
    readouts: [
      { id: 'level', label: 'Water in the glass', measure: 'water_level', water_id: 'glass-water' },
      { id: 'rise', label: 'It rose by', measure: 'water_rise', water_id: 'glass-water', variable: 'water_rise' },
      { id: 'pushed', label: 'Pushed aside', measure: 'displaced', water_id: 'glass-water' },
      { id: 'spilt', label: 'Spilled from the can', measure: 'spilled', water_id: 'can-water', variable: 'spilled' },
    ],
    watches: [
      { id: 'risen', name: 'The water rose 1 cm', when: 'reading', readout_id: 'rise', operator: '>=', value: 1, event_id: 'risen' },
      { id: 'overflow', name: 'The can overflowed', when: 'spill', water_id: 'can-water', variable: 'eureka', set: 1, event_id: 'eureka' },
    ],
  }, 'Drop the rock into the glass and watch the water level. Take more things from the tray: which sink, and which float? The can on the right is full to the brim.', [
    (sceneId) => message(sceneId, 'The water rose! Whatever is under water pushes aside its own volume of water, so the level goes up.', 9000, 'risen'),
    (sceneId) => message(sceneId, 'Eureka! The water that spilled out of the full can is the volume of what you put in (if it sank all the way under).', 10000, 'eureka'),
  ]);
}

// 3. Bridge builders: span the canyon, then load it (100 px to a metre). Shared by the team.
{
  variable('bridge_load');
  variable('bridge_record');
  variable('bridge_passed');
  experiment('bridge', 'Bridge builders', {
    enabled: true, mode: 'shared', pixels_per_meter: 100, floor_y: null,
    press: { enabled: true, rate: 400, max: 20000 },
    bodies: [
      { id: 'left-cliff', name: 'Left cliff', shape: 'box', x: 280, y: 600 + 240, width: 560, height: 480, fixed: true, material: 'rock', hidden: true },
      { id: 'right-cliff', name: 'Right cliff', shape: 'box', x: 1640, y: 600 + 240, width: 560, height: 480, fixed: true, material: 'rock', hidden: true },
    ],
    build: {
      x: 520, y: 360, width: 880, height: 440, grid: 40, max_length: 200, budget: 3000,
      anchors: [{ x: 560, y: 600 }, { x: 1360, y: 600 }, { x: 560, y: 720 }, { x: 1360, y: 720 }],
      beams: [
        { material: 'wood', label: 'Road', deck: true, cost_per_meter: 100, thickness: 14 },
        { material: 'wood', label: 'Wood', cost_per_meter: 50 },
        { material: 'steel', label: 'Steel', cost_per_meter: 200 },
        { material: 'rope', label: 'Rope', cost_per_meter: 20 },
      ],
    },
    tray: [
      { id: 'weight', label: '20 kg', count: 10, body: { shape: 'box', width: 40, height: 40, mass: 20, material: 'steel', label: '20' } },
      { id: 'crate', label: '100 kg crate', count: 3, body: { shape: 'box', width: 70, height: 70, mass: 100, material: 'wood', label: '100' } },
    ],
    readouts: [
      { id: 'cost', label: 'Cost', measure: 'cost' },
      { id: 'load', label: 'Carrying', measure: 'load', variable: 'bridge_load' },
      { id: 'record', label: 'Most it held', measure: 'max_load', variable: 'bridge_record' },
      { id: 'pressed', label: 'Broke while pressing with', measure: 'break_force' },
      { id: 'strain', label: 'Most strained beam', measure: 'stress' },
    ],
    watches: [
      { id: 'strong', name: 'Carried 2000 N', when: 'reading', readout_id: 'record', operator: '>=', value: 2000, variable: 'bridge_passed', set: 1, event_id: 'strong' },
      { id: 'snap', name: 'Something broke', when: 'break', event_id: 'snap' },
    ],
  }, 'Build a bridge across the canyon: drag from a yellow footing to lay a beam, then from its end to lay the next. Road is what weights sit on. Press Test it, then load it with weights or hold the Press tool on it. Everyone here builds the same bridge.', [
    (sceneId) => message(sceneId, 'Your bridge carried 2,000 N, the weight of about 200 kg. Can you make it hold more for less money?', 10000, 'strong'),
    (sceneId) => message(sceneId, 'Snap! Beams that form triangles share the load. Go back to building and strengthen where it broke.', 9000, 'snap'),
  ]);
}

// 4. Pendulums: four, of two lengths and two weights (200 px to a metre). Press Play to let them go together.
{
  variable('period_short');
  variable('period_long');
  variable('pendulum_done');
  const pendulums = [['A', 380, 100, 'steel', 22], ['B', 760, 200, 'steel', 26], ['C', 1140, 200, 'wood', 26], ['D', 1520, 400, 'steel', 26]];
  const swing = 0.35; // radians: how far each is pulled aside
  const bob = ([name, x, len, material, r]) => ({ id: `bob-${name}`, name: `Bob ${name}`, shape: 'circle', x: Math.round(x + len * Math.sin(swing)), y: Math.round(140 + len * Math.cos(swing)), radius: r, material, label: name });
  experiment('pendulum', 'Pendulums', {
    enabled: true, mode: 'individual', pixels_per_meter: 200, floor_y: 1060, paused: true,
    controls: { gravity: true },
    bodies: pendulums.map(bob),
    joints: pendulums.map((p) => {
      const b = bob(p);
      return { id: `string-${p[0]}`, type: 'string', body_a: b.id, x: b.x, y: b.y, x2: p[1], y2: 140 };
    }),
    readouts: [
      ...pendulums.map(([name, , len, material]) => ({ id: `period-${name}`, label: `${name} (${len / 200} m, ${material}) swing`, measure: 'period', body_id: `bob-${name}`, ...(name === 'A' ? { variable: 'period_short' } : name === 'D' ? { variable: 'period_long' } : {}) })),
      { id: 'swings-D', label: 'D swings', measure: 'swings', body_id: 'bob-D', hidden: true },
    ],
    watches: [{ id: 'timed', name: 'D has swung three times', when: 'reading', readout_id: 'swings-D', operator: '>=', value: 3, variable: 'pendulum_done', set: 1, event_id: 'compare' }],
  }, 'Press Play to let all four pendulums go at once. B and C have the same string but different weights; A, B and D have different strings. Which takes longest to swing? You can grab a bob, pull it aside and let go.', [
    (sceneId) => message(sceneId, 'B (steel) and C (wood) swing in the same time: the weight makes no difference. A longer string swings more slowly: four times the length takes twice the time.', 12000, 'compare'),
  ]);
}

// 5. Balance beam: a beam hung from a stand, with a 2 kg weight on it (400 px to a metre).
{
  variable('balanced');
  experiment('balance', 'Balance beam', {
    enabled: true, mode: 'individual', pixels_per_meter: 400, floor_y: 1000,
    bodies: [
      { id: 'beam', name: 'Beam', shape: 'box', x: 960, y: 600, width: 1000, height: 18, mass: 10, friction: 1, damping: 2, material: 'wood', marks: true },
      { id: 'hanger', name: 'Hanger', shape: 'box', x: 960, y: 535, width: 10, height: 112, mass: 0.5, material: 'steel', draggable: false },
      { id: 'two', name: '2 kg weight', shape: 'box', x: 760, y: 600 - 9 - 35, width: 70, height: 70, mass: 2, friction: 1, material: 'steel', color: '#e9823c', label: '2 kg' },
    ],
    joints: [
      { id: 'pivot', type: 'pin', body_a: 'hanger', x: 960, y: 480, min_angle: -25, max_angle: 25 },
      { id: 'weld', type: 'weld', body_a: 'hanger', body_b: 'beam', x: 960, y: 595, visible: false },
    ],
    tray: [
      { id: 'one', label: '1 kg', count: 4, body: { shape: 'box', width: 60, height: 60, mass: 1, friction: 1, material: 'steel', color: '#3d8fd6', label: '1 kg' } },
      { id: 'half', label: '500 g', count: 4, body: { shape: 'box', width: 46, height: 46, mass: 0.5, friction: 1, material: 'steel', color: '#2fa36b', label: '½' } },
      { id: 'two-more', label: '2 kg', count: 1, body: { shape: 'box', width: 70, height: 70, mass: 2, friction: 1, material: 'steel', color: '#e9823c', label: '2 kg' } },
    ],
    readouts: [{ id: 'tilt', label: 'Tilt', measure: 'angle', body_id: 'beam' }],
    watches: [{ id: 'level', name: 'The beam is level', when: 'balanced', body_id: 'beam', value: 1, hold: 2, variable: 'balanced', set: 1, event_id: 'level' }],
  }, 'The 2 kg weight sits 0.5 m left of the middle, so the beam tips. Take weights from the tray and put them on the right to level it. The ruler shows how far from the middle each one is.', [
    (sceneId) => message(sceneId, 'Balanced! Each side’s turning effect is its weight times its distance from the middle: 2 kg × 0.5 m is the same as 1 kg × 1 m.', 12000, 'level'),
  ]);
}

const scenario = {
  spec_version: 2,
  chat_mode: 'emotes',
  move_speed: 420,
  asset_base_url: '/scenario-assets/physicslab',
  objectives: [
    { id: 'bounce', text: 'Bounce lab: drop the balls and find which bounces highest', complete_when: [{ variable: 'bounce_done', operator: '=', operand: 1 }] },
    { id: 'water', text: 'Sink or float: make the water in the glass rise by 1 cm', complete_when: [{ variable: 'water_rise', operator: '>=', operand: 1 }] },
    { id: 'eureka', text: 'Sink or float: make the overflow can spill', optional: true, complete_when: [{ variable: 'eureka', operator: '=', operand: 1 }] },
    { id: 'bridge', text: 'Bridge builders: build a bridge that carries 2,000 N (best so far: {{bridge_record}} N)', complete_when: [{ variable: 'bridge_passed', operator: '=', operand: 1 }] },
    { id: 'pendulum', text: 'Pendulums: time the four pendulums', complete_when: [{ variable: 'pendulum_done', operator: '=', operand: 1 }] },
    { id: 'balance', text: 'Balance beam: level the beam', complete_when: [{ variable: 'balanced', operator: '=', operand: 1 }] },
  ],
  id: SCENARIO_ID,
  code: 'physicslab',
  shortname: 'physicslab',
  title: 'Physics Lab',
  subtitle: 'Bounce, sink or float, build a bridge, swing a pendulum, balance a beam',
  description: 'Five physics experiments in one lab. Students drop balls of different materials, sink and float things in water, build and load a bridge together, time pendulums and balance a beam, reading real measurements as they go.',
  start_scene_id: sceneIds.hall,
  enable_save_session: true,
  require_login: false,
  allow_groups: true,
  max_players: 30,
  default_language: 'en-us',
  global_variables: variables.map((v) => ({ ...v, scenario_id: SCENARIO_ID })),
  assets: media.map(({ art, ...m }) => ({ ...m, scenario_id: SCENARIO_ID })),
  shop_items: [],
  items: [],
  characters: [],
  scenes,
};

// ------------------------------------------------------------------ writing it out

const assetDir = join(root, 'scenarios/assets/physicslab/backgrounds');
mkdirSync(assetDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'physics-lab-'));
try {
  for (const m of media) {
    const svgPath = join(work, `${m.filename}.svg`);
    const pngPath = join(work, `${m.filename}.png`);
    writeFileSync(svgPath, m.art);
    execFileSync('rsvg-convert', ['-w', String(W), '-h', String(H), '-o', pngPath, svgPath]);
    execFileSync('convert', [pngPath, '-quality', '86', join(assetDir, m.filename)]);
  }
  const json = `${JSON.stringify(scenario, null, 2)}\n`;
  writeFileSync(join(root, 'scenarios/physics-lab.json'), json);
  // The ZIP the seeder imports: the scenario, and a note. Its pictures are served from scenarios/assets.
  const zipDir = join(work, 'zip');
  mkdirSync(zipDir);
  writeFileSync(join(zipDir, 'scenario.json'), json);
  writeFileSync(join(zipDir, 'README.txt'), [
    'A Quest Lab scenario: Physics Lab',
    '',
    'scenario.json is the scenario. Its backgrounds are not in this ZIP: they are loaded from',
    'its asset_base_url (/scenario-assets/physicslab), which the site serves from scenarios/assets.',
    'To bring it back: in the editor, Scenarios > Import a ZIP. That makes a new scenario.',
    '',
  ].join('\n'));
  const zip = join(root, 'apps/api/database/seeders/scenarios/physics-lab.zip');
  rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-X', '-j', zip, join(zipDir, 'scenario.json'), join(zipDir, 'README.txt')]);
  console.log(`Wrote scenarios/physics-lab.json (${scenes.length} scenes), ${media.length} backgrounds and physics-lab.zip.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

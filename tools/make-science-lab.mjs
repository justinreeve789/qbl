/**
 * Makes the Science Lab demo: a lab with a lab book (typeset maths and chemistry, worked-out
 * values, graphs, a checked answer) and four close-up benches (fizz, titration, layers, boiling).
 *
 *   npm run build -w @qbl/shared && node tools/make-science-lab.mjs
 *
 * Writes scenarios/science-lab.json (the game server's file backend reads it), the backgrounds
 * in scenarios/assets/sciencelab/backgrounds/ (from SVG, with rsvg-convert and ImageMagick), and
 * apps/api/database/seeders/scenarios/science-lab.zip, which `qbl:seed` imports.
 *
 * Once seeded, the scenario is changed in the editor like any other. To ship a changed version,
 * export it as a ZIP from the editor and put it in place of science-lab.zip, as for the starship
 * demo. This script is only how the first version was made.
 *
 * Ids are in the 760000s so the seeded rows cannot collide with ones a server already has.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BENCH_KITS } from '../packages/shared/dist/index.js';

const root = new URL('..', import.meta.url).pathname;
const W = 1920;
const H = 1080;
/** Where things stand on a bench: the top of the table. */
const TABLE = 840;
let nextId = 760_000;
const id = () => ++nextId;

// ------------------------------------------------------------------ art

const font = `font-family="Montserrat, 'DejaVu Sans', sans-serif"`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
const wall = (top, bottom) => `
  <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#wall)"/>`;
const tiles = (colour) => Array.from({ length: 9 }, (_, r) => Array.from({ length: 21 }, (_, c) => `<rect x="${c * 96 + (r % 2) * 48 - 48}" y="${r * 96}" width="92" height="92" rx="6" fill="${colour}" opacity="0.28"/>`).join('')).join('');

const BENCHES = [
  { key: 'fizz', x: 330, color: '#e9823c', label: 'Fizz', title: 'FIZZ', icon: `<circle cx="-20" cy="10" r="12" fill="#fff"/><circle cx="14" cy="-14" r="9" fill="#fff"/><circle cx="26" cy="20" r="7" fill="#fff"/><circle cx="-6" cy="-34" r="6" fill="#fff"/>` },
  { key: 'titration', x: 690, color: '#7b5bd6', label: 'Acids and bases', title: 'ACIDS AND BASES', icon: `<path d="M -14 -44 L -14 -8 L -44 40 L 44 40 L 14 -8 L 14 -44 Z" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><path d="M -30 18 L 30 18 L 42 38 L -42 38 Z" fill="#fff"/>` },
  { key: 'layers', x: 1230, color: '#2fa36b', label: 'Layers', title: 'LAYERS', icon: `<rect x="-26" y="-44" width="52" height="88" rx="6" fill="none" stroke="#fff" stroke-width="7"/><rect x="-22" y="14" width="44" height="26" fill="#fff"/><rect x="-22" y="-14" width="44" height="24" fill="#fff" opacity="0.6"/>` },
  { key: 'boil', x: 1590, color: '#d6457a', label: 'Dissolve and boil', title: 'DISSOLVE AND BOIL', icon: `<path d="M 0 40 C -30 20 -22 -6 -6 -20 C -8 -2 8 -4 6 -30 C 30 -8 34 22 0 40 Z" fill="#fff"/>` },
];

function hallArt() {
  const stations = BENCHES.map((b) => `
    <g transform="translate(${b.x} 0)">
      <rect x="-130" y="330" width="260" height="170" rx="14" fill="${b.color}"/>
      <rect x="-130" y="330" width="260" height="170" rx="14" fill="#000" opacity="0.08"/>
      <g transform="translate(0 415)">${b.icon}</g>
      <rect x="-150" y="620" width="300" height="34" rx="6" fill="#7a5433"/>
      <rect x="-150" y="620" width="300" height="9" rx="4" fill="#a8774a"/>
      <rect x="-134" y="654" width="24" height="150" fill="#5d3f26"/>
      <rect x="110" y="654" width="24" height="150" fill="#5d3f26"/>
      <rect x="-40" y="560" width="34" height="60" rx="5" fill="#ffffff" opacity="0.75"/>
      <rect x="-40" y="592" width="34" height="28" fill="${b.color}"/>
      <rect x="14" y="574" width="28" height="46" rx="5" fill="#ffffff" opacity="0.75"/>
    </g>`).join('');
  return svg(`${wall('#eaf3f0', '#d2e3dd')}
    ${tiles('#ffffff')}
    <rect y="0" width="${W}" height="90" fill="#1f5c53"/>
    <text x="${W / 2}" y="62" text-anchor="middle" ${font} font-size="44" font-weight="800" fill="#ffffff" letter-spacing="8">SCIENCE LAB</text>
    <rect y="786" width="${W}" height="${H - 786}" fill="#a9bdb6"/>
    ${Array.from({ length: 13 }, (_, i) => `<line x1="${(i - 6) * 330 + W / 2}" y1="${H}" x2="${(i - 6) * 150 + W / 2}" y2="786" stroke="#8ea69e" stroke-width="3"/>`).join('')}
    ${[850, 930, 1020].map((y) => `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#8ea69e" stroke-width="3"/>`).join('')}
    <rect y="780" width="${W}" height="10" fill="#7f968f"/>
    ${stations}
    <g transform="translate(960 0)">
      <rect x="-14" y="640" width="28" height="160" fill="#5d3f26"/>
      <rect x="-70" y="790" width="140" height="16" rx="6" fill="#5d3f26"/>
      <polygon points="-110,640 110,640 96,560 -96,560" fill="#7a5433"/>
      <polygon points="-92,628 0,618 0,548 -84,558" fill="#fdfaf0"/>
      <polygon points="92,628 0,618 0,548 84,558" fill="#f3eedd"/>
      ${[0, 1, 2, 3].map((i) => `<line x1="-78" y1="${572 + i * 13}" x2="-12" y2="${564 + i * 13}" stroke="#9aa5b1" stroke-width="3"/><line x1="78" y1="${572 + i * 13}" x2="12" y2="${564 + i * 13}" stroke="#9aa5b1" stroke-width="3"/>`).join('')}
    </g>`);
}

function benchArt(b, top, bottom) {
  return svg(`${wall(top, bottom)}
    ${tiles('#ffffff')}
    <rect y="0" width="${W}" height="14" fill="${b.color}"/>
    <rect x="1440" y="150" width="360" height="250" rx="14" fill="#bfe0f5" stroke="#5b6b8c" stroke-width="10"/>
    <line x1="1620" y1="150" x2="1620" y2="400" stroke="#5b6b8c" stroke-width="8"/>
    <rect x="120" y="330" width="560" height="18" rx="6" fill="#7a5433"/>
    ${[180, 260, 340, 430, 520, 600].map((x, i) => `<rect x="${x}" y="${330 - 50 - (i % 3) * 14}" width="38" height="${50 + (i % 3) * 14}" rx="6" fill="#ffffff" opacity="0.55"/><rect x="${x}" y="${330 - 22}" width="38" height="22" fill="${['#e9823c', '#7b5bd6', '#2fa36b', '#d6457a', '#3d8fd6', '#f2c94c'][i]}" opacity="0.8"/>`).join('')}
    <rect y="${TABLE}" width="${W}" height="44" fill="#3c4a57"/>
    <rect y="${TABLE}" width="${W}" height="9" fill="#5b6d7e"/>
    <rect y="${TABLE + 44}" width="${W}" height="${H - TABLE - 44}" fill="#26313b"/>
    <rect x="130" y="${TABLE + 44}" width="60" height="${H}" fill="#1b232b"/>
    <rect x="${W - 190}" y="${TABLE + 44}" width="60" height="${H}" fill="#1b232b"/>`);
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
function textOverlay(text, duration = 9000, alignment = 'top center') {
  return action('text_overlay', { text, alignment, text_font_size: 26, duration });
}
function labelled(sceneId, x, y, radius, text, actions, labelY = y) {
  const e = event(sceneId, actions, { position_x: x, position_y: y, radius, activate_by_trigger: true });
  e.labels = [{ id: id(), event_id: e.id, type: 'text', position_x: x, position_y: labelY, scale_x: 1, scale_y: 1, text, placement: 'front' }];
  return e;
}
const when = (name, operator, operand) => ({ id: id(), type: 'variable', variable: name, operator, operand });
/** What a bench says at the top of the screen. Each is overridable, so a newer message takes the older's place. */
function message(sceneId, text, duration, shortname) {
  return event(sceneId, [textOverlay(text, duration)], { overridable: true, ...(shortname ? { shortname } : {}) });
}

const SCENARIO_ID = 760_001;
const sceneIds = { hall: id(), fizz: id(), titration: id(), layers: id(), boil: id() };
const kit = (name) => structuredClone(BENCH_KITS[name]);
const bottle = (idOf, name, x, substance, pour, extra = {}) => ({ id: idOf, name, shape: 'bottle', x, y: TABLE, supply: true, pour, contents: [{ substance, amount: 500 }], ...extra });

function bench(key, subtitle, colours, def, intro, extraEvents = []) {
  const sceneId = sceneIds[key];
  const indirect = extraEvents.map((make) => make(sceneId));
  const back = labelled(sceneId, 150, 1010, 70, '← Back to the lab', [action('jump', { scene_id: sceneIds.hall, spawn_point: `from-${key}` })]);
  // Watches name their events by shortname here; they are given ids now.
  for (const w of def.watches ?? []) {
    if (typeof w.event_id === 'string') w.event_id = indirect.find((e) => e.shortname === w.event_id)?.id ?? null;
  }
  const look = BENCHES.find((b) => b.key === key);
  scenes.push({
    id: sceneId, shortname: key, scenario_id: SCENARIO_ID, sequence: scenes.length + 1, subtitle,
    is_intro_scene: false, zoom: 1, show_avatars: false, width: W, height: H,
    background_media: [{ media_id: background(key, benchArt(look, ...colours)), display_width: W, display_height: H }], foreground_media: [],
    walkable_areas: [], blocked_areas: [], spawn_points: [{ name: 'default', position_x: 960, position_y: 1000 }], scale_areas: [], items: [], characters: [],
    bench: { enabled: true, ...def },
    start_events: [message(sceneId, intro, 16000)],
    end_events: [], hotspots: [back], indirect_events: indirect,
  });
}

// ------------------------------------------------------------------ the lab book

for (const [name, value] of [['book_mass', 54], ['book_volume', 20], ['book_density', 2.7], ['book_ax', -2], ['book_ay', -1], ['book_bx', 2], ['book_by', 3], ['book_a', 1], ['book_answer', ''], ['book_right', 0], ['book_read', 0]]) variable(name, value);

const LAB_BOOK = [
  `<h3>Lab book</h3>
<p>Welcome to the lab. This book has what you need for the four benches. Turn the pages, move the sliders, drag the points.</p>
<div data-qbl="callout" data-tone="tip"><p>On a bench, tap a bottle to pick it up, then tap a container to pour into it.</p></div>`,

  `<h3>Density</h3>
<p>Density says how much stuff is packed into a space:</p>
<div data-qbl="math" data-tex="\\text{density} = \\frac{\\text{mass}}{\\text{volume}}">density = mass / volume</div>
<div data-qbl="panel"><input data-qbl="slider" data-var="book_mass" data-min="1" data-max="200" data-step="1" data-value="54" data-unit=" g" data-label="Mass"><input data-qbl="slider" data-var="book_volume" data-min="1" data-max="100" data-step="1" data-value="20" data-unit=" mL" data-label="Volume"></div>
<p>Density: <span data-qbl="calc" data-formula="book_mass / book_volume" data-digits="2" data-unit="g/mL" data-var="book_density"></span></p>
<div data-qbl="when" data-when="book_density > 1"><p>That is denser than water (<span data-qbl="math" data-tex="1\\ \\text{g/mL}">1 g/mL</span>): it would <strong>sink</strong>.</p></div>
<div data-qbl="when" data-when="book_density <= 1"><p>That is no denser than water: it would <strong>float</strong>.</p></div>`,

  `<h3>Reading a graph: slope</h3>
<p>Drag the two points. The slope of the line through them is how far it goes up for each step across.</p>
<div data-qbl="graph" data-x="-5,5" data-y="-5,5" data-points="book_ax,book_ay=-2,-1; book_bx,book_by=2,3" data-join="line" data-snap="1" data-xlabel="x" data-ylabel="y"></div>
<div data-qbl="math" data-tex="\\text{slope} = \\frac{y_2 - y_1}{x_2 - x_1}">slope = (y2 - y1) / (x2 - x1)</div>
<p>Slope: <span data-qbl="calc" data-formula="(book_by - book_ay) / (book_bx - book_ax)" data-digits="2"></span></p>`,

  `<h3>Curves</h3>
<p>This curve is <span data-qbl="math" data-tex="y = a x^2">y = a x^2</span>. Slide <em>a</em> and watch it open, flatten and turn over.</p>
<input data-qbl="slider" data-var="book_a" data-min="-2" data-max="2" data-step="0.1" data-value="1" data-label="a">
<div data-qbl="graph" data-fn="book_a * x^2" data-x="-4,4" data-y="-8,8" data-xlabel="x" data-ylabel="y"></div>
<p>At <span data-qbl="math" data-tex="x = 2">x = 2</span>, <span data-qbl="math" data-tex="y">y</span> is <span data-qbl="calc" data-formula="book_a * 2^2" data-digits="1"></span>.</p>`,

  `<h3>What fizzes?</h3>
<p>Vinegar is a weak acid. Baking soda is a base. Together they make a salt, water and a gas that bubbles out:</p>
<div data-qbl="math" data-tex="\\ce{CH3COOH + NaHCO3 -> CH3COONa + H2O + CO2 ^}">CH3COOH + NaHCO3 → CH3COONa + H2O + CO2</div>
<p>A strong acid and a strong base cancel each other exactly:</p>
<div data-qbl="math" data-tex="\\ce{HCl + NaOH -> NaCl + H2O}">HCl + NaOH → NaCl + H2O</div>
<details><summary>Why does one drop change everything?</summary><p>Near the point where they cancel, almost no acid is left. One more drop of base is then more than all the acid that remains, and the pH leaps from acid to base.</p></details>`,

  `<h3>Your titration</h3>
<p>The points you record at the <strong>Acids and bases</strong> bench appear here.</p>
<div data-qbl="graph" data-x="0,100" data-y="0,14" data-series="titration_log" data-xlabel="Base added (mL)" data-ylabel="pH" data-label="pH as base is added"></div>
<div data-qbl="callout" data-tone="think"><p>Where is the curve steepest? What is the pH there?</p></div>`,

  `<h3>Check yourself</h3>
<p>A block of metal has a mass of <strong>54 g</strong> and a volume of <strong>20 mL</strong>. What is its density? Give the unit.</p>
<input data-qbl="answer" data-var="book_answer" data-accept="2.7 g/mL" data-tolerance="2%" data-check="book_right" placeholder="For example: 1.5 g/mL">`,
].join('\n<hr data-qbl="page">\n');

// The hall: walk to a bench and click it; the lab book is on the stand in the middle.
{
  const sceneId = sceneIds.hall;
  // These do not hold the book up: it can be opened again while one of them is still showing.
  const right = event(sceneId, [{ ...textOverlay('Right: 54 g ÷ 20 mL = 2.7 g/mL. That is the density of aluminium.', 9000), blocking: false }], { shortname: 'book-right', overridable: true, conditions: [when('book_right', '=', 1)] });
  const wrong = event(sceneId, [{ ...textOverlay('Not yet. Divide the mass by the volume, and give the unit: g/mL. Open the book to try again.', 9000), blocking: false }], { shortname: 'book-wrong', overridable: true, conditions: [when('book_right', '=', 0)] });
  const checked = event(sceneId, [action('variable', { name: 'book_read', operator: 'set', operand: 1 }), action('run_event', { target_event_id: right.id }), action('run_event', { target_event_id: wrong.id })], { shortname: 'book-checked' });
  const book = labelled(sceneId, 960, 640, 130, '📖 Lab book', [action('infobox', {
    content: LAB_BOOK, dismissible: true, size: 'large', accent: '#1f5c53',
    call_to_actions: [{ text: 'Check my answer', action: { type: 'run_event', target_event_id: checked.id } }],
  })], 520);
  scenes.push({
    id: sceneId, shortname: 'hall', scenario_id: SCENARIO_ID, sequence: 1, subtitle: 'The science lab',
    is_intro_scene: false, zoom: 1, show_avatars: true, width: W, height: H,
    background_media: [{ media_id: background('hall', hallArt()), display_width: W, display_height: H }], foreground_media: [],
    walkable_areas: [[{ x: 0, y: 810 }, { x: W, y: 810 }, { x: W, y: H }, { x: 0, y: H }]], blocked_areas: [],
    spawn_points: [{ name: 'default', position_x: 960, position_y: 960 }, ...BENCHES.map((b) => ({ name: `from-${b.key}`, position_x: b.x, position_y: 880 }))],
    scale_areas: [], items: [], characters: [],
    start_events: [
      event(sceneId, [textOverlay('Welcome to the science lab. Read the lab book in the middle, then walk up to a bench and click it.', 9000)], { conditions: [when('visited_lab', '=', 0)] }),
      event(sceneId, [action('variable', { name: 'visited_lab', operator: 'set', operand: 1 })]),
    ],
    end_events: [],
    hotspots: [book, ...BENCHES.map((b) => labelled(sceneId, b.x, 640, 150, b.label, [action('jump', { scene_id: sceneIds[b.key], spawn_point: 'default' })], 290))],
    indirect_events: [checked, right, wrong],
  });
}
variable('visited_lab');

// 1. Fizz: vinegar and baking soda in a beaker.
{
  for (const v of ['fizz_done', 'fizz_lots', 'fizz_gas']) variable(v);
  variable('fizz_log', '');
  const k = kit('kitchen');
  bench('fizz', 'What happens when vinegar meets baking soda?', ['#fdf3ea', '#f1dcc8'], {
    substances: k.substances,
    reactions: k.reactions,
    vessels: [
      { id: 'beaker', name: 'Beaker', shape: 'beaker', x: 960, y: TABLE, width: 250, height: 290, capacity: 250, fixed: true, marks: true },
      bottle('vinegar_bottle', 'Vinegar', 420, 'vinegar', 20),
      { id: 'soda_jar', name: 'Baking soda', shape: 'jar', x: 640, y: TABLE, supply: true, pour: 5, contents: [{ substance: 'baking_soda', amount: 200 }] },
      bottle('water_bottle', 'Water', 1380, 'water', 20),
    ],
    readouts: [
      { id: 'liquid', label: 'In the beaker', measure: 'volume', vessel_id: 'beaker' },
      { id: 'temp', label: 'Temperature', measure: 'temperature', vessel_id: 'beaker' },
      { id: 'gas', label: 'Gas given off', measure: 'released', vessel_id: 'beaker', substance: 'co2', variable: 'fizz_gas' },
    ],
    watches: [
      { id: 'fizzed', name: 'It fizzes', when: 'reaction', reaction_id: 'fizz', variable: 'fizz_done', set: 1, event_id: 'fizzed' },
      { id: 'lots', name: '100 mL of gas', when: 'reading', readout_id: 'gas', operator: '>=', value: 100, variable: 'fizz_lots', set: 1, event_id: 'lots' },
    ],
    graph: { x: 'gas', y: 'temp', title: 'Colder as it fizzes', variable: 'fizz_log' },
  }, 'Tap the vinegar to pick it up, then tap the beaker to pour some in. Then add a spoonful of baking soda. What do you see, and what happens to the temperature?', [
    (sceneId) => message(sceneId, 'It fizzes: the acid in the vinegar and the baking soda make carbon dioxide, a gas. Watch the temperature: this reaction takes heat in. Press Record to plot it.', 12000, 'fizzed'),
    (sceneId) => message(sceneId, 'Over 100 mL of gas, from a few spoonfuls of powder. Where did it come from? The lab book has the equation.', 10000, 'lots'),
  ]);
}

// 2. Titration: base into acid with universal indicator.
{
  for (const v of ['neutral', 'flask_ph']) variable(v);
  variable('titration_log', '');
  const k = kit('acids');
  bench('titration', 'How much base cancels the acid?', ['#f3eefa', '#ddd5ea'], {
    substances: k.substances,
    reactions: [],
    vessels: [
      { id: 'flask', name: 'Flask of acid', shape: 'flask', x: 960, y: TABLE, width: 280, height: 320, capacity: 250, fixed: true, contents: [{ substance: 'acid', amount: 50 }, { substance: 'indicator', amount: 2 }] },
      bottle('base_bottle', 'Base: 5 mL a pour', 460, 'base', 5),
      { id: 'base_dropper', name: 'Base: 1 mL a drop', shape: 'dropper', x: 680, y: TABLE - 60, supply: true, pour: 1, contents: [{ substance: 'base', amount: 5 }] },
      bottle('acid_bottle', 'Acid: 5 mL a pour', 1420, 'acid', 5),
    ],
    readouts: [
      { id: 'added', label: 'Base added', measure: 'amount', vessel_id: 'flask', substance: 'base' },
      { id: 'ph', label: 'pH', measure: 'ph', vessel_id: 'flask', digits: 1, variable: 'flask_ph' },
      { id: 'off', measure: 'formula', formula: 'abs(ph - 7)', hidden: true },
    ],
    watches: [{ id: 'neutral', name: 'The flask is neutral', when: 'reading', readout_id: 'off', operator: '<=', value: 0.5, variable: 'neutral', set: 1, event_id: 'neutral' }],
    graph: { x: 'added', y: 'ph', title: 'pH as base is added', variable: 'titration_log' },
  }, 'The flask holds 50 mL of acid with universal indicator: red means acid. Pour in base, and press Record after each pour to plot the pH. Can you stop when it turns green, at pH 7?', [
    (sceneId) => message(sceneId, 'Green: neutral, pH 7. The base has cancelled the acid exactly. Add one more drop and see what the pH does. Your graph is in the lab book.', 12000, 'neutral'),
  ]);
}

// 3. Layers: honey, water and oil in a tall cylinder.
{
  for (const v of ['has_honey', 'has_water', 'has_oil']) variable(v);
  const k = kit('layers');
  const holds = (substance, name) => ({ id: `has_${substance}`, name: `${name} is in`, when: 'contains', vessel_id: 'cylinder', substance, amount: 10, variable: `has_${substance}`, set: 1 });
  bench('layers', 'Which liquid ends up on top?', ['#eef7f1', '#d5e8dc'], {
    substances: k.substances,
    reactions: [],
    vessels: [
      { id: 'cylinder', name: 'Measuring cylinder', shape: 'cylinder', x: 960, y: TABLE, width: 170, height: 440, capacity: 100, fixed: true, marks: true },
      bottle('oil_bottle', 'Cooking oil', 400, 'oil', 10),
      bottle('water_bottle', 'Water', 600, 'water', 10),
      bottle('honey_bottle', 'Honey', 1340, 'honey', 10),
      { id: 'dye_dropper', name: 'Blue dye', shape: 'dropper', x: 1540, y: TABLE - 60, supply: true, pour: 1, contents: [{ substance: 'dye', amount: 5 }] },
    ],
    readouts: [{ id: 'total', label: 'In the cylinder', measure: 'volume', vessel_id: 'cylinder' }],
    watches: [holds('honey', 'Honey'), holds('water', 'Water'), { ...holds('oil', 'Oil'), event_id: 'oil-in' }],
  }, 'Pour oil, water and honey into the cylinder, in any order. Where does each one settle? A drop of blue dye shows which layer is the water.', [
    (sceneId) => message(sceneId, 'Oil floats on water, whatever order you pour them in: a millilitre of oil has less mass than a millilitre of water. Honey has more, so it sinks under both.', 12000, 'oil-in'),
  ]);
}

// 4. Dissolve and boil: salt into water, stirred, then boiled dry over a burner.
{
  for (const v of ['salt_dissolved', 'salt_back']) variable(v);
  const k = kit('dissolve');
  bench('boil', 'Where does the salt go, and can you get it back?', ['#fdf1f4', '#efd9e0'], {
    substances: k.substances,
    reactions: k.reactions,
    vessels: [
      { id: 'beaker', name: 'Beaker', shape: 'beaker', x: 960, y: TABLE - 72, width: 250, height: 270, capacity: 250, fixed: true, marks: true },
      bottle('water_bottle', 'Water', 420, 'water', 25),
      { id: 'salt_jar', name: 'Salt', shape: 'jar', x: 640, y: TABLE, supply: true, pour: 5, contents: [{ substance: 'salt', amount: 200 }] },
    ],
    tools: [
      { id: 'burner', kind: 'burner', x: 960, y: TABLE, vessel_id: 'beaker', power: 6 },
      { id: 'rod', kind: 'stirrer', x: 1380, y: TABLE },
    ],
    readouts: [
      { id: 'temp', label: 'Temperature', measure: 'temperature', vessel_id: 'beaker' },
      { id: 'water', label: 'Water', measure: 'amount', vessel_id: 'beaker', substance: 'water' },
      { id: 'salt', label: 'Salt you can see', measure: 'amount', vessel_id: 'beaker', substance: 'salt' },
      { id: 'dissolved', label: 'Salt dissolved', measure: 'amount', vessel_id: 'beaker', substance: 'dissolved_salt', unit: 'g' },
    ],
    watches: [
      { id: 'dissolved', name: 'The salt dissolves', when: 'reaction', reaction_id: 'dissolve', variable: 'salt_dissolved', set: 1, event_id: 'dissolved' },
      { id: 'dry', name: 'The salt comes back', when: 'reaction', reaction_id: 'dry', variable: 'salt_back', set: 1, event_id: 'dry' },
    ],
    graph: { x: 'time', y: 'temp', title: 'Heating up', record: 'live' },
  }, 'Pour water into the beaker and add a spoonful of salt. Pick up the stirring rod and tap the beaker to stir. Then tap the burner to light it, and watch the graph.', [
    (sceneId) => message(sceneId, 'The salt is dissolving: it is still there, spread through the water too finely to see. Light the burner to find out if you can get it back.', 11000, 'dissolved'),
    (sceneId) => message(sceneId, 'The water boiled away as steam at 100 °C, and the salt is back in the beaker. Look at the graph: the temperature climbed, then stayed flat while the water boiled.', 13000, 'dry'),
  ]);
}

const scenario = {
  spec_version: 2,
  chat_mode: 'emotes',
  move_speed: 420,
  asset_base_url: '/scenario-assets/sciencelab',
  objectives: [
    { id: 'book', text: 'Read the lab book and answer its question', complete_when: [{ variable: 'book_right', operator: '=', operand: 1 }] },
    { id: 'fizz', text: 'Fizz: make vinegar and baking soda react', complete_when: [{ variable: 'fizz_done', operator: '=', operand: 1 }] },
    { id: 'fizz-lots', text: 'Fizz: give off 100 mL of gas (so far: {{fizz_gas}} mL)', optional: true, complete_when: [{ variable: 'fizz_lots', operator: '=', operand: 1 }] },
    { id: 'titration', text: 'Acids and bases: bring the flask to pH 7', complete_when: [{ variable: 'neutral', operator: '=', operand: 1 }] },
    { id: 'layers', text: 'Layers: get honey, water and oil into the cylinder', complete_when: [{ variable: 'has_honey', operator: '=', operand: 1 }, { variable: 'has_water', operator: '=', operand: 1 }, { variable: 'has_oil', operator: '=', operand: 1 }] },
    { id: 'dissolve', text: 'Dissolve and boil: dissolve salt in water', complete_when: [{ variable: 'salt_dissolved', operator: '=', operand: 1 }] },
    { id: 'boil', text: 'Dissolve and boil: get the salt back', complete_when: [{ variable: 'salt_back', operator: '=', operand: 1 }] },
  ],
  id: SCENARIO_ID,
  code: 'sciencelab',
  shortname: 'sciencelab',
  title: 'Science Lab',
  subtitle: 'A lab book with maths and graphs, and four benches to pour, mix, heat and measure at',
  description: 'A lab book with typeset formulas, sliders that work out density, graphs to drag and a checked answer; and four close-up benches: make vinegar and baking soda fizz, titrate an acid with an indicator, layer liquids by density, and dissolve salt and boil it dry.',
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

const assetDir = join(root, 'scenarios/assets/sciencelab/backgrounds');
mkdirSync(assetDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'science-lab-'));
try {
  for (const m of media) {
    const svgPath = join(work, `${m.filename}.svg`);
    const pngPath = join(work, `${m.filename}.png`);
    writeFileSync(svgPath, m.art);
    execFileSync('rsvg-convert', ['-w', String(W), '-h', String(H), '-o', pngPath, svgPath]);
    execFileSync('convert', [pngPath, '-quality', '86', join(assetDir, m.filename)]);
  }
  const json = `${JSON.stringify(scenario, null, 2)}\n`;
  writeFileSync(join(root, 'scenarios/science-lab.json'), json);
  // The ZIP the seeder imports: the scenario, and a note. Its pictures are served from scenarios/assets.
  const zipDir = join(work, 'zip');
  mkdirSync(zipDir);
  writeFileSync(join(zipDir, 'scenario.json'), json);
  writeFileSync(join(zipDir, 'README.txt'), [
    'A Quest Lab scenario: Science Lab',
    '',
    'scenario.json is the scenario. Its backgrounds are not in this ZIP: they are loaded from',
    'its asset_base_url (/scenario-assets/sciencelab), which the site serves from scenarios/assets.',
    'To bring it back: in the editor, Scenarios > Import a ZIP. That makes a new scenario.',
    '',
  ].join('\n'));
  const zip = join(root, 'apps/api/database/seeders/scenarios/science-lab.zip');
  rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-X', '-j', zip, join(zipDir, 'scenario.json'), join(zipDir, 'README.txt')]);
  console.log(`Wrote scenarios/science-lab.json (${scenes.length} scenes), ${media.length} backgrounds and science-lab.zip.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

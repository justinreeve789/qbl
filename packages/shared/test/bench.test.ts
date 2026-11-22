import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateNumber } from '../src/formula.js';
import {
  BenchSim, equationText, fillHeight, formatBenchReading, indicatorColor, mixText, outlineBand, parseEquation, parseMix, sceneBench, validateScenario, vesselContains, vesselOutline,
  type BenchEvent, type Scenario, type SceneBench,
} from '../src/index.js';

const SUBSTANCES: SceneBench['substances'] = [
  { id: 'water', name: 'Water', color: '#cfe8ff', strength: 0.2, boils_at: 100 },
  { id: 'vinegar', name: 'Vinegar', color: '#f3e9c6', ph: 2.4 },
  { id: 'soda', name: 'Baking soda', state: 'solid', color: '#ffffff' },
  { id: 'salty', name: 'Salty water', color: '#dfeaf0' },
  { id: 'co2', name: 'Carbon dioxide', state: 'gas' },
  { id: 'acid', name: 'Acid', ph: 1 },
  { id: 'base', name: 'Base', ph: 13 },
  { id: 'cabbage', name: 'Cabbage juice', indicator: [{ ph: 2, color: '#ff0000' }, { ph: 7, color: '#8000ff' }, { ph: 12, color: '#00ff00' }] },
  { id: 'oil', name: 'Oil', color: '#f2c94c', density: 0.9, separate: true },
  { id: 'honey', name: 'Honey', color: '#c9861a', density: 1.4, separate: true },
  { id: 'salt', name: 'Salt', state: 'solid' },
  { id: 'brine', name: 'Brine' },
];

function bench(extra: Partial<SceneBench> = {}): SceneBench {
  return {
    enabled: true,
    substances: SUBSTANCES,
    vessels: [
      { id: 'beaker', shape: 'beaker', x: 500, y: 600, capacity: 100 },
      { id: 'vinegar-bottle', shape: 'bottle', x: 200, y: 600, supply: true, pour: 20, contents: [{ substance: 'vinegar', amount: 500 }] },
      { id: 'soda-jar', shape: 'jar', x: 320, y: 600, supply: true, pour: 5, contents: [{ substance: 'soda', amount: 100 }] },
      { id: 'tube', shape: 'tube', x: 700, y: 600, contents: [{ substance: 'water', amount: 10 }] },
    ],
    reactions: [
      { id: 'fizz', uses: [{ substance: 'vinegar', amount: 2 }, { substance: 'soda', amount: 1 }], makes: [{ substance: 'salty', amount: 2 }, { substance: 'co2', amount: 5 }], heat: -1, effect: 'fizz', note: 'It fizzes!' },
    ],
    ...extra,
  };
}

const run = (sim: BenchSim, seconds: number, dt = 1 / 30) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) sim.step(dt);
};
const watches = (events: BenchEvent[]) => events.filter((e) => e.kind === 'watch').map((e) => (e.kind === 'watch' ? e.watch.id : ''));

test('pouring moves what is in a container, and a stock bottle never runs out', () => {
  const sim = new BenchSim(bench());
  assert.deepEqual(sim.pour('vinegar-bottle', 'beaker'), { ok: true, moved: 20, color: '#f3e9c6' });
  assert.equal(sim.volume('beaker'), 20);
  assert.equal(sim.volume('vinegar-bottle'), 500);
  // An ordinary container gives what it has.
  const tipped = sim.pour('tube', 'beaker', 50);
  assert.equal(tipped.ok && tipped.moved, 10);
  assert.equal(sim.volume('tube'), 0);
  assert.deepEqual(sim.state('beaker')?.contents, { vinegar: 20, water: 10 });
  assert.equal(sim.state('beaker')?.pours, 2);
  assert.equal(sim.describe('beaker'), '20 mL vinegar, 10 mL water');
  // What cannot be done is said in words.
  assert.deepEqual(sim.pour('tube', 'beaker'), { ok: false, reason: 'The test tube is empty.' });
  assert.deepEqual(sim.pour('beaker', 'vinegar-bottle'), { ok: false, reason: 'Nothing goes back into the bottle.' });
  for (let i = 0; i < 4; i++) sim.pour('vinegar-bottle', 'beaker');
  const last = sim.pour('vinegar-bottle', 'beaker');
  assert.equal(last.ok, false, 'a full container takes no more');
  assert.equal(sim.volume('beaker'), 100);
  assert.equal(sim.empty('beaker'), true);
  assert.equal(sim.volume('beaker'), 0);
  assert.equal(sim.empty('vinegar-bottle'), false);
});

test('a reaction uses up what it needs, makes what it makes, and gives off its gas', () => {
  const sim = new BenchSim(bench());
  sim.pour('vinegar-bottle', 'beaker'); // 20 vinegar
  sim.step(0.1);
  assert.deepEqual(sim.takeEvents(), [], 'vinegar alone does nothing');
  sim.pour('soda-jar', 'beaker'); // 5 soda: the soda runs out first
  sim.step(0.1);
  const s = sim.state('beaker')!;
  assert.ok(Math.abs(s.contents.vinegar! - 10) < 1e-9);
  assert.equal(s.contents.soda, undefined);
  assert.ok(Math.abs(s.contents.salty! - 10) < 1e-9);
  assert.ok(Math.abs(s.released.co2! - 25) < 1e-9);
  assert.ok(s.temperature < 20, 'it takes heat in');
  assert.deepEqual(sim.takeEvents(), [{ kind: 'reaction', reaction: 'fizz', vessel: 'beaker' }, { kind: 'note', text: 'It fizzes!', vessel: 'beaker' }]);
  assert.deepEqual(sim.view('beaker').effects.map((e) => e.kind), ['fizz']);
  // The fizzing dies down; more soda sets it off again, without saying so twice.
  run(sim, 3);
  assert.deepEqual(sim.view('beaker').effects, []);
  sim.pour('soda-jar', 'beaker');
  sim.step(0.1);
  assert.deepEqual(sim.takeEvents(), []);
  assert.equal(sim.view('beaker').effects.length, 1);
  sim.reset();
  assert.equal(sim.volume('beaker'), 0);
  assert.equal(sim.time, 0);
});

test('a slow reaction goes at its rate, and only under its conditions', () => {
  const def = bench({
    vessels: [{ id: 'pan', shape: 'beaker', x: 500, y: 600, capacity: 200, contents: [{ substance: 'water', amount: 100 }, { substance: 'salt', amount: 20 }] }],
    tools: [{ id: 'flame', kind: 'burner', x: 500, y: 680, vessel_id: 'pan', power: 10 }],
    reactions: [{ id: 'dissolve', uses: [{ substance: 'salt', amount: 1 }, { substance: 'water', amount: 0 }], makes: [{ substance: 'brine', amount: 1 }], when: 'temperature >= 40; stirred = 1', rate: 2, effect: 'none' }],
  });
  const sim = new BenchSim(def);
  run(sim, 2);
  assert.equal(sim.state('pan')!.contents.salt, 20, 'cold and unstirred, nothing dissolves');
  assert.equal(sim.burner('flame'), true);
  run(sim, 4);
  assert.ok(sim.state('pan')!.temperature > 40);
  assert.equal(sim.state('pan')!.contents.salt, 20, 'warm but unstirred');
  sim.stir('pan');
  run(sim, 3);
  const salt = sim.state('pan')!.contents.salt!;
  assert.ok(Math.abs(salt - 14) < 0.2, `2 a second for 3 seconds: ${salt}`);
  assert.equal(sim.state('pan')!.contents.water, 100, 'water is needed but not used up');
  // The stir wears off; then it stops.
  run(sim, 4);
  const paused = sim.state('pan')!.contents.salt!;
  run(sim, 2);
  assert.equal(sim.state('pan')!.contents.salt, paused);
  // Water boils at 100 and gets no hotter; with the burner out it cools to the room.
  run(sim, 60);
  assert.equal(sim.state('pan')!.temperature, 100);
  sim.burner('flame', false);
  run(sim, 600, 0.2);
  assert.ok(Math.abs(sim.state('pan')!.temperature - 20) < 0.5);
});

test('pH follows what is mixed, as a titration does', () => {
  const sim = new BenchSim(bench({
    vessels: [
      { id: 'flask', shape: 'flask', x: 500, y: 600, capacity: 250, contents: [{ substance: 'acid', amount: 50 }, { substance: 'cabbage', amount: 2 }] },
      { id: 'burette', shape: 'dropper', x: 500, y: 300, supply: true, pour: 5, contents: [{ substance: 'base', amount: 100 }] },
    ],
    reactions: [],
  }));
  const ph = () => sim.phOf('flask')!;
  assert.ok(Math.abs(ph() - 1.02) < 0.02, `start ${ph()}`);
  const red = sim.view('flask').layers[0]!.color;
  assert.match(red, /^#f[0-9a-f]/, 'the indicator is red in acid');
  for (let i = 0; i < 9; i++) sim.pour('burette', 'flask');
  assert.ok(ph() < 3, `still acid just before the end point: ${ph()}`);
  sim.pour('burette', 'flask'); // 50 mL of base to 50 mL of acid
  assert.ok(Math.abs(ph() - 7) < 0.01, `neutral at the end point: ${ph()}`);
  sim.pour('burette', 'flask');
  assert.ok(ph() > 11, `one more tip and it jumps: ${ph()}`);
  const green = sim.view('flask').layers[0]!.color;
  assert.notEqual(green, red);
  assert.deepEqual(indicatorColor([{ ph: 2, color: '#ff0000' }, { ph: 12, color: '#0000ff' }], 7).map(Math.round), [128, 0, 128]);
  // Water has no pH of its own: it only dilutes.
  assert.equal(new BenchSim(bench()).phOf('tube'), null);
});

test('liquids that do not mix lie in layers by density, with what has settled at the bottom', () => {
  const sim = new BenchSim(bench({
    vessels: [{ id: 'jar', shape: 'cylinder', x: 500, y: 600, capacity: 100, contents: [{ substance: 'oil', amount: 20 }, { substance: 'water', amount: 30 }, { substance: 'honey', amount: 10 }, { substance: 'salt', amount: 5 }] }],
    reactions: [],
  }));
  const view = sim.view('jar');
  assert.deepEqual(view.layers.map((l) => [l.color, l.solid]), [['#ebebeb', true], ['#c9861a', false], ['#cfe8ff', false], ['#f2c94c', false]]);
  assert.deepEqual(view.layers.map((l) => Math.round(l.to * 100)), [5, 15, 45, 65]);
  assert.equal(Math.round(view.fill * 100), 65);
});

test('what bubbles up past the brim runs over', () => {
  const sim = new BenchSim(bench({
    vessels: [{ id: 'tube', shape: 'tube', x: 500, y: 600, capacity: 25, contents: [{ substance: 'vinegar', amount: 20 }, { substance: 'soda', amount: 4 }] }],
    reactions: [{ id: 'foam', uses: [{ substance: 'vinegar', amount: 1 }, { substance: 'soda', amount: 1 }], makes: [{ substance: 'salty', amount: 5 }] }],
    watches: [{ id: 'over', when: 'overflow', variable: 'spilled' }],
  }));
  sim.step(0.1);
  assert.equal(Math.round(sim.volume('tube')), 25);
  assert.ok(sim.state('tube')!.spilled > 10);
  assert.deepEqual(watches(sim.takeEvents()), ['over']);
});

test('readouts measure, formulas work them out, and watches notice once', () => {
  const sim = new BenchSim(bench({
    readouts: [
      { id: 'vol', measure: 'volume', vessel_id: 'beaker' },
      { id: 'acid', measure: 'ph', vessel_id: 'beaker' },
      { id: 'gas', measure: 'released', vessel_id: 'beaker', substance: 'co2' },
      { id: 'left', measure: 'amount', vessel_id: 'beaker', substance: 'vinegar' },
      { id: 'share', measure: 'formula', formula: 'left / vol * 100', unit: '%', digits: 0 },
      { id: 'clock', measure: 'time' },
    ],
    watches: [
      { id: 'fizzed', when: 'reaction', reaction_id: 'fizz', variable: 'fizzed' },
      { id: 'half', when: 'reading', readout_id: 'vol', operator: '>=', value: 50, variable: 'half_full' },
      { id: 'salty', when: 'contains', substance: 'salty', vessel_id: 'beaker', amount: 5, event_id: 9 },
      { id: 'every', when: 'reading', readout_id: 'vol', operator: '<', value: 1, repeat: true, variable: 'emptied' },
    ],
  }), { formula: evaluateNumber });
  assert.deepEqual(sim.readings(), { vol: 0, acid: null, gas: 0, left: 0, clock: 0, share: null });
  assert.deepEqual(sim.takeEvents(), [], 'empty at the start is not something that happened');
  sim.pour('vinegar-bottle', 'beaker');
  sim.pour('vinegar-bottle', 'beaker');
  sim.refresh();
  assert.equal(sim.readings().vol, 40);
  assert.equal(sim.readings().share, 100);
  assert.ok(Math.abs(sim.readings().acid! - 2.4) < 0.01);
  sim.pour('vinegar-bottle', 'beaker');
  sim.refresh();
  assert.deepEqual(watches(sim.takeEvents()), ['half']);
  sim.pour('soda-jar', 'beaker');
  sim.step(0.5);
  assert.deepEqual(watches(sim.takeEvents()), ['fizzed', 'salty']);
  assert.equal(sim.readings().gas, 25);
  assert.equal(sim.readings().clock, 0.25, 'a step is a quarter of a second at most');
  assert.equal(formatBenchReading({ id: 'share', measure: 'formula', unit: '%', digits: 0 }, sim.readings().share), '83 %');
  assert.equal(formatBenchReading({ id: 'acid', measure: 'ph' }, null), '—');
  // Emptied, filled and emptied again: the repeating watch notices both times, the others never again.
  sim.empty('beaker');
  sim.refresh();
  sim.pour('vinegar-bottle', 'beaker');
  sim.pour('vinegar-bottle', 'beaker');
  sim.pour('vinegar-bottle', 'beaker');
  sim.refresh();
  sim.empty('beaker');
  sim.refresh();
  assert.deepEqual(watches(sim.takeEvents()), ['every', 'every']);
});

test('containers have an inside to fill', () => {
  const beaker = vesselOutline('beaker', 100, 200);
  assert.ok(Math.abs(fillHeight(beaker, 0.5) - 100) < 2);
  assert.equal(fillHeight(beaker, 0), 0);
  assert.equal(fillHeight(beaker, 1), 200);
  // A conical flask is wide at the bottom: half of what it holds does not reach half way up.
  const flask = vesselOutline('flask', 200, 250);
  assert.ok(fillHeight(flask, 0.5) < 100, String(fillHeight(flask, 0.5)));
  const band = outlineBand(flask, 0, fillHeight(flask, 0.5));
  assert.ok(band.length >= 4);
  assert.ok(Math.max(...band.map((p) => p.y)) <= fillHeight(flask, 0.5) + 1e-6);
  for (const shape of ['tube', 'beaker', 'flask', 'cylinder', 'dish', 'bottle', 'jar', 'dropper'] as const) {
    const o = vesselOutline(shape, 100, 200);
    assert.ok(o.length >= 4 && Math.min(...o.map((p) => p.y)) === 0 && Math.max(...o.map((p) => p.y)) === 200, shape);
  }
  assert.equal(vesselContains({ id: 'v', x: 500, y: 600, shape: 'beaker' }, { x: 520, y: 500 }), true);
  assert.equal(vesselContains({ id: 'v', x: 500, y: 600, shape: 'beaker' }, { x: 700, y: 500 }), false);
});

test('recipes and reactions are written as text', () => {
  assert.deepEqual(parseMix('50 water + 5.5 salt + dye'), [{ substance: 'water', amount: 50 }, { substance: 'salt', amount: 5.5 }, { substance: 'dye', amount: 1 }]);
  assert.equal(parseMix('50 water + 5 two words'), null);
  assert.deepEqual(parseMix(''), []);
  assert.equal(mixText([{ substance: 'water', amount: 50 }, { substance: 'salt', amount: 5 }]), '50 water + 5 salt');
  const eq = parseEquation('2 vinegar + 1 soda -> 2 salty + 5 co2')!;
  assert.deepEqual(eq.uses, [{ substance: 'vinegar', amount: 2 }, { substance: 'soda', amount: 1 }]);
  assert.equal(equationText(eq), '2 vinegar + 1 soda -> 2 salty + 5 co2');
  assert.deepEqual(parseEquation('0 cabbage + 1 acid →')?.makes, []);
  assert.equal(parseEquation('-> water'), null);
  assert.equal(parseEquation('a -> b -> c'), null);
});

function scenario(b: unknown, actions: unknown[] = []): Scenario {
  return {
    id: 1, shortname: 'lab', title: 'Lab', start_scene_id: 1,
    global_variables: [{ id: 1, variable_name: 'fizzed', default_value: 0 }],
    media: [],
    scenes: [{
      id: 1, shortname: 'bench', width: 1920, height: 1080, show_avatars: false, bench: b,
      start_events: [{ id: 10, actions }],
      indirect_events: [{ id: 9, actions: [] }],
    }],
  } as unknown as Scenario;
}
const problems = (b: unknown, actions: unknown[] = []) => {
  const r = validateScenario(scenario(b, actions));
  return [...r.errors, ...r.warnings].map((i) => `${i.level}: ${i.message}`);
};

test('the publish check reads a bench', () => {
  const good = bench({
    readouts: [{ id: 'vol', measure: 'volume', vessel_id: 'beaker', variable: 'fizzed' }, { id: 'twice', measure: 'formula', formula: 'vol * 2' }],
    watches: [{ id: 'w', when: 'reaction', reaction_id: 'fizz', variable: 'fizzed', event_id: 9 }],
    graph: { x: 'time', y: 'vol' },
  });
  assert.deepEqual(problems(good, [{ id: 100, type: 'bench', op: 'add', vessel_id: 'beaker', substance: 'water', amount: 10 }]), []);
  assert.equal(sceneBench({ bench: good }), good);
  assert.equal(sceneBench({ bench: { ...good, enabled: false } }), null);

  const bad = problems({
    enabled: true,
    substances: [{ id: 'water' }, { id: 'two words' }, { id: 'time' }, { id: 'water' }, { id: 'acid', ph: 20 }],
    vessels: [{ id: 'a', shape: 'bucket', x: 100, y: 100, contents: [{ substance: 'mud', amount: 5 }] }, { id: 'b', x: 5000, y: 100, capacity: 10, contents: [{ substance: 'water', amount: 50 }] }],
    tools: [{ id: 'f', kind: 'burner', x: 1, y: 1, vessel_id: 'nowhere' }, { id: 'l', kind: 'laser', x: 1, y: 1 }],
    reactions: [{ id: 'r', uses: [], when: 'temperature >> 5' }, { id: 'q', uses: [{ substance: 'acid', amount: 1 }], when: 'pressure > 2', effect: 'sparkle' }],
    readouts: [{ id: 'v', measure: 'volume' }, { id: 'w', measure: 'weight' }, { id: 'f', measure: 'formula', formula: '(v * 2' }, { id: 'k', measure: 'ph', vessel_id: 'a', variable: 'nope' }],
    watches: [{ id: 'x', when: 'reading' }, { id: 'y', when: 'reaction', reaction_id: 'zzz', event_id: 10 }, { id: 'z', when: 'overflow' }],
    graph: { x: 'nothing', y: 'v' },
  }, [{ id: 100, type: 'bench', op: 'add', vessel_id: 'zzz' }, { id: 101, type: 'bench', op: 'explode' }]).join('\n');
  for (const expected of [
    /"two words" cannot be written in a condition/, /"time" already means something/, /Two substances are called "water"/, /pH is a number from 0 to 14/,
    /"bucket" is not a kind of container/, /names "mud", which is not one of the bench's substances/, /outside the scene/, /holds only 10 mL/,
    /heats "nowhere"/, /"laser" is not a kind of tool/, /A reaction needs at least one substance/, /A condition could not be read/, /reads "pressure"/, /"sparkle" is not something/,
    /needs "acid", but no container starts with any/, /Choose the container this is measured in/, /"weight" is not something the bench measures/, /a bracket is never closed/,
    /kept in the variable "nope"/, /Choose the readout this watches/, /"zzz" is not one of the bench's reactions/, /Event 10 is not an indirect event/, /sets no variable and runs no event/,
    /x axis needs one of the bench's readouts/, /Choose one of the bench’s containers/, /"explode" is not something a bench action does/,
  ]) assert.match(bad, expected);
  assert.match(problems(null, [{ id: 100, type: 'bench', op: 'reset' }]).join('\n'), /no close-up bench/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent, Scene, SceneBench } from '@qbl/shared';
import { BenchSystem } from '../src/systems/BenchSystem';
import { Game, loadScenario } from './harness';

/** A bench in the control room: vinegar and baking soda into a beaker, a burner, a stirring rod and a sink. */
const BENCH: SceneBench = {
  enabled: true,
  substances: [
    { id: 'vinegar', name: 'Vinegar', color: '#f3e9c6', ph: 2.4 },
    { id: 'soda', name: 'Baking soda', state: 'solid', color: '#ffffff' },
    { id: 'salty', name: 'Salty water', color: '#dfeaf0' },
    { id: 'co2', name: 'Carbon dioxide', state: 'gas' },
  ],
  vessels: [
    { id: 'beaker', name: 'Beaker', shape: 'beaker', x: 900, y: 700, capacity: 100, fixed: true },
    { id: 'bottle', name: 'Vinegar', shape: 'bottle', x: 300, y: 700, supply: true, pour: 20, contents: [{ substance: 'vinegar', amount: 500 }] },
    { id: 'jar', name: 'Baking soda', shape: 'jar', x: 500, y: 700, supply: true, pour: 5, contents: [{ substance: 'soda', amount: 100 }] },
    { id: 'tube', name: 'Test tube', shape: 'tube', x: 1200, y: 700, contents: [{ substance: 'vinegar', amount: 10 }] },
  ],
  tools: [
    { id: 'flame', kind: 'burner', x: 900, y: 780, vessel_id: 'beaker', power: 10 },
    { id: 'rod', kind: 'stirrer', x: 1400, y: 700 },
    { id: 'sink', kind: 'sink', x: 1650, y: 700 },
  ],
  reactions: [{ id: 'fizz', uses: [{ substance: 'vinegar', amount: 2 }, { substance: 'soda', amount: 1 }], makes: [{ substance: 'salty', amount: 2 }, { substance: 'co2', amount: 5 }], effect: 'fizz', note: 'It fizzes!' }],
  readouts: [
    { id: 'vol', label: 'In the beaker', measure: 'volume', vessel_id: 'beaker', variable: 'bench_volume' },
    { id: 'gas', measure: 'released', vessel_id: 'beaker', substance: 'co2' },
    { id: 'each', label: 'Gas per mL', measure: 'formula', formula: 'gas / vol', digits: 2, unit: 'mL/mL' },
  ],
  watches: [{ id: 'fizzed', when: 'reaction', reaction_id: 'fizz', variable: 'bench_fizzed', event_id: 9200 }],
  graph: { x: 'vol', y: 'gas', title: 'Gas given off', variable: 'bench_log' },
};

async function lab(change: (scene: Scene) => void = () => {}) {
  const scenario = loadScenario();
  scenario.session = { scene_id: 2 };
  scenario.global_variables = [...(scenario.global_variables ?? []), ...['bench_volume', 'bench_fizzed', 'bench_log', 'bench_events'].map((variable_name) => ({ variable_name, default_value: variable_name === 'bench_log' ? '' : 0 }))];
  const scene = scenario.scenes.find((s) => s.id === 2)!;
  scene.bench = structuredClone(BENCH);
  const noticed: GameEvent = { id: 9200, actions: [{ id: 9201, type: 'variable', name: 'bench_events', operator: '+', operand: 1 }] };
  scene.indirect_events = [...(scene.indirect_events ?? []), noticed];
  change(scene);
  const g = new Game(scenario);
  await g.wait(100);
  const bench = (g.scene as any).runtime.system(BenchSystem) as BenchSystem;
  const tap = async (x: number, y: number, ms = 60) => {
    bench.tap({ x, y });
    await g.wait(ms);
  };
  return { g, bench, tap, scene };
}

test('a container is picked up and tipped into another, and what happens is noticed', async () => {
  const { g, bench, tap } = await lab();
  assert.equal(bench.active, true);
  assert.deepEqual(g.ui.bench?.spec.readouts.map((r) => r.label), ['In the beaker', 'Gas given off, beaker', 'Gas per mL']);
  assert.deepEqual(g.ui.bench?.spec.graph, { title: 'Gas given off', xLabel: 'In the beaker (mL)', yLabel: 'Gas given off, beaker (mL)', button: true });
  assert.equal(g.ui.bench?.view?.readings.vol, '0 mL');
  assert.equal(g.ui.bench?.view?.readings.each, '—', 'nothing to divide by yet');

  // The beaker stays where it is; an empty space puts nothing down.
  await tap(900, 600);
  assert.match(g.ui.toasts.at(-1) ?? '', /beaker stays where it is/);
  assert.equal(g.ui.bench?.view?.holding, null);

  await tap(300, 600);
  assert.match(g.ui.bench?.view?.holding ?? '', /^Vinegar: tap a container/);
  await tap(900, 600, 1000); // tip it into the beaker: the pour takes most of a second
  assert.equal(g.ui.bench?.view?.readings.vol, '20 mL');
  assert.equal(g.var('bench_volume'), 20, 'a readout keeps its variable');
  assert.match(g.ui.bench?.view?.holding ?? '', /^Vinegar/, 'still in the hand, to pour again');
  await tap(900, 600, 1000);
  assert.equal(g.ui.bench?.view?.readings.vol, '40 mL');

  // Tapping the jar while holding the bottle is refused: nothing goes back into a stock jar.
  await tap(500, 600);
  assert.match(g.ui.toasts.at(-1) ?? '', /Nothing goes back into the baking soda/);
  await tap(100, 100); // put the bottle down
  assert.equal(g.ui.bench?.view?.holding, null);

  await tap(500, 600);
  await tap(900, 600, 1200);
  assert.equal(g.var('bench_fizzed'), 1, 'the watch set its variable');
  assert.equal(g.var('bench_events'), 1, 'and ran its event');
  assert.ok(g.ui.toasts.includes('It fizzes!'));
  assert.equal(g.ui.bench?.view?.readings.gas, '25 mL');
  assert.equal(g.ui.bench?.view?.readings.each, '0.63 mL/mL', 'worked out with math.js');
  await g.wait(400);
  assert.equal(g.var('bench_volume'), 40, '30 mL of vinegar left, and 10 of salty water');
});

test('the burner, the stirring rod, the sink, the graph and Start again', async () => {
  const { g, bench, tap } = await lab();
  await tap(900, 770); // the burner under the beaker
  assert.match(g.ui.toasts.at(-1) ?? '', /burner is lit/);
  await tap(1400, 600); // the rod
  assert.match(g.ui.bench?.view?.holding ?? '', /^Stirring rod/);
  await tap(900, 600);
  assert.match(g.ui.toasts.at(-1) ?? '', /nothing in it to stir/);
  g.ui.bench!.on.putDown();
  await g.wait(40);
  assert.equal(g.ui.bench?.view?.holding, null);

  // Empty the test tube down the sink.
  await tap(1650, 660);
  assert.match(g.ui.toasts.at(-1) ?? '', /Pick a container up first/);
  await tap(1200, 600);
  await tap(1650, 660);
  assert.match(g.ui.toasts.at(-1) ?? '', /test tube is empty now/);
  await tap(1200, 600);
  assert.match(g.ui.toasts.at(-1) ?? '', /test tube is empty\./);

  // Record points for the graph; they are kept in a variable.
  g.ui.bench!.on.record();
  await tap(300, 600);
  await tap(900, 600, 1000);
  g.ui.bench!.on.record();
  await g.wait(40);
  assert.deepEqual(g.ui.bench?.view?.points, [[0, 0], [20, 0]]);
  assert.equal(g.var('bench_log'), '0,0;20,0');

  g.ui.bench!.on.reset();
  await g.wait(60);
  assert.equal(g.ui.bench?.view?.readings.vol, '0 mL');
  assert.equal(g.ui.bench?.view?.holding, null);
  assert.equal(g.ui.bench?.view?.points.length, 2, 'the graph keeps what was recorded, to compare runs');
  g.ui.bench!.on.clearGraph();
  await g.wait(40);
  assert.equal(g.var('bench_log'), '');
  void bench;
});

test('events of the scene can work the bench', async () => {
  const { g } = await lab((scene) => {
    scene.start_events = [...(scene.start_events ?? []), {
      id: 9300,
      actions: [
        { id: 9301, type: 'bench', op: 'add', vessel_id: 'beaker', substance: 'vinegar', amount: 30 },
        { id: 9302, type: 'bench', op: 'add', vessel_id: 'beaker', substance: 'soda', amount: 5 },
      ],
    }];
  });
  await g.wait(200);
  assert.equal(g.var('bench_fizzed'), 1);
  assert.equal(g.ui.bench?.view?.readings.gas, '25 mL');
});

test('a scene without a bench has none', async () => {
  const g = new Game(loadScenario());
  await g.wait(100);
  assert.equal(((g.scene as any).runtime.system(BenchSystem) as BenchSystem).active, false);
  assert.equal(g.ui.bench, null);
});

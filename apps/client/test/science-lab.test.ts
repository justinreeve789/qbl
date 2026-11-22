import assert from 'node:assert/strict';
import { test } from 'node:test';
import { infoboxRefs, validateScenario, type InfoboxAction } from '@qbl/shared';
import { BenchSystem } from '../src/systems/BenchSystem';
import { Game, loadScenario } from './harness';

/**
 * The Science Lab demo (scenarios/science-lab.json, made by tools/make-science-lab.mjs), played
 * through: the lab book's checked answer, and each of its four benches worked to its objective.
 */

/** The game, started in one of the lab's scenes, with a way to tap its bench. */
async function at(scene: string) {
  const scenario = loadScenario('science-lab');
  const id = scenario.scenes.find((s) => s.shortname === scene)!.id;
  scenario.session = { scene_id: id };
  const g = new Game(scenario);
  await g.wait(150);
  const bench = (g.scene as any).runtime.system(BenchSystem) as BenchSystem;
  const def = scenario.scenes.find((s) => s.id === id)!.bench;
  /** Tap the middle of a container or a tool, and give it time (a pour takes most of a second). */
  const tap = async (thing: string, ms = 1000) => {
    const v = def?.vessels?.find((x) => x.id === thing);
    const t = def?.tools?.find((x) => x.id === thing);
    assert.ok(v || t, `the bench has no ${thing}`);
    bench.tap(v ? { x: v.x, y: v.y - 60 } : { x: t!.x, y: t!.y - 10 });
    await g.wait(ms);
  };
  const down = async () => {
    g.ui.bench!.on.putDown();
    await g.wait(50);
  };
  const reading = (name: string) => g.ui.bench!.view!.readings[name];
  const done = () => g.checklist.filter((line) => line.startsWith('✓') || line.startsWith('[x]'));
  return { g, tap, down, reading, done, scenario };
}

test('the Science Lab passes the publish check', () => {
  const result = validateScenario(loadScenario('science-lab'));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings.map((w) => w.message), []);
});

test('the lab book: maths, worked-out values, graphs and a checked answer', async () => {
  const { g, scenario } = await at('hall');
  const hall = scenario.scenes.find((s) => s.shortname === 'hall')!;
  const book = hall.hotspots!.find((h) => h.actions?.some((a) => a.type === 'infobox'))!;
  const action = book.actions!.find((a) => a.type === 'infobox') as InfoboxAction;
  const refs = infoboxRefs(action.content);
  assert.equal(refs.pages, 7);
  assert.deepEqual(refs.uses, { formula: true, math: true, graph: true });
  assert.deepEqual(refs.problems, []);
  assert.deepEqual(refs.writes.sort(), ['book_ax', 'book_ay', 'book_bx', 'book_by', 'book_density', 'book_right']);

  // A wrong answer, then the right one: what the page worked out comes with the button.
  void (g.scene as any).engine.trigger(book);
  await g.wait(300);
  await g.choose('Check my answer', { book_answer: '27', book_right: '0' });
  await g.wait(100);
  assert.ok(g.ui.texts.some((t) => t.startsWith('Not yet.')));
  assert.equal(g.var('book_right'), 0);
  await g.wait(400); // what the book said is still showing; the book opens again all the same
  void (g.scene as any).engine.trigger(book);
  await g.wait(300);
  await g.choose('Check my answer', { book_answer: '2.7 g/mL', book_right: '1' });
  await g.wait(100);
  assert.ok(g.ui.texts.some((t) => t.startsWith('Right: 54 g')));
  assert.equal(g.var('book_right'), 1);
});

test('fizz: vinegar and baking soda react, and enough of them give off 100 mL of gas', async () => {
  const { g, tap, down, reading } = await at('fizz');
  await tap('vinegar_bottle', 60);
  await tap('beaker');
  await tap('beaker');
  await down();
  assert.equal(reading('liquid'), '40 mL');
  assert.equal(g.var('fizz_done'), 0);
  await tap('soda_jar', 60);
  await tap('beaker', 3000);
  assert.equal(g.var('fizz_done'), 1);
  assert.ok(g.ui.toasts.includes('It fizzes! A gas is bubbling out.'));
  assert.equal(reading('gas'), '30 mL');
  assert.ok(Number.parseFloat(reading('temp')!) < 20, 'it got colder');
  for (let i = 0; i < 3; i++) await tap('beaker', 2600);
  assert.equal(reading('gas'), '120 mL');
  assert.equal(g.var('fizz_lots'), 1);
  assert.equal(g.var('fizz_gas'), 120);
});

test('acids and bases: ten pours of base bring the flask to pH 7, and one more sends it over', async () => {
  const { g, tap, reading } = await at('titration');
  assert.equal(reading('ph'), '1');
  await tap('base_bottle', 60);
  for (let i = 0; i < 9; i++) await tap('flask');
  assert.equal(reading('added'), '45 mL');
  assert.equal(reading('ph'), '2.3');
  assert.equal(g.var('neutral'), 0);
  g.ui.bench!.on.record();
  await tap('flask');
  g.ui.bench!.on.record();
  await g.wait(60);
  assert.equal(reading('ph'), '7');
  assert.equal(g.var('neutral'), 1);
  assert.equal(g.var('titration_log'), '45,2.288;50,7', 'the points recorded are kept for the lab book\'s graph');
  await tap('flask');
  assert.equal(reading('ph'), '11.7');
});

test('layers: honey, water and oil settle by density whatever the order', async () => {
  const { g, tap, down, reading } = await at('layers');
  for (const bottle of ['oil_bottle', 'honey_bottle', 'water_bottle']) {
    await tap(bottle, 60);
    await tap('cylinder');
    await tap('cylinder');
    await down();
  }
  assert.equal(reading('total'), '60 mL');
  assert.deepEqual([g.var('has_honey'), g.var('has_water'), g.var('has_oil')], [1, 1, 1]);
  const layers = ((g.scene as any).runtime.system(BenchSystem) as any).sim.view('cylinder').layers.map((l: { color: string }) => l.color);
  assert.deepEqual(layers, ['#c9861a', '#bfe0ff', '#f2c94c'], 'honey under water under oil');
});

test('dissolve and boil: stirred salt dissolves, and boiling the water away brings it back', async () => {
  const { g, tap, down, reading } = await at('boil');
  await tap('water_bottle', 60);
  await tap('beaker');
  await tap('beaker');
  await down();
  await tap('salt_jar', 60);
  await tap('beaker');
  await down();
  assert.equal(reading('salt'), '5 g');
  await g.wait(1500);
  assert.equal(reading('salt'), '5 g', 'unstirred, it lies at the bottom');
  await tap('rod', 60);
  await tap('beaker', 2500);
  await down();
  assert.equal(reading('dissolved'), '5 g');
  assert.equal(g.var('salt_dissolved'), 1);
  await tap('burner', 30_000);
  assert.equal(reading('water'), '0 mL');
  assert.equal(reading('salt'), '5 g');
  assert.equal(g.var('salt_back'), 1);
  const points = g.ui.bench!.view!.points;
  assert.ok(points.some(([, t]) => t === 100), 'the live graph shows the water boiling at 100 °C');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { Game, loadScenario } from './harness';

/** The Physics Lab demo, starting in one of its experiments. */
function lab(scene: string): Game {
  const scenario = loadScenario('physics-lab');
  const start = scenario.scenes.find((s) => s.shortname === scene)!;
  return new Game({ ...scenario, start_scene_id: start.id } as Scenario);
}

test('a physics scene offers its controls, readouts and tray, and hides the avatar', async () => {
  const game = lab('water');
  await game.wait(100);
  const panel = game.ui.physics!;
  assert.ok(panel.open);
  assert.deepEqual(panel.spec.readouts.map((r) => r.label), ['Water in the glass', 'It rose by', 'Pushed aside', 'Spilled from the can']);
  assert.deepEqual(panel.spec.tray.map((t) => t.label), ['Small rock', 'Big rock', 'Steel ball', 'Cork', 'Wood block', 'Ice cube']);
  assert.equal(panel.spec.shared, false);
  assert.equal(panel.spec.press, false);
  assert.equal(panel.view!.readings.level, '9.0 cm');
  assert.equal(panel.view!.tray['big-rock'], 2);
});

test('bounce lab: Drop lets the balls fall; a watch sets a variable and runs its event', async () => {
  const game = lab('bounce');
  await game.wait(500);
  const panel = game.ui.physics!;
  assert.ok(panel.view!.held, 'the balls wait to be dropped');
  panel.on.control('release');
  // The rubber ball bounces for nearly ten seconds; the watch waits for all five to be still.
  await game.wait(13_000);
  const r = panel.view!.readings;
  assert.equal(r['rubber-bounce'], '1.38 m');
  assert.equal(r['clay-bounce'], '0.00 m');
  // Readouts with a variable keep it up to date, rounded as shown.
  assert.equal(game.var('rubber_bounce'), 1.38);
  // Everything came to rest: the watch set its variable and ran its event (a message).
  assert.equal(game.var('bounce_done'), 1);
  assert.ok(game.ui.texts.some((t) => t.startsWith('Compare the bounce heights')), JSON.stringify(game.ui.texts));
  assert.ok(game.checklist.includes('[x] Bounce lab: drop the balls and find which bounces highest'));
});

test('a physics action of an event changes gravity; reset puts everything back', async () => {
  const game = lab('pendulum');
  await game.wait(100);
  const panel = game.ui.physics!;
  assert.equal(panel.view!.paused, true, 'the pendulums wait for Play');
  await game.scene.engine.runAction({ type: 'physics', op: 'gravity', value: 1.62 });
  await game.wait(50);
  assert.equal(panel.view!.gravity, 1.62);
  panel.on.control('play');
  await game.wait(12_000);
  // On the Moon a 1 m pendulum takes 2π√(1/1.62) ≈ 4.9 s.
  const b = Number(panel.view!.readings['period-B']!.replace(' s', ''));
  assert.ok(Math.abs(b - 2 * Math.PI * Math.sqrt(1 / 1.62)) < 0.15, `B swings in ${b} s`);
  panel.on.control('reset');
  await game.wait(50);
  assert.equal(panel.view!.readings['period-B'], '—');
  assert.equal(panel.view!.paused, true);
});

test('a shared experiment is the server’s; with no game server it runs here', async () => {
  const game = lab('bridge');
  await game.wait(100);
  const panel = game.ui.physics!;
  // Offline (an editor preview) there is nobody to share with.
  assert.equal(panel.spec.shared, false);
  assert.equal(panel.view!.building, true);
  assert.deepEqual(panel.spec.build!.beams.map((b) => b.label), ['Road', 'Wood', 'Steel', 'Rope']);
  assert.equal(panel.view!.cost, 0);
});

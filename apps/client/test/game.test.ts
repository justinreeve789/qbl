import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, loadScenario } from './harness';

test('the game boots into the start scene with music, a welcome line and the checklist hidden or shown', async () => {
  const g = new Game();
  await g.wait(100);
  assert.equal(g.sceneName, 'planet-landing');
  assert.deepEqual(g.position, { x: 1050, y: 960 });
  assert.ok(g.ui.texts.some((t) => t.includes('arrow keys')), 'welcome text is showing');
  assert.equal(g.ctx.music?.sound.isPlaying, true, 'background music started');
});

test('walking off an edge runs the jump and arrives at the spawn point; music carries on', async () => {
  const g = new Game();
  await g.wait(100);
  const music = g.ctx.music!.sound;
  await g.walkOff('right', 'planet-surface');
  assert.deepEqual(g.position, { x: 280, y: 1000 });
  assert.equal(g.ctx.connection.me!.scene_id, 4, 'the room agrees about the scene');
  assert.equal(g.ctx.music!.sound, music, 'same track, not restarted');
  await g.walkOff('left', 'planet-landing');
  assert.equal(g.position.x, 2100);
});

test('clicking a point walks there and stops at the edge of the walkable area', async () => {
  const g = new Game();
  await g.wait(100);
  await g.click(1400, 1000);
  await g.wait(3000);
  assert.deepEqual(g.position, { x: 1400, y: 1000 });
  await g.click(1400, 300); // up in the sky
  await g.wait(3000);
  assert.ok(g.position.y >= 775, `feet stay on the ground (y=${g.position.y})`);
});

test('previewing a draft from the editor starts in the scene that was asked for', async () => {
  // What main.ts does for /?preview={id}&scene=8: the draft is given a session that names the scene.
  const scenario = loadScenario();
  scenario.session = { scene_id: 8 };
  const g = new Game(scenario);
  await g.wait(100);
  assert.equal(g.sceneName, 'laboratory');
});

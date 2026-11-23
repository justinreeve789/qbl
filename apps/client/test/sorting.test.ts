import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item, Scenario } from '@qbl/shared';
import { PropsSystem } from '../src/systems/PropsSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { Game, loadScenario } from './harness';

/**
 * The demo's first scene with a long counter standing just below where the player arrives. Its
 * picture (64 × 128 in the fake, × 4) runs 128 px either side of the player; its base climbs from
 * the picture's bottom on the right to halfway up it on the left.
 */
async function withCounter(sortLine: Item['sort_line'] | undefined) {
  const scenario: Scenario = loadScenario();
  const probe = new Game(scenario);
  const start = probe.position;
  const sceneId = probe.scene.def.id;
  const counter: Item = { id: 9001, name: 'Counter', media_id: scenario.items![0]!.media_id, scale: 4, physical: true, ...(sortLine ? { sort_line: sortLine } : {}) };
  scenario.items = [...(scenario.items ?? []), counter];
  const scene = scenario.scenes.find((s) => s.id === sceneId)!;
  scene.items = [...(scene.items ?? []), { item_id: counter.id, position_x: start.x, position_y: start.y + 60 } as never];
  const game = new Game(scenario);
  await game.wait(50);
  const props = game.scene.system(PropsSystem) as unknown as { items: Map<number, { image: { depth: number; y: number } }> };
  const item = props.items.get(counter.id)!;
  const avatar = game.scene.system(LocalPlayerSystem).avatar;
  return { game, item, avatar, start };
}

test('without a sort line, a player in front of a counter’s far end is drawn behind it (the bug)', async () => {
  const { item, avatar } = await withCounter(undefined);
  assert.ok(avatar.sprite.depth < item.image.depth, `avatar ${avatar.sprite.depth}, counter ${item.image.depth}`);
});

test('with a sort line, the same player is drawn in front of it', async () => {
  const { item, avatar, start } = await withCounter([[0, 0.5], [1, 1]]);
  // The counter is drawn at the line's lowest point: the bottom of its picture here.
  assert.equal(item.image.depth, item.image.y);
  assert.ok(item.image.y > start.y, 'the counter stands lower on the screen than the player');
  assert.ok(avatar.sprite.depth > item.image.depth, `avatar ${avatar.sprite.depth}, counter ${item.image.depth}`);
});

test('a player behind the sort line is still drawn behind the counter', async () => {
  // The base runs along the bottom of the picture until near the top: the player stands behind it.
  const { item, avatar } = await withCounter([[0, 1], [1, 1]]);
  assert.ok(avatar.sprite.depth < item.image.depth, `avatar ${avatar.sprite.depth}, counter ${item.image.depth}`);
});

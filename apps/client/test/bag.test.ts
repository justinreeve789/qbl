import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, takesItems, type Scenario } from '@qbl/shared';
import { HotspotSystem } from '../src/systems/HotspotSystem';
import { LayerSystem } from '../src/systems/LayerSystem';
import { PropsSystem } from '../src/systems/PropsSystem';
import { Game } from './harness';

/**
 * A point-and-click puzzle: a rope and a hook lie in the yard; together they make a grappling hook,
 * which gets the kite down from the tree. The gardener wants the kite. A rock takes nothing.
 */
function mission(): Scenario {
  const has = (v: string) => [{ variable: v, operator: '>' as const, operand: 0 }];
  const holding = (id: number) => ({ variable: 'QL_Holding', operator: '=' as const, operand: id });
  return normalizeScenario({
    id: 8, shortname: 'bag', title: 'Bag', start_scene_id: 1, avatar_media_ids: [9],
    assets: [
      { id: 1, type: 'image', url: 'yard.png', width: 1200, height: 600 }, { id: 2, type: 'image', url: 'sky.png', width: 900, height: 600 },
      { id: 3, type: 'image', url: 'thing.png', width: 60, height: 60 }, { id: 4, type: 'image', url: 'npc.png' }, { id: 9, type: 'image', url: 'avatar.png' },
    ],
    global_variables: ['has_rope', 'has_hook', 'has_grapple', 'has_kite', 'kite_down', 'given'].map((v) => ({ variable_name: v, default_value: 0 })),
    items: [
      { id: 1, name: 'Rope', media_id: 3, carried_when: has('has_rope'), description: 'A long coil of rope.' },
      { id: 2, name: 'Hook', media_id: 3, carried_when: has('has_hook') },
      { id: 3, name: 'Grappling hook', media_id: 3, carried_when: has('has_grapple') },
      { id: 4, name: 'Kite', media_id: 3, carried_when: has('has_kite') },
    ],
    combinations: [{
      items: [2, 1],
      actions: [
        { type: 'variable', name: 'has_rope', operator: 'set', operand: 0 },
        { type: 'variable', name: 'has_hook', operator: 'set', operand: 0 },
        { type: 'variable', name: 'has_grapple', operator: 'set', operand: 1 },
        { type: 'text_overlay', text: 'You tie the hook to the rope.', duration: 1500 },
      ],
    }],
    characters: [{ id: 1, name: 'Gardener', animations: { stand_right: { media_id: 4 } } }],
    scenes: [{
      id: 1, shortname: 'yard', width: 1200, height: 600,
      background_media: [{ media_id: 2, display_width: 900, display_height: 600, parallax: 0.5 }, { media_id: 1 }],
      walkable_areas: [[{ x: 0, y: 300 }, { x: 1200, y: 300 }, { x: 1200, y: 600 }, { x: 0, y: 600 }]],
      spawn_points: [{ name: 'default', position_x: 100, position_y: 450 }],
      characters: [{ character_id: 1, position_x: 1000, position_y: 450, event_id: 90 }],
      hotspots: [
        { id: 10, shortname: 'rope', position_x: 300, position_y: 400, radius: 50, activate_by_trigger: true, conditions: [{ variable: 'has_rope', operator: '=', operand: 0 }, { variable: 'has_grapple', operator: '=', operand: 0 }],
          labels: [{ type: 'image', media: 3, position_x: 300, position_y: 400 }, { type: 'text', text: 'Rope', position_x: 300, position_y: 340, show_near: 150 }],
          actions: [{ id: 11, type: 'variable', name: 'has_rope', operator: 'set', operand: 1 }] },
        { id: 12, shortname: 'hook', position_x: 500, position_y: 400, radius: 50, activate_by_trigger: true, conditions: [{ variable: 'has_hook', operator: '=', operand: 0 }, { variable: 'has_grapple', operator: '=', operand: 0 }],
          actions: [{ id: 13, type: 'variable', name: 'has_hook', operator: 'set', operand: 1 }] },
        // The tree: looked at without anything, it says what is needed; with the grappling hook, the kite comes down.
        { id: 20, shortname: 'tree', position_x: 700, position_y: 350, radius: 60, activate_by_trigger: true, conditions: [{ variable: 'kite_down', operator: '=', operand: 0 }],
          labels: [{ type: 'image', media: 3, position_x: 700, position_y: 350, pulse: true }],
          actions: [{ id: 21, type: 'text_overlay', text: 'The kite is stuck up high.', duration: 1500 }] },
        { id: 22, shortname: 'tree-use', position_x: 700, position_y: 350, radius: 60, activate_by_trigger: true, conditions: [holding(3), { variable: 'kite_down', operator: '=', operand: 0 }],
          actions: [
            { id: 23, type: 'wait', duration: 500 },
            { id: 24, type: 'variable', name: 'kite_down', operator: 'set', operand: 1, conditions: [holding(3)] },
            { id: 25, type: 'variable', name: 'has_kite', operator: 'set', operand: 1 },
          ] },
        { id: 30, shortname: 'rock', position_x: 900, position_y: 350, radius: 40, activate_by_trigger: true, actions: [{ id: 31, type: 'text_overlay', text: 'A rock.', duration: 1500 }] },
      ],
      indirect_events: [
        { id: 90, shortname: 'chat-gardener', actions: [
          { id: 91, type: 'run_event', target_event_id: 92, conditions: [holding(4)] },
          { id: 93, type: 'dialogue', speaker: 'character', character_id: 1, text: 'I do not need that.', duration: 500, conditions: [{ variable: 'QL_Holding', operator: '!=', operand: 0 }, { variable: 'QL_Holding', operator: '!=', operand: 4 }] },
          { id: 94, type: 'dialogue', speaker: 'character', character_id: 1, text: 'Hello there.', duration: 500, conditions: [{ variable: 'QL_Holding', operator: '=', operand: 0 }] },
        ] },
        { id: 92, shortname: 'give-kite', actions: [
          { id: 95, type: 'variable', name: 'has_kite', operator: 'set', operand: 0 },
          { id: 96, type: 'variable', name: 'given', operator: 'set', operand: 1 },
        ] },
      ],
    }],
  });
}

const hot = (g: Game, name: string) => g.scene.def.hotspots!.find((h) => h.shortname === name)!;

test('things are picked up into the bag, put together, used in the scene and given to a character', async () => {
  const g = new Game(mission());
  await g.wait(100);
  assert.deepEqual(g.bag, []);
  await g.click(300, 400);
  await g.click(500, 400);
  assert.deepEqual(g.bag, ['Rope', 'Hook']);
  assert.equal(g.ui.bagSlots[0].description, 'A long coil of rope.');
  assert.ok(g.ui.bagSlots[0].image, 'with its picture');

  // Without anything picked, the tree only says what is wrong; QL_Holding is 0.
  await g.click(700, 350);
  assert.equal(g.var('QL_Holding'), 0);
  assert.ok(g.ui.texts.includes('The kite is stuck up high.'));

  // Picked, then picked again: put back.
  await g.pick('Rope');
  assert.equal(g.ui.bagPicked, 1);
  assert.equal(g.var('QL_Holding'), 1);
  await g.pick('Rope');
  assert.equal(g.ui.bagPicked, null);
  assert.equal(g.var('QL_Holding'), 0);

  // The rope on the tree: it does not take it. The tree's own click does not run either.
  const texts = g.ui.texts.length;
  await g.pick('Rope');
  await g.click(700, 350);
  assert.ok(g.ui.toasts.includes('That does not work there.'));
  assert.equal(g.ui.texts.length, texts, 'the tree was not looked at');
  assert.equal(g.ui.bagPicked, null, 'put back');
  // On the rock, which takes nothing: the same.
  await g.pick('Hook');
  await g.click(900, 350);
  assert.equal(g.ui.toasts.filter((t) => t === 'That does not work there.').length, 2);
  // On empty ground: the player walks there, still holding it.
  await g.pick('Hook');
  await g.click(400, 550);
  assert.equal(g.ui.bagPicked, 2);
  await g.pick('Hook');

  // Two things that do not go together, then two that do.
  await g.pick('Rope');
  await g.pick('Rope');
  await g.pick('Hook');
  await g.pick('Rope');
  await g.wait(100);
  assert.deepEqual(g.bag, ['Grappling hook']);
  assert.ok(g.ui.texts.includes('You tie the hook to the rope.'));

  // The grappling hook on the tree: the kite comes down. QL_Holding stays set until the event ends.
  await g.pick('Grappling hook');
  await g.click(700, 350);
  assert.equal(g.ui.bagPicked, null, 'the bag lets go at once');
  assert.equal(g.var('QL_Holding'), 3, 'while the event runs');
  await g.wait(700);
  assert.equal(g.var('kite_down'), 1);
  assert.equal(g.var('QL_Holding'), 0);
  assert.deepEqual(g.bag, ['Grappling hook', 'Kite']);

  // Characters: something they do not want, then what they want.
  const gardener = (g.scene.system(PropsSystem) as any).characters.get(1).figure.sprite;
  await g.pick('Grappling hook');
  gardener.emit('pointerdown');
  await g.wait(100);
  assert.equal(g.var('given'), 0);
  await g.wait(800);
  await g.pick('Kite');
  gardener.emit('pointerdown');
  await g.wait(100);
  assert.equal(g.var('given'), 1);
  assert.deepEqual(g.bag, ['Grappling hook']);

  // Which events take things.
  const find = (id: number) => g.ctx.index.events.get(id)?.event;
  assert.equal(takesItems(hot(g, 'tree-use')), true);
  assert.equal(takesItems(hot(g, 'tree')), false);
  assert.equal(takesItems({ actions: [{ id: 1, type: 'run_event', target_event_id: 90 }] }, find), true, 'through an event it runs');
});

test('hint labels show only near or under the pointer; pictures pulse only when asked; distant layers drift', async () => {
  const g = new Game(mission());
  await g.wait(100);
  const hotspots = g.scene.system(HotspotSystem) as any;
  const rope = hotspots.entries.find((e: any) => e.hotspot.shortname === 'rope');
  const [picture, name] = rope.labels;
  assert.equal(picture.object.visible, true, 'the thing itself always shows');
  assert.equal(name.object.visible, false, 'its name only near: the player starts 200 px away');
  hotspots.pointerAt(300, 400);
  assert.equal(name.object.visible, true, 'under the pointer');
  hotspots.pointerAt(50, 50);
  assert.equal(name.object.visible, false);
  await g.walkTo(320, 420);
  assert.equal(name.object.visible, true, 'or near');

  // A layer at parallax 0.5 moves half as far as the view.
  const layers = g.scene.system(LayerSystem) as any;
  const sky = layers.drifting[0].object;
  g.scene.cameras.main.worldView.x = 200;
  await g.wait(32);
  assert.equal(sky.x, 100);
  assert.equal(layers.drifting.length, 1, 'the near background moves with the world');
});

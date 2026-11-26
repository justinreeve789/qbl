import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { PropsSystem } from '../src/systems/PropsSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { Game } from './harness';

/**
 * A deck (1) and a lab (2), joined by walk-in doors along the edges. Robo walks between them on
 * his own; Vega is placed on the deck and walks only on the player's screen; the guide roams but
 * has no routine, so only events send her anywhere.
 */
function mission(over: Partial<Scenario> = {}): Scenario {
  const floor = (w: number) => [[{ x: 0, y: 250 }, { x: w, y: 250 }, { x: w, y: 600 }, { x: 0, y: 600 }]];
  return normalizeScenario({
    id: 6, shortname: 'walking', title: 'Walking', start_scene_id: 1, move_speed: 400, avatar_media_ids: [9],
    assets: [{ id: 1, type: 'image', url: 'deck.png', width: 1200, height: 600 }, { id: 4, type: 'image', url: 'npc.png' }, { id: 9, type: 'image', url: 'avatar.png' }],
    global_variables: [{ variable_name: 'robo_on', default_value: 1, scope: 'room' }],
    characters: [
      {
        id: 1, name: 'Robo', walk_speed: 400, animations: { stand_right: { media_id: 4 } },
        routine: {
          conditions: [{ variable: 'robo_on', operator: '=', operand: 1 }],
          steps: [
            { type: 'dialogue', text: 'Off to the lab!', duration: 500 },
            { type: 'walk', to: 'scene', scene_id: 2, spawn_point: 'bench' },
            { type: 'wait', duration: 1000 },
            { type: 'walk', to: 'scene', scene_id: 1 },
          ],
        },
      },
      { id: 2, name: 'Captain Vega', animations: { stand_right: { media_id: 4 } } },
      { id: 3, name: 'Guide', roams: true, animations: { stand_right: { media_id: 4 } } },
    ],
    scenes: [
      {
        id: 1, shortname: 'deck', width: 1200, height: 600, background_media: [{ media_id: 1 }], walkable_areas: floor(1200),
        spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }, { name: 'from-lab', position_x: 1120, position_y: 400, facing: 'left' }],
        characters: [{ character_id: 1, position_x: 600, position_y: 400 }, { character_id: 2, position_x: 300, position_y: 450 }, { character_id: 3, position_x: 800, position_y: 500 }],
        hotspots: [
          { id: 30, shortname: 'to-lab', position_x: 1200, position_y: null, radius: 30, actions: [{ id: 31, type: 'jump', scene_id: 2, spawn_point: 'from-deck' }] },
          {
            id: 40, shortname: 'call-vega', position_x: 100, position_y: 300, radius: 40, activate_by_trigger: true, actions: [
              { id: 41, type: 'walk', character_id: 2, to: 'point', position_x: 700, position_y: 450, facing: 'left' },
              { id: 42, type: 'text_overlay', text: 'Vega arrived', duration: 5000 },
            ],
          },
          {
            id: 50, shortname: 'send-guide', position_x: 200, position_y: 300, radius: 40, activate_by_trigger: true, actions: [
              { id: 51, type: 'walk', character_id: 3, to: 'scene', scene_id: 2 },
              { id: 52, type: 'text_overlay', text: 'Guide is in the lab', duration: 5000 },
            ],
          },
          {
            id: 60, shortname: 'cutscene', position_x: 300, position_y: 300, radius: 40, activate_by_trigger: true, actions: [
              { id: 61, type: 'freeze', frozen: true },
              { id: 62, type: 'walk', target: 'player', to: 'point', position_x: 500, position_y: 500 },
              { id: 63, type: 'walk', target: 'player', to: 'scene', scene_id: 2 },
            ],
          },
        ],
      },
      {
        id: 2, shortname: 'lab', width: 1200, height: 600, background_media: [{ media_id: 1 }], walkable_areas: floor(1200),
        spawn_points: [{ name: 'default', position_x: 600, position_y: 400 }, { name: 'from-deck', position_x: 80, position_y: 400, facing: 'right' }, { name: 'bench', position_x: 600, position_y: 500 }],
        hotspots: [{ id: 70, shortname: 'to-deck', position_x: 0, position_y: null, radius: 30, actions: [{ id: 71, type: 'jump', scene_id: 1, spawn_point: 'from-lab' }] }],
      },
    ],
    ...over,
  });
}

const props = (g: Game) => g.scene.system(PropsSystem);
const where = (g: Game, id: number) => {
  const at = props(g).characterAt(id);
  return at ? { x: Math.round(at.x), y: Math.round(at.y) } : null;
};

test('a character with a routine says its line, walks out through the door and comes back', async () => {
  const g = new Game(mission());
  await g.wait(100);
  assert.deepEqual(where(g, 1), { x: 600, y: 400 }, 'Robo starts at his placement');
  assert.deepEqual(g.ui.dialogues, ['Robo: Off to the lab!'], 'the first step of his routine');
  await g.wait(600);
  assert.ok(where(g, 1)!.x > 600, 'walking to the door');
  await g.wait(1500);
  assert.equal(where(g, 1), null, 'through the door: gone from the deck');
  const robo = g.ctx.connection.npc(1)!;
  assert.equal(robo.scene_id, 2, 'in the lab, for everyone');
  await g.wait(1500); // 520 px from the door to the bench
  assert.deepEqual([Math.round(robo.x), Math.round(robo.y)], [600, 500], 'and on to the bench');
  for (let i = 0; i < 400 && robo.scene_id !== 1; i++) await g.wait(16);
  assert.equal(robo.scene_id, 1, 'back to the deck');
  assert.deepEqual([Math.round(robo.x), Math.round(robo.y), robo.facing], [1120, 400, 'left'], 'at the spawn point the lab\'s door names');
  await g.wait(32);
  assert.ok(where(g, 1), 'and drawn here again');
});

test('a placed character walks on this player\'s screen, and the event waits for it', async () => {
  const g = new Game(mission({ characters: mission().characters!.filter((c) => c.id !== 1) }));
  await g.wait(100);
  await g.click(100, 300);
  assert.deepEqual(g.ui.texts, [], 'not yet: the walk blocks');
  await g.wait(300);
  const halfway = where(g, 2)!;
  assert.ok(halfway.x > 300 && halfway.x < 700, `on her way (${halfway.x})`);
  await g.wait(1200);
  assert.deepEqual(where(g, 2), { x: 700, y: 450 });
  assert.deepEqual(g.ui.texts, ['Vega arrived']);
  assert.equal(g.ctx.connection.state.npcs!.get('2'), undefined, 'the room knows nothing of her');
});

test('an event sends a roaming character to another scene, and waits until she is there', async () => {
  const g = new Game(mission({ characters: mission().characters!.filter((c) => c.id !== 1) }));
  await g.wait(100);
  await g.click(200, 300);
  await g.wait(500);
  assert.equal(g.ctx.connection.npc(3)!.trip !== '', true, 'the world took the walk up');
  assert.deepEqual(g.ui.texts, []);
  await g.wait(1500);
  assert.equal(g.ctx.connection.npc(3)!.scene_id, 2);
  await g.wait(300);
  assert.deepEqual(g.ui.texts, ['Guide is in the lab']);
});

test('a walk action walks the player, even while frozen, and out through a door', async () => {
  const g = new Game(mission({ characters: [] }));
  await g.wait(100);
  await g.click(300, 300);
  // The player tries to walk elsewhere: frozen, so the cutscene keeps going.
  g.scene.system(LocalPlayerSystem).walkTo({ x: 100, y: 550 });
  let closest = Infinity;
  for (let i = 0; i < 300 && g.sceneName !== 'lab'; i++) {
    await g.wait(16);
    if (g.sceneName === 'deck') closest = Math.min(closest, Math.hypot(g.position.x - 500, g.position.y - 500));
  }
  assert.ok(closest < 2, `it passed through the first spot (came within ${closest.toFixed(1)} px)`);
  assert.equal(g.sceneName, 'lab', 'went through the door to the lab');
});

/** Hold a movement key down for a while, then let it go. */
async function holdKey(g: Game, key: string, ms: number) {
  const keys = (g as any).world.keys as Record<string, { isDown: boolean }>;
  (keys[key] ??= { isDown: false }).isDown = true;
  await g.wait(ms);
  keys[key]!.isDown = false;
  await g.wait(32);
}

test('while an avatar action hides the player, neither floor clicks nor keys walk them; hotspots and walk actions still work', async () => {
  const base = mission({ characters: [] });
  const deck = base.scenes![0]!;
  deck.hotspots!.push(
    { id: 80, shortname: 'hide', position_x: 400, position_y: 300, radius: 30, activate_by_trigger: true, actions: [{ id: 81, type: 'avatar', visible: false }] },
    { id: 85, shortname: 'push', position_x: 600, position_y: 300, radius: 30, activate_by_trigger: true, actions: [{ id: 86, type: 'walk', target: 'player', to: 'point', position_x: 700, position_y: 500 }] },
    { id: 90, shortname: 'show', position_x: 500, position_y: 300, radius: 30, activate_by_trigger: true, actions: [{ id: 91, type: 'avatar', visible: true }, { id: 92, type: 'text_overlay', text: 'Shown', duration: 5000 }] },
  );
  const g = new Game(normalizeScenario(base));
  await g.wait(100);
  await g.click(400, 300);
  const at = g.position;
  await g.click(900, 500);
  await g.wait(500);
  assert.deepEqual(g.position, at, 'hidden: a click on the floor does nothing');
  await holdKey(g, 'right', 400);
  await holdKey(g, 'down', 400);
  assert.deepEqual(g.position, at, 'hidden: the keys do nothing');
  await g.click(600, 300);
  for (let i = 0; i < 200 && Math.hypot(g.position.x - 700, g.position.y - 500) > 2; i++) await g.wait(16);
  assert.ok(Math.hypot(g.position.x - 700, g.position.y - 500) <= 2, 'a walk action aimed at the player still walks them');
  await g.click(500, 300);
  assert.deepEqual(g.ui.texts, ['Shown'], 'a hotspot can still be clicked while hidden');
  const shownAt = g.position;
  await holdKey(g, 'left', 300);
  assert.ok(g.position.x < shownAt.x, 'shown again: the keys walk');
  const keyed = g.position;
  await g.click(900, 500);
  await g.wait(500);
  assert.notDeepEqual(g.position, keyed, 'and clicking the floor walks');
});

test('in a scene that hides avatars, the player does not walk and the camera does not follow them', async () => {
  const base = mission({ characters: [] });
  base.scenes![0]!.show_avatars = false;
  base.scenes![0]!.hotspots!.push(
    { id: 85, shortname: 'push', position_x: 600, position_y: 300, radius: 30, activate_by_trigger: true, actions: [{ id: 86, type: 'walk', target: 'player', to: 'point', position_x: 700, position_y: 500 }] },
  );
  const g = new Game(normalizeScenario(base));
  await g.wait(100);
  const camera = (g.scene as any).cameras.main as { following: boolean; centre: { x: number; y: number } };
  assert.equal(camera.following, false, 'the camera does not follow the hidden player');
  const view = { ...camera.centre };
  const at = g.position;
  await g.click(900, 500);
  await g.wait(400);
  await holdKey(g, 'right', 400);
  assert.deepEqual(g.position, at, 'neither clicks nor keys walk the player');
  await g.click(600, 300);
  for (let i = 0; i < 200 && Math.hypot(g.position.x - 700, g.position.y - 500) > 2; i++) await g.wait(16);
  assert.ok(Math.hypot(g.position.x - 700, g.position.y - 500) <= 2, 'a walk action still moves the player');
  assert.deepEqual(camera.centre, view, 'and the view stays where it was');
});

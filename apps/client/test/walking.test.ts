import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { PropsSystem } from '../src/systems/PropsSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { Game } from './harness';

/**
 * A deck (1) and a lab (2), joined by walk-in doors along the edges. Robo walks around on his own;
 * Vega stands on the deck until an event walks her; the guide is walked to the lab by an event.
 * Clicking Vega runs her own event. The lab has a box that, opened, runs Vega's "remark" event.
 */
function mission(over: Partial<Scenario> = {}): Scenario {
  const floor = (w: number) => [[{ x: 0, y: 250 }, { x: w, y: 250 }, { x: w, y: 600 }, { x: 0, y: 600 }]];
  return normalizeScenario({
    id: 6, shortname: 'walking', title: 'Walking', start_scene_id: 1, move_speed: 400, avatar_media_ids: [9],
    assets: [{ id: 1, type: 'image', url: 'deck.png', width: 1200, height: 600 }, { id: 4, type: 'image', url: 'npc.png' }, { id: 9, type: 'image', url: 'avatar.png' }],
    characters: [
      { id: 1, name: 'Robo', roams: true, walk_speed: 400, scene_id: 1, position_x: 600, position_y: 400, animations: { stand_right: { media_id: 4 } } },
      {
        id: 2, name: 'Captain Vega', scene_id: 1, position_x: 300, position_y: 450, event_id: 80, animations: { stand_right: { media_id: 4 } },
        events: [
          { id: 80, shortname: 'talk', actions: [{ id: 81, type: 'dialogue', speaker: 'character', character_id: 2, text: 'Welcome aboard.' }] },
          { id: 82, shortname: 'remark', actions: [{ id: 83, type: 'dialogue', speaker: 'character', character_id: 2, text: 'You found it!', duration: 500 }] },
        ],
      },
      { id: 3, name: 'Guide', scene_id: 1, position_x: 800, position_y: 500, animations: { stand_right: { media_id: 4 } } },
    ],
    scenes: [
      {
        id: 1, shortname: 'deck', width: 1200, height: 600, background_media: [{ media_id: 1 }], walkable_areas: floor(1200),
        spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }, { name: 'from-lab', position_x: 1120, position_y: 400, facing: 'left' }],
        hotspots: [
          { id: 30, shortname: 'to-lab', position_x: 1200, position_y: null, radius: 30, actions: [{ id: 31, type: 'jump', scene_id: 2, spawn_point: 'from-deck' }] },
          {
            id: 40, shortname: 'call-vega', position_x: 100, position_y: 300, radius: 40, activate_by_trigger: true, actions: [
              { id: 41, type: 'walk', character_id: 2, scene_id: 1, to: 'point', position_x: 700, position_y: 450, facing: 'left' },
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
        hotspots: [
          { id: 70, shortname: 'to-deck', position_x: 0, position_y: null, radius: 30, actions: [{ id: 71, type: 'jump', scene_id: 1, spawn_point: 'from-lab' }] },
          { id: 72, shortname: 'box', position_x: 600, position_y: 300, radius: 40, activate_by_trigger: true, actions: [{ id: 73, type: 'run_event', target_event_id: 82 }] },
        ],
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

test('a character that walks around on its own wanders the deck, then leaves by the door', async () => {
  const g = new Game(mission());
  await g.wait(100);
  assert.deepEqual(where(g, 1), { x: 600, y: 400 }, 'Robo starts where he starts');
  const robo = g.ctx.connection.npc(1)!;
  const seen = new Set<string>();
  for (let i = 0; i < 9000 && robo.scene_id === 1; i++) {
    await g.wait(16);
    const at = where(g, 1);
    if (at) seen.add(`${Math.round(at.x / 50)},${Math.round(at.y / 50)}`);
  }
  assert.ok(seen.size > 5, 'he walked about the deck, drawn where the room says');
  assert.equal(robo.scene_id, 2, 'and out through its door, into the lab');
  await g.wait(400);
  assert.equal(where(g, 1), null, 'gone from the deck');
});

test('every character is the world\'s: an event walks Vega for everyone, and waits for her', async () => {
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
  const vega = g.ctx.connection.state.npcs!.get('2')!;
  assert.deepEqual([vega.scene_id, Math.round(vega.x), vega.facing], [1, 700, 'left'], 'the room knows where she is');
});

test('an event sends a character to another scene, and waits until she is there', async () => {
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

test('clicking a character runs its own event; run from a scene it is not in, its bubble is a story box', async () => {
  const g = new Game(mission({ characters: mission().characters!.filter((c) => c.id !== 1) }));
  await g.wait(100);
  const vega = (props(g) as unknown as { characters: Map<number, { figure: { sprite: { emit(e: string): void } } }> }).characters.get(2)!;
  vega.figure.sprite.emit('pointerdown');
  await g.wait(50);
  assert.deepEqual(g.ui.dialogues, ['Captain Vega: Welcome aboard.'], 'a bubble over her');
  // In the lab, opening the box runs her "remark": she is on the deck, so it is said in a story box.
  await g.walkOff('right', 'lab');
  await g.click(600, 300);
  await g.wait(50);
  assert.deepEqual(g.ui.stories.map((s) => `${s.name}: ${s.text}`), ['Captain Vega: You found it!']);
  await g.wait(600);
  assert.equal(g.ui.stories.length, 0, 'and closes by itself, as the bubble would have');
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

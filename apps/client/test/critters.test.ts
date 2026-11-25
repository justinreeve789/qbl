import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, validateScenario, type Scenario } from '@qbl/shared';
import { CameraSystem } from '../src/systems/CameraSystem';
import { CritterSystem } from '../src/systems/CritterSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { Game } from './harness';

/** A park: birds that land on the path, a squirrel with a tree to climb, a rabbit between two bushes. */
function park(): Scenario {
  const floor = [{ x: 0, y: 420 }, { x: 1600, y: 420 }, { x: 1600, y: 720 }, { x: 0, y: 720 }];
  return normalizeScenario({
    id: 9, shortname: 'park', title: 'Park', start_scene_id: 1, avatar_media_ids: [9],
    assets: [
      { id: 1, type: 'image', url: 'park.png', width: 1600, height: 720 },
      { id: 2, type: 'image', url: 'bird.png', params: { sheet: { columns: 4, rows: 1 }, animations: [{ name: 'idle', frames: [0] }, { name: 'fly', frames: [1, 2], repeat: true }, { name: 'peck', frames: [3] }] } },
      { id: 3, type: 'image', url: 'squirrel.png' },
      { id: 4, type: 'image', url: 'rabbit.png' },
      { id: 9, type: 'image', url: 'avatar.png' },
    ],
    global_variables: [],
    scenes: [{
      id: 1, shortname: 'park', width: 1600, height: 720, walkable_areas: [floor],
      background_media: [{ media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 100, position_y: 650 }],
      critters: [
        { name: 'sparrows', media_id: 2, behavior: 'lands', count: 3, spots: [{ x: 800, y: 500 }], every: [5, 5] },
        { name: 'squirrel', media_id: 3, behavior: 'climbs', spots: [{ x: 1200, y: 520, top: 260 }], shy: 0 },
        { name: 'rabbit', media_id: 4, behavior: 'hides', spots: [{ x: 400, y: 520 }, { x: 1000, y: 540 }] },
      ],
    }],
  } as unknown as Scenario);
}

test('critters come now and then, and a shy one scatters when someone comes near', async () => {
  const scenario = park();
  assert.deepEqual(validateScenario(scenario).errors, [], 'the critters are valid');
  const g = new Game(scenario);
  await g.wait(300);
  const critters = g.scene.system(CritterSystem) as any;
  assert.equal(critters.critters.length, 3, 'three kinds of critter live here');
  assert.equal(critters.showing, 0, 'none at first');
  // Their first visits come within a few seconds.
  for (let i = 0; i < 200 && critters.critters.some((c: any) => !c.bodies.length); i++) await g.wait(100);
  const [birds, squirrel, rabbit] = critters.critters;
  assert.equal(birds.bodies.length, 3, 'the sparrows come as a little flock');
  assert.equal(squirrel.bodies.length, 1);
  assert.equal(rabbit.bodies.length, 1);
  // The rabbit pops out of one of its bushes: it starts just behind a bush's base.
  const hop = rabbit.bodies[0];
  assert.ok([400, 1000].includes(Math.round(hop.from.x)) || hop.steps.length > 0, 'the rabbit starts at a bush');
  // The squirrel's way ends up its tree.
  const climb = squirrel.bodies[0].steps.find((s: any) => s.kind === 'move' && s.climb);
  assert.deepEqual(climb && [climb.to.x, climb.to.y], [1200, 260], 'the squirrel will run up the tree');

  // Walk the player right up to where the birds are: they take off at once.
  const bird = birds.bodies[0];
  for (let i = 0; i < 100 && bird.airborne; i++) await g.wait(100);
  assert.equal(bird.airborne, false, 'the bird has landed');
  const me = g.scene.system(LocalPlayerSystem).avatar;
  // (The bird is brought to the player rather than the other way round: walking there takes a while.)
  bird.x = me.x + 40;
  bird.y = me.y;
  await g.wait(50);
  assert.ok(bird.scattered, 'a bird that someone comes close to scatters');
  assert.ok(bird.steps.some((s: any) => s.kind === 'move' && s.airborne && s.to.y < bird.y), 'and flies up and away');
  // A critter that is not shy keeps on with what it was doing.
  squirrel.bodies[0].x = me.x + 20;
  squirrel.bodies[0].y = me.y;
  await g.wait(50);
  assert.equal(squirrel.bodies[0].scattered, false, 'shy 0: the squirrel does not care');
});

test('the camera can push in, and pull back', async () => {
  const g = new Game(park());
  await g.wait(100);
  const camera = g.scene.system(CameraSystem);
  assert.equal(camera.zoom, 1);
  const handle = camera.point({ id: 1, type: 'camera', target: 'point', position_x: 800, position_y: 400, zoom: 1.6, duration: 500 } as any);
  await g.wait(700);
  await handle?.done;
  assert.ok(Math.abs(camera.zoom - 1.6) < 0.01, `it is closer (${camera.zoom})`);
  camera.point({ id: 2, type: 'camera', target: 'player', zoom: 1, duration: 0 } as any);
  assert.equal(camera.zoom, 1, 'and back to the usual view');
});

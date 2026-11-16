import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleAt } from '@qbl/shared';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { Game, loadScenario } from './harness';

/** Start the demo mission in a given scene, as a returning player would. */
async function startIn(sceneId: number): Promise<Game> {
  const scenario = loadScenario();
  scenario.session = { scene_id: sceneId };
  const g = new Game(scenario);
  await g.wait(100);
  return g;
}
const avatar = (g: Game) => g.scene.system(LocalPlayerSystem).avatar;

test('boarding the rocket hides the avatar, for everyone, until the next scene', async () => {
  const g = await startIn(4);
  assert.equal(avatar(g).invisible, false);

  await g.click(1750, 825); // the rocket
  await g.wait(450);
  assert.equal(avatar(g).invisible, true, 'the avatar has faded out before lift-off');
  assert.equal(g.ctx.connection.me!.hidden, true, 'and the room state says so, which is what other players see');
  assert.equal(g.sceneName, 'planet-surface', 'the rocket has not left yet');

  await g.hold([], () => g.sceneName === 'control-room');
  await g.wait(100);
  assert.equal(g.ctx.connection.me!.hidden, false, 'arriving in a scene shows the avatar again');
  assert.equal(avatar(g).invisible, false);
});

test('a hotspot with a reveal radius is not there until the avatar is near', async () => {
  const g = await startIn(4);
  const exoplanets = g.scene.def.hotspots!.find((h) => h.shortname === 'exoplanets')!;
  assert.equal(exoplanets.reveal_radius, 760);

  await g.click(exoplanets.position_x!, exoplanets.position_y!);
  assert.equal(g.box, undefined, 'from the edge of the scene it cannot be clicked');

  await g.walkTo(1175, 930);
  await g.click(exoplanets.position_x!, exoplanets.position_y!);
  assert.match(g.box?.html ?? '', /planets/i, 'standing under it, it can');
});

test('the corridor: avatars shrink with distance, and its doors lead to the new rooms', async () => {
  const g = await startIn(9);
  assert.equal(g.sceneName, 'corridor');
  const def = g.scene.def;
  const near = scaleAt(def, 900, 1100);
  const far = scaleAt(def, 900, 720);
  assert.ok(near > 0.85 && far < 0.6, `near ${near}, far ${far}`);

  const scaleNear = (avatar(g) as any).sprite.scaleY as number;
  await g.walkTo(900, 720);
  const scaleFar = (avatar(g) as any).sprite.scaleY as number;
  assert.ok(Math.abs(scaleFar / scaleNear - far / near) < 0.02, `the figure is drawn ${Math.round((scaleFar / scaleNear) * 100)}% of its near size`);

  await g.walkTo(900, 608);
  await g.hold([], () => g.sceneName === 'engine-room');
  await g.walkOff('down', 'corridor');
  assert.deepEqual(g.position, { x: 900, y: 700 }, 'back at the far end');

  await g.walkTo(405, 880);
  await g.hold([], () => g.sceneName === 'crew-quarters');
  await g.walkOff('right', 'corridor');
  await g.walkTo(1395, 880);
  await g.hold([], () => g.sceneName === 'hydroponics');
  await g.click(1125, 640);
  assert.match(g.box?.html ?? '', /pH 6/);
  await g.dismiss();
  await g.walkOff('left', 'corridor');
  await g.walkOff('down', 'control-room');
  assert.deepEqual(g.position, { x: 1050, y: 1110 });
  await g.walkOff('down', 'corridor');
});

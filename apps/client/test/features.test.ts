import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleAt } from '@qbl/shared';
import { OfflineConnection } from '../src/net/Connection';
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

test('a vehicle crosses scenes, stays where it is left, and is there for the next player', async () => {
  const g = await startIn(1); // the observation deck, where the UFO starts
  const ufo = g.ctx.index.items.get(2)!;
  assert.equal(ufo.unique, true, 'vehicles are single objects in the world');
  const record = () => g.ctx.connection.state.items.get('2')!;
  assert.deepEqual([record().scene_id, record().holder], [1, '']);

  await g.walkTo(180, 860);
  g.ctx.connection.item({ item_id: 2, action: 'attach' });
  await g.wait(50);
  assert.equal(g.ctx.connection.me!.attachments, '2');

  await g.walkOff('down', 'control-room');
  assert.equal(g.ctx.connection.me!.attachments, '2', 'still riding it in the next scene');
  await g.walkTo(1400, 1000);
  g.ctx.connection.item({ item_id: 2, action: 'detach' });
  await g.wait(50);
  assert.deepEqual([record().scene_id, record().holder], [2, ''], 'it now stands in the control room, free for anyone');
  assert.ok(Math.hypot(record().x - g.position.x, record().y - g.position.y) < 15, 'where its rider got out');

  // It is no longer on the observation deck, and can be boarded again where it was left.
  await g.walkTo(1000, 1000);
  g.ctx.connection.item({ item_id: 2, action: 'attach' });
  await g.wait(50);
  assert.equal(g.ctx.connection.me!.attachments, '', 'too far away to climb in');
  await g.walkTo(1380, 1000);
  g.ctx.connection.item({ item_id: 2, action: 'attach' });
  await g.wait(50);
  assert.equal(g.ctx.connection.me!.attachments, '2');
});

test('the captain tells her story in a portrait box, to this player only, who cannot walk off meanwhile', async () => {
  const g = await startIn(2);
  const local = g.scene.system(LocalPlayerSystem);
  const greeting = g.scene.def.indirect_events!.find((e) => e.shortname === 'captain-greeting')!;
  void (g.scene as any).engine.trigger(greeting);
  await g.wait(50);
  assert.equal(local.frozen, true);
  assert.equal(g.ui.stories.length, 1);
  const first = g.ui.stories[0]!;
  assert.equal(first.name, 'Captain Vega');
  assert.match(first.text, /^Welcome aboard, Tester!/);
  assert.match(first.portrait ?? '', /portraits\/captain\.png$/, 'her close-up, not her full picture');
  assert.equal(first.watching, false);
  assert.deepEqual(g.ui.dialogues, [], 'no bubble: this is the story box');

  // It waits for the reader, however long they take.
  await g.wait(60_000);
  assert.equal(g.ui.stories[0], first);
  const before = g.position;
  local.walkTo({ x: before.x + 400, y: before.y });
  await g.wait(500);
  assert.deepEqual(g.position, before, 'cannot walk away mid-conversation');

  first.next();
  await g.wait(20);
  assert.match(g.ui.stories[0]!.text, /mission consoles/);
  g.ui.stories[0]!.next();
  await g.wait(20);
  g.ui.stories[0]!.next();
  await g.wait(20);
  // The player answers, with their own name and their avatar's close-up.
  assert.equal(g.ui.stories[0]!.name, 'Tester');
  assert.match(g.ui.stories[0]!.portrait ?? '', /portraits\/avatar-1\.png$/);
  g.ui.stories[0]!.next();
  await g.wait(50);
  assert.deepEqual(g.ui.stories, []);
  assert.equal(local.frozen, false);
  await g.walkTo(before.x + 200, before.y);
  assert.notDeepEqual(g.position, before);
  assert.deepEqual((g.ctx.connection as OfflineConnection).shared, [], 'nothing of the conversation was shown to anyone else');
});

test('a rockfall is shown to everyone in the scene, and the shared variable closes the path for all', async () => {
  const g = await startIn(5);
  const connection = g.ctx.connection as OfflineConnection;
  assert.equal(g.var('rockfall'), 0);
  await g.click(1380, 640);
  assert.match(g.box?.html ?? '', /blocked for everyone/);
  await g.choose('Give them a push');
  await g.wait(100);
  assert.ok(g.ui.texts.some((t) => t.startsWith('RUMBLE!')));
  assert.deepEqual(connection.shared.map((s) => [s.event_id, s.action_id]), [[553, 55301], [553, 55302], [553, 55303]], 'the text, the boulder and its fall go to the other players; the variable does not');
  await g.wait(1500);
  assert.equal(g.var('rockfall'), 1);
  assert.equal(connection.state.vars.get('rockfall'), '1', 'the variable is the room\'s, so it is the same for every player');

  // The shortcut is gone and the pile is in its place.
  await g.click(1700, 800);
  await g.wait(100);
  assert.equal(g.sceneName, 'spring-meadow');
  assert.ok(g.ui.texts.some((t) => t.startsWith('Boulders cover the cliff path')));

  // Another player, who was standing in the meadow, is shown the fall without setting anything off themselves.
  const other = await startIn(5);
  (other.ctx.connection as OfflineConnection).deliver({ session_id: 'ann', event_id: 553, action_id: 55301 });
  (other.ctx.connection as OfflineConnection).deliver({ session_id: 'ann', event_id: 553, action_id: 55304 });
  await other.wait(20);
  assert.ok(other.ui.texts.some((t) => t.startsWith('RUMBLE!')));
  assert.equal(other.var('rockfall'), 0, 'being shown an event changes nothing; the shared variable arrives through the room state');

  // The repair drone in the engine room opens it again.
  const ship = await startIn(12);
  ship.ctx.vars.apply('rockfall', 'set', 1);
  await ship.wait(50);
  await ship.click(1480, 640);
  await ship.wait(100);
  assert.equal(ship.var('rockfall'), 0);
});

test('each player has to greet the critters themselves before the seed vault opens', async () => {
  const g = await startIn(11);
  await g.click(300, 560);
  await g.wait(50);
  assert.ok(g.ui.texts.some((t) => /say hello to each of them \(0\/3\)/.test(t)));
  for (const x of [760, 760, 1420, 1830]) {
    await g.click(x, 790);
    await g.wait(1700);
  }
  assert.equal(g.var('critters_met'), 3, 'greeting the same critter twice counts once');
  assert.equal(g.ctx.connection.state.vars.has('critters_met'), false, 'a player\'s own variable never enters the shared room state');
  await g.click(300, 560);
  await g.wait(50);
  assert.match(g.box?.html ?? '', /vault slides open for you/);
  assert.equal(g.var('vault_opened'), 1);
});

test('in the corridor, distant figures walk slower, but not as slow as their size', async () => {
  const g = await startIn(9);
  const local = g.scene.system(LocalPlayerSystem) as any;
  const nearSpeed = local.speed() as number;
  await g.walkTo(900, 720);
  const farSpeed = local.speed() as number;
  const size = scaleAt(g.scene.def, 900, 720) / scaleAt(g.scene.def, 900, 1100);
  const speed = farSpeed / nearSpeed;
  assert.ok(speed < 1 && speed > size, `size ratio ${size.toFixed(2)}, speed ratio ${speed.toFixed(2)}`);
});

test('music: the scenario has a default, a scene can have its own, and the same track is never restarted', async () => {
  const g = await startIn(4); // the rocket pad, which has the planet theme
  assert.equal(g.ctx.music?.mediaId, 30);
  const planet = g.ctx.music!.sound;
  await g.walkOff('left', 'planet-landing');
  assert.equal(g.ctx.music!.sound, planet, 'the next planet scene has the same music: it carries on');
  await g.walkOff('right', 'planet-surface');
  await g.click(1750, 825);
  await g.hold([], () => g.sceneName === 'control-room');
  await g.wait(50);
  assert.equal(g.ctx.music?.mediaId, 362, 'the control room names no music, so the scenario default plays');
  assert.equal(g.scenario.music_media_id, 362);
});

test('a speech bubble stays on screen: above, below, or beside the speaker', async () => {
  const { placeBubble } = await import('../src/ui/bubble');
  const size = { width: 300, height: 80 };
  const view = { width: 1000, height: 600 };
  const above = placeBubble({ x: 500, top: 300, bottom: 420 }, size, view);
  assert.deepEqual([above.side, above.left, above.top, above.tail], ['above', 350, 206, 150]);

  const top = placeBubble({ x: 500, top: 30, bottom: 150 }, size, view);
  assert.deepEqual([top.side, top.top], ['below', 164], 'no room above: it goes below');

  const edge = placeBubble({ x: 980, top: 300, bottom: 420 }, size, view);
  assert.equal(edge.left, 692, 'near the right edge it slides left to stay in view');
  assert.equal(edge.tail, 282, 'and its tail still points at the speaker');

  const tall = placeBubble({ x: 200, top: 40, bottom: 580, width: 100 }, size, view);
  assert.deepEqual([tall.side, tall.left], ['right', 264], 'a speaker filling the height: beside them, on the side with room');
  const tallRight = placeBubble({ x: 900, top: 40, bottom: 580, width: 100 }, size, view);
  assert.deepEqual([tallRight.side, tallRight.left], ['left', 536]);
});

test('stars and XP: an award shows on screen, a rank is earned, and the marketplace dresses the avatar', async () => {
  const scenario = loadScenario();
  // A mission-specific item and an award, as an author would add them in the editor.
  scenario.shop_items = [
    { id: 900, scenario_id: scenario.id, name: 'Mission badge', kind: 'wearable', slot: 'body', price: 30, media_id: 10 },
    { id: 901, scenario_id: scenario.id, name: 'Bounce', kind: 'animation', price: 10, animation: 'bounce' },
    { id: 902, scenario_id: scenario.id, name: 'Translator', kind: 'ability', price: 5, ability: 'translator' },
  ];
  const room = scenario.scenes.find((s) => s.id === 2)!;
  room.indirect_events!.push({ id: 9900, actions: [
    { id: 990001, type: 'award', stars: 40, xp: 120, note: 'Well done', sequence: 1 },
    { id: 990002, type: 'shop', sequence: 2 },
    { id: 990003, type: 'award', stars: -15, sequence: 3 },
  ] } as never);
  scenario.session = { scene_id: 2 };
  const g = new Game(scenario);
  await g.wait(100);
  assert.deepEqual(g.ui.hud, { stars: 0, xp: 0, rank: 'Cadet', next_rank_xp: 100 });
  assert.equal(g.var('QL_Ability_translator'), 0);

  void (g.scene as any).engine.trigger(room.indirect_events!.at(-1));
  await g.wait(50);
  assert.deepEqual(g.ui.hud, { stars: 40, xp: 120, rank: 'Explorer', next_rank_xp: 300 }, 'the award is on screen and the XP earned a rank');
  assert.equal(g.var('QL_PlayerStars'), 40);

  // The shop action opened the marketplace; the event waits for it to be closed.
  const shop = g.ui.shopOpen!;
  assert.deepEqual(shop.view().items.map((i) => [i.name, i.mission, i.owned]), [['Mission badge', true, false], ['Bounce', true, false], ['Translator', true, false]]);
  await shop.on.buy(900);
  await shop.on.buy(902);
  await assert.rejects(shop.on.buy(901), /enough stars/, '5 stars left: not enough for the 10-star item');
  await shop.on.equip(900, true);
  await shop.on.equip(902, true);
  assert.equal(shop.view().stars, 5);
  await g.wait(50);
  assert.equal(g.ctx.connection.me!.look, '900,902', 'the room knows what the player wears, so other players see it');
  assert.equal(g.var('QL_Ability_translator'), 1, 'an equipped ability is a variable scenarios can test');
  const worn = (avatar(g) as any).worn as Map<number, unknown>;
  assert.deepEqual([...worn.keys()], [900], 'the badge is drawn on the avatar; abilities are not drawn');

  assert.equal(g.ui.hud!.stars, 5);
  shop.close();
  await g.wait(50);
  assert.equal(g.ui.hud!.stars, 0, 'the event carried on after the shop closed: stars taken away, never below zero');
});

test('the marketplace is a room on the ship; a mission item bought there opens something on the planet', async () => {
  const g = await startIn(3);
  // Without the survey map there is no map table at the landing site.
  assert.equal(g.var('QL_Ability_stream_map'), 0);
  await g.click(560, 850);
  assert.equal(g.box, undefined);

  // Down the corridor, through the door on the left, to the stalls.
  const ship = await startIn(9);
  ship.ctx.rewards.pretend(40);
  await ship.walkTo(640, 700);
  await ship.hold([], () => ship.sceneName === 'marketplace');
  await ship.click(850, 640);
  const shop = ship.ui.shopOpen!;
  assert.deepEqual(shop.view().items.filter((i) => i.mission).map((i) => [i.name, i.kind, i.price]), [['Wilting Stream patch', 'wearable', 20], ['Stream survey map', 'ability', 15]]);
  await shop.on.buy(102);
  await shop.on.equip(102, true);
  await shop.on.buy(101);
  await shop.on.equip(101, true);
  assert.equal(shop.view().stars, 5);
  shop.close();
  await ship.wait(50);
  await ship.click(2060, 620);
  assert.match(ship.box!.html, /You have <b>5<\/b>/, 'reserved variables can be shown in text');
  await ship.dismiss();
  await ship.walkOff('down', 'corridor');
  assert.deepEqual(ship.position, { x: 700, y: 705 }, 'back in the corridor beside the market door');

  // The map's owner sees the map table.
  g.ctx.rewards.pretend(15);
  await g.ctx.rewards.buy(102);
  await g.ctx.rewards.equip(102, true);
  await g.wait(50);
  await g.click(560, 850);
  assert.match(g.box?.html ?? '', /Stream survey map/);
});

test('in a preview an award is given once, unless it repeats', async () => {
  const g = await startIn(2);
  const once = { id: 1, type: 'award', stars: 5, sequence: 1 } as never;
  const again = { id: 2, type: 'award', stars: 1, repeatable: true, sequence: 1 } as never;
  g.ctx.rewards.simulate(once); g.ctx.rewards.simulate(once);
  g.ctx.rewards.simulate(again); g.ctx.rewards.simulate(again);
  assert.equal(g.ctx.rewards.progress!.stars, 7);
});

test('a sprite-sheet avatar stands, walks and makes moves; moves are buttons that come and go', async () => {
  const scenario = loadScenario();
  // Only Sprocket, whose pictures are a sprite sheet, to choose from.
  scenario.avatars = scenario.avatars!.filter((a) => a.id === 120);
  scenario.session = { scene_id: 10 };
  const g = new Game(scenario);
  await g.wait(100);
  const local = g.scene.system(LocalPlayerSystem);
  const sprite = g.world.objects.find((o) => o.kind === 'sprite' && o.key.startsWith('media-120-ss-6x3'))!;
  assert.ok(sprite, 'the avatar is drawn from its sheet');
  assert.match(sprite.playing, /-0\.1-900-loop$/, 'standing: the sheet\'s idle');

  // Walking plays the walk, mirrored for the way it goes; stopping returns to idle.
  const start = g.position;
  local.walkTo({ x: start.x - 300, y: start.y });
  await g.wait(150);
  assert.match(sprite.playing, /-6\.7\.8\.9\.10\.11-600-loop$/);
  assert.equal(sprite.flipX, true, 'the art faces right, so walking left mirrors it');
  await g.wait(2500);
  assert.match(sprite.playing, /-0\.1-900-loop$/);
  local.walkTo({ x: start.x, y: start.y });
  await g.wait(150);
  assert.equal(sprite.flipX, false);
  await g.wait(2500);

  // The scenario offers jump and crouch to everyone; dance has to be learned.
  assert.deepEqual(g.ui.moveButtons.map((m) => [m.animation, m.label]), [['jump', 'Jump'], ['crouch', 'Crouch']]);
  g.ui.pressMove('jump');
  await g.wait(50);
  assert.match(g.ctx.connection.me!.anim, /^jump:\d+$/, 'it goes through the room, so everyone sees it');
  assert.match(sprite.playing, /-12\.13\.14\.13\.12-600-once$/, 'the jump drawn on the sheet');
  await g.wait(700);
  assert.match(sprite.playing, /-0\.1-900-loop$/, 'and back to standing when it ends');

  // Nobody drew a crouch for this avatar, so the picture itself ducks.
  const tall = sprite.scaleY;
  await g.wait(300);
  g.ui.pressMove('crouch');
  await g.wait(450);
  assert.ok(sprite.scaleY < tall * 0.8, 'half way through, it is squashed');
  await g.wait(600);
  assert.equal(sprite.scaleY, tall);

  // The music player teaches the dance: one of the player's own variables, and a button appears.
  await g.click(1400, 640);
  await g.wait(100);
  assert.equal(g.var('learned_dance'), 1);
  assert.deepEqual(g.ui.moveButtons.map((m) => m.animation), ['jump', 'crouch', 'dance']);
  assert.match(sprite.playing, /-15\.16\.17\.16-700-loop$/, 'the event itself started the dance');
  await g.wait(3000);
  assert.match(sprite.playing, /-15\.16\.17\.16-700-loop$/, 'a dance goes on');
  // until the player walks,
  local.walkTo({ x: start.x - 100, y: start.y });
  await g.wait(150);
  assert.equal(g.ctx.connection.me!.anim, '');
  assert.match(sprite.playing, /-6\.7\.8\.9\.10\.11-600-loop$/);
  await g.wait(1500);
  // or presses the button again.
  g.ui.pressMove('dance');
  await g.wait(300);
  assert.match(g.ctx.connection.me!.anim, /^dance:/);
  g.ui.pressMove('dance');
  await g.wait(100);
  assert.equal(g.ctx.connection.me!.anim, '');
  assert.match(sprite.playing, /-0\.1-900-loop$/);
});

test('a single picture can make the built-in moves; a move bought in the marketplace is a button everywhere; an event animates a character', async () => {
  const scenario = loadScenario();
  scenario.session = { scene_id: 2 };
  // The platform's catalogue comes from the backend; here one of its moves is put on sale directly.
  scenario.shop_items!.push({ id: 14, name: 'Spin', kind: 'move', price: 25, move: 'spin' });
  const g = new Game(scenario);
  await g.wait(100);
  // Avatars and characters are sprites, whatever their pictures are; these two are single pictures.
  const me = g.world.objects.find((o) => o.kind === 'sprite' && o.key === 'media-101')!;
  const ground = me.y;
  g.ui.pressMove('jump');
  await g.wait(300);
  assert.ok(me.y < ground - 20, 'half way through a jump the picture is off the ground');
  await g.wait(400);
  assert.equal(me.y, ground);

  g.ctx.rewards.pretend(40);
  assert.ok(!g.ui.moveButtons.some((m) => m.animation === 'spin'));
  await g.ctx.rewards.buy(14);
  await g.ctx.rewards.equip(14, true);
  await g.wait(20);
  assert.deepEqual(g.ui.moveButtons.find((m) => m.animation === 'spin'), { animation: 'spin', label: 'Spin', icon: '🌀' });
  g.ui.pressMove('spin');
  await g.wait(350);
  assert.ok(me.scaleX < 0, 'half way round, the picture shows its other side');
  await g.wait(500);
  assert.ok(me.scaleX > 0);

  // The captain waves as she greets the player.
  const captain = g.world.objects.find((o) => o.kind === 'sprite' && o.key === 'media-109' && o !== me)!;
  const greeting = g.scene.def.indirect_events!.find((e) => e.shortname === 'captain-greeting')!;
  void (g.scene as any).engine.trigger(greeting);
  let leaned = 0;
  for (let i = 0; i < 10; i++) {
    await g.wait(100);
    leaned = Math.max(leaned, Math.abs(captain.rotation));
  }
  assert.ok(leaned > 0.05, 'she sways as she waves');
  await g.wait(500);
  assert.equal(captain.rotation, 0);
});

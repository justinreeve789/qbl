import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { glossaryFlag, isWalkable, normalizeScenario, type Scenario } from '@qbl/shared';
import { Depth } from '../src/core/depth';
import { playerRows } from '../src/features/PlayersFeature';
import { ChatFeature } from '../src/features/ChatFeature';
import { GlossaryFeature } from '../src/features/GlossaryFeature';
import { PlayersFeature } from '../src/features/PlayersFeature';
import { TeamsFeature, teamRows } from '../src/features/TeamsFeature';
import type { OfflineConnection } from '../src/net/Connection';
import { HotspotSystem } from '../src/systems/HotspotSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { RemotePlayersSystem } from '../src/systems/RemotePlayersSystem';
import { Game } from './harness';

/** A two-room mission that uses everything added: a deck where teams meet and a lab that is one team's own. */
function mission(over: Partial<Scenario> = {}): Scenario {
  const floor = [{ x: 0, y: 250 }, { x: 1200, y: 250 }, { x: 1200, y: 600 }, { x: 0, y: 600 }];
  return normalizeScenario({
    id: 5, shortname: 'additions', title: 'Additions', start_scene_id: 1, chat_mode: 'free', private_messages: true, narration: 'on', move_speed: 400,
    avatar_media_ids: [9],
    assets: [
      { id: 1, type: 'image', url: 'deck.png', width: 1200, height: 600 }, { id: 2, type: 'image', url: 'rock.png' },
      { id: 3, type: 'image', url: 'icon.png' }, { id: 4, type: 'image', url: 'vega.png' }, { id: 9, type: 'image', url: 'avatar.png' },
    ],
    global_variables: [{ variable_name: 'rock_there', default_value: 1 }, { variable_name: 'answer', default_value: '' }],
    scene_groups: [{ id: 1, name: 'Starship' }, { id: 2, name: 'Planet', team_only: true }],
    glossary: [
      { id: 'ph', term: 'pH', definition: 'How acidic or basic water is.', initial: true },
      { id: 'algae', term: 'Algae', definition: 'Tiny plants that live in water.', media_id: 3 },
    ],
    objectives: [{ id: 'clear', text: 'Clear the rock', complete_when: [{ variable: 'rock_there', operator: '=', operand: 0 }] }],
    characters: [{ id: 1, name: 'Captain Vega', media_id: 4, voice_pitch: 0.8, voice_name: 'female' }],
    scenes: [
      {
        id: 1, shortname: 'deck', group_id: 1, width: 1200, height: 600, background_media: [{ media_id: 1 }], walkable_areas: [floor],
        spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }],
        shadow_spots: [{ x: 300, y: 400, radius: 100, strength: 80 }],
        characters: [{ character_id: 1, position_x: 300, position_y: 380 }],
        hotspots: [
          // A rock standing in the way: an object players walk around, until its hotspot is used.
          {
            id: 10, shortname: 'rock', position_x: 600, position_y: 400, radius: 60, activate_by_trigger: true,
            conditions: [{ variable: 'rock_there', operator: '=', operand: 1 }],
            labels: [{ type: 'image', media: 2, position_x: 600, position_y: 400, solid: true, solid_radius: 80 }, { type: 'image', media: 2, position_x: 640, position_y: 380, placement: 'object' }],
            actions: [{ id: 11, type: 'variable', name: 'rock_there', operator: 'set', operand: 0 }],
          },
          // A floor marking and its caption.
          {
            id: 20, shortname: 'console', position_x: 1000, position_y: 300, radius: 50, activate_by_trigger: true,
            labels: [{ type: 'image', media: 3, position_x: 1000, position_y: 300 }, { type: 'text', text: 'Console', position_x: 1000, position_y: 240 }, { type: 'text', text: 'Sign', position_x: 1000, position_y: 200, placement: 'front' }],
            actions: [
              { id: 21, type: 'glossary', entry_id: 'algae' },
              { id: 22, type: 'dialogue', speaker: 'character', character_id: 1, text: 'Algae make their own food.', blocking: false },
              {
                id: 23, type: 'infobox', content: '<p>What do algae need?</p>', dismissible: false, narrate: false,
                call_to_actions: [
                  { text: 'Sunlight', action: { type: 'variable', name: 'answer', operator: 'set', operand: 'sun' } },
                  { text: 'Darkness', action: { type: 'variable', name: 'answer', operator: 'set', operand: 'dark' } },
                ],
              },
            ],
          },
          { id: 30, shortname: 'to-lab', position_x: 1190, position_y: null, radius: 20, actions: [{ id: 31, type: 'jump', scene_id: 2 }] },
        ],
      },
      { id: 2, shortname: 'lab', group_id: 1, team_only: true, width: 800, height: 600, background_media: [{ media_id: 1 }], spawn_points: [{ name: 'default', position_x: 400, position_y: 400 }] },
    ],
    ...over,
  });
}

/** Features started by the tests keep real timers; they are stopped when the test ends. */
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});
let players = new PlayersFeature();

async function play(over: Partial<Scenario> = {}): Promise<Game> {
  const g = new Game(mission(over));
  players = new PlayersFeature();
  for (const feature of [new ChatFeature(), players, new GlossaryFeature()]) stops.push(feature.start(g.ctx));
  await g.wait(100);
  return g;
}
const labelsOf = (g: Game, hotspotId: number) => ((g.scene.system(HotspotSystem) as any).entries as Array<{ hotspot: { id: number }; labels: Array<{ object: any }> }>).find((e) => e.hotspot.id === hotspotId)!.labels.map((l) => l.object);
const local = (g: Game) => g.scene.system(LocalPlayerSystem);
const offline = (g: Game) => g.ctx.connection as OfflineConnection;

test('hotspot labels are behind the player wherever the player walks, unless a label asks otherwise', async () => {
  const g = await play();
  const [rock, crate] = labelsOf(g, 10);
  const [marking, caption, sign] = labelsOf(g, 20);
  const me = (local(g).avatar as any).sprite;
  // Pictures, text and even a solid rock: all part of the background by default.
  for (const label of [rock, marking, caption]) {
    assert.ok(label.depth < 0 && label.depth > Depth.background + 100, 'above the background layers, below every figure');
  }
  // From the top of the walkable floor to the bottom, and right on top of each label, the player is in front.
  for (const y of [250, 300, 400, 464, 500, 600]) {
    for (const x of [600, 1000]) {
      local(g).avatar.setPosition(x, y);
      for (const label of [rock, marking, caption]) assert.ok(me.depth > label.depth, `in front at ${x},${y}`);
    }
  }

  // A label that asks to be an object stands on its bottom edge; one that asks for the front is over everything.
  assert.equal(crate.depth, 380 + crate.displayHeight / 2);
  local(g).avatar.setPosition(640, crate.depth + 20);
  assert.ok(me.depth > crate.depth);
  local(g).avatar.setPosition(640, 300);
  assert.ok(me.depth < crate.depth);
  assert.equal(sign.depth, Depth.label);
});

test('a solid object is walked around, and no longer in the way once it is gone', async () => {
  const g = await play();
  const walk = () => g.scene.walk();
  const [rock] = labelsOf(g, 10);
  const obstacle = walk().obstacles.find((o) => o.radius === 80)!;
  assert.ok(obstacle, 'the rock is an obstacle');
  assert.equal(obstacle.y, rock.y + rock.displayHeight / 2 - 80 * 0.6);
  assert.equal(isWalkable(walk(), 600, obstacle.y), false);

  // Click on the far side of the rock: the avatar finds its way round instead of stopping against it.
  local(g).walkTo({ x: 1000, y: obstacle.y });
  assert.ok(local(g).path.length >= 2, 'the route has a corner in it');
  let inside = false;
  for (let i = 0; i < 400 && local(g).path.length; i++) {
    await g.wait(16);
    inside ||= Math.hypot(g.position.x - obstacle.x, g.position.y - obstacle.y) < obstacle.radius - 1;
  }
  assert.equal(inside, false, 'it never walked through the rock');
  assert.deepEqual([Math.round(g.position.x), Math.round(g.position.y)], [1000, Math.round(obstacle.y)]);

  // The rock's hotspot removes it (its condition no longer holds): nothing is in the way any more.
  await g.click(600, 400);
  await g.wait(600);
  assert.equal(g.var('rock_there'), 0);
  assert.equal(walk().obstacles.length, 0);
  local(g).walkTo({ x: 200, y: obstacle.y });
  assert.equal(local(g).path.length, 1, 'now the way is straight');
  assert.deepEqual(g.checklist, ['[x] Clear the rock']);
  assert.ok((offline(g).tracked).some((t) => t.type === 'hotspot' && t.label === 'rock'), 'using a hotspot is noted for the report');
  assert.ok((offline(g).tracked).some((t) => t.type === 'objective' && t.ref === 'clear'), 'and so is completing an objective');
});

test('walking through a shadow spot darkens the figure, most at its centre', async () => {
  const g = await play();
  const avatar = local(g).avatar;
  const sprite = (avatar as any).sprite;
  assert.equal(sprite.tint, 0xffffff, 'in the light');
  avatar.setPosition(350, 400);
  const edge = sprite.tint;
  avatar.setPosition(300, 400);
  const centre = sprite.tint;
  assert.ok(edge < 0xffffff && centre < edge, 'darker towards the middle');
  assert.equal(centre, 0x333333, '80% shade at the centre');
  avatar.setPosition(500, 400);
  assert.equal(sprite.tint, 0xffffff, 'and back in the light');
  // The captain stands in the same shade.
  const vega = g.world.objects.find((o) => o.key.includes('4') && o.kind !== 'text' && o.tint !== 0xffffff);
  assert.ok(vega, 'a character standing in the shade is shaded too');
});

test('a glossary action adds a word, once, and it is kept with the save', async () => {
  const g = await play();
  assert.deepEqual(g.ui.words.map((w) => w.term), ['pH'], 'the starting word is there from the beginning');
  await g.click(1000, 300);
  await g.wait(50);
  assert.deepEqual(g.ui.words.map((w) => w.term), ['Algae', 'pH']);
  assert.equal(g.ui.freshWord, 'algae');
  assert.ok(g.ui.words[0]!.image, 'with its picture');
  assert.ok(g.ui.toasts.includes('New word in your glossary: Algae'));
  assert.ok(g.ctx.flags.has(glossaryFlag('algae')), 'it is a flag, so it is saved with progress');

  // Answering the question is noted with the answer chosen.
  g.box!.choose(0);
  await g.wait(50);
  assert.equal(g.var('answer'), 'sun');
  assert.deepEqual(offline(g).tracked.filter((t) => t.type === 'choice').map((t) => [t.ref, t.label, t.value]), [['23', 'Sunlight', 0]]);
  assert.deepEqual(offline(g).tracked.filter((t) => t.type === 'glossary').map((t) => t.label), ['Algae']);

  // Using the console again does not announce the word a second time.
  const toasts = g.ui.toasts.length;
  await g.click(1000, 300);
  await g.wait(50);
  assert.equal(g.ui.toasts.filter((t) => t.startsWith('New word')).length, 1);
  assert.ok(g.ui.toasts.length >= toasts);
});

test('text is read aloud where the scenario or the action says so, in the speaker\'s voice', async () => {
  const g = await play();
  assert.equal(g.ui.narrationOffered, true, 'the read-aloud switch is offered');
  await g.click(1000, 300);
  await g.wait(50);
  // The dialogue is read (the scenario reads everything); the infobox said not to be.
  assert.deepEqual(g.ui.spoken.map((s) => s.text), ['Algae make their own food.']);
  assert.deepEqual([g.ui.spoken[0]!.speak.pitch, g.ui.spoken[0]!.speak.voice, g.ui.spoken[0]!.speak.lang], [0.8, 'female', 'en-us']);

  const quiet = await play({ narration: 'off' });
  assert.equal(quiet.ui.narrationOffered, false);
  await quiet.click(1000, 300);
  await quiet.wait(50);
  assert.deepEqual(quiet.ui.spoken, [], 'with narration off, only actions that ask for it are read');
});

test('the players list, profiles and private messages', async () => {
  const g = await play();
  const room = offline(g);
  room.addPlayer('ben', { name: 'Ben', scene_id: 1, x: 500, y: 450, team: '' });
  room.addPlayer('cy', { name: 'Cy', scene_id: 2, x: 400, y: 400, team: 't2', role: 'guest' });
  players.refresh();
  assert.deepEqual(g.ui.playerList.map((p) => [p.name, p.me, p.teammate, p.here, p.where]), [
    ['Tester', true, true, false, undefined], ['Ben', false, true, true, 'deck'], ['Cy', false, false, false, 'lab'],
  ]);

  // A profile opens with what the room knows and fills in when the rest arrives.
  g.ctx.fetchProfile = async (userId) => ({ user_id: userId, name: 'Ben', look: [], stars: 42, xp: 320, rank: 'Navigator', next_rank_xp: 700, badges: [{ name: 'Stream Saver' }] });
  g.ui.onPlayer.profile('ben');
  assert.equal(g.ui.profileCard!.view.loading, true);
  await g.wait(16);
  assert.deepEqual([g.ui.profileCard!.view.name, g.ui.profileCard!.view.rank, g.ui.profileCard!.view.stars, g.ui.profileCard!.view.xp, g.ui.profileCard!.view.badges!.map((b) => b.name)], ['Ben', 'Navigator', 42, 320, ['Stream Saver']]);
  assert.ok(g.ui.profileCard!.view.avatar.url, 'with their avatar');
  assert.ok(g.ui.profileCard!.on.message, 'and a way to write to them');
  // A guest has no account to ask about.
  g.ui.onPlayer.profile('cy');
  assert.deepEqual([g.ui.profileCard!.view.guest, g.ui.profileCard!.view.loading], [true, false]);
  // Clicking another player's avatar in the scene opens the same card.
  g.ui.profileCard = null;
  const ben = g.scene.system(RemotePlayersSystem).get('ben')!;
  (ben as any).sprite.emit('pointerdown');
  assert.equal(g.ui.profileCard!.view.name, 'Ben');

  // Messages: the scene's chat and private conversations each have their thread.
  assert.deepEqual([g.ui.messagingSetup!.scene, g.ui.messagingSetup!.private], [true, true]);
  g.ui.onPlayer.message!('ben');
  assert.deepEqual(g.ui.openedThread, { thread: 'ben', name: 'Ben' });
  room.receive({ from: 'ben', to: 'local', from_name: 'Ben', to_name: 'Tester', text: 'found the frog!', at: 1 });
  g.ui.messagingSetup!.send('scene', 'hello all');
  assert.deepEqual(g.ui.lines.map((l) => [l.thread, l.from, l.mine, l.text]), [['ben', 'Ben', false, 'found the frog!'], ['scene', 'Tester', true, 'hello all']]);
  assert.ok(g.ui.toasts.includes('Ben sent you a message'));
});

test('in a scene limited to teams a player sees only their own team', async () => {
  const g = await play();
  const room = offline(g);
  room.addPlayer('ben', { name: 'Ben', scene_id: 1, x: 500, y: 450, team: '' });
  room.addPlayer('dee', { name: 'Dee', scene_id: 1, x: 700, y: 450, team: 't2' });
  await g.wait(50);
  const remote = () => g.scene.system(RemotePlayersSystem);
  assert.ok(remote().get('ben') && remote().get('dee'), 'on the deck both teams are there');
  assert.equal(g.var('QBLPlayerCount'), 2, 'the player count is of the team');

  // Everyone goes to the lab, which is for one team at a time.
  local(g).walkTo({ x: 1188, y: 400 });
  await g.hold([], () => g.sceneName === 'lab');
  room.state.players.get('ben')!.scene_id = 2;
  room.state.players.get('dee')!.scene_id = 2;
  await g.wait(50);
  assert.ok(remote().get('ben'), 'the teammate is there');
  assert.equal(remote().get('dee'), undefined, 'the other team is not shown');
  assert.deepEqual(playerRows(g.ctx).map((p) => [p.name, p.here]), [['Tester', false], ['Ben', true], ['Dee', false]], 'though the players list still says where they are');
  assert.equal(teamRows(g.ctx), null, 'a student has no teams to choose from');
});

test('a teacher sees every team in a scene limited to teams, and can hide a team and all it does', async () => {
  const g = new Game(mission(), { id: 'u9', name: 'Ms T', role: 'teacher' });
  const teams = new TeamsFeature();
  for (const feature of [new ChatFeature(), teams]) stops.push(feature.start(g.ctx));
  await g.wait(100);
  const room = offline(g);
  room.addPlayer('ann', { name: 'Ann', scene_id: 1, x: 500, y: 450, team: 't1', team_name: 'Red' });
  room.addPlayer('dee', { name: 'Dee', scene_id: 1, x: 700, y: 450, team: 't2', team_name: 'Blue' });
  await g.wait(100);
  teams.refresh();
  assert.equal(g.ui.teamList, null, 'on the deck every team sees every other: nothing to choose');

  local(g).walkTo({ x: 1188, y: 400 });
  await g.hold([], () => g.sceneName === 'lab');
  room.state.players.get('ann')!.scene_id = 2;
  room.state.players.get('dee')!.scene_id = 2;
  await g.wait(100);
  teams.refresh();
  const remote = () => g.scene.system(RemotePlayersSystem);
  assert.ok(remote().get('ann') && remote().get('dee'), 'in the lab the teacher still sees both teams');
  assert.deepEqual(g.ui.teamList!.map((t) => [t.key, t.name, t.here, t.total, t.shown]), [['t2', 'Blue', 1, 1, true], ['t1', 'Red', 1, 1, true]]);

  // Untick Blue: Dee goes, and what Dee says and shows the scene is not shown either.
  g.ui.onTeam('t2', false);
  await g.wait(50);
  assert.ok(remote().get('ann'));
  assert.equal(remote().get('dee'), undefined);
  assert.equal(g.ui.teamList!.find((t) => t.key === 't2')!.shown, false);
  const say = (from: string, text: string) => (room as any).emit('chat', { session_id: from, text });
  say('dee', 'blue here');
  say('ann', 'red here');
  assert.deepEqual(g.ui.lines.map((l) => [l.from, l.text]), [['Ann', 'red here']]);

  // Tick it again and Dee is back.
  g.ui.onTeam('t2', true);
  await g.wait(50);
  assert.ok(remote().get('dee'));
  say('dee', 'still here');
  assert.deepEqual(g.ui.lines.map((l) => l.from), ['Ann', 'Dee']);

  // Back on the deck there is nothing to choose again.
  room.state.players.get('local')!.scene_id = 1;
  teams.refresh();
  assert.equal(g.ui.teamList, null);
});

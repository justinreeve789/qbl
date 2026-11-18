import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canSee, estimateWordTimes, glossaryFlag, glossaryOf, isNarrated, labelPlacement, normalizeScenario, sceneTeamOnly, scopedMap, shadeAt, shadeTint,
  speechWords, validateScenario, wordAt, World,
  type ItemRec, type PlayerRec, type Scenario, type User, type WorldState,
} from '../src/index.js';

const raw: Scenario = {
  id: 9, shortname: 'teams', title: 'Teams', start_scene_id: 1,
  global_variables: [{ variable_name: 'rockfall', default_value: 0, scope: 'room' }],
  scene_groups: [{ id: 1, name: 'Starship' }, { id: 2, name: 'Planet', team_only: true }],
  glossary: [
    { id: 'ph', term: 'pH', definition: 'How acidic or basic water is.', initial: true },
    { id: 'algae', term: 'Algae', definition: 'Tiny plants that live in water.' },
  ],
  items: [{ id: 1, name: 'rover', vehicle: true }],
  scenes: [
    {
      id: 1, shortname: 'deck', group_id: 1, width: 1000, height: 600,
      shadow_spots: [{ x: 500, y: 300, radius: 100, strength: 80 }],
      hotspots: [{ id: 10, position_x: 900, position_y: 300, radius: 30, actions: [{ id: 11, type: 'jump', scene_id: 2 }] }],
      indirect_events: [
        { id: 20, audience: 'scene', actions: [{ id: 21, type: 'text_overlay', text: 'Hello all' }] },
        { id: 25, actions: [{ id: 26, type: 'glossary', entry_id: 'algae' }] },
      ],
      items: [{ item_id: 1, position_x: 400, position_y: 300 }],
    },
    // In the starship group, but this room is for one team at a time.
    { id: 2, shortname: 'lab', group_id: 1, team_only: true, width: 800, height: 600, hotspots: [{ id: 30, position_x: 100, position_y: 300, radius: 30, actions: [{ id: 31, type: 'jump', scene_id: 3 }] }], indirect_events: [{ id: 40, audience: 'scene', actions: [{ id: 41, type: 'text_overlay', text: 'Lab' }] }] },
    { id: 3, shortname: 'meadow', group_id: 2, width: 800, height: 600 },
    // A planet scene that says otherwise for itself.
    { id: 4, shortname: 'landing', group_id: 2, team_only: false, width: 800, height: 600 },
  ],
};
const scenario = normalizeScenario(raw);

test('the document with groups, a glossary and shadow spots is valid', () => {
  const check = validateScenario(raw);
  assert.deepEqual(check.errors, []);
  const bad = validateScenario({ ...raw, glossary: [{ id: 'x', term: '', definition: '' }], scenes: [{ ...raw.scenes[0]!, shadow_spots: [{ x: 1, y: 1, radius: 0 }] }, ...raw.scenes.slice(1)] });
  const paths = bad.errors.map((e) => e.path);
  assert.ok(paths.includes('glossary[0].term'));
  assert.ok(paths.includes('scenes[0].shadow_spots[0].radius'));
  // The glossary action must name an entry that exists.
  assert.ok(paths.some((p) => p.endsWith('entry_id')));
});

test('a scene is limited to teams by itself, or else by its group', () => {
  const by = (id: number) => sceneTeamOnly(scenario, scenario.scenes.find((s) => s.id === id)!);
  assert.deepEqual([by(1), by(2), by(3), by(4)], [false, true, true, false]);
});

test('shade is deepest at the centre of a spot and gone at its edge', () => {
  const scene = scenario.scenes[0]!;
  assert.ok(Math.abs(shadeAt(scene, 500, 300) - 0.8) < 1e-9);
  assert.equal(shadeAt(scene, 600, 300), 0);
  assert.equal(shadeAt(scene, 100, 100), 0);
  const half = shadeAt(scene, 550, 300);
  assert.ok(half > 0.3 && half < 0.5, String(half));
  // Closer is darker, all the way in.
  assert.ok(shadeAt(scene, 520, 300) > half);
  // Two overlapping spots never go beyond black.
  assert.ok(shadeAt({ shadow_spots: [{ x: 0, y: 0, radius: 10, strength: 100 }, { x: 0, y: 0, radius: 10, strength: 100 }] }, 0, 0) <= 1);
  // A flattened spot reaches less far up than across.
  const flat = { shadow_spots: [{ x: 0, y: 0, radius: 100, radius_y: 20 }] };
  assert.ok(shadeAt(flat, 50, 0) > 0);
  assert.equal(shadeAt(flat, 0, 50), 0);
  assert.equal(shadeTint(0), 0xffffff);
  assert.equal(shadeTint(1), 0x000000);
});

test('a label is behind the players unless it says otherwise', () => {
  assert.equal(labelPlacement({}), 'background');
  assert.equal(labelPlacement({ placement: 'background' }), 'background');
  assert.equal(labelPlacement({ placement: 'object' }), 'object');
  assert.equal(labelPlacement({ placement: 'front' }), 'front');
});

test('the glossary holds the starting words and those the player has been given', () => {
  assert.deepEqual(glossaryOf(scenario, []).map((e) => e.term), ['pH']);
  assert.deepEqual(glossaryOf(scenario, [glossaryFlag('algae')]).map((e) => e.term), ['Algae', 'pH']);
});

function room() {
  const state: WorldState = { players: new Map<string, PlayerRec>(), items: new Map<string, ItemRec>(), vars: new Map<string, string>() };
  const clock = { now: 1_000_000 };
  const world = (team: string) => new World(scenario, {
    state: { players: state.players, items: scopedMap(state.items, team), vars: scopedMap(state.vars, team) },
    now: () => clock.now, newPlayer: () => ({}) as PlayerRec, newItem: () => ({}) as ItemRec,
  }, null, team);
  return { state, clock, red: world('t1'), blue: world('t2') };
}
const user = (id: string): User => ({ id, name: id, role: 'student' });

test('two teams in one room each have their own shared variables and items', () => {
  const { state, red, blue } = room();
  red.addPlayer('r1', user('r1'), null);
  blue.addPlayer('b1', user('b1'), null);
  assert.equal(state.players.get('r1')!.team, 't1');
  assert.equal(state.players.get('b1')!.team, 't2');

  // One team's rockfall is not the other's.
  assert.ok(red.setVariable('r1', { name: 'rockfall', operator: 'set', operand: 1 }));
  assert.equal(state.vars.get('t1|rockfall'), '1');
  assert.equal(state.vars.get('t2|rockfall'), '0');
  assert.deepEqual(red.instanceData().variables, { rockfall: 1 });
  assert.deepEqual(blue.instanceData().variables, { rockfall: 0 });

  // Each team has its own rover (a vehicle is one object per instance).
  assert.ok(state.items.get('t1|1') && state.items.get('t2|1'));
  assert.ok(red.item('r1', { item_id: 1, action: 'attach' }));
  assert.equal(state.items.get('t1|1')!.holder, 'r1');
  assert.equal(state.items.get('t2|1')!.holder, '');
});

test('teams meet where a scene allows it and are alone where it does not', () => {
  const { state, clock, red, blue } = room();
  red.addPlayer('r1', user('r1'), null);
  red.addPlayer('r2', user('r2'), null);
  blue.addPlayer('b1', user('b1'), null);
  // The deck is open: everyone there sees everyone.
  assert.deepEqual(red.audience('r1').sort(), ['b1', 'r2']);
  assert.deepEqual(red.show('r1', { event_id: 20, action_id: 21 })!.sort(), ['b1', 'r2']);

  // The lab is for one team at a time.
  clock.now += 1000;
  for (const [w, id] of [[red, 'r1'], [red, 'r2'], [blue, 'b1']] as const) assert.ok(w.changeScene(id, { scene_id: 2 }));
  assert.deepEqual(red.audience('r1'), ['r2']);
  assert.deepEqual(blue.audience('b1'), []);
  assert.deepEqual(red.show('r1', { event_id: 40, action_id: 41 }), ['r2']);

  const [r1, b1] = [state.players.get('r1')!, state.players.get('b1')!];
  assert.equal(canSee(r1, b1, true), false);
  assert.equal(canSee(r1, b1, false), true);
  assert.equal(canSee(r1, { ...b1, scene_id: 3 }, false), false);
});

test('read-aloud words: where they are, which one a voice has reached, and an even pace', () => {
  const text = 'Welcome aboard, cadet. Ready?';
  const words = speechWords(text);
  assert.deepEqual(words.map((w) => text.slice(w.start, w.end)), ['Welcome', 'aboard,', 'cadet.', 'Ready?']);
  assert.equal(wordAt(words, 0), 0);
  assert.equal(wordAt(words, 9), 1);
  assert.equal(wordAt(words, 22), 2);
  assert.equal(wordAt(words, 23), 3);
  const times = estimateWordTimes(text, words, 4000);
  assert.equal(times[0], 0);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]!));
  assert.ok(times[3]! < 4000);
  // The pause after a sentence makes "cadet." last longer than "aboard,".
  assert.ok(times[3]! - times[2]! > times[2]! - times[1]!);

  assert.equal(isNarrated({}, {}), false);
  assert.equal(isNarrated({ narration: 'on' }, {}), true);
  assert.equal(isNarrated({ narration: 'on' }, { narrate: false }), false);
  assert.equal(isNarrated({}, { narrate: true }), true);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locateIssue, pathTokens, validateScenario, type Action, type Scenario } from '../src/index.js';

const doc: Scenario = {
  id: 1, shortname: 'pond', title: 'Pond', start_scene_id: 10,
  assets: [{ id: 1, type: 'image', url: 'bg.png' }],
  global_variables: [{ variable_name: 'found', default_value: 0 }],
  characters: [{ id: 5, name: 'Frog', animations: { walk: { media_id: 1, frames: [9] } } }],
  objectives: [{ id: 'find', text: 'Find it', complete_when: [{ variable: 'gone', operator: '=', operand: 1 }] }],
  scenes: [
    { id: 10, shortname: 'Schoolyard', background_media: [{ media_id: 1 }], spawn_points: [{ name: 'default', position_x: 1, position_y: 1 }] },
    {
      id: 11, shortname: 'Pond', background_media: [{ media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 1, position_y: 1 }],
      start_events: [{
        id: 20, shortname: 'Arrive',
        actions: [
          { id: 30, type: 'translate', duration: 500 },
          { id: 31, type: 'infobox', content: 'Hi', call_to_actions: [{ text: 'Go', action: { type: 'jump' } }] },
          { id: 32, type: 'cancel', action_id: 999 },
        ] as Action[],
      }],
    },
  ],
};

test('paths are split into names and indexes', () => {
  assert.deepEqual(pathTokens('scenes[3].start_events[0].actions[0].target_id'), ['scenes', 3, 'start_events', 0, 'actions', 0, 'target_id']);
  assert.deepEqual(pathTokens('objectives[0](complete_when).conditions[1]'), ['objectives', 0, 'complete_when', 'conditions', 1]);
  assert.deepEqual(pathTokens(''), []);
});

test('an action path names its scene, event, action and field, with their ids', () => {
  const place = locateIssue(doc, 'scenes[1].start_events[0].actions[0].target_id');
  assert.deepEqual(place.scene, { index: 1, id: 11, name: 'Pond' });
  assert.deepEqual(place.event, { list: 'start_events', kind: 'start', index: 0, id: 20, name: 'Arrive' });
  assert.deepEqual(place.action, { index: 0, id: 30, type: 'translate' });
  assert.equal(place.field, 'target_id');
});

test('a button inside an infobox, a label, a layout entry and conditions are found', () => {
  const button = locateIssue(doc, 'scenes[1].start_events[0].actions[1].call_to_actions[0].action.scene_id');
  assert.deepEqual(button.action, { index: 1, id: 31, type: 'infobox', button: { index: 0, text: 'Go' } });
  assert.equal(button.field, 'scene_id');

  assert.deepEqual(locateIssue(doc, 'scenes[0].hotspots[2].labels[1].placement').label, { index: 1 });
  assert.deepEqual(locateIssue(doc, 'scenes[0].spawn_points[0]').layout, { list: 'spawn_points', index: 0 });
  assert.deepEqual(locateIssue(doc, 'scenes[0].background_media[0]').layout, { list: 'background_media', index: 0 });
  assert.deepEqual(locateIssue(doc, 'scenes[1].start_events[0].conditions[2]').condition, { index: 2, of: undefined });
  const objective = locateIssue(doc, 'objectives[0](complete_when).conditions[0]');
  assert.deepEqual(objective.entry, { list: 'objectives', index: 0, id: 'find', name: 'Find it' });
  assert.deepEqual(objective.condition, { index: 0, of: 'complete_when' });
});

test('scenario lists and settings are found', () => {
  assert.deepEqual(locateIssue(doc, 'characters[0].animations.walk.frames'), {
    entry: { list: 'characters', index: 0, id: 5, name: 'Frog', animation: 'walk' }, field: 'frames',
  });
  assert.deepEqual(locateIssue(doc, 'global_variables[0]').entry, { list: 'global_variables', index: 0, id: undefined, name: 'found' });
  assert.deepEqual(locateIssue(doc, 'start_scene_id'), { field: 'start_scene_id' });
  assert.deepEqual(locateIssue(doc, ''), {});
  assert.deepEqual(locateIssue(null, 'scenes[4].hotspots[0]').event?.id, undefined);
});

test('every issue the validator finds can be located', () => {
  const report = validateScenario(doc);
  const messages = report.errors.map((e) => e.message);
  assert.ok(messages.includes('No action is chosen to move, resize or fade'), messages.join('\n'));
  assert.ok(messages.includes('No scene is chosen to go to'), messages.join('\n'));
  assert.ok(messages.includes('Action 999 does not exist (it may have been deleted)'), messages.join('\n'));
  for (const issue of [...report.errors, ...report.warnings]) {
    const place = locateIssue(doc, issue.path);
    assert.ok(issue.path === '' || Object.keys(place).length > 0, `nothing found for ${issue.path}`);
    if (place.scene) assert.ok(place.scene.id !== undefined, issue.path);
    if (place.event) assert.ok(place.event.id !== undefined, issue.path);
    if (place.action) assert.ok(place.action.id !== undefined, issue.path);
  }
});

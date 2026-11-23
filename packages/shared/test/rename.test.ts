import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renameVariable, renameVariableInText, validateScenario, type Scenario } from '../src/index.js';

test('conditions, variable actions and placeholders follow a renamed variable', () => {
  const event = {
    id: 1,
    conditions: [{ variable: 'found', operator: '=', operand: 1 }, { variable: 'founder', operator: '=', operand: 1 }],
    actions: [
      { type: 'variable', name: 'found', operator: 'set', operand: 1 },
      { type: 'variable', name: 'founder', operator: 'set', operand: 1 },
      { type: 'dialogue', name: 'found', text: 'You have {{found}} of {{ found }}, not {{founder}} or {{media:3}}.' },
    ],
  };
  const out = renameVariable(event, 'found', 'found_source');
  const bench = { readouts: [{ id: 'found', measure: 'time', variable: 'found' }], watches: [{ id: 'w', when: 'overflow', variable: 'found' }], graph: { x: 'time', y: 'found', variable: 'found' } };
  // A readout's own id is not a variable, even when it is spelled the same.
  assert.deepEqual(renameVariable(bench, 'found', 'f2'), { readouts: [{ id: 'found', measure: 'time', variable: 'f2' }], watches: [{ id: 'w', when: 'overflow', variable: 'f2' }], graph: { x: 'time', y: 'found', variable: 'f2' } });
  assert.deepEqual(out.conditions.map((c) => c.variable), ['found_source', 'founder']);
  assert.equal(out.actions[0]!.name, 'found_source');
  assert.equal(out.actions[1]!.name, 'founder');
  // A dialogue's `name` is not a variable.
  assert.equal(out.actions[2]!.name, 'found');
  assert.equal(out.actions[2]!.text, 'You have {{found_source}} of {{ found_source }}, not {{founder}} or {{media:3}}.');
});

test('what does not change stays the same object', () => {
  const row = { a: { conditions: [{ variable: 'x', operator: '=', operand: 1 }] }, b: ['text'] };
  assert.equal(renameVariable(row, 'y', 'z'), row);
  const out = renameVariable(row, 'x', 'z');
  assert.notEqual(out, row);
  assert.equal(out.b, row.b);
});

test("an editor action row keeps its variable in params", () => {
  const row = { id: 3, type: 'variable', params: { name: 'score', operator: '+', operand: 1 } };
  assert.deepEqual(renameVariable(row, 'score', 'points'), { id: 3, type: 'variable', params: { name: 'points', operator: '+', operand: 1 } });
  const other = { id: 4, type: 'dialogue', params: { name: 'score', text: '{{score}}' } };
  assert.deepEqual(renameVariable(other, 'score', 'points'), { id: 4, type: 'dialogue', params: { name: 'score', text: '{{points}}' } });
});

test("an infobox's rich blocks follow a renamed variable", () => {
  const html = [
    '<input data-qbl="slider" data-var="mass" data-min="0">',
    '<span data-qbl="value" data-var=\'mass\'></span>',
    '<span data-qbl="calc" data-formula="mass / volume + massive" data-var="density"></span>',
    '<input data-qbl="answer" data-var="a" data-accept="mass * 2 | 3 kg" data-check="mass_right">',
    '<div data-qbl="when" data-when="mass >= 4; light = &quot;mass&quot;">heavy</div>',
    '<div data-qbl="graph" data-fn="mass*x^2" data-points="mass,py=1,2" data-series="mass"></div>',
    '<input data-var="mass">',
    '<p>mass is {{mass}}</p>',
  ].join('\n');
  const out = renameVariableInText(html, 'mass', 'weight');
  assert.equal(out, [
    '<input data-qbl="slider" data-var="weight" data-min="0">',
    '<span data-qbl="value" data-var=\'weight\'></span>',
    '<span data-qbl="calc" data-formula="weight / volume + massive" data-var="density"></span>',
    '<input data-qbl="answer" data-var="a" data-accept="weight * 2 | 3 kg" data-check="mass_right">',
    '<div data-qbl="when" data-when="weight >= 4; light = &quot;mass&quot;">heavy</div>',
    '<div data-qbl="graph" data-fn="weight*x^2" data-points="weight,py=1,2" data-series="weight"></div>',
    // Not a rich block: left alone.
    '<input data-var="mass">',
    '<p>mass is {{weight}}</p>',
  ].join('\n'));
  assert.equal(renameVariableInText('<div data-qbl="when" data-when="mass % 2; a !% 3">x</div>', 'mass', 'weight'), '<div data-qbl="when" data-when="weight % 2; a !% 3">x</div>');
  // In a curve, x is the axis.
  assert.equal(renameVariableInText('<div data-qbl="graph" data-fn="a*x" data-points="x,y=1,1"></div>', 'x', 'u'), '<div data-qbl="graph" data-fn="a*x" data-points="u,y=1,1"></div>');
});

test('a renamed scenario still validates, objectives included', () => {
  const scenario = {
    id: 1, shortname: 'r', title: 'R', start_scene_id: 1, global_variables: [{ variable_name: 'n', default_value: 0 }, { variable_name: 'other', default_value: 0 }],
    settings: { objectives: [{ id: 'o1', text: 'Count: {{n}}', conditions: [{ variable: 'n', operator: '>', operand: 2 }] }] },
    scenes: [{
      id: 1, width: 800, height: 600,
      start_events: [{ id: 1, conditions: [{ variable: 'n', operator: '<', operand: 5 }], actions: [{ id: 1, type: 'variable', name: 'n', operator: '+', operand: 1 }] }],
    }],
  } as unknown as Scenario;
  const before = validateScenario(scenario).errors.length;
  assert.equal(before, 0, JSON.stringify(validateScenario(scenario).errors));
  const out = renameVariable(scenario, 'n', 'count');
  assert.deepEqual(out.global_variables!.map((v) => v.variable_name), ['count', 'other']);
  assert.equal(JSON.stringify(out).includes('"n"'), false);
  assert.equal(validateScenario(out).errors.length, before);
  // Renaming only `n` in the document's variables would leave its uses unknown.
  const half = { ...scenario, global_variables: out.global_variables };
  assert.ok(validateScenario(half).errors.length > before);
});

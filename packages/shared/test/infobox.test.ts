import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerValue, embedBareMedia, infoboxRefs, parseWhen, remapMediaPlaceholders, testWhen, validateScenario, wheelOptions, type Scenario } from '../src/index.js';

const rich = `<h3>Ponds</h3><p>{{media:4}}</p><hr data-qbl="page">
<div data-qbl="gallery"><figure><img src="{{media:5}}"></figure><figure><img src="{{ media:4 }}"></figure></div>
<p>An <span data-qbl="word" data-word="algae">alga</span> is a plant.</p><hr data-qbl='page'>
<input data-qbl="answer" data-var="guess" placeholder="Type it"><input data-var="ignored">`;

test('what an infobox refers to is read from its HTML', () => {
  const plain = { writes: [], problems: [], uses: { formula: false, math: false, graph: false } };
  assert.deepEqual(infoboxRefs(rich), { media: [4, 5], answers: ['guess'], words: ['algae'], controls: [], reads: [], pages: 3, ...plain });
  assert.deepEqual(infoboxRefs(undefined), { media: [], answers: [], words: [], controls: [], reads: [], pages: 1, ...plain });
});

test('a {{media:ID}} on its own in the text shows the media; one in an address is left for the address', () => {
  const type = (id: number) => ({ 4: 'image', 5: 'video', 6: 'audio' })[id];
  assert.equal(
    embedBareMedia('<p>{{media:4}}</p><p>{{media:5}} and {{media:6}}</p><img src="{{media:4}}">{{media:9}}', type),
    '<p><img src="{{media:4}}" alt=""></p><p><video src="{{media:5}}"></video> and <audio src="{{media:6}}"></audio></p><img src="{{media:4}}">{{media:9}}',
  );
});

test('media placeholders follow their media to new ids', () => {
  assert.equal(remapMediaPlaceholders('<img src="{{media:4}}">{{media:5}}{{media:7}}', (id) => ({ 4: 40, 5: 50 })[id]), '<img src="{{media:40}}">{{media:50}}{{media:7}}');
});

test('a typed answer is saved as a number when it is one', () => {
  assert.deepEqual(['7', ' 3.5 ', '-2', 'seven', ' acid ', '', '1e3'].map(answerValue), [7, 3.5, -2, 'seven', 'acid', '', '1e3']);
});

function doc(box: Record<string, unknown>, extra: Partial<Scenario> = {}): Scenario {
  return {
    id: 1, shortname: 'quiz', title: 'Quiz', start_scene_id: 1,
    assets: [{ id: 4, type: 'image', url: 'pond.png' }, { id: 6, type: 'audio', url: 'splash.mp3' }],
    global_variables: [{ variable_name: 'guess', default_value: '' }],
    glossary: [{ id: 'algae', term: 'Algae', definition: 'Tiny water plants.' }],
    scenes: [{ id: 1, shortname: 'pond', width: 800, height: 600, hotspots: [{ id: 10, position_x: 1, position_y: 1, radius: 10, actions: [{ id: 11, type: 'infobox', ...box }] }] }],
    ...extra,
  } as Scenario;
}

test('the validator checks what a rich infobox refers to', () => {
  const ok = doc({ content: '<p>{{media:4}}</p><input data-qbl="answer" data-var="guess"><span data-qbl="word" data-word="algae">x</span>', media_id: 4, size: 'large', call_to_actions: [{ text: 'Check', mark: 'right' }] });
  assert.deepEqual(validateScenario(ok).errors, []);
  assert.deepEqual(validateScenario(ok).warnings.filter((w) => w.path.includes('actions')), []);

  const bad = validateScenario(doc({
    content: '<p>{{media:99}}</p><input data-qbl="answer" data-var="nope"><span data-qbl="word" data-word="ghost">x</span>',
    media_id: 6, size: 'huge', dismissible: false,
    call_to_actions: [{ text: 'No', mark: 'try_again' }, { text: 'Hm', mark: 'maybe' }],
  }));
  const said = [...bad.errors, ...bad.warnings].map((i) => i.message).join('\n');
  assert.match(said, /media 99, which is not in the scenario's media/);
  assert.match(said, /answer box saves to the variable "nope", which is not defined/);
  assert.match(said, /glossary word \(ghost\) that is not in the glossary/);
  assert.match(said, /picture at the top is audio/);
  assert.match(said, /size is small, medium or large/);
  assert.match(said, /mark is right, wrong or try_again/);
  // Only "try again" buttons: a box that cannot be closed would never close.
  const stuck = validateScenario(doc({ content: '<p>?</p>', dismissible: false, call_to_actions: [{ text: 'No', mark: 'try_again' }] }));
  assert.match(stuck.errors.map((e) => e.message).join('\n'), /cannot be dismissed needs at least one button that is always offered and is not "Try again"/);
});

test('controls: sliders, switches and wheels write variables; values, meters and when blocks read them', () => {
  const html = '<div data-qbl="panel"><input data-qbl="slider" data-var="rope" data-min="0" data-max="10" data-value="4" data-label="Rope">'
    + '<input data-qbl="switch" data-var="brake"><div data-qbl="wheel" data-var="weather" data-options="Sun|Rain|Rain"></div></div>'
    + '<span data-qbl="value" data-var="rope"></span><div data-qbl="meter" data-var="lift"></div><div data-qbl="when" data-when="rope >= 6; brake = 1; weather != Rain">Up!</div>';
  const refs = infoboxRefs(html);
  assert.deepEqual(refs.controls, ['rope', 'brake', 'weather']);
  assert.deepEqual(refs.reads, ['rope', 'lift', 'brake', 'weather']);
  const when = parseWhen('rope >= 6; brake = 1, weather != "Rain" ; nonsense');
  assert.deepEqual(when, [
    { variable: 'rope', operator: '>=', operand: 6 },
    { variable: 'brake', operator: '=', operand: 1 },
    { variable: 'weather', operator: '!=', operand: 'Rain' },
  ]);
  const at = (v: Record<string, unknown>) => testWhen(when, (n) => v[n]);
  assert.equal(at({ rope: '7', brake: 1, weather: 'Sun' }), true, 'numbers typed as text compare as numbers');
  assert.equal(at({ rope: 5, brake: 1, weather: 'Sun' }), false);
  assert.equal(at({ rope: 9, brake: 1, weather: 'Rain' }), false);
  assert.equal(at({ rope: 9, brake: 1 }), true, 'a wheel not spun yet is no option');
  assert.equal(testWhen(parseWhen('x > 2'), () => 'abc'), false, 'text is never more than a number');
  assert.deepEqual(parseWhen('turn % 2; step !% 3'), [{ variable: 'turn', operator: '%', operand: 2 }, { variable: 'step', operator: '!%', operand: 3 }]);
  assert.equal(testWhen(parseWhen('turn % 2; step !% 3'), (n) => ({ turn: 4, step: 5 })[n]), true);
  assert.equal(testWhen(parseWhen('turn % 2'), () => '7'), false);
  assert.deepEqual(wheelOptions(' Sun | Rain||Wind '), ['Sun', 'Rain', 'Wind']);
});

test('the validator checks the variables controls write and what boxes read', () => {
  const bad = validateScenario(doc({ content: '<input data-qbl="slider" data-var="nope"><span data-qbl="value" data-var="ghost"></span>', dismissible: true }));
  const said = [...bad.errors, ...bad.warnings].map((i) => i.message).join('\n');
  assert.match(said, /control \(slider, switch or wheel\) saves to the variable "nope", which is not defined/);
  assert.match(said, /shows or tests "ghost", which is neither a control in this box nor a variable/);
});

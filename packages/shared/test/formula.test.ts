import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAnswer, evaluateNumber, formatNumber, formula, formulaFunction, formulaProblem } from '../src/formula.js';
import { formulaGlance, formulaNames, graphSpec, infoboxRefs, parseSeries, seriesText } from '../src/index.js';

test('a formula is worked out from the names it reads', () => {
  const vars: Record<string, unknown> = { mass: 12, volume: '4', on: true };
  const get = (n: string) => vars[n];
  assert.equal(evaluateNumber('mass / volume', get), 3);
  assert.equal(evaluateNumber('sqrt(mass + volume) * on', get), 4);
  assert.equal(evaluateNumber('2 * pi', get)?.toFixed(4), '6.2832');
  // A name nobody has, and nonsense, have no value rather than throwing.
  assert.equal(evaluateNumber('mass / density', get), null);
  assert.equal(evaluateNumber('mass /', get), null);
  assert.equal(evaluateNumber('1 / 0', get), null);
  assert.deepEqual(formula('a * x^2 + sin(b)')?.names.sort(), ['a', 'b', 'sin', 'x']);
});

test('quantities keep their units', () => {
  assert.equal(evaluateNumber('2 m + 50 cm', undefined, 'cm'), 250);
  assert.equal(evaluateNumber('90 km / (2 h)', undefined, 'm/s'), 12.5);
  assert.equal(formatNumber(3.14159, 2), '3.14');
  assert.equal(formatNumber(2.5, 3), '2.5');
  assert.equal(formatNumber(7, 0), '7');
  assert.equal(formatNumber(null), '–');
});

test('a curve follows its other names as they change', () => {
  let a = 2;
  const f = formulaFunction('a * x^2', (n) => (n === 'a' ? a : undefined))!;
  assert.equal(f(3), 18);
  a = 0.5;
  assert.equal(f(4), 8);
  assert.ok(Number.isNaN(formulaFunction('k * x')!(1)));
  assert.equal(formulaFunction('x +', undefined), null);
});

test('an answer is right in any unit of its kind, and within its tolerance', () => {
  assert.equal(checkAnswer('9.8 m/s^2', '9.8 m/s^2'), true);
  assert.equal(checkAnswer('980 cm/s^2', '9.8 m/s^2'), true);
  assert.equal(checkAnswer('9.8', '9.8 m/s^2'), false, 'a unit is expected');
  assert.equal(checkAnswer('9.8 kg', '9.8 m/s^2'), false, 'the wrong kind of unit');
  assert.equal(checkAnswer('9.81 m/s^2', '9.8 m/s^2'), false);
  assert.equal(checkAnswer('9.81 m/s^2', '9.8 m/s^2', '1%'), true);
  assert.equal(checkAnswer('10.4 m/s^2', '9.8 m/s^2', 0.5), false);
  assert.equal(checkAnswer('12', '12'), true);
  assert.equal(checkAnswer(' 12,5 ', '12.5'), true, 'a decimal comma');
  assert.equal(checkAnswer('12 cm', '12'), false, 'no unit is expected');
  assert.equal(checkAnswer('', '12'), false);
  // What is accepted may be worked out from variables; what is typed may not read them.
  const get = (n: string) => ({ mass: 12, volume: 4 })[n];
  assert.equal(checkAnswer('3', 'mass / volume', null, get), true);
  assert.equal(checkAnswer('mass / volume', 'mass / volume', null, get), true, 'the same words');
  assert.equal(checkAnswer('mass', '12', null, get), false);
  // Words, and several right answers.
  assert.equal(checkAnswer(' Carbon  Dioxide ', 'carbon dioxide | CO2'), true);
  assert.equal(checkAnswer('co2', 'carbon dioxide | CO2'), true);
  assert.equal(checkAnswer('oxygen', 'carbon dioxide | CO2'), false);
});

test('a formula cannot reach outside itself', () => {
  assert.equal(evaluateNumber('import({})'), null);
  assert.equal(evaluateNumber('evaluate("1+1")'), null);
  assert.equal(evaluateNumber('parse("1+1")'), null);
  assert.equal(evaluateNumber('createUnit("foo")'), null);
  assert.match(formulaProblem('(1 + 2') ?? '', /./);
  assert.equal(formulaProblem('1 + 2'), null);
  assert.match(formulaProblem('x'.repeat(600)) ?? '', /longer/);
});

test('the validator reads formulas without math.js', () => {
  assert.deepEqual(formulaNames('mass / volume * 100'), ['mass', 'volume']);
  assert.deepEqual(formulaNames('a * sin(x) + pi + 2e3 + 5 cm'), ['a', 'x']);
  assert.equal(formulaGlance('(a + b'), 'a bracket is never closed');
  assert.equal(formulaGlance('a + b)'), 'a bracket is closed that was never opened');
  assert.equal(formulaGlance('(a + b) * [1, 2]'), null);
});

test('a graph block is read from its attributes', () => {
  const attrs: Record<string, string> = { 'data-fn': 'a*x^2; sin(x)', 'data-x': '-5, 5', 'data-y': '0,10', 'data-points': 'px,py=1,2; qx,qy; bad; same,same=1,1', 'data-join': 'Line', 'data-series': 'log', 'data-snap': '0.5', 'data-xlabel': ' Time (s) ' };
  const spec = graphSpec((n) => attrs[n]);
  assert.deepEqual(spec.functions, ['a*x^2', 'sin(x)']);
  assert.deepEqual([spec.x, spec.y], [[-5, 5], [0, 10]]);
  assert.deepEqual(spec.points, [{ xVar: 'px', yVar: 'py', x: 1, y: 2 }, { xVar: 'qx', yVar: 'qy', x: 0, y: 0 }]);
  assert.deepEqual([spec.join, spec.series, spec.snap, spec.xLabel], ['line', 'log', 0.5, 'Time (s)']);
  // Nothing given: sensible axes and nothing drawn.
  const empty = graphSpec(() => null);
  assert.deepEqual([empty.x, empty.y, empty.functions, empty.points, empty.join, empty.series], [[-10, 10], [-10, 10], [], [], 'none', null]);
  assert.deepEqual(graphSpec((n) => (n === 'data-x' ? '5,1' : null)).x, [-10, 10], 'a range the wrong way round');
});

test('recorded data is kept in a variable as text', () => {
  assert.deepEqual(parseSeries('0,7;1.5,6.25; 3 , 4 ;nonsense;5;1,2,3;'), [[0, 7], [1.5, 6.25], [3, 4]]);
  assert.equal(seriesText([[0, 7], [1 / 3, 2]]), '0,7;0.333,2');
  assert.deepEqual(parseSeries(undefined), []);
  assert.equal(parseSeries(seriesText(Array.from({ length: 400 }, (_, i) => [i, i] as [number, number]))).length, 300);
});

test('what a box with maths in it reads and writes', () => {
  const html = `<span data-qbl="math" data-tex="\\rho = m / V">ρ</span>
<input data-qbl="slider" data-var="mass" data-max="50"><input data-qbl="slider" data-var="volume" data-max="50">
<span data-qbl="calc" data-formula="mass / volume" data-var="density" data-unit="g/mL"></span>
<input data-qbl="answer" data-var="guess" data-accept="mass / volume" data-check="guess_ok">
<div data-qbl="graph" data-fn="k*x; sin(x" data-points="px,py=1,1" data-series="log"></div>`;
  const refs = infoboxRefs(html);
  assert.deepEqual(refs.controls.sort(), ['mass', 'volume']);
  assert.deepEqual(refs.writes.sort(), ['density', 'guess_ok', 'px', 'py']);
  assert.deepEqual(refs.answers, ['guess']);
  assert.deepEqual(refs.reads.sort(), ['k', 'log', 'mass', 'volume']);
  assert.deepEqual(refs.uses, { formula: true, math: true, graph: true });
  assert.equal(refs.problems.length, 1);
  assert.match(refs.problems[0]!, /sin\(x/);
  assert.match(infoboxRefs('<span data-qbl="calc"></span>').problems[0]!, /no formula/);
});

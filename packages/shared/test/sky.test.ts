import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixColor, skyHour, skyLook, SKY_HOURS, validateScenario } from '../src/index.js';

test('the sky blends smoothly between times of day', () => {
  assert.equal(skyLook(12).top, '#3d8fe0');
  assert.equal(skyLook(SKY_HOURS.night).stars, 1);
  // Half way between golden hour and sunset: between their colours, the sun going down.
  const mid = skyLook((SKY_HOURS.golden + SKY_HOURS.sunset) / 2);
  assert.equal(mid.horizon, mixColor('#ffcf7a', '#ff9a4a', 0.5));
  assert.ok(mid.sun > 0 && mid.sun < 0.22);
  // Round the clock: two in the morning is night.
  assert.equal(skyLook(2).top, skyLook(23).top);
  assert.ok(skyLook(SKY_HOURS.dusk).dark > skyLook(SKY_HOURS.sunset).dark);
});

test('a sky moves on slowly to what it becomes, and stays', () => {
  const sky = { time: 'afternoon' as const, until: 'dusk' as const, minutes: 10 };
  assert.equal(skyHour(sky, 0), SKY_HOURS.afternoon);
  const half = skyHour(sky, 5 * 60_000);
  assert.ok(Math.abs(half - (SKY_HOURS.afternoon + SKY_HOURS.dusk) / 2) < 0.01, String(half));
  assert.ok(skyHour(sky, 60_000) - SKY_HOURS.afternoon < (half - SKY_HOURS.afternoon) / 3, 'it starts gently');
  assert.equal(skyHour(sky, 60 * 60_000), SKY_HOURS.dusk);
  assert.equal(skyHour({ time: 'midday' }, 99_999_999), SKY_HOURS.midday, 'without until it stays');
  // Night until dawn goes on through the small hours.
  const small = skyHour({ time: 'night', until: 'dawn', minutes: 2 }, 60_000);
  assert.ok(small > 23 || small < 6, String(small));
});

test('sky, lights and what is in the air are checked', () => {
  const scenario = {
    id: 1, name: 's', start_scene_id: 1, assets: [], items: [], global_variables: [],
    scenes: [{
      id: 1, width: 100, height: 100,
      sky: { time: 'teatime', until: 'dusk', horizon: 2 },
      lights: [{ x: 1, y: 2, kind: 'disco', color: 'red' }, { x: 5, y: 5, kind: 'fire', color: '#ffaa00' }],
      atmosphere: [{ kind: 'fireflies', amount: 'lots' }],
    }],
  } as any;
  const problems = validateScenario(scenario).errors.map((e: { path: string }) => e.path);
  for (const path of ['scenes[0].sky.time', 'scenes[0].sky.horizon', 'scenes[0].lights[0].kind', 'scenes[0].lights[0].color', 'scenes[0].atmosphere[0].amount']) {
    assert.ok(problems.includes(path), `${path} in ${problems.join(', ')}`);
  }
  assert.ok(!problems.some((p: string) => p.startsWith('scenes[0].lights[1]')));
});

test('a light\'s conditions are checked like any others', () => {
  const scenario = {
    id: 1, name: 's', start_scene_id: 1, assets: [], items: [], global_variables: [{ variable_name: 'repaired', default_value: 0 }],
    scenes: [{
      id: 1, width: 100, height: 100,
      lights: [
        { x: 1, y: 2, conditions: [{ variable: 'repaired', operator: '=', operand: 1 }] },
        { x: 5, y: 5, conditions: [{ variable: 'nowhere', operator: '=', operand: 1 }] },
        { x: 9, y: 9, conditions: [{ variable: 'repaired', operator: '~', operand: 1 }] },
      ],
    }],
  } as any;
  const problems = validateScenario(scenario).errors.map((e: { path: string }) => e.path);
  assert.ok(!problems.some((p: string) => p.startsWith('scenes[0].lights[0]')), problems.join(', '));
  assert.ok(problems.includes('scenes[0].lights[1].conditions[0]'), problems.join(', '));
  assert.ok(problems.includes('scenes[0].lights[2].conditions[0]'), problems.join(', '));
});

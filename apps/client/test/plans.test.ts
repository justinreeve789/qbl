process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missionCard, type Mission } from '../src/home';
import type { PlanCard } from '../src/net/Api';
import { planFeatures } from '../src/plans';

const base: Mission = { id: 1, code: 'cells', title: 'Cell Biology', kind: 'public', group: 'public', tier: 'curricular' };
const now = new Date('2026-11-20T10:00:00Z');

test('a curricular mission the plan does not include leads to the plans, saying so', () => {
  const card = missionCard({ ...base, locked: true }, now, 'en-GB');
  assert.equal(card.href, '/plans');
  assert.equal(card.action, 'See plans');
  assert.deepEqual(card.tags, [{ text: '🔒 With a teacher plan', tone: 'locked' }]);
});

test('an assigned one whose teacher\'s plan has lapsed stays where it is, closed for now', () => {
  const card = missionCard({ ...base, kind: 'assigned', group: 'a3', teacher: 'Ms Tan', locked: true }, now, 'en-GB');
  assert.equal(card.href, '/cells?group=a3');
  assert.deepEqual(card.tags.at(-1), { text: '🔒 Closed for now', tone: 'locked' });
});

test('an open curricular mission is a mission like any other', () => {
  assert.equal(missionCard({ ...base, locked: false }, now).href, '/cells');
});

test('the plans say what they include, with about how many missions the credits make', () => {
  const plus: PlanCard = { key: 'teacher_plus', name: 'Teacher Plus', price: 50, summary: '', curricular: true, generator: true, students: 40, monthly_credits: 100, credit_carryover: 100 };
  assert.deepEqual(planFeatures(plus, 10), [
    'Every curricular mission, to play and to assign', 'Classes of up to 40 students', 'Teams, assignments and reports',
    'The AI mission generator: 100 credits a month (about 10 missions)', 'Unused credits carry over, up to 100',
  ]);
  assert.equal(planFeatures({ ...plus, key: 'free', price: 0 }, 10)[0], 'Play every free mission');
});

process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, missionCard, whoNotice, type Mission } from '../src/home';

const base: Mission = { id: 1, code: 'starshipexplorer', title: 'Starship Explorer', kind: 'public', group: 'public' };
const now = new Date('2026-11-17T10:00:00Z');

test('a public mission opens at its code and starts fresh', () => {
  const card = missionCard(base, now, 'en-GB');
  assert.equal(card.href, '/starshipexplorer');
  assert.equal(card.action, 'Start');
  assert.deepEqual(card.tags, []);
});

test('an assigned mission opens in its own instance and says who gave it, the team and the due date', () => {
  const card = missionCard({ ...base, kind: 'assigned', group: 't7', teacher: 'Ms Tan', team: 'Comets', due_at: '2026-12-01 15:00:00', started_at: '2026-11-16 09:00:00' }, now, 'en-GB');
  assert.equal(card.href, '/starshipexplorer?group=t7');
  assert.equal(card.action, 'Continue');
  assert.deepEqual(card.tags, [{ text: 'From Ms Tan', tone: 'plain' }, { text: 'Team Comets', tone: 'team' }, { text: 'Due 1 Dec', tone: 'due' }]);
});

test('due dates read naturally, and a missed one is marked late', () => {
  assert.deepEqual(dueLabel('2026-11-17 18:00:00', now, 'en-GB'), { text: 'Due today', late: false });
  assert.deepEqual(dueLabel('2026-11-18 12:00:00', now, 'en-GB'), { text: 'Due tomorrow', late: false });
  assert.deepEqual(dueLabel('2026-11-10 12:00:00', now, 'en-GB'), { text: 'Was due 10 Nov', late: true });
  assert.equal(missionCard({ ...base, kind: 'assigned', group: 'a3', due_at: '2026-11-10 12:00:00' }, now, 'en-GB').tags[0]!.tone, 'late');
});

test('the missions page says when assigned missions cannot be listed: a guest, or a teacher', () => {
  assert.match(whoNotice('guest')!, /guest.*Sign in.*your teacher assigned/);
  assert.match(whoNotice('teacher')!, /signed in as a teacher.*own accounts/);
  assert.match(whoNotice('admin')!, /signed in as a teacher/);
  assert.equal(whoNotice('student'), null);
});

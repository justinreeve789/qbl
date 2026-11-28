process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignmentsByScenario, assignmentTags, lookInLinks, ownScenarios, sortAssignments, TEACH_PATHS, type TeachAssignment, type TeachScenario } from '../src/teach';
import { missionLists, type Mission } from '../src/home';

const now = new Date('2026-11-17T10:00:00Z');
const scenario = { id: 4, code: 'starshipexplorer', title: 'Starship Explorer' };
const base: TeachAssignment = { id: 1, scenario, due_at: null, note: null, group: 'a1', students: [], teams: [] };

test("an assignment without teams has one way in: the assignment's own instance", () => {
  assert.deepEqual(lookInLinks({ ...base, students: [{ id: 9, name: 'Ada', team_id: null }] }), [{ label: 'Look in', href: '/starshipexplorer?group=a1' }]);
});

test('with teams there is a way into each team, and "No team" when some students are in none', () => {
  const teams = [{ id: 7, name: 'Comets', group: 't7', student_ids: [9] }, { id: 8, name: 'Novas', group: 't8', student_ids: [10] }];
  const all = { ...base, teams, students: [{ id: 9, name: 'Ada', team_id: 7 }, { id: 10, name: 'Bo', team_id: 8 }] };
  assert.deepEqual(lookInLinks(all).map((l) => l.href), ['/starshipexplorer?group=t7', '/starshipexplorer?group=t8']);
  const loose = { ...all, students: [...all.students, { id: 11, name: 'Cy', team_id: null }] };
  assert.deepEqual(lookInLinks(loose).map((l) => l.label), ['Comets', 'Novas', 'No team']);
  assert.equal(lookInLinks(loose).at(-1)!.href, '/starshipexplorer?group=a1');
});

test('an assignment whose scenario is gone cannot be looked in on', () => {
  assert.deepEqual(lookInLinks({ ...base, scenario: null }), []);
});

test("an assignment's labels give the due date, students and teams", () => {
  const a = { ...base, due_at: '2026-11-18 15:00:00', students: [{ id: 9, name: 'Ada', team_id: 7 }], teams: [{ id: 7, name: 'Comets', group: 't7', student_ids: [9] }] };
  assert.deepEqual(assignmentTags(a, now, 'en-GB'), [{ text: 'Due tomorrow', tone: 'due' }, { text: '1 student', tone: 'plain' }, { text: '1 team', tone: 'team' }]);
  assert.deepEqual(assignmentTags({ ...base, due_at: '2026-11-01 15:00:00' }, now, 'en-GB'), [{ text: 'Was due 1 Nov', tone: 'late' }, { text: '0 students', tone: 'plain' }]);
  assert.deepEqual(assignmentTags({ ...base, waiting: true }, now, 'en-GB')[0], { text: 'Waiting for you to launch it', tone: 'waiting' }, 'a mission that waits for its teacher says so first');
});

test('coming assignments are listed soonest first, then undated, then past ones', () => {
  const list = [
    { ...base, id: 1, due_at: '2026-11-01 00:00:00' },
    { ...base, id: 2, due_at: null },
    { ...base, id: 3, due_at: '2026-12-01 00:00:00' },
    { ...base, id: 4, due_at: '2026-11-20 00:00:00' },
    { ...base, id: 5, due_at: '2026-11-10 00:00:00' },
  ];
  assert.deepEqual(sortAssignments(list, now).map((a) => a.id), [4, 3, 2, 5, 1]);
});

test("\"your scenarios\" are the teacher's own, newest first; an admin's are all of them", () => {
  const s = (id: number, user_id: number | null, updated_at: string): TeachScenario => ({ id, code: `c${id}`, title: `S${id}`, user_id, published_at: null, updated_at });
  const list = [s(1, null, '2026-11-19 00:00:00'), s(2, 5, '2026-11-10 00:00:00'), s(3, 5, '2026-11-18 00:00:00'), s(4, 6, '2026-11-17 00:00:00')];
  assert.deepEqual(ownScenarios(list, '5', false).map((x) => x.id), [3, 2]);
  assert.deepEqual(ownScenarios(list, 5, true).map((x) => x.id), [1, 3, 4, 2]);
});

test("the teacher's links go to the editor's pages", () => {
  assert.equal(TEACH_PATHS.newScenario, '/editor/#/new');
  assert.equal(TEACH_PATHS.classes, '/editor/#/classes');
  assert.equal(TEACH_PATHS.edit(12), '/editor/#/s/12');
});

test('a mission assigned more than once is listed once, with its assignments under it, where the soonest falls', () => {
  const other = { id: 5, code: 'reef', title: 'Reef' };
  const list = [
    { ...base, id: 1, due_at: '2026-12-01 00:00:00' },
    { ...base, id: 2, scenario: other, due_at: '2026-11-25 00:00:00' },
    { ...base, id: 3, due_at: '2026-11-20 00:00:00' },
    { ...base, id: 4, scenario: null },
    { ...base, id: 6, scenario: null },
  ];
  assert.deepEqual(assignmentsByScenario(list, now).map((g) => g.map((a) => a.id)), [[3, 1], [2], [6], [4]]);
});

const mission = (id: number, extra: Partial<Mission> = {}): Mission => ({ id, code: `m${id}`, title: `M${id}`, kind: 'public', group: 'public', ...extra });

test('the missions page lists each scenario once: assigned first, soonest due, then the rest to browse', () => {
  const missions = [
    mission(1),
    mission(2),
    mission(3),
    mission(2, { kind: 'assigned', group: 'a7', due_at: '2026-12-01 00:00:00' }),
    mission(3, { kind: 'assigned', group: 'a8', due_at: null }),
    mission(2, { kind: 'assigned', group: 'a9', due_at: '2026-11-20 00:00:00' }),
    mission(4, { kind: 'assigned', group: 'a10', due_at: '2026-11-18 00:00:00' }),
  ];
  const lists = missionLists(missions, now);
  assert.deepEqual(lists.assigned.map((m) => [m.id, m.group]), [[4, 'a10'], [2, 'a9'], [3, 'a8']], 'of two assignments of a scenario, the one due soonest');
  assert.deepEqual(lists.browse.map((m) => m.id), [1], 'an assigned scenario is not offered again to browse');
});

test("a teacher's own assignments are left out of the missions to browse", () => {
  const lists = missionLists([mission(1), mission(2), mission(3, { kind: 'assigned', group: 'a1' })], now, new Set([2, 3]));
  assert.deepEqual(lists.assigned, []);
  assert.deepEqual(lists.browse.map((m) => m.id), [1]);
});

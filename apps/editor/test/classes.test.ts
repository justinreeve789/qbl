import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * The Classes page, in a real browser against the real backend classes: a teacher adds
 * students, assigns a mission to two teams with a due date, changes it, and the students'
 * own missions lists show it.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
const dialogs: string[] = [];
const tokens: Record<string, string> = {};

interface Mission { title: string; kind: string; group: string; team?: string | null; teacher?: string; due_at?: string | null; note?: string | null }

const signIn = async (email: string) => {
  const res = await fetch(`${site.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'x' }) });
  tokens[email] = ((await res.json()) as { token: string }).token;
};
/** The starship's missions as a student sees them. The other shipped scenario (the Science Lab) is a public mission too, and is left out. */
const missions = async (email: string): Promise<Mission[]> => {
  const res = await fetch(`${site.url}/api/missions`, { headers: { Authorization: `Bearer ${tokens[email]}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { missions: Mission[] }).missions.filter((m) => m.title !== 'Science Lab');
};
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  page.on('pageerror', (e) => errors.push(e.message));
  // A refused request is reported on the page; the browser's own note of the 4xx is not a fault.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // The students have signed in once, which is what lets a teacher add them.
  for (const email of ['student.ann@example.test', 'student.ben@example.test', 'student.cy@example.test']) await signIn(email);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a teacher adds students by their address', async () => {
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'teacher@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario="1"]');
  await page.click('.top-nav >> text=Classes');
  await page.waitForSelector('[data-card=students]');
  assert.equal(await page.locator('button:has-text("Assign a mission")').isDisabled(), true, 'nothing can be assigned before there are students');

  for (const email of ['student.ann@example.test', 'student.ben@example.test', 'student.cy@example.test']) {
    await page.fill('[data-form=add-student] input', email);
    await page.click('[data-form=add-student] button');
    await page.waitForFunction((e) => document.querySelector('[data-card=students]')?.textContent?.includes(e), email);
  }
  assert.match(await page.innerText('[data-card=students] h2'), /My students \(3\)/);

  await page.fill('[data-form=add-student] input', 'nobody@example.test');
  await page.click('[data-form=add-student] button');
  await page.waitForSelector('.toast.error');
  assert.match(await page.innerText('.toast.error'), /Nobody has signed in with that address/);
});

test('assign a mission to two teams with a due date; each student sees it in their team', async () => {
  await page.click('button:has-text("Assign a mission")');
  const form = page.locator('[data-form=new-assignment]');
  await form.locator('select[aria-label=Mission]').selectOption({ label: 'Starship Explorer' });
  await form.locator('input[type=datetime-local]').fill('2026-12-01T15:00');
  await form.locator('input[aria-label=Note]').fill('Read chapter 4 first');
  await form.locator('[data-action=add-team]').click();
  await form.locator('[data-action=add-team]').click();
  await form.locator('input[aria-label="Name of team 1"]').fill('Comets');
  await form.locator('input[aria-label="Name of team 2"]').fill('Quasars');
  await form.locator('input[aria-label="Name of team 2"]').blur();
  await form.locator('[data-action=deal]').click();
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('[data-assignment]');
  await saved();

  const card = await page.innerText('[data-assignment]');
  assert.match(card, /Starship Explorer/);
  assert.match(card, /Read chapter 4 first/);
  assert.match(card, /Comets: Student.ann, Student.cy/);
  assert.match(card, /Quasars: Student.ben/);

  const [ann, ben] = [await missions('student.ann@example.test'), await missions('student.ben@example.test')];
  assert.deepEqual(ann.map((m) => [m.title, m.kind, m.team ?? null]), [['Starship Explorer', 'assigned', 'Comets'], ['Starship Explorer', 'public', null]]);
  assert.deepEqual([ann[0]!.teacher, ann[0]!.note, ben[0]!.team], ['Teacher', 'Read chapter 4 first', 'Quasars']);
  assert.match(ann[0]!.group, /^t\d+$/);
  assert.notEqual(ann[0]!.group, ben[0]!.group, 'each team has its own instance');
  assert.equal(new Date(`${ann[0]!.due_at!.replace(' ', 'T')}Z`).getTime(), new Date('2026-12-01T15:00').getTime(), 'the due date is the local time the teacher typed');
  assert.match(await page.getAttribute('[data-assignment] [data-team] a', 'href') ?? '', /starshipexplorer\?group=t\d+$/);

  // A student may open their own team's game, and is refused the other team's.
  const play = (group: string) => fetch(`${site.url}/api/scenarios/starshipexplorer/play?group=${group}`, { headers: { Authorization: `Bearer ${tokens['student.ann@example.test']}` } }).then((r) => r.status);
  assert.deepEqual([await play(ann[0]!.group), await play(ben[0]!.group)], [200, 403]);
});

test('change an assignment: a student moves team, and the teams keep their instances', async () => {
  const before = (await missions('student.ben@example.test'))[0]!.group;
  await page.click('[data-assignment] >> text=Change');
  const form = page.locator('[data-form=edit-assignment]');
  assert.equal(await form.locator('input[aria-label=Note]').inputValue(), 'Read chapter 4 first');
  assert.equal(await form.locator('input[type=datetime-local]').inputValue(), '2026-12-01T15:00');
  await form.locator('select[aria-label="Team for Student.cy"]').selectOption({ label: 'Quasars' });
  await form.locator('input[type=datetime-local]').fill('');
  await form.locator('button[type=submit]').click();
  await page.waitForFunction(() => /Quasars: Student.ben, Student.cy/.test(document.querySelector('[data-assignment]')?.textContent ?? ''));
  assert.match(await page.innerText('[data-assignment]'), /No due date/);
  const cy = (await missions('student.cy@example.test'))[0]!;
  assert.deepEqual([cy.team, cy.group, cy.due_at], ['Quasars', before, null]);
});

test("from the report, a teacher resets a student's progress", async () => {
  await page.click('[data-assignment] [data-action=report]');
  await page.waitForSelector('.report-table tr[data-student]');
  await page.click('.report-table tr[data-student] >> text=Student.ann');
  await page.click('[data-action=reset-progress]');
  await page.waitForSelector('[data-reset-at]');
  const asked = dialogs.at(-1) ?? '';
  assert.match(asked, /Reset Student.ann’s progress in Starship Explorer\?/);
  assert.match(asked, /what Comets did together/, 'a student in a team is told the team’s shared world stays');
  assert.match(await page.innerText('[data-reset-at]'), /Progress reset .* by Teacher/);
  await page.waitForSelector('.toast:not(.error) >> text=/Student.ann will start Starship Explorer again/');
  assert.equal(await page.locator('.report-table tr[data-student] .report-status').first().innerText(), 'Not started');
  await page.click('button:has-text("Back to classes")');
  await page.waitForSelector('[data-assignment]');
});

test("a teacher reads their students' notebooks, but cannot change them", async () => {
  // Student.ann writes in her notebook in her team's game, with a subpage and cards.
  const group = (await missions('student.ann@example.test'))[0]!.group;
  const at = new Date().toISOString();
  const page1 = { id: 'p1', parent: null, title: 'Planets', icon: '🚀', color: 'sky', text: 'Mars is red\nJupiter is big', created_at: at, updated_at: at,
    cards: [{ id: 'c1', kind: 'flash', text: 'Closest to the sun?', back: 'Mercury', color: 'sun', created_at: at, updated_at: at },
      { id: 'c2', kind: 'check', text: 'Find the moon', done: true, color: 'mint', created_at: at, updated_at: at }] };
  const page2 = { ...page1, id: 'p2', parent: 'p1', title: 'Moons', text: 'Europa has ice', cards: [] };
  const put = await fetch(`${site.url}/api/notebooks/starshipexplorer?group=${group}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens['student.ann@example.test']}` }, body: JSON.stringify({ notebook: { pages: [page1, page2] } }),
  });
  assert.equal(put.status, 200);

  const assignment = await page.getAttribute('[data-assignment]', 'data-assignment');
  await page.click('[data-assignment] [data-action=notebooks]');
  await page.waitForSelector('[data-card=notebooks] .nbr-students [data-student]');
  const list = await page.innerText('[data-card=notebooks] .nbr-students');
  assert.match(list, /Student.ann\s+Team Comets · 2 pages · 2 cards · just now/);
  assert.match(list, /Student.ben\s+Team Quasars · Nothing written yet/);
  // The first student who wrote something opens at once.
  await page.waitForSelector('.nbr-page[data-page=p2]');
  const book = await page.innerText('.nbr-reader');
  assert.match(book, /Student.ann’s notebook/);
  assert.match(book, /Mars is red\nJupiter is big/);
  assert.match(book, /Front\s*Closest to the sun\?/i);
  assert.match(book, /Back\s*Mercury/i);
  assert.equal(await page.locator('.nbr-card.check.done').count(), 1, 'a to-do shows whether it is done');
  assert.match(await page.innerText('.nbr-page[data-page=p2] .nbr-trail'), /Planets/, 'a subpage says which page it is under');
  assert.equal(await page.locator('.nbr-reader textarea, .nbr-reader input, .nbr-reader [contenteditable]').count(), 0, 'nothing can be written here');

  await page.click('.nbr-students [data-student] >> text=Student.ben');
  await page.waitForSelector('.nbr-reader >> text=Nothing written in this notebook yet.');

  const asAnn = await fetch(`${site.url}/api/notebooks/teach/${assignment}`, { headers: { Authorization: `Bearer ${tokens['student.ann@example.test']}` } });
  assert.equal(asAnn.status, 403, 'a student cannot read classmates’ notebooks');
  await page.click('button:has-text("Back to classes")');
  await page.waitForSelector('[data-assignment]');
});

test('removing a student and deleting the assignment take the mission away again', async () => {
  await page.click('[data-card=students] [aria-label="Remove Student.ann"]');
  await page.waitForFunction(() => /My students \(2\)/.test(document.querySelector('[data-card=students] h2')?.textContent ?? ''));
  assert.deepEqual((await missions('student.ann@example.test')).map((m) => m.kind), ['public']);
  await page.click('[data-assignment] >> text=Delete');
  await page.waitForSelector('[data-assignment]', { state: 'detached' });
  assert.deepEqual((await missions('student.ben@example.test')).map((m) => m.kind), ['public']);
});

test('a mission that waits for its teacher: hidden from students until shown (or launched from the game)', async () => {
  await page.click('.top-nav [data-place=editor]');
  await page.click('[data-scenario="1"] >> text=Edit');
  await page.click('.tabs >> text=Settings');
  await page.locator('[data-field=wait_for_launch] input[type=checkbox]').check();
  await saved();
  await page.click('.top-nav >> text=Classes');
  await page.click('button:has-text("Assign a mission")');
  const form = page.locator('[data-form=new-assignment]');
  const option = await form.locator('select[aria-label=Mission] option').filter({ hasText: 'Starship Explorer' }).innerText();
  assert.match(option, /waits for you to launch it/, 'the list of missions says so');
  await form.locator('select[aria-label=Mission]').selectOption({ label: option });
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('[data-assignment] [data-launch=waiting]');
  assert.match(await page.innerText('[data-assignment] [data-launch]'), /Waiting for you: students do not see it yet/);
  assert.deepEqual(await missions('student.ben@example.test'), [], 'not even as a public mission');

  await page.click('[data-assignment] [data-action=show-to-students]');
  await page.waitForSelector('[data-assignment] [data-launch=launched]');
  assert.match(await page.innerText('[data-assignment] [data-launch]'), /Launched .*: students see it/);
  assert.deepEqual((await missions('student.ben@example.test')).map((m) => m.kind), ['assigned']);

  await page.click('[data-assignment] [data-action=hide-from-students]');
  await page.waitForSelector('[data-assignment] [data-launch=waiting]');
  assert.deepEqual(await missions('student.ben@example.test'), []);
  await page.click('[data-assignment] >> text=Delete');
  await page.waitForSelector('[data-assignment]', { state: 'detached' });
});

test('a scenario can be made private in its settings', async () => {
  await page.click('.top-nav [data-place=editor]');
  await page.click('[data-scenario="1"] >> text=Edit');
  await page.click('.tabs >> text=Settings');
  await page.locator('[data-field=visibility] select').selectOption('private');
  await saved();
  // Who can play is not part of the published mission: it applies at once. The demo belongs
  // to nobody, so it is now on no student's list, and a student cannot open it.
  assert.deepEqual(await missions('student.ben@example.test'), []);
  const res = await fetch(`${site.url}/api/scenarios/starshipexplorer/play`, { headers: { Authorization: `Bearer ${tokens['student.ben@example.test']}` } });
  assert.equal(res.status, 403);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

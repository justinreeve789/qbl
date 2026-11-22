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
  page.on('dialog', (d) => void d.accept());
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

test('removing a student and deleting the assignment take the mission away again', async () => {
  await page.click('[data-card=students] [aria-label="Remove Student.ann"]');
  await page.waitForFunction(() => /My students \(2\)/.test(document.querySelector('[data-card=students] h2')?.textContent ?? ''));
  assert.deepEqual((await missions('student.ann@example.test')).map((m) => m.kind), ['public']);
  await page.click('[data-assignment] >> text=Delete');
  await page.waitForSelector('[data-assignment]', { state: 'detached' });
  assert.deepEqual((await missions('student.ben@example.test')).map((m) => m.kind), ['public']);
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

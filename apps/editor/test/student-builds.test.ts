import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { png, startSite, type TestSite } from './servers';

/**
 * Student building, in a real browser against the real backend classes: an author lets students
 * build in a scene and chooses a piece; a student builds there (through the API, as the game does);
 * their teacher sees the build on the Classes page, drawn in its scene, and approves it.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let teacher = '';
let student = '';
const errors: string[] = [];

const signIn = async (email: string) => {
  const res = await fetch(`${site.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'x' }) });
  return ((await res.json()) as { token: string; user: { id: number } });
};
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${site.url}/api${path}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
async function draft(): Promise<Scenario> {
  await saved();
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${teacher}` } });
  return ((await res.json()) as { scenario: Scenario }).scenario;
}

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  student = (await signIn('student.ann@example.test')).token;

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'teacher@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  teacher = (await page.evaluate(() => localStorage.getItem('qbl.token')))!;
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Garden');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('an author lets students build in a scene, with a piece to place', async () => {
  await page.click('.scene-card button:has-text("Edit")');
  await page.waitForSelector('[data-panel-section=building]');
  assert.equal(await page.locator('[data-panel-section=building] [data-field=tool_place]').count(), 0, 'the settings wait until building is on');
  await page.check('[data-panel-section=building] [data-field=enabled] input');
  await page.waitForSelector('[data-panel-section=building] [data-field=tool_picture]');
  await page.check('[data-panel-section=building] [data-field=tool_picture] input');
  const prompt = page.locator('[data-panel-section=building] [data-field=prompt] textarea');
  await prompt.fill('Plant a garden that bees will visit.');
  await prompt.blur();
  await saved();
  assert.match(await page.innerText('[data-building-pieces]'), /Choose at least one piece/);
  await page.click('[data-building-pieces] button:has-text("+ Add a piece")');
  await page.waitForSelector('dialog[data-panel=media-choose]');
  await page.setInputFiles('dialog[data-panel=media-choose] input[type=file]', [{ name: 'flower.png', mimeType: 'image/png', buffer: png(64, 80, [230, 80, 160]) }]);
  await page.waitForSelector('dialog[data-panel=media-choose]', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('[data-building-pieces]')?.textContent?.includes('flower.png'));

  const doc = await draft();
  const flower = doc.assets!.find((m) => m.filename === 'flower.png')!;
  assert.deepEqual(doc.scenes[0]!.building, { enabled: true, tools: ['place', 'label', 'picture'], prompt: 'Plant a garden that bees will visit.', pieces: [{ media_id: flower.id }] });

  // Unticking a tool keeps the rest.
  await page.uncheck('[data-panel-section=building] [data-field=tool_label] input');
  assert.deepEqual((await draft()).scenes[0]!.building?.tools, ['place', 'picture']);
  await page.check('[data-panel-section=building] [data-field=tool_label] input');
  assert.deepEqual(errors, []);
});

test('a student builds; the teacher sees it in its scene and approves it', async () => {
  assert.equal((await call(teacher, 'POST', `/editor/scenarios/${id}/publish`)).status, 200);
  const doc = await draft();
  const sceneId = doc.scenes[0]!.id;
  const flower = doc.assets!.find((m) => m.filename === 'flower.png')!;
  const me = (await call(student, 'GET', '/me')).body as { user: { id: number } };
  assert.equal((await call(teacher, 'POST', '/teach/students', { email: 'student.ann@example.test' })).status, 201);
  const assigned = await call(teacher, 'POST', '/teach/assignments', { scenario_id: id, student_ids: [me.user.id] });
  assert.equal(assigned.status, 201);
  const group = `a${(assigned.body as { assignment: { id: number } }).assignment.id}`;
  const code = (await call(teacher, 'GET', `/editor/scenarios/${id}`)).body.scenario.code as string;

  // The student uploads a picture and builds, as the game's Build palette does.
  const form = new FormData();
  form.append('file', new Blob([png(200, 100, [40, 120, 220])], { type: 'image/png' }), 'poster.png');
  const up = await fetch(`${site.url}/api/builds/${code}/uploads?group=${group}`, { method: 'POST', headers: { Authorization: `Bearer ${student}` }, body: form });
  assert.equal(up.status, 201);
  const upload = ((await up.json()) as { upload: { id: number; url: string } }).upload;
  assert.equal((await fetch(`${site.url}${upload.url}`)).status, 200, 'the picture is served by its key');
  const build = await call(student, 'PUT', `/builds/${code}/scenes/${sceneId}?group=${group}`, { pieces: [
    { id: 'f1', kind: 'sticker', x: 300, y: 400, media_id: flower.id, scale: 2 },
    { id: 'l1', kind: 'label', x: 600, y: 200, text: 'Bee garden', color: '#fde047' },
    { id: 'p1', kind: 'picture', x: 900, y: 500, upload_id: upload.id },
  ] });
  assert.equal(build.status, 200);
  assert.equal(build.body.build.status, 'pending');

  await page.click('.top-nav >> text=Classes');
  await page.waitForSelector('[data-card=builds] [data-build]');
  assert.match(await page.innerText('[data-card=builds] [data-builds-filter=pending]'), /Waiting \(1\)/);
  const item = page.locator('[data-card=builds] [data-build]');
  assert.match(await item.innerText(), /Garden/);
  assert.match(await item.innerText(), /3 things/);
  assert.equal(await item.locator('.build-preview-label').innerText(), 'Bee garden', 'the build is drawn in its scene');
  assert.equal(await item.locator('img.build-preview-piece').count(), 2, 'with its piece and its picture');

  await item.locator('button:has-text("Approve")').click();
  await page.waitForSelector('[data-card=builds] .empty');
  assert.match(await page.innerText('[data-card=builds] .empty'), /Nothing is waiting/);
  const mine = (await call(student, 'GET', `/builds/${code}?group=${group}`)).body as { builds: Array<{ status: string }> };
  assert.equal(mine.builds[0]?.status, 'approved', 'the student’s build is approved');

  await page.click('[data-card=builds] [data-builds-filter=approved]');
  await page.waitForSelector('[data-card=builds] [data-build] button:has-text("Hide")');
  await page.click('[data-card=builds] [data-build] button:has-text("Hide")');
  await page.waitForSelector('[data-card=builds] .empty');
  assert.equal(((await call(student, 'GET', `/builds/${code}?group=${group}`)).body as { builds: Array<{ status: string }> }).builds[0]?.status, 'hidden');
  assert.deepEqual(errors, []);
});

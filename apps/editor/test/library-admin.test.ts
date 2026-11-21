import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite } from './servers';

/**
 * The library's admin screen (#/library) and the content admin role: content admins (the dev API
 * makes one of an address starting "content") see every asset, withdrawn ones too, change them,
 * add new ones and keep a scenario's characters in the library, and they edit every scenario.
 * Administrators also choose the content admins there. Teachers have none of it.
 */
let site: TestSite;
let browser: Browser;
let teacher: Page;
let content: Page;
let admin: Page;
let teacherScenario = 0;
const errors: string[] = [];

async function signIn(email: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${email}: ${m.text()}`));
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('.scenario-list, [data-scenario], .empty');
  return page;
}
const token = async (page: Page) => (await page.evaluate(() => localStorage.getItem('qbl.token')))!;
async function get<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${site.url}/api${path}`, { headers: { Authorization: `Bearer ${await token(page)}`, Accept: 'application/json' } });
  return { status: res.status, body: (await res.json()) as T };
}
type Listed = { assets: Array<{ slug: string; name: string; active: boolean; definition: { item?: { settings?: Record<string, unknown> } }; files: Array<{ role: string; params: { sheet?: { columns: number; rows: number; count?: number } } }> }> };
const tiles = (page: Page) => page.locator('.library-grid .library-tile').evaluateAll((ts) => ts.map((t) => (t as HTMLElement).dataset.asset));
const assetPanel = (page: Page) => page.locator('dialog[data-panel=library-asset]');

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  teacher = await signIn('author@example.test');
  await teacher.click('button:has-text("New scenario")');
  await teacher.fill('[data-dialog=new-scenario] input[name=title]', 'Teacher’s pond');
  await teacher.check('[data-dialog=new-scenario] input[value=empty]');
  await teacher.click('[data-dialog=new-scenario] button[type=submit]');
  await teacher.waitForSelector('.scene-card');
  teacherScenario = Number(/#\/s\/(\d+)/.exec(teacher.url())![1]);
  content = await signIn('content@example.test');
  admin = await signIn('admin@example.test');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('teachers have no Library page; content admins and administrators do', async () => {
  await teacher.goto(`${site.url}/editor/#/`);
  await teacher.waitForSelector('nav [data-place=generate]');
  assert.equal(await teacher.locator('nav [data-place=library]').count(), 0);
  await teacher.goto(`${site.url}/editor/#/library`);
  await teacher.waitForSelector('.toast.error:has-text("look after the library")');
  await teacher.waitForFunction(() => window.location.hash === '#/');
  assert.equal((await get(teacher, '/editor/library/managers')).status, 403);

  for (const page of [content, admin]) {
    await page.locator('nav [data-place=library]').click();
    await page.waitForSelector('.library-grid .library-tile');
    assert.equal((await tiles(page)).length, 25);
  }
  assert.equal(await content.locator('[data-section=content-admins]').count(), 0, 'only administrators choose content admins');
  await admin.waitForSelector('[data-section=content-admins] [data-person="content@example.test"]');
});

test('the library is filtered by kind and searched', async () => {
  await content.locator('.library-kinds [data-kind=vehicle]').click();
  assert.equal((await tiles(content)).length, 9);
  await content.locator('.questlab-search').fill('stage');
  assert.deepEqual(await tiles(content), ['stagecoach']);
  await content.locator('.questlab-search').fill('');
  await content.locator('.library-kinds [data-kind=all]').click();
});

test('a content admin renames an asset, changes how a vehicle is ridden and its sheet, and withdraws one', async () => {
  await content.locator('[data-asset=red-squirrel] [data-open=edit]').click();
  await assetPanel(content).waitFor();
  await assetPanel(content).locator('[data-field=name] input').fill('Red Squirrel (park)');
  assert.equal(await assetPanel(content).locator('[data-save]').isDisabled(), false);
  await assetPanel(content).locator('[data-save]').click();
  await content.waitForSelector('[data-asset=red-squirrel] .tile-name:has-text("Red Squirrel (park)")');
  await assetPanel(content).locator('[data-animation=walk_right]').waitFor();
  await content.keyboard.press('Escape');

  await content.locator('[data-asset=bicycle] [data-open=edit]').click();
  const bike = assetPanel(content);
  await bike.locator('[data-field=speed_multiplier] input').fill('2.5');
  await bike.locator('[data-save]').click();
  await content.waitForSelector('.toast:has-text("Saved Bicycle")');
  const sheet = bike.locator('.library-file[data-role=sheet]');
  await sheet.locator('input[aria-label="Frames across"]').fill('4');
  await sheet.locator('input[aria-label="Frames down"]').fill('1');
  await sheet.locator('[data-save-file=sheet]').click();
  await content.waitForSelector('.toast:has-text("sheet file’s settings")');
  await content.keyboard.press('Escape');

  await content.locator('[data-asset=snake] [data-open=edit]').click();
  await assetPanel(content).locator('[data-field=active] input').uncheck();
  await assetPanel(content).locator('[data-save]').click();
  await content.waitForSelector('.toast:has-text("Saved Snake")');
  await content.keyboard.press('Escape');
  assert.ok(!(await tiles(content)).includes('snake'), 'no longer among those offered');

  const all = (await get<Listed>(content, '/editor/library?inactive=1')).body.assets;
  const bicycle = all.find((a) => a.slug === 'bicycle')!;
  assert.equal(bicycle.definition.item?.settings?.speed_multiplier, 2.5);
  const grid = bicycle.files.find((f) => f.role === 'sheet')!.params.sheet!;
  assert.deepEqual([grid.columns, grid.rows], [4, 1]);
  assert.equal(all.find((a) => a.slug === 'red-squirrel')!.name, 'Red Squirrel (park)');
  const seen = (await get<Listed>(teacher, '/editor/library')).body.assets.map((a) => a.slug);
  assert.ok(!seen.includes('snake'), 'a withdrawn asset is not offered to teachers');
  assert.ok(seen.includes('red-squirrel'));

  await content.locator('.questlab-tools select').selectOption('withdrawn');
  assert.deepEqual(await tiles(content), ['snake']);
  await content.locator('.questlab-tools select').selectOption('active');
});

test('a content admin makes a new picture asset with a file', async () => {
  await content.locator('[data-new]').click();
  const panel = content.locator('dialog[data-panel=library-new]');
  await panel.locator('[data-field=kind] select').selectOption('picture');
  await panel.locator('[data-field=name] input').fill('Pond backdrop');
  await panel.locator('[data-field=category] input').fill('Backdrops');
  await panel.locator('input[type=file]').setInputFiles([{ name: 'pond.png', mimeType: 'image/png', buffer: png(320, 200, [40, 120, 90]) }]);
  await panel.locator('[data-create]').click();
  await assetPanel(content).locator('.library-file[data-role=image] img').waitFor();
  await content.keyboard.press('Escape');
  await content.locator('.questlab-tools select').selectOption('all');
  await content.waitForSelector('[data-asset=pond-backdrop].withdrawn');
  await content.locator('.questlab-tools select').selectOption('active');
});

test('a content admin edits a teacher’s scenario and keeps its character in the library', async () => {
  await content.goto(`${site.url}/editor/#/`);
  await content.waitForSelector(`[data-scenario="${teacherScenario}"]`);
  await content.goto(`${site.url}/editor/#/s/${teacherScenario}/characters`);
  await content.waitForSelector('.page-head [data-open=questlab]');
  await content.click('.page-head button.primary:has-text("New character")');
  const character = content.locator('dialog[data-panel=character]');
  await character.waitFor();
  await character.locator('[data-keep]').click();
  const keep = content.locator('dialog[data-panel=keep-in-library]');
  await keep.locator('[data-field=name] input').fill('Pond keeper');
  await keep.locator('[data-field=category] input').fill('People');
  await keep.locator('[data-keep-confirm]').click();
  await content.waitForSelector('.toast:has-text("Kept Pond keeper in the library")');
  const kept = (await get<Listed>(content, '/editor/library?inactive=1')).body.assets.find((a) => a.slug === 'pond-keeper');
  assert.ok(kept, 'kept in the library');
  assert.equal(kept.active, false, 'withdrawn until it is offered');

  // The teacher's own character panel has no such button.
  await teacher.goto(`${site.url}/editor/#/s/${teacherScenario}/characters`);
  await teacher.reload();
  await teacher.locator('.character-card .character-stage').first().click();
  await teacher.locator('dialog[data-panel=character]').waitFor();
  assert.equal(await teacher.locator('dialog[data-panel=character] [data-keep]').count(), 0);
  await teacher.keyboard.press('Escape');
});

test('an administrator makes a teacher a content admin and back', async () => {
  const section = admin.locator('[data-section=content-admins]');
  await section.locator('input[type=email]').fill('author@example.test');
  await section.locator('[data-add-person]').click();
  await section.locator('[data-person="author@example.test"]').waitFor();
  // Signing in again, the account is a content admin (dev tokens carry the role from sign-in).
  const again = await signIn('author@example.test');
  await again.waitForSelector('nav [data-place=library]');
  await again.context().close();
  await section.locator('[data-person="author@example.test"] button').click();
  await section.locator('[data-person="author@example.test"]').waitFor({ state: 'detached' });
  const back = await signIn('author@example.test');
  await back.waitForSelector('nav [data-place=generate]');
  assert.equal(await back.locator('nav [data-place=library]').count(), 0, 'a teacher again');
  await back.context().close();

  await section.locator('input[type=email]').fill('nobody@example.test');
  await section.locator('[data-add-person]').click();
  await admin.waitForSelector('.toast.error');
});

test('no page errors', () => {
  assert.deepEqual(errors, []);
});

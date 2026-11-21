import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * “Make walk” on the Characters page: a six-frame walking sprite sheet made in the browser from the
 * character's standing picture, uploaded to Media at the same scale, and made its walk.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let kid = 0;
let picture = 0;
const errors: string[] = [];
const avatar = (n: number) => readFileSync(new URL(`../../../scenarios/assets/platform/avatars/avatar-${n}.png`, import.meta.url));

type MediaRow = { id: number; filename: string; type: string; width: number | null; height: number | null; scale_x: number; scale_y: number; params: Record<string, unknown> | null };
type CharacterRow = { id: number; name: string; settings: { animations?: Record<string, { media_id: number; duration?: number; flip?: boolean }> } };

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
/** Closes every open panel, the top one first. */
async function closePanels() {
  while (await page.locator('dialog[open] .panel-close').count()) await page.locator('dialog[open] .panel-close').last().click();
}
const bundle = () => rest<{ media: MediaRow[]; characters: CharacterRow[] }>('GET', '');

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Walking');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [
    { name: 'kid.png', mimeType: 'image/png', buffer: avatar(9) },
    { name: 'kayak.png', mimeType: 'image/png', buffer: avatar(7) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length >= 2);
  await saved();
  const media = (await bundle()).media;
  picture = media.find((m) => m.filename === 'kid.png')!.id;
  await rest('PATCH', `/rows/media/${picture}`, { scale_x: 0.8, scale_y: 0.8 });
  const kayak = media.find((m) => m.filename === 'kayak.png')!.id;
  kid = (await rest<{ row: { id: number } }>('POST', '/rows/characters', { name: 'Juno', settings: { animations: { stand_right: { media_id: picture } } } })).row.id;
  await rest('POST', '/rows/characters', { name: 'Paddler', settings: { animations: { stand_left: { media_id: kayak } } } });
  await rest('POST', '/rows/characters', { name: 'Nobody yet' });
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.click('.tabs >> text=Characters');
  await page.waitForSelector('.character-card');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a character with a standing picture has a Make walk button; one without has none', async () => {
  assert.equal(await page.locator(`[data-thing=characters-${kid}] [data-make-walk]`).count(), 1);
  assert.equal(await page.locator('.character-card', { hasText: 'Nobody yet' }).locator('[data-make-walk]').count(), 0);
});

test('Make walk makes a six-frame sheet from the standing picture and makes it the walk', async () => {
  await page.locator(`[data-thing=characters-${kid}] [data-make-walk]`).click();
  // It opens the new walk to look at, and says where the feet are.
  await page.waitForSelector('dialog[data-panel=animation]');
  await page.waitForSelector('.toast');
  assert.match(await page.innerText('.toasts'), /6-frame walk.*step apart \(\d+% of Juno’s height\) in frames 1 and 4 and pass side by side in frames 3 and 6/);
  await saved();

  const { media, characters } = await bundle();
  const juno = characters.find((c) => c.id === kid)!;
  const walk = juno.settings.animations!.walk_right!;
  assert.ok(walk, 'walk_right is set');
  assert.equal(walk.duration, 720);
  assert.equal(juno.settings.animations!.stand_right!.media_id, picture, 'the standing picture is kept');
  const sheet = media.find((m) => m.id === walk.media_id)!;
  assert.equal(sheet.filename, 'juno-walk.png');
  assert.deepEqual(sheet.params?.sheet, { columns: 6, rows: 1 });
  assert.equal(sheet.params?.category, 'character');
  assert.deepEqual(sheet.params?.made_from, { media_id: picture, as: 'walk' });
  // The same scale and height as standing, so Juno keeps her size and her feet stay on the ground.
  assert.equal(sheet.scale_x, 0.8);
  assert.equal(sheet.scale_y, 0.8);
  assert.equal(sheet.height, 262);
  assert.equal((sheet.width ?? 0) % 6, 0);
  assert.ok((sheet.width ?? 0) / 6 > 161, 'each frame has room for the stride');

  // The game reads it as a walk: six frames, facing right; walking left is it mirrored.
  const doc = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
  const character = doc.characters!.find((c) => c.id === kid)!;
  assert.equal(character.animations!.walk_right!.media_id, sheet.id);
  assert.equal(doc.assets!.find((m) => m.id === sheet.id)!.sheet!.columns, 6);

  // The card now shows the walk as drawn.
  await closePanels();
  await page.waitForSelector(`[data-thing=characters-${kid}] [data-pose=walk_right].set`);
});

test('Make walk again replaces the walk (after asking), from the character’s panel', async () => {
  const before = (await bundle()).characters.find((c) => c.id === kid)!.settings.animations!.walk_right!.media_id;
  await page.locator(`[data-thing=characters-${kid}] [data-open=character]`).click();
  await page.waitForSelector('dialog[data-panel=character] .anim-make-walk [data-make-walk]');
  await page.click('dialog[data-panel=character] .anim-make-walk [data-make-walk]');
  await page.waitForSelector('dialog[data-panel=animation]');
  await saved();
  const after = (await bundle()).characters.find((c) => c.id === kid)!.settings.animations!.walk_right!.media_id;
  assert.notEqual(after, before);
  await closePanels();
});

test('a character facing left in a kayak, with no legs to step with, bobs along to the right', async () => {
  await page.locator('.character-card', { hasText: 'Paddler' }).locator('[data-make-walk]').click();
  await page.waitForSelector('dialog[data-panel=animation]');
  await page.waitForFunction(() => /bobs along/.test(document.querySelector('.toasts')?.textContent ?? ''));
  await saved();
  const { media, characters } = await bundle();
  const paddler = characters.find((c) => c.name === 'Paddler')!;
  const walk = paddler.settings.animations!.walk_right!;
  assert.equal(media.find((m) => m.id === walk.media_id)!.params?.made_from && (media.find((m) => m.id === walk.media_id)!.params!.made_from as { as: string }).as, 'bob');
  assert.equal(walk.flip, undefined, 'turned to face right when made, not mirrored when shown');
  assert.deepEqual(errors, []);
});

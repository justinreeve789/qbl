import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite } from './servers';

/**
 * Pictures are chosen by looking at them: a field shows the one chosen and opens a pop-up of
 * tiles, on the kind of file the field is for (backgrounds for a scene layer), with the others a
 * tab away, a search, an upload that is chosen at once, and a × to choose none.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Pictures');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const popup = 'dialog[data-panel=media-choose]';
const field = '.inspector [data-field=media_id]';
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const layerMedia = (scene: Scenario['scenes'][number], i: number) => (scene.background_media![i] as { media_id?: number | null }).media_id ?? null;
const mediaId = async (name: string) => (await draft()).assets!.find((m) => m.filename === name)!.id;

test('a scene layer opens the picker; with no backgrounds yet it shows every picture, as tiles', async () => {
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [
    { name: 'sky.png', mimeType: 'image/png', buffer: png(320, 180, [90, 140, 220]) },
    { name: 'boat.png', mimeType: 'image/png', buffer: png(120, 60, [150, 90, 40]) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 2);
  await saved();

  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.click('[title="Add: background layers"]');

  // No select: a button that says what to choose.
  assert.equal(await page.locator(`${field} select`).count(), 0);
  assert.match(await page.locator(`${field} .media-choice-open`).innerText(), /Choose a background/);
  await page.click(`${field} .media-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.getAttribute(`${popup} .mp-tab.active`, 'data-media-tab'), 'all');
  assert.match(await page.locator(`${popup} .mp-note`).innerText(), /Nothing is filed under Backgrounds yet/);
  assert.deepEqual(await page.locator(`${popup} [data-media-pick][data-name]`).evaluateAll((tiles) => tiles.map((t) => t.getAttribute('data-name'))), ['boat.png', 'sky.png']);
  await page.click(`${popup} [data-name="sky.png"]`);
  await page.waitForSelector(popup, { state: 'detached' });
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-name`)?.textContent === 'sky.png', field);
  assert.equal(layerMedia((await draft()).scenes[0]!, 0), await mediaId('sky.png'));
});

test('a second layer opens on Backgrounds, shows which is chosen, searches, and uploads straight into the field', async () => {
  await page.click(`${field} .media-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.getAttribute(`${popup} .mp-tab.active`, 'data-media-tab'), 'background');
  assert.equal(await page.locator(`${popup} .mp-tile.current`).getAttribute('data-name'), 'sky.png', 'the chosen one is marked');
  assert.match(await page.locator(`${popup} [data-name="sky.png"] .mp-facts`).innerText(), /320 × 180/);
  await page.click(`${popup} [data-media-tab=all]`);
  await page.fill(`${popup} .mp-search`, 'boa');
  assert.equal(await page.locator(`${popup} [data-media-pick][data-name]`).count(), 1);
  // Escape empties the search first, then closes.
  await page.keyboard.press('Escape');
  assert.equal(await page.inputValue(`${popup} .mp-search`), '');
  await page.keyboard.press('Escape');
  await page.waitForSelector(popup, { state: 'detached' });

  await page.click('[title="Add: background layers"]');
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-open.empty`), field);
  await page.click(`${field} .media-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.getAttribute(`${popup} .mp-tab.active`, 'data-media-tab'), 'background', 'always opens on what the field is for');
  await page.setInputFiles(`${popup} input[type=file]`, [{ name: 'hills.png', mimeType: 'image/png', buffer: png(320, 180, [60, 160, 80]) }]);
  await page.waitForSelector(popup, { state: 'detached' });
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-name`)?.textContent === 'hills.png', field);
  const doc = await draft();
  const hills = doc.assets!.find((m) => m.filename === 'hills.png')!;
  assert.equal(layerMedia(doc.scenes[0]!, 1), hills.id);
  assert.equal((hills as { params?: { category?: string } }).params?.category, 'background', 'filed under the tab it was uploaded from');
});

test('the × chooses no picture', async () => {
  await page.click(`${field} .media-choice-clear`);
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-open.empty`), field);
  assert.equal(layerMedia((await draft()).scenes[0]!, 1), null);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

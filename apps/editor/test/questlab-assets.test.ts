import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { validateScenario, type Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * The QuestLab asset library on the Characters page: ready-made animals, shown as cards, that are
 * added to the scenario with their pictures copied into its media and their animations set up.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
const errors: string[] = [];
const library = JSON.parse(readFileSync(new URL('../public/questlab-assets/index.json', import.meta.url), 'utf8')) as {
  groups: string[];
  characters: Array<{ id: string; name: string; group: string; sheet: { columns: number; rows: number; count: number }; animations: Record<string, { frames: number[] }> }>;
};

async function doc(): Promise<Scenario> {
  await page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(res.ok);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const panel = () => page.locator('dialog[data-panel=questlab-assets]');
const card = (asset: string) => panel().locator(`[data-asset=${asset}]`);
const visibleCards = () => panel().locator('.questlab-card:not([hidden])');

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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Zoo');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  await page.click('.tabs >> text=Characters');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('the library has the animals asked for, each a whole sheet with standing and walking', () => {
  const groups = Object.fromEntries(library.groups.map((g) => [g, library.characters.filter((c) => c.group === g).length]));
  assert.deepEqual(groups, { Squirrels: 2, Birds: 3, Dogs: 2, Cats: 2, Reptiles: 3, 'Farm and field': 2, Fish: 2 });
  for (const c of library.characters) {
    assert.ok(c.animations.stand_right && c.animations.walk_right, `${c.id} stands and walks`);
    assert.ok(c.sheet.count <= c.sheet.columns * c.sheet.rows, `${c.id} sheet`);
    for (const [name, a] of Object.entries(c.animations)) {
      assert.ok(a.frames.length && a.frames.every((f) => f >= 0 && f < c.sheet.count), `${c.id}.${name} frames are on the sheet`);
    }
  }
});

test('the button opens the library as cards with pictures, which can be filtered', async () => {
  await page.click('.page-head [data-open=questlab]');
  await panel().waitFor();
  await page.waitForSelector('dialog[data-panel=questlab-assets] .questlab-card');
  assert.equal(await visibleCards().count(), library.characters.length);
  // Each card shows its moving picture and its close-up, and both load.
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.questlab-card img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  assert.equal(await panel().locator('.questlab-card img').count(), library.characters.length * 2);

  await panel().locator('.questlab-groups [data-group=Fish]').click();
  assert.deepEqual(await visibleCards().evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.asset)), ['goldfish', 'yellow-tang']);
  await panel().locator('.questlab-groups [data-group=all]').click();
  await panel().locator('.questlab-search').fill('farm');
  assert.deepEqual(await visibleCards().evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.asset)).then((a) => a.sort()), ['hen', 'horse', 'mountain-goat']);
  await panel().locator('.questlab-search').fill('zebra');
  assert.equal(await visibleCards().count(), 0);
  assert.ok(await panel().locator('.questlab-none').isVisible());
  await panel().locator('.questlab-search').fill('');
});

test('adding one copies its pictures and makes a character with its animations', async () => {
  await card('red-squirrel').locator('.questlab-add').click();
  await card('red-squirrel').locator('.questlab-used').waitFor();
  assert.match(await card('red-squirrel').locator('.questlab-used').textContent() ?? '', /1 in this scenario/);

  const scenario = await doc();
  const squirrel = scenario.characters.find((c) => c.name === 'Red Squirrel');
  assert.ok(squirrel, 'the character was made');
  const asset = library.characters.find((c) => c.id === 'red-squirrel')!;
  assert.deepEqual(Object.keys(squirrel.animations ?? {}).sort(), [...Object.keys(asset.animations), 'portrait'].sort());
  const sheet = scenario.assets.find((m) => m.id === squirrel.animations!.walk_right!.media_id)!;
  assert.deepEqual(sheet.sheet, { columns: asset.sheet.columns, rows: asset.sheet.rows, count: asset.sheet.count });
  assert.equal((sheet.params as Record<string, unknown>).questlab, 'red-squirrel/sheet');
  assert.equal(((sheet.params as Record<string, unknown>).credit as { license: string }).license, 'CC0');
  assert.deepEqual(squirrel.animations!.walk_right!.frames, asset.animations.walk_right!.frames);
  const portrait = scenario.assets.find((m) => m.id === squirrel.animations!.portrait!.media_id)!;
  assert.equal(portrait.sheet, undefined);
  const checked = validateScenario(scenario);
  assert.ok(checked.ok, JSON.stringify(checked.errors));
});

test('adding it again shares the pictures and takes the next name', async () => {
  const before = (await doc()).assets.length;
  await card('red-squirrel').locator('.questlab-add').click();
  await page.waitForFunction(() => document.querySelector('[data-asset=red-squirrel] .questlab-used')?.textContent?.includes('2 in this scenario'));
  const scenario = await doc();
  assert.equal(scenario.assets.length, before, 'no new media');
  const names = scenario.characters.map((c) => c.name);
  assert.ok(names.includes('Red Squirrel 2'), names.join(', '));
});

test('a CC BY animal carries its credit to the media panel, and the character page shows it', async () => {
  await card('mountain-goat').locator('.questlab-add').click();
  await card('mountain-goat').locator('.questlab-used').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.character-card:has-text("Mountain Goat")');
  // Its standing picture is drawn on its card, from the copied sheet.
  await page.waitForSelector('.character-card .anim-frame');
  const scenario = await doc();
  const goat = scenario.characters.find((c) => c.name === 'Mountain Goat')!;
  const sheet = scenario.assets.find((m) => m.id === goat.animations!.stand_right!.media_id)!;
  assert.equal(((sheet.params as Record<string, unknown>).credit as { author: string; license: string }).license, 'CC-BY 4.0');

  await page.click('.tabs >> text=Media');
  await page.click(`.media-card[data-media="${sheet.id}"] [data-open=details]`);
  await page.waitForSelector('dialog[data-panel=media] .media-credit');
  assert.match(await page.locator('dialog[data-panel=media] .media-credit').textContent() ?? '', /Sevarihk.*CC-BY 4\.0/);
});

test('no errors in the browser', () => {
  assert.deepEqual(errors, []);
});

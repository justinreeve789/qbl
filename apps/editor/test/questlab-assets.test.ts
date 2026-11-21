import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { validateScenario, type Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * "Add QuestLab Assets": the asset library (served by /api/editor/library from the shipped pack) as
 * a pop-up of cards on the Characters page (animals) and the Items page (vehicles). Adding one copies
 * its pictures into the scenario's media and makes the character or the item to ride.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
const errors: string[] = [];

async function token(): Promise<string> {
  return (await page.evaluate(() => localStorage.getItem('qbl.token')))!;
}
async function doc(): Promise<Scenario> {
  await page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${await token()}` } });
  assert.ok(res.ok);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const panel = () => page.locator('dialog[data-panel=questlab-assets]');
const card = (asset: string) => panel().locator(`[data-asset=${asset}]`);
const visible = () => panel().locator('.questlab-card:not([hidden])').evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.asset));
const picturesLoaded = () => page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll<HTMLImageElement>('dialog[data-panel=questlab-assets] .questlab-card img')];
  return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
}, null, { timeout: 20000 });

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
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('the library API lists the shipped animals and vehicles', async () => {
  const res = await fetch(`${site.url}/api/editor/library?kind=character,vehicle`, { headers: { Authorization: `Bearer ${await token()}` } });
  const list = (await res.json()) as { assets: { kind: string; slug: string }[] };
  const kinds = list.assets.reduce<Record<string, number>>((n, a) => ({ ...n, [a.kind]: (n[a.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { character: 16, vehicle: 9 });
});

test('on the Characters page the library shows animals as cards with pictures, which can be filtered', async () => {
  await page.click('.tabs >> text=Characters');
  await page.click('.page-head [data-open=questlab]');
  await panel().waitFor();
  await page.waitForSelector('dialog[data-panel=questlab-assets] .questlab-card');
  assert.equal((await visible()).length, 16);
  await picturesLoaded();
  assert.equal(await panel().locator('.questlab-card img').count(), 32, 'a moving picture and a close-up each');
  await panel().locator('.questlab-groups [data-group=Fish]').click();
  assert.deepEqual(await visible(), ['goldfish', 'yellow-tang']);
  await panel().locator('.questlab-groups [data-group=all]').click();
  await panel().locator('.questlab-search').fill('farm');
  assert.deepEqual((await visible()).sort(), ['hen', 'horse', 'mountain-goat']);
  await panel().locator('.questlab-search').fill('zebra');
  assert.deepEqual(await visible(), []);
  assert.ok(await panel().locator('.questlab-none').isVisible());
  await panel().locator('.questlab-search').fill('');
});

test('adding an animal copies its pictures and makes a character; adding it again shares them', async () => {
  await card('red-squirrel').locator('.questlab-add').click();
  await page.waitForFunction(() => document.querySelector('[data-asset=red-squirrel] .questlab-used')?.textContent?.includes('1 in this scenario'));
  let scenario = await doc();
  const squirrel = scenario.characters.find((c) => c.name === 'Red Squirrel')!;
  assert.ok(squirrel, 'the character was made');
  const sheet = scenario.assets.find((m) => m.id === squirrel.animations!.walk_right!.media_id)!;
  assert.ok(sheet.sheet && sheet.sheet.columns > 0, 'drawn from a copied sprite sheet');
  assert.equal(((sheet.params as Record<string, { license: string }>).credit).license, 'CC0');
  assert.ok(squirrel.animations!.portrait, 'with its close-up');
  const media = scenario.assets.length;

  await card('red-squirrel').locator('.questlab-add').click();
  await page.waitForFunction(() => document.querySelector('[data-asset=red-squirrel] .questlab-used')?.textContent?.includes('2 in this scenario'));
  scenario = await doc();
  assert.equal(scenario.assets.length, media, 'no new media');
  assert.ok(scenario.characters.some((c) => c.name === 'Red Squirrel 2'));
  await page.keyboard.press('Escape');
});

test('on the Items page the library shows vehicles; adding one makes an item to ride', async () => {
  await page.click('.tabs >> text=Items');
  await page.click('.page-head [data-open=questlab]');
  await page.waitForSelector('dialog[data-panel=questlab-assets] .questlab-card[data-asset=stagecoach]');
  assert.deepEqual(await visible(), ['red-convertible', 'yellow-roadster', 'farm-truck', 'silver-hatchback', 'motorcycle', 'bicycle', 'bay-horse', 'palomino-horse', 'stagecoach']);
  await picturesLoaded();
  assert.match(await card('bay-horse').textContent() ?? '', /gallop/, 'a horse says it can gallop');
  await panel().locator('.questlab-groups [data-group=Horses]').click();
  assert.deepEqual(await visible(), ['bay-horse', 'palomino-horse']);
  await panel().locator('.questlab-groups [data-group=all]').click();

  await card('stagecoach').locator('.questlab-add').click();
  await page.waitForFunction(() => document.querySelector('[data-asset=stagecoach] .questlab-used'));
  const scenario = await doc();
  const coach = scenario.items.find((i) => i.name === 'Stagecoach')!;
  assert.ok(coach?.vehicle, 'the stagecoach is a vehicle');
  assert.ok((coach.hide_rider_below ?? 0) > 0 && (coach.speed_multiplier ?? 0) > 1, 'with a seat and a speed');
  const sheet = scenario.assets.find((m) => m.id === coach.media_id)!;
  assert.deepEqual(sheet.animations?.map((a) => a.name), ['idle', 'walk']);
  const checked = validateScenario(scenario);
  assert.ok(checked.ok, JSON.stringify(checked.errors));
  await page.keyboard.press('Escape');
});

test('the media panel shows a copied picture\'s credit', async () => {
  const scenario = await doc();
  const coach = scenario.items.find((i) => i.name === 'Stagecoach')!;
  await page.click('.tabs >> text=Media');
  await page.click(`.media-card[data-media="${coach.media_id}"] [data-open=details]`);
  await page.waitForSelector('dialog[data-panel=media] .media-credit');
  assert.match(await page.locator('dialog[data-panel=media] .media-credit').textContent() ?? '', /bluecarrot16.*CC-BY 3\.0/);
});

test('no errors in the browser', () => {
  assert.deepEqual(errors, []);
});

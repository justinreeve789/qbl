import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite, chooseMedia } from './servers';

/**
 * Sliders beside the number boxes of fields with a natural range (parallax, radii, volume...):
 * the two stay in step, an empty field shows its default without saving it, dragging saves as
 * it goes without one request per step, and a typed value past the slider's end moves the end.
 * Set QBL_SHOTS to a folder to keep screenshots of the inspector along the way.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
const patches: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => r.method() === 'PATCH' && patches.push(r.url()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Sliders');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'sky.png', mimeType: 'image/png', buffer: png(256, 256, [90, 140, 220]) }]);
  await page.waitForSelector('[data-media]');
  await saved();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const bar = (key: string) => page.locator(`.inspector [data-field=${key}] input[type=range]`);
const box = (key: string) => page.locator(`.inspector [data-field=${key}] input[type=number]`);
async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.locator('.inspector').screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}

test('a layer\'s parallax: shown at its default until moved, then saved; the box and the slider agree', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.click('[title="Add: background layers"]');
  await chooseMedia(page.locator('.inspector [data-field=media_id]'), 'sky.png');
  await saved();

  // Empty: the slider sits at the default (1), dimmed, and nothing is stored.
  assert.equal(await bar('parallax').inputValue(), '1');
  assert.equal(await box('parallax').inputValue(), '');
  assert.ok(await bar('parallax').evaluate((n) => n.classList.contains('unset')));
  assert.equal((await draft()).scenes[0]!.background_media![0]!.parallax, undefined);
  await shot('layer-defaults');

  // The keyboard moves it a step at a time.
  await bar('parallax').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  assert.equal(await box('parallax').inputValue(), '0.8');
  assert.ok(!(await bar('parallax').evaluate((n) => n.classList.contains('unset'))));
  assert.equal((await draft()).scenes[0]!.background_media![0]!.parallax, 0.8);

  // Typing moves the slider.
  await box('parallax').fill('0.35');
  await box('parallax').blur();
  assert.equal(await bar('parallax').inputValue(), '0.35');
  assert.equal((await draft()).scenes[0]!.background_media![0]!.parallax, 0.35);

  // Clearing the box goes back to the default.
  await box('parallax').fill('');
  await box('parallax').blur();
  assert.equal(await bar('parallax').inputValue(), '1');
  assert.equal((await draft()).scenes[0]!.background_media![0]!.parallax, undefined);
});

test('a hotspot\'s radius: dragging the slider resizes the circle on the canvas as it goes, in few requests', async () => {
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await saved();
  const circle = page.locator('.stage-overlay circle.hotspot.selected');
  const before = Number(await circle.getAttribute('r'));
  assert.equal(await bar('radius').getAttribute('max'), String(await page.evaluate(() => {
    // The slider reaches across the scene: its longer side.
    const svg = document.querySelector('.stage-overlay') as SVGSVGElement;
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number);
    return Math.round(Math.max(w!, h!));
  })));

  patches.length = 0;
  const b = (await bar('radius').boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 30 });
  // Still held: the canvas already shows the new size, the one in the box.
  await page.waitForFunction(() => document.querySelector('.stage-overlay circle.hotspot.selected')?.getAttribute('r') === (document.querySelector('.inspector [data-field=radius] input[type=number]') as HTMLInputElement).value);
  const during = Number(await circle.getAttribute('r'));
  assert.ok(during > before, `the circle grew while dragging (${before} → ${during})`);
  assert.equal(String(during), await box('radius').inputValue(), 'the box shows what the canvas shows');
  await shot('hotspot-dragging');
  await page.mouse.up();
  await saved();
  assert.ok(patches.length < 15, `${patches.length} requests for 30 steps`);

  const radius = Number(await box('radius').inputValue());
  const doc = await draft();
  const hotspot = doc.scenes[0]!.hotspots!.at(-1)!;
  assert.equal(hotspot.radius, radius, 'the last value is the one saved');

  // A typed value past the end of the slider moves its end out.
  await box('radius').fill('5000');
  await box('radius').blur();
  assert.equal(await bar('radius').getAttribute('max'), '5000');
  assert.equal(await bar('radius').inputValue(), '5000');
});

test('the scenario\'s music volume is a slider too, from 0 to 1', async () => {
  await page.click('.tabs >> text=Settings');
  const volume = page.locator('[data-field=music_volume] input[type=range]');
  assert.deepEqual([await volume.getAttribute('min'), await volume.getAttribute('max'), await volume.inputValue()], ['0', '1', '0.5']);
  await volume.focus();
  await page.keyboard.press('End');
  if (process.env.QBL_SHOTS) await page.locator('[data-field=music_volume]').screenshot({ path: `${process.env.QBL_SHOTS}/music-volume.png` });
  assert.equal(await page.locator('[data-field=music_volume] input[type=number]').inputValue(), '1');
  assert.equal((await draft()).music_volume, 1);
  assert.deepEqual(errors, []);
});

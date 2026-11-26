import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite } from './servers';

/**
 * A PNG uploaded on the Media page is kept as WebP (QBL_PNG_TO_WEBP, on by default): it is listed
 * under its .webp name, and the scenario players get points at the WebP file.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;

before(async () => {
  site = await startSite({ QBL_PNG_TO_WEBP: 'true' });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Smaller pictures');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('an uploaded PNG is listed and played as a WebP of the same size', async () => {
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'room.png', mimeType: 'image/png', buffer: png(640, 360, [200, 120, 60]) }]);
  await page.locator('.card-title', { hasText: 'room.webp' }).waitFor();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  const room = ((await res.json()) as { scenario: Scenario }).scenario.assets!.find((m) => m.filename === 'room.webp')!;
  assert.match(room.url ?? '', /\.webp$/);
  assert.deepEqual([room.width, room.height], [640, 360]);
  const file = await fetch(`${site.url}${room.url}`);
  assert.equal(file.headers.get('content-type'), 'image/webp');
});

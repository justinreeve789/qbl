import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * “Where it meets the floor” on an item: a counter that runs into the room at an angle gets a line
 * along its base, so players in front of its far end are drawn in front of it.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let counter = 0;
const errors: string[] = [];

type ItemRow = { id: number; settings: { sort_line?: Array<[number, number]>; placement?: string } | null };

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const line = async () => (await rest<{ items: ItemRow[] }>('GET', '')).items.find((i) => i.id === counter)!.settings?.sort_line;
const panel = 'dialog[data-panel=item]';

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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Cafeteria');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  // A counter seen at an angle, drawn in the browser: 400 × 200, its base running from y 120 on
  // the left down to the bottom at x 300, then level; a thin tray sticks out on the right.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#6d7aa6';
    g.beginPath();
    g.moveTo(0, 20);
    g.lineTo(370, 60);
    g.lineTo(370, 200);
    g.lineTo(300, 200);
    g.lineTo(0, 120);
    g.closePath();
    g.fill();
    g.fillRect(370, 60, 30, 12);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'counter.png', mimeType: 'image/png', buffer: Buffer.from(png) }]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length >= 1);
  await saved();
  const media = (await rest<{ media: Array<{ id: number; filename: string }> }>('GET', '')).media.find((m) => m.filename === 'counter.png')!;
  counter = (await rest<{ row: { id: number } }>('POST', '/rows/items', { name: 'Counter', media_id: media.id, physical: true })).row.id;
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.click('.tabs >> text=Items');
  await page.locator(`[data-thing=items-${counter}] .thumb, [data-thing=items-${counter}] button`).first().click();
  await page.waitForSelector(`${panel} [data-sort-line] .sort-line-line`, { state: 'attached' });
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/sort-line-open.png` });
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('with no line, the picture’s bottom edge is the line', async () => {
  assert.equal(await page.locator(`${panel} .sort-line-line.unset`).count(), 1);
  assert.equal(await page.locator(`${panel} .sort-line-point`).count(), 0);
  assert.ok(await page.locator(`${panel} [data-action=sort-line-clear]`).isDisabled());
  assert.equal(await line(), undefined);
});

test('“Find it from the picture” draws the line along the base, without the tray', async () => {
  await page.click(`${panel} [data-action=sort-line-find]`);
  await page.waitForSelector(`${panel} .sort-line-point`);
  await saved();
  const found = (await line())!;
  assert.ok(found.length >= 2 && found.length <= 4, JSON.stringify(found));
  assert.ok(Math.abs(found[0]![1] - 0.6) < 0.04, `starts 120 px down on the left: ${JSON.stringify(found)}`);
  assert.ok(found.every(([, y]) => y >= 0.55), `the tray is not part of it: ${JSON.stringify(found)}`);
  assert.ok(found.some(([x, y]) => Math.abs(x - 0.75) < 0.04 && y > 0.97), `reaches the bottom at x 300: ${JSON.stringify(found)}`);
  assert.equal(await page.locator(`${panel} .sort-line-point`).count(), found.length);
  if (process.env.QBL_SHOTS) await page.locator(`${panel} [data-sort-line]`).screenshot({ path: `${process.env.QBL_SHOTS}/sort-line-found.png` });
});

test('a point can be dragged, added and taken away', async () => {
  const before = (await line())!;
  const first = page.locator(`${panel} .sort-line-point`).first();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await saved();
  const dragged = (await line())!;
  assert.ok(dragged[0]![1] > before[0]![1] + 0.05, `moved down: ${JSON.stringify(before)} → ${JSON.stringify(dragged)}`);

  // A click on the picture adds a point there.
  const pic = (await page.locator(`${panel} .sort-line-picture`).boundingBox())!;
  await page.mouse.click(pic.x + pic.width / 2, pic.y + pic.height / 2);
  await saved();
  const added = (await line())!;
  assert.equal(added.length, dragged.length + 1);

  // Double-clicking a point takes it away.
  const count = added.length;
  await page.locator(`${panel} .sort-line-point`).nth(1).dblclick();
  await saved();
  assert.equal((await line())!.length, count - 1);
});

test('the line goes into the game’s scenario; “Use the bottom edge” takes it out', async () => {
  const doc = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
  assert.deepEqual(doc.items!.find((i) => i.id === counter)!.sort_line, await line());
  await page.click(`${panel} [data-action=sort-line-clear]`);
  await saved();
  assert.equal(await line(), undefined);
  assert.equal(await page.locator(`${panel} .sort-line-line.unset`).count(), 1);
});

test('in the scene editor, a placed item shows its line', async () => {
  await page.click(`${panel} [data-action=sort-line-find]`);
  await page.waitForSelector(`${panel} .sort-line-point`);
  await saved();
  const scene = (await rest<{ scenes: Array<{ id: number }> }>('GET', '')).scenes[0]!.id;
  await rest('PATCH', `/rows/scenes/${scene}`, { width: 1200, height: 600, layout: { items: [{ item_id: counter, position_x: 600, position_y: 450 }] } });
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay .placement.items .sort-line-on-scene');
  // The line runs along the counter's base: from 120 px up its picture on the left to its bottom.
  const points = (await page.getAttribute('.stage-overlay .placement.items .sort-line-on-scene', 'points'))!
    .split(' ').map((p) => p.split(',').map(Number) as [number, number]);
  assert.ok(Math.abs(points[0]![0] - 400) < 3 && Math.abs(points[0]![1] - 370) < 8, JSON.stringify(points));
  assert.ok(points.some(([x, y]) => Math.abs(x - 700) < 10 && Math.abs(y - 450) < 3), JSON.stringify(points));
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/sort-line-scene.png` });
  await page.click('.tabs >> text=Items');
  await page.locator(`[data-thing=items-${counter}] button`).first().click();
  await page.waitForSelector(`${panel} [data-sort-line]`);
});

test('an item lying on the floor has no line to draw', async () => {
  await page.selectOption(`${panel} [data-field=placement] select`, 'background');
  await saved();
  await page.waitForFunction((p) => !document.querySelector(`${p} [data-sort-line]`), panel);
  await page.selectOption(`${panel} [data-field=placement] select`, 'object');
  await saved();
  await page.waitForSelector(`${panel} [data-sort-line]`);
});

test('no browser errors', () => {
  assert.deepEqual(errors, []);
});

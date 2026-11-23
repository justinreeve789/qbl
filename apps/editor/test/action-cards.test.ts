import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/** Only one of an event's action cards is open at a time: opening one folds the others away. */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'One card open');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const cards = () => page.locator('.inspector details.action');
const openTags = () => page.locator('.inspector details.action[open] summary .tag').allTextContents();

test('adding actions leaves only the newest card open', async () => {
  for (const [n, type] of [[1, 'dialogue'], [2, 'wait'], [3, 'audio']] as const) {
    await page.locator('.inspector .add-action').selectOption(type);
    await page.waitForFunction((count) => document.querySelectorAll('.inspector details.action').length === count, n);
  }
  await page.waitForTimeout(100);
  const open = await openTags();
  assert.equal(open.length, 1);
  assert.match(open[0]!, /Audio|Sound/);
});

test('opening another card closes the one that was open', async () => {
  await cards().nth(0).locator('summary').click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action[open]').length === 1 && document.querySelector('.inspector details.action')?.hasAttribute('open'));
  assert.equal((await openTags()).length, 1);

  await cards().nth(1).locator('summary').click();
  await page.waitForFunction(() => {
    const all = [...document.querySelectorAll('.inspector details.action')];
    return all.filter((c) => c.hasAttribute('open')).length === 1 && all[1]!.hasAttribute('open');
  });

  // Closing the open card leaves them all closed.
  await cards().nth(1).locator('summary').click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action[open]').length === 0);
});

test('adding an action while one is open opens only the new one', async () => {
  await cards().nth(2).locator('summary').click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action')[2]?.hasAttribute('open'));
  // Adding redraws the event with only the new card open.
  await page.locator('.inspector .add-action').selectOption('wait');
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action').length === 4);
  await page.waitForTimeout(100);
  assert.equal((await openTags()).length, 1);
  assert.deepEqual(errors, []);
});

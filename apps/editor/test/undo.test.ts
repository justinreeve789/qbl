import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/** Ctrl+Z undoes edits to the scenario and Ctrl+Y redoes them, saved each time. */
let site: TestSite;
let browser: Browser;
let page: Page;
let scenarioId = 0;
const errors: string[] = [];

interface Bundle {
  events: Array<{ id: number; shortname: string | null }>;
  actions: Array<{ id: number; event_id: number; type: string }>;
}

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Undo me');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  scenarioId = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const bundle = async (): Promise<Bundle> => {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${scenarioId}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as Bundle;
};
const idle = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
/** Press a key with nothing focused, as after clicking the stage, and wait for the indicator to say it is done. */
async function press(keys: string, says: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(keys);
  await page.waitForFunction((text) => document.querySelector('.saving')?.textContent === text, says);
}
const name = () => page.locator('.inspector [data-field=shortname] input').first();
const actionTags = () => page.locator('.inspector details.action summary .tag').allTextContents();

test('a field changed and left: Ctrl+Z puts it back, Ctrl+Y changes it again', async () => {
  const was = (await bundle()).events[0]!.shortname;
  await name().fill('lily pad');
  await name().blur();
  await idle();
  assert.equal((await bundle()).events[0]!.shortname, 'lily pad');

  await press('Control+z', 'Undone');
  assert.equal((await bundle()).events[0]!.shortname, was);
  assert.equal(await name().inputValue(), was ?? '');

  await press('Control+y', 'Redone');
  assert.equal((await bundle()).events[0]!.shortname, 'lily pad');
  assert.equal(await name().inputValue(), 'lily pad');
});

test('while typing in a field, Ctrl+Z is the field\'s own', async () => {
  await name().click();
  await name().press('End');
  await page.keyboard.type(' x');
  await page.keyboard.press('Control+z');
  assert.equal(await name().inputValue(), 'lily pad');
  // Nothing was saved or undone in the scenario.
  assert.equal((await bundle()).events[0]!.shortname, 'lily pad');
  await name().blur();
});

test('a deleted action comes back under its own id, and adding can be undone and redone', async () => {
  for (const [n, type] of [[1, 'dialogue'], [2, 'wait'], [3, 'audio']] as const) {
    // As a click on the menu would: each is its own step.
    await page.locator('.inspector .add-action').dispatchEvent('pointerdown');
    await page.locator('.inspector .add-action').selectOption(type);
    await page.waitForFunction((count) => document.querySelectorAll('.inspector details.action').length === count, n);
  }
  await idle();
  const ids = (await bundle()).actions.map((a) => a.id);
  assert.equal(ids.length, 3);

  // Delete the second.
  const second = page.locator('.inspector details.action').nth(1);
  await second.locator('summary').click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action')[1]?.hasAttribute('open'));
  await second.locator('button.danger:text-is("Delete")').click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action').length === 2);
  await idle();

  await press('Control+z', 'Undone');
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action').length === 3);
  assert.deepEqual((await bundle()).actions.map((a) => a.id), ids);

  // Before that: adding the third.
  await press('Control+z', 'Undone');
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action').length === 2);
  assert.deepEqual((await bundle()).actions.map((a) => a.id), ids.slice(0, 2));

  await press('Control+Shift+z', 'Redone');
  await page.waitForFunction(() => document.querySelectorAll('.inspector details.action').length === 3);
  assert.deepEqual((await bundle()).actions.map((a) => a.id), ids);
  assert.equal((await actionTags()).length, 3);
});

test('a deleted hotspot comes back with its actions', async () => {
  const before = await bundle();
  await page.locator('.event-panel .panel-head button.danger').click();
  await page.waitForFunction(() => !document.querySelector('.event-panel'));
  await idle();
  const gone = await bundle();
  assert.deepEqual([gone.events.length, gone.actions.length], [0, 0]);

  await press('Control+z', 'Undone');
  const back = await bundle();
  assert.deepEqual(back.events.map((e) => [e.id, e.shortname]), before.events.map((e) => [e.id, e.shortname]));
  assert.deepEqual(back.actions.map((a) => [a.id, a.type]), before.actions.map((a) => [a.id, a.type]));

  await press('Control+y', 'Redone');
  assert.equal((await bundle()).events.length, 0);
});

test('with nothing left, it says so', async () => {
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    const said = await page.waitForFunction(() => {
      const text = document.querySelector('.saving')?.textContent;
      return text === 'Undone' || text === 'Nothing to undo' ? text : null;
    });
    const text = await said.jsonValue();
    await page.waitForFunction(() => document.querySelector('.saving')?.textContent === '');
    if (text === 'Nothing to undo') break;
  }
  // All the way back: the hotspot added at the start is gone too.
  assert.equal((await bundle()).events.length, 0);
  assert.deepEqual(errors, []);
});

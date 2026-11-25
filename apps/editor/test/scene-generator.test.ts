import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * "Generate a scene" from a scenario's Scenes page, in a real browser against the dev API pretending
 * to make scenes (QBL_DEV_GENERATOR: a scene run goes through its four stages in a few seconds and
 * adds a plain scene with a thing to click). A teacher opens the dialog, sees what it costs, chooses
 * what to add, starts it, carries on, and the scene arrives in the scenario they have open, as one
 * step that Ctrl+Z takes away again (and Ctrl+Y brings back).
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite({ QBL_DEV_GENERATOR: '6' });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'teacher@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Harbour');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const dialog = '[data-dialog=generate-scene]';
/** Set QBL_SHOTS to a folder to keep screenshots of the dialog and the scene that arrives. */
async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
const token = () => page.evaluate(() => localStorage.getItem('qbl.token'));

test('the Scenes page offers to generate a scene, and says what it costs', async () => {
  await page.click('button[data-action=generate-scene]');
  await page.waitForSelector(`${dialog}[open]`);
  await page.waitForFunction(() => !document.querySelector('[data-dialog=generate-scene] [data-cost]')?.textContent?.includes('Checking'));
  // Billing is off here: nothing to pay, so it says how to stop one instead.
  assert.match(await page.textContent(`${dialog} [data-cost]`) ?? '', /stop it/);
  await shot('generate-scene-dialog');
  assert.equal(await page.isDisabled(`${dialog} button[type=submit]`), false);
  assert.deepEqual([await page.isChecked(`${dialog} input[name=hotspots]`), await page.isChecked(`${dialog} input[name=animations]`), await page.isChecked(`${dialog} input[name=critters]`)], [true, true, false],
    'things to click and movement are on, critters are the teacher\'s choice');
});

test('it needs a description, and "clicked again" only matters with things to click', async () => {
  await page.fill(`${dialog} textarea[name=prompt]`, 'Dock');
  await page.click(`${dialog} button[type=submit]`);
  assert.match(await page.textContent(`${dialog} .issue.error`) ?? '', /sentence or two/);
  await page.uncheck(`${dialog} input[name=hotspots]`);
  assert.equal(await page.isDisabled(`${dialog} select[name=repeat]`), true);
  await page.check(`${dialog} input[name=hotspots]`);
  assert.equal(await page.isDisabled(`${dialog} select[name=repeat]`), false);
});

test('a scene is made while the teacher carries on, and arrives in the open scenario', async () => {
  await page.fill(`${dialog} textarea[name=prompt]`, 'A busy harbour at dawn with fishing boats, crates and a lighthouse');
  await page.selectOption(`${dialog} select[name=kind_of_place]`, 'outdoor');
  await page.selectOption(`${dialog} select[name=time]`, 'dawn');
  await page.selectOption(`${dialog} select[name=repeat]`, 'cycle');
  await page.check(`${dialog} input[name=critters]`);
  await page.click(`${dialog} button[type=submit]`);
  await page.waitForSelector(dialog, { state: 'detached' });
  await page.waitForSelector('.gen-chip');
  assert.equal(await page.locator('.scene-card').count(), 1, 'not there yet');

  // What was asked for is what the run was given.
  const res = await fetch(`${site.url}/api/editor/generations/active`, { headers: { Authorization: `Bearer ${await token()}` } });
  const { generation } = (await res.json()) as { generation: { kind: string; options: Record<string, unknown>; progress: { stages: string[] } } };
  assert.equal(generation.kind, 'scene');
  assert.deepEqual(generation.progress.stages, ['designing', 'drawing', 'building', 'importing']);
  assert.deepEqual(
    [generation.options.scenario_id, generation.options.place, generation.options.time, generation.options.repeat, generation.options.hotspots, generation.options.animations, generation.options.critters],
    [id, 'outdoor', 'dawn', 'cycle', true, true, true]);

  // Made: taken into the scenario, with a way to it.
  await page.waitForSelector('.toast:has-text("added to your scenes")', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 2);
  assert.match(await page.textContent('.scene-grid') ?? '', /Pretend scene/);
  await shot('generate-scene-arrived');
  assert.equal(await page.locator('.gen-chip').count(), 0, 'the chip is gone');
});

test('Ctrl+Z takes the whole scene away again, and Ctrl+Y brings it back', async () => {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 1);
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 2);
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${await token()}` } });
  const { scenario } = (await res.json()) as { scenario: { scenes: Array<{ subtitle?: string; hotspots?: unknown[] }> } };
  const made = scenario.scenes.find((s) => s.subtitle === 'Pretend scene');
  assert.equal(made?.hotspots?.length, 1, 'with its thing to click');
});

test('the toast opens the new scene, and the map offers the same button', async () => {
  await page.click('.toast:has-text("added to your scenes") button');
  await page.waitForFunction(() => /#\/s\/\d+\/scene\/\d+$/.test(location.hash));
  await page.goto(`${site.url}/editor/#/s/${id}`);
  await page.click('[data-layout=map]');
  await page.waitForSelector('.map-toolbar button[data-action=generate-scene]');
  await page.click('[data-layout=cards]');
  assert.deepEqual(errors, []);
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { normalizeScenario, validateScenario, type Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { Game } from '../../client/test/harness';
import { png, startSite, wav, type TestSite } from './servers';

/**
 * The editor, end to end, in a real browser against the real backend classes:
 * a teacher signs in, builds a two-scene scenario by clicking and typing, publishes it,
 * and the published JSON is then played by the game (the headless harness of apps/client).
 *
 * Needs PHP and a Chromium for Playwright (npx playwright install chromium).
 */
let site: TestSite;
let browser: Browser;
let page: Page;
/** Answers for the next window.prompt calls. Confirmations are accepted. */
const prompts: string[] = [];
const errors: string[] = [];

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(prompts.shift() ?? '') : d.accept()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const api = async <T>(path: string): Promise<T> => {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  return (await res.json()) as T;
};
/** Wait until "Saving…" has gone, i.e. the API has everything. */
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const inspector = (selector: string) => page.locator(`.inspector ${selector}`);
/** Type into a field of the inspector and leave it, which is what saves it. */
async function type(selector: string, value: string) {
  const input = inspector(selector).first();
  await input.fill(value);
  await input.blur();
  await saved();
}

let scenarioId = 0;
let firstScene = 0;
let secondScene = 0;

test('signing in lists the seeded demo with its 16-letter code', async () => {
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'teacher@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario="1"]');
  assert.match(await page.innerText('[data-scenario="1"]'), /Starship Explorer\s+Published[\s\S]*starshipexplorer/);
});

test('create a scenario: it gets a code and a first scene', async () => {
  prompts.push('Pond Life');
  await page.click('text=New scenario');
  await page.waitForSelector('.scene-card');
  scenarioId = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  const { scenario, scenes } = await api<{ scenario: { code: string; title: string }; scenes: Array<{ id: number }> }>(`/editor/scenarios/${scenarioId}`);
  assert.equal(scenario.title, 'Pond Life');
  assert.match(scenario.code, /^[a-z]{16}$/);
  firstScene = scenes[0]!.id;
  assert.equal(await page.innerText('.publish-state'), 'Draft');
});

test('upload media and define a variable', async () => {
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [
    { name: 'pond.png', mimeType: 'image/png', buffer: png(2400, 800, [40, 120, 90]) },
    { name: 'frog.png', mimeType: 'image/png', buffer: png(64, 64, [90, 200, 60]) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: wav() },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 3);
  assert.match(await page.innerText('.grid'), /pond\.png[\s\S]*frog\.png[\s\S]*music\.wav/);

  await page.click('.tabs >> text=Variables');
  prompts.push('frogs_found');
  await page.click('text=New variable');
  await page.waitForSelector('.row-card');
  assert.equal(await page.inputValue('.row-card [data-field=variable_name] input'), 'frogs_found');
});

test('give the scene a wide background, which makes it a scrolling scene', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.click(`[data-scene="${firstScene}"] >> text=Edit`);
  await page.waitForSelector('.stage-overlay polygon');
  await page.click('[title="Add: background layers"]');
  await inspector('[data-field=media_id] select').selectOption({ label: 'pond.png' });
  await page.waitForSelector('.stage img.layer');
  await page.click('.outline-item >> text=Scene settings');
  await page.click('text=Make the scene that size');
  await page.waitForFunction(() => document.querySelector('.toolbar')?.textContent?.includes('2400 × 800 px'));
  await saved();
  const { scenes } = await api<{ scenes: Array<{ width: number; height: number; layout: { spawn_points: Array<{ position_x: number; position_y: number }> } }> }>(`/editor/scenarios/${scenarioId}`);
  assert.deepEqual([scenes[0]!.width, scenes[0]!.height], [2400, 800]);
  assert.deepEqual(scenes[0]!.layout.spawn_points[0], { name: 'default', position_x: 1200, position_y: 667 }, 'the spawn point moved with the scene');
});

test('add a hotspot with a label, an infobox, a button that changes a variable, and a condition', async () => {
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await type('[data-field=shortname] input', 'lily-pad');
  await type('[data-field=position_x] input', '600');
  await type('[data-field=position_y] input', '500');
  await type('[data-field=radius] input', '70');

  await page.click('text=+ Add label');
  await page.waitForSelector('.labels .card');
  await inspector('.labels [data-field=type] select').selectOption('image');
  await inspector('.labels [data-field=media_id] select').selectOption({ label: 'frog.png' });
  await page.waitForSelector('.stage-overlay image.label-image');

  await inspector('.add-action').selectOption('infobox');
  await page.waitForSelector('details.action[open]');
  await type('details.action [data-field=content] textarea', '<p>A frog! You have counted {{frogs_found}}.</p>');
  await page.click('text=+ Add button');
  await type('.cta input[aria-label="Button text"]', 'Count the frog');
  await inspector('.cta-head select').selectOption('variable');
  await inspector('.cta [data-field=name] select').selectOption('frogs_found');
  await inspector('.cta [data-field=operator] select').selectOption('+');
  await type('.cta [data-field=operand] input', '1');
  await page.click('.cta >> text=+ Add condition');
  await inspector('.cta .condition select').nth(1).selectOption('<');
  await type('.cta .condition input', '3');
  await saved();

  assert.match(await page.innerText('details.action summary'), /Infobox: A frog!/);
  assert.match(await page.innerText('.outline'), /lily-pad\s*click · 1 action/);
});

test('drag the hotspot on the canvas', async () => {
  const circle = page.locator('.stage-overlay circle.hotspot');
  const box = (await circle.boundingBox())!;
  const scale = (await page.locator('.stage').boundingBox())!.width / 2400; // screen pixels per scene pixel
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await saved();
  const x = Number(await inspector('[data-field=position_x] input').first().inputValue());
  assert.ok(Math.abs(x - (600 + 60 / scale)) <= 2, `the form shows the new position (x=${x})`);
  const { events } = await api<{ events: Array<{ shortname: string; position_x: number; position_y: number }> }>(`/editor/scenarios/${scenarioId}`);
  assert.equal(events[0]!.position_x, x, 'and it was saved');
  // Put it back where the play-through expects it.
  await type('[data-field=position_x] input', '600');
  await type('[data-field=position_y] input', '500');
});

test('add a start event with background music; edit and delete actions', async () => {
  await page.click('[title="Add: start events"]');
  await page.waitForSelector('.event-panel');
  await type('[data-field=shortname] input', 'arrive');
  await inspector('.add-action').selectOption('audio');
  await page.waitForSelector('details.action[open]');
  await inspector('[data-field=media_id] select').selectOption({ label: 'music.wav' });
  await inspector('[data-field=repeat] input').check();
  await inspector('[data-field=persist] input').check();
  await inspector('.add-action').selectOption('text_overlay');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 2);
  await type('details.action:nth-of-type(2) [data-field=text] textarea', 'Welcome to the pond');
  await saved();
  assert.match(await page.innerText('details.action:nth-of-type(2) summary'), /Text: Welcome to the pond/, 'the summary follows the edit');

  await inspector('.add-action').selectOption('wait');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 3);
  await page.click('details.action:nth-of-type(3) >> text=Delete');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 2);
  const { actions } = await api<{ actions: Array<{ type: string }> }>(`/editor/scenarios/${scenarioId}`);
  assert.deepEqual(actions.map((a) => a.type).sort(), ['audio', 'infobox', 'text_overlay'], 'the deleted action is gone from the database');
});

test('add a second scene and an exit along the edge that jumps to it', async () => {
  await page.click('.tabs >> text=Scenes');
  prompts.push('far-bank');
  await page.click('text=New scene');
  await page.waitForSelector('.scene-editor');
  secondScene = Number(/scene\/(\d+)/.exec(page.url())![1]);
  assert.notEqual(secondScene, firstScene);

  await page.goto(`${site.url}/editor/#/s/${scenarioId}/scene/${firstScene}`);
  await page.waitForSelector('.stage-overlay circle.hotspot');
  await page.selectOption('.add-menu', 'edge-right');
  await page.waitForSelector('.event-panel details.action');
  await saved();
  assert.match(await page.innerText('.event-panel details.action summary'), /Jump to far-bank/);
  assert.equal(await page.locator('.stage-overlay rect.hotspot.exit').count(), 1, 'the exit is drawn along the edge');
  assert.equal(await inspector('[data-field=position_y] input').first().inputValue(), '', 'it spans the whole height');
});

test('the test button opens this scene of the draft in the game', async () => {
  const href = await page.getAttribute('.toolbar a.primary', 'href');
  assert.equal(href, `/?preview=${scenarioId}&scene=${firstScene}`);
  await page.check('.toolbar input[type=checkbox]');
  assert.equal(await page.getAttribute('.toolbar a.primary', 'href'), `/?preview=${scenarioId}&scene=${firstScene}&debug=1`);
  // What that address loads: the draft, compiled on request, before anything is published.
  const { scenario } = await api<{ scenario: Scenario }>(`/editor/scenarios/${scenarioId}/preview`);
  assert.equal(scenario.scenes.length, 2);
  assert.equal((await fetch(`${site.url}/api/scenarios/${scenario.code}/play`)).status, 404, 'players cannot open a draft');
});

test('deleting a hotspot removes it and what it owned', async () => {
  await page.selectOption('.add-menu', 'hotspot-walk');
  // The new, unnamed hotspot is selected (the panel of the exit was showing until now).
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.startsWith('Hotspot'));
  await inspector('.add-action').selectOption('wait');
  await page.waitForSelector('details.action');
  await saved();
  const before = await api<{ events: unknown[]; actions: unknown[] }>(`/editor/scenarios/${scenarioId}`);
  await page.click('.panel-head >> text=Delete');
  await page.waitForFunction(() => !document.querySelector('.event-panel'));
  await saved();
  const now = await api<{ events: unknown[]; actions: unknown[] }>(`/editor/scenarios/${scenarioId}`);
  assert.equal(now.events.length, before.events.length - 1);
  assert.equal(now.actions.length, before.actions.length - 1);
});

test('publish, then play the published JSON in the game', async () => {
  await page.click('.tabs >> text=Publish');
  await page.click('text=Check and publish');
  await page.waitForSelector('[data-status="published"]');
  assert.equal(await page.innerText('.publish-state'), 'Published');
  const code = await page.innerText('.code-line .code');
  assert.match(await page.innerText('.page'), new RegExp(`${site.url.replace(/\./g, '\\.')}/${code}`), 'the player link is /{code}');

  const res = await fetch(`${site.url}/api/scenarios/${code}/play`);
  assert.equal(res.status, 200);
  const document = ((await res.json()) as { scenario: Scenario }).scenario;
  const report = validateScenario(document);
  assert.deepEqual(report.errors, []);

  const game = new Game(normalizeScenario(document));
  await game.wait(100);
  assert.equal(game.sceneName, 'scene-1');
  assert.deepEqual(game.position, { x: 1200, y: 667 });
  assert.equal(game.ctx.music?.sound.isPlaying, true, 'the start event started the music');
  assert.ok(game.ui.texts.includes('Welcome to the pond'));

  await game.click(600, 500);
  assert.match(game.box?.html ?? '', /A frog! You have counted 0\./);
  assert.deepEqual(game.box?.buttons, ['Count the frog']);
  await game.choose('Count the frog');
  assert.equal(game.var('frogs_found'), 1);

  await game.walkOff('right', 'far-bank');
  assert.equal(game.ctx.connection.me!.scene_id, secondScene);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

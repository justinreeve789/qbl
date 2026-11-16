import { readFileSync } from 'node:fs';
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

test('stars and a shop: an award in the start event, an item only this scenario sells', async () => {
  await page.click('.outline-item >> text=arrive');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 2);
  await inspector('.add-action').selectOption('award');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 3);
  assert.match(await page.innerText('details.action:nth-of-type(3) summary'), /\+5 ⭐\s+\+10 XP/, 'a new award starts with something to give');
  await type('details.action:nth-of-type(3) [data-field=xp] input', '20');
  await type('details.action:nth-of-type(3) [data-field=note] input', 'You found the pond');
  await inspector('.add-action').selectOption('shop');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 4);
  assert.match(await page.innerText('details.action:nth-of-type(4) summary'), /Open the marketplace/);
  await page.click('details.action:nth-of-type(4) >> text=Delete');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 3);
  await saved();

  await page.click('.tabs >> text=Shop');
  assert.match(await page.innerText('.page'), /sells nothing of its own/);
  await page.click('text=New item');
  await page.waitForSelector('[data-shop]');
  const card = (selector: string) => page.locator(`[data-shop] ${selector}`).first();
  const fill = async (selector: string, value: string) => {
    await card(selector).fill(value);
    await card(selector).blur();
    await saved();
  };
  await fill('[data-field=name] input', 'Frog badge');
  await fill('[data-field=price] input', '3');
  await card('[data-field=media_id] select').selectOption({ label: 'frog.png' });
  await saved();
  assert.equal(await card('[data-field=slot] select').inputValue(), 'head', 'something to wear says where it is worn');
  await card('[data-field=kind] select').selectOption('ability');
  await page.waitForSelector('[data-shop] [data-field=ability]');
  assert.equal(await page.locator('[data-shop] [data-field=slot]').count(), 0, 'an ability is not worn anywhere');
  await fill('[data-field=ability] input', 'frog_whisperer');

  const { shop_items: items } = await api<{ shop_items: Array<Record<string, unknown>> }>(`/editor/scenarios/${scenarioId}`);
  assert.equal(items.length, 1);
  assert.deepEqual([items[0]!.name, items[0]!.kind, items[0]!.price, items[0]!.scenario_id], ['Frog badge', 'ability', 3, scenarioId]);

  await page.click('.tabs >> text=Media');
  await page.click('.subtabs [data-tab=shop]');
  assert.match(await page.innerText('.grid'), /frog\.png/, 'its picture is filed under shop items');
  await page.click('.subtabs [data-tab=all]');
});

test('publish from any page, drag actions into a new order, and fold the outline', async () => {
  // The Publish button is on every page of the scenario, the scene editor included.
  await page.click('.tabs >> text=Variables');
  assert.equal(await page.locator('.workspace-head .publish-now').count(), 1);
  await page.click('.tabs >> text=Scenes');
  await page.click(`[data-scene="${firstScene}"] >> text=Edit`);
  await page.waitForSelector('.scene-editor');
  await page.click('.workspace-head .publish-now');
  await page.waitForFunction(() => document.querySelector('.publish-state')?.textContent === 'Published');
  assert.match(await page.innerText('.toasts'), /Published/);

  // The start event's actions: audio, text, award. Drag the award (third) above the audio (first).
  await page.click('.outline-item >> text=arrive');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 3);
  const tags = () => page.locator('details.action .tag').allInnerTexts();
  const before = await tags();
  assert.match(before[2]!, /Award/);
  // Fold the cards so all three are in view, as someone reordering would.
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('details.action[open]').forEach((d) => (d.open = false)));
  await page.locator('details.action:nth-of-type(3)').scrollIntoViewIfNeeded();
  const grip = await page.locator('details.action:nth-of-type(3) .grip').boundingBox();
  const first = await page.locator('details.action:nth-of-type(1)').boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(first!.x + 60, first!.y + first!.height / 2, { steps: 6 });
  await page.mouse.move(first!.x + 60, first!.y + 3, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('details.action .tag')?.textContent?.includes('Award'));
  await saved();
  assert.deepEqual(await tags(), [before[2], before[0], before[1]]);
  // Back where it was, with the buttons, which also work from the keyboard.
  await page.click('details.action:nth-of-type(1) > summary .tag');
  await page.click('details.action:nth-of-type(1) >> text=↓ Later');
  await page.waitForFunction(() => document.querySelectorAll('details.action .tag')[1]?.textContent?.includes('Award'));
  await page.click('details.action:nth-of-type(2) >> text=↓ Later');
  await page.waitForFunction(() => document.querySelectorAll('details.action .tag')[2]?.textContent?.includes('Award'));
  await saved();
  assert.deepEqual(await tags(), before);

  // The outline lists each kind of thing A to Z, and each list folds away and stays folded.
  const hotspots = await page.locator('[data-section="Hotspots"] .outline-item > span').allInnerTexts();
  assert.deepEqual(hotspots, [...hotspots].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  assert.ok(hotspots.length >= 2);
  await page.click('[data-section="Hotspots"] > summary .outline-title');
  assert.equal(await page.locator('[data-section="Hotspots"] .outline-item').first().isVisible(), false);
  await page.click('.outline-item >> text=Scene settings');
  assert.equal(await page.locator('[data-section="Hotspots"]').getAttribute('open'), null, 'still folded after the outline was redrawn');
  await page.click('[data-section="Hotspots"] > summary .outline-title');
});

test('who sees an event, a story box with portraits, and whose a variable is', async () => {
  // A character with a close-up, and a close-up for the avatar.
  await page.click('.tabs >> text=Characters');
  await page.click('text=New character');
  await page.waitForSelector('.card [data-field=portrait_media_id]');
  const card = page.locator('.card').first();
  await card.locator('[data-field=name] input').fill('Old Toad');
  await card.locator('[data-field=name] input').blur();
  await saved();
  await card.locator('[data-field=portrait_media_id] select').selectOption({ label: 'frog.png' });
  await saved();
  await page.click('.tabs >> text=Media');
  const pond = page.locator('[data-media]', { has: page.locator('.card-title', { hasText: 'pond.png' }) });
  assert.equal(await pond.locator('[data-field=avatar_portrait]').count(), 0, 'only an avatar has a portrait to choose');
  await pond.locator('label.check >> text=Players can choose this as their avatar').click();
  // A close-up is made straight away from the top third of the picture, and shown.
  await page.waitForFunction(() => [...document.querySelectorAll('[data-media] .card-title')].some((t) => t.textContent?.includes('pond-portrait.png')));
  await saved();
  const made = (await api<{ media: Array<Record<string, unknown>> }>(`/editor/scenarios/${scenarioId}`)).media.find((m) => m.filename === 'pond-portrait.png')!;
  assert.deepEqual([made.width, made.height], [2400, 267], 'the top third of the 2400 x 800 picture');
  assert.equal(await pond.locator('[data-field=avatar_portrait] select').inputValue(), String(made.id));
  assert.match((await pond.locator('img.portrait').getAttribute('src')) ?? '', /^\/media\//, 'the close-up is shown, not only named');
  // It is only a default: another picture can be chosen.
  await pond.locator('[data-field=avatar_portrait] select').selectOption({ label: 'frog.png' });
  await saved();
  assert.match((await pond.locator('img.portrait').getAttribute('src')) ?? '', new RegExp(String(await page.locator('[data-media]', { has: page.locator('.card-title', { hasText: 'frog.png' }) }).locator('img.preview').getAttribute('src')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // The start event: a story box spoken by the character, and the whole event shown to everyone in the scene.
  await page.click('.tabs >> text=Scenes');
  await page.click(`[data-scene="${firstScene}"] >> text=Edit`);
  await page.click('.outline-item >> text=arrive');
  assert.equal(await inspector('[data-field=audience] select').inputValue(), 'player', 'an event is the player\'s own unless it says otherwise');
  await inspector('[data-field=audience] select').selectOption('scene');
  await saved();
  await inspector('.add-action').selectOption('dialogue');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 4);
  const say = 'details.action:nth-of-type(4)';
  await inspector(`${say} [data-field=style] select`).selectOption('portrait');
  await inspector(`${say} [data-field=speaker] select`).selectOption('character');
  await inspector(`${say} [data-field=character_id] select`).selectOption({ label: 'Old Toad' });
  await type(`${say} [data-field=text] textarea`, 'Mind the lily pads.');
  await type(`${say} [data-field=duration] input`, '900');
  assert.match(await page.innerText(`${say} summary`), /Old Toad says, in a story box: Mind the lily pads\./);
  await saved();

  // Variables say whose they are, and a shared one is marked wherever it is picked.
  await page.click('.tabs >> text=Variables');
  const frogs = page.locator('[data-variable=frogs_found]');
  assert.match(await frogs.locator('.badge').innerText(), /Each player/);
  await frogs.locator('[data-field=scope] select').selectOption('room');
  await saved();
  assert.match(await page.locator('[data-variable=frogs_found] .badge').innerText(), /Shared/);

  const bundle = await api<{ scenario: { settings: Record<string, unknown> }; events: Array<Record<string, unknown>>; characters: Array<Record<string, unknown>>; variables: Array<Record<string, unknown>> }>(`/editor/scenarios/${scenarioId}`);
  assert.equal(bundle.events.find((e) => e.shortname === 'arrive')!.audience, 'scene');
  const frog = (bundle.characters[0]!.settings as { portrait_media_id: number }).portrait_media_id;
  assert.ok(frog > 0);
  assert.deepEqual(Object.values(bundle.scenario.settings.avatar_portraits as Record<string, number>), [frog]);
  assert.equal(bundle.variables.find((v) => v.variable_name === 'frogs_found')!.scope, 'room');
});

test('animations: an animated PNG becomes a sprite sheet, frames are picked for a new animation, and moves and animate actions use them', async () => {
  await page.click('.tabs >> text=Media');
  await page.click('.subtabs [data-tab=all]');
  const before = await page.locator('[data-media]').count();
  await page.setInputFiles('.page input[type=file]', [{ name: 'hop.apng', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/hop.apng', import.meta.url)) }]);
  await page.waitForFunction((n) => document.querySelectorAll('[data-media]').length === n + 1, before);
  await saved();
  const media = async () => (await api<{ media: Array<Record<string, any>> }>(`/editor/scenarios/${scenarioId}`)).media.find((m) => m.filename === 'hop-sheet.png')!;
  // Four 40 x 60 frames, laid out two by two, playing at the file's own speed (100 + 100 + 200 + 100 ms).
  assert.deepEqual([(await media()).width, (await media()).height], [80, 120]);
  assert.deepEqual((await media()).params.sheet, { columns: 2, rows: 2 });
  assert.deepEqual((await media()).params.animations, [{ name: 'idle', frames: [0, 1, 2, 3], duration: 500 }]);

  // The sheet tool: add an animation and click the frames that make it up.
  const card = page.locator('[data-media]', { has: page.locator('.card-title', { hasText: 'hop-sheet.png' }) });
  await card.locator('[data-fold=media-sheet] > summary').click();
  assert.equal(await card.locator('.sheet-cell').count(), 4);
  assert.deepEqual(await card.locator('.sheet-cell.in .sheet-place').allInnerTexts(), ['1', '2', '3', '4'], 'the frames of the animation being edited are lit, with their place in it');
  await card.locator('text=+ Add animation').click();
  await page.waitForFunction(() => document.querySelectorAll('.sheet-animation[data-animation]').length === 2);
  assert.equal(await card.locator('.sheet-animation.editing input[type=text]').inputValue(), 'walk', 'the next usual name is offered');
  await card.locator('.sheet-cell[data-frame="3"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.sheet-cell.in').length === 1);
  await card.locator('.sheet-cell[data-frame="1"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.sheet-cell.in').length === 2);
  await saved();
  assert.deepEqual((await media()).params.animations[1], { name: 'walk', frames: [3, 1] });
  // The preview steps through those frames.
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    seen.add((await card.locator('.sheet-preview').getAttribute('data-frame')) ?? '');
    await page.waitForTimeout(60);
  }
  assert.deepEqual([...seen].sort(), ['1', '3']);

  // A move for everyone, on the Moves page.
  await page.click('.tabs >> text=Moves');
  await page.waitForSelector('text=New move');
  assert.match(await page.innerText('.page'), /players walk, and that is all/);
  await page.click('text=New move');
  await page.waitForSelector('[data-move=jump]');
  await saved();

  // And an animate action in the hotspot's event.
  await page.click('.tabs >> text=Scenes');
  await page.click(`[data-scene="${firstScene}"] >> text=Edit`);
  await page.click('.outline-item >> text=lily-pad');
  const count = await page.locator('details.action').count();
  await inspector('.add-action').selectOption('animate');
  await page.waitForFunction((n) => document.querySelectorAll('details.action').length === n + 1, count);
  assert.match(await page.locator('details.action').last().locator('summary').innerText(), /The player: jump/);
  await page.locator('details.action').last().locator('[data-field=animation] input').fill('dance');
  await page.locator('details.action').last().locator('[data-field=animation] input').blur();
  await saved();
  assert.match(await page.locator('details.action').last().locator('summary').innerText(), /The player: dance/);
  // It must not hold up the infobox that follows a click on the lily pad.
  await page.locator('details.action').last().locator('[data-field=blocking] input').uncheck();
  await saved();
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
  await game.wait(5000); // the award comes after the welcome text has had its time on screen
  assert.deepEqual(game.ui.hud, { stars: 5, xp: 20, rank: 'Cadet', next_rank_xp: 100 }, 'the award in the start event was given');
  assert.deepEqual(game.ctx.rewards.catalogue.map((i) => [i.name, i.kind, i.price, i.ability]), [['Frog badge', 'ability', 3, 'frog_whisperer']]);

  // The start event is for the whole scene, so what it showed went out to the other players; its award did not.
  const start = document.scenes[0]!.start_events![0]!;
  assert.equal(start.audience, 'scene');
  const shown = (game.ctx.connection as unknown as { shared: Array<{ action_id: number }> }).shared.map((s) => s.action_id);
  assert.deepEqual(shown, start.actions.filter((a) => a.type !== 'award').map((a) => a.id));
  assert.equal(document.characters![0]!.portrait_media_id, Object.values(document.avatar_portraits!)[0], 'the character and the avatar were both given the frog as a close-up');

  // The sheet and its animations are in the document, and the move is a button on the player's screen.
  const hop = document.assets!.find((m) => m.filename === 'hop-sheet.png')!;
  assert.deepEqual(hop.sheet, { columns: 2, rows: 2 });
  assert.deepEqual(hop.animations!.map((a) => [a.name, a.frames]), [['idle', [0, 1, 2, 3]], ['walk', [3, 1]]]);
  assert.deepEqual(game.ui.moveButtons.map((m) => m.animation), ['jump']);

  await game.click(600, 500);
  assert.match(game.box?.html ?? '', /A frog! You have counted 0\./);
  assert.deepEqual(game.box?.buttons, ['Count the frog']);
  await game.choose('Count the frog');
  assert.equal(game.var('frogs_found'), 1);
  assert.match(game.ctx.connection.me!.anim, /^dance:/, 'the animate action in the hotspot set the avatar dancing');
  assert.equal(game.ctx.connection.state.vars.get('frogs_found'), '1', 'now a shared variable: it lives in the room, for everyone');

  await game.walkOff('right', 'far-bank');
  assert.equal(game.ctx.connection.me!.scene_id, secondScene);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

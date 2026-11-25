import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { normalizeScenario, validateScenario, type Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { Game } from '../../client/test/harness';
import { png, startSite, wav, type TestSite, chooseMedia } from './servers';

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
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Pond Life');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
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
  await page.waitForSelector('.var-row[data-variable]');
  assert.equal(await page.inputValue('.var-row[data-variable] [data-field=variable_name] input'), 'frogs_found');
});

test('give the scene a wide background, which makes it a scrolling scene', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.click(`[data-scene="${firstScene}"] >> text=Edit`);
  await page.waitForSelector('.stage-overlay polygon');
  await page.click('[title="Add: background layers"]');
  await chooseMedia(inspector('[data-field=media_id]'), 'pond.png');
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
  await type('[data-field=radius] input[type=number]', '70');

  await page.click('text=+ Add label');
  await page.waitForSelector('.labels .card');
  await inspector('.labels [data-field=type] select').selectOption('image');
  await chooseMedia(inspector('.labels [data-field=media_id]'), 'frog.png');
  await page.waitForSelector('.stage-overlay image.label-image');

  await inspector('.add-action').selectOption('infobox');
  await page.waitForSelector('details.action[open]');
  // The content is edited as it looks: select what a new box says and type over it.
  await inspector('details.action .rt-surface').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('A frog! You have counted {{frogs_found}}.');
  await inspector('details.action .rt-surface').blur();
  await saved();
  await page.click('text=+ Add button');
  await type('.cta input[aria-label="Button text"]', 'Count the frog');
  await inspector('.cta-head select').selectOption('variable');
  await inspector('.cta [data-field=name] select').selectOption('frogs_found');
  await inspector('.cta [data-field=operator] select').selectOption('+');
  await type('.cta [data-field=operand] input', '1');
  await page.click('.cta >> text=+ Add condition');
  // The system's variables can be tested too, after the scenario's own.
  const choices = await inspector('.cta .condition select').first().locator('option').allTextContents();
  assert.ok(choices.includes('QL_IsTeacher (built in)') && choices.indexOf('frogs_found') < choices.indexOf('QL_PlayerName (built in)'), choices.join(', '));
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
  // The hotspot's panel is still open from the last test: wait for the new event's, or the name goes to the hotspot.
  await page.waitForFunction(() => document.querySelector('.event-panel h2')?.textContent?.startsWith('Start event'));
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
  assert.equal(href, `/play?preview=${scenarioId}&scene=${firstScene}`);
  await page.check('.toolbar input[type=checkbox]');
  assert.equal(await page.getAttribute('.toolbar a.primary', 'href'), `/play?preview=${scenarioId}&scene=${firstScene}&debug=1`);
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
  // A new item opens in its own panel.
  await page.click('text=New item');
  await page.waitForSelector('dialog[data-panel=shop]');
  const card = (selector: string) => page.locator(`dialog[data-panel=shop] ${selector}`).first();
  const fill = async (selector: string, value: string) => {
    await card(selector).fill(value);
    await card(selector).blur();
    await saved();
  };
  await fill('[data-field=name] input', 'Frog badge');
  await fill('[data-field=price] input', '3');
  await chooseMedia(card('[data-field=media_id]'), 'frog.png');
  await saved();
  assert.equal(await card('[data-field=slot] select').inputValue(), 'head', 'something to wear says where it is worn');
  await card('[data-field=kind] select').selectOption('ability');
  await page.waitForSelector('dialog[data-panel=shop] [data-field=ability]');
  assert.equal(await page.locator('dialog[data-panel=shop] [data-field=slot]').count(), 0, 'an ability is not worn anywhere');
  await fill('[data-field=ability] input', 'frog_whisperer');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  // The card behind says what it is and what it costs.
  assert.match(await page.innerText('[data-shop]'), /Frog badge[\s\S]*⭐ 3[\s\S]*Ability/);

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
  // Back where it was: dragged below the last card. Dragging is the only way; there are no
  // "Earlier" / "Later" buttons any more.
  const grip2 = await page.locator('details.action:nth-of-type(1) .grip').boundingBox();
  const last = await page.locator('details.action:nth-of-type(3)').boundingBox();
  await page.mouse.move(grip2!.x + grip2!.width / 2, grip2!.y + grip2!.height / 2);
  await page.mouse.down();
  await page.mouse.move(last!.x + 60, last!.y + last!.height / 2, { steps: 6 });
  await page.mouse.move(last!.x + 60, last!.y + last!.height - 3, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('details.action .tag')[2]?.textContent?.includes('Award'));
  await saved();
  assert.deepEqual(await tags(), before);
  await page.click('details.action:nth-of-type(1) > summary .tag');
  assert.equal(await page.locator('details.action button', { hasText: /Earlier|Later/ }).count(), 0);

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
  // A character with a close-up.
  await page.click('.tabs >> text=Characters');
  await page.click('text=New character');
  // A new character opens in its panel.
  const card = page.locator('dialog[data-panel=character]');
  await card.locator('[data-animation=portrait]').waitFor();
  await card.locator('[data-field=name] input').fill('Old Toad');
  await card.locator('[data-field=name] input').blur();
  await saved();
  assert.match(await card.locator('.panel-title').innerText(), /Old Toad/, 'the panel\'s heading follows the name');
  // Its close-up is its portrait animation; nothing else is drawn yet.
  await chooseMedia(card.locator('[data-animation=portrait] .anim-picture-choice'), 'frog.png');
  await saved();
  await card.locator('.panel-close').click();
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  assert.match(await page.locator('.character-card .card-title').first().innerText(), /Old Toad/, 'the card behind has caught up with the name');
  await page.click('.tabs >> text=Media');
  assert.equal(await page.locator('text=Players can choose this as their avatar').count(), 0, 'avatars are the platform\'s: a scenario does not choose them');

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
  assert.equal(await frogs.getAttribute('data-scope'), 'player');
  await frogs.locator('[data-field=scope] select').selectOption('room');
  await saved();
  assert.equal(await page.locator('[data-variable=frogs_found]').getAttribute('data-scope'), 'room');
  // The filter shows only the shared ones; frogs_found is now one of them.
  await page.click('.scope-filter[data-scope=room]');
  assert.equal(await page.locator('.var-row[data-variable]:not([hidden])').count(), 1);
  await page.click('.scope-filter[data-scope=all]');

  const bundle = await api<{ scenario: { settings: Record<string, unknown> }; events: Array<Record<string, unknown>>; characters: Array<Record<string, unknown>>; variables: Array<Record<string, unknown>> }>(`/editor/scenarios/${scenarioId}`);
  assert.equal(bundle.events.find((e) => e.shortname === 'arrive')!.audience, 'scene');
  const frog = (bundle.characters[0]!.settings as { animations: { portrait: { media_id: number } } }).animations.portrait.media_id;
  assert.ok(frog > 0);
  assert.equal(bundle.variables.find((v) => v.variable_name === 'frogs_found')!.scope, 'room');
});

test('animations: an animated PNG plays as it is, its animations are made on the Media page, and a character plays one by name', async () => {
  await page.click('.tabs >> text=Media');
  await page.click('.subtabs [data-tab=all]');
  const before = await page.locator('[data-media]').count();
  await page.setInputFiles('.page input[type=file]', [{ name: 'hop.apng', mimeType: 'image/png', buffer: readFileSync(new URL('./fixtures/hop.apng', import.meta.url)) }]);
  await page.waitForFunction((n) => document.querySelectorAll('[data-media]').length === n + 1, before);
  await saved();
  const media = async (name: string) => (await api<{ media: Array<Record<string, any>> }>(`/editor/scenarios/${scenarioId}`)).media.find((m) => m.filename === name)!;
  // Four 40 x 60 frames at the file's own speed (100 + 100 + 200 + 100 ms), kept as the file it is.
  const hop = await media('hop.apng');
  assert.deepEqual([hop.width, hop.height, hop.params.apng], [40, 60, { frames: 4, duration: 500, plays: 0 }]);
  assert.equal(hop.params.sheet, undefined, 'it is not laid out as a sheet');
  assert.match(await page.locator('[data-media]', { has: page.locator('.card-title', { hasText: 'hop.apng' }) }).innerText(), /Animated PNG: 4 frames, 500 ms/);

  // Old Toad stands as the whole animated PNG, and hops on some of its frames.
  await page.click('.tabs >> text=Characters');
  await page.locator('.character-card', { has: page.locator('.card-title', { hasText: 'Old Toad' }) }).locator('[data-open=character]').click();
  const toad = page.locator('dialog[data-panel=character]');
  await chooseMedia(toad.locator('[data-animation=stand_right] .anim-picture-choice'), 'hop.apng');
  await saved();
  assert.match(await toad.locator('[data-animation=stand_left]').innerText(), /Uses Standing, facing right, mirrored/, 'the other side is filled in, mirrored');
  assert.match(await toad.locator('[data-animation=walk_right]').innerText(), /Uses Standing, facing right/);
  await toad.locator('.anim-add input').fill('hop');
  await toad.locator('text=+ Add animation').click();
  await toad.locator('[data-animation=hop]').waitFor();
  // The new animation opens in a panel of its own, over the character's. It plays one of its
  // picture's animations, made on the Media page: none yet, so a new one is made there.
  const hopPanel = page.locator('dialog[data-panel=animation]');
  await hopPanel.locator('select.anim-plays').waitFor();
  assert.match(await hopPanel.locator('.panel-title').innerText(), /Old Toad · hop/);
  assert.equal(await hopPanel.locator('.frame-grid').count(), 0, 'frames are not picked on the character');
  await hopPanel.locator('[data-new-on-media]').click();
  const hopMedia = page.locator('dialog[data-panel=media]');
  await hopMedia.locator('.sheet-animation.editing input.sheet-name').waitFor();
  assert.equal(await hopMedia.locator('.sheet-animation.editing input.sheet-name').inputValue(), 'hop', 'named for the character’s animation');
  await hopMedia.locator('.sheet-cell').first().waitFor();
  assert.equal(await hopMedia.locator('.sheet-cell:not([disabled])').count(), 4, 'its frames are cut from the file to pick from');
  await hopMedia.locator('.sheet-cell[data-frame="3"]').click();
  await saved();
  await page.waitForFunction(() => document.querySelectorAll('dialog[data-panel=media] .sheet-cell.in').length === 1);
  await hopMedia.locator('.sheet-cell[data-frame="1"]').click();
  await saved();
  await page.waitForFunction(() => document.querySelectorAll('dialog[data-panel=media] .sheet-cell.in').length === 2);
  const toadRow = async () => (await api<{ characters: Array<Record<string, any>> }>(`/editor/scenarios/${scenarioId}`)).characters.find((c) => c.name === 'Old Toad')!;
  assert.deepEqual((await media('hop.apng')).params.animations, [{ name: 'hop', frames: [3, 1] }], 'the animation is the picture’s');
  assert.deepEqual((await toadRow()).settings.animations.hop, { media_id: hop.id, frames: [3, 1], sheet_animation: 'hop' }, 'and the character plays it');
  assert.deepEqual((await toadRow()).settings.animations.stand_right, { media_id: hop.id });
  // Its preview steps through those frames.
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) {
    seen.add((await toad.locator('[data-animation=hop] .anim-preview').getAttribute('data-frame')) ?? '');
    await page.waitForTimeout(60);
  }
  assert.deepEqual([...seen].sort(), ['1', '3']);
  // Frames can be typed, a frame more than once; the speed is set there too. The character takes each change.
  await hopMedia.locator('.sheet-animation.editing input.sheet-frames').fill('3 1 1');
  await hopMedia.locator('.sheet-animation.editing input.sheet-frames').blur();
  await saved();
  await hopMedia.locator('.sheet-animation.editing input[aria-label="Milliseconds for one pass"]').fill('300');
  await hopMedia.locator('.sheet-animation.editing input[aria-label="Milliseconds for one pass"]').blur();
  await saved();
  assert.deepEqual((await toadRow()).settings.animations.hop, { media_id: hop.id, frames: [3, 1, 1], duration: 300, sheet_animation: 'hop' });
  assert.match(await hopMedia.locator('.sheet-animation.editing .sheet-users').innerText(), /Old Toad \(hop\)/, 'the picture says who plays it');
  // Renamed on the picture, it is still the one the character plays.
  await hopMedia.locator('.sheet-animation.editing input.sheet-name').fill('leap');
  await hopMedia.locator('.sheet-animation.editing input.sheet-name').blur();
  await saved();
  assert.equal((await toadRow()).settings.animations.hop.sheet_animation, 'leap');
  await page.keyboard.press('Escape');
  await hopMedia.waitFor({ state: 'detached' });
  assert.equal(await hopPanel.locator('select.anim-plays').inputValue(), 'leap');
  assert.match(await toad.locator('[data-animation=hop] .anim-summary').innerText(), /3 frames[\s\S]*300 ms/, 'the character\'s list sums it up');
  // Escape puts away the animation's panel, then the character's.
  await page.keyboard.press('Escape');
  await hopPanel.waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  await toad.waitFor({ state: 'detached' });
  assert.match(await page.locator('.character-card [data-pose=stand_right]').innerText(), /✓/, 'the card shows which poses are drawn');

  // The sheet tool, for items and pictures: say the grid, add an animation and click its frames.
  await page.click('.tabs >> text=Media');
  await page.locator('[data-media]', { has: page.locator('.card-title', { hasText: 'frog.png' }) }).locator('[data-open=sheet]').click();
  const card = page.locator('dialog[data-panel=media]');
  await card.locator('[data-field=columns] input').fill('2');
  await card.locator('[data-field=columns] input').blur();
  await saved();
  await card.locator('[data-field=rows] input').fill('2');
  await card.locator('[data-field=rows] input').blur();
  await saved();
  assert.deepEqual((await media('frog.png')).params.sheet, { columns: 2, rows: 2 });
  assert.equal(await card.locator('.sheet-cell').count(), 4);
  await card.locator('text=+ Add animation').click();
  await page.waitForFunction(() => document.querySelectorAll('.sheet-animation[data-animation]').length === 1);
  assert.equal(await card.locator('.sheet-animation.editing input.sheet-name').inputValue(), 'idle', 'the first usual name is offered');
  await card.locator('.sheet-cell[data-frame="3"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-section=sheet] .sheet-cell.in').length === 1);
  await card.locator('.sheet-cell[data-frame="1"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-section=sheet] .sheet-cell.in').length === 2);
  await saved();
  assert.deepEqual((await media('frog.png')).params.animations[0], { name: 'idle', frames: [3, 1] });
  // Back to one picture: the frog is Old Toad's close-up and the pond's label.
  await card.locator('[data-field=columns] input').fill('1');
  await card.locator('[data-field=columns] input').blur();
  await saved();
  await card.locator('[data-field=rows] input').fill('1');
  await card.locator('[data-field=rows] input').blur();
  await saved();
  assert.equal((await media('frog.png')).params.sheet, undefined);
  await card.locator('.panel-close').click();
  await card.waitFor({ state: 'detached' });

  // A move for everyone, on the Moves page.
  await page.click('.tabs >> text=Moves');
  await page.waitForSelector('text=New move');
  assert.match(await page.innerText('.page'), /players walk, and that is all/);
  await page.click('text=New move');
  await page.waitForSelector('dialog[data-panel=move]');
  await page.waitForSelector('[data-move=jump]');
  await saved();
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });

  // And an animate action in the hotspot's event.
  await page.click('.tabs >> text=Scenes');
  await page.click(`[data-scene="${firstScene}"] >> text=Edit`);
  await page.click('.outline-item >> text=lily-pad');
  const count = await page.locator('details.action').count();
  await inspector('.add-action').selectOption('animate');
  await page.waitForFunction((n) => document.querySelectorAll('details.action').length === n + 1, count);
  assert.match(await page.locator('details.action').last().locator('summary').innerText(), /The player: jump/);
  await page.locator('details.action').last().locator('[data-field=animation] select').selectOption('dance');
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
  const code = await page.innerText('.link-box .code');
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
  assert.ok(document.characters![0]!.animations?.portrait, 'the character has its close-up');
  assert.deepEqual(Object.keys(document.characters![0]!.animations!).sort(), ['hop', 'portrait', 'stand_right'], 'and its animations');
  const hopMedia = document.assets!.find((m) => m.id === document.characters![0]!.animations!.stand_right!.media_id)!;
  assert.deepEqual(hopMedia.apng, { frames: 4, duration: 500, plays: 0 }, 'the animated PNG arrives as one');

  // The move is a button on the player's screen.
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

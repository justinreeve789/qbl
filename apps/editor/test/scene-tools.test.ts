import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite } from './servers';

/**
 * The rest of what a scene and a scenario can hold, each checked in the JSON the editor's
 * changes produce: layers (repeated, drifting, parallax), walkable and blocked areas, spawn
 * points, items and characters and their placement, objectives, settings, and deleting.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const prompts: string[] = [];
const errors: string[] = [];
let id = 0;
let sceneId = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(prompts.shift() ?? '') : d.accept()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  prompts.push('Tools');
  await page.click('text=New scenario');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const inspector = (selector: string) => page.locator(`.inspector ${selector}`);
async function type(selector: string, value: string) {
  const input = page.locator(selector).first();
  await input.fill(value);
  await input.blur();
  await saved();
}
/** The scenario JSON as the game would get it now. */
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
async function dragBy(selector: string, dx: number, dy: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
  await saved();
}

test('items and characters: define them, with conditions', async () => {
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [
    { name: 'sky.png', mimeType: 'image/png', buffer: png(256, 256, [90, 140, 220]) },
    { name: 'boat.png', mimeType: 'image/png', buffer: png(120, 60, [150, 90, 40]) },
    { name: 'guide.png', mimeType: 'image/png', buffer: png(80, 160, [200, 80, 120]) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 3);
  // Let players choose the guide picture as their avatar.
  await page.locator('[data-media]', { hasText: 'guide.png' }).locator('text=Players can choose this').click();

  await page.click('.tabs >> text=Variables');
  prompts.push('has_ticket');
  await page.click('text=New variable');
  await page.waitForSelector('.row-card');

  await page.click('.tabs >> text=Items');
  await page.click('text=New item');
  await page.waitForSelector('.grid .card');
  await type('.card [data-field=name] input', 'rowing boat');
  await page.locator('.card [data-field=media_id] select').selectOption({ label: 'boat.png' });
  await page.locator('.card [data-field=vehicle] input').check();
  await type('.card [data-field=speed_multiplier] input', '1.4');
  await page.click('.card >> text=+ Add condition');
  await page.waitForSelector('.card .condition');

  await page.click('.tabs >> text=Characters');
  await page.click('text=New character');
  await page.waitForSelector('.grid .card');
  await type('.card [data-field=name] input', 'Ferry keeper');
  await page.locator('.card [data-field=media_id] select').selectOption({ label: 'guide.png' });

  const doc = await draft();
  const boat = doc.items![0]!;
  assert.deepEqual([boat.name, boat.vehicle, boat.speed_multiplier, boat.conditions?.length], ['rowing boat', true, 1.4, 1]);
  assert.equal(boat.conditions![0]!.variable, 'has_ticket');
  assert.equal(doc.characters![0]!.name, 'Ferry keeper');
  assert.deepEqual(doc.avatar_media_ids, [doc.assets!.find((m) => m.filename === 'guide.png')!.id]);
});

test('layers: a repeated, drifting sky behind and a foreground in front', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  sceneId = Number(/scene\/(\d+)/.exec(page.url())![1]);

  await page.click('[title="Add: background layers"]');
  await inspector('[data-field=media_id] select').selectOption({ label: 'sky.png' });
  await inspector('[data-field=tile] input').check();
  await type('.inspector [data-field=scroll_speed_x] input', '-12');
  await type('.inspector [data-field=parallax] input', '0.4');
  await page.waitForSelector('.stage .layer.tiled');

  await page.click('[title="Add: foreground layers"]');
  await inspector('[data-field=media_id] select').selectOption({ label: 'boat.png' });
  await type('.inspector [data-field=position_y] input', '900');
  await type('.inspector [data-field=display_height] input', '180');

  let scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.background_media, [{ media_id: scene.background_media![0]!.id ?? (scene.background_media![0] as { media_id: number }).media_id, tile: true, scroll_speed_x: -12, parallax: 0.4 }]);
  assert.deepEqual((scene.foreground_media![0] as { position_y: number; display_height: number }).display_height, 180);

  await page.click('text=Delete layer');
  scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.foreground_media, []);
});

test('areas: move a corner, add one, remove one; add a blocked area', async () => {
  await page.click('.outline-item >> text=Area 1');
  await page.waitForSelector('.stage-overlay circle.handle');
  const corners = async () => (await draft()).scenes[0]!.walkable_areas![0]!;
  const start = await corners();
  assert.equal(start.length, 4);

  await dragBy('.stage-overlay circle.handle:not(.add)', 30, -20);
  const moved = await corners();
  assert.ok(moved[0]!.x > start[0]!.x && moved[0]!.y < start[0]!.y, 'the first corner moved right and up');

  await dragBy('.stage-overlay circle.handle.add', 0, -25);
  assert.equal((await corners()).length, 5, 'dragging the dot on a side adds a corner');

  await page.locator('.stage-overlay circle.handle:not(.add)').nth(1).dblclick();
  await saved();
  assert.equal((await corners()).length, 4, 'double-clicking a corner removes it');

  await page.selectOption('.add-menu', 'blocked_areas');
  await page.waitForSelector('.stage-overlay polygon.blocked');
  assert.equal((await draft()).scenes[0]!.blocked_areas!.length, 1);
  await page.click('text=Delete area');
  assert.equal((await draft()).scenes[0]!.blocked_areas!.length, 0);
});

test('spawn points, a placed item, and a character that runs an event when clicked', async () => {
  await page.selectOption('.add-menu', 'spawn');
  await page.waitForSelector('.inspector [data-field=name]');
  await type('.inspector [data-field=name] input', 'jetty');
  await inspector('[data-field=facing] select').selectOption('left');

  await page.selectOption('.add-menu', 'indirect');
  await page.waitForSelector('.event-panel');
  await type('.inspector [data-field=shortname] input', 'keeper-talks');
  await inspector('.add-action').selectOption('infobox');
  await page.waitForSelector('details.action[open]');

  await page.selectOption('.add-menu', 'item');
  await page.waitForSelector('.stage-overlay .placement.items');
  await page.selectOption('.add-menu', 'character');
  await page.waitForSelector('.stage-overlay .placement.characters');
  await inspector('[data-field=event_id] select').selectOption({ index: 1 });
  await dragBy('.stage-overlay .placement.characters', -80, 0);

  const doc = await draft();
  const scene = doc.scenes[0]!;
  assert.deepEqual(scene.spawn_points!.map((p) => p.name), ['default', 'jetty']);
  assert.equal(scene.spawn_points![1]!.facing, 'left');
  assert.equal(scene.items![0]!.item_id, doc.items![0]!.id);
  assert.equal(scene.characters![0]!.event_id, scene.indirect_events![0]!.id);
  assert.ok(scene.characters![0]!.position_x < scene.items![0]!.position_x, 'the character was dragged left of the item');

  await page.click('.outline-item >> text=jetty');
  await page.click('.inspector >> text=Delete');
  assert.deepEqual((await draft()).scenes[0]!.spawn_points!.map((p) => p.name), ['default']);
});

test('depth, reveal and avatar visibility: a scale area, a hotspot that appears when near, a hide action', async () => {
  await page.selectOption('.add-menu', 'scale_areas');
  await page.waitForSelector('.stage-overlay rect.scale-area.selected');
  await type('.inspector [data-field=scale_top] input', '40');
  await type('.inspector [data-field=height] input', '300');
  await dragBy('.stage-overlay rect.handle >> nth=1', 0, 20); // the bottom-right corner
  let scene = (await draft()).scenes[0]!;
  const area = scene.scale_areas![0]!;
  assert.deepEqual([area.scale_top, area.scale_bottom, area.x], [40, 100, 0]);
  assert.ok(area.height > 300, 'dragging the corner made the box taller');

  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.startsWith('Hotspot'));
  await type('.inspector [data-field=reveal_radius] input', '500');
  await type('.inspector [data-field=reveal_full_radius] input', '200');
  await page.waitForSelector('.stage-overlay circle.reveal-ring.full');
  await inspector('.add-action').selectOption('avatar');
  await page.waitForSelector('details.action[open]');
  assert.match(await page.innerText('details.action summary'), /Hide the player’s avatar/);
  await inspector('details.action [data-field=visible] select').selectOption('true');
  await saved();
  assert.match(await page.innerText('details.action summary'), /Show the player’s avatar/);

  scene = (await draft()).scenes[0]!;
  const spot = scene.hotspots!.at(-1)!;
  assert.deepEqual([spot.reveal_radius, spot.reveal_full_radius], [500, 200]);
  assert.deepEqual([spot.actions[0]!.type, (spot.actions[0] as { visible: boolean }).visible], ['avatar', true]);

  await page.click('.outline-item >> text=depth');
  await type('.inspector [data-field=speed_effect] input', '60');
  assert.equal((await draft()).scenes[0]!.scale_areas![0]!.speed_effect, 60);
  await page.click('.outline-item >> text=Hotspot');
  await inspector('.add-action').selectOption('freeze');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 2);
  assert.match(await page.innerText('details.action:nth-of-type(2) summary'), /Stop the player from moving/);
  assert.deepEqual((await draft()).scenes[0]!.hotspots!.at(-1)!.actions.map((a) => a.type), ['avatar', 'freeze']);
  await page.click('.outline-item >> text=depth');
  await page.click('.inspector >> text=Delete');
  assert.deepEqual((await draft()).scenes[0]!.scale_areas, []);
});

test('objectives and settings', async () => {
  await page.click('.tabs >> text=Objectives');
  await page.click('text=New objective');
  await page.waitForSelector('.stack .card');
  await type('.card [data-field=text] input', 'Buy a ticket');
  await page.locator('.card .conditions').nth(1).locator('text=+ Add condition').click();
  await page.waitForSelector('.card .condition');

  await page.click('.tabs >> text=Settings');
  await type('[data-field=title] input', 'Tools and more');
  await page.locator('[data-field=chat_mode] select').selectOption('off');
  await type('[data-field=move_speed] input', '300');

  const doc = await draft();
  assert.deepEqual(doc.objectives, [{ id: 'objective-1', text: 'Buy a ticket', complete_when: [{ variable: 'has_ticket', operator: '=', operand: 1 }] }]);
  assert.deepEqual([doc.title, doc.chat_mode, doc.move_speed], ['Tools and more', 'off', 300]);
  assert.equal(await page.innerText('.scenario-title'), 'Tools and more');
});

test('delete a scene, a media file, and then the whole scenario', async () => {
  await page.click('.tabs >> text=Scenes');
  prompts.push('spare');
  await page.click('text=New scene');
  await page.waitForSelector('.scene-editor');
  await page.click('.inspector >> text=Delete scene');
  await page.waitForSelector('.scene-card');
  await saved();
  assert.deepEqual((await draft()).scenes.map((s) => s.id), [sceneId]);

  await page.click('.tabs >> text=Media');
  await page.locator('[data-media]', { hasText: 'boat.png' }).locator('text=Delete').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 2);
  const doc = await draft();
  assert.equal(doc.assets!.length, 2);
  assert.equal(doc.items![0]!.media_id, undefined, 'the item is kept, without its picture');

  await page.click('.tabs >> text=Settings');
  prompts.push('Tools and more');
  await page.click('text=Delete scenario');
  await page.waitForSelector('[data-scenario]');
  assert.equal(await page.locator(`[data-scenario="${id}"]`).count(), 0);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

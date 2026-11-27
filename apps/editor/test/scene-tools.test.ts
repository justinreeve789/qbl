import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, wav, type TestSite, chooseMedia, chooseSound } from './servers';

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
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Tools');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
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
  // Avatars are the platform's, the same in every scenario, so a scenario's pictures are not offered as avatars.
  assert.equal(await page.locator('text=Players can choose this').count(), 0);
  await saved();

  await page.click('.tabs >> text=Variables');
  prompts.push('has_ticket');
  await page.click('text=New variable');
  await page.waitForSelector('.var-row[data-variable]');

  await page.click('.tabs >> text=Items');
  // A new item opens in its own panel; a vehicle's speed is offered once it is a vehicle.
  await page.click('text=New item');
  const item = 'dialog[data-panel=item]';
  await page.waitForSelector(item);
  await type(`${item} [data-field=name] input`, 'rowing boat');
  await chooseMedia(page.locator(`${item} [data-field=media_id]`), 'boat.png');
  assert.equal(await page.locator(`${item} [data-field=speed_multiplier]`).count(), 0, 'no speed for something that is not a vehicle');
  await page.locator(`${item} [data-field=vehicle] input`).check();
  await page.waitForSelector(`${item} [data-field=speed_multiplier]`);
  await type(`${item} [data-field=speed_multiplier] input[type=number]`, '1.4');
  await page.click(`${item} >> text=+ Add condition`);
  await page.waitForSelector(`${item} .condition`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  assert.match(await page.innerText('[data-thing^=items-]'), /rowing boat[\s\S]*Vehicle[\s\S]*1 condition/);

  await page.click('.tabs >> text=Characters');
  await page.click('text=New character');
  await page.waitForSelector('dialog[data-panel=character]');
  await type('dialog[data-panel=character] [data-field=name] input', 'Ferry keeper');
  await chooseMedia(page.locator('dialog[data-panel=character] [data-animation=stand_right] .anim-picture-choice'), 'guide.png');
  // The character gets a close-up of its own, cut from the top third of its picture and shown beside it.
  await page.waitForFunction(() => {
    const portrait = document.querySelector('.character-card .anim-preview.portrait img')?.getAttribute('src') ?? '';
    return /^\/media\//.test(portrait) && portrait !== document.querySelector('.character-card .anim-preview.large img')?.getAttribute('src');
  });
  await saved();
  await page.click('dialog[data-panel=character] .panel-close');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });

  const doc = await draft();
  const boat = doc.items![0]!;
  assert.deepEqual([boat.name, boat.vehicle, boat.speed_multiplier, boat.conditions?.length], ['rowing boat', true, 1.4, 1]);
  assert.equal(boat.conditions![0]!.variable, 'has_ticket');
  assert.equal(doc.characters![0]!.name, 'Ferry keeper');
  assert.ok(doc.avatars!.length > 0 && doc.avatars!.every((a) => a.id >= 900000 && a.platform), 'the avatars in a preview are the platform\'s, not characters of this scenario');
  const keeper = doc.characters![0]!;
  assert.deepEqual([keeper.animations?.stand_right?.media_id === doc.assets!.find((m) => m.filename === 'guide.png')!.id, !!keeper.animations?.portrait, keeper.media_id], [true, true, undefined], 'it is drawn from its animations');
});

test('layers: a repeated, drifting sky behind and a foreground in front', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  sceneId = Number(/scene\/(\d+)/.exec(page.url())![1]);

  await page.click('[title="Add: background layers"]');
  await chooseMedia(inspector('[data-field=media_id]'), 'sky.png');
  await inspector('[data-field=tile] input').check();
  await type('.inspector [data-field=scroll_speed_x] input[type=number]', '-12');
  await type('.inspector [data-field=parallax] input[type=number]', '0.4');
  await page.waitForSelector('.stage .layer.tiled');

  await page.click('[title="Add: foreground layers"]');
  await chooseMedia(inspector('[data-field=media_id]'), 'boat.png');
  await type('.inspector [data-field=position_y] input', '900');
  await type('.inspector [data-field=display_height] input', '180');

  let scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.background_media, [{ media_id: scene.background_media![0]!.id ?? (scene.background_media![0] as { media_id: number }).media_id, tile: true, scroll_speed_x: -12, parallax: 0.4 }]);
  assert.deepEqual((scene.foreground_media![0] as { position_y: number; display_height: number }).display_height, 180);

  await page.click('text=Delete layer');
  scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.foreground_media, []);
});

test('layers: drag a background layer to the top and it becomes the main picture', async () => {
  const media = (l: unknown) => (l as { media_id?: number; id?: number }).media_id ?? (l as { id?: number }).id;
  const sky = media((await draft()).scenes[0]!.background_media![0]);

  await page.click('[title="Add: background layers"]');
  await chooseMedia(inspector('[data-field=media_id]'), 'guide.png');
  await saved();
  const rows = '[data-section="Background layers"] li.layer-row';
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, rows);
  assert.match(await page.innerText(`${rows} >> nth=0`), /main picture/);
  const before = (await draft()).scenes[0]!.background_media!.map(media);
  const guide = before[1];
  assert.equal(before.length, 2);
  assert.equal(before[0], sky);
  assert.notEqual(guide, sky);

  // Drag the second layer (selected, as it was just added) onto the top half of the first.
  await page.locator(`${rows} >> nth=1 >> .grip`).dragTo(page.locator(`${rows} >> nth=0`), { targetPosition: { x: 40, y: 2 } });
  await page.waitForFunction((sel) => /guide/.test(document.querySelector(sel)?.textContent ?? ''), `${rows}:first-child`);
  let scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.background_media!.map(media), [guide, sky], 'guide.png is now drawn first');
  assert.match(await page.innerText(`${rows} >> nth=0`), /guide\.png[\s\S]*main picture/);
  assert.match(await page.innerText(`${rows} >> nth=0 >> .outline-item`), /guide/, 'the moved layer is still the one selected');
  assert.ok(await page.locator(`${rows} >> nth=0 >> .outline-item.selected`).count(), 'its row is still selected');

  // And back below, then remove it so the rest of the file sees one background.
  await page.locator(`${rows} >> nth=0 >> .grip`).dragTo(page.locator(`${rows} >> nth=1`), { targetPosition: { x: 40, y: 18 } });
  await page.waitForFunction((sel) => /sky/.test(document.querySelector(sel)?.textContent ?? ''), `${rows}:first-child`);
  scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.background_media!.map(media), [sky, guide]);
  await page.click(`${rows} >> nth=1 >> .outline-item`);
  await page.click('text=Delete layer');
  scene = (await draft()).scenes[0]!;
  assert.deepEqual(scene.background_media!.map(media), [sky]);
});

test('layers: tick a background layer as the main picture, for the scene in lists', async () => {
  const media = (l: unknown) => (l as { media_id?: number; id?: number }).media_id ?? (l as { id?: number }).id;
  const rows = '[data-section="Background layers"] li.layer-row';
  await page.click('[title="Add: background layers"]');
  await chooseMedia(inspector('[data-field=media_id]'), 'guide.png');
  await saved();
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, rows);
  const mains = () => draft().then((d) => d.scenes[0]!.background_media!.map((l) => (l as { main?: boolean }).main === true));

  // The new (second) layer is selected: tick it.
  await inspector('[data-field=main] input').check();
  await saved();
  await page.waitForFunction((sel) => /main picture/.test(document.querySelectorAll(sel)[1]?.textContent ?? ''), rows);
  assert.deepEqual(await mains(), [false, true], 'the second layer is marked main in the JSON');
  assert.doesNotMatch(await page.innerText(`${rows} >> nth=0`), /main picture/, 'and the first no longer says so');

  // The first layer: ticking it moves the mark, so only one layer is ever main.
  await page.click(`${rows} >> nth=0 >> .outline-item`);
  assert.equal(await inspector('[data-field=main] input').isChecked(), false);
  await inspector('[data-field=main] input').check();
  await saved();
  assert.deepEqual(await mains(), [true, false]);

  // Unticking leaves none marked: the first is the main picture again, and its box can't be unticked.
  // (A click, not uncheck(): the box shows ticked again at once, as the first layer is now main by default.)
  await inspector('[data-field=main] input').click();
  await saved();
  assert.deepEqual(await mains(), [false, false]);
  assert.equal(await inspector('[data-field=main] input').isChecked(), true);
  assert.equal(await inspector('[data-field=main] input').isDisabled(), true);
  assert.match(await page.innerText(`${rows} >> nth=0`), /main picture/);

  // Tidy up: remove the added layer, so the rest of the file sees one background.
  await page.click(`${rows} >> nth=1 >> .outline-item`);
  await page.click('text=Delete layer');
  assert.equal((await draft()).scenes[0]!.background_media!.map(media).length, 1);
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
  await type('.inspector [data-field=scale_top] input[type=number]', '40');
  await type('.inspector [data-field=height] input', '300');
  await dragBy('.stage-overlay rect.handle >> nth=1', 0, 20); // the bottom-right corner
  let scene = (await draft()).scenes[0]!;
  const area = scene.scale_areas![0]!;
  assert.deepEqual([area.scale_top, area.scale_bottom, area.x], [40, 100, 0]);
  assert.ok(area.height > 300, 'dragging the corner made the box taller');

  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.startsWith('Hotspot'));
  await type('.inspector [data-field=reveal_radius] input[type=number]', '500');
  await type('.inspector [data-field=reveal_full_radius] input[type=number]', '200');
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
  await type('.inspector [data-field=speed_effect] input[type=number]', '60');
  assert.equal((await draft()).scenes[0]!.scale_areas![0]!.speed_effect, 60);
  await page.click('.outline-item >> text=Hotspot');
  await inspector('.add-action').selectOption('freeze');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 2);
  assert.match(await page.innerText('details.action:nth-of-type(2) summary'), /Stop the player from moving/);
  assert.deepEqual((await draft()).scenes[0]!.hotspots!.at(-1)!.actions.map((a) => a.type), ['avatar', 'freeze']);
  await inspector('.add-action').selectOption('dialogue');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 3);
  await inspector('details.action:nth-of-type(3) [data-field=speaker] select').selectOption('character');
  await inspector('details.action:nth-of-type(3) [data-field=character_id] select').selectOption({ label: 'Ferry keeper' });
  await type('.inspector details.action:nth-of-type(3) [data-field=text] textarea', 'Mind the gap.');
  assert.match(await page.innerText('details.action:nth-of-type(3) summary'), /Ferry keeper says: Mind the gap\./);
  const said = (await draft()).scenes[0]!.hotspots!.at(-1)!.actions.at(-1) as { type: string; text: string; speaker: string; character_id: number };
  assert.deepEqual([said.type, said.text, said.speaker, said.character_id], ['dialogue', 'Mind the gap.', 'character', (await draft()).characters![0]!.id]);
  await page.click('.outline-item >> text=depth');
  await page.click('.inspector >> text=Delete');
  assert.deepEqual((await draft()).scenes[0]!.scale_areas, []);
});

test('overlapping things: a press goes to the smallest one under the pointer', async () => {
  // A small hotspot, then a bigger one drawn over it at the same spot (both start at the middle).
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await type('[data-field=shortname] input', 'small-spot');
  await type('[data-field=radius] input[type=number]', '30');
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForFunction(() => !document.querySelector('.outline-item.selected')?.textContent?.includes('small-spot'));
  await type('[data-field=shortname] input', 'big-spot');
  await type('[data-field=radius] input[type=number]', '120');

  const selected = () => page.evaluate(() => document.querySelector('.outline-item.selected')?.textContent ?? '');
  const circle = async (r: number) => (await page.locator(`.stage-overlay circle.hotspot[r="${r}"]`).boundingBox())!;
  const small = await circle(30);
  const big = await circle(120);

  // The big one is on top, but the middle of the small one selects the small one.
  await page.mouse.click(small.x + small.width / 2, small.y + small.height / 2);
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.includes('small-spot'));
  // Inside the big one but outside everything smaller selects the big one.
  await page.mouse.click(big.x + big.width / 2, big.y + big.height * 0.1);
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.includes('big-spot'));
  const spot = async (name: string) => (await draft()).scenes[0]!.hotspots!.find((h) => h.shortname === name)!;
  // With the big one selected, dragging from over the small one moves the big one (the selected
  // thing can be dragged from anywhere on it); the small one stays where it is.
  const [bigBefore, smallBefore] = [await spot('big-spot'), await spot('small-spot')];
  await dragBy('.stage-overlay circle.hotspot[r="30"]', 40, 0);
  assert.match(await selected(), /big-spot/);
  assert.ok(Number((await spot('big-spot')).position_x) > Number(bigBefore.position_x) + 20, 'the selected big hotspot moved');
  assert.equal((await spot('small-spot')).position_x, smallBefore.position_x);
  // Once the small one is selected, dragging it moves it out from under the big one.
  const moved = await circle(30);
  await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.includes('small-spot'));
  await dragBy('.stage-overlay circle.hotspot[r="30"]', 0, 40);
  assert.match(await selected(), /small-spot/);
  assert.ok(Number((await spot('small-spot')).position_y) > Number(smallBefore.position_y) + 20, 'the small hotspot moved');
});

test('media sub-tabs, scenario music and scene music', async () => {
  await page.click('.tabs >> text=Media');
  await page.waitForSelector('.subtabs');
  const tab = (key: string) => page.locator(`.subtabs [data-tab=${key}]`);
  // The counts settle once anything still being saved has come back.
  await saved();
  await page.waitForFunction(() => /Vehicles\s*1/.test(document.querySelector('.subtabs [data-tab=vehicle]')?.textContent ?? ''), null, { timeout: 5000 }).catch(async (err) => { console.log('The vehicle count was wrong. What the page showed, then what is saved:', await page.evaluate(() => [...document.querySelectorAll('.subtabs button')].map((b) => b.textContent).join(' ') + ' || ' + [...document.querySelectorAll('[data-media]')].map((c) => c.getAttribute('data-media') + ':' + c.querySelector('strong')?.textContent).join(',') + ' || ' + document.querySelector('.toasts')?.textContent), JSON.stringify(await draft().then((d) => [d.items, d.avatar_media_ids, d.avatar_portraits, d.characters]))); throw err; });
  assert.match(await tab('background').innerText(), /Backgrounds\s*1/, 'sky.png is a scene layer');
  assert.match(await tab('vehicle').innerText(), /Vehicles\s*1/, 'boat.png belongs to a vehicle');
  assert.match(await tab('character').innerText(), /NPCs\s*2/, 'guide.png is a character, and so is the close-up that was cut from it');
  assert.equal(await tab('avatar').count(), 0, 'there is no avatars tab: avatars are not a scenario\'s');
  // Sprites is a view across the other tabs: every sheet and animated PNG, whatever else it is used for.
  const spriteBadge = Number((await tab('sprites').innerText()).match(/Sprites\s*(\d+)/)![1]);
  await tab('sprites').click();
  assert.equal(await page.locator('[data-media]').count(), spriteBadge, 'the Sprites badge counts the cards in it');
  assert.equal(await page.locator('[data-media]:not(:has(.chip.anim))').count(), 0, 'each sprite is a sheet or an animated PNG');
  await tab('vehicle').click();
  assert.equal(await page.locator('[data-media]').count(), 1);
  await tab('audio').click();
  await page.setInputFiles('.page input[type=file]', [{ name: 'theme.wav', mimeType: 'audio/wav', buffer: wav() }, { name: 'cave.wav', mimeType: 'audio/wav', buffer: wav() }]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 2);

  await page.click('.tabs >> text=Settings');
  await chooseSound(page.locator('[data-field=music_media_id]'), 'theme.wav');
  await type('[data-field=music_volume] input[type=number]', '0.4');
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await chooseSound(inspector('[data-field=music_media_id]'), 'cave.wav');
  const doc = await draft();
  const id = (name: string) => doc.assets!.find((m) => m.filename === name)!.id;
  assert.deepEqual([doc.music_media_id, doc.music_volume, doc.scenes[0]!.music_media_id], [id('theme.wav'), 0.4, id('cave.wav')]);
});

test('objectives and settings', async () => {
  await page.click('.tabs >> text=Objectives');
  await page.click('text=New objective');
  const objective = 'dialog[data-panel=objective]';
  await page.waitForSelector(objective);
  await type(`${objective} [data-field=text] input`, 'Buy a ticket');
  await page.locator(`${objective} .conditions`).nth(1).locator('text=+ Add condition').click();
  await page.waitForSelector(`${objective} .condition`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  assert.match(await page.innerText('[data-objective=objective-1]'), /Buy a ticket[\s\S]*Ticked off when\s*has_ticket = 1/);

  await page.click('.tabs >> text=Settings');
  await type('[data-field=title] input', 'Tools and more');
  await page.locator('[data-field=chat_mode] select').selectOption('off');
  await type('[data-field=move_speed] input[type=number]', '300');

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
  await page.click('.subtabs [data-tab=all]');
  await page.locator('[data-media]', { has: page.locator('.card-title', { hasText: 'boat.png' }) }).locator('.media-delete').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 5);
  const doc = await draft();
  // Not counting the platform's avatars, which every scenario is served with.
  assert.equal(doc.assets!.filter((m) => m.id < 800000).length, 5);
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

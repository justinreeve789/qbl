import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * The Scenes page's map: switching to it, laying scenes out, linking them by dragging, making a
 * scene by dropping a link on empty space, changing and removing a way, and opening a scene from
 * the map. Each change is checked in the scenario JSON the editor produces.
 *
 * Set QBL_SHOTS to a folder to keep screenshots of the map along the way.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const prompts: string[] = [];
const confirms: boolean[] = [];
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(prompts.shift() ?? '') : confirms.length && !confirms.shift() ? d.dismiss() : d.accept()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Map');
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
async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
/** The scenario JSON as the game would get it now. */
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const scene = (s: Scenario, name: string) => s.scenes.find((sc) => sc.shortname === name)!;
const hotspots = (s: Scenario, name: string) => scene(s, name).hotspots ?? [];
const jumps = (s: Scenario, name: string) => hotspots(s, name).flatMap((h) => h.actions.filter((a) => a.type === 'jump').map((a) => ({ hotspot: h.shortname, to: (a as { scene_id: number }).scene_id, spawn: (a as { spawn_point?: string }).spawn_point })));
const box = (name: string) => page.locator('.map-node', { has: page.locator('.map-node-name', { hasText: new RegExp(`^${name}$`) }) });
async function centre(selector: ReturnType<Page['locator']>) {
  const b = (await selector.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** Select the arrow from one scene to another, as clicking it does. */
async function selectLink(from: number, to: number) {
  await page.locator(`.map-link[data-from="${from}"][data-to="${to}"]`).dispatchEvent('click');
  await page.waitForSelector('.map-panel .map-exit');
}
/** Press at one point, move to another in steps, let go. Messages at the bottom of the screen go first. */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 10000 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await saved();
}

test('the Scenes page switches between cards and the map, and remembers which', async () => {
  await page.click('.view-switch [data-layout=map]');
  await page.waitForSelector('.map-node');
  assert.equal(await page.locator('.scene-card').count(), 0);
  assert.equal(await page.locator('.map-node').count(), 1);
  assert.equal(await page.locator('.map-node.start').count(), 1, 'the start scene is marked');
  await page.reload();
  await page.waitForSelector('.map-node');
  assert.equal(await page.getAttribute('.view-switch [data-layout=map]', 'aria-pressed'), 'true');
});

test('New scene adds a box, placed where it does not cover another', async () => {
  prompts.push('forest');
  await page.click('.map-toolbar button:has-text("New scene")');
  await box('forest').waitFor();
  assert.equal(await page.locator('.map-node').count(), 2);
  const a = (await page.locator('.map-node').first().boundingBox())!;
  const b = (await box('forest').boundingBox())!;
  assert.ok(Math.abs(a.x - b.x) >= a.width || Math.abs(a.y - b.y) >= a.height, 'the boxes do not overlap');
  // The new scene is not reachable yet, and the map says so.
  assert.equal(await box('forest').locator('.map-flag.warn').count(), 1);
});

test('dragging a box moves it, and its place is saved with the scenario', async () => {
  const start = (await page.locator('.map-node').first().locator('.map-node-name').textContent())!;
  const from = await centre(box(start));
  // Put the start scene well to the left of the forest, so that a link between them runs left to right.
  const forest = await centre(box('forest'));
  await drag(from, { x: forest.x - 320, y: forest.y + 10 });
  const s = await draft();
  const placed = scene(s, start).params as { editor_map?: { x: number; y: number } } | undefined;
  assert.ok(placed?.editor_map, 'the scene keeps its place on the map in its params');
  assert.ok(placed.editor_map.x % 20 === 0 && placed.editor_map.y % 20 === 0, 'boxes snap to the grid');
  assert.ok((scene(s, 'forest').params as { editor_map?: unknown } | undefined)?.editor_map, 'the other scene is pinned where it was drawn');
  await page.reload();
  await page.waitForSelector('.map-node');
  const after = (await box(start).boundingBox())!;
  const forestAfter = (await box('forest').boundingBox())!;
  assert.ok(after.x < forestAfter.x - after.width, 'still to the left after a reload');
});

test('dragging the + of one box onto another links them both ways, on the edges that face each other', async () => {
  const start = (await page.locator('.map-node.start .map-node-name').textContent())!;
  await drag(await centre(box(start).locator('.map-port')), await centre(box('forest')));
  await page.waitForSelector('.map-link');
  assert.equal(await page.locator('.map-link').count(), 2);
  const s = await draft();
  const forestId = scene(s, 'forest').id;
  const startId = scene(s, start).id;
  // New scenes have one spawn point, so players arrive there.
  assert.deepEqual(jumps(s, start), [{ hotspot: 'edge-right', to: forestId, spawn: 'default' }]);
  assert.deepEqual(jumps(s, 'forest'), [{ hotspot: 'edge-left', to: startId, spawn: 'default' }]);
  const exit = hotspots(s, start)[0]!;
  assert.equal(exit.activate_by_trigger, false, 'a walk-in exit');
  assert.equal(exit.position_y ?? null, null, 'a band down the edge');
  // The forest can be reached now.
  assert.equal(await box('forest').locator('.map-flag.warn').count(), 0);
  // Linking them again changes nothing.
  await drag(await centre(box(start).locator('.map-port')), await centre(box('forest')));
  assert.equal(jumps(await draft(), start).length, 1);
  await shot('map-linked');
});

test('dropping a link on empty space makes a new scene there, linked to the first', async () => {
  const port = await centre(box('forest').locator('.map-port'));
  prompts.push('cave');
  await drag(port, { x: port.x + 60, y: port.y + 260 });
  await box('cave').waitFor();
  const s = await draft();
  // The cave is below the forest on the map, so the way there is the forest's bottom edge.
  assert.deepEqual(jumps(s, 'forest').map((j) => j.hotspot).sort(), ['edge-bottom', 'edge-left']);
  assert.deepEqual(jumps(s, 'cave').map((j) => [j.hotspot, j.to]), [['edge-top', scene(s, 'forest').id]]);
  const caveBox = (await box('cave').boundingBox())!;
  const forestBox = (await box('forest').boundingBox())!;
  assert.ok(caveBox.y > forestBox.y + forestBox.height, 'the new box is where the link was dropped');
});

test('with "Link both ways" off, a link goes one way only', async () => {
  await page.uncheck('.map-two-way input');
  await page.click('.map-toolbar button:has-text("Fit")');
  const start = (await page.locator('.map-node.start .map-node-name').textContent())!;
  await drag(await centre(box('cave').locator('.map-port')), await centre(box(start)));
  const s = await draft();
  assert.equal(jumps(s, 'cave').length, 2);
  assert.equal(jumps(s, start).length, 1, 'no way back was made');
  await page.check('.map-two-way input');
});

test('selecting an arrow shows its exits, which can be changed, given a way back and removed', async () => {
  await page.click('.map-viewport', { position: { x: 5, y: 5 } }); // nothing selected
  const start = (await page.locator('.map-node.start .map-node-name').textContent())!;
  const s0 = await draft();
  const caveId = scene(s0, 'cave').id;
  const startId = scene(s0, start).id;
  await selectLink(caveId, startId);
  await page.waitForSelector('.map-panel .map-exit');
  assert.match((await page.locator('.map-panel h2').textContent())!, /cave → /);
  await shot('map-link-selected');

  // The cave leads to the start scene, but not back: the panel offers to make the way back.
  await page.click('.map-panel button:has-text("Add the way back")');
  await saved();
  assert.equal(jumps(await draft(), start).length, 2, 'the way back was added');

  // Remove the cave's way to the start: the hotspot did nothing else, so it goes too.
  await selectLink(caveId, startId);
  const before = hotspots(await draft(), 'cave').length;
  confirms.push(true);
  await page.click('.map-panel .map-exit button:has-text("Remove")');
  await page.waitForFunction(([from, to]) => !document.querySelector(`.map-link[data-from="${from}"][data-to="${to}"]`), [caveId, startId]);
  const s = await draft();
  assert.equal(hotspots(s, 'cave').length, before - 1);
  assert.ok(!jumps(s, 'cave').some((j) => j.to === startId));
});

test('changing where an exit goes, from the panel', async () => {
  const s0 = await draft();
  const forestId = scene(s0, 'forest').id;
  const caveId = scene(s0, 'cave').id;
  await selectLink(forestId, caveId);
  const start = s0.scenes.find((sc) => sc.id === s0.start_scene_id)!;
  await page.selectOption('.map-panel select[aria-label="Goes to"]', String(start.id));
  await saved();
  const s = await draft();
  assert.deepEqual(jumps(s, 'forest').map((j) => j.to).sort(), [start.id, start.id].sort());
  // Put it back, for the tests after this one.
  await selectLink(forestId, start.id);
  const bottom = page.locator('.map-panel .map-exit', { hasText: 'bottom edge' });
  await bottom.locator('select[aria-label="Goes to"]').selectOption(String(caveId));
  await saved();
});

test('a scene opens in the scene editor from its pencil, and the Scenes tab comes back to the map', async () => {
  await box('forest').locator('.map-edit').click();
  await page.waitForSelector('.scene-editor');
  assert.match(page.url(), /\/scene\/\d+$/);
  await page.click('.tabs [data-tab=scenes]');
  await page.waitForSelector('.map-node');
});

test('"Open in the scene" opens the scene editor with that exit selected', async () => {
  const s0 = await draft();
  const forestId = scene(s0, 'forest').id;
  const caveId = scene(s0, 'cave').id;
  await selectLink(forestId, caveId);
  await page.click('.map-panel .map-exit button:has-text("Open in the scene")');
  await page.waitForSelector('.scene-editor');
  await page.waitForFunction(() => document.querySelector('.outline-item.selected')?.textContent?.includes('edge-bottom'));
  await page.click('.tabs [data-tab=scenes]');
  await page.waitForSelector('.map-node');
});

test('Arrange for me lays the map out from the start scene', async () => {
  confirms.push(true);
  await page.click('.map-toolbar button:has-text("Arrange for me")');
  await saved();
  const s = await draft();
  const at = (name: string) => (scene(s, name).params as { editor_map: { x: number; y: number } }).editor_map;
  const start = s.scenes.find((sc) => sc.id === s.start_scene_id)!.shortname!;
  // The forest is through the start scene's right edge, so it is to the right of it. The cave is
  // through the start scene's bottom edge (the way back made above), so it is under it.
  assert.deepEqual(jumps(s, start).map((j) => j.hotspot).sort(), ['edge-bottom', 'edge-right']);
  assert.ok(at('forest').x > at(start).x);
  assert.equal(at('forest').y, at(start).y);
  assert.ok(at('cave').y > at(start).y);
  assert.equal(at('cave').x, at(start).x);
  await shot('map-arranged');
});

test('the cards still work, and nothing went wrong in the page', async () => {
  await page.click('.view-switch [data-layout=cards]');
  await page.waitForSelector('.scene-card');
  assert.equal(await page.locator('.scene-card').count(), 3);
  assert.deepEqual(errors, []);
});

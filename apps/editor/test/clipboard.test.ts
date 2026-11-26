import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * Delete, Ctrl+C, Ctrl+X and Ctrl+V in the scene editor (hotspots, areas, actions ticked in an
 * event) and on the scene map (a scene: duplicated), and the Duplicate scene buttons.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let scenarioId = 0;
let sceneId = 0;
const errors: string[] = [];

type Row = Record<string, unknown> & { id: number };
interface Bundle {
  scenes: Row[];
  events: Row[];
  actions: Row[];
  conditions: Row[];
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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Copy me');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  scenarioId = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  sceneId = Number(/scene\/(\d+)/.exec(page.url())![1]);
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
/** Press keys with nothing focused, as after clicking the stage. */
async function press(keys: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(keys);
}
const until = async (check: (b: Bundle) => boolean, what: string) => {
  for (let i = 0; i < 50; i++) {
    await idle();
    if (check(await bundle())) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`timed out waiting for ${what}`);
};
const hotspots = (b: Bundle) => b.events.filter((e) => e.kind === 'hotspot' && e.scene_id === sceneId);
const actionsOf = (b: Bundle, eventId: number) => b.actions.filter((a) => a.event_id === eventId).sort((x, y) => Number(x.sequence) - Number(y.sequence));
const pick = (name: string) => page.locator('.outline-item', { hasText: name }).first();
async function addAction(type: string) {
  const count = await page.locator('.inspector details.action').count();
  await page.locator('.inspector .add-action').dispatchEvent('pointerdown');
  await page.locator('.inspector .add-action').selectOption(type);
  await page.waitForFunction((n) => document.querySelectorAll('.inspector details.action').length === n, count + 1);
}

test('a hotspot is copied and pasted beside itself, with its actions; Delete deletes it and Ctrl+Z brings it back', async () => {
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector [data-field=shortname] input').first().fill('door');
  await page.locator('.inspector [data-field=shortname] input').first().blur();
  await addAction('wait');
  await addAction('dialogue');
  await idle();
  const original = hotspots(await bundle())[0]!;

  await press('Control+c');
  await page.waitForSelector('.toast:has-text("Copied the hotspot")');
  await press('Control+v');
  await until((b) => hotspots(b).length === 2, 'the pasted hotspot');
  const b = await bundle();
  const copy = hotspots(b).find((e) => e.id !== original.id)!;
  assert.equal(copy.shortname, 'door-2', 'the copy gets a name of its own');
  assert.deepEqual([copy.position_x, copy.position_y], [Number(original.position_x) + 40, Number(original.position_y) + 40], 'and is moved a little');
  assert.deepEqual(actionsOf(b, copy.id).map((a) => a.type), ['wait', 'dialogue'], 'with its actions, in order');
  await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('.inspector [data-field=shortname] input')?.value) === 'door-2');

  await press('Delete');
  await until((x) => hotspots(x).length === 1, 'the copy deleted');
  await page.waitForSelector('.toast:has-text("Deleted the hotspot")');
  await press('Control+z');
  await until((x) => hotspots(x).length === 2 && actionsOf(x, copy.id).length === 2, 'the copy back');
  await press('Control+y');
  await until((x) => hotspots(x).length === 1, 'the copy deleted again');
});

test('actions ticked in one event are cut and pasted into another (moved, keeping their ids), then pasted again as copies', async () => {
  await pick('door').click();
  await page.waitForSelector('.event-panel');
  const door = hotspots(await bundle())[0]!;
  const ids = actionsOf(await bundle(), door.id).map((a) => a.id);

  // Ticking a box in a card's heading does not open the card.
  const first = page.locator('.inspector details.action').first();
  await first.locator('input.pick').click();
  assert.equal(await first.getAttribute('open'), null);
  await page.locator('.inspector details.action').nth(1).locator('input.pick').click({ modifiers: ['Shift'] });
  await page.waitForSelector('.action-bar:has-text("2 ticked")');

  await press('Control+x');
  await until((b) => actionsOf(b, door.id).length === 0, 'the actions cut');

  await page.selectOption('.add-menu', 'indirect');
  await until((b) => b.events.some((e) => e.kind === 'indirect'), 'an indirect event');
  const indirect = (await bundle()).events.find((e) => e.kind === 'indirect')!;
  await page.waitForSelector('.action-bar [data-act=paste]');
  await press('Control+v');
  await until((b) => actionsOf(b, indirect.id).length === 2, 'the actions pasted');
  assert.deepEqual(actionsOf(await bundle(), indirect.id).map((a) => a.id), ids, 'what was cut is moved: the same actions');

  await page.click('.action-bar [data-act=paste]');
  await until((b) => actionsOf(b, indirect.id).length === 4, 'a second paste');
  const after = actionsOf(await bundle(), indirect.id);
  assert.deepEqual(after.map((a) => a.type), ['wait', 'dialogue', 'wait', 'dialogue']);
  assert.equal(new Set(after.map((a) => a.id)).size, 4, 'pasted again, they are copies');

  // The two pasted last are still ticked: Delete deletes them.
  await page.waitForSelector('.action-bar:has-text("2 ticked")');
  await press('Delete');
  await until((b) => actionsOf(b, indirect.id).length === 2, 'the ticked actions deleted');
});

test('a walkable area is copied and pasted, moved a little', async () => {
  const areas = async () => (((await bundle()).scenes.find((s) => s.id === sceneId)!.layout as { walkable_areas: Array<Array<{ x: number; y: number }>> }).walkable_areas);
  const was = await areas();
  await page.locator('[data-section="Walkable areas"] .outline-item').first().click();
  await page.waitForSelector('.inspector h2:has-text("Walkable area")');
  await press('Control+c');
  await press('Control+v');
  await until((b) => ((b.scenes.find((s) => s.id === sceneId)!.layout as { walkable_areas: unknown[] }).walkable_areas.length === was.length + 1), 'a second area');
  const now = await areas();
  assert.deepEqual(now[now.length - 1], was[0]!.map((p) => ({ x: p.x + 40, y: p.y + 40 })));
  await page.waitForSelector('.inspector h2:has-text("Walkable area")');
  await press('Control+x');
  await until((b) => ((b.scenes.find((s) => s.id === sceneId)!.layout as { walkable_areas: unknown[] }).walkable_areas.length === was.length), 'the copy cut');
});

test('keys typed in a field are the field\'s own', async () => {
  await pick('door').click();
  const field = page.locator('.inspector [data-field=shortname] input').first();
  await field.click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+v');
  await idle();
  assert.equal(hotspots(await bundle()).length, 1, 'nothing was pasted or deleted');
  await field.blur();
});

test('on the scene map, Ctrl+C and Ctrl+V duplicate a scene with everything in it; Delete deletes the copy', async () => {
  // A jump in the scene to itself: in the copy it goes to the copy.
  await pick('door').click();
  await addAction('jump');
  await idle();
  const door = hotspots(await bundle())[0]!;
  const jump = actionsOf(await bundle(), door.id).find((a) => a.type === 'jump')!;
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  await fetch(`${site.url}/api/editor/scenarios/${scenarioId}/rows/actions/${jump.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ params: { scene_id: sceneId } }) });

  // Changed behind the editor's back: loaded again.
  await page.goto(`${site.url}/editor/#/s/${scenarioId}`);
  await page.reload();
  await page.click('.view-switch [data-layout=map]');
  await page.waitForSelector('.map-node');
  await page.locator('.map-node').first().click();
  await page.waitForSelector('.map-node.selected');
  await press('Control+c');
  await press('Control+v');
  await until((b) => b.scenes.length === 2, 'the duplicate');
  await page.waitForFunction(() => document.querySelectorAll('.map-node').length === 2);
  const b = await bundle();
  const copy = b.scenes.find((s) => s.id !== sceneId)!;
  const copied = b.events.filter((e) => e.scene_id === copy.id);
  assert.equal(copied.length, b.events.filter((e) => e.scene_id === sceneId).length, 'with all its events');
  const copiedJump = b.actions.find((a) => a.type === 'jump' && copied.some((e) => e.id === a.event_id))!;
  assert.equal((copiedJump.params as { scene_id: number }).scene_id, copy.id, 'a jump to itself goes to the copy');
  assert.equal((jump.params as { scene_id?: number } | null)?.scene_id ?? sceneId, sceneId);
  assert.ok(String(copy.shortname).endsWith('-copy'));
  await page.waitForSelector(`.map-node.selected[data-scene="${copy.id}"]`);

  await press('Delete');
  await until((x) => x.scenes.length === 1, 'the copy deleted');
  assert.equal((await bundle()).scenes[0]!.id, sceneId, 'the original stays');
});

test('the Duplicate buttons on a scene card and in the scene settings', async () => {
  await page.click('.view-switch [data-layout=cards]');
  await page.waitForSelector('.scene-card');
  await page.click('.scene-card [data-duplicate-scene]');
  await until((b) => b.scenes.length === 2, 'a duplicate from the card');
  await page.goto(`${site.url}/editor/#/s/${scenarioId}/scene/${sceneId}`);
  await page.waitForSelector('.inspector [data-duplicate-scene]');
  await page.click('.inspector [data-duplicate-scene]');
  await until((b) => b.scenes.length === 3, 'a duplicate from the scene settings');
  const names = (await bundle()).scenes.map((s) => s.shortname);
  assert.equal(new Set(names).size, 3, 'each with a name of its own');
  assert.deepEqual(errors, []);
});

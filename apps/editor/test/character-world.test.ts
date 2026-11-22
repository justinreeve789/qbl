import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * Characters live in the world, not in scenes: each starts in one scene (chosen on its panel, or
 * by adding it on the Scenes page), may walk around on its own, and has events of its own, one of
 * which a click runs. Actions of a scene that need a character there (a bubble line, an
 * animation) say on their card when it may be elsewhere, and so does the Publish page.
 * Set QBL_SHOTS to a folder to keep screenshots along the way.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let hall = 0;
let lab = 0;
let robo = 0;
const errors: string[] = [];

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${await res.clone().text()}`);
  return (await res.json()) as T;
}
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
async function draft(): Promise<Scenario> {
  await saved();
  return (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
}
async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
const panel = () => page.locator('dialog[data-panel=character]');
async function openRobo() {
  await page.click('.tabs >> text=Characters');
  await page.locator('.character-card', { has: page.locator('.card-title', { hasText: 'Robo' }) }).locator('[data-open=character]').click();
  await panel().waitFor();
}

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Living world');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  const bundle = await rest<{ scenes: Array<{ id: number }> }>('GET', '');
  hall = bundle.scenes[0]!.id;
  await rest('PATCH', `/rows/scenes/${hall}`, { shortname: 'hall', width: 1200, height: 600, layout: { spawn_points: [{ name: 'default', position_x: 100, position_y: 450 }] } });
  lab = (await rest<{ row: { id: number } }>('POST', '/rows/scenes', { shortname: 'lab', width: 1200, height: 600, layout: { spawn_points: [{ name: 'default', position_x: 600, position_y: 450 }] } })).row.id;
  robo = (await rest<{ row: { id: number } }>('POST', '/rows/characters', { name: 'Robo' })).row.id;
  await page.reload();
  await page.waitForSelector('.tabs');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a character starts in a scene chosen on its panel, and walks around on its own at its speed; there are no routines', async () => {
  await openRobo();
  assert.equal(await panel().locator('[data-fold^=character-routine]').count(), 0, 'no routine anywhere');
  assert.equal(await panel().locator('[data-start]').inputValue(), '', 'in no scene yet');
  await panel().locator('[data-start]').selectOption(String(hall));
  await saved();
  let robot = (await draft()).characters![0]!;
  assert.deepEqual([robot.scene_id, robot.position_x, robot.position_y], [hall, 100, 450], 'put on the hall\'s default spawn point');
  await panel().locator('[data-field=roams] input').check();
  await saved();
  await panel().locator('[data-field=walk_speed] input[type=number]').fill('150');
  await panel().locator('[data-field=walk_speed] input[type=number]').dispatchEvent('change');
  await saved();
  robot = (await draft()).characters![0]!;
  assert.deepEqual([robot.roams, robot.walk_speed], [true, 150]);
  assert.match(await panel().locator('[data-fold^=character-world] > summary').innerText(), /starts in hall, walks around on its own/);
  await shot('character-world');
  await page.keyboard.press('Escape');
  assert.match(await page.locator('.character-card', { hasText: 'Robo' }).innerText(), /📍 hall[\s\S]*Walks around/);
});

test('on the Scenes page it is drawn where it starts; adding it to another scene moves it there', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.locator('.scene-card', { hasText: 'hall' }).locator('text=Edit').click();
  await page.waitForSelector('.scene-editor');
  await page.locator('.outline summary', { hasText: 'Characters who start here' }).click();
  assert.equal(await page.locator('.outline li', { hasText: 'Robo' }).count(), 1);
  assert.equal(await page.locator('.placement.characters').count(), 1, 'drawn on the hall');
  await page.click('.tabs >> text=Scenes');
  await page.locator('.scene-card', { hasText: 'lab' }).locator('text=Edit').click();
  await page.waitForSelector('.scene-editor');
  await page.selectOption('.add-menu', 'character');
  await page.waitForSelector('.inspector [data-character-start]');
  await saved();
  assert.equal((await draft()).characters![0]!.scene_id, lab, 'one place at a time: now it starts in the lab');
  await page.locator('.inspector [data-field=position_x] input').fill('640');
  await page.locator('.inspector [data-field=position_x] input').dispatchEvent('change');
  await saved();
  assert.equal((await draft()).characters![0]!.position_x, 640);
  await shot('scene-character-start');
  // Back to the hall for what follows.
  await rest('PATCH', `/rows/characters/${robo}`, { settings: { ...(await rest<{ characters: Array<{ id: number; settings: Record<string, unknown> }> }>('GET', '')).characters[0]!.settings, scene_id: hall, position_x: 300, position_y: 450 } });
});

test('its own events: one runs when it is clicked, and a scene can run another', async () => {
  await page.reload();
  await openRobo();
  await panel().locator('[data-add=character-event]').click();
  const ev = page.locator('dialog[data-panel=character-event]');
  await ev.waitFor();
  await saved();
  await ev.locator('.add-action').selectOption('dialogue');
  await ev.locator('details.action[open]').waitFor();
  await ev.locator('details.action[open] [data-field=speaker] select').selectOption('character');
  await saved();
  await ev.locator('details.action[open] [data-field=character_id] select').selectOption({ label: 'Robo' });
  await saved();
  await page.keyboard.press('Escape');
  await ev.waitFor({ state: 'detached' });
  const doc = await draft();
  const robot = doc.characters![0]!;
  assert.equal(robot.events!.length, 1);
  assert.equal(robot.event_id, robot.events![0]!.id, 'the first event is what a click runs');
  assert.equal(robot.events![0]!.character_id, robo);
  assert.match(await panel().locator('[data-character-event]').innerText(), /runs when clicked/);
  await page.keyboard.press('Escape');
});

test('an action of a scene that needs a character who may be elsewhere says so on its card', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.locator('.scene-card', { hasText: 'hall' }).locator('text=Edit').click();
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  // Robo walks around on his own: a bubble line from him in the hall may find him gone.
  await page.locator('.inspector .add-action').selectOption('dialogue');
  await page.waitForSelector('.inspector details.action[open]');
  await page.locator('.inspector details.action[open] [data-field=speaker] select').selectOption('character');
  await saved();
  await page.locator('.inspector details.action[open] [data-field=character_id] select').selectOption({ label: 'Robo' });
  await saved();
  const warning = page.locator('.inspector .presence-warning');
  await warning.waitFor();
  assert.match(await warning.innerText(), /Robo walks around on its own, so it may not be in this scene when this runs; its lines are then shown in a story box/);
  assert.equal(await page.locator('.inspector .presence-flag').count(), 1, 'flagged on the card\'s summary too');
  // Running his own event, which has him speak in a bubble, is flagged as well.
  await page.locator('.inspector .add-action').selectOption('run_event');
  await page.locator('.inspector details.action[open] [data-field=target_event_id] select').last().waitFor();
  const events = (await draft()).characters![0]!.events!;
  await page.locator('.inspector details.action[open] [data-field=target_event_id] select').last().selectOption(String(events[0]!.id));
  await saved();
  await page.waitForFunction(() => document.querySelectorAll('.inspector .presence-flag').length === 2);
  assert.match(await page.locator('.inspector .presence-warning').last().innerText(), /This runs Robo’s event “talk”, in which Robo speaks in a bubble/);
  await shot('presence-warning');
});

test('the Publish page lists them, and a problem in a character’s event takes you there', async () => {
  // A walk in his own event with no scene to walk to: the event can run anywhere, so it must say.
  const events = (await draft()).characters![0]!.events!;
  await rest('POST', '/rows/actions', { event_id: events[0]!.id, type: 'walk', params: { character_id: robo, to: 'point', position_x: 10, position_y: 400 } });
  await page.goto(`${site.url}/editor/#/s/${id}/publish`);
  await page.reload();
  await page.waitForSelector('.results .issue');
  const away = page.locator('li.issue', { hasText: 'Robo walks around on its own, so it may not be in this scene' });
  assert.ok(await away.count() >= 1, 'the bubble line is a warning');
  const walk = page.locator('li.issue', { hasText: 'Choose the scene to walk to' });
  await walk.waitFor();
  assert.match(await walk.locator('.issue-where').innerText(), /Character “Robo”[\s\S]*Character’s event “talk”[\s\S]*Action 2/);
  await walk.locator('.issue-go').click();
  await page.waitForSelector('dialog[data-panel=character-event]');
  await page.waitForSelector('dialog[data-panel=character-event] details.action[open] [data-field=scene_id]');
  await shot('publish-character-event');
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

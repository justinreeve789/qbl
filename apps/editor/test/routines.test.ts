import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { normalizeScenario, validateScenario, type Scenario } from '@qbl/shared';
import { Game } from '../../client/test/harness';
import { startSite, type TestSite } from './servers';

/**
 * Characters that walk around on their own: the “Getting around” part of a character's card, its
 * routine of steps, and the walk action in a hotspot. Then the JSON is played, and the character
 * walks from one room to the other through the door.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let hall = 0;
let lab = 0;
let character = 0;
const errors: string[] = [];

const floor = [{ x: 0, y: 250 }, { x: 1200, y: 250 }, { x: 1200, y: 600 }, { x: 0, y: 600 }];

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
/** Robo's pop-up panel, where the character is edited. */
const card = () => page.locator('dialog[data-panel=character]');

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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Robots');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  // Two rooms side by side with a door each way, and Robo standing in the hall.
  const bundle = await rest<{ scenes: Array<{ id: number }> }>('GET', '');
  hall = bundle.scenes[0]!.id;
  lab = (await rest<{ row: { id: number } }>('POST', '/rows/scenes', { shortname: 'lab', width: 1200, height: 600 })).row.id;
  character = (await rest<{ row: { id: number } }>('POST', '/rows/characters', { name: 'Robo' })).row.id;
  await rest('PATCH', `/rows/scenes/${hall}`, {
    shortname: 'hall', width: 1200, height: 600,
    layout: { walkable_areas: [floor], spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }, { name: 'from-lab', position_x: 1100, position_y: 400 }], characters: [{ character_id: character, position_x: 600, position_y: 400 }] },
  });
  await rest('PATCH', `/rows/scenes/${lab}`, {
    layout: { walkable_areas: [floor], spawn_points: [{ name: 'default', position_x: 600, position_y: 400 }, { name: 'from-hall', position_x: 100, position_y: 400 }, { name: 'bench', position_x: 700, position_y: 500 }] },
  });
  const door = async (scene: number, x: number, to: number, spawn: string) => {
    const event = (await rest<{ row: { id: number } }>('POST', '/rows/events', { scene_id: scene, kind: 'hotspot', shortname: `to-${to}`, position_x: x, radius: 40, activate_by_trigger: false })).row;
    await rest('PATCH', `/rows/events/${event.id}`, { position_y: null });
    await rest('POST', '/rows/actions', { event_id: event.id, type: 'jump', params: { scene_id: to, spawn_point: spawn } });
  };
  await door(hall, 1200, lab, 'from-hall');
  await door(lab, 0, hall, 'from-lab');
  await rest('POST', '/rows/variables', { variable_name: 'robo_on', default_value: 1, scope: 'room' });
  await page.reload();
  await page.waitForSelector('.tabs');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a character stands still until it is set to walk around on its own', async () => {
  await page.click('.tabs >> text=Characters');
  await page.locator('.character-card', { has: page.locator('.card-title', { hasText: 'Robo' }) }).locator('[data-open=character]').click();
  await page.waitForSelector('dialog[data-panel=character]');
  await card().locator('[data-fold^=character-routine] > summary').click();
  assert.match(await card().locator('.routine').innerText(), /stands where it is placed/);
  await card().locator('[data-field=roams] input').check();
  await saved();
  await page.waitForSelector('dialog[data-panel=character] .routine-steps');
  assert.match(await card().locator('.routine').innerText(), /Starts in hall, where it is placed/);
  assert.equal((await draft()).characters![0]!.roams, true);
});

test('a routine: walk to the other room and on to the bench, say something, come back', async () => {
  const add = () => card().locator('.routine-steps .add-action');
  await add().selectOption('walk');
  await page.waitForSelector('dialog[data-panel=character] .routine-step[open]');
  const step = (n: number) => card().locator(`.routine-step[data-step="${n}"]`);
  // A spot in the scene first: X and Y; then another scene, which asks for the scene instead.
  assert.equal(await step(0).locator('[data-field=position_x]').count(), 1);
  await step(0).locator('[data-field=to] select').selectOption('scene');
  await saved();
  await page.waitForSelector('dialog[data-panel=character] .routine-step[data-step="0"] [data-field=scene_id]');
  assert.equal(await step(0).locator('[data-field=position_x]').count(), 0, 'X and Y are gone');
  await step(0).locator('[data-field=scene_id] select').selectOption({ label: 'lab' });
  await saved();
  await step(0).locator('[data-field=spawn_point] select').selectOption('bench');
  await saved();

  await add().selectOption('dialogue');
  await saved();
  const say = step(1).locator('[data-field=text] textarea');
  await say.fill('Beep boop, lab reached.');
  await say.blur();
  await saved();
  assert.equal(await step(1).locator('[data-field=speaker]').count(), 0, 'a routine line is always the character’s own');

  await add().selectOption('walk');
  await saved();
  await step(2).locator('[data-field=to] select').selectOption('scene');
  await saved();
  await step(2).locator('[data-field=scene_id] select').selectOption({ label: 'hall' });
  await saved();

  // The line goes first, then back again: the up arrow.
  await step(1).locator('button[aria-label="Move step up"]').click();
  await saved();
  await page.waitForFunction(() => document.querySelector('.routine-step[data-step="0"] .summary-text')?.textContent?.startsWith('Say'));
  await card().locator('.routine-steps >> text=+ Add condition').last().click();
  await saved();

  const robo = (await draft()).characters![0]!;
  assert.deepEqual(robo.routine!.steps.map((s) => s.type), ['dialogue', 'walk', 'walk']);
  assert.deepEqual(robo.routine!.steps[1], { type: 'walk', to: 'scene', scene_id: lab, spawn_point: 'bench' });
  assert.deepEqual(robo.routine!.conditions, [{ variable: 'robo_on', operator: '=', operand: 1 }]);
  assert.match(await card().locator('[data-fold^=character-routine] > summary').innerText(), /a routine of 3 steps/);
  const check = validateScenario(await draft());
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.warnings.filter((w) => w.path.startsWith('characters')), []);
});

test('the walk action: who walks, and where to', async () => {
  // The card says so too, once the panel is closed.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[data-panel=character]'));
  assert.match(await page.innerText('.character-card .chip.roams'), /Routine of 3/);
  await page.click('.tabs >> text=Scenes');
  await page.locator('.scene-card', { hasText: 'hall' }).locator('text=Edit').click();
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector .add-action').selectOption('walk');
  await page.waitForSelector('details.action[open]');
  const action = page.locator('.inspector details.action[open]');
  for (const field of ['target', 'character_id', 'to', 'position_x', 'position_y', 'speed', 'facing']) assert.equal(await action.locator(`[data-field=${field}]`).count(), 1, field);
  await action.locator('[data-field=character_id] select').selectOption({ label: 'Robo' });
  await saved();
  await action.locator('[data-field=to] select').selectOption('spawn');
  await saved();
  await page.waitForSelector('.inspector details.action[open] [data-field=spawn_point]');
  await action.locator('[data-field=spawn_point] select').selectOption('from-lab');
  await saved();
  assert.match(await action.locator('summary').innerText(), /Robo walks to spawn point from-lab/);
  // The player instead: no character to choose.
  await action.locator('[data-field=target] select').selectOption('player');
  await saved();
  await page.waitForFunction(() => !document.querySelector('.inspector details.action[open] [data-field=character_id]'));
  const walk = (await draft()).scenes[0]!.hotspots!.at(-1)!.actions[0]!;
  assert.deepEqual({ ...walk, id: 0, event_id: 0, sequence: 0 }, { id: 0, event_id: 0, sequence: 0, type: 'walk', blocking: true, target: 'player', character_id: character, to: 'spawn', spawn_point: 'from-lab' });
});

test('played: Robo says his line, walks through the door to the lab and on to the bench', async () => {
  const doc = normalizeScenario(await draft());
  const g = new Game(doc);
  await g.wait(100);
  const robo = () => g.ctx.connection.npc(character)!;
  // Robo has no picture in this test, so he is not drawn; the room still says what he is doing.
  assert.match(robo().line, /^\d+:0$/, 'saying the first step of his routine');
  for (let i = 0; i < 600 && robo().scene_id !== lab; i++) await g.wait(16);
  assert.equal(robo().scene_id, lab, 'through the door');
  for (let i = 0; i < 300 && robo().moving; i++) await g.wait(16);
  assert.deepEqual([Math.round(robo().x), Math.round(robo().y)], [700, 500], 'at the bench');
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

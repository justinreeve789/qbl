import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * Choosing where a walk goes by clicking the scene (“📍 Pick on the scene”) instead of typing X
 * and Y: in the scene editor, where the canvas is beside the form, and in a character's routine,
 * where a pop-up shows a scene to click. The walk's destination is then drawn on the canvas as a
 * marker that can be dragged. Set QBL_SHOTS to a folder to keep screenshots along the way.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let hall = 0;
let lab = 0;
let character = 0;
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

/** Screen coordinates of a scene point on a canvas (its SVG overlay), whatever the zoom. */
async function screenAt(overlay: Locator, x: number, y: number) {
  const box = (await overlay.boundingBox())!;
  const [, , W, H] = (await overlay.getAttribute('viewBox'))!.split(' ').map(Number);
  return { x: box.x + (x / W!) * box.width, y: box.y + (y / H!) * box.height };
}
async function clickScene(overlay: Locator, x: number, y: number) {
  const at = await screenAt(overlay, x, y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}
async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
const near = (actual: unknown, expected: number, what: string) => assert.ok(Math.abs(Number(actual) - expected) <= 2, `${what}: ${actual}, expected about ${expected}`);

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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Picking spots');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  const bundle = await rest<{ scenes: Array<{ id: number }> }>('GET', '');
  hall = bundle.scenes[0]!.id;
  lab = (await rest<{ row: { id: number } }>('POST', '/rows/scenes', { shortname: 'lab', width: 1200, height: 600 })).row.id;
  character = (await rest<{ row: { id: number } }>('POST', '/rows/characters', { name: 'Robo' })).row.id;
  await rest('PATCH', `/rows/scenes/${hall}`, {
    shortname: 'hall', width: 1200, height: 600,
    layout: { spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }], characters: [{ character_id: character, position_x: 300, position_y: 400 }] },
  });
  await page.reload();
  await page.waitForSelector('.tabs');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const overlay = () => page.locator('.scene-editor .stage-overlay');
const action = () => page.locator('.inspector details.action[open]');
const pickButton = () => action().locator('.spot-pick');

test('a walk action: click the scene to say where the character walks to', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.locator('.scene-card', { hasText: 'hall' }).locator('text=Edit').click();
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector .add-action').selectOption('walk');
  await page.waitForSelector('details.action[open]');
  await action().locator('[data-field=character_id] select').selectOption({ label: 'Robo' });
  await saved();

  await pickButton().click();
  await page.waitForSelector('.canvas-scroll.picking');
  assert.match(await page.locator('.scene-editor .pick-banner').innerText(), /Click where the walker should go/);
  assert.equal(await pickButton().getAttribute('aria-pressed'), 'true');
  // Crosshairs follow the pointer, with the spot's coordinates.
  const hover = await screenAt(overlay(), 900, 450);
  await page.mouse.move(hover.x, hover.y);
  await page.waitForSelector('.pick-hover');
  await shot('scene-picking');

  await clickScene(overlay(), 900, 450);
  await page.waitForFunction(() => !document.querySelector('.canvas-scroll.picking'));
  near(await action().locator('[data-field=position_x] input').inputValue(), 900, 'X box');
  near(await action().locator('[data-field=position_y] input').inputValue(), 450, 'Y box');
  assert.equal(await pickButton().getAttribute('aria-pressed'), 'false');
  const walk = (await draft()).scenes[0]!.hotspots!.at(-1)!.actions[0]! as unknown as Record<string, number>;
  near(walk.position_x, 900, 'saved X');
  near(walk.position_y, 450, 'saved Y');
  assert.match(await action().locator('summary').innerText(), /Robo walks to/);
});

test('the walk is drawn on the canvas, from the character to its marker, which can be dragged', async () => {
  const marker = page.locator('.action-marker.walk');
  await marker.waitFor();
  assert.match((await marker.textContent()) ?? '', /Robo walks here/);
  assert.equal(await page.locator('.action-route.walk').count(), 1, 'a line from where Robo stands');
  await shot('scene-walk-marker');

  const from = await screenAt(overlay(), 900, 450);
  const to = await screenAt(overlay(), 1000, 500);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await saved();
  near(await action().locator('[data-field=position_x] input').inputValue(), 1000, 'X box after the drag');
  near(await action().locator('[data-field=position_y] input').inputValue(), 500, 'Y box after the drag');
});

test('while picking, a click on a character picks the spot instead of selecting it; Escape stops', async () => {
  await pickButton().click();
  await page.waitForSelector('.canvas-scroll.picking');
  // Robo has no picture here, so he is a placeholder box above his feet at 300,400.
  await clickScene(overlay(), 300, 380);
  await page.waitForFunction(() => !document.querySelector('.canvas-scroll.picking'));
  assert.equal(await page.locator('.inspector .event-panel').count(), 1, 'the hotspot is still the one selected');
  near(await action().locator('[data-field=position_x] input').inputValue(), 300, 'X');
  const placed = (await draft()).scenes[0]!.characters![0]!;
  assert.deepEqual([placed.position_x, placed.position_y], [300, 400], 'Robo did not move');

  await pickButton().click();
  await page.waitForSelector('.canvas-scroll.picking');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.canvas-scroll.picking'));
  assert.equal(await pickButton().innerText(), '📍 Pick on the scene');
  near(await action().locator('[data-field=position_x] input').inputValue(), 300, 'X unchanged');
});

test('a walk step of a routine: pick the spot on a picture of the scene, in a pop-up', async () => {
  await page.click('.tabs >> text=Characters');
  await page.locator('.character-card', { has: page.locator('.card-title', { hasText: 'Robo' }) }).locator('[data-open=character]').click();
  const card = page.locator('dialog[data-panel=character]');
  await card.waitFor();
  await card.locator('[data-fold^=character-routine] > summary').click();
  await card.locator('[data-field=roams] input').check();
  await saved();
  await page.waitForSelector('dialog[data-panel=character] .routine-steps');
  await card.locator('.routine-steps .add-action').selectOption('walk');
  await page.waitForSelector('dialog[data-panel=character] .routine-step[open]');
  const step = card.locator('.routine-step[data-step="0"]');

  await step.locator('.spot-pick').click();
  const popup = page.locator('dialog[data-panel=pick-spot]');
  await popup.waitFor();
  // It opens on the scene Robo starts in; another can be chosen.
  assert.equal(await popup.locator('select[aria-label=Scene]').inputValue(), String(hall));
  await popup.locator('select[aria-label=Scene]').selectOption(String(lab));
  await page.waitForSelector('dialog[data-panel=pick-spot] .canvas-scroll.picking');
  const lay = popup.locator('.stage-overlay');
  await page.waitForFunction(() => (document.querySelector('dialog[data-panel=pick-spot] .stage-overlay')?.getBoundingClientRect().width ?? 0) > 100);
  const hover = await screenAt(lay, 250, 500);
  await page.mouse.move(hover.x, hover.y);
  await shot('routine-popup');
  await clickScene(lay, 250, 500);
  await page.waitForFunction(() => !document.querySelector('dialog[data-panel=pick-spot]'));
  assert.equal(await card.count(), 1, 'the character panel is still open');
  near(await step.locator('[data-field=position_x] input').inputValue(), 250, 'X box');
  near(await step.locator('[data-field=position_y] input').inputValue(), 500, 'Y box');
  const robo = (await draft()).characters![0]!;
  const first = robo.routine!.steps[0] as unknown as Record<string, unknown>;
  assert.equal(first.type, 'walk');
  near(first.position_x, 250, 'saved X');
  near(first.position_y, 500, 'saved Y');

  // Closing the pop-up without a click changes nothing.
  await step.locator('.spot-pick').click();
  await popup.waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[data-panel=pick-spot]'));
  assert.equal(await card.count(), 1, 'Escape closed only the pop-up');
  assert.equal(await step.locator('.spot-pick').innerText(), '📍 Pick on the scene');
  near(await step.locator('[data-field=position_x] input').inputValue(), 250, 'X unchanged');
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { png, startSite, type TestSite } from './servers';

/**
 * The animation field of “Play an animation”: a dropdown of what the chosen character (or item)
 * can play, its own animations first, then the built-in moves; and a box for any other name.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
let robo = 0;
let cart = 0;
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
async function lastAction(): Promise<Record<string, unknown>> {
  await saved();
  const doc = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
  return doc.scenes[0]!.hotspots!.at(-1)!.actions.at(-1)! as unknown as Record<string, unknown>;
}
const action = () => page.locator('.inspector details.action[open]');
const picker = () => action().locator('[data-field=animation] select');
/** The options of the animation dropdown, by group. */
const groups = () => picker().evaluate((s) => Object.fromEntries([...s.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.value || o.textContent)])));

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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Moves');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [
    { name: 'robo.png', mimeType: 'image/png', buffer: png(64, 64, [120, 120, 200]) },
    { name: 'cart.png', mimeType: 'image/png', buffer: png(128, 64, [200, 120, 60]) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length >= 2);
  await saved();
  const bundle = await rest<{ media: Array<{ id: number; filename: string; params: Record<string, unknown> | null }> }>('GET', '');
  const picture = (name: string) => bundle.media.find((m) => m.filename === `${name}.png`)!;

  // Robo has a stand, a beep and a wave of his own; the cart's sheet has a roll.
  robo = (await rest<{ row: { id: number } }>('POST', '/rows/characters', {
    name: 'Robo',
    settings: { animations: { stand_right: { media_id: picture('robo').id }, beep: { media_id: picture('robo').id }, wave: { media_id: picture('robo').id } } },
  })).row.id;
  await rest('PATCH', `/rows/media/${picture('cart').id}`, { params: { ...(picture('cart').params ?? {}), sheet: { columns: 2, rows: 1 }, animations: [{ name: 'roll', frames: [0, 1] }] } });
  cart = (await rest<{ row: { id: number } }>('POST', '/rows/items', { name: 'Cart', media_id: picture('cart').id })).row.id;
  await page.reload();
  await page.waitForSelector('.tabs');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a character’s list holds only the animations defined for it', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.locator('.scene-card').first().locator('text=Edit').click();
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector .add-action').selectOption('animate');
  await page.waitForSelector('.inspector details.action[open]');
  assert.equal(await picker().inputValue(), 'jump', 'a new action jumps');

  // On a character, but which one? Nothing to choose yet.
  await action().locator('[data-field=target] select').selectOption('character');
  await saved();
  await page.waitForFunction(() => (document.querySelector('.inspector details.action[open] [data-field=animation] select') as HTMLSelectElement | null)?.disabled === true);
  assert.equal(await picker().locator('option').first().innerText(), 'Choose a character first');

  await action().locator('[data-field=character_id] select').selectOption({ label: 'Robo' });
  await saved();
  await page.waitForFunction(() => document.querySelector('.inspector details.action[open] [data-field=animation] optgroup')?.getAttribute('label')?.startsWith('Robo'));
  assert.deepEqual(await groups(), { 'Robo’s animations': ['beep', 'wave'] }, 'no poses, no built-in moves he has no frames for');
  assert.equal(await action().locator('[data-field=animation] input').count(), 0, 'nothing to type');
  // The jump it had is not one of Robo’s: his first animation takes its place.
  assert.equal(await picker().inputValue(), 'beep');
  assert.equal((await lastAction()).animation, 'beep');

  await picker().selectOption('wave');
  await saved();
  assert.equal((await lastAction()).animation, 'wave');
  assert.match(await action().locator('summary').innerText(), /wave/);
});

test('a name saved earlier that the character does not have is shown as such', async () => {
  const hotspot = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario.scenes[0]!.hotspots!.at(-1)!;
  const row = hotspot.actions.at(-1)! as unknown as { id: number };
  await rest('PATCH', `/rows/actions/${row.id}`, { params: { target: 'character', character_id: robo, animation: 'happy_dance' } });
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.locator('.outline-item', { hasText: `Hotspot ${(hotspot as unknown as { id: number }).id}` }).click();
  await page.waitForSelector('.event-panel');
  if (!(await action().count())) await page.locator('.inspector details.action').last().locator('summary').click();
  await page.waitForSelector('.inspector details.action[open] [data-field=animation] select');
  assert.equal(await picker().inputValue(), 'happy_dance');
  assert.equal(await picker().locator('option[value=happy_dance]').innerText(), 'happy_dance (not defined)');
  // On to an item, for the next test.
  await action().locator('[data-field=target] select').selectOption('item');
  await saved();
});

test('an item: its sprite sheet’s animations', async () => {
  await action().locator('[data-field=item_id] select').selectOption({ label: 'Cart' });
  await saved();
  await page.waitForFunction(() => document.querySelector('.inspector details.action[open] [data-field=animation] optgroup')?.getAttribute('label')?.startsWith('Cart'));
  assert.deepEqual((await groups())['Cart’s sprite sheet'], ['roll']);
  await picker().selectOption('roll');
  await saved();
  const saved_ = await lastAction();
  assert.equal(saved_.animation, 'roll');
  assert.equal(saved_.item_id, cart);
  // Nothing: stop what is playing.
  await picker().selectOption('');
  await saved();
  assert.equal((await lastAction()).animation ?? null, null);
});

test('a routine step lists the routine’s own character', async () => {
  await page.click('.tabs >> text=Characters');
  await page.locator('.character-card', { has: page.locator('.card-title', { hasText: 'Robo' }) }).locator('[data-open=character]').click();
  const card = page.locator('dialog[data-panel=character]');
  await card.waitFor();
  await card.locator('[data-fold^=character-routine] > summary').click();
  await card.locator('[data-field=roams] input').check();
  await saved();
  await card.locator('.routine-steps .add-action').selectOption('animate');
  await saved();
  const step = card.locator('.routine-step[data-step="0"] [data-field=animation] select');
  await step.waitFor();
  const list = await step.evaluate((s) => Object.fromEntries([...s.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.value)])));
  assert.deepEqual(list, { 'Robo’s animations': ['beep', 'wave'] });
  await step.selectOption('beep');
  await saved();
  const doc = (await rest<{ scenario: Scenario }>('GET', '/preview')).scenario;
  assert.deepEqual(doc.characters!.find((c) => c.id === robo)!.routine!.steps[0], { type: 'animate', animation: 'beep' });
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

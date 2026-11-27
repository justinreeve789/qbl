import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * The action pickers are grouped: talking and storytelling (dialogue, narration, conversation)
 * together, then on-screen boxes, characters, pictures and sound, scenes, timing and rewards.
 * Set QBL_SHOTS to a folder to keep screenshots of the opened picker.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Grouped actions');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}

/** Each group's heading and the action types under it, in order. */
const groupsOf = (selector: string) =>
  page.locator(selector).first().evaluate((select) =>
    [...select.querySelectorAll('optgroup')].map((g) => ({
      group: g.dataset.group,
      label: g.label,
      types: [...g.querySelectorAll('option')].map((o) => o.value),
    })),
  );

test('the add-action picker groups talking, narration included, and every other action', async () => {
  const groups = await groupsOf('.inspector .add-action');
  assert.deepEqual(groups.map((g) => g.group), ['talk', 'text', 'people', 'media', 'scene', 'flow', 'progress']);
  assert.deepEqual(groups[0]!.types, ['dialogue', 'narration', 'conversation']);
  assert.match(groups[0]!.label, /Talking and storytelling/);
  // Every action is offered exactly once, and none sits outside a group.
  const all = groups.flatMap((g) => g.types);
  assert.equal(new Set(all).size, all.length);
  assert.equal(await page.locator('.inspector .add-action > option:not(.type-empty)').count(), 0);
  assert.ok(all.includes('weather') && all.includes('camera') && all.includes('audio'));

  // The browser's own list reads "📜 Narration: The narrator speaks…".
  const text = await page.locator('.inspector .add-action option[value=narration]').evaluate((o) => (o as HTMLOptionElement).text);
  assert.match(text, /^📜 Narration: The narrator speaks/);

  await page.locator('.inspector .add-action').click();
  await page.waitForTimeout(250);
  await shot('add-action-open');
  await page.keyboard.press('Escape');
});

test('choosing narration adds a narration action, and its type picker is grouped too', async () => {
  await page.locator('.inspector .add-action').selectOption('narration');
  const card = page.locator('.inspector details.action[open]').last();
  await card.waitFor();
  assert.match(await card.locator('summary .tag').innerText(), /Narration/);
  const type = card.locator('select.type-picker').first();
  assert.equal(await type.inputValue(), 'narration');
  assert.equal((await groupsOf('.inspector details.action[open] select.type-picker')).length, 7);
  await type.scrollIntoViewIfNeeded();
  await shot('narration-card');
  await type.click();
  await page.waitForTimeout(250);
  await shot('type-picker-open');
  await page.keyboard.press('Escape');

  // Switching type through the grouped picker still works.
  await type.selectOption('dialogue');
  await page.waitForFunction(() => document.querySelector('.inspector details.action summary .tag')?.textContent?.includes('Dialogue'));
});

test('Cancel event sits beside Cancel action and offers the events of this scene', async () => {
  const flow = (await groupsOf('.inspector .add-action')).find((g) => g.group === 'flow')!;
  assert.deepEqual(flow.types, ['wait', 'run_event', 'repeat', 'cancel', 'cancel_event']);
  const text = await page.locator('.inspector .add-action option[value=cancel_event]').evaluate((o) => (o as HTMLOptionElement).text);
  assert.match(text, /^⏹️ Cancel event: Stop an event that is running/);

  await page.locator('.inspector .add-action').selectOption('cancel_event');
  const card = page.locator('.inspector details.action[open]').filter({ has: page.locator('summary .tag', { hasText: 'Cancel event' }) });
  await card.waitFor();
  const pick = card.locator('[data-field=target_event_id] select');
  const options = await pick.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  assert.equal(options.length, 1, 'only the event of this scene (the hotspot being edited)');
  await pick.selectOption(options[0]!);
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector details.action summary')].some((s) => /Stop /.test(s.textContent ?? '')));
  await card.scrollIntoViewIfNeeded();
  await shot('cancel-event-card');
});

test('Go to the launched mission sits with the jumps, and needs nothing filled in', async () => {
  const group = (await groupsOf('.inspector .add-action')).find((g) => g.group === 'scene')!;
  assert.deepEqual(group.types, ['jump', 'travel', 'open_url', 'camera', 'shake', 'weather', 'bench']);
  const text = await page.locator('.inspector .add-action option[value=travel]').evaluate((o) => (o as HTMLOptionElement).text);
  assert.match(text, /^🚀 Go to the launched mission: Leave for the mission the teacher launched/);
  await page.locator('.inspector .add-action').selectOption('travel');
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector details.action summary')].some((s) => /Go to the mission the teacher launched/.test(s.textContent ?? '')));
});

test('Shake asks how shaky and who feels it, and its card says so', async () => {
  const text = await page.locator('.inspector .add-action option[value=shake]').evaluate((o) => (o as HTMLOptionElement).text);
  assert.match(text, /^📳 Shake: Shake the screen/);
  await page.locator('.inspector .add-action').selectOption('shake');
  const card = page.locator('.inspector details.action[open]').last();
  await card.locator('[data-field=intensity] input[type=number]').first().waitFor();
  assert.equal(await card.locator('[data-field=intensity] input[type=number]').first().inputValue(), '3', 'a gentle shake to start with');
  assert.equal(await card.locator('[data-field=duration] input').inputValue(), '500');
  const who = card.locator('[data-field=audience] select');
  assert.deepEqual(await who.locator('option').allTextContents(), ['As the event’s “Who sees it”', 'Only the player whose event it is', 'Everyone in the scene']);
  await who.selectOption('scene');
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector details.action summary')].some((s) => /The screen shakes \(3\/10\) for 0\.5s for everyone in the scene/.test(s.textContent ?? '')));
  await card.scrollIntoViewIfNeeded();
  await shot('shake-card');
});

test('Open URL takes an address with variables, and opens it in a new tab unless told otherwise', async () => {
  const text = await page.locator('.inspector .add-action option[value=open_url]').evaluate((o) => (o as HTMLOptionElement).text);
  assert.match(text, /^🔗 Open URL: Open a web address/);
  await page.locator('.inspector .add-action').selectOption('open_url');
  const card = page.locator('.inspector details.action[open]').last();
  const tab = card.locator('[data-field=new_tab] input[type=checkbox]');
  assert.equal(await tab.isChecked(), true, 'open in new tab is ticked to start with');
  const url = card.locator('[data-field=url] input');
  await url.fill('https://example.org');
  await url.press('Tab');
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector details.action summary')].some((s) => /Open https:\/\/example\.org in a new tab/.test(s.textContent ?? '')));
  // The launched scenario on its own: unticked, and it can't be ticked until the address changes.
  await url.fill('{{QL_SCENARIO_LAUNCH_URL}}');
  await url.press('Tab');
  await page.waitForFunction(() => (document.querySelector('.inspector details.action[open]:last-of-type [data-field=new_tab] input') as HTMLInputElement | null)?.disabled === true);
  assert.equal(await tab.isChecked(), false, 'unticked automatically');
  assert.equal(await tab.isDisabled(), true, 'and cannot be ticked');
  await card.locator('[data-field=new_tab]').scrollIntoViewIfNeeded();
  await shot('open-url-locked');
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector details.action summary')].some((s) => /Open the launched scenario$/.test((s.textContent ?? '').trim())));
  await url.fill('{{QL_SCENARIO_LAUNCH_URL}}&from=hub');
  await url.press('Tab');
  await page.waitForFunction(() => (document.querySelector('.inspector details.action[open]:last-of-type [data-field=new_tab] input') as HTMLInputElement | null)?.disabled === false);
  assert.equal(await tab.isChecked(), true, 'edited to something else, it is free again, as it was');
  await tab.uncheck();
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector details.action summary')].some((s) => /&from=hub$/.test((s.textContent ?? '').trim())));
});

test('no page errors', () => {
  assert.deepEqual(errors, []);
});

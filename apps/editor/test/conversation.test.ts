import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { validateScenario, type ConversationAction, type Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * Conversations (dialogue trees) in the editor: the map in the action card, and the panel where
 * lines and the player's choices are written and linked, in a real browser against the dev API.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
const shots = process.env.QBL_SHOTS;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'teacher@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario="1"]');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const inspector = (selector: string) => page.locator(`.inspector ${selector}`);
const panel = (selector = '') => page.locator(`dialog[data-panel=conversation] ${selector}`.trim());
const shot = async (name: string, scrollTo?: string) => {
  if (!shots) return;
  if (scrollTo) await page.locator(scrollTo).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/${name}.png` });
};
async function fill(locator: ReturnType<Page['locator']>, value: string) {
  await locator.fill(value);
  await locator.blur();
  await saved();
}
/** The scenario as the game would get it now. */
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/1/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const conversationIn = (s: Scenario): ConversationAction => {
  for (const scene of s.scenes) for (const h of scene.hotspots ?? []) for (const a of h.actions) if (a.type === 'conversation') return a;
  throw new Error('no conversation');
};

test('add a conversation to a hotspot: it starts as a small tree, drawn as a map in the action card', async () => {
  await page.goto(`${site.url}/editor/#/s/1/scene/2`);
  await page.waitForSelector('.stage-overlay');
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await fill(inspector('[data-field=shortname] input').first(), 'talk-to-vega');
  await inspector('.add-action').selectOption('conversation');
  await page.waitForSelector('.inspector .talk-map');
  const map = await page.innerText('.inspector .talk-map');
  assert.match(map, /Captain Vega: Hello! What would you like to know\?[\s\S]*Start[\s\S]*Who are you\?[\s\S]*Captain Vega: I look after this place\.[\s\S]*Back to “Hello! What would you like to know\?”[\s\S]*Goodbye![\s\S]*Ends the conversation/);
  assert.match(await page.innerText('.inspector details.action summary'), /2 lines, 2 choices: Captain Vega: Hello!/);
  await shot('1-action-card', '.inspector .talk-map');
});

test('the panel: write a line, give the player choices, and lead one to a new line', async () => {
  await page.click('.inspector .talk-map [data-line="l1"]');
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l1"]');
  assert.equal(await panel('.talk-nav-item').count(), 2);
  await fill(panel('[data-field=text] textarea'), 'Welcome to the bridge, {{QL_PlayerName}}. What do plants need to grow?');
  assert.match(await panel('.talk-nav-item[data-line="l1"] .talk-nav-text').innerText(), /Welcome to the bridge/, 'the list follows the typing');

  // The first choice becomes the right answer, with a variable to remember it by.
  const first = panel('.talk-choice[data-choice="0"]');
  await fill(first.locator('.talk-choice-head input[type=text]'), 'Sunlight and water');
  await first.locator('.field.check input[type=checkbox]').check();
  await saved();
  // The right answer ends the talk.
  await first.locator('.talk-target select').selectOption('');
  await saved();
  await first.locator('.inline-actions .add-action').selectOption('variable');
  await first.locator('.inline-action [data-field=name] select').selectOption('samples');
  await first.locator('.inline-action [data-field=operator] select').selectOption('+');
  await fill(first.locator('.inline-action [data-field=operand] input'), '1');

  // A wrong answer leads to a new line, where the panel goes at once.
  await panel('.talk-add-choice').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-choice[data-choice="2"]');
  const wrong = panel('.talk-choice[data-choice="2"]');
  await fill(wrong.locator('.talk-choice-head input[type=text]'), 'Only soil');
  await wrong.locator('.talk-target select').selectOption('__new__');
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l3"]');
  assert.match(await panel('.talk-line-head').innerText(), /Captain Vega says/i, 'a reply is said by whoever said the line it answers');
  assert.match(await panel('.talk-from').innerText(), /Welcome to the bridge[\s\S]*“Only soil”/);
  await fill(panel('[data-field=text] textarea'), 'Not quite. Think about the sun.');
  await panel('.talk-next .talk-target select').selectOption('l1');
  await saved();
  await shot('2-panel-new-line');

  // Back where we were, and to the line through its "Go →".
  await panel('.talk-back').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l1"]');
  await panel('.talk-choice[data-choice="0"] .talk-go').count().then((n) => assert.equal(n, 0, 'a choice that ends the talk has nowhere to go'));
  await panel('.talk-choice[data-choice="2"] .talk-go').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l3"]');
  await panel('.talk-nav-item[data-line="l1"]').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l1"]');
  await shot('3-panel-choices');

  const talk = conversationIn(await draft());
  const l1 = talk.lines.find((l) => l.id === 'l1')!;
  assert.equal(l1.text, 'Welcome to the bridge, {{QL_PlayerName}}. What do plants need to grow?');
  assert.deepEqual(l1.choices, [
    { text: 'Sunlight and water', correct: true, actions: [{ type: 'variable', name: 'samples', operator: '+', operand: 1 }] },
    { text: 'Goodbye!' },
    { text: 'Only soil', next: 'l3' },
  ]);
  assert.deepEqual(talk.lines.find((l) => l.id === 'l3'), { id: 'l3', speaker: 'character', character_id: 1, text: 'Not quite. Think about the sun.', next: 'l1' });
});

test('renaming a line keeps everything that led to it; deleting one ends what led there', async () => {
  await panel('.talk-nav-item[data-line="l3"]').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l3"]');
  await fill(panel('input.talk-id'), 'hint');
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="hint"]');
  let talk = conversationIn(await draft());
  assert.equal(talk.lines.find((l) => l.id === 'l1')!.choices![2]!.next, 'hint');

  // l2 ("I look after this place") is no longer reached from anything: Who are you? was replaced.
  assert.match(await panel('.talk-nav-item[data-line="l2"]').innerText(), /never said/);
  await panel('.talk-nav-item[data-line="l2"]').click();
  await panel('.talk-line-head button.danger').click();
  await page.waitForFunction(() => !document.querySelector('dialog[data-panel=conversation] .talk-nav-item[data-line="l2"]'));
  talk = conversationIn(await draft());
  assert.deepEqual(talk.lines.map((l) => l.id), ['l1', 'hint']);

  const issues = validateScenario(await draft());
  assert.deepEqual([...issues.errors, ...issues.warnings].filter((i) => i.path.includes('.lines')), [], 'the conversation is sound');
});

test('more than one box before the player answers: “Add another box” moves the choices on to it', async () => {
  await panel('.talk-nav-item[data-line="l1"]').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l1"]');
  await panel('.talk-add-box').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l3"]');
  assert.match(await panel('.talk-boxes').innerText(), /Box 2 of 2[\s\S]*Welcome to the bridge[\s\S]*The player answers/);
  assert.match(await panel('.talk-line-head').innerText(), /Captain Vega says/i, 'the next box is said by the same speaker');
  await fill(panel('[data-field=text] textarea'), 'Think carefully.');
  // The new box sits under the one it follows, marked as following on.
  assert.deepEqual(await panel('.talk-nav-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.line)), ['l1', 'l3', 'hint']);
  assert.equal(await panel('.talk-nav-row[data-row="l3"].follows').count(), 1);
  await shot('5-two-boxes');

  let talk = conversationIn(await draft());
  const l1 = talk.lines.find((l) => l.id === 'l1')!;
  assert.equal(l1.next, 'l3');
  assert.equal(l1.choices, undefined, 'the first box has no choices now');
  assert.deepEqual(talk.lines.find((l) => l.id === 'l3')!.choices!.map((c) => c.text), ['Sunlight and water', 'Goodbye!', 'Only soil']);

  // A box in a row taken out again: what led to it goes on to the box after it.
  await panel('.talk-nav-item[data-line="hint"]').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="hint"]');
  await panel('.talk-add-box').click();
  await page.waitForSelector('dialog[data-panel=conversation] .talk-line[data-line="l4"]');
  talk = conversationIn(await draft());
  assert.equal(talk.lines.find((l) => l.id === 'hint')!.next, 'l4');
  assert.equal(talk.lines.find((l) => l.id === 'l4')!.next, 'l1');
  await panel('.talk-line-head button.danger').click();
  await page.waitForFunction(() => !document.querySelector('dialog[data-panel=conversation] .talk-nav-item[data-line="l4"]'));
  talk = conversationIn(await draft());
  assert.equal(talk.lines.find((l) => l.id === 'hint')!.next, 'l1', 'the row closes up over the deleted box');
});

test('the lines can be put in any order, by ↑ ↓ or by dragging, and the start stays where it was', async () => {
  const order = () => panel('.talk-nav-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.line));
  await panel('.talk-nav-row[data-row="hint"] button[aria-label="Move this line up"]').click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[data-panel=conversation] .talk-nav-item')[1]?.getAttribute('data-line') === 'hint');
  assert.deepEqual(await order(), ['l1', 'hint', 'l3']);
  const below = (await panel('.talk-nav-row[data-row="l3"]').boundingBox())!;
  await panel('.talk-nav-row[data-row="l1"] .grip').dragTo(panel('.talk-nav-row[data-row="l3"]'), { targetPosition: { x: 40, y: below.height - 4 } });
  await page.waitForFunction(() => document.querySelectorAll('dialog[data-panel=conversation] .talk-nav-item')[2]?.getAttribute('data-line') === 'l1');
  assert.deepEqual(await order(), ['hint', 'l3', 'l1']);
  assert.equal(await panel('.talk-nav-item[data-line="l1"] .talk-start').count(), 1, 'still the start');
  let talk = conversationIn(await draft());
  assert.deepEqual(talk.lines.map((l) => l.id), ['hint', 'l3', 'l1']);
  assert.equal(talk.start, 'l1');
  await shot('6-sorted');

  // Back to the first place: the start is the first line again, and needs no naming.
  await panel('.talk-nav-row[data-row="l1"] button[aria-label="Move this line up"]').click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[data-panel=conversation] .talk-nav-item')[1]?.getAttribute('data-line') === 'l1');
  await panel('.talk-nav-row[data-row="l1"] button[aria-label="Move this line up"]').click();
  await page.waitForFunction(() => document.querySelectorAll('dialog[data-panel=conversation] .talk-nav-item')[0]?.getAttribute('data-line') === 'l1');
  talk = conversationIn(await draft());
  assert.deepEqual(talk.lines.map((l) => l.id), ['l1', 'hint', 'l3']);
  assert.equal(talk.start, undefined);
  const issues = validateScenario(await draft());
  assert.deepEqual([...issues.errors, ...issues.warnings].filter((i) => i.path.includes('.lines')), [], 'the conversation is sound');
});

test('closing the panel brings the map up to date', async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel=conversation]', { state: 'detached' });
  const map = await page.innerText('.inspector .talk-map');
  assert.match(map, /Welcome to the bridge[\s\S]*Think carefully\.[\s\S]*Sunlight and water[\s\S]*Ends the conversation[\s\S]*Only soil[\s\S]*Not quite[\s\S]*Back to “Welcome to the bridge/);
  assert.doesNotMatch(map, /Never said/);
  await shot('4-map-after', '.inspector .talk-map');
  assert.deepEqual(errors, []);
});

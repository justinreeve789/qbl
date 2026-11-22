import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { validateScenario, type Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * Renaming a variable on the Variables page: the conditions, Variable actions, `{{…}}` text,
 * infobox blocks and objectives that name it follow the new name. A name that is taken or
 * reserved is refused and the old one stays.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
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
const nameBox = (name: string) => page.locator(`.var-row[data-variable="${name}"] input[type=text]`).first();

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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Renames');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  const bundle = await rest<{ scenes: Array<{ id: number }> }>('GET', '');
  const scene = bundle.scenes[0]!.id;
  await rest('PATCH', `/rows/scenes/${scene}`, { width: 800, height: 600 });
  await rest('POST', '/rows/variables', { variable_name: 'found', default_value: 0 });
  await rest('POST', '/rows/variables', { variable_name: 'founder', default_value: 0 });
  const event = (await rest<{ row: { id: number } }>('POST', '/rows/events', { scene_id: scene, kind: 'hotspot', shortname: 'spring', position_x: 300, position_y: 300, radius: 40 })).row;
  await rest('POST', '/rows/conditions', { event_id: event.id, variable: 'found', operator: '<', operand: 3 });
  await rest('POST', '/rows/conditions', { event_id: event.id, variable: 'founder', operator: '=', operand: 0 });
  await rest('POST', '/rows/actions', { event_id: event.id, type: 'variable', params: { name: 'found', operator: '+', operand: 1 } });
  await rest('POST', '/rows/actions', { event_id: event.id, type: 'dialogue', params: { who: 'player', text: 'That makes {{found}}, not {{founder}}.' } });
  await rest('POST', '/rows/actions', { event_id: event.id, type: 'infobox', params: { content: '<p>Guess:</p><input data-qbl="answer" data-var="found"><div data-qbl="when" data-when="found >= 2">Nearly!</div>' } });
  await rest('PATCH', '', { settings: { objectives: [{ id: 'o1', text: 'Find springs ({{found}}/3)', conditions: [{ variable: 'found', operator: '>=', operand: 3 }] }] } });
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.click('.tabs >> text=Variables');
  await page.waitForSelector('.var-row[data-variable=found]');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a new name is followed by everything that uses the variable', async () => {
  await nameBox('found').fill('springs_found');
  await nameBox('found').press('Enter');
  await page.waitForSelector('.var-row[data-variable=springs_found]');
  await page.waitForSelector('.toast >> text=changed to match');
  const doc = await draft();
  const json = JSON.stringify(doc);
  assert.deepEqual(doc.global_variables!.map((v) => v.variable_name).sort(), ['founder', 'springs_found']);
  assert.equal(/"found"|\{\{found\}\}|data-var=\\"found\\"|"found >=/.test(json), false, json);
  const event = doc.scenes[0]!.hotspots!.find((h) => h.shortname === 'spring')!;
  const events = (event as unknown as { events?: unknown[] }).events ?? [event];
  const text = JSON.stringify(events);
  assert.match(text, /"variable":"springs_found"/);
  assert.match(text, /"variable":"founder"/);
  assert.match(text, /"name":"springs_found"/);
  assert.match(text, /That makes \{\{springs_found\}\}, not \{\{founder\}\}/);
  assert.match(text, /data-var=\\"springs_found\\"/);
  assert.match(text, /data-when=\\"springs_found >= 2\\"/);
  const objective = (doc as unknown as { objectives: Array<{ text: string; conditions: Array<{ variable: string }> }> }).objectives[0]!;
  assert.equal(objective.text, 'Find springs ({{springs_found}}/3)');
  assert.equal(objective.conditions[0]!.variable, 'springs_found');
  assert.deepEqual(validateScenario(doc).errors.filter((e) => /not declared|not defined/.test(e.message)), []);
  // The Used chip still counts its uses under the new name.
  assert.match(await page.locator('.var-row[data-variable=springs_found] .var-uses').textContent() ?? '', /[1-9]\d* use/);
});

test('a name another variable has, or a reserved one, is refused', async () => {
  for (const name of ['founder', 'QL_Score', '  ']) {
    await nameBox('springs_found').fill(name);
    await nameBox('springs_found').press('Enter');
    await page.waitForSelector('.var-row[data-variable=springs_found]');
    assert.equal(await nameBox('springs_found').inputValue(), 'springs_found');
  }
  await page.waitForSelector('.toast >> text=already called');
  const doc = await draft();
  assert.deepEqual(doc.global_variables!.map((v) => v.variable_name).sort(), ['founder', 'springs_found']);
  assert.deepEqual(errors, []);
});

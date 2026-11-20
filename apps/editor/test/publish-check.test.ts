import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite } from './servers';

/**
 * The Publish page's check: each problem says where it is (scene › event › action › field), and
 * "Go there" opens that place with the field lit up. The page checks again whenever it opens.
 * Set QBL_SHOTS to a folder to keep screenshots.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;
let sceneId = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Checks');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  sceneId = Number(await page.getAttribute('.scene-card', 'data-scene'));

  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'sky.png', mimeType: 'image/png', buffer: png(256, 256, [90, 140, 220]) }]);
  await page.waitForSelector('[data-media]');
  await saved();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const shot = async (name: string) => {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
};
const issue = (message: string) => page.locator('li.issue', { hasText: message });

test('an action with nothing chosen is named by scene, event, action and field, and Go there opens it', async () => {
  // A start event whose Translate action has no action to animate.
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.selectOption('.add-menu', 'start');
  await page.waitForFunction(() => document.querySelector('.event-panel h2')?.textContent?.startsWith('Start event'));
  await page.locator('.inspector .add-action').selectOption('translate');
  await page.waitForSelector('.inspector [data-action]');
  const actionId = Number(await page.getAttribute('.inspector [data-action]', 'data-action'));
  await saved();

  // The global Publish button lands on the Publish page, which lists the problems without another click.
  await page.click('.workspace-head .publish-now');
  await page.waitForURL(/\/publish$/);
  const translate = issue('No action is chosen to move, resize or fade');
  await translate.waitFor();
  const where = await translate.locator('.issue-where').innerText();
  for (const part of ['Scene “', 'Start event', 'Action 1 · Translate', 'Action to animate']) assert.ok(where.includes(part), `${part} in: ${where}`);
  assert.match(await translate.locator('.issue-path').innerText(), /^scenes\[0\]\.start_events\[0\]\.actions\[0\]\.target_id$/);
  assert.equal(await translate.locator('.crumb.field').innerText(), 'Action to animate');
  await shot('publish-issues');

  // Go there: the scene editor, the event selected, the action's card open and its field lit up and focused.
  await translate.locator('.issue-go').click();
  await page.waitForURL(new RegExp(`/scene/${sceneId}$`));
  const card = page.locator(`.inspector [data-action="${actionId}"]`);
  await card.waitFor();
  assert.equal(await card.evaluate((n) => (n as HTMLDetailsElement).open), true);
  await page.waitForSelector(`.inspector [data-action="${actionId}"] [data-field="target_id"].flash`);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-field="target_id"]'))), true);
  await shot('went-there');

  // Fixed by deleting it; the Publish page checks again on opening and it is gone.
  await card.locator('summary').click(); // the card must be open to reach Delete; clicking toggles it, so open it again
  if (!(await card.evaluate((n) => (n as HTMLDetailsElement).open))) await card.locator('summary').click();
  await card.locator('button.danger:has-text("Delete")').click();
  await saved();
  await page.click('.tabs >> text=Publish');
  await page.waitForSelector('.results .issue');
  await page.waitForFunction(() => !document.querySelector('.results')?.textContent?.includes('Checking'));
  assert.equal(await issue('No action is chosen to move').count(), 0);
});

/** Change a row through the API, then open the Publish page afresh so the editor reads it. */
async function patchRow(table: string, rowId: number, attrs: object) {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/rows/${table}/${rowId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(attrs),
  });
  assert.ok(res.ok, `patch ${table} answered ${res.status}: ${await res.text()}`);
  await page.goto(`${site.url}/editor/#/`);
  await page.waitForSelector('[data-scenario]');
  await page.goto(`${site.url}/editor/#/s/${id}/publish`);
}

test('a scene problem opens the scene with the scene itself selected', async () => {
  // No background and no size.
  await patchRow('scenes', sceneId, { width: null, height: null });
  const scene = issue('A scene needs a background image');
  await scene.waitFor();
  assert.match(await scene.locator('.issue-where').innerText(), /^Scene “/);
  await scene.locator('.issue-go').click();
  await page.waitForURL(new RegExp(`/scene/${sceneId}$`));
  await page.waitForSelector('.inspector.flash');
  await page.waitForFunction(() => document.querySelector('.inspector h2')?.textContent?.includes('Scene'));
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('a problem in the media opens that picture\'s panel', async () => {
  // A sprite sheet with an animation whose name is not allowed.
  await page.click('.tabs >> text=Media');
  const mediaId = Number(await page.getAttribute('[data-media]', 'data-media'));
  await patchRow('media', mediaId, { params: { sheet: { columns: 2, rows: 1 }, animations: [{ name: 'Bad Name', frames: [0] }] } });

  const sheet = issue('An animation name is lowercase letters');
  await sheet.waitFor();
  assert.ok((await sheet.locator('.issue-where').innerText()).includes('Media “sky.png”'));
  await sheet.locator('.issue-go').click();
  await page.waitForSelector('dialog[data-panel="media"][open]');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('a problem in an objective opens that objective\'s panel', async () => {
  // A new objective has nothing that ticks it off yet. (The media panel from before is closed first.)
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  await page.click('.tabs >> text=Objectives');
  await page.click('text=New objective');
  await page.waitForSelector('dialog[data-panel="objective"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  await saved();
  await page.click('.tabs >> text=Publish');

  const objective = issue('An objective needs at least one condition that completes it');
  await objective.waitFor();
  await objective.locator('.issue-go').click();
  await page.waitForSelector('dialog[data-panel="objective"][open]');
  assert.match(await page.innerText('dialog[data-panel="objective"] .panel-title'), /Objective 1/);
  await page.waitForSelector('dialog[data-panel="objective"] [data-section="conditions"].flash');
  assert.equal(errors.length, 0, errors.join('\n'));
});

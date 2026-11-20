import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * Changing the code players open a scenario at, from the Publish page's Player link. The form
 * checks the code as it is typed; the API refuses a taken one; the old code stops working.
 * Set QBL_SHOTS to a folder to keep screenshots.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;
let firstCode = '';

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/409|422|403/.test(m.text()) && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Cloudy Pond');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  await page.click('.tabs >> text=Publish');
  await page.waitForSelector('[data-player-link] [data-code]');
  firstCode = (await page.innerText('[data-player-link] [data-code]')).trim();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const shot = async (name: string) => {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png`, fullPage: true });
};
const message = () => page.innerText('[data-code-message]');
const save = () => page.locator('[data-player-link] button', { hasText: 'Save code' });

test('a new scenario starts with 16 random letters', () => {
  assert.match(firstCode, /^[a-z]{16}$/);
});

test('the form checks the code as it is typed', async () => {
  await page.click('[data-action=change-code]');
  const input = page.locator('[data-player-link] input[data-field=code]');
  assert.equal(await input.inputValue(), firstCode);
  assert.equal(await save().isDisabled(), true, 'nothing to save yet');

  await input.fill('pond');
  assert.equal(await save().isDisabled(), false);
  assert.match(await message(), new RegExp(`/${firstCode} will stop working`));
  assert.match(await page.innerText('[data-player-link] .link-url'), /\/pond$/);

  for (const [bad, reason] of [['ab', /at least 4/], ['1pond', /starts with a letter/], ['pond_1', /lowercase letters, digits and hyphens/], ['pond-', /hyphen/], ['missions', /site’s own/]] as const) {
    await input.fill(bad);
    assert.match(await message(), reason, bad);
    assert.equal(await save().isDisabled(), true, bad);
  }
  await input.fill('Cloudy-Pond');
  assert.match(await page.innerText('[data-player-link] .link-url'), /\/cloudy-pond$/, 'shown as it will be stored');
  await shot('change-code-form');

  // Escape puts the box back as it was.
  await input.press('Escape');
  assert.equal((await page.innerText('[data-player-link] [data-code]')).trim(), firstCode);
});

test('a code another scenario has is refused by the API, in the form', async () => {
  await page.click('[data-action=change-code]');
  await page.fill('[data-player-link] input[data-field=code]', 'starshipexplorer');
  await save().click();
  await page.waitForFunction(() => /already uses that code/.test(document.querySelector('[data-code-message]')?.textContent ?? ''));
  await page.click('[data-player-link] button:has-text("Cancel")');
});

test('saving changes the code at once; the old code no longer finds the scenario', async () => {
  await page.click('[data-action=change-code]');
  await page.fill('[data-player-link] input[data-field=code]', 'cloudy-pond');
  await page.press('[data-player-link] input[data-field=code]', 'Enter');
  await page.waitForSelector('[data-player-link] [data-code]');
  assert.equal((await page.innerText('[data-player-link] [data-code]')).trim(), 'cloudy-pond');
  assert.match(await page.getAttribute('[data-player-link] a.link-url', 'href') ?? '', /\/cloudy-pond$/);
  await shot('change-code-saved');

  // Published, it plays at the new code and not the old one.
  await page.click('button:has-text("Check and publish")');
  await page.waitForSelector('[data-status=published]');
  const play = (code: string) => fetch(`${site.url}/api/scenarios/${code}/play`).then((r) => r.status);
  assert.equal(await play('cloudy-pond'), 200);
  assert.equal(await play(firstCode), 404);

  // Still the new code after loading the editor again; the scenario list shows it too.
  await page.goto(`${site.url}/editor/#/`);
  await page.waitForSelector(`[data-scenario="${id}"]`);
  assert.match(await page.innerText(`[data-scenario="${id}"]`), /cloudy-pond/);
  assert.deepEqual(errors, []);
});

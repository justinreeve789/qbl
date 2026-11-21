import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * The AI mission generator from the editor, in a real browser against the dev API pretending to
 * make missions (QBL_DEV_GENERATOR: each run goes through every stage in a few seconds). A teacher
 * describes one, watches its progress on the Generate page and from the header chip on other
 * pages, cancels one, and opens one that is made. An administrator sees everyone's. On a site with
 * billing on, a teacher without the generator is told where to get it.
 */
let site: TestSite;
let billed: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];

const signIn = async (url: string, email: string, hash = '#/') => {
  await page.goto(`${url}/editor/${hash}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
};
const percentOf = async (selector: string) => Number(await page.getAttribute(selector, 'aria-valuenow'));

before(async () => {
  [site, billed] = await Promise.all([startSite({ QBL_DEV_GENERATOR: '14' }), startSite({ QBL_DEV_BILLING: '1' })]);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
});

after(async () => {
  await browser?.close();
  await site?.close();
  await billed?.close();
});

test('the Scenarios page leads to the generator', async () => {
  await signIn(site.url, 'teacher@example.test');
  await page.click('button[data-action=generate]');
  await page.waitForSelector('form[data-form=generate]');
  assert.equal(new URL(page.url()).hash, '#/generate');
  // Billing is off here: no credits are needed.
  assert.match(await page.textContent('[data-credits]') ?? '', /No credits needed/);
});

test('a description is needed, and an example fills one in', async () => {
  const go = 'form[data-form=generate] button[data-action=generate]';
  assert.equal(await page.isDisabled(go), true, 'nothing to make yet');
  await page.fill('textarea[name=prompt]', 'Plants');
  assert.equal(await page.isDisabled(go), true, 'too short');
  await page.click('.gen-example >> nth=0');
  assert.match(await page.inputValue('textarea[name=prompt]'), /rainforest research station/);
  assert.equal(await page.isDisabled(go), false);
});

test('a run shows its stages and a progress bar that moves, and can be cancelled', async () => {
  await page.click('form[data-form=generate] button[data-action=generate]');
  await page.waitForSelector('.gen-run.live [data-progress]');
  assert.equal(await page.inputValue('textarea[name=prompt]'), '', 'the form is ready for the next one');
  assert.equal(await page.isDisabled('form[data-form=generate] button[data-action=generate]'), true, 'one at a time');
  assert.match(await page.textContent('[data-note]') ?? '', /One mission at a time/);
  assert.equal(await page.locator('.gen-run.live .gen-steps li').count(), 5, 'aligning, designing, drawing, building, saving');
  // The chip in the header is for other pages.
  assert.equal(await page.isHidden('.gen-chip-host'), true);
  const first = await percentOf('.gen-run.live [data-progress]');
  await page.waitForFunction(() => document.querySelector('.gen-steps li.now')?.getAttribute('data-stage') === 'designing');
  await page.waitForFunction((p) => Number(document.querySelector('.gen-run.live [data-progress]')?.getAttribute('aria-valuenow')) > p, first);
  assert.match(await page.textContent('.gen-run.live .gen-meta') ?? '', /Started .* ago/);

  await page.click('.gen-run.live button[data-action=cancel]');
  await page.waitForSelector('.gen-run.cancelled');
  assert.equal(await page.locator('.gen-run.live').count(), 0);
  assert.match(await page.textContent('.gen-run.cancelled') ?? '', /You stopped it/);
});

test('"Try again" puts the description back', async () => {
  await page.click('.gen-run.cancelled button[data-action=again]');
  assert.match(await page.inputValue('textarea[name=prompt]'), /rainforest research station/);
});

test('the header chip follows a run from other pages, and says when it is ready', async () => {
  await page.click('form[data-form=generate] button[data-action=generate]');
  await page.waitForSelector('.gen-run.live');
  await page.click('.top-nav [data-place=editor]');
  await page.waitForSelector('.gen-chip [data-progress]');
  assert.match(await page.textContent('.gen-chip') ?? '', /\d+%/);
  assert.match(await page.title(), /^\(\d+%\) QuestLab$/, 'the tab says how far it has got');
  await page.waitForFunction(() => /Pictures/.test(document.querySelector('.gen-chip')?.textContent ?? ''), null, { timeout: 15000 });
  // Made: a message with a way to open it, and the chip and the percent in the title go.
  await page.waitForSelector('.toast.with-action', { timeout: 20000 });
  assert.match(await page.textContent('.toast.with-action') ?? '', /is ready/);
  assert.equal(await page.locator('.gen-chip').count(), 0);
  assert.equal(await page.title(), 'QuestLab');
  await page.click('.toast-action');
  await page.waitForFunction(() => /^#\/s\/\d+/.test(window.location.hash));
});

test('the Generate page lists it, ready to open', async () => {
  await page.click('.top-nav [data-place=generate]');
  await page.waitForSelector('.gen-run.done');
  assert.match(await page.textContent('.gen-run.done') ?? '', /Ready/);
  assert.equal(await page.locator('.gen-run.done button:has-text("Open in the editor")').count(), 1);
  assert.equal(await page.locator('.gen-everyone').count(), 0, 'a teacher does not see everyone’s');
});

test('"New scenario" can hand its title to the generator', async () => {
  await page.click('.top-nav [data-place=editor]');
  await page.click('button:has-text("New scenario")');
  await page.fill('dialog[data-dialog=new-scenario] input[name=title]', 'Volcano field trip about magma and rock types');
  await page.check('dialog[data-dialog=new-scenario] input[value=generate]');
  await page.click('dialog[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('form[data-form=generate]');
  await page.waitForFunction(() => (document.querySelector('textarea[name=prompt]') as HTMLTextAreaElement | null)?.value.startsWith('Volcano field trip'));
});

test('an administrator sees everyone’s runs and what they spent', async () => {
  await signIn(site.url, 'admin@example.test', '#/generate');
  await page.waitForSelector('.gen-everyone');
  await page.click('.gen-everyone summary');
  assert.ok(await page.locator('.gen-table tbody tr').count() >= 2);
  assert.match(await page.textContent('.gen-table') ?? '', /teacher/i);
  assert.match(await page.textContent('[data-credits]') ?? '', /No credits needed/);
});

test('with billing on, a teacher without the generator is shown where to get it', async () => {
  await signIn(billed.url, 'teacher@example.test', '#/generate');
  await page.waitForSelector('[data-card=upsell]');
  assert.equal(await page.locator('form[data-form=generate]').count(), 0);
  assert.match(await page.textContent('[data-card=upsell]') ?? '', /Teacher Plus/);
});

test('no errors in the console', () => {
  assert.deepEqual(errors, []);
});

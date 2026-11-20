import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * The district admin panel, the Plan page and the generator page, in a real browser against the
 * dev API (where billing is off and the generator does not run). A QBL administrator makes an
 * organization, turns its integrations on, sets up Clever, uploads a roster file and makes an
 * API client.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];

const signIn = async (email: string, hash = '#/') => {
  await page.goto(`${site.url}/editor/${hash}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
};

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => void d.accept());
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('a teacher has Generate and Plan in the menu, not District', async () => {
  await signIn('teacher@example.test');
  await page.waitForSelector('.top-nav [data-place=generate]');
  assert.equal(await page.locator('.top-nav [data-place=plan]').count(), 1);
  assert.equal(await page.locator('.top-nav [data-place=district]').count(), 0);
});

test('the Plan page says what the plan includes', async () => {
  await page.click('.top-nav [data-place=plan]');
  await page.waitForSelector('[data-card=plan] h2');
  assert.match(await page.textContent('[data-card=plan]') ?? '', /billing is off/i);
  assert.equal(await page.locator('[data-card=plan] li.yes').count(), 3, 'everything is included with billing off');
});

test('the generator page takes a description and says when the site cannot make missions', async () => {
  await page.click('.top-nav [data-place=generate]');
  await page.waitForSelector('form[data-form=generate]');
  await page.fill('form[data-form=generate] textarea[name=prompt]', 'A rainforest mystery about how plants need light, for grade 4');
  await page.click('form[data-form=generate] details[data-fold=generate-options] summary');
  await page.fill('form[data-form=generate] input[name=grade]', '4');
  await page.click('form[data-form=generate] button[type=submit]');
  await page.waitForSelector('.toast.error');
  assert.match(await page.textContent('.toast.error') ?? '', /not ready on this site/);
});

test('a QBL administrator makes an organization and turns its integrations on', async () => {
  await signIn('admin@example.test', '#/district');
  await page.waitForSelector('form[data-form=new-org]');
  await page.fill('form[data-form=new-org] input', 'Riverside Unified');
  await page.click('form[data-form=new-org] button[type=submit]');
  await page.waitForSelector('[data-card=off]');
  assert.match(await page.textContent('h1') ?? '', /Riverside Unified/);
  await page.check('[data-card=qbl] input[data-field=integrations_enabled]');
  await page.waitForSelector('[data-integration=saml]');
  assert.equal(await page.locator('[data-integration]').count(), 3, 'SAML, Clever and Google');
  assert.match(await page.textContent('[data-integration=saml]') ?? '', /api\/sso\/\d+\/saml\/acs/, 'with the addresses to give the identity provider');
});

test('Clever is set up and turned on; its secret is never shown back', async () => {
  const clever = '[data-integration=clever]';
  await page.fill(`${clever} input[data-field=district_id]`, '5a1b2c3d4e5f60718293a4b5');
  await page.fill(`${clever} input[data-field=district_token]`, 'tok_secret_value');
  await page.check(`${clever} input[data-field=enabled]`);
  await page.click(`${clever} button[data-action=save]`);
  await page.waitForSelector(`${clever} .badge >> text=On`);
  assert.equal(await page.inputValue(`${clever} input[data-field=district_token]`), '', 'the token is not put back in the page');
  assert.match(await page.getAttribute(`${clever} input[data-field=district_token]`, 'placeholder') ?? '', /^Set\./);
  assert.ok(!(await page.content()).includes('tok_secret_value'));
  assert.equal(await page.locator(`${clever} button[data-action=sync]`).count(), 1, 'a Clever sync can be started');
});

test('a roster file is uploaded and shows in the sync history; one with names is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qbl-roster-'));
  writeFileSync(join(dir, 'bad.csv'), 'role,external_id,first_name\nstudent,S-1,Ann\n');
  writeFileSync(join(dir, 'roster.csv'), 'role,external_id,grade_level,teacher_ids\nteacher,T-1,,\nstudent,S-1,4,T-1\nstudent,S-2,4,T-1\n');
  await page.setInputFiles('form[data-form=roster] input[type=file]', join(dir, 'bad.csv'));
  await page.click('form[data-form=roster] button[type=submit]');
  await page.waitForSelector('.toast.error >> text=/first_name/');
  await page.setInputFiles('form[data-form=roster] input[type=file]', join(dir, 'roster.csv'));
  await page.click('form[data-form=roster] button[type=submit]');
  await page.waitForSelector('[data-card=runs] li[data-status=done]');
  assert.match(await page.textContent('[data-card=runs]') ?? '', /1 teachers and 2 students added/);
  assert.match(await page.textContent('.stat >> nth=2') ?? '', /2/, 'two students now');
});

test('an API client is made, its secret shown once', async () => {
  await page.fill('form[data-form=new-client] input[type=text]', 'SIS nightly');
  await page.click('form[data-form=new-client] button[type=submit]');
  await page.waitForSelector('.secret-box:not([hidden]) code >> text=/^qbls_/');
  assert.equal(await page.locator('[data-card=clients] li[data-client]').count(), 1);
  await page.click('[data-card=clients] li[data-client] button.danger');
  await page.waitForSelector('[data-card=clients] li.revoked');
});

test('no errors in the console', () => {
  assert.deepEqual(errors, []);
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * The profile page, opened from the editor's header: the name over the teacher's character,
 * changing the password, and the link for a forgotten one. The same dialog opens from the
 * missions page (packages/shared/browser/profile.ts).
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
const dialog = 'dialog[data-dialog=profile]';

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${site.url}/editor/#/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill('input[type=email]', 'keating@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('button.who[data-profile]');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('the sign-in form links to choosing a new password on the game’s sign-in screen', async () => {
  const other = await browser.newPage();
  await other.goto(`${site.url}/editor/#/`);
  await other.waitForSelector('a[data-forgot-password]');
  assert.match(await other.getAttribute('a[data-forgot-password]', 'href') ?? '', /\/missions#forgot-password$/);
  await other.close();
});

test('the name in the header opens the profile, and a new name shows there at once', async () => {
  await page.click('button.who[data-profile]');
  await page.waitForSelector(`${dialog}[open]`);
  assert.equal(await page.inputValue(`${dialog} input[name=name]`), 'Keating');
  assert.match(await page.innerText(`${dialog} [data-email]`), /keating@example\.test/);

  // Contact details are refused, with the server's reason.
  await page.fill(`${dialog} input[name=name]`, 'keating@school.example');
  await page.click(`${dialog} [data-form=name] button[type=submit]`);
  await page.waitForSelector(`${dialog} [data-form=name] [role=status][data-tone=error]`);
  assert.match(await page.innerText(`${dialog} [data-form=name] [role=status]`), /email addresses and phone numbers/);

  await page.fill(`${dialog} input[name=name]`, '  Mr   Keating ');
  await page.click(`${dialog} [data-form=name] button[type=submit]`);
  await page.waitForSelector(`${dialog} [data-form=name] [role=status][data-tone=ok]`);
  assert.equal(await page.innerText('button.who'), 'Mr Keating');

  // Closed and opened again (and after a reload), the server has the new name.
  await page.keyboard.press('Escape');
  await page.waitForFunction((sel) => !document.querySelector(sel), dialog);
  await page.reload();
  await page.waitForSelector('button.who[data-profile]');
  assert.equal(await page.innerText('button.who'), 'Mr Keating');
});

test('changing the password checks the new one, and says when the current one is wrong', async () => {
  await page.click('button.who[data-profile]');
  await page.waitForSelector(`${dialog} [data-form=password]`);
  const form = `${dialog} [data-form=password]`;
  const status = `${form} [role=status]`;

  await page.fill(`${form} input[name=current_password]`, 'anything');
  await page.fill(`${form} input[name=password]`, 'new-password');
  await page.fill(`${form} input[name=password_confirmation]`, 'new-passwerd');
  await page.click(`${form} button[type=submit]`);
  assert.match(await page.innerText(status), /not the same/);

  await page.fill(`${form} input[name=current_password]`, 'wrong-password');
  await page.fill(`${form} input[name=password_confirmation]`, 'new-password');
  await page.click(`${form} button[type=submit]`);
  await page.waitForFunction((sel) => /not your current password/.test(document.querySelector(sel)?.textContent ?? ''), status);

  await page.fill(`${form} input[name=current_password]`, 'old-password');
  await page.click(`${form} button[type=submit]`);
  await page.waitForSelector(`${status}[data-tone=ok]`);
  assert.match(await page.innerText(status), /Password changed/);
  assert.equal(await page.inputValue(`${form} input[name=password]`), '', 'the fields are emptied');
});

test('a forgotten current password: a link is emailed to the account’s own address', async () => {
  await page.click(`${dialog} [data-send-reset]`);
  await page.waitForFunction((sel) => /link to choose a new password is on its way/.test(document.querySelector(sel)?.textContent ?? ''), `${dialog} .qbl-pf-forgot [role=status]`);
  assert.equal(await page.isDisabled(`${dialog} [data-send-reset]`), true, 'sent once');
  await page.click(`${dialog} .qbl-pf-close`);
  await page.waitForFunction((sel) => !document.querySelector(sel), dialog);
  assert.deepEqual(errors, []);
});

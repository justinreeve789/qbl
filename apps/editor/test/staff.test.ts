import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * How the editor treats who is signed in: a teacher arriving from the missions page's
 * "New scenario" gets the dialog at once; a student is told which account they are using and
 * how to get back to playing, rather than a dead end.
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
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
});

after(async () => {
  await browser?.close();
  await site?.close();
});

test('#/new opens the scenario list with the New scenario dialog, and leaves the address at the list', async () => {
  await signIn('teacher@example.test', '#/new');
  await page.waitForSelector('dialog[data-dialog=new-scenario][open]');
  assert.equal(new URL(page.url()).hash, '#/', 'reloading or going back does not open the dialog again');
  await page.fill('dialog[data-dialog=new-scenario] input[name=title]', 'Volcano Lab');
  await page.check('dialog[data-dialog=new-scenario] input[value=empty]');
  await page.click('dialog[data-dialog=new-scenario] button[type=submit]');
  await page.waitForFunction(() => /^#\/s\/\d+/.test(window.location.hash));
  assert.equal(await page.isVisible('dialog[data-dialog=new-scenario]'), false);
});

test('cancelling the dialog leaves the teacher on their list', async () => {
  await page.goto(`${site.url}/editor/#/new`);
  await page.waitForSelector('dialog[data-dialog=new-scenario][open]');
  await page.click('dialog[data-dialog=new-scenario] >> text=Cancel');
  await page.waitForSelector('[data-scenario]');
  assert.equal(new URL(page.url()).hash, '#/');
});

test('a student is told which account this is, and is offered the way back and another sign-in', async () => {
  await signIn('student.zed@example.test');
  await page.waitForSelector('[data-refused=student]');
  const text = await page.innerText('[data-refused]');
  assert.match(text, /signed in as Student\.zed, a student/);
  assert.match(text, /ask your administrator to make this account a teacher/);
  assert.match(await page.getAttribute('[data-refused] a', 'href') ?? '', /\/missions$/);
  assert.equal(await page.locator('.top-nav a').count(), 0, 'no links into the editor for a student');

  await page.click('[data-refused] >> text=Sign in with another account');
  await page.waitForSelector('input[type=email]');
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

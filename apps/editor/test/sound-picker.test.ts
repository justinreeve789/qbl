import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, wav, type TestSite } from './servers';

/**
 * Sounds are chosen by listening to them: a field shows the one chosen and opens a pop-up listing
 * the scenario's sounds, grouped by what they are for (music, sound effects, voices, not used yet,
 * and for an Audio action the game's own sounds), each with a ▶. Only one plays at a time.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Sounds');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const popup = 'dialog[data-panel=sound-choose]';
type Bundle = { scenario: { settings?: { music_media_id?: number } }; media: Array<{ id: number; filename: string; params?: { sound_group?: string } | null }>; actions: Array<{ id: number; type: string; media_id: number | null; params: { sound?: string } | null }> };
async function bundle(): Promise<Bundle> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as Bundle;
}
const mediaId = async (name: string) => (await bundle()).media.find((m) => m.filename === name)!.id;
const settingsJson = (b: Bundle) => (typeof b.scenario.settings === 'string' ? JSON.parse(b.scenario.settings) : b.scenario.settings ?? {}) as { music_media_id?: number };
const paramsOf = (a: Bundle['actions'][number]) => (typeof a.params === 'string' ? JSON.parse(a.params) : a.params ?? {}) as { sound?: string };
const names = (selector: string) => page.locator(selector).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-name')));

test('the scenario’s music opens the sound pop-up; with no music yet it lists every sound', async () => {
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [
    { name: 'theme.wav', mimeType: 'audio/wav', buffer: wav(3) },
    { name: 'door.wav', mimeType: 'audio/wav', buffer: wav(3) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-media]').length === 2);
  await saved();

  await page.click('.tabs >> text=Settings');
  const field = '[data-field=music_media_id]';
  assert.equal(await page.locator(`${field} select`).count(), 0, 'no dropdown');
  assert.match(await page.locator(`${field} .sound-choice-open`).innerText(), /Choose music/);
  await page.click(`${field} .sound-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.getAttribute(`${popup} .mp-tab.active`, 'data-sound-tab'), 'all');
  assert.match(await page.locator(`${popup} .mp-note`).innerText(), /No music yet/);
  assert.deepEqual(await names(`${popup} [data-sound-group=other] [data-sound-pick][data-name]`), ['door.wav', 'theme.wav'], 'unused sounds are listed under Not used yet');
  assert.equal(await page.locator(`${popup} [data-sound-group=game]`).count(), 0, 'the game’s own sounds are only for an Audio action');
  await page.waitForFunction((p) => document.querySelector(`${p} .sp-row[data-name="theme.wav"] .sp-length`)?.textContent === '0:03', popup);

  // One plays at a time.
  await page.click(`${popup} [data-name="door.wav"] .sp-play`);
  await page.waitForSelector(`${popup} [data-name="door.wav"] .sp-play.playing`);
  await page.click(`${popup} [data-name="theme.wav"] .sp-play`);
  await page.waitForSelector(`${popup} [data-name="theme.wav"] .sp-play.playing`);
  assert.equal(await page.locator(`${popup} .sp-play.playing`).count(), 1, 'playing one stops the other');
  assert.equal(await page.locator(popup).count(), 1, '▶ does not choose');

  await page.click(`${popup} .sp-row[data-name="theme.wav"]`);
  await page.waitForSelector(popup, { state: 'detached' });
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-name`)?.textContent === 'theme.wav', field);
  assert.equal(settingsJson(await bundle()).music_media_id, await mediaId('theme.wav'));
});

test('an Audio action opens on its group, lists sounds under headings, and takes the game’s own sounds', async () => {
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.click('[title="Add: start events"]');
  await page.waitForFunction(() => document.querySelector('.event-panel h2')?.textContent?.startsWith('Start event'));
  await page.locator('.inspector .add-action').selectOption('audio');
  await page.waitForSelector('details.action[open]');
  const field = '.inspector details.action [data-field=media_id]';
  assert.equal(await page.locator('.inspector [data-field=sound]').count(), 0, 'the game’s sounds are in the pop-up, not a second dropdown');

  await page.click(`${field} .sound-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.getAttribute(`${popup} .mp-tab.active`, 'data-sound-tab'), 'all', 'no sound effects yet');
  assert.deepEqual(await page.locator(`${popup} .sp-section`).evaluateAll((s) => s.map((x) => x.getAttribute('data-sound-group'))), ['music', 'other', 'game']);
  assert.deepEqual(await names(`${popup} [data-sound-group=music] [data-sound-pick]`), ['theme.wav'], 'the scenario’s music is under Music');
  await page.click(`${popup} [data-sound-tab=game]`);
  assert.equal(await page.locator(`${popup} .sp-upload`).count(), 0, 'nothing to upload among the game’s sounds');
  await page.fill(`${popup} .mp-search`, 'thund');
  assert.deepEqual(await names(`${popup} [data-sound-pick][data-name]`), ['Thunder']);
  await page.click(`${popup} [data-name="Thunder"] .sp-play`);
  await page.waitForSelector(`${popup} [data-name="Thunder"] .sp-play.playing`);
  await page.click(`${popup} .sp-row[data-name="Thunder"]`);
  await page.waitForSelector(popup, { state: 'detached' });
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-name`)?.textContent === 'Thunder', field);
  let action = (await bundle()).actions.find((a) => a.type === 'audio')!;
  assert.deepEqual([action.media_id, paramsOf(action).sound], [null, 'thunder']);
  assert.match(await page.innerText('.inspector details.action summary'), /thunder/i);

  // A file instead: the game's sound goes.
  await page.click(`${field} .sound-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.locator(`${popup} .sp-row.current`).getAttribute('data-name'), 'Thunder', 'the chosen one is marked');
  await page.click(`${popup} [data-sound-tab=all]`);
  await page.click(`${popup} .sp-row[data-name="door.wav"]`);
  await page.waitForSelector(popup, { state: 'detached' });
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-name`)?.textContent === 'door.wav', field);
  action = (await bundle()).actions.find((a) => a.type === 'audio')!;
  assert.deepEqual([action.media_id, paramsOf(action).sound], [await mediaId('door.wav'), undefined]);
});

test('a second Audio action opens on Sound effects; an upload from a group is filed there and chosen', async () => {
  await page.locator('.inspector .add-action').selectOption('audio');
  await page.waitForFunction(() => document.querySelectorAll('details.action').length === 2);
  const field = '.inspector details.action:nth-of-type(2) [data-field=media_id]';
  await page.click(`${field} .sound-choice-open`);
  await page.waitForSelector(popup);
  assert.equal(await page.getAttribute(`${popup} .mp-tab.active`, 'data-sound-tab'), 'effect');
  assert.deepEqual(await names(`${popup} [data-sound-pick][data-name]`), ['door.wav']);
  await page.setInputFiles(`${popup} input[type=file]`, [{ name: 'creak.wav', mimeType: 'audio/wav', buffer: wav() }]);
  await page.waitForSelector(popup, { state: 'detached' });
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-name`)?.textContent === 'creak.wav', field);
  const b = await bundle();
  const creak = b.media.find((m) => m.filename === 'creak.wav')!;
  const params = (typeof creak.params === 'string' ? JSON.parse(creak.params) : creak.params ?? {}) as { sound_group?: string };
  assert.equal(params.sound_group, 'effect', 'filed under the group it was uploaded from');
});

test('the × chooses no sound', async () => {
  const field = '.inspector details.action:nth-of-type(2) [data-field=media_id]';
  await page.click(`${field} .media-choice-clear`);
  await page.waitForFunction((f) => document.querySelector(`${f} .media-choice-open.empty`), field);
  const audio = (await bundle()).actions.filter((a) => a.type === 'audio');
  assert.equal(audio.filter((a) => a.media_id == null && !paramsOf(a).sound).length, 1);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

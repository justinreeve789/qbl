import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { validateScenario, type Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * Scenario tooling, in a real browser against the real backend classes: a new scenario that
 * starts aboard the starship, help icons, duplicating, exporting to a ZIP and importing it,
 * and copying someone else's public mission.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];

const api = async <T>(path: string): Promise<T> => {
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  return (await res.json()) as T;
};
const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const scenarioId = () => Number(/#\/s\/(\d+)/.exec(page.url())![1]);
interface Bundle { scenario: { title: string; code: string; published_at: string | null }; scenes: Array<{ shortname: string }>; characters: Array<{ name: string }>; media: Array<{ filename: string; filepath: string | null }> }

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
});

after(async () => {
  await browser?.close();
  await site?.close();
});

let hubId = 0;

test('a new scenario can start aboard the starship: its rooms, crew and ambient events, as its own copy', async () => {
  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario="1"]');

  await page.click('button:has-text("New scenario")');
  assert.equal(await page.isChecked('[data-dialog=new-scenario] input[value=starship]'), true, 'the starship is offered first');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Volcano Week');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 8);
  hubId = scenarioId();

  const bundle = await api<Bundle>(`/editor/scenarios/${hubId}`);
  assert.equal(bundle.scenario.title, 'Volcano Week');
  assert.deepEqual(bundle.scenes.map((s) => s.shortname).sort(), ['control-room', 'corridor', 'crew-quarters', 'engine-room', 'hydroponics', 'laboratory', 'marketplace', 'observation-deck']);
  assert.deepEqual(bundle.characters.map((c) => c.name), ['Captain Vega', 'Chief Engineer Okoro', 'Botanist Lin', 'Quartermaster Pax']);
  const draft = (await api<{ scenario: Scenario }>(`/editor/scenarios/${hubId}/preview`)).scenario;
  const report = validateScenario(draft);
  assert.deepEqual(report.errors, [], 'the copy is a valid scenario as it stands');

  // Cancelling the dialog creates nothing.
  await page.click('.brand');
  await page.waitForSelector(`[data-scenario="${hubId}"]`);
  const before = await page.locator('[data-scenario]').count();
  await page.click('button:has-text("New scenario")');
  await page.click('[data-dialog=new-scenario] >> text=Cancel');
  await page.waitForSelector('[data-dialog=new-scenario]', { state: 'detached' });
  assert.equal((await api<{ scenarios: unknown[] }>('/editor/scenarios')).scenarios.length, before, 'cancelling made no scenario');
});

test('explanations are behind help icons, not on the page', async () => {
  await page.click(`[data-scenario="${hubId}"] >> text=Edit`);
  await page.click('.tabs >> text=Settings');
  const field = page.locator('[data-field=visibility]');
  const note = field.locator('.help-text');
  assert.equal(await note.isVisible(), false, 'the explanation starts hidden');
  assert.equal(await page.locator('.field small').count(), 0, 'no field has its description written under it');
  await field.locator('.help-button').click();
  assert.equal(await note.isVisible(), true);
  assert.match(await note.innerText(), /private mission is run by a teacher/);
  assert.equal(await field.locator('.help-button').getAttribute('aria-expanded'), 'true');
  // Opening another closes the first; Escape closes whichever is open.
  await page.locator('[data-field=music_media_id] .help-button').click();
  assert.equal(await note.isVisible(), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.help-text:visible').count(), 0);
  // The help did not change the field it belongs to.
  assert.equal(await field.locator('select').inputValue(), '');
});

test('duplicate: a copy to change, which leaves the original alone', async () => {
  await page.click('[data-card=backup] button:has-text("Duplicate")');
  await page.waitForFunction((id) => !window.location.hash.includes(`/s/${id}`), hubId);
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 8);
  const copyId = scenarioId();
  assert.notEqual(copyId, hubId);
  const copy = await api<Bundle>(`/editor/scenarios/${copyId}`);
  assert.equal(copy.scenario.title, 'Copy of Volcano Week');
  assert.equal(copy.scenario.published_at, null);

  await page.click('.tabs >> text=Settings');
  await page.fill('[data-field=title] input', 'Volcano Week (period 3)');
  await page.locator('[data-field=title] input').blur();
  await saved();
  assert.equal((await api<Bundle>(`/editor/scenarios/${hubId}`)).scenario.title, 'Volcano Week');
});

test('export to a ZIP and import it again as a new scenario, uploaded files included', async () => {
  // Give the scenario an uploaded picture first, so there is a file to carry.
  const { png } = await import('./servers');
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'lava.png', mimeType: 'image/png', buffer: png(64, 48, [220, 90, 40]) }]);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-media] .card-title')].some((t) => t.textContent?.includes('lava.png')));
  await saved();
  const sourceId = scenarioId();

  await page.click('.tabs >> text=Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-card=backup] button:has-text("Export as a ZIP")')]);
  assert.match(download.suggestedFilename(), /^Volcano-Week-period-3-\d{8}\.zip$/);
  const path = await download.path();

  await page.click('.brand');
  await page.waitForSelector('[data-scenario]');
  await page.setInputFiles('[data-input=import]', path!);
  await page.waitForFunction((id) => /#\/s\/\d+/.test(window.location.hash) && !window.location.hash.includes(`/s/${id}`), sourceId);
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 8);
  const importedId = scenarioId();
  const [source, imported] = [await api<Bundle>(`/editor/scenarios/${sourceId}`), await api<Bundle>(`/editor/scenarios/${importedId}`)];
  assert.equal(imported.scenario.title, 'Volcano Week (period 3)');
  assert.notEqual(imported.scenario.code, source.scenario.code);
  assert.equal(imported.media.length, source.media.length);
  const lava = imported.media.find((m) => m.filename === 'lava.png')!;
  assert.match(lava.filepath ?? '', new RegExp(`^${importedId}/`), 'the picture is the new scenario\'s own file');
  assert.notEqual(lava.filepath, source.media.find((m) => m.filename === 'lava.png')!.filepath);
  const served = await fetch(`${site.url}/media/${lava.filepath}`);
  assert.equal(served.status, 200);

  // A file that is not a scenario is refused, and says why.
  await page.click('.brand');
  await page.waitForSelector('[data-scenario]');
  await page.setInputFiles('[data-input=import]', [{ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') }]);
  // (An earlier toast may still be showing: wait for this one.)
  await page.waitForSelector('.toast.error:has-text("not a ZIP")');
});

test('a public mission by someone else can be copied, but not edited', async () => {
  // The author publishes Volcano Week; another teacher then sees it offered.
  await page.click(`[data-scenario="${hubId}"] >> text=Edit`);
  await page.click('.publish-now');
  await page.waitForSelector('.publish-state[data-state=published], [data-state=published]');
  await saved();
  await page.click('.account >> text=Sign out');
  await page.fill('input[type=email]', 'colleague@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector(`[data-public="${hubId}"]`);
  assert.equal(await page.locator(`[data-scenario="${hubId}"]`).count(), 0, 'it is not among the scenarios they can edit');
  await page.click(`[data-public="${hubId}"] >> text=Make my own copy`);
  await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 8);
  const mine = await api<Bundle>(`/editor/scenarios/${scenarioId()}`);
  assert.equal(mine.scenario.title, 'Copy of Volcano Week');
  assert.notEqual(scenarioId(), hubId);
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

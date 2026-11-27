import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, wav, type TestSite } from './servers';

/**
 * Cropping a sound in its media pop-up: the sound's wave with a handle at each end, Start and
 * End boxes, ▶ to hear only the part kept, and Keep the whole sound. The crop is kept on the
 * media (params.crop), the card says so, and the sound chooser gives the cropped length.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Crops');
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
type Crop = { start?: number; end?: number };
async function cropOf(name: string): Promise<Crop | undefined> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const media = ((await res.json()) as { media: Array<{ filename: string; params: unknown }> }).media.find((m) => m.filename === name)!;
  const params = (typeof media.params === 'string' ? JSON.parse(media.params) : media.params ?? {}) as { crop?: Crop };
  return params.crop;
}
const panel = 'dialog[data-panel=media]';
const crop = `${panel} [data-section=crop]`;
const status = () => page.locator(`${crop} .crop-status`).innerText();

test('a sound opens on its crop: the whole sound plays until the handles are moved', async () => {
  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'birdsong.wav', mimeType: 'audio/wav', buffer: wav(4) }]);
  await page.waitForSelector('[data-media] [data-open=crop]');
  await saved();
  await page.click('[data-media] [data-open=crop]');
  await page.waitForSelector(`${crop} .crop-track:not(.loading)`);
  assert.equal(await status(), 'Plays the whole sound, 0:04.0.');
  assert.equal(await page.locator(`${crop} [data-crop=start]`).inputValue(), '0.0');
  assert.equal(await page.locator(`${crop} [data-crop=end]`).inputValue(), '4.0');
  assert.equal(await page.locator(`${crop} .crop-reset`).isDisabled(), true, 'nothing to take off yet');
  assert.equal(await page.locator(`${panel} [data-section=details] audio`).count(), 0, 'the sound is heard in the crop section');
  assert.equal(await cropOf('birdsong.wav'), undefined);
});

test('Start typed in, the end dragged, and a handle nudged with the keys are kept on the media', async () => {
  await page.fill(`${crop} [data-crop=start]`, '1');
  await page.locator(`${crop} [data-crop=start]`).dispatchEvent('change');
  assert.equal(await status(), 'Plays 0:01.0 to 0:04.0: 0:03.0 of the sound’s 0:04.0.');
  assert.deepEqual(await cropOf('birdsong.wav'), { start: 1 }, 'to the end of the file, so no end');

  // Drag the end handle to three quarters of the way along.
  const track = (await page.locator(`${crop} .crop-track`).boundingBox())!;
  const handle = (await page.locator(`${crop} .crop-handle.end`).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.6, track.y + 40, { steps: 5 });
  await page.mouse.move(track.x + track.width * 0.75, track.y + 40, { steps: 5 });
  await page.mouse.up();
  const dragged = (await cropOf('birdsong.wav'))!;
  assert.equal(dragged.start, 1);
  assert.ok(Math.abs(dragged.end! - 3) < 0.05, `ends near 3 s (${dragged.end})`);

  // A click on the wave before the start moves the start there.
  await page.mouse.click(track.x + track.width * 0.125, track.y + 40);
  const clicked = (await cropOf('birdsong.wav'))!;
  assert.ok(Math.abs(clicked.start! - 0.5) < 0.05, `starts near 0.5 s (${clicked.start})`);

  // The arrow keys move the focused handle a tenth of a second, Shift a whole second.
  await page.fill(`${crop} [data-crop=start]`, '1');
  await page.locator(`${crop} [data-crop=start]`).dispatchEvent('change');
  await page.fill(`${crop} [data-crop=end]`, '3');
  await page.locator(`${crop} [data-crop=end]`).dispatchEvent('change');
  await page.focus(`${crop} .crop-handle.start`);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await cropOf('birdsong.wav'), { start: 1.1, end: 3 });
  await page.keyboard.press('Shift+ArrowLeft');
  assert.deepEqual(await cropOf('birdsong.wav'), { start: 0.1, end: 3 });
  assert.equal(await page.getAttribute(`${crop} .crop-handle.start`, 'aria-valuetext'), '0:00.1');

  // The start cannot pass the end.
  await page.fill(`${crop} [data-crop=start]`, '9');
  await page.locator(`${crop} [data-crop=start]`).dispatchEvent('change');
  const pushed = (await cropOf('birdsong.wav'))!;
  assert.ok(pushed.start! < pushed.end! && pushed.end === 3, JSON.stringify(pushed));
  await page.fill(`${crop} [data-crop=start]`, '1');
  await page.locator(`${crop} [data-crop=start]`).dispatchEvent('change');
  assert.deepEqual(await cropOf('birdsong.wav'), { start: 1, end: 3 });
});

test('▶ plays only the part kept and stops by itself where it ends', async () => {
  await page.click(`${crop} .crop-play`);
  await page.waitForSelector(`${crop} .crop-play.playing`);
  const left = () => page.evaluate((sel) => parseFloat((document.querySelector(sel) as HTMLElement).style.left), `${crop} .crop-playhead`);
  assert.ok((await left()) >= 24.9, 'the play line starts at the start (1 s of 4)');
  const started = Date.now();
  await page.waitForFunction((sel) => parseFloat((document.querySelector(sel) as HTMLElement).style.left) > 30, `${crop} .crop-playhead`);
  await page.waitForSelector(`${crop} .crop-play:not(.playing)`, { timeout: 5000 });
  const took = Date.now() - started;
  assert.ok(took > 1200 && took < 2800, `about the two seconds kept (${took} ms), not the rest of the file`);
  assert.match(await page.locator(`${crop} .crop-play`).innerText(), /Play the part kept/);
});

test('the card says the sound is cropped, its player plays the part, and the chooser gives its cropped length', async () => {
  await page.keyboard.press('Escape');
  await page.waitForSelector(panel, { state: 'detached' });
  const card = '[data-media]';
  assert.equal(await page.locator(`${card} .media-cropped`).innerText(), '✂️ 0:01.0–0:03.0');
  assert.match(String(await page.getAttribute(`${card} audio`, 'src')), /#t=1,3$/);

  await page.click('.tabs >> text=Settings');
  await page.click('[data-field=music_media_id] .sound-choice-open');
  await page.waitForSelector('dialog[data-panel=sound-choose]');
  await page.waitForFunction(() => document.querySelector('dialog[data-panel=sound-choose] .sp-row[data-name="birdsong.wav"] .sp-length')?.textContent === '0:02');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel=sound-choose]', { state: 'detached' });
});

test('Keep the whole sound takes the crop off', async () => {
  await page.click('.tabs >> text=Media');
  await page.click('[data-media] [data-open=crop]');
  await page.waitForSelector(`${crop} .crop-track:not(.loading)`);
  assert.equal(await page.locator(`${crop} [data-crop=start]`).inputValue(), '1.0', 'opens on the crop kept');
  await page.click(`${crop} .crop-reset`);
  assert.equal(await status(), 'Plays the whole sound, 0:04.0.');
  assert.equal(await cropOf('birdsong.wav'), undefined);
  await page.keyboard.press('Escape');
  await page.waitForSelector(panel, { state: 'detached' });
  assert.equal(await page.locator('[data-media] .media-cropped').count(), 0);
  assert.deepEqual(errors, []);
});

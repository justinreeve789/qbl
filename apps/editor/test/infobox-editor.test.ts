import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { infoboxRefs, validateScenario, type InfoboxAction, type Scenario } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { png, startSite, type TestSite } from './servers';

/**
 * The infobox content editor: text typed as it looks, blocks put in with ＋ Insert and by
 * dropping files, the HTML view, button marks, and the designer's live preview, which is the
 * game's own box. Set QBL_SHOTS to a folder to keep screenshots.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('guess') : d.accept()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Rich boxes');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);

  await page.click('.tabs >> text=Media');
  await page.setInputFiles('.page input[type=file]', [{ name: 'pond.png', mimeType: 'image/png', buffer: png(320, 200, [40, 120, 90]) }]);
  await page.waitForSelector('[data-media]');
  await page.click('.tabs >> text=Scenes');
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay polygon');
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector .add-action').selectOption('infobox');
  await page.waitForSelector('details.action[open] .rt-surface');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const editor = (selector = '') => page.locator(`.inspector details.action .rt ${selector}`.trim());
async function shot(name: string) {
  if (process.env.QBL_SHOTS) await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
async function box(): Promise<InfoboxAction> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  const scenario = ((await res.json()) as { scenario: Scenario }).scenario;
  return scenario.scenes[0]!.hotspots!.at(-1)!.actions!.find((a) => a.type === 'infobox') as InfoboxAction;
}
async function scenario(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const insert = async (kind: string) => {
  await editor('.rt-insert').click();
  await editor(`[data-insert=${kind}]`).click();
};

test('text is typed and formatted as it looks, and saved as tidy HTML', async () => {
  await editor('.rt-surface').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Welcome to the pond');
  await editor('[data-state=heading]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Frogs ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('love');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' water.');
  await editor('.rt-surface').blur();
  assert.equal((await box()).content, '<h3>Welcome to the pond</h3><p>Frogs <b>love</b> water.</p>');
});

test('blocks go in with Insert: a new page, then a picture chosen from the library', async () => {
  await editor('.rt-surface p').last().click();
  await page.keyboard.press('End');
  await insert('page');
  await page.keyboard.type('Here is the pond.');
  await insert('picture');
  await page.waitForSelector('[data-panel=media-pick] [data-media-pick]');
  await page.click('[data-panel=media-pick] [data-media-pick]');
  await page.waitForSelector('.inspector .rt-b-picture img');
  const { content } = await box();
  const refs = infoboxRefs(content);
  assert.equal(refs.pages, 2);
  assert.equal(refs.media.length, 1);
  assert.match(content, /<hr data-qbl="page"><p>Here is the pond\.<\/p><figure><img src="\{\{media:\d+\}\}"><\/figure>$/);
  assert.match(await page.innerText('.inspector details.action summary'), /2 pages, 1 picture/);
});

test('a picture\'s pop-up changes its size and caption as you go', async () => {
  await editor('.rt-b-picture .rt-block-view').click();
  await page.waitForSelector('[data-panel=rt-block]');
  await page.click('[data-panel=rt-block] .rt-segmented [data-value=medium]');
  await page.locator('[data-panel=rt-block] input[type=text]').first().fill('Our pond in spring');
  await page.click('[data-panel=rt-block] button.primary');
  assert.match((await box()).content, /<figure data-size="medium"><img src="\{\{media:\d+\}\}"><figcaption>Our pond in spring<\/figcaption><\/figure>/);
  assert.match(await editor('.rt-b-picture figcaption').innerText(), /Our pond in spring/);
});

test('pictures dropped in are uploaded; several at once become a slideshow', async () => {
  const files = [png(200, 150, [200, 60, 60]), png(200, 150, [60, 60, 200])].map((b) => b.toString('base64'));
  const drop = await page.evaluateHandle((data) => {
    const dt = new DataTransfer();
    data.forEach((b64, i) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], `drop-${i}.png`, { type: 'image/png' }));
    });
    return dt;
  }, files);
  await editor('.rt-surface').dispatchEvent('drop', { dataTransfer: drop });
  await page.waitForSelector('.inspector .rt-b-gallery');
  const { content } = await box();
  assert.match(content, /<div data-qbl="gallery"><figure><img src="\{\{media:\d+\}\}"><\/figure><figure><img src="\{\{media:\d+\}\}"><\/figure><\/div>/);
  assert.equal(infoboxRefs(content).media.length, 3);
});

test('an answer box saves into a variable, and a button can be the right answer', async () => {
  await insert('answer');
  await page.waitForSelector('[data-panel=variable-pick]');
  await page.click('[data-panel=variable-pick] .rt-new'); // the prompt answers "guess"
  await page.waitForSelector('.inspector .rt-b-answer code');
  assert.match(await editor('.rt-b-answer').innerText(), /\{\{guess\}\}/);
  await page.click('.inspector >> text=+ Add button');
  await page.locator('.inspector .cta input[aria-label="Button text"]').fill('Check');
  await page.locator('.inspector .cta input[aria-label="Button text"]').blur();
  await page.locator('.inspector .cta [data-field=mark] select').selectOption('right');
  const action = await box();
  assert.deepEqual(infoboxRefs(action.content).answers, ['guess']);
  assert.deepEqual(action.call_to_actions?.map((c) => [c.text, c.mark]), [['Check', 'right']]);
  const result = validateScenario(await scenario());
  assert.deepEqual(result.errors, []);
});

test('the picture at the top, the size and the colour are the box\'s own fields', async () => {
  await page.locator('.inspector details.action [data-field=media_id] select').selectOption({ label: '🖼️ pond.png' });
  await saved();
  await page.locator('.inspector details.action [data-field=size] select').selectOption('large');
  await page.locator('.inspector details.action [data-field=accent] input[type=text]').fill('#ff7a00');
  await page.locator('.inspector details.action [data-field=accent] input[type=text]').blur();
  const action = await box();
  assert.deepEqual([typeof action.media_id, action.size, action.accent], ['number', 'large', '#ff7a00']);
});

test('the designer shows the box as players see it, and follows every change', async () => {
  await editor('.rt-designer-open').click();
  const stage = page.locator('[data-panel=infobox-designer] .rt-stage');
  await stage.locator('.qbl-infobox').waitFor();
  assert.equal(await stage.locator('.qbl-step').count(), 2, 'two pages');
  assert.equal(await stage.locator('.qbl-infobox').getAttribute('data-size'), 'large');
  assert.ok(await stage.locator('.qbl-infobox-hero img').count());
  await shot('designer');
  // A change in the designer's editor shows in the preview.
  await page.locator('[data-panel=infobox-designer] .rt-surface h3').click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.waitForFunction(() => document.querySelector('[data-panel=infobox-designer] .rt-stage h3')?.textContent === 'Welcome to the pond!');
  // Playing it: the second page has the slideshow, the answer box and the button.
  await stage.locator('.qbl-next').click();
  assert.equal(await stage.locator('.qbl-gallery .qbl-slide').count(), 2);
  await stage.locator('.qbl-answer-box').fill('12');
  await stage.locator('.qbl-answer-box').press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-panel=infobox-designer] .rt-stage-note')?.textContent?.startsWith('Chose “Check”'));
  await page.click('[data-panel=infobox-designer] .panel-close');
  await page.waitForSelector('[data-panel=infobox-designer]', { state: 'detached' });
  assert.match((await box()).content, /^<h3>Welcome to the pond!<\/h3>/);
  assert.equal(await editor('.rt-surface h3').innerText(), 'Welcome to the pond!', 'the inline editor shows what the designer left');
});

test('the HTML view shows the HTML, and HTML typed there comes back as blocks', async () => {
  await editor('.rt-code').click();
  const source = editor('.rt-source');
  assert.match(await source.inputValue(), /data-qbl="answer" data-var="guess"/);
  await source.fill(`${await source.inputValue()}<div data-qbl="callout" data-tone="warn"><p>Do not drink it.</p></div><p>Hi <script>alert(1)</script>{{guess}}</p>`);
  await source.blur();
  await editor('.rt-code').click();
  await editor('.rt-b-callout').waitFor();
  assert.equal(await editor('.rt-var').innerText(), 'guess', 'a variable shows as a chip');
  const { content } = await box();
  assert.match(content, /<div data-qbl="callout" data-tone="warn"><p>Do not drink it\.<\/p><\/div>/);
  // Saved as typed in the HTML view; drawn without the script, and saved without it once edited visually.
  await editor('.rt-surface p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('.');
  await editor('.rt-surface').blur();
  assert.match((await box()).content, /<p>Hi \{\{guess\}\}\.<\/p>$/);
  assert.deepEqual(errors, []);
});

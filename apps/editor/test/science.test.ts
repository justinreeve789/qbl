import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { infoboxRefs, validateScenario, type InfoboxAction, type Scenario, type SceneBench } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * Science in the editor: a close-up bench built in the scene editor (substances from a ready-made
 * set, containers and tools placed on the scene, readouts, watches, a graph), a bench action, and
 * the infobox's maths, worked-out value and graph blocks, typeset and drawn in the preview.
 * Set QBL_SHOTS to a folder to keep screenshots along the way.
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
  page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? 'bench_done' : undefined));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Science');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.stage-overlay');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
async function shot(name: string) {
  if (!process.env.QBL_SHOTS) return;
  await page.waitForTimeout(700); // let what is opening finish opening
  await page.screenshot({ path: `${process.env.QBL_SHOTS}/${name}.png` });
}
async function scenario(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const bench = async (): Promise<SceneBench> => (await scenario()).scenes[0]!.bench!;
const field = (key: string, within = '.inspector') => page.locator(`${within} [data-field="${key}"]`);
/** Type into a field of the inspector and leave it, so it is saved. */
async function type(key: string, value: string, within = '.inspector') {
  const input = field(key, within).locator('input[type=text], input[type=number], textarea').first();
  await input.fill(value);
  await input.blur();
  await saved();
}
const item = (list: string, index: number) => page.locator(`.inspector [data-section=${list}] .bench-item`).nth(index);

test('a scene becomes a close-up bench, with a ready-made set of substances', async () => {
  await page.click('[data-bench-on]');
  await page.waitForSelector('[data-bench=settings]');
  let b = await bench();
  assert.equal(b.enabled, true);
  assert.deepEqual(b.substances?.map((s) => s.id), ['water'], 'it starts with water');
  assert.equal((await scenario()).scenes[0]!.show_avatars, false, 'and the avatars are hidden');

  await page.locator('[data-bench-kits]').selectOption('kitchen');
  await page.waitForFunction(() => document.querySelectorAll('.inspector [data-section=substances] .bench-item').length === 5);
  b = await bench();
  assert.deepEqual(b.substances?.map((s) => s.id), ['water', 'vinegar', 'baking_soda', 'salty_water', 'co2'], 'water is not added twice');
  assert.deepEqual(b.reactions?.map((r) => r.id), ['fizz']);
  assert.match(await item('reactions', 0).locator('summary').innerText(), /Vinegar meets baking soda/);
  await shot('bench-settings');
});

test('containers and tools are added from the menu and stand on the scene', async () => {
  const shape = () => page.locator('.inspector [data-field=shape] select').inputValue();
  await page.selectOption('.add-menu', 'bench-vessel');
  await page.waitForSelector('[data-bench=vessel]');
  assert.equal(await shape(), 'beaker');
  await page.selectOption('.add-menu', 'bench-supply');
  // The new bottle's panel takes the beaker's place.
  await page.waitForFunction(() => (document.querySelector('.inspector [data-field=shape] select') as HTMLSelectElement | null)?.value === 'bottle');
  await type('name', 'Vinegar');
  await type('_contents', '500 vinegar');
  await type('pour', '20');
  await page.selectOption('.add-menu', 'bench-burner');
  await page.waitForSelector('[data-bench=tool]');
  await saved();
  assert.equal(await page.locator('.stage-overlay .bench-vessel').count(), 2);
  assert.equal(await page.locator('.stage-overlay .bench-tool.burner').count(), 1);
  assert.equal(await page.locator('.stage-overlay .bench-vessel .bench-liquid').count(), 1, 'what is in the bottle is drawn');
  const b = await bench();
  assert.deepEqual(b.vessels?.map((v) => [v.id, v.name, v.shape, v.supply ?? false]), [['beaker', 'Beaker', 'beaker', false], ['bottle', 'Vinegar', 'bottle', true]]);
  assert.deepEqual(b.vessels?.[1]?.contents, [{ substance: 'vinegar', amount: 500 }]);
  assert.equal(b.vessels?.[1]?.pour, 20);
  assert.deepEqual([b.tools?.[0]?.kind, b.tools?.[0]?.vessel_id], ['burner', 'beaker'], 'the burner goes under the beaker and heats it');

  // What is typed wrongly is said, and not saved.
  await page.locator('.outline >> text=Vinegar').first().click();
  await page.waitForSelector('[data-bench=vessel]');
  const contents = field('_contents').locator('input');
  await contents.fill('lots of vinegar');
  await contents.blur();
  await page.waitForSelector('.toast.error');
  assert.deepEqual((await bench()).vessels?.[1]?.contents, [{ substance: 'vinegar', amount: 500 }]);

  // Dragged on the scene, it moves.
  const beaker = page.locator('.stage-overlay .bench-vessel').first();
  const at = await beaker.boundingBox();
  await page.mouse.move(at!.x + at!.width / 2, at!.y + at!.height / 2);
  await page.mouse.down();
  await page.mouse.move(at!.x + at!.width / 2 + 60, at!.y + at!.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  const moved = (await bench()).vessels![0]!;
  assert.ok(moved.x > b.vessels![0]!.x && moved.y < b.vessels![0]!.y, 'the beaker moved right and up');
  await shot('bench-canvas');
});

test('readouts, a watch and a graph are added in the bench\'s settings', async () => {
  await page.locator('.outline >> text=Close-up bench').click();
  await page.waitForSelector('[data-bench=settings]');
  await page.click('[data-add=readouts]');
  await page.waitForSelector('[data-section=readouts] .bench-item[open]');
  await saved();
  await page.click('[data-add=readouts]');
  await page.waitForFunction(() => document.querySelectorAll('.inspector [data-section=readouts] .bench-item').length === 2);
  const second = '.inspector [data-section=readouts] .bench-item:nth-child(2)';
  await page.locator(`${second} [data-field=measure] select`).selectOption('released');
  await saved();
  await page.locator(`${second} [data-field=substance] select`).selectOption('co2');
  await type('id', 'gas', second);
  await page.click('[data-add=watches]');
  await page.waitForSelector('[data-section=watches] .bench-item[open]');
  const watch = '.inspector [data-section=watches] .bench-item';
  await page.locator(`${watch} [data-field=reaction_id] select`).selectOption('fizz');
  await page.locator(`${watch} [data-field=variable] select`).selectOption('__new__'); // the prompt answers "bench_done"
  await saved();
  await page.click('[data-add=graph]');
  await page.waitForSelector('[data-section=graph] [data-field=x]');
  const b = await bench();
  assert.deepEqual(b.readouts?.map((r) => [r.id, r.measure, r.vessel_id, r.substance]), [['volume', 'volume', 'beaker', undefined], ['gas', 'released', 'beaker', 'co2']]);
  assert.deepEqual(b.watches?.map((w) => [w.when, w.reaction_id, w.variable]), [['reaction', 'fizz', 'bench_done']]);
  assert.deepEqual(b.graph, { x: 'volume', y: 'gas' });
});

test('a substance given another short name keeps its place in recipes and reactions', async () => {
  const vinegar = '.inspector [data-section=substances] .bench-item:nth-child(2)';
  await page.locator(`${vinegar} summary`).click();
  await type('id', 'acid', vinegar);
  const b = await bench();
  assert.equal(b.substances?.[1]?.id, 'acid');
  assert.deepEqual(b.vessels?.[1]?.contents, [{ substance: 'acid', amount: 500 }]);
  assert.deepEqual(b.reactions?.[0]?.uses, [{ substance: 'acid', amount: 2 }, { substance: 'baking_soda', amount: 1 }]);
  // A reaction is written as an equation; a substance the bench does not have is pointed out.
  const fizz = '.inspector [data-section=reactions] .bench-item';
  await page.locator(`${fizz} summary`).click();
  assert.equal(await page.locator(`${fizz} [data-field=_equation] input`).inputValue(), '2 acid + 1 baking_soda -> 2 salty_water + 6 co2');
  await type('_equation', '3 acid + 1 baking_soda -> 3 salty_water + 8 co2', fizz);
  assert.deepEqual((await bench()).reactions?.[0]?.makes, [{ substance: 'salty_water', amount: 3 }, { substance: 'co2', amount: 8 }]);
  const result = validateScenario(await scenario());
  assert.deepEqual(result.errors, [], 'the bench passes the publish check');
});

test('an event can work the bench', async () => {
  await page.selectOption('.add-menu', 'start');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector .add-action').selectOption('bench');
  await page.waitForSelector('details.action[open] [data-field=op]');
  await page.locator('details.action[open] [data-field=op] select').selectOption('add');
  await saved();
  await page.locator('details.action[open] [data-field=vessel_id] select').selectOption('beaker');
  await page.locator('details.action[open] [data-field=substance] select').selectOption('acid');
  await type('amount', '25', 'details.action[open]');
  const action = (await scenario()).scenes[0]!.start_events!.at(-1)!.actions![0]!;
  assert.deepEqual([action.type, (action as { op?: string }).op, (action as { vessel_id?: string }).vessel_id, (action as { substance?: string }).substance, (action as { amount?: number }).amount], ['bench', 'add', 'beaker', 'acid', 25]);
  assert.match(await page.innerText('.inspector details.action summary'), /Bench: add 25 of “acid” to “beaker”/);
  assert.deepEqual(validateScenario(await scenario()).errors, []);
});

test('an infobox takes typeset maths, a worked-out value and a graph', async () => {
  await page.selectOption('.add-menu', 'hotspot-click');
  await page.waitForSelector('.event-panel');
  await page.locator('.inspector .add-action').selectOption('infobox');
  await page.waitForSelector('details.action[open] .rt-surface');
  const editor = (selector = '') => page.locator(`.inspector details.action .rt ${selector}`.trim());
  const insert = async (kind: string) => {
    await editor('.rt-insert').click();
    await editor(`[data-insert=${kind}]`).click();
    await page.waitForSelector('[data-panel=rt-block]');
  };
  const done = async () => {
    await page.click('[data-panel=rt-block] button.primary');
    await page.waitForSelector('[data-panel=rt-block]', { state: 'detached' });
  };

  await insert('math');
  await page.locator('[data-panel=rt-block] textarea').fill('\\ce{2H2 + O2 -> 2H2O}');
  await page.waitForSelector('[data-panel=rt-block] .rt-math-preview .katex');
  // What cannot be set is said.
  await page.locator('[data-panel=rt-block] textarea').fill('\\frac{1}{');
  await page.waitForSelector('[data-panel=rt-block] .rt-problem:not([hidden])');
  await page.locator('[data-panel=rt-block] textarea').fill('\\rho = \\frac{m}{V}');
  await page.waitForSelector('[data-panel=rt-block] .rt-problem', { state: 'hidden' });
  await shot('math-block');
  await done();
  await editor('.rt-math-card .katex').waitFor();

  await insert('calc');
  await page.locator('[data-panel=rt-block] [data-calc=formula]').fill('bench_done * 2 +');
  await page.waitForSelector('[data-panel=rt-block] .rt-problem:not([hidden])');
  await page.locator('[data-panel=rt-block] [data-calc=formula]').fill('(bench_done + 3) * 2');
  await page.waitForSelector('[data-panel=rt-block] .rt-problem', { state: 'hidden' });
  await done();

  await insert('graph');
  await page.locator('[data-panel=rt-block] textarea').first().fill('bench_done * x^2\nsin(x)');
  await page.locator('[data-panel=rt-block] [data-graph=x]').fill('-4,4');
  await page.locator('[data-panel=rt-block] textarea').nth(1).fill('px,py=1,2');
  await done();
  await saved();

  const action = (await scenario()).scenes[0]!.hotspots!.at(-1)!.actions!.find((a) => a.type === 'infobox') as InfoboxAction;
  assert.match(action.content, /<div data-qbl="math" data-tex="\\rho = \\frac\{m\}\{V\}">\\rho = \\frac\{m\}\{V\}<\/div>/);
  assert.match(action.content, /<p>Result: <span data-qbl="calc" data-formula="\(bench_done \+ 3\) \* 2" data-digits="2"><\/span><\/p>/);
  assert.match(action.content, /<div data-qbl="graph" data-fn="bench_done \* x\^2; sin\(x\)" data-x="-4,4" data-y="-2,10" data-points="px,py=1,2"><\/div>/);
  const refs = infoboxRefs(action.content);
  assert.deepEqual([refs.uses, refs.writes, refs.reads.sort()], [{ formula: true, math: true, graph: true }, ['px', 'py'], ['bench_done']]);
  const said = validateScenario(await scenario()).errors.map((e) => e.message).join('\n');
  assert.match(said, /saves a graph point.*"px"/, 'the point\'s variables have to exist');

  // The preview is the game's own box: typeset, worked out and drawn.
  await editor('.rt-designer-open').click();
  const stage = page.locator('[data-panel=infobox-designer] .rt-stage');
  await stage.locator('.qbl-math .katex').waitFor();
  await stage.locator('.qbl-graph-board svg').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-panel=infobox-designer] .rt-stage .qbl-calc')?.textContent === '6');
  assert.ok(await stage.locator('.qbl-graph-board svg path').count() >= 2, 'both curves are drawn');
  await shot('designer');
  await page.click('[data-panel=infobox-designer] .panel-close');
});

test('nothing went wrong on the page', () => {
  assert.deepEqual(errors, []);
});

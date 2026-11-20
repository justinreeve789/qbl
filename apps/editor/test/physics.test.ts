import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { validateScenario, type Scenario, type ScenePhysics } from '@qbl/shared';
import { chromium, type Browser, type Page } from 'playwright';
import { startSite, type TestSite } from './servers';

/**
 * A physics experiment made in the scene editor: switched on (avatars go), bodies, a glass of
 * water, a joint, a bridge-building area, readouts, the tray, a watch and a physics action,
 * each checked in the JSON the game gets.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let id = 0;

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
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
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Lab');
  await page.check('[data-dialog=new-scenario] input[value=empty]');
  await page.click('[data-dialog=new-scenario] button[type=submit]');
  await page.waitForSelector('.scene-card');
  id = Number(/#\/s\/(\d+)/.exec(page.url())![1]);
  await page.click('.scene-card >> text=Edit');
  await page.waitForSelector('.scene-editor');
});

after(async () => {
  await browser?.close();
  await site?.close();
});

const saved = () => page.waitForFunction(() => !document.querySelector('.saving')?.textContent?.includes('Saving'));
const inspector = (selector: string) => page.locator(`.inspector ${selector}`);
async function type(selector: string, value: string) {
  const input = page.locator(selector).first();
  await input.fill(value);
  await input.blur();
  await saved();
}
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}
const physics = async (): Promise<ScenePhysics> => (await draft()).scenes[0]!.physics!;

test('switching physics on hides the avatars and opens the experiment', async () => {
  await page.click('[data-physics-on]');
  await page.waitForSelector('.inspector [data-physics=settings]');
  await saved();
  const scene = (await draft()).scenes[0]!;
  assert.equal(scene.physics?.enabled, true);
  assert.equal(scene.show_avatars, false);
  await inspector('[data-field=mode] select').selectOption('shared');
  await type('.inspector [data-field=gravity] input[type=number]', '1.62');
  await inspector('[data-field=_floor] select').selectOption('none');
  await saved();
  await inspector('[data-field="press.enabled"] input').check();
  await saved();
  await type('.inspector [data-field="press.rate"] input', '250');
  const p = await physics();
  assert.equal(p.mode, 'shared');
  assert.equal(p.gravity, 1.62);
  assert.equal(p.floor_y, null);
  assert.deepEqual(p.press, { enabled: true, rate: 250 });
});

test('bodies, a glass of water and a joint, from the add menu', async () => {
  await page.selectOption('.add-menu', 'physics-body');
  await page.waitForSelector('.inspector [data-physics=bodies]');
  await type('.inspector [data-field=name] input', 'Bob');
  await inspector('[data-field=material] select').selectOption('steel');
  await saved();
  await type('.inspector [data-field=radius] input[type=number]', '25');
  // The material's own numbers are what an empty box means.
  assert.equal(await inspector('[data-field=bounciness] input[type=number]').getAttribute('placeholder'), 'Steel: 0.6');

  await page.selectOption('.add-menu', 'physics-cup');
  await page.waitForSelector('.inspector [data-physics=bodies] >> text=id: glass');
  await page.selectOption('.add-menu', 'physics-joint');
  await page.waitForSelector('.inspector [data-physics=joints]');
  await inspector('[data-field=type] select').selectOption('pin');
  await saved();
  await type('.inspector [data-field=strength] input', '500');

  // Bodies on the canvas can be dragged.
  const before = (await physics()).bodies![0]!;
  const ball = page.locator('.phys-body').first();
  const box = (await ball.boundingBox())!;
  // Off its middle: the joint's pin sits there.
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8 + 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await saved();

  const p = await physics();
  assert.equal(p.bodies!.length, 2);
  assert.deepEqual({ ...p.bodies![0], x: 0, y: 0 }, { id: 'ball', name: 'Bob', shape: 'circle', x: 0, y: 0, radius: 25, material: 'steel' });
  assert.ok(p.bodies![0]!.x > before.x + 20, 'the ball was dragged');
  assert.deepEqual(p.bodies![1], { ...p.bodies![1], id: 'glass', shape: 'cup', fixed: true });
  assert.deepEqual(p.water, [{ ...p.water![0], body_id: 'glass', level: 140, marks: true }]);
  assert.deepEqual(p.joints, [{ ...p.joints![0], type: 'pin', body_a: 'ball', strength: 500 }]);
  assert.equal(await page.locator('.outline [data-section="Physics bodies"] li').count(), 2);
});

test('readouts, the tray and a watch that runs an event', async () => {
  // An indirect event for the watch to run.
  await page.locator('.outline [data-section="Indirect events"] summary button').click();
  await page.waitForSelector('.inspector .event-panel');
  await page.locator('.outline >> text=Physics experiment').first().click();
  await page.waitForSelector('.inspector [data-physics=settings]');

  await page.click('.inspector [data-section=readouts] >> text=+ Add readout');
  await saved();
  const readout = '.inspector [data-physics-item="readouts:readout"]';
  await page.locator(`${readout} [data-field=measure] select`).selectOption('bounce_height');
  await saved();
  await page.locator(`${readout} [data-field=body_id] select`).selectOption('ball');
  await saved();

  await page.click('.inspector [data-section=tray] >> text=+ Add to the tray');
  await saved();
  await type('.inspector [data-physics-item="tray:weight"] [data-field=count] input', '3');

  await page.click('.inspector [data-section=watches] >> text=+ Add watch');
  await saved();
  const watch = '.inspector [data-physics-item="watches:watch"]';
  await page.locator(`${watch} [data-field=when] select`).selectOption('reading');
  await saved();
  await page.locator(`${watch} [data-field=readout_id] select`).selectOption('readout');
  await saved();
  await type(`${watch} [data-field=value] input`, '0.5');
  const indirect = (await draft()).scenes[0]!.indirect_events![0]!;
  await page.locator(`${watch} [data-field=event_id] select`).selectOption(String(indirect.id));
  await saved();

  const p = await physics();
  assert.deepEqual(p.readouts, [{ id: 'readout', measure: 'bounce_height', body_id: 'ball' }]);
  assert.deepEqual(p.tray, [{ id: 'weight', label: '1 kg', count: 3, body: { shape: 'box', width: 40, height: 40, mass: 1, material: 'steel', label: '1 kg' } }]);
  assert.deepEqual(p.watches, [{ id: 'watch', when: 'reading', readout_id: 'readout', value: 0.5, event_id: indirect.id }]);
});

test('a bridge-building area, and a physics action in an event', async () => {
  await page.selectOption('.add-menu', 'physics-build');
  await page.waitForSelector('.inspector [data-physics=build]');
  await type('.inspector [data-physics=build] [data-field=budget] input', '1500');
  await page.click('.inspector [data-section=anchors] >> text=+ Add footing');
  await saved();
  let p = await physics();
  assert.equal(p.build!.budget, 1500);
  assert.equal(p.build!.anchors.length, 3);
  assert.deepEqual(p.build!.beams.map((b) => b.label), ['Road', 'Wood', 'Steel']);

  // A start event that sets the Moon's gravity.
  await page.locator('.outline [data-section="Start events"] summary button').click();
  await page.waitForSelector('.inspector .event-panel');
  await page.locator('.inspector select.add-action').first().selectOption('physics');
  await saved();
  await page.locator('.inspector [data-field=op] select').last().selectOption('gravity');
  await saved();
  await type('.inspector [data-field=value] input[type=number]', '3.71');
  const doc = await draft();
  const action = doc.scenes[0]!.start_events![0]!.actions[0]!;
  assert.deepEqual({ type: action.type, op: (action as { op?: string }).op, value: (action as { value?: number }).value }, { type: 'physics', op: 'gravity', value: 3.71 });

  // What the editor made is a valid scenario.
  const check = validateScenario(doc);
  assert.deepEqual(check.errors.filter((e) => e.path.includes('physics')), []);
  p = doc.scenes[0]!.physics!;
  assert.equal(p.enabled, true);
  assert.deepEqual(errors, []);
});

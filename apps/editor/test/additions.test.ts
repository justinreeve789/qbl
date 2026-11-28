import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { Scenario } from '@qbl/shared';
import { startSite, type TestSite } from './servers';

/**
 * The glossary, scene groups and team limits, shadow spots, placement of labels, and the
 * teacher's report, in a real browser against the real backend classes.
 */
let site: TestSite;
let browser: Browser;
let page: Page;
let id = 0;
const errors: string[] = [];

before(async () => {
  site = await startSite();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  // A student who has signed in once, for the class.
  await fetch(`${site.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'student.ann@example.test', password: 'x' }) });

  await page.goto(`${site.url}/editor/`);
  await page.fill('input[type=email]', 'author@example.test');
  await page.fill('input[type=password]', 'anything');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-scenario]');
  await page.click('button:has-text("New scenario")');
  await page.fill('[data-dialog=new-scenario] input[name=title]', 'Additions');
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
async function type(selector: string, value: string) {
  const input = page.locator(selector).first();
  await input.fill(value);
  await input.blur();
  await saved();
}
/** The scenario JSON as the game would get it now. */
async function draft(): Promise<Scenario> {
  await saved();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const res = await fetch(`${site.url}/api/editor/scenarios/${id}/preview`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { scenario: Scenario }).scenario;
}

test('the glossary page: words, and which are there from the start', async () => {
  await page.click('.tabs a[data-tab=glossary]');
  await page.waitForSelector('.page h1:has-text("Glossary")');
  await page.click('button:has-text("New word")');
  const word = 'dialog[data-panel=word]';
  await page.waitForSelector(word);
  await type(`${word} [data-field=term] input`, 'pH');
  await type(`${word} [data-field=definition] textarea`, 'How acidic or basic water is.');
  assert.match(await page.innerText(`${word} .word-status`), /No action gives this word yet/);
  await page.check(`${word} [data-field=initial] input`);
  await page.waitForFunction(() => document.querySelector('dialog[data-panel=word] .word-status')?.textContent?.includes('from the start'));
  assert.match(await page.innerText(`${word} .word-preview`), /pH[\s\S]*How acidic or basic water is\./, 'the preview shows the word as players read it');
  assert.deepEqual((await draft()).glossary, [{ id: 'word-1', term: 'pH', definition: 'How acidic or basic water is.', initial: true }]);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog[data-panel]', { state: 'detached' });
  assert.match(await page.innerText('[data-word] .word-status'), /from the start/);
});

test('scene groups: a group limited to teams, and a scene that says otherwise', async () => {
  await page.click('.tabs a[data-tab=scenes]');
  await page.waitForSelector('[data-card=scene-groups]');
  assert.match(await page.innerText('.scene-card .scene-group'), /Everyone/);
  await page.click('[data-card=scene-groups] button:has-text("New group")');
  await page.waitForSelector('[data-group]');
  await type('[data-group] [data-field=name] input', 'Planet');
  await page.check('[data-group] [data-field=team_only] input');
  await saved();
  await page.locator('.scene-card .scene-group select').selectOption({ label: 'Planet' });
  await page.waitForFunction(() => document.querySelector('.scene-card .scene-group')?.textContent?.includes('Own team only'));
  let d = await draft();
  assert.deepEqual(d.scene_groups, [{ id: 1, name: 'Planet', team_only: true }]);
  assert.equal(d.scenes[0]!.group_id, 1);
  assert.equal(d.scenes[0]!.team_only, undefined, 'the scene itself says nothing: its group decides');

  // In the scene's own settings: this one shows everyone after all.
  await page.click('.scene-card button:has-text("Edit")');
  await page.waitForSelector('.inspector [data-field=team_only]');
  await page.locator('.inspector [data-field=team_only] select').selectOption('false');
  d = await draft();
  assert.equal(d.scenes[0]!.team_only, false);
  // Or nobody else at all: each player has the scene to themselves.
  await page.locator('.inspector [data-field=team_only] select').selectOption('alone');
  assert.equal((await draft()).scenes[0]!.team_only, 'alone');
  assert.equal(await page.locator('.inspector [data-field=team_only] select').inputValue(), 'alone', 'and the setting reads it back');
  await page.locator('.inspector [data-field=team_only] select').selectOption('');
  assert.equal((await draft()).scenes[0]!.team_only, undefined, 'and back to what the group says');
});

test('a shadow spot is added to the scene, drawn, and edited', async () => {
  await page.locator('select:has(option[value=shadow_spots])').selectOption('shadow_spots');
  await page.waitForSelector('svg .shadow-spot.selected');
  await type('.inspector [data-field=strength] input[type=number]', '80');
  await type('.inspector [data-field=radius] input[type=number]', '200');
  const spots = (await draft()).scenes[0]!.shadow_spots!;
  assert.equal(spots.length, 1);
  assert.deepEqual([spots[0]!.radius, spots[0]!.radius_y, spots[0]!.strength, spots[0]!.name], [200, 70, 80, 'shade']);
  assert.match(await page.innerText('.outline'), /Shadow spots/);
});

test('a light is placed and edited; the scene gets a living sky and fireflies', async () => {
  await page.locator('select:has(option[value=lights])').selectOption('lights');
  await page.waitForSelector('svg .light-spot.selected');
  await page.locator('.inspector [data-field=kind] select').selectOption('fire');
  await type('.inspector [data-field=radius] input[type=number]', '150');
  let scene = (await draft()).scenes[0]!;
  assert.deepEqual([scene.lights![0]!.kind, scene.lights![0]!.radius, scene.lights![0]!.name], ['fire', 150, 'lantern']);
  // Conditions switch it on and off; with none it is always on, and the canvas says which are switched.
  assert.match(await page.innerText('.inspector [data-section=conditions]'), /Always on/);
  assert.equal(await page.locator('svg [data-light-switch]').count(), 0);
  await page.click('.inspector [data-section=conditions] button:has-text("Add condition")');
  await page.waitForSelector('.inspector [data-section=conditions] .condition');
  await page.locator('.inspector [data-section=conditions] .condition select').nth(1).selectOption('>=');
  scene = (await draft()).scenes[0]!;
  assert.equal(scene.lights![0]!.conditions!.length, 1);
  assert.equal(scene.lights![0]!.conditions![0]!.operator, '>=');
  await page.waitForSelector('svg [data-light-switch]');
  await page.click('.inspector [data-section=conditions] button[title="Remove condition"]');
  await page.waitForFunction(() => !document.querySelector('svg [data-light-switch]'));
  assert.equal((await draft()).scenes[0]!.lights![0]!.conditions, undefined, 'no conditions left: the key is gone');
  assert.match(await page.innerText('.outline'), /Lights/);
  // Its glow (how far it reaches) is drawn only while it is selected; the marker stays.
  assert.equal(await page.locator('svg .light-glow').count(), 3);
  await page.click('.outline >> text=Scene settings');
  await page.waitForFunction(() => !document.querySelector('svg .light-glow'));
  assert.equal(await page.locator('svg .light-spot').count(), 1);
  await page.locator('.inspector [data-field=time] select').selectOption('golden');
  await page.locator('.inspector [data-field=until] select').selectOption('dusk');
  // What is in the air comes first; the weather's kind is below it.
  await page.locator('.inspector [data-field=kind] select').first().selectOption('fireflies');
  await page.waitForSelector('.stage .sky-preview');
  scene = (await draft()).scenes[0]!;
  assert.deepEqual([scene.sky, scene.atmosphere], [{ time: 'golden', until: 'dusk' }, [{ kind: 'fireflies' }]]);
  // No time of day: no sky.
  await page.locator('.inspector [data-field=time] select').selectOption('');
  await page.waitForFunction(() => !document.querySelector('.stage .sky-preview'));
  assert.equal((await draft()).scenes[0]!.sky, undefined);
});

test('flowing water is placed and edited; the scene gets weather and plays by itself as a story', async () => {
  await page.locator('select:has(option[value=flows])').selectOption('flows');
  await page.waitForSelector('svg .flow-area.selected');
  await page.locator('.inspector [data-field=kind] select').selectOption('waterfall');
  await page.locator('.inspector [data-field=layer] select').selectOption('over');
  let scene = (await draft()).scenes[0]!;
  assert.deepEqual([scene.flows![0]!.kind, scene.flows![0]!.layer, scene.flows![0]!.name], ['waterfall', 'over', 'river']);
  assert.match(await page.innerText('.outline'), /Flowing water/);
  await page.click('.outline >> text=Scene settings');
  await page.locator('.inspector [data-field=kind] select').nth(1).selectOption('storm');
  await type('.inspector [data-field=intensity] input[type=number]', '0.9');
  await page.check('.inspector [data-field=story] input');
  scene = (await draft()).scenes[0]!;
  assert.deepEqual([scene.weather, scene.story], [{ kind: 'storm', intensity: 0.9 }, true]);
  // No kind: no weather; and back to a scene players walk in.
  await page.locator('.inspector [data-field=kind] select').nth(1).selectOption('');
  await page.uncheck('.inspector [data-field=story] input');
  scene = (await draft()).scenes[0]!;
  assert.deepEqual([scene.weather, scene.story], [undefined, undefined]);
  // A scenario launcher scene: ticked and unticked, it says so (unticked overrides a travel action).
  assert.equal(await page.isChecked('.inspector [data-field=launcher] input'), false);
  await page.check('.inspector [data-field=launcher] input');
  await saved();
  assert.equal((await draft()).scenes[0]!.launcher, true);
  await page.uncheck('.inspector [data-field=launcher] input');
  await saved();
  assert.equal((await draft()).scenes[0]!.launcher, false);
});

test('underwater light is placed, moves on the canvas, and shows the settings for its kind', async () => {
  await page.locator('select:has(option[value=flows])').selectOption('water-ripples');
  await page.waitForSelector('svg .water-light-area.selected');
  // Ripples lie on a floor that leans away; shafts fan out. Each shows only its own.
  assert.equal(await page.locator('.inspector [data-field=tilt]').count(), 1);
  assert.equal(await page.locator('.inspector [data-field=spread]').count(), 0);
  // Ripples light the people and things standing in them; how strongly is a setting of their own.
  await type('.inspector [data-field=figures] input[type=number]', '40');
  assert.equal((await draft()).scenes[0]!.water_lights![0]!.figures, 40);
  // The canvas runs the game's shader, where the browser has WebGL.
  if (await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'))) {
    await page.waitForSelector('svg .water-light-view canvas.water-light-preview');
  }
  await type('.inspector [data-field=strength] input[type=number]', '75');
  await page.locator('.inspector [data-field=edge] select').selectOption('oval');
  let light = (await draft()).scenes[0]!.water_lights![0]!;
  assert.deepEqual([light.kind, light.strength, light.edge, light.name], ['ripples', 75, 'oval', 'rippling light']);

  await page.locator('.inspector [data-field=kind] select').selectOption('shafts');
  await page.waitForSelector('.inspector [data-field=spread]');
  assert.equal(await page.locator('.inspector [data-field=tilt]').count(), 0);
  assert.equal(await page.locator('.inspector [data-field=figures]').count(), 0, 'shafts are in front of everyone: no setting');
  await type('.inspector [data-field=spread] input[type=number]', '60');
  light = (await draft()).scenes[0]!.water_lights![0]!;
  assert.deepEqual([light.kind, light.spread], ['shafts', 60]);
  assert.match(await page.innerText('.outline'), /Underwater light/);

  await page.locator('select:has(option[value=flows])').selectOption('water-shafts');
  await page.waitForFunction(() => document.querySelectorAll('svg .water-light-area').length === 2);
  assert.deepEqual((await draft()).scenes[0]!.water_lights!.map((w) => w.kind), ['shafts', 'shafts']);
  await page.click('.inspector button.danger:has-text("Delete")');
  await page.waitForFunction(() => document.querySelectorAll('svg .water-light-area').length === 1);
});

test('rippling light gets a shape of its own, edited by its corners, and can be a box again', async () => {
  await page.locator('select:has(option[value=flows])').selectOption('water-ripples');
  await page.waitForFunction(() => document.querySelectorAll('svg .water-light-area').length === 2);
  await page.click('.inspector [data-water-shape=own]');
  await page.waitForSelector('svg polygon.water-light-area.selected');
  // Moved by its corners now: no box fields, and it fades out inside its outline.
  for (const key of ['x', 'width', 'edge']) assert.equal(await page.locator(`.inspector [data-field=${key}]`).count(), 0, key);
  let light = (await draft()).scenes[0]!.water_lights![1]!;
  assert.equal(light.shape!.length, 8);

  // Drag a corner up and left: the outline changes, and the box follows it.
  const corner = page.locator('svg circle.handle:not(.add)').first();
  const at = (await corner.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x - 30, at.y - 40, { steps: 5 });
  await page.mouse.up();
  await saved();
  const moved = (await draft()).scenes[0]!.water_lights![1]!;
  assert.notDeepEqual(moved.shape![0], light.shape![0]);
  assert.equal(moved.x, Math.min(...moved.shape!.map((p) => p.x)), 'the box is the outline\'s bounds');
  assert.equal(moved.y + moved.height, Math.max(...moved.shape!.map((p) => p.y)));

  // Pull a new corner out of the middle of a side.
  const middle = (await page.locator('svg circle.handle.add').first().boundingBox())!;
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + 20, middle.y + 30, { steps: 5 });
  await page.mouse.up();
  await saved();
  light = (await draft()).scenes[0]!.water_lights![1]!;
  assert.equal(light.shape!.length, 9);
  assert.match(await page.innerText('.inspector [data-section=shape]'), /9 corners/);

  await page.click('.inspector [data-water-shape=box]');
  await page.waitForSelector('svg rect.water-light-area.selected');
  light = (await draft()).scenes[0]!.water_lights![1]!;
  assert.equal(light.shape, undefined);
  assert.equal(await page.locator('.inspector [data-field=width]').count(), 1);
});

test('fog is drawn as an outline, drifts outward from a point that can be dragged, and more than one can be added', async () => {
  await page.locator('select:has(option[value=flows])').selectOption('fogs');
  await page.waitForSelector('svg polygon.fog-area.selected');
  let fog = (await draft()).scenes[0]!.fogs![0]!;
  assert.deepEqual([fog.name, fog.shape.length, fog.direction, fog.speed], ['fog', 4, 'right', 25], 'a box of four corners, drifting right');
  if (await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'))) {
    await page.waitForSelector('svg .fog-view canvas.fog-preview');
  }
  await type('.inspector [data-field=opacity] input[type=number]', '80');
  await type('.inspector [data-field=density] input[type=number]', '30');
  await type('.inspector [data-field=speed] input[type=number]', '60');
  await page.locator('.inspector [data-field=layer] select').selectOption('behind');
  fog = (await draft()).scenes[0]!.fogs![0]!;
  assert.deepEqual([fog.opacity, fog.density, fog.speed, fog.layer], [80, 30, 60, 'behind']);
  // Drifting across: no point to spread from.
  assert.equal(await page.locator('.inspector [data-section=fog-point]').count(), 0);
  assert.equal(await page.locator('svg .fog-origin').count(), 0);

  // A corner pulled out of the middle of a side makes it any shape.
  const middle = (await page.locator('svg circle.handle.add').first().boundingBox())!;
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + 20, middle.y - 40, { steps: 5 });
  await page.mouse.up();
  await saved();
  assert.equal((await draft()).scenes[0]!.fogs![0]!.shape.length, 5);

  // Outward: from the middle until the point is dragged somewhere else, and back again.
  await page.locator('.inspector [data-field=direction] select').selectOption('outward');
  await page.waitForSelector('.inspector [data-section=fog-point]');
  assert.match(await page.innerText('.inspector [data-section=fog-point]'), /Spreads out from[\s\S]*middle of the outline/);
  const point = (await page.locator('svg g.fog-origin circle').boundingBox())!;
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + 60, point.y + 30, { steps: 5 });
  await page.mouse.up();
  await saved();
  fog = (await draft()).scenes[0]!.fogs![0]!;
  assert.equal(fog.direction, 'outward');
  assert.ok(fog.origin && typeof fog.origin.x === 'number', 'the point is kept');
  await page.waitForSelector('.inspector [data-fog-point=middle]');
  assert.match(await page.innerText('.inspector [data-section=fog-point]'), new RegExp(`The point at ${fog.origin!.x}, ${fog.origin!.y}`));
  await page.click('.inspector [data-fog-point=middle]');
  await page.waitForFunction(() => !document.querySelector('.inspector [data-fog-point=middle]'));
  assert.equal((await draft()).scenes[0]!.fogs![0]!.origin, undefined);
  assert.match(await page.innerText('.outline'), /Fog[\s\S]*spreads out/);

  // A scene may have as many as it likes.
  await page.locator('select:has(option[value=flows])').selectOption('fogs');
  await page.waitForFunction(() => document.querySelectorAll('svg .fog-area').length === 2);
  assert.equal((await draft()).scenes[0]!.fogs!.length, 2);
  await page.click('.inspector button.danger:has-text("Delete")');
  await page.waitForFunction(() => document.querySelectorAll('svg .fog-area').length === 1);
});

test('a hotspot label can be background, or a solid object players walk around', async () => {
  await page.locator('select:has(option[value=shadow_spots])').selectOption('hotspot-click');
  await page.click('text=+ Add label');
  await page.waitForSelector('.inspector [data-field=placement]');
  await page.locator('.inspector [data-field=placement] select').first().selectOption('background');
  let label = (await draft()).scenes[0]!.hotspots![0]!.labels![0]!;
  assert.equal(label.placement, 'background');
  // Pictures can be solid; the first label of a new hotspot is text, so make it a picture.
  await page.locator('.inspector .card.flat [data-field=type] select').first().selectOption('image');
  await page.waitForSelector('.inspector [data-field=solid]');
  await page.check('.inspector [data-field=solid] input');
  await page.waitForSelector('.inspector [data-field=solid_radius]');
  await type('.inspector [data-field=solid_radius] input[type=number]', '90');
  label = (await draft()).scenes[0]!.hotspots![0]!.labels![0]!;
  assert.deepEqual([label.solid, label.solid_radius], [true, 90]);
});

test('a glossary action and a narrated dialogue are offered among the actions', async () => {
  const d = await draft();
  const token = await page.evaluate(() => localStorage.getItem('qbl.token'));
  const event = d.scenes[0]!.hotspots![0]!.id;
  for (const [type, params] of [['glossary', { entry_id: 'word-1' }], ['dialogue', { text: 'Hello', narrate: true }], ['award', { stars: 1, badge: 'First steps' }]] as const) {
    const res = await fetch(`${site.url}/api/editor/scenarios/${id}/rows/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ event_id: event, type, params }) });
    assert.equal(res.status, 201, `${type}: ${await res.text()}`);
  }
  await page.reload();
  await page.waitForSelector('.outline');
  await page.click('.outline >> text=Hotspots');
  const actions = (await draft()).scenes[0]!.hotspots![0]!.actions;
  assert.deepEqual(actions.slice(-3).map((a) => a.type), ['glossary', 'dialogue', 'award']);
  assert.equal((actions.at(-2) as { narrate?: boolean }).narrate, true);
  assert.equal((actions.at(-1) as { badge?: string }).badge, 'First steps');
});

test('the report on an assignment: students, summary and the message log', async () => {
  await page.click('.top-nav >> text=Classes');
  await page.waitForSelector('[data-card=students]');
  await page.fill('[data-form=add-student] input', 'student.ann@example.test');
  await page.click('[data-form=add-student] button');
  await page.waitForFunction(() => document.querySelector('[data-card=students]')?.textContent?.includes('student.ann@example.test'));
  await page.click('button:has-text("Assign a mission")');
  const form = page.locator('[data-form=new-assignment]');
  await form.locator('select[aria-label=Mission]').selectOption({ label: 'Starship Explorer' });
  await form.locator('input[type=checkbox]').first().check();
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('[data-assignment]');

  await page.click('[data-assignment] [data-action=report]');
  await page.waitForSelector('[data-card=report] .report-table');
  assert.match(await page.innerText('[data-card=report] .report-eyebrow'), /Mission report/i);
  assert.match(await page.innerText('[data-card=report] h2'), /Starship Explorer/);
  assert.match(await page.innerText('.report-summary'), /0\/1\s*students have started/);
  assert.match(await page.innerText('.report-legend'), /Not started\s*1/);
  // The filters narrow the table to one kind of student.
  await page.click('.report-filter[data-status=finished]');
  await page.waitForSelector('.report-students .empty');
  await page.click('.report-filter[data-status=all]');
  await page.waitForSelector('.report-table tr[data-student]');
  const row = page.locator('.report-table tr[data-student]');
  assert.equal(await row.count(), 1);
  assert.match(await row.innerText(), /Not started/);
  await row.locator('button.link').click();
  await page.waitForSelector('.report-detail');
  assert.doesNotMatch(await page.innerText('.report-detail'), /\{\{/, 'placeholders in objective text are not shown raw');
  assert.match(await page.innerText('.report-detail'), /Objectives[\s\S]*Questions[\s\S]*Where they went/i);

  await page.click('[data-card=report] .tabs >> text=Messages');
  await page.waitForSelector('[data-card=report] .empty');
  assert.match(await page.innerText('[data-card=report] .empty'), /No messages have been sent/);
  await page.click('button:has-text("Back to classes")');
  await page.waitForSelector('[data-assignment]');
});

test('nothing went wrong in the browser along the way', () => {
  assert.deepEqual(errors, []);
});

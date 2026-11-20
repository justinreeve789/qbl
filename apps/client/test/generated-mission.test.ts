/**
 * A mission made by the AI scenario generator, played from the briefing to the debrief through the real
 * engine (headless, offline), by one student who changes roles to do every role's job.
 *
 * The mission is the one `npm run test:generation` makes from apps/api/tests/fixtures/generation/blueprint.php,
 * so this runs from there (QBL_GENERATED_SCENARIO names the scenario.json) and is skipped otherwise.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { Game } from './harness';

const file = process.env.QBL_GENERATED_SCENARIO;

function hot(g: Game, name: string) {
  const h = (g.scene.def.hotspots ?? []).find((h) => h.shortname === name);
  if (!h) throw new Error(`no hotspot ${name} in ${g.sceneName}`);
  return h;
}
async function clickHot(g: Game, name: string) {
  const h = hot(g, name);
  await g.click(h.position_x!, h.position_y!);
}
/** Click through every story line showing until none is left. */
async function talk(g: Game, max = 20) {
  for (let i = 0; i < max; i++) {
    await g.wait(200);
    if (!g.ui.stories.length) return;
    g.ui.stories[0].next();
  }
  await g.wait(200);
}
async function runIndirect(g: Game, name: string) {
  const e = (g.scene.def.indirect_events ?? []).find((e) => e.shortname === name)!;
  void (g.scene as any).engine.trigger(e);
  await g.wait(100);
}

test('a generated mission plays from the briefing to the debrief', { skip: !file && 'run by npm run test:generation' }, async () => {
  const g = new Game(normalizeScenario(JSON.parse(readFileSync(file!, 'utf8')) as Scenario));
  await g.wait(300);
  assert.equal(g.sceneName, 'landing');
  await talk(g); // the briefing
  // Choosing a role comes up by itself.
  assert.match(g.box!.html, /Crew station/);
  await g.choose('Be the Botanist');
  assert.match(g.box!.html, /You are the Botanist/);
  assert.match(g.box!.html, /Read the humidity gauge/);
  await g.dismiss();
  assert.equal(g.var('my_role'), 1);
  assert.equal(g.var('crew_botanist'), 1);
  assert.match(g.checklist[0], /^\[x\] Choose a crew role .*Botanist/);

  await clickHot(g, 'label-keeper');
  await talk(g);
  assert.equal(g.var('done_talk_keeper'), 1);

  // Into the greenhouse through its door.
  await clickHot(g, 'way-greenhouse');
  await g.wait(4000);
  assert.equal(g.sceneName, 'greenhouse');
  await clickHot(g, 'read_humidity');
  assert.match(g.box!.html, /95%/);
  assert.match(g.box!.html, /Added to the crew log/);
  await g.dismiss();
  assert.equal(g.var('found_read_humidity'), 'Humidity: 95%. The air is soaking wet.');
  await clickHot(g, 'reroute-botanist');
  await g.wait(3500);
  assert.equal(g.var('team_reroute'), 1);
  await g.walkOff('down', 'landing');

  // Change roles to do the engineer's part.
  await clickHot(g, 'crew-station');
  assert.match(g.box!.html, /Humidity: 95%/);
  await g.choose('Be the Engineer');
  await g.dismiss();
  assert.equal(g.var('my_role'), 2);
  assert.equal(g.var('crew_botanist'), 0);
  assert.equal(g.var('crew_engineer'), 1);
  await clickHot(g, 'way-greenhouse');
  await g.wait(4000);
  await clickHot(g, 'reroute-engineer');
  await g.wait(4500);
  assert.equal(g.var('team_reroute'), 2);
  assert.ok(g.ui.texts.some((t) => t.includes('greenhouse dries out')));
  await g.walkOff('down', 'landing');

  // To the orchard (around the crate); samples; the question; the twist.
  await g.walkTo(1700, 1150);
  await g.walkOff('right', 'orchard');
  await clickHot(g, 'pollen_a');
  await g.dismiss();
  await clickHot(g, 'pollen_b');
  await g.dismiss();
  assert.match(g.box!.html, /What does a flower need/);
  await g.choose('More sunlight');
  assert.match(g.box!.html, /Not quite/);
  await g.dismiss();
  // The twist: everyone in the scene sees it; it blocks the way to the hive.
  await g.wait(3000);
  await talk(g);
  assert.equal(g.var('twist_burst'), 1);
  assert.equal(g.var('blocked_burst'), 1);
  await clickHot(g, 'q_pollen');
  await g.choose('Pollen carried');
  await g.dismiss();
  assert.equal(g.var('score'), 0, 'the first answer was wrong');
  assert.equal(g.var('done_q_pollen'), 1);
  await clickHot(g, 'obstacle-burst');
  assert.ok(g.ui.texts.some((t) => t.includes('Mud blocks the path')));
  await clickHot(g, 'drain');
  await g.dismiss();
  assert.equal(g.var('blocked_burst'), 0);

  // Down the hole, look around, back up the ladder.
  await clickHot(g, 'way-burrow');
  await g.wait(4000);
  assert.equal(g.sceneName, 'burrow');
  await clickHot(g, 'check_pipes');
  assert.match(g.box!.html, /cracked/);
  await g.dismiss();
  assert.equal(g.var('done_check_pipes'), 1);
  const feather = hot(g, 'find_feather');
  await g.walkTo(feather.position_x!, feather.position_y! + 120);
  await clickHot(g, 'find_feather');
  assert.match(g.box!.html, /feather/);
  await g.dismiss();
  await clickHot(g, 'way-orchard');
  await g.wait(4000);
  assert.equal(g.sceneName, 'orchard');

  // Up to the hive.
  const door = hot(g, 'exit-top');
  await g.walkTo(door.position_x!, door.position_y! + 140);
  await g.hold(['up'], () => g.sceneName === 'hive');
  await g.wait(300);
  await runIndirect(g, 'chat-bot'); // Pip paces about; clicking him runs this
  await talk(g);
  assert.equal(g.var('done_talk_pip'), 1);
  assert.match(g.box!.html, /Make a prediction/);
  await g.choose('Stay away');
  assert.match(g.box!.html, /Prediction noted/);
  await g.dismiss();
  assert.equal(g.var('q_q_predict_answer'), 'Stay away');
  await clickHot(g, 'track');
  for (let i = 0; i < 22; i++) await g.choose('Spray less often');
  assert.match(g.box!.html, /You did it/);
  await g.dismiss();
  assert.equal(g.var('done_track'), 1);
  await clickHot(g, 'valves');
  await g.wait(3500);
  assert.equal(g.var('team_valves'), 1);
  // A second crew member does their part (in a real game: another student).
  g.ctx.vars.apply('helped_valves', 'set', 0);
  await g.wait(600);
  await clickHot(g, 'valves');
  await g.wait(4500);
  assert.equal(g.var('team_valves'), 2);
  assert.deepEqual(g.checklist.filter((l) => l.startsWith('[ ]')), ['[ ] Look closely at a flower', '[ ] Report to Keeper Ama']);

  // Back to report.
  await g.walkOff('down', 'orchard');
  await g.walkOff('left', 'landing');
  await g.wait(500);
  await clickHot(g, 'label-keeper');
  await talk(g, 1);
  assert.match(g.box!.html, /Your crew log/);
  await g.dismiss();
  assert.match(g.box!.html, /Why did the pollinators leave/);
  await g.choose('It was too cold');
  await g.dismiss();
  await talk(g);
  assert.equal(g.var('mission_complete'), 0);
  await clickHot(g, 'label-keeper');
  await talk(g, 1);
  await g.dismiss();
  assert.match(g.box!.html, /Why did the pollinators leave/, 'only the question not yet answered right is asked again');
  await g.choose('A leaking pipe');
  await g.dismiss();
  await talk(g);
  assert.equal(g.var('mission_complete'), 1);
  await g.wait(3600);
  assert.ok(g.ui.texts.some((t) => t.includes('first try: 0 of 2')), JSON.stringify(g.ui.texts));
});

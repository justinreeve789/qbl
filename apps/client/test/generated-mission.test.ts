/**
 * A mission made by the AI scenario generator, played from the briefing to the debrief through the real
 * engine (headless, offline), by one student, with the bag: things picked up, put together, used and given;
 * a robot who falls off the terrace on arrival and is pulled back up; an instrument with a slider and a
 * switch; things to look at.
 *
 * The mission is the one `npm run test:generation` makes from apps/api/tests/fixtures/generation/blueprint.php,
 * so this runs from there (QBL_GENERATED_SCENARIO names the scenario.json) and is skipped otherwise.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { PropsSystem } from '../src/systems/PropsSystem';
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

test('a generated mission plays from the briefing to the debrief', { skip: !file && 'run by npm run test:generation' }, async () => {
  const g = new Game(normalizeScenario(JSON.parse(readFileSync(file!, 'utf8')) as Scenario));
  await g.wait(300);
  assert.equal(g.sceneName, 'landing');
  await talk(g); // the briefing
  // No crew roles to choose: straight into the mission.
  assert.equal(g.box, undefined);
  assert.ok(!g.checklist.some((l) => /role/i.test(l)));

  await clickHot(g, 'label-keeper');
  await talk(g);
  assert.equal(g.var('done_talk_keeper'), 1);
  // A fun thing to look at, painted into the background.
  await clickHot(g, 'sundial');
  assert.match(g.box!.html, /snail/);
  await g.dismiss();
  // Something only to look at: what the student notices, in a bubble.
  await clickHot(g, 'detail-0');
  await g.wait(300);
  assert.ok(g.ui.dialogues.some((d) => d.includes('A daisy has moved in')), JSON.stringify(g.ui.dialogues));
  await g.wait(4000);

  // Into the greenhouse through its door: read the gauge, take the twine, open a vent together.
  await clickHot(g, 'way-greenhouse');
  await g.wait(4000);
  assert.equal(g.sceneName, 'greenhouse');
  await clickHot(g, 'read_humidity');
  assert.match(g.box!.html, /95%/);
  await g.dismiss();
  await clickHot(g, 'get_twine');
  assert.match(g.box!.html, /Added to your bag: Garden twine/);
  await g.dismiss();
  assert.deepEqual(g.bag, ['Garden twine']);
  await clickHot(g, 'reroute');
  await g.wait(3500);
  assert.equal(g.var('team_reroute'), 1);
  g.ctx.vars.apply('helped_reroute', 'set', 0); // a second student does their part
  await g.wait(600);
  await clickHot(g, 'reroute');
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
  assert.deepEqual(g.bag, ['Garden twine', 'Pollen sample'], 'newest last');
  assert.match(g.box!.html, /What does a flower need/);
  await g.choose('More sunlight');
  assert.match(g.box!.html, /Not quite/);
  await g.dismiss();
  // The twist: everyone in the scene sees it; it blocks the way to the hive; Granny Odo jumps.
  await g.wait(3000);
  await talk(g);
  await g.wait(6000);
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

  // Down the hole: the pipes, a hook; the hook and the twine make a hook on a string, which fishes a
  // battery out of a crack (and is kept).
  await clickHot(g, 'way-burrow');
  await g.wait(4000);
  assert.equal(g.sceneName, 'burrow');
  await clickHot(g, 'check_pipes');
  assert.match(g.box!.html, /cracked/);
  await g.dismiss();
  await clickHot(g, 'get_hook');
  await g.dismiss();
  // Clicked with nothing, the crack says what is wrong.
  await clickHot(g, 'fish_battery');
  assert.ok(g.ui.texts.some((t) => t.includes('too far down for fingers')));
  await g.pick('Bent hook');
  await g.pick('Garden twine');
  await g.wait(200);
  assert.deepEqual(g.bag, ['Pollen sample', 'Hook on a string']);
  assert.equal(g.var('done_make_grabber'), 1);
  await g.pick('Hook on a string');
  await clickHot(g, 'fish_battery');
  await g.wait(3000);
  assert.match(g.box!.html, /robot battery/);
  await g.dismiss();
  await g.wait(1500);
  assert.equal(g.var('done_fish_battery'), 1);
  assert.deepEqual(g.bag, ['Pollen sample', 'Hook on a string', 'Robot battery']);
  const feather = hot(g, 'find_feather');
  await g.walkTo(feather.position_x!, feather.position_y! + 120);
  await clickHot(g, 'find_feather');
  assert.match(g.box!.html, /feather/);
  await g.dismiss();
  await clickHot(g, 'way-orchard');
  await g.wait(4000);
  assert.equal(g.sceneName, 'orchard');
  // The pollen is for carrying to a bare flower.
  await g.pick('Pollen sample');
  await clickHot(g, 'pollinate');
  await g.wait(8000); // the student walks over to it, across the wide orchard
  assert.match(g.box!.html, /You are the pollinator/);
  assert.match(g.box!.html, /data-qbl="callout" data-tone="think"/);
  await g.dismiss();
  await g.wait(500);
  assert.equal(g.var('done_pollinate'), 1);
  assert.deepEqual(g.bag, ['Hook on a string', 'Robot battery']);

  // Up to the hive.
  const door = hot(g, 'exit-top');
  await g.walkTo(door.position_x!, door.position_y! + 140);
  await g.hold(['up'], () => g.sceneName === 'hive');
  // As the crew arrives, Pip rolls over to say hello, and slips off the edge.
  await g.wait(1000);
  assert.ok(g.ui.texts.includes('Look out!'), JSON.stringify(g.ui.texts));
  await g.wait(2000);
  await talk(g);
  await g.wait(14000); // he says hello, rolls to the edge, slips and cries out
  assert.equal(g.var('arrival_hive'), 1);
  assert.equal(g.var('away_bot'), 1);
  const pip = g.scenario.characters!.find((c) => c.name === 'Pip')!;
  const props = g.scene.system(PropsSystem) as any;
  assert.equal(props.characters.has(pip.id), false, 'he is out of sight');
  // Out of reach: clicked with nothing, the spot says so.
  await clickHot(g, 'save_pip');
  assert.ok(g.ui.texts.some((t) => t.includes('too far down to reach')));
  // A vine over the wall and a branch the storm brought down make a pulley, which lifts him up.
  await clickHot(g, 'get_vine');
  await g.dismiss();
  await clickHot(g, 'get_branch');
  await g.dismiss();
  await g.pick('Long vine');
  await g.pick('Forked branch');
  await g.wait(200);
  assert.equal(g.var('done_make_pulley'), 1);
  await g.pick('Branch pulley');
  await clickHot(g, 'save_pip');
  await g.wait(3000);
  assert.match(g.box!.html, /Heave!/);
  await g.dismiss();
  await g.wait(300);
  assert.ok(g.ui.texts.some((t) => t.includes('Pip is safe')), JSON.stringify(g.ui.texts));
  await g.wait(7000);
  assert.equal(g.var('saved_save_pip'), 1);
  assert.equal(g.var('away_bot'), 0);
  assert.equal(props.characters.has(pip.id), true, 'and he is back');
  assert.deepEqual(g.bag, ['Hook on a string', 'Robot battery']);
  await clickHot(g, 'label-bot');
  await talk(g);
  assert.equal(g.var('done_talk_pip'), 1);
  assert.match(g.box!.html, /Make a prediction/);
  await g.choose('Stay away');
  assert.match(g.box!.html, /Prediction noted/);
  await g.dismiss();
  assert.equal(g.var('q_q_predict_answer'), 'Stay away');
  // The timer needs Pip powered up first. Give him the battery: clicking him with it picked.
  const figure = props.characters.get(pip.id).figure.sprite;
  await g.pick('Hook on a string');
  figure.emit('pointerdown');
  await g.wait(300);
  assert.ok(g.ui.dialogues.some((d) => d.includes('not what I need')), `not what he needs: ${JSON.stringify(g.ui.dialogues)}`);
  await g.wait(5000);
  assert.equal(g.var('done_give_battery'), 0);
  await g.pick('Robot battery');
  figure.emit('pointerdown');
  await g.wait(300);
  await talk(g);
  await g.wait(8000); // he spins, rolls over and says so
  assert.equal(g.var('done_give_battery'), 1);
  assert.deepEqual(g.bag, ['Hook on a string']);
  // The sprinkler timer: a slider and a switch side by side, tested until it works.
  await clickHot(g, 'track');
  assert.match(g.box!.html, /data-qbl="slider"[^>]*data-value="24"/);
  assert.match(g.box!.html, /data-qbl="switch"/);
  await g.choose('Run the timer', { c_track_sprays: '24', c_track_power: '0' });
  assert.match(g.box!.html, /no power/);
  await g.dismiss();
  await g.choose('Run the timer', { c_track_sprays: '8', c_track_power: '1' });
  assert.match(g.box!.html, /still gets soaked/);
  await g.dismiss();
  assert.match(g.box!.html, /data-qbl="slider"[^>]*data-value="8"/, 'the box opens again as it was left');
  await g.choose('Run the timer', { c_track_sprays: '2', c_track_power: '1' });
  assert.match(g.box!.html, /It works!/);
  await g.dismiss();
  assert.equal(g.var('done_track'), 1);
  await clickHot(g, 'valves');
  await g.wait(3500);
  assert.equal(g.var('team_valves'), 1);
  // A second student does their part.
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
  assert.match(g.box!.html, /Why did the pollinators leave/);
  await g.choose('It was too cold');
  await g.dismiss();
  await talk(g);
  assert.equal(g.var('mission_complete'), 0);
  await clickHot(g, 'label-keeper');
  await talk(g, 1);
  assert.match(g.box!.html, /Why did the pollinators leave/, 'only the question not yet answered right is asked again');
  await g.choose('A leaking pipe');
  await g.dismiss();
  await talk(g);
  assert.equal(g.var('mission_complete'), 1);
  await g.wait(3600);
  assert.ok(g.ui.texts.some((t) => t.includes('first try: 0 of 2')), JSON.stringify(g.ui.texts));
  // The pilot calls everyone aboard and walks off.
  await g.wait(12000);
  assert.equal(g.var('away_pilot'), 1);
  const pilot = g.scenario.characters!.find((c) => c.name === 'Captain Zee')!;
  assert.equal((g.scene.system(PropsSystem) as any).characters.has(pilot.id), false, 'and is gone');
});

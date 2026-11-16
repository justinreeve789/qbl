import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from './harness';

/** Close whatever informational box is open. */
async function ok(g: Game) {
  await g.dismiss();
}

test('The Wilting Stream: a student can play the whole quest from landing to report', async () => {
  const g = new Game();
  await g.wait(100);
  assert.deepEqual(g.checklist, ['[ ] Visit the starship control room and accept the Wilting Stream mission']);

  // Before the mission is accepted, a plant can be looked at but not collected.
  await g.walkOff('left', 'wilting-marsh');
  await g.click(1120, 770);
  assert.equal(g.box, undefined);
  assert.equal(g.var('samples'), 0);
  assert.ok(g.ui.texts.some((t) => t.includes('worth studying')));
  await g.walkOff('right', 'planet-landing');

  // --- to the ship, and accept the mission ---------------------------------------------
  await g.walkOff('right', 'planet-surface');
  await g.click(1750, 825); // the rocket
  await g.wait(4500);
  assert.equal(g.sceneName, 'control-room');
  await g.click(1850, 750); // mission console
  assert.match(g.box!.html, /The Wilting Stream/);
  await g.choose('Accept the mission');
  assert.match(g.box!.html, /Mission accepted/);
  await ok(g);
  assert.equal(g.var('quest_started'), 1);
  assert.deepEqual(g.checklist, [
    '[ ] Collect a plant sample from each of the three sites west of the landing site (0/3)',
    '[ ] Take the samples to the laboratory, east of the control room',
  ]);

  // --- downstream to upstream: marsh, gully, meadow ------------------------------------
  await g.walkOff('left', 'planet-surface');
  await g.walkOff('left', 'planet-landing');
  await g.walkOff('left', 'wilting-marsh');
  await g.click(1120, 770);
  assert.match(g.box!.html, /cloudy and has a sharp, sour smell/);
  await ok(g);
  await g.click(1120, 770); // the plant has been collected: nothing more happens
  assert.equal(g.box, undefined);
  assert.equal(g.var('samples'), 1);

  await g.walkOff('left', 'lander-gully');
  await g.click(1290, 720); // the old lander
  assert.match(g.box!.html, /CORROSIVE ELECTROLYTE/);
  await ok(g);
  await g.click(1680, 790);
  await ok(g);

  await g.walkOff('left', 'spring-meadow');
  await g.click(980, 770);
  assert.match(g.box!.html, /looks healthy/);
  await ok(g);
  // Collecting the healthy plant asks why a control matters. The question cannot be skipped.
  assert.match(g.box!.html, /Why is it useful to collect a <em>healthy<\/em> plant/);
  assert.equal(g.box!.dismissible, false);
  await g.choose('It gives us something to compare');
  assert.match(g.box!.html, /Correct!/);
  await ok(g);
  assert.equal(g.var('q_control'), 'b');
  assert.equal(g.var('science_score'), 1);
  assert.equal(g.var('samples'), 3);
  assert.ok(g.ui.toasts.some((t) => t.startsWith('Objective complete: Collect a plant sample')));

  // --- back to the ship and into the laboratory ----------------------------------------
  for (const scene of ['lander-gully', 'wilting-marsh', 'planet-landing', 'planet-surface']) await g.walkOff('right', scene);
  await g.click(1750, 825);
  await g.wait(4500);
  assert.equal(g.sceneName, 'control-room');
  await g.walkOff('right', 'laboratory');
  assert.match(g.box!.html, /You set your three sample jars on the bench/);
  await ok(g);
  assert.equal(g.var('lab_visited'), 1);

  // --- pH tests -------------------------------------------------------------------------
  await g.click(1200, 900);
  assert.match(g.box!.html, /If a test strip reads <strong>3<\/strong>/);
  assert.match(g.box!.html, /src="\/scenario-assets\/starship\/lab\/ph-scale\.png"/, 'the {{media:40}} placeholder became a URL');
  await g.choose('It is a strong base'); // a wrong answer: explained, recorded, not scored
  assert.match(g.box!.html, /Not quite/);
  await ok(g);
  assert.equal(g.var('q_ph'), 'c');
  assert.equal(g.var('science_score'), 1);
  assert.deepEqual(g.box!.buttons, ['Test the marsh sample', 'Test the gully sample', 'Test the meadow sample', 'Step away']);
  await g.choose('Test the gully sample');
  assert.match(g.box!.html, /pH 3/);
  await ok(g);
  // The menu comes back without the sample already tested.
  assert.deepEqual(g.box!.buttons, ['Test the marsh sample', 'Test the meadow sample', 'Step away']);
  await g.choose('Step away');
  assert.equal(g.box, undefined);
  await g.click(1200, 900); // come back: the question is not asked twice
  await g.choose('Test the marsh sample');
  await ok(g);
  await g.choose('Test the meadow sample');
  await ok(g);
  assert.match(g.box!.html, /All three samples have been through the pH tester/);
  await ok(g);
  assert.equal(g.box, undefined);
  assert.equal(g.var('ph_tests'), 3);

  // The report terminal will not take a report yet.
  await g.click(180, 1130);
  assert.equal(g.box, undefined);
  assert.ok(g.ui.texts.some((t) => t.includes('needs all six test results')));

  // --- microscope -----------------------------------------------------------------------
  await g.click(1900, 980);
  for (const site of ['marsh', 'gully', 'meadow']) {
    await g.choose(`Test the ${site} sample`);
    await ok(g);
  }
  await ok(g); // "all three samples have been through the microscope"
  assert.match(g.box!.html, /no fungus and no bacteria/);
  await g.choose('Something in their surroundings');
  await ok(g);
  assert.equal(g.var('science_score'), 2);
  assert.equal(g.var('tests_done'), 6);

  // --- notebook: the results table is filled from variables -----------------------------
  await g.click(450, 880);
  assert.match(g.box!.html, /Lander gully \(middle\)<\/td><td>pH 3 \(strongly acidic\)<\/td><td>badly shrunken cells/);
  assert.match(g.box!.html, /cracked power cell dripping into the stream/);
  await ok(g);

  // --- report: a wrong first answer gives a hint and costs the point --------------------
  await g.click(180, 1130);
  await g.choose('A plant disease');
  assert.match(g.box!.html, /microscope showed <strong>none<\/strong>/);
  await ok(g);
  assert.equal(g.var('quest_solved'), 0);
  await g.click(180, 1130);
  await g.choose('Acid leaking from the old lander');
  assert.match(g.box!.html, /Science score: 2 out of 5/);
  await ok(g);
  assert.equal(g.var('quest_solved'), 1);
  assert.equal(g.var('q_source'), 'a', 'the first answer is what is recorded');

  // --- hands-on: neutralise the stream water --------------------------------------------
  await g.click(900, 840);
  await g.choose('A base, such as baking soda');
  await ok(g);
  assert.match(g.box!.html, /now reads <strong>pH 3<\/strong>/);
  await g.choose('Add a drop of lemon juice');
  assert.match(g.box!.html, /pH 2/, 'acid lowers the pH');
  for (let ph = 3; ph <= 7; ph++) {
    await g.choose('Add a drop of baking soda');
    if (ph < 7) assert.match(g.box!.html, new RegExp(`pH ${ph}<`));
  }
  assert.match(g.box!.html, /Neutral!/);
  await ok(g);
  await g.choose('Step away');
  assert.equal(g.box, undefined);
  assert.equal(g.var('neutralised'), 1);
  assert.equal(g.var('science_score'), 3);

  assert.deepEqual(g.checklist, [
    '[x] Collect a plant sample from each of the three sites west of the landing site (3/3)',
    '[x] Take the samples to the laboratory, east of the control room',
    '[x] Test the pH of each sample (3/3)',
    '[x] Examine each sample under the microscope (3/3)',
    '[x] Report the source of the contamination at the terminal',
    '[x] Make the contaminated water neutral at the mixing bench',
  ]);

  // Everything a teacher dashboard would need is in the saved progress.
  g.ctx.saveProgress(true);
  const saved = g.ctx.connection.welcome && (g.ctx.vars.snapshot('player') as Record<string, unknown>);
  assert.deepEqual(
    [saved.q_control, saved.q_ph, saved.q_cells, saved.q_base, saved.q_source, saved.science_score],
    ['b', 'c', 'b', 'b', 'a', 3],
  );
});

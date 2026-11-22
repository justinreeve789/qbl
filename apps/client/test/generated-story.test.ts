/**
 * A story made by the AI scenario generator, watched to the end through the real engine (headless,
 * offline): every scene plays by itself, with no avatars and the player not walking; the characters walk
 * on and off and talk; the narrator speaks; the storm blows up; the truck drives by when the script says;
 * each scene moves on to the next; the last ends with "The End" and the things to talk about, and can be
 * watched again.
 *
 * The story is the one `npm run test:story-generation` makes from apps/api/tests/fixtures/generation/story.php,
 * so this runs from there (QBL_GENERATED_STORY names the scenario.json) and is skipped otherwise.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { FlowSystem } from '../src/systems/FlowSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { WeatherSystem } from '../src/systems/WeatherSystem';
import { Game } from './harness';

const file = process.env.QBL_GENERATED_STORY;

/** Wait (in game time) until `until` holds, or fail after `limit` ms. */
async function until(g: Game, what: string, holds: () => boolean, limit = 120_000) {
  for (let t = 0; t < limit && !holds(); t += 100) await g.wait(100);
  assert.ok(holds(), `${what} (in ${g.sceneName}, after ${limit} ms)`);
}

test('a generated story plays to the end by itself', { skip: !file && 'run by npm run test:story-generation' }, async () => {
  const g = new Game(normalizeScenario(JSON.parse(readFileSync(file!, 'utf8')) as Scenario));
  await g.wait(300);
  assert.equal(g.sceneName, 'pond');
  assert.equal(g.scene.def.show_avatars, false);
  assert.equal(g.scene.system(LocalPlayerSystem).frozen, true);
  assert.ok(g.ui.story?.skip, 'it can be skipped');
  // The title, then the narrator, and the pond lying still.
  await until(g, 'the title shows', () => g.ui.texts.includes('Drip Goes Round'), 5000);
  await until(g, 'the narrator begins', () => g.ui.texts.some((t) => t.startsWith('Once there was a little drop')), 10_000);
  assert.ok(g.ui.spoken.some((s) => s.text.startsWith('Once there was') && s.speak.audioUrl), 'read aloud from its recording');
  assert.equal((g.scene.system(FlowSystem) as any).waters[0].s.kind, 'lake');
  await until(g, 'Drip says good morning', () => g.ui.dialogues.some((d) => d.startsWith('Drip: Good morning, Fen!')));

  // By itself, on to the clouds, where a storm blows up.
  await until(g, 'it moves on to the clouds', () => g.sceneName === 'sky');
  await until(g, 'a storm blows up', () => g.scene.system(WeatherSystem).current?.kind === 'storm');
  assert.equal(g.scene.system(WeatherSystem).current?.lightning, true);

  // Down the river: raining, then clearing; the truck goes by when the script sends it.
  await until(g, 'it moves on to the river', () => g.sceneName === 'river');
  assert.equal(g.scene.system(WeatherSystem).current?.kind, 'rain');
  const river = (g.scene.system(FlowSystem) as any).waters[0];
  assert.deepEqual([river.s.kind, river.s.direction, river.s.layer], ['river', 'right', 'behind']);
  await until(g, 'the truck drives by', () => g.scene.engine.isRunning(g.scene.def.indirect_events!.find((e) => e.shortname === 'pass-truck')!.id));
  await until(g, 'the rain clears', () => g.scene.system(WeatherSystem).current === null);

  // The end.
  await until(g, 'the story ends', () => g.var('mission_complete') === 1);
  assert.deepEqual(g.checklist, ['[x] Watch the story to the end']);
  await until(g, 'the things to talk about show', () => !!g.box);
  assert.match(g.box!.html, /Why did Drip feel heavy in the cloud\?/);
  assert.equal(g.ui.story?.skip, undefined, 'nothing to skip to at the end');
  await g.choose('↺ Watch it again');
  await g.wait(800);
  assert.equal(g.sceneName, 'pond');
});

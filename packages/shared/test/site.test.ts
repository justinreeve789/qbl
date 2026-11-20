import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeFromPath, codeProblem, homePath, normalizeCode, siteLinks } from '../src/site';

test('teachers and admins can go to every place on the site; others only to their missions', () => {
  assert.deepEqual(siteLinks('teacher').map((l) => l.key), ['missions', 'editor', 'classes', 'docs']);
  assert.deepEqual(siteLinks('admin').map((l) => l.key), ['missions', 'editor', 'classes', 'docs']);
  assert.deepEqual(siteLinks('student').map((l) => l.key), ['missions']);
  assert.deepEqual(siteLinks('guest').map((l) => l.key), ['missions']);
  assert.deepEqual(siteLinks(undefined).map((l) => l.key), ['missions']);
});

test('the links are copies, so a page can change one without changing the next page’s', () => {
  siteLinks('teacher')[0]!.label = 'Changed';
  assert.equal(siteLinks('teacher')[0]!.label, 'Missions');
});

test('after signing in, teachers and admins land in the editor; everyone else on their missions', () => {
  assert.equal(homePath('teacher'), '/editor/#/');
  assert.equal(homePath('admin'), '/editor/#/');
  assert.equal(homePath('student'), '/missions');
  assert.equal(homePath('guest'), '/missions');
  assert.equal(homePath(undefined), '/missions');
  // Roles are exact: anything unrecognised is treated as a player, never as staff.
  assert.equal(homePath('Teacher'), '/missions');
});

test('a scenario code is 4 to 32 lowercase letters, digits and single hyphens, starting with a letter', () => {
  for (const ok of ['starshipexplorer', 'cloudy-pond', 'room-12b', 'abcd', 'a'.repeat(32)]) assert.equal(codeProblem(ok), null, ok);
  for (const bad of ['abc', 'a'.repeat(33), '1pond', 'cloudy_pond', 'Cloudy', 'cloudy--pond', 'pond-', '-pond', 'cloudy pond', 'pond.html']) assert.notEqual(codeProblem(bad), null, bad);
  assert.equal(normalizeCode('  Cloudy-Pond '), 'cloudy-pond');
});

test('the site\'s own addresses cannot be scenario codes', () => {
  for (const reserved of ['missions', 'play', 'editor', 'docs', 'media', 'scenario-assets']) assert.match(codeProblem(reserved) ?? '', /site’s own/);
});

test('the scenario code is read from /{code}, and other addresses have none', () => {
  assert.equal(codeFromPath('/starshipexplorer'), 'starshipexplorer');
  assert.equal(codeFromPath('/STARSHIPEXPLORER/'), 'starshipexplorer');
  assert.equal(codeFromPath('/cloudy-pond'), 'cloudy-pond');
  for (const none of ['/', '/missions', '/play', '/play.html', '/editor/', '/a/b', '/%E0%A4%A']) assert.equal(codeFromPath(none), null, none);
});

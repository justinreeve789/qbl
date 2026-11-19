import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteLinks } from '../src/site';

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

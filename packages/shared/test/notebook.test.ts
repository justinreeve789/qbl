import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanNotebook, notebookContents, notebookId, pageDepth, pageDescendants, pageHeight, writtenWhen, NOTEBOOK_LIMITS, type Notebook } from '../src/index.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('a notebook is cleaned as the fixture says (apps/api/tests/notebooks.php checks the server against the same files)', () => {
  const input = fixture('notebook-input.json');
  assert.deepEqual(cleanNotebook(input.notebook, Date.parse(input.now)), fixture('notebook-clean.json'));
});

test('cleaning keeps a clean notebook as it is', () => {
  const clean = fixture('notebook-clean.json') as Notebook;
  assert.deepEqual(cleanNotebook(clean, Date.parse('2026-11-27T21:00:00Z')), clean);
});

test('anything that is not a notebook is an empty one', () => {
  for (const raw of [null, 'pages', 5, {}, { pages: 'no' }]) assert.deepEqual(cleanNotebook(raw), { pages: [] });
});

test('limits keep what comes first', () => {
  const at = '2026-11-27T20:00:00Z';
  const many = { pages: Array.from({ length: NOTEBOOK_LIMITS.pages + 5 }, (_, i) => ({ id: `p${i}`, parent: null, title: `Page ${i}`, icon: '⭐', color: 'sun', text: 'x'.repeat(NOTEBOOK_LIMITS.text + 10), created_at: at, updated_at: at,
    cards: Array.from({ length: NOTEBOOK_LIMITS.cards + 2 }, (_, j) => ({ id: `c${j}`, kind: 'note', text: '🐸'.repeat(NOTEBOOK_LIMITS.card + 1), color: 'sun', created_at: at, updated_at: at })) })) };
  const clean = cleanNotebook(many);
  assert.equal(clean.pages.length, NOTEBOOK_LIMITS.pages);
  assert.equal(clean.pages.at(-1)!.id, `p${NOTEBOOK_LIMITS.pages - 1}`);
  assert.equal(clean.pages[0]!.text.length, NOTEBOOK_LIMITS.text);
  assert.equal(clean.pages[0]!.cards.length, NOTEBOOK_LIMITS.cards);
  assert.equal(Array.from(clean.pages[0]!.cards[0]!.text).length, NOTEBOOK_LIMITS.card, 'characters, not UTF-16 units, are counted');
});

test('the contents list each page with its subpages under it', () => {
  const nb = fixture('notebook-clean.json') as Notebook;
  assert.deepEqual(notebookContents(nb).map(({ page, depth }) => `${depth}:${page.id}`), ['0:p1', '1:p2', '2:p3', '2:p4', '0:p5', '0:p6', '1:p7', '0:p8']);
  assert.equal(pageDepth(nb, 'p3'), 2);
  assert.equal(pageHeight(nb, 'p1'), 2);
  assert.equal(pageHeight(nb, 'p8'), 0);
  assert.deepEqual(pageDescendants(nb, 'p1'), ['p2', 'p3', 'p4']);
});

test('when something was written is said in a few plain words', () => {
  const now = Date.parse('2026-11-27T21:00:00Z');
  const o = { locale: 'en-US', timeZone: 'America/Denver' };
  assert.equal(writtenWhen('2026-11-27T20:59:30Z', now, o), 'just now');
  assert.equal(writtenWhen('2026-11-27T20:59:00Z', now, o), '1 minute ago');
  assert.equal(writtenWhen('2026-11-27T20:15:00Z', now, o), '45 minutes ago');
  assert.equal(writtenWhen('2026-11-27T16:05:00Z', now, o), 'today at 9:05 AM');
  assert.equal(writtenWhen('2026-11-26T16:05:00Z', now, o), 'yesterday at 9:05 AM');
  assert.equal(writtenWhen('2026-11-24T16:05:00Z', now, o), 'on Tuesday');
  assert.equal(writtenWhen('2026-11-03T16:05:00Z', now, o), 'on Nov 3');
  assert.equal(writtenWhen('2025-11-03T16:05:00Z', now, o), 'on Nov 3, 2025');
  assert.equal(writtenWhen('not a time', now, o), '');
});

test('new ids are short, safe and different', () => {
  const ids = new Set(Array.from({ length: 200 }, () => notebookId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{9}$/);
});

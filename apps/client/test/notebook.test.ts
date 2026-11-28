import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTEBOOK_LIMITS, type Notebook } from '@qbl/shared';
import { memoryNotebook, NotebookModel, type NotebookBackend } from '../src/core/Notebook';

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A backend that records what it was asked to keep, and can be made to fail. */
function backend(start: Notebook = { pages: [] }) {
  const saves: Array<{ notebook: Notebook; leaving: boolean }> = [];
  const api: NotebookBackend & { saves: typeof saves; failLoad: boolean; failSave: boolean } = {
    saves,
    failLoad: false,
    failSave: false,
    load: async () => {
      if (api.failLoad) throw new Error('offline');
      return JSON.parse(JSON.stringify(start)) as Notebook;
    },
    save: async (notebook, { leaving }) => {
      if (api.failSave) throw new Error('offline');
      saves.push({ notebook, leaving });
    },
  };
  return api;
}

async function opened(start?: Notebook) {
  const api = backend(start);
  let clock = Date.parse('2026-11-27T20:00:00Z');
  const book = new NotebookModel(api, { delayMs: 5, now: () => clock });
  await book.load();
  return { api, book, tick: (ms: number) => (clock += ms) };
}

test('nothing can be written until the notebook is open, and nothing when it could not be', async () => {
  const api = backend();
  api.failLoad = true;
  const book = new NotebookModel(api, { delayMs: 5 });
  assert.equal(book.addPage(), null, 'not while it is opening');
  await book.load();
  assert.equal(book.state, 'unloaded');
  assert.equal(book.addPage(), null, 'not when it could not be opened: what was kept would be written over');
  api.failLoad = false;
  await book.load();
  assert.equal(book.state, 'saved');
  assert.ok(book.addPage());
});

test('pages and subpages are listed in order, and kept a moment after the last change', async () => {
  const { api, book, tick } = await opened();
  const plants = book.addPage(null, { title: 'Plants' })!;
  const animals = book.addPage(null, { title: 'Animals' })!;
  const beans = book.addPage(plants.id, { title: 'Beans' })!;
  const sprout = book.addPage(beans.id, { title: 'Day one' })!;
  assert.equal(book.addPage(sprout.id), null, `pages go only ${NOTEBOOK_LIMITS.depth} deep`);
  assert.deepEqual(book.contents().map(({ page, depth }) => `${depth}:${page.title}`), ['0:Plants', '1:Beans', '2:Day one', '0:Animals']);
  assert.equal(beans.color, plants.color, 'a subpage has its page’s colour');
  assert.notEqual(animals.color, plants.color, 'pages of their own differ');
  assert.equal(book.state, 'waiting');
  assert.equal(api.saves.length, 0, 'not at once');
  await settle(20);
  assert.equal(api.saves.length, 1, 'all the changes together');
  assert.equal(book.state, 'saved');
  tick(90_000);
  book.updatePage(beans.id, { text: 'They need water' });
  assert.equal(beans.updated_at, '2026-11-27T20:01:30Z', 'writing on a page says when');
  assert.equal(plants.updated_at, '2026-11-27T20:00:00Z', 'and only that page');
});

test('pages can be moved, put under another and taken out again, with their subpages', async () => {
  const { book } = await opened();
  const a = book.addPage(null, { title: 'A' })!;
  const b = book.addPage(null, { title: 'B' })!;
  const c = book.addPage(null, { title: 'C' })!;
  book.addPage(b.id, { title: 'B1' });
  const order = () => book.contents().map(({ page, depth }) => `${depth}:${page.title}`).join(' ');
  assert.ok(book.movePage(b.id, -1));
  assert.equal(order(), '0:B 1:B1 0:A 0:C', 'moved up, subpage and all');
  assert.equal(book.movePage(b.id, -1), false, 'not past the first');
  assert.ok(book.indentPage(c.id));
  assert.equal(order(), '0:B 1:B1 0:A 1:C', 'made a subpage of the page before it');
  assert.equal(c.color, a.color);
  assert.ok(book.outdentPage(c.id));
  assert.equal(order(), '0:B 1:B1 0:A 0:C');
  assert.equal(book.placePage(b.id, b.id, 'inside'), false, 'not into itself');
  assert.ok(book.placePage(b.id, c.id, 'inside'));
  assert.equal(order(), '0:A 0:C 1:B 2:B1', 'dropped into another page');
  assert.equal(book.placePage(a.id, book.contents()[3]!.page.id, 'inside'), false, 'not deeper than allowed');
  assert.equal(book.deletePage(c.id), a.id, 'throwing a page away shows the one beside it');
  assert.equal(order(), '0:A', 'and its subpages go with it');
});

test('notecards: notes, flip cards and things to check off', async () => {
  const { api, book, tick } = await opened();
  const page = book.addPage(null, { title: 'Words' })!;
  const other = book.addPage(null, { title: 'More' })!;
  const note = book.addCard(page.id, 'note')!;
  const flip = book.addCard(page.id, 'flash')!;
  const todo = book.addCard(page.id, 'check')!;
  assert.deepEqual([note.back, flip.back, todo.done], [undefined, '', false]);
  assert.notEqual(note.color, flip.color, 'cards take turns with colours');
  tick(60_000);
  book.updateCard(page.id, flip.id, { text: 'Baby frog?', back: 'Tadpole' });
  book.updateCard(page.id, note.id, { back: 'no back', done: true });
  assert.equal(note.back, undefined, 'only flip cards have a back');
  assert.equal(note.done, undefined, 'and only to-do cards are checked off');
  book.updateCard(page.id, todo.id, { done: true });
  assert.equal(todo.done, true);
  assert.equal(flip.updated_at, '2026-11-27T20:01:00Z');
  assert.ok(book.moveCard(page.id, todo.id, -1));
  assert.deepEqual(book.page(page.id)!.cards.map((c) => c.kind), ['note', 'check', 'flash']);
  assert.ok(book.placeCard(page.id, flip.id, other.id));
  assert.deepEqual([book.page(page.id)!.cards.length, book.page(other.id)!.cards[0]!.id], [2, flip.id], 'moved to another page');
  book.deleteCard(page.id, note.id);
  await book.flush();
  assert.deepEqual(api.saves.at(-1)!.notebook.pages[0]!.cards.map((c) => c.kind), ['check']);
});

test('a change while saving is kept next; a failed save is tried again; leaving keeps what waits at once', async () => {
  const { api, book } = await opened();
  const page = book.addPage(null, { title: 'One' })!;
  const first = book.flush();
  book.updatePage(page.id, { title: 'Two' });
  await first;
  await settle(20);
  assert.deepEqual(api.saves.map((s) => s.notebook.pages[0]!.title), ['One', 'Two']);
  api.failSave = true;
  book.updatePage(page.id, { title: 'Three' });
  await book.flush();
  assert.equal(book.state, 'failed');
  assert.ok(book.unsaved);
  api.failSave = false;
  await book.flush(true);
  assert.deepEqual([api.saves.at(-1)!.notebook.pages[0]!.title, api.saves.at(-1)!.leaving, book.state], ['Three', true, 'saved']);
  book.dispose();
});

test('the first page of an empty notebook is kept only once something is written', async () => {
  const api = backend();
  const book = new NotebookModel(api, { delayMs: 5 });
  await book.load();
  const page = book.addPage(null, { title: 'My notes', quiet: true })!;
  await settle(20);
  assert.equal(api.saves.length, 0);
  book.updatePage(page.id, { text: 'Hello' });
  await book.flush();
  assert.equal(api.saves.length, 1);
});

test('a preview keeps its notebook in memory', async () => {
  const kept = memoryNotebook();
  const book = new NotebookModel(kept, { delayMs: 1 });
  await book.load();
  book.addPage(null, { title: 'Draft' });
  await book.flush();
  assert.equal((await kept.load()).pages[0]!.title, 'Draft');
});

test('the notebook button is on the rail when the game has a notebook, and goes when the game ends', async () => {
  const { NotebookFeature } = await import('../src/features/NotebookFeature');
  const shown: Array<unknown> = [];
  const ui = { notebook: (book: unknown, o?: unknown) => shown.push(book ? o : null) };
  const book = new NotebookModel(memoryNotebook(), { delayMs: 1 });
  const ctx = { notebook: book, ui, scenario: { title: 'Pond Life' }, user: { name: 'Brave Otter' } };
  const stop = new NotebookFeature().start(ctx as never);
  assert.deepEqual(shown, [{ title: 'Pond Life', owner: 'Brave Otter' }], 'the cover says whose it is and for which mission');
  stop();
  assert.equal(shown.at(-1), null);
  shown.length = 0;
  new NotebookFeature().start({ ...ctx, notebook: null } as never)();
  assert.deepEqual(shown, [], 'a scenario that turns the notebook off has no button');
});

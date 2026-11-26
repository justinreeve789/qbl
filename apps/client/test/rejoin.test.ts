import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectionFeature, type PageWindow } from '../src/features/ConnectionFeature';

type Listener = (e: { persisted?: boolean }) => void;

function fakes(online: boolean) {
  const listeners = new Set<Listener>();
  const page = {
    reloads: 0,
    addEventListener: (_: 'pageshow', l: Listener) => listeners.add(l),
    removeEventListener: (_: 'pageshow', l: Listener) => listeners.delete(l),
    location: { reload: () => { page.reloads++; } },
    show: (persisted: boolean) => [...listeners].forEach((l) => l({ persisted })),
    listeners,
  };
  const handlers: Record<string, ((p: unknown) => void)[]> = {};
  const connection = {
    online,
    left: 0,
    on: (ev: string, h: (p: unknown) => void) => { (handlers[ev] ??= []).push(h); return () => {}; },
    leave: () => { connection.left++; },
    fire: (ev: string, p: unknown) => handlers[ev]?.forEach((h) => h(p)),
  };
  const statuses: (string | null)[] = [];
  const ui = { status: (s: string | null) => statuses.push(s), toast: () => {} };
  const ctx = { connection, ui } as any;
  return { page, connection, statuses, ctx };
}

test('coming Back to a game page from the back/forward cache rejoins the game', () => {
  const { page, connection, statuses, ctx } = fakes(true);
  const stop = new ConnectionFeature(page as unknown as PageWindow).start(ctx);

  page.show(false);
  assert.equal(page.reloads, 0, 'an ordinary first load does nothing');

  page.show(true);
  assert.equal(page.reloads, 1, 'a page restored as it was is loaded again, which joins afresh');
  assert.equal(connection.left, 1, 'whatever was left of the old room is closed first');
  assert.equal(statuses.at(-1), 'Rejoining the game…');

  connection.fire('leave', 1000);
  assert.equal(statuses.at(-1), 'Rejoining the game…', 'the old room closing does not say "Disconnected" over it');

  stop();
  assert.equal(page.listeners.size, 0);
});

test('a preview or offline game is not reloaded', () => {
  const { page, ctx } = fakes(false);
  new ConnectionFeature(page as unknown as PageWindow).start(ctx);
  page.show(true);
  assert.equal(page.reloads, 0);
});

test('without Back, a closed room still says how to rejoin', () => {
  const { page, connection, statuses, ctx } = fakes(true);
  new ConnectionFeature(page as unknown as PageWindow).start(ctx);
  connection.fire('leave', 4000);
  assert.match(String(statuses.at(-1)), /Reload the page to rejoin/);
});

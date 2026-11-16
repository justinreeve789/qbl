import { Api, ApiError, type User } from './api';
import { clear, h, toast } from './dom';
import './editor.css';
import { Store } from './store';
import { loginView, scenarioListView } from './views/home';
import { TABS, workspace, type Tab } from './views/workspace';

/**
 * The editor. Addresses are kept in the fragment so the server needs no rules for them:
 *   #/                       the scenarios you can edit
 *   #/s/{id}                 one scenario: its scenes
 *   #/s/{id}/{tab}           media, variables, items, characters, objectives, settings, publish
 *   #/s/{id}/scene/{scene}   the scene editor
 */
const api = new Api();
const root = document.getElementById('app')!;
const saving = h('span', { class: 'saving', 'aria-live': 'polite' });
const account = h('div', { class: 'account' });
const view = h('div', { class: 'view' });
root.append(h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/' }, 'QBL Editor'), saving, h('span', { class: 'spacer' }), account), view);

let hideSaved = 0;
api.onBusy = (busy) => {
  window.clearTimeout(hideSaved);
  saving.textContent = busy ? 'Saving…' : 'Saved';
  if (!busy) hideSaved = window.setTimeout(() => (saving.textContent = ''), 1500);
};

let user: User | null = null;
let store: Store | null = null;
let dispose: (() => void) | null = null;
let routing = 0;

const go = (hash: string) => {
  if (window.location.hash === hash) void route();
  else window.location.hash = hash;
};

function show(node: HTMLElement, fill = false) {
  dispose?.();
  dispose = null;
  view.classList.toggle('fill', fill);
  clear(view, node);
}

function drawAccount() {
  clear(
    account,
    user ? h('span', { class: 'muted' }, user.name) : null,
    user
      ? h('button', {
          type: 'button', class: 'link',
          onclick: () => {
            api.signOut();
            user = null;
            store = null;
            void route();
          },
        }, 'Sign out')
      : null,
  );
}

async function route() {
  const turn = ++routing;
  drawAccount();
  if (!user) {
    return show(loginView(api, (signedIn) => {
      user = signedIn;
      void route();
    }));
  }
  if (user.role !== 'teacher' && user.role !== 'admin') {
    return show(h('div', { class: 'center' }, h('div', { class: 'card' }, h('h1', null, 'QBL Editor'), h('p', null, 'The editor is for teachers and content creators. This account can play scenarios but not edit them.'))));
  }

  const match = /^#\/s\/(\d+)(?:\/(?:scene\/(\d+)|([a-z]+)))?$/.exec(window.location.hash);
  if (!match) return show(scenarioListView(api, (id) => go(`#/s/${id}`)));

  const scenarioId = Number(match[1]);
  if (store?.scenarioId !== scenarioId) {
    const next = new Store(api, scenarioId);
    try {
      await next.load();
    } catch (err) {
      if (turn !== routing) return;
      if (err instanceof ApiError && err.status === 401) {
        user = null;
        return route();
      }
      toast(err instanceof Error ? err.message : 'Could not open the scenario.', 'error');
      return go('#/');
    }
    if (turn !== routing) return;
    store = next;
  }
  const tab = TABS.some(([key]) => key === match[3]) ? (match[3] as Tab) : 'scenes';
  const sceneId = match[2] ? Number(match[2]) : undefined;
  const ws = workspace(store, { tab, sceneId }, go);
  show(ws.element, true);
  dispose = ws.dispose;
}

window.addEventListener('hashchange', () => void route());

api.me().then(
  (me) => {
    user = me;
    void route();
  },
  () => void route(),
);

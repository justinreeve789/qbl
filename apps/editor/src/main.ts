import { siteLinks, type SiteLink } from '@qbl/shared';
import { Api, ApiError, type User } from './api';
import { config } from './config';
import { icon } from './icons';
import { clear, h, toast } from './dom';
// Twemoji Awesome: the one set every icon in the interface is drawn from (see icons.ts).
import '../../../packages/shared/assets/twemoji-awesome.css';
import './editor.css';
import { Store } from './store';
import { classesView } from './views/classes';
import { loginView, scenarioListView } from './views/home';
import { TABS, workspace, type Tab } from './views/workspace';

/**
 * The editor. Addresses are kept in the fragment so the server needs no rules for them:
 *   #/                       the scenarios you can edit
 *   #/classes                your students, and the missions assigned to them
 *   #/s/{id}                 one scenario: its scenes
 *   #/s/{id}/{tab}           media, variables, items, characters, objectives, settings, publish
 *   #/s/{id}/scene/{scene}   the scene editor
 */
const api = new Api();
const root = document.getElementById('app')!;
const saving = h('span', { class: 'saving', 'aria-live': 'polite' });
const account = h('div', { class: 'account' });
const view = h('div', { class: 'view' });
const nav = h('nav', { class: 'top-nav', 'aria-label': 'Site' });
root.append(h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/' }, 'QBL Editor'), nav, saving, h('span', { class: 'spacer' }), account), view);

/**
 * The site's places, as on the missions page and in the game's menu: Missions (the game),
 * Editor (the scenarios), Classes and Docs. Inside the editor the first is in the game and the
 * last two are the editor's own pages, reached by their fragment.
 */
function placeHref(link: SiteLink): string {
  if (link.key === 'missions') return `${config.gameUrl}missions`;
  if (link.key === 'editor') return '#/';
  if (link.key === 'classes') return '#/classes';
  return link.href;
}

function drawNav() {
  const here: SiteLink['key'] = window.location.hash === '#/classes' ? 'classes' : 'editor';
  const links = user && (user.role === 'teacher' || user.role === 'admin') ? siteLinks(user.role) : [];
  clear(nav, ...links.map((link) => h('a', {
    href: placeHref(link),
    title: link.hint,
    'data-place': link.key,
    class: link.key === here ? 'current' : null,
    'aria-current': link.key === here ? 'page' : null,
  }, icon(link.icon), link.label)));
}

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
    user ? h('span', { class: 'who' }, `👤 ${user.name}`) : null,
    user
      ? h('button', {
          type: 'button', class: 'signout',
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
  drawNav();
  if (!user) {
    return show(loginView(api, (signedIn) => {
      user = signedIn;
      void route();
    }));
  }
  if (user.role !== 'teacher' && user.role !== 'admin') {
    return show(h('div', { class: 'center' }, h('div', { class: 'card' }, h('h1', null, 'QBL Editor'), h('p', null, 'The editor is for teachers and content creators. This account can play scenarios but not edit them.'))));
  }

  if (window.location.hash === '#/classes') return show(classesView(api));

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

import { siteLinks, type SiteLink } from '@qbl/shared';
import { Api, ApiError, type User } from './api';
import { config } from './config';
import { emojiIcon, icon } from './icons';
import { clear, h, toast } from './dom';
// Twemoji Awesome: the one set every icon in the interface is drawn from (see icons.ts).
import '../../../packages/shared/assets/twemoji-awesome.css';
import './editor.css';
import { Store } from './store';
import { classesView } from './views/classes';
import { districtView } from './views/district';
import { generateView, prefillGenerator } from './views/generate';
import { progressBar, runName, STAGE_NAMES, tracker } from './generations';
import { planView } from './views/plan';
import { session } from './session';
import { loginView, scenarioListView } from './views/home';
import { TABS, workspace, type Tab } from './views/workspace';
// The profile dialog, shared with the missions page.
import { openProfile } from '../../../packages/shared/browser/profile';

/**
 * The editor. Addresses are kept in the fragment so the server needs no rules for them:
 *   #/                       the scenarios you can edit
 *   #/classes                your students, and the missions assigned to them
 *   #/generate               the AI mission generator (paid in credits)
 *   #/plan                   your plan and generator credits
 *   #/district[/{id}]        the district admin panel (for an organization's admins and QBL administrators)
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
const generating = h('div', { class: 'gen-chip-host', 'aria-live': 'polite' });
root.append(h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/' }, 'QuestLab Editor'), nav, saving, h('span', { class: 'spacer' }), generating, account), view);

/**
 * The AI generator's run, from any page: a chip in the header with its progress (it opens the
 * Generate page), the percent in the tab's title, and a message with "Open" when it is made.
 */
const baseTitle = document.title;
let chip: { id: number; node: HTMLElement; bar: ReturnType<typeof progressBar>; label: HTMLElement } | null = null;
tracker.subscribe((g) => {
  if (!g) {
    chip = null;
    clear(generating);
    document.title = baseTitle;
    return;
  }
  if (chip?.id !== g.id) {
    const bar = progressBar(g, () => tracker.skew, true);
    const label = h('span', { class: 'gen-chip-label' });
    const node = h('a', { class: 'gen-chip', href: '#/generate', 'data-generation': g.id }, h('span', { class: 'gen-chip-spark', 'aria-hidden': 'true' }, '✨'), h('span', { class: 'gen-chip-text' }, label, bar));
    chip = { id: g.id, node, bar, label };
    clear(generating, node);
  }
  const pct = Math.floor(g.progress.percent);
  const stage = g.cancelling ? 'Stopping' : STAGE_NAMES[g.progress.stage]?.short ?? g.progress.stage;
  chip.label.textContent = `${stage} · ${pct}%`;
  chip.node.title = `Making “${runName(g, 60)}”: ${g.progress.detail ?? STAGE_NAMES[g.progress.stage]?.long ?? ''}. Click to see it.`;
  chip.bar.update(g);
  document.title = `(${pct}%) ${baseTitle}`;
});
tracker.onFinished((g) => {
  document.title = baseTitle;
  if (g.status === 'done' && g.scenario_id) {
    toast(`“${runName(g, 60)}” is ready: a draft in your scenarios.`, 'info', { label: 'Open it', run: () => go(`#/s/${g.scenario_id}`) });
  } else if (g.status === 'failed') {
    toast('The mission could not be made. Any credits it cost were given back.', 'error', { label: 'See why', run: () => go('#/generate') });
  }
});

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

/** The editor's own pages beside the site's places: the generator, the plan, and (for those who run one) the district. */
const PAGES: Array<{ key: string; hash: string; label: string; emoji: string; hint: string; staff: boolean }> = [
  { key: 'generate', hash: '#/generate', label: 'Generate', emoji: '✨', hint: 'Make a mission with AI', staff: true },
  { key: 'plan', hash: '#/plan', label: 'Plan', emoji: '💳', hint: 'Your plan and generator credits', staff: true },
  { key: 'district', hash: '#/district', label: 'District', emoji: '🏛️', hint: 'Sign-in, rosters and API clients for a school or district', staff: false },
];

/** Whether this account may open the district admin panel. */
const runsDistrict = (u: User | null) => !!u && (u.role === 'admin' || (u.admin_of?.length ?? 0) > 0);

function drawNav() {
  const hash = window.location.hash;
  const here = hash === '#/classes' ? 'classes' : PAGES.find((p) => hash.startsWith(p.hash))?.key ?? 'editor';
  const staff = !!user && (user.role === 'teacher' || user.role === 'admin');
  const links = staff ? siteLinks(user!.role) : [];
  const mark = (key: string) => ({ class: key === here ? 'current' : null, 'aria-current': key === here ? 'page' : null });
  clear(
    nav,
    ...links.map((link) => h('a', { href: placeHref(link), title: link.hint, 'data-place': link.key, ...mark(link.key) }, icon(link.icon), link.label)),
    ...PAGES.filter((p) => (p.staff ? staff : runsDistrict(user))).map((p) => h('a', { href: p.hash, title: p.hint, 'data-place': p.key, ...mark(p.key) }, emojiIcon(p.emoji), p.label)),
  );
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
/** Whose generator runs the tracker is following. */
let followed: number | null = null;

const go = (hash: string) => {
  if (window.location.hash === hash) void route();
  else window.location.hash = hash;
};

/** From the Scenarios page: the generator, with what they typed as the start of its description. */
const toGenerator = (prompt?: string) => {
  if (prompt) prefillGenerator(prompt);
  go('#/generate');
};

function show(node: HTMLElement, fill = false) {
  dispose?.();
  dispose = null;
  view.classList.toggle('fill', fill);
  clear(view, node);
}

/** The profile page (name, password), over whatever page is open. The same dialog as on the missions page. */
function openOwnProfile() {
  if (!user) return;
  openProfile(user, {
    load: async () => (await api.me()) ?? user!,
    rename: (name) => api.rename(name),
    changePassword: (change) => api.changePassword(change),
    sendResetLink: (email) => api.forgotPassword(email),
  }, {
    onChange: (changed) => {
      if (!user) return;
      user = { ...user, name: changed.name };
      drawAccount();
    },
  });
}

function drawAccount() {
  clear(
    account,
    user
      ? h('button', { type: 'button', class: 'who', 'data-profile': '', title: 'Your profile: name and password', onclick: openOwnProfile }, icon('account'), user.name)
      : null,
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
  session.role = user?.role ?? '';
  drawAccount();
  drawNav();
  // Follow the teacher's generator runs from every page (only teachers and administrators make them).
  if (user && (user.role === 'teacher' || user.role === 'admin')) {
    if (followed !== user.id) {
      followed = user.id;
      tracker.start(api);
    }
  } else if (followed !== null) {
    followed = null;
    tracker.stop();
  }
  generating.hidden = window.location.hash === '#/generate';
  if (!user) {
    return show(loginView(api, (signedIn) => {
      user = signedIn;
      void route();
    }));
  }
  // The district admin panel is for whoever runs an organization, teacher or not.
  const district = /^#\/district(?:\/(\d+))?$/.exec(window.location.hash);
  if (district && runsDistrict(user)) return show(districtView(api, district[1] ? Number(district[1]) : null, go));
  if (user.role !== 'teacher' && user.role !== 'admin' && runsDistrict(user)) return go('#/district');
  if (user.role !== 'teacher' && user.role !== 'admin') {
    // Not a dead end: the game and the editor share one sign-in per browser, so the usual cause is
    // a guest or student sign-in left from playing. The form says which account this is and what
    // the server has as its role, and signing in with a teacher's account replaces it.
    return show(loginView(api, (signedIn) => {
      user = signedIn;
      store = null;
      void route();
    }, user, `${config.gameUrl}missions`));
  }

  if (window.location.hash === '#/classes') return show(classesView(api));
  if (window.location.hash === '#/plan') return show(planView(api));
  if (window.location.hash === '#/generate') return show(generateView(api, (id) => go(`#/s/${id}`)));
  if (window.location.hash === '#/new') {
    // From the missions page's "New scenario": the list, with the dialog open over it. The address
    // becomes the list's, so going back or reloading does not open the dialog again.
    window.history.replaceState(null, '', '#/');
    drawNav();
    return show(scenarioListView(api, (id) => go(`#/s/${id}`), { startNew: true, generate: toGenerator }));
  }

  const match = /^#\/s\/(\d+)(?:\/(?:scene\/(\d+)|([a-z]+)))?$/.exec(window.location.hash);
  if (!match) return show(scenarioListView(api, (id) => go(`#/s/${id}`), { generate: toGenerator }));

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

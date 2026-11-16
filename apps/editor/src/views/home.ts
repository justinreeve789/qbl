import { ApiError, type Api, type ScenarioSummary, type User } from '../api';
import { playUrl } from '../config';
import { clear, h, toast } from '../dom';

/** Sign-in. The game and the editor share the sign-in, so someone signed in to one is signed in to both. */
export function loginView(api: Api, done: (user: User) => void): HTMLElement {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'issue error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');
  const node = h(
    'form',
    { class: 'login card' },
    h('h1', null, 'QBL Editor'),
    h('p', { class: 'muted' }, 'Build scenarios: scenes, hotspots, events and everything players do in them.'),
    h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Email'), email),
    h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Password'), password),
    error,
    submit,
  );
  node.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      done(await api.login(email.value.trim(), password.value));
    } catch (err) {
      error.textContent = err instanceof ApiError && err.status < 500 ? 'That email and password do not match an account.' : 'Could not sign in. Try again.';
      error.hidden = false;
      submit.disabled = false;
    }
  });
  return h('div', { class: 'center' }, node);
}

/** The scenarios this person can edit. */
export function scenarioListView(api: Api, open: (id: number) => void): HTMLElement {
  const list = h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Loading…'));

  const create = async () => {
    const title = window.prompt('Title of the new scenario:')?.trim();
    if (!title) return;
    try {
      open((await api.create(title)).id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the scenario.', 'error');
    }
  };

  const card = (s: ScenarioSummary) =>
    h(
      'div',
      { class: 'card', 'data-scenario': s.id },
      h('div', { class: 'card-title' }, h('strong', null, s.title), h('span', { class: 'publish-state', 'data-state': s.published_at ? 'published' : 'draft' }, s.published_at ? 'Published' : 'Draft')),
      h('p', { class: 'muted' }, s.subtitle ?? ''),
      h('p', null, h('code', { class: 'code' }, s.code), s.user_id == null ? h('span', { class: 'badge' }, 'Shared sample') : null),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => open(s.id) }, 'Edit'),
        s.published_at ? h('a', { class: 'button', href: playUrl(s.code), target: '_blank', rel: 'noopener' }, 'Play') : null,
      ),
    );

  api.list().then(
    (scenarios) => clear(list, ...(scenarios.length ? scenarios.map(card) : [h('p', { class: 'empty' }, 'No scenarios yet. Create your first one.')])),
    (err: unknown) => clear(list, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load your scenarios.')),
  );

  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-head' },
      h('div', null, h('h1', null, 'Scenarios'), h('p', { class: 'muted' }, 'A scenario is a whole mission: its scenes, and everything that can happen in them. Each has a 16-letter code players use to open it.')),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'primary', onclick: create }, 'New scenario')),
    ),
    list,
  );
}

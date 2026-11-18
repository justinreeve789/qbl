import { ApiError, type Api, type ScenarioSummary, type User } from '../api';
import { playUrl } from '../config';
import { clear, h, help, toast } from '../dom';

const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  domain: 'That Google account is not from an organisation this site accepts.',
  unverified: 'Google has not verified that email address yet.',
  expired: 'That sign-in took too long. Please try again.',
  failed: 'Google sign-in did not work. Please try again.',
};

/** Sign-in. The game and the editor share the sign-in, so someone signed in to one is signed in to both. */
export function loginView(api: Api, done: (user: User) => void): HTMLElement {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'issue error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');
  // Offered when the server has Google sign-in set up. It leaves the page and comes back signed in.
  const google = h('button', { type: 'button', class: 'google', hidden: true, onclick: () => window.location.assign(`/api/auth/google/redirect?return=${encodeURIComponent(window.location.pathname)}`) }, 'Sign in with Google');
  void api.providers().then((p) => (google.hidden = !p.google));
  // A Google sign-in that did not work comes back with the reason after the #.
  const problem = /^#signin=([a-z]+)$/.exec(window.location.hash)?.[1];
  if (problem) {
    history.replaceState(null, '', window.location.pathname);
    error.textContent = SIGN_IN_PROBLEMS[problem] ?? SIGN_IN_PROBLEMS.failed!;
    error.hidden = false;
  }
  const node = h(
    'form',
    { class: 'login card' },
    h('h1', null, 'QBL Editor'),
    h('p', { class: 'muted' }, 'Build scenarios: scenes, hotspots, events and everything players do in them.'),
    h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Email'), email),
    h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Password'), password),
    error,
    submit,
    google,
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

/**
 * Ask for a new scenario's title and how it should start. The starship is the hub missions are
 * launched from, so a new scenario can begin as its own copy of it.
 */
function newScenarioDialog(): Promise<{ title: string; template?: 'starship' } | null> {
  return new Promise((resolve) => {
    const title = h('input', { type: 'text', name: 'title', required: true, maxlength: 200, autocomplete: 'off' });
    const choice = (value: string, checked: boolean, name: string, about: string) =>
      h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'start', value, checked }), h('span', null, h('strong', null, name), h('span', null, about)));
    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', null, 'New scenario'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), title),
      choice('starship', true, 'Start aboard the starship',
        'A copy of the ship’s eight rooms, its crew, the marketplace and the things that go on aboard. It is this scenario’s own copy: change anything, and add the places your mission goes to.'),
      choice('empty', false, 'Start empty', 'One blank scene.'),
      h('div', { class: 'row-actions' },
        h('button', { type: 'submit', class: 'primary' }, 'Create'),
        h('button', { type: 'button', onclick: () => dialog.close('cancel') }, 'Cancel')),
    );
    const dialog = h('dialog', { class: 'modal', 'data-dialog': 'new-scenario' }, form);
    form.addEventListener('submit', () => (dialog.returnValue = 'create'));
    dialog.addEventListener('close', () => {
      const start = (form.elements.namedItem('start') as RadioNodeList).value;
      dialog.remove();
      resolve(dialog.returnValue === 'create' && title.value.trim() ? { title: title.value.trim(), ...(start === 'starship' ? { template: 'starship' as const } : {}) } : null);
    });
    document.body.append(dialog);
    dialog.showModal();
    title.focus();
  });
}

/** The scenarios this person can edit, and public missions by others that they can make a copy of. */
export function scenarioListView(api: Api, open: (id: number) => void): HTMLElement {
  const list = h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Loading…'));
  const others = h('div', null);
  const fail = (err: unknown, fallback: string) => toast(err instanceof Error ? err.message : fallback, 'error');

  const create = async () => {
    const wanted = await newScenarioDialog();
    if (!wanted) return;
    try {
      open((await api.create(wanted.title, wanted.template)).id);
    } catch (err) {
      fail(err, 'Could not create the scenario.');
    }
  };

  const copy = async (id: number, title: string) => {
    try {
      const made = await api.duplicate(id);
      toast(`“${title}” was copied. The copy is a draft of your own.`);
      open(made.id);
    } catch (err) {
      fail(err, 'Could not copy the scenario.');
    }
  };

  const zip = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, 'data-input': 'import' });
  zip.addEventListener('change', async () => {
    const file = zip.files?.[0];
    zip.value = '';
    if (!file) return;
    try {
      const made = await api.importZip(file);
      toast(`“${String(made.title)}” was imported as a new draft.`);
      open(made.id);
    } catch (err) {
      fail(err, 'Could not import that file.');
    }
  });

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
        h('button', { type: 'button', title: 'Make a copy to change as you like', onclick: () => void copy(s.id, s.title) }, 'Duplicate'),
        h('button', { type: 'button', title: 'Download the whole scenario as a ZIP file, as a backup', onclick: () => void api.exportZip(s.id).catch((err) => fail(err, 'Could not export the scenario.')) }, 'Export'),
      ),
    );

  api.list().then(
    async (scenarios) => {
      clear(list, ...(scenarios.length ? scenarios.map(card) : [h('p', { class: 'empty' }, 'No scenarios yet. Create your first one.')]));
      // Public missions that are someone else's: they cannot be edited, but a copy can.
      const mine = new Set(scenarios.map((s) => s.id));
      const open_ = (await api.assignable().catch(() => [])).filter((m) => !mine.has(m.id));
      if (!open_.length) return;
      clear(
        others,
        h('div', { class: 'page-head' }, h('div', null, h('h2', null, 'Public missions by others', help('You cannot change these, but you can make a copy that is yours: edit its text, add scenes, award extra stars, or rebuild it altogether. The original is not affected.')))),
        h('div', { class: 'grid' }, ...open_.map((m) =>
          h('div', { class: 'card other', 'data-public': m.id },
            h('div', { class: 'card-title' }, h('strong', null, m.title)),
            h('p', { class: 'muted' }, m.subtitle ?? ''),
            h('div', { class: 'row-actions' },
              h('a', { class: 'button', href: playUrl(m.code), target: '_blank', rel: 'noopener' }, 'Play'),
              h('button', { type: 'button', class: 'primary', onclick: () => void copy(m.id, m.title) }, 'Make my own copy'))))),
      );
    },
    (err: unknown) => clear(list, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load your scenarios.')),
  );

  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'page-head' },
      h('div', null, h('h1', null, 'Scenarios', help('A scenario is a whole mission: its scenes, and everything that can happen in them. Each has a 16-letter code players use to open it. Export downloads one as a ZIP file (its JSON and uploaded files) to keep as a backup; Import a ZIP makes a new scenario from such a file.'))),
      h('div', { class: 'row-actions' },
        zip,
        h('button', { type: 'button', onclick: () => zip.click() }, 'Import a ZIP'),
        h('button', { type: 'button', class: 'primary', onclick: create }, 'New scenario')),
    ),
    list,
    others,
  );
}

/**
 * The profile page: a dialog that opens over the missions page and the editor alike, where a
 * signed-in person changes the name over their character and their password, or has a link
 * emailed to choose a new one.
 *
 * It lives here, apart from src/, because it is browser code (the game server builds src/ for
 * Node). The game and the editor import it by path, as they import the Twemoji stylesheet, and
 * each passes its own API calls in `ProfileActions`. Its look is its own (profile.css, beside the
 * Twemoji stylesheet), so it is the same on both pages.
 */
import { ICONS, twemojiClass, type IconName } from '../src/icons.js';
import '../assets/profile.css';

/** What `GET /api/me` says about the signed-in account. */
export interface ProfileAccount {
  name: string;
  role: string;
  /** Absent for guests and for accounts a school made (which have made-up addresses). */
  email?: string;
  /** Signs in with a password, which can be changed here. False: Google only, or a school's launch links. */
  has_password?: boolean;
  uses_google?: boolean;
  /** A rostered student's pseudonym, chosen by their school: shown, not changed. */
  name_locked?: boolean;
}

export interface PasswordChange {
  current_password: string;
  password: string;
  password_confirmation: string;
}

/** The calls the dialog makes. Each throws an Error whose message is shown as it is. */
export interface ProfileActions {
  /** The account as the server has it now (GET /api/me). */
  load(): Promise<ProfileAccount>;
  /** PATCH /api/me */
  rename(name: string): Promise<ProfileAccount>;
  /** PUT /api/me/password. How many other sign-ins of the account were ended. */
  changePassword(change: PasswordChange): Promise<{ signed_out_elsewhere?: number }>;
  /** POST /api/auth/forgot-password. The message to show. */
  sendResetLink(email: string): Promise<string>;
}

export interface ProfileOptions {
  /** The account changed (a new name): the page updates what it shows. */
  onChange?(account: ProfileAccount): void;
  onClose?(): void;
}

/** The longest name the server takes (AuthController::update). */
export const MAX_NAME_LENGTH = 60;
/** The shortest password the server takes. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * What is wrong with a new password before it is sent, or null. The server checks the same
 * (and more); this only saves a round trip for the common slips.
 */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== again) return 'The two new passwords are not the same.';
  return null;
}

type Attrs = Record<string, string | number | boolean | null | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

function icon(name: IconName): HTMLElement {
  const char = ICONS[name];
  const cls = twemojiClass(char);
  const node = h(cls ? 'i' : 'span', { class: cls ? `qbl-pf-icon twa ${cls}` : 'qbl-pf-icon', 'aria-hidden': 'true' });
  if (!cls) node.textContent = char;
  return node;
}

function field(label: string, input: HTMLInputElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'qbl-pf-field' }, h('span', { class: 'qbl-pf-label' }, label), input, hint ? h('small', { class: 'qbl-pf-hint' }, hint) : null);
}

/** A line under a form: what happened, or what went wrong. Read out when it changes. */
function statusLine(): { node: HTMLParagraphElement; ok(text: string): void; fail(text: string): void; clear(): void } {
  const node = h('p', { class: 'qbl-pf-status', role: 'status', 'aria-live': 'polite' });
  node.hidden = true;
  const set = (text: string, tone: 'ok' | 'error' | '') => {
    node.textContent = text;
    node.dataset.tone = tone;
    node.hidden = !text;
  };
  return { node, ok: (t) => set(t, 'ok'), fail: (t) => set(t, 'error'), clear: () => set('', '') };
}

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/**
 * Open the profile over the page. It draws at once from `account` and refreshes from the server
 * (`actions.load`), which says what this account may change. Closing it (the button, Escape, a
 * press outside) removes it from the page.
 */
export function openProfile(account: ProfileAccount, actions: ProfileActions, options: ProfileOptions = {}): { dialog: HTMLDialogElement; close(): void } {
  let current = { ...account };
  const closeButton = h('button', { type: 'button', class: 'qbl-pf-close', 'aria-label': 'Close' }, '×');
  const body = h('div', { class: 'qbl-pf-body' });
  const dialog = h('dialog', { class: 'qbl-profile-dialog', 'aria-labelledby': 'qbl-pf-title', 'data-dialog': 'profile' },
    h('header', { class: 'qbl-pf-top' }, h('h2', { id: 'qbl-pf-title' }, icon('profile'), 'Your profile'), closeButton),
    body,
  );
  const close = () => dialog.close();
  closeButton.addEventListener('click', close);
  // A press on the backdrop (outside the box) closes it, as a menu does.
  dialog.addEventListener('pointerdown', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    options.onClose?.();
  });

  const draw = () => body.replaceChildren(nameSection(), signInSection(), passwordSection());

  // ---- the name over the character ----
  const nameSection = (): HTMLElement => {
    const staff = current.role === 'teacher' || current.role === 'admin';
    const about = staff
      ? 'The name students and other players see: over your character in missions, and on the assignments you give.'
      : 'The name over your character in every mission. Other players and your teachers see it.';
    if (current.name_locked) {
      return h('section', { class: 'qbl-pf-section', 'data-section': 'name' },
        h('h3', {}, icon('account'), 'Your name'),
        h('p', { class: 'qbl-pf-value', 'data-name': '' }, current.name),
        h('p', { class: 'qbl-pf-hint' }, 'Your school chose this name for you, so it stays private. Ask your teacher if you would like a different one.'));
    }
    const input = h('input', { type: 'text', name: 'name', required: true, maxlength: MAX_NAME_LENGTH, autocomplete: 'nickname', spellcheck: 'false' });
    input.value = current.name;
    const save = h('button', { type: 'submit', class: 'qbl-pf-button primary' }, 'Save name');
    const status = statusLine();
    const form = h('form', { class: 'qbl-pf-form', 'data-form': 'name' },
      field('Name', input, 'Leave out your email address, phone number and anything else private.'),
      h('div', { class: 'qbl-pf-actions' }, save),
      status.node);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) return status.fail('Enter a name.');
      if (name === current.name) return status.ok('That is already your name.');
      save.disabled = true;
      status.clear();
      try {
        current = { ...current, ...(await actions.rename(name)) };
        input.value = current.name;
        status.ok('Saved. Your new name shows from the next mission you join.');
        options.onChange?.({ ...current });
      } catch (err) {
        status.fail(messageOf(err, 'Could not save your name. Try again.'));
      } finally {
        save.disabled = false;
      }
    });
    return h('section', { class: 'qbl-pf-section', 'data-section': 'name' }, h('h3', {}, icon('account'), 'Your name'), h('p', { class: 'qbl-pf-hint' }, about), form);
  };

  // ---- how this account signs in ----
  const signInSection = (): HTMLElement => {
    const lines: HTMLElement[] = [];
    if (current.email) lines.push(h('p', { class: 'qbl-pf-row' }, h('span', { class: 'qbl-pf-label' }, 'Email'), h('span', { 'data-email': '' }, current.email)));
    const ways = [current.has_password ? 'your email and password' : null, current.uses_google ? 'Google' : null].filter(Boolean);
    lines.push(h('p', { class: 'qbl-pf-hint' }, ways.length
      ? `You sign in with ${ways.join(' or ')}.`
      : current.email ? 'You sign in with a link.' : 'You sign in with a link from your school.'));
    return h('section', { class: 'qbl-pf-section', 'data-section': 'sign-in' }, h('h3', {}, icon('lock'), 'Signing in'), ...lines);
  };

  // ---- the password ----
  const passwordSection = (): HTMLElement => {
    const section = h('section', { class: 'qbl-pf-section', 'data-section': 'password' }, h('h3', {}, icon('lock'), 'Password'));
    if (!current.has_password) {
      section.append(h('p', { class: 'qbl-pf-hint' }, current.uses_google
        ? 'Your password is your Google account’s: change it with Google. There is no separate password here.'
        : 'This account has no password to change.'));
      return section;
    }
    const pw = (name: string, autocomplete: string) => h('input', { type: 'password', name, required: true, autocomplete, ...(name === 'current_password' ? {} : { minlength: MIN_PASSWORD_LENGTH }) });
    const old = pw('current_password', 'current-password');
    const next = pw('password', 'new-password');
    const again = pw('password_confirmation', 'new-password');
    const change = h('button', { type: 'submit', class: 'qbl-pf-button primary' }, 'Change password');
    const status = statusLine();
    const form = h('form', { class: 'qbl-pf-form', 'data-form': 'password' },
      // A hidden username helps password managers file the new password under the right account.
      current.email ? h('input', { type: 'email', name: 'username', value: current.email, autocomplete: 'username', hidden: true, tabindex: -1, 'aria-hidden': 'true' }) : null,
      field('Current password', old),
      field('New password', next, `At least ${MIN_PASSWORD_LENGTH} characters.`),
      field('New password again', again),
      h('div', { class: 'qbl-pf-actions' }, change),
      status.node);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const problem = passwordProblem(next.value, again.value);
      if (problem) return status.fail(problem);
      change.disabled = true;
      status.clear();
      try {
        const done = await actions.changePassword({ current_password: old.value, password: next.value, password_confirmation: again.value });
        old.value = next.value = again.value = '';
        const others = done.signed_out_elsewhere ?? 0;
        status.ok(`Password changed.${others > 0 ? ` You were signed out on ${others === 1 ? 'one other device' : `${others} other devices`}.` : ''}`);
      } catch (err) {
        status.fail(messageOf(err, 'Could not change your password. Try again.'));
      } finally {
        change.disabled = false;
      }
    });
    section.append(form);

    // Forgot the current one: the same email as the sign-in screen's "Forgot your password?".
    if (current.email) {
      const email = current.email;
      const forgot = h('button', { type: 'button', class: 'qbl-pf-link', 'data-send-reset': '' }, 'Forgot your current password? Email me a link');
      const sent = statusLine();
      forgot.addEventListener('click', async () => {
        forgot.disabled = true;
        sent.clear();
        try {
          sent.ok(await actions.sendResetLink(email));
        } catch (err) {
          sent.fail(messageOf(err, 'Could not send the email. Try again.'));
          forgot.disabled = false;
        }
      });
      section.append(h('div', { class: 'qbl-pf-forgot' }, forgot, sent.node));
    }
    return section;
  };

  draw();
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  // What this account may change comes from the server; the page's copy may be older.
  void actions.load().then(
    (fresh) => {
      if (!dialog.isConnected) return;
      const changed = fresh.name !== current.name || fresh.has_password !== current.has_password || fresh.uses_google !== current.uses_google || fresh.name_locked !== current.name_locked || fresh.email !== current.email;
      const renamed = fresh.name !== current.name;
      current = { ...current, ...fresh };
      // Renamed elsewhere (another tab, another device): the page catches up too.
      if (renamed) options.onChange?.({ ...current });
      if (changed) {
        // Keep whatever the person is typing: only redraw what they are not in.
        const typing = dialog.querySelector('form:focus-within');
        if (!typing) draw();
      }
    },
    () => undefined,
  );
  return { dialog, close };
}

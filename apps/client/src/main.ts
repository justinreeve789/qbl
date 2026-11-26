import * as Phaser from 'phaser';
import { characterPicture, isStaff, launchPath, normalizeScenario, roleLabel, resolveMediaUrl, siteLinks, validateScenario, type Id, type Scenario, type User } from '@qbl/shared';
import { pictureNode } from './ui/picture';
import { config } from './config';
import { GameContext } from './core/GameContext';
import { gameFeatures } from './features';
import { buildHome, restartQuestion } from './home';
import { Api, ApiError, takeSignInProblem, type SignUpRole } from './net/Api';
import { AFTER_SIGN_IN_KEY, showPlans } from './plans';
import { OfflineConnection, OnlineConnection, type GameConnection } from './net/Connection';
import { BootScene } from './scenes/BootScene';
// The profile dialog, shared with the editor.
import { openProfile } from '../../../packages/shared/browser/profile';
import { PlayScene } from './scenes/PlayScene';
import { setUpApp } from './pwa';
import { Ui } from './ui/Ui';
import { rolePicker } from './ui/rolePicker';
// Twemoji Awesome: the one set every icon in the interface is drawn from (see ui/icons.ts).
import '../../../packages/shared/assets/twemoji-awesome.css';
import './ui/ui.css';
import './ui/infobox/infobox.css';

const app = document.getElementById('app')!;
const gate = document.getElementById('gate')!;
const api = new Api();

function show(html: HTMLElement | string) {
  gate.hidden = false;
  if (typeof html === 'string') gate.textContent = html;
  else gate.replaceChildren(html);
}

function field(label: string, type: string, name: string, value = '', more: Partial<HTMLInputElement> = {}): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { type, name, value, required: true, autocomplete: type === 'password' ? 'current-password' : 'off' });
  if (type === 'text') input.maxLength = 24;
  Object.assign(input, more);
  wrap.appendChild(input);
  return wrap;
}

/**
 * A link that opens the sign-in form in a particular way, read from after the # and cleared:
 *   /missions#create-account              ready to make an account (the marketing page, the editor)
 *   /missions#forgot-password             ready to ask for a password link (the editor's sign-in)
 *   /missions#reset-password=…&email=…    choosing a new password, from the emailed link
 */
type FormLink = { kind: 'create' } | { kind: 'forgot' } | { kind: 'reset'; token: string; email: string };

function takeFormLink(): FormLink | null {
  const hash = window.location.hash.slice(1);
  let link: FormLink | null = null;
  if (hash === 'create-account') link = { kind: 'create' };
  else if (hash === 'forgot-password') link = { kind: 'forgot' };
  else if (hash.startsWith('reset-password=')) {
    const params = new URLSearchParams(hash);
    const token = params.get('reset-password') ?? '';
    const email = params.get('email') ?? '';
    link = token && email ? { kind: 'reset', token, email } : { kind: 'forgot' };
  }
  // The token is a secret: it leaves the address at once, so it is not kept in the history.
  if (link) history.replaceState(null, '', window.location.pathname + window.location.search);
  return link;
}

// Such a link opened in a tab already on this page changes only the #, which runs nothing: start again with it.
window.addEventListener('hashchange', () => {
  if (/^#(create-account|forgot-password|reset-password=.+)$/.test(window.location.hash)) window.location.reload();
});

type SignInMode = 'login' | 'register' | 'guest' | 'forgot' | 'reset';

/** Ask who is playing. Resolves once the API has issued a token. */
function signIn(message?: string, link: FormLink | null = null): Promise<User> {
  // A draft preview belongs to an editor account, so it always asks for a full sign-in.
  const mode0 = config.preview != null ? 'login' : config.authMode;
  // Creating an account, and choosing a new password, need the Laravel API (login mode); a preview needs an existing editor account.
  const mayRegister = config.authMode === 'login' && config.preview == null;
  const askedToRegister = link?.kind === 'create' && mayRegister;
  const reset = mayRegister && link?.kind === 'reset' ? link : null;
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'qbl-card';
    const title = document.createElement('h1');
    title.textContent = 'Quest-Based Learning';
    const error = document.createElement('p');
    error.className = 'qbl-error';
    error.textContent = message ?? '';
    // In login mode a "play as guest" link swaps the form; the API decides whether guests are allowed.
    // "Create an account" swaps it for a name, email and password form, when the server allows that.
    let mode: SignInMode = askedToRegister ? 'register' : reset ? 'reset' : mayRegister && link?.kind === 'forgot' ? 'forgot' : mode0;
    // The address typed last, carried from one form to the next.
    let email = reset?.email ?? '';
    let offers = { google: false, register: askedToRegister, teacher: false };
    // "I'm a student / a teacher", on the sign-up form when the server lets people choose.
    let role: SignUpRole | null = null;
    const picker = rolePicker((chosen) => {
      role = chosen;
      error.textContent = '';
      decorate();
    });
    const choosing = () => mode === 'register' && offers.teacher;
    const fields = document.createElement('div');
    fields.className = 'qbl-fields';
    const note = document.createElement('p');
    note.className = 'qbl-note';
    const button = document.createElement('button');
    button.className = 'qbl-button primary';
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'qbl-link';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'qbl-link';
    create.dataset.createAccount = '';
    // Offered when the server has Google sign-in set up. It leaves the page and comes back signed in.
    const google = document.createElement('button');
    google.type = 'button';
    google.className = 'qbl-button qbl-google';
    // "Forgot your password?" in the sign-in form; the way back from the forms it opens.
    const forgot = document.createElement('button');
    forgot.type = 'button';
    forgot.className = 'qbl-link';
    forgot.dataset.forgotPassword = '';
    const render = () => {
      form.dataset.mode = mode;
      fields.replaceChildren(
        ...(mode === 'login'
          ? [field('Email', 'email', 'email', email, { autocomplete: 'username' }), field('Password', 'password', 'password')]
          : mode === 'forgot'
            ? [field('Email', 'email', 'email', email, { autocomplete: 'username' })]
          : mode === 'reset'
            ? [
                // For password managers: which account the new password is for.
                Object.assign(field('Email', 'email', 'username', email, { autocomplete: 'username', readOnly: true, required: false }), { hidden: true }),
                field('New password (at least 8 characters)', 'password', 'password', '', { minLength: 8, autocomplete: 'new-password' }),
                field('Type it again', 'password', 'password_confirmation', '', { minLength: 8, autocomplete: 'new-password' }),
              ]
          : mode === 'register'
            ? [
                ...(choosing() ? [picker.node] : []),
                field('Your name', 'text', 'name', '', { maxLength: 60, autocomplete: 'name' }),
                field('Email', 'email', 'email', '', { autocomplete: 'email' }),
                field('Password (at least 8 characters)', 'password', 'password', '', { minLength: 8, autocomplete: 'new-password' }),
                field('Type the password again', 'password', 'password_confirmation', '', { minLength: 8, autocomplete: 'new-password' }),
              ]
            : [field('Your name', 'text', 'name', localStorage.getItem('qbl.name') ?? '')]),
      );
      const passwordForm = mode === 'forgot' || mode === 'reset';
      title.textContent = mode === 'register' ? 'Create an account' : mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Choose a new password' : 'Quest-Based Learning';
      decorate();
      swap.textContent = mode === 'guest' ? 'Sign in with an account' : 'Play as a guest instead';
      swap.hidden = config.authMode !== 'login' || config.preview != null || mode === 'register' || passwordForm;
      create.textContent = mode === 'register' ? 'I already have an account' : 'New here? Create an account';
      create.hidden = !mayRegister || !offers.register || mode === 'guest' || passwordForm;
      forgot.textContent = mode === 'login' ? 'Forgot your password?' : mode === 'reset' ? 'Ask for a new link' : 'Back to sign in';
      forgot.hidden = !mayRegister || (mode !== 'login' && !passwordForm);
      google.hidden = !offers.google || passwordForm;
      (fields.querySelector('label:not([hidden]) input:not([type="radio"])') as HTMLInputElement).focus();
    };
    // What follows from the role chosen (and the form's mode): the words on the button and under the title.
    function decorate() {
      const picking = choosing();
      form.dataset.role = picking && role ? role : '';
      button.textContent = mode === 'register'
        ? picking && role ? `Create ${role === 'teacher' ? 'teacher' : 'student'} account` : 'Create account'
        : mode === 'forgot' ? 'Email me a link' : mode === 'reset' ? 'Save password and sign in' : 'Continue';
      google.textContent = mode === 'register' ? 'Sign up with Google' : 'Sign in with Google';
      note.textContent = mode === 'forgot'
        ? 'Type the email address you sign in with. We will email you a link for choosing a new password. If you sign in with Google, use Google’s “Forgot password” instead.'
        : mode === 'reset'
          ? `For ${email}. Choose a password of at least 8 characters.`
          : 'New accounts are for students. Teachers: once you have an account, ask your administrator to make it a teacher’s.';
      // Choosing a role, the line about it goes under the cards instead.
      note.hidden = (mode !== 'register' || picking) && mode !== 'forgot' && mode !== 'reset';
      picker.say(role === 'teacher'
        ? 'You’ll start on the Missions page. The Editor, for building missions, and Classes, for your students, are in its menu.'
        : role === 'student'
          ? 'Your teacher can add you to their class with the email address you use here.'
          : '');
    }
    /** On the sign-up form, nothing is sent before a role is chosen. */
    const roleMissing = () => {
      if (!choosing() || role) return false;
      error.textContent = 'Choose Student or Teacher first.';
      picker.nudge();
      return true;
    };
    // Moving to another form: keep the address typed, and drop the last message.
    const typedEmail = () => {
      const input = fields.querySelector<HTMLInputElement>('input[name="email"]');
      if (input) email = input.value.trim();
      error.textContent = '';
      delete error.dataset.tone;
    };
    swap.addEventListener('click', () => {
      typedEmail();
      mode = mode === 'guest' ? 'login' : 'guest';
      render();
    });
    create.addEventListener('click', () => {
      typedEmail();
      mode = mode === 'register' ? 'login' : 'register';
      render();
    });
    forgot.addEventListener('click', () => {
      typedEmail();
      mode = mode === 'login' || mode === 'reset' ? 'forgot' : 'login';
      render();
    });
    google.addEventListener('click', () => {
      if (roleMissing()) return;
      // Google brings the browser back already signed in; this says the sign-in was just now.
      try {
        sessionStorage.setItem(SIGNING_IN_KEY, '1');
      } catch {
        /* ignore */
      }
      window.location.assign(api.googleUrl(window.location.pathname + window.location.search, mode === 'register' && choosing() ? role ?? undefined : undefined));
    });
    void api.providers().then((p) => {
      // Asked for by address, the form stays a sign-up form even if the server turned it off: it says why on submit.
      offers = { google: p.google, register: p.register || askedToRegister, teacher: p.teacher };
      // Already on the sign-up form: the question goes on top, keeping whatever was typed below it.
      if (choosing() && !picker.node.isConnected) fields.prepend(picker.node);
      decorate();
      create.hidden = !mayRegister || !offers.register || mode === 'guest' || mode === 'forgot' || mode === 'reset';
      google.hidden = !offers.google || mode === 'forgot' || mode === 'reset';
    });
    form.append(title, note, fields, error, button, google, forgot, create, swap);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      button.disabled = true;
      try {
        if (mode === 'login') {
          resolve(await api.login(String(data.get('email')), String(data.get('password'))));
        } else if (mode === 'forgot') {
          email = String(data.get('email')).trim();
          const sent = await api.forgotPassword(email);
          error.textContent = sent;
          error.dataset.tone = 'ok';
          button.disabled = false;
        } else if (mode === 'reset') {
          const password = String(data.get('password'));
          if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
          if (password !== data.get('password_confirmation')) throw new Error('The two passwords are not the same.');
          resolve(await api.resetPassword({ token: reset!.token, email, password, password_confirmation: password }));
        } else if (mode === 'register') {
          if (roleMissing()) {
            button.disabled = false;
            return;
          }
          if (data.get('password') !== data.get('password_confirmation')) throw new Error('The two passwords are not the same.');
          resolve(
            await api.register({
              name: String(data.get('name')).trim(),
              email: String(data.get('email')).trim(),
              password: String(data.get('password')),
              password_confirmation: String(data.get('password_confirmation')),
              ...(choosing() && role ? { role } : {}),
            }),
          );
        } else {
          const name = String(data.get('name')).trim();
          localStorage.setItem('qbl.name', name);
          resolve(await api.guest(name));
        }
      } catch (err) {
        delete error.dataset.tone;
        error.textContent = err instanceof Error ? err.message : 'Could not sign in.';
        button.disabled = false;
      }
    });
    show(form);
    render();
  });
}

const SIGNING_IN_KEY = 'qbl.signing-in';

/** True once, on the page a Google sign-in started from this tab comes back to. */
function takeSigningIn(): boolean {
  try {
    const was = sessionStorage.getItem(SIGNING_IN_KEY) != null;
    sessionStorage.removeItem(SIGNING_IN_KEY);
    return was;
  } catch {
    return false;
  }
}

/** Where to go once signed in, left by a page that sent someone to sign in (see plans.ts). Read once. */
function takeAfterSignIn(): string | null {
  try {
    const path = sessionStorage.getItem(AFTER_SIGN_IN_KEY);
    sessionStorage.removeItem(AFTER_SIGN_IN_KEY);
    return path && /^\/(?!\/)/.test(path) ? path : null;
  } catch {
    return null;
  }
}

const AVATAR_KEY = 'qbl.avatar';

/** Keep the player's choice of avatar: on their account, and in this browser for guests. */
function rememberAvatar(user: User, id: Id) {
  try {
    localStorage.setItem(AVATAR_KEY, String(id));
  } catch {
    /* ignore */
  }
  if (user.role !== 'guest') void api.setAvatar(Number(id)).catch(() => undefined);
}

/**
 * The player's avatar. Avatars belong to the platform, not the scenario, so the one chosen
 * before (kept on the account) is used everywhere; the player is only asked the first time.
 */
function chooseAvatar(scenario: Scenario, user: User): Promise<Id | undefined> {
  const avatars = scenario.avatars ?? [];
  const ids = avatars.map((a) => a.id);
  if (ids.length <= 1) return Promise.resolve(ids[0]);
  if (user.avatar_media_id != null && ids.includes(user.avatar_media_id)) return Promise.resolve(user.avatar_media_id);
  const remembered = Number(localStorage.getItem(AVATAR_KEY));
  if (ids.includes(remembered)) return Promise.resolve(remembered);
  const media = new Map((scenario.assets ?? []).map((m) => [m.id, m]));
  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.className = 'qbl-card';
    const title = document.createElement('h1');
    title.textContent = 'Choose your character';
    const grid = document.createElement('div');
    grid.className = 'qbl-avatars';
    for (const avatar of avatars) {
      const picture = characterPicture(avatar, 'stand', (id) => media.get(id), (m) => resolveMediaUrl(scenario, m));
      if (!picture?.url) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', avatar.name);
      b.title = avatar.name;
      // Standing: a picture, or one frame of a sprite sheet, not the whole sheet.
      b.appendChild(pictureNode(picture, picture.sheet ? 'qbl-avatar-frame' : ''));
      b.addEventListener('click', () => {
        rememberAvatar(user, avatar.id);
        resolve(avatar.id);
      });
      grid.appendChild(b);
    }
    card.append(title, grid);
    show(card);
  });
}

/**
 * The missions page, shown when no scenario was asked for. Choosing a mission opens its own
 * address, so this never returns once the page is up. False: this backend has no missions
 * to list (the file backend), and the default scenario should be played instead.
 */
async function showHome(user: User): Promise<boolean> {
  const missions = await api.missions();
  if (!missions) return false;
  const { avatars, avatar_media_id } = await api.avatars();
  const remembered = Number(localStorage.getItem(AVATAR_KEY)) || null;
  document.title = 'Missions';
  gate.classList.add('home');
  gate.removeAttribute('role');
  show(buildHome({
    user,
    missions,
    avatars,
    avatarId: avatar_media_id ?? remembered,
    onAvatar: (id) => rememberAvatar(user, id),
    onSignOut: () => {
      api.signOut();
      window.location.reload();
    },
    // The profile page, over this one. Guests have no account to change.
    onProfile: user.role === 'guest' ? undefined : (renamed) => {
      openProfile(user, {
        load: async () => (await api.me()) ?? user,
        rename: (name) => api.rename(name),
        changePassword: (change) => api.changePassword(change),
        sendResetLink: (email) => api.forgotPassword(email),
      }, {
        onChange: (account) => {
          user.name = account.name;
          renamed(account.name);
        },
      });
    },
    desk: isStaff(user.role) ? api.teacherDesk() : undefined,
    onRestart: isStaff(user.role) ? async (m) => void (await api.resetOwnProgress(m.id, m.group)) : undefined,
    // A school-run account has a placeholder address, so no address and no password of its own.
    managed: user.role !== 'guest' && !user.email && user.has_password === false,
  }));
  return true;
}

/** Fetch a draft from the editor API and refuse to play one the validator rejects, saying why. */
async function loadDraft(scenarioId: number): Promise<Scenario> {
  const raw = await api.preview(scenarioId);
  const check = validateScenario(raw);
  if (!check.ok) {
    const lines = check.errors.slice(0, 8).map((e) => `${e.path}: ${e.message}`);
    throw new Error(`This draft cannot be played yet:\n${lines.join('\n')}`);
  }
  const scenario = normalizeScenario(raw);
  // Start where the editor asked, with a clean slate every time.
  scenario.session = config.startScene != null ? { scene_id: config.startScene } : null;
  return scenario;
}

async function loadScenario(): Promise<{ scenario: Scenario; user: User }> {
  // A link to a password form (from an email, or the editor's sign-in) shows that form even to a
  // browser that is signed in: it is usually for another account, which then replaces this one.
  let link = takeFormLink();
  let user = link?.kind === 'reset' || link?.kind === 'forgot' ? null : await api.me();
  // Signed in just now (here, or on the way back from Google), as opposed to arriving signed in.
  let fresh = takeSigningIn() && user != null;
  let message: string | undefined;
  for (;;) {
    if (!user) {
      user = await signIn(message ?? takeSignInProblem(), link);
      link = null;
      fresh = true;
    }
    show('Loading…');
    try {
      if (config.preview != null) return { scenario: await loadDraft(config.preview), user };
      // A page that sent someone to sign in (the plans page) gets them back once they have.
      const after = fresh ? takeAfterSignIn() : null;
      if (after) {
        window.location.replace(after);
        return new Promise(() => undefined);
      }
      // With no scenario asked for, everyone (teachers too) lands on their missions page and chooses
      // one there; that page takes over from here. Teachers reach the editor and Classes from its menu.
      if (config.home && (await showHome(user))) return new Promise(() => undefined);
      return { scenario: normalizeScenario(await api.play(config.scenario, config.group, config.party)), user };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        gate.classList.remove('home');
        api.signOut();
        user = null;
        message = 'Please sign in to play this scenario.';
        continue;
      }
      throw err;
    }
  }
}

async function start() {
  const { scenario, user } = await loadScenario();
  document.title = scenario.title;
  const avatarId = await chooseAvatar(scenario, user);
  show('Joining…');

  const connection: GameConnection = config.offline
    ? new OfflineConnection(scenario, user, avatarId)
    : await OnlineConnection.join(config.serverUrl, {
        scenario: scenario.code ?? scenario.shortname,
        group: config.group,
        // The room this instance belongs to, as the API named it: teams of one assignment share a room.
        party: scenario.instance?.party ?? config.party ?? config.group,
        token: api.token ?? undefined,
        name: user.name,
        avatar_media_id: avatarId,
        // A teacher switching team arrives where the team is (the server ignores this for anyone else).
        scene_id: config.preview == null ? (config.startScene ?? undefined) : undefined,
      });
  // That was for arriving only: a reload should go back to wherever the teacher is by then.
  if (config.startScene != null && config.preview == null) {
    const url = new URL(window.location.href);
    url.searchParams.delete('scene');
    window.history.replaceState(null, '', url);
  }

  const ui = new Ui(app);
  const ctx = new GameContext(scenario, user, connection, ui, { debug: config.debug });
  // Stars, XP and the marketplace belong to an account. A preview gets a pretend account with
  // stars to try the shop with, so testing a draft never spends or earns anything real.
  const key = scenario.code ?? scenario.shortname ?? config.scenario;
  if (user.role !== 'guest') {
    await ctx.rewards.connect({ shop: () => api.shop(key), buy: (id) => api.buy(id, key), equip: (id, on) => api.equip(id, on) });
  }
  if (config.preview != null) ctx.rewards.pretend(500);
  // Other players' profiles come from the API, which a preview and the standalone game server do not have.
  if (!config.offline) ctx.fetchProfile = (userId) => api.profile(userId);
  // A teacher follows one team of an assignment at a time, as a member of its game, and can
  // switch: they leave this game and join the other team's, in the scene where that team is.
  if (!config.offline && config.preview == null && isStaff(user.role)) {
    const here = scenario.instance?.group ?? config.group;
    ctx.fetchTeams = () => api.teamsToFollow(here);
    ctx.followTeam = (group, sceneId) => {
      ctx.saveProgress(true);
      connection.leave();
      const query = new URLSearchParams({ group });
      if (sceneId != null) query.set('scene', String(sceneId));
      window.location.assign(`/${encodeURIComponent(String(key))}?${query}`);
    };
  }
  // A teacher's launch sends the players into another mission: leaving saves first, like any way out.
  if (!config.offline && config.preview == null) {
    ctx.goToMission = (launch) => {
      ctx.saveProgress(true);
      connection.leave();
      ui.status(`🚀 Off to ${launch.title}…`);
      window.location.assign(launch.url ?? launchPath(launch.code, launch.group));
    };
    // An Open URL action in the same tab: leaving saves first, like any way out.
    ctx.leavePage = (href) => {
      ctx.saveProgress(true);
      connection.leave();
      window.location.assign(href);
    };
    // Teachers launch their missions for the class from here.
    if (isStaff(user.role)) ctx.fetchLaunchable = () => api.launchable();
  }
  // The player's own button, top right: their profile, the wardrobe, the site's other places
  // (for a teacher: Editor, Classes, Docs), and signing out. Leaving saves first. A preview
  // shares its sign-in with the editor it was opened from, so it offers no signing out or places.
  const preview = config.preview != null;
  const leave = (href: string) => {
    ctx.saveProgress(true);
    connection.leave();
    window.location.assign(href);
  };
  // The player's character standing, as the chooser shows it (the room gives the first avatar when
  // none was chosen). An avatar's id is not its picture's id: since avatars became characters, the
  // picture is whichever media its standing pose uses.
  const mine = (scenario.avatars ?? []).find((a) => a.id === avatarId) ?? scenario.avatars?.[0];
  const face = mine ? characterPicture(mine, 'stand', (id) => ctx.index.media.get(id), (m) => resolveMediaUrl(scenario, m)) : null;
  ui.account({
    name: user.name,
    guest: user.role === 'guest',
    subtitle: user.role === 'guest' ? 'Playing as a guest' : isStaff(user.role) ? roleLabel(user.role) : undefined,
    avatar: face?.url ? face : null,
    links: preview ? [] : siteLinks(user.role),
  }, {
    leave,
    profile: () => ctx.showProfile?.(connection.sessionId),
    // A teacher trying a mission out can start it again. Their save here is deleted first, so the
    // game is left without saving (the server refuses the old save) and the page loads afresh.
    restart: preview || config.offline || !isStaff(user.role) || scenario.enable_save_session === false ? undefined : () => {
      if (!window.confirm(restartQuestion(scenario.title))) return;
      api.resetOwnProgress(Number(scenario.id), scenario.instance?.group ?? config.group ?? 'public').then(() => {
        connection.leave();
        window.location.reload();
      }, (err) => ui.toast(err instanceof Error ? err.message : 'Could not start the mission again.'));
    },
    // Signing out leaves the game and comes back to the sign-in screen.
    signOut: preview ? null : () => {
      ctx.saveProgress(true);
      connection.leave();
      api.signOut();
      window.location.reload();
    },
  });
  // Session-long features: connection status, chat, the mission checklist, saving progress.
  for (const feature of gameFeatures()) feature.start(ctx);

  if (config.preview != null) ui.toast('Preview of your draft. You are playing alone and nothing is saved.', 6000);

  gate.hidden = true;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1c172e',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    // Created by hand so the context is in the registry before any scene runs.
    scene: [],
    audio: { disableWebAudio: false },
  });
  game.registry.set('ctx', ctx);
  game.scene.add('play', PlayScene, false);
  game.scene.add('boot', BootScene, true);
}

setUpApp();
(config.plans ? showPlans(api) : start()).catch((err) => {
  console.error(err);
  show(err instanceof Error ? err.message : 'Something went wrong.');
});

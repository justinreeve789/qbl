import * as Phaser from 'phaser';
import { normalizeScenario, resolveMediaUrl, validateScenario, type Id, type Scenario, type User } from '@qbl/shared';
import { config } from './config';
import { GameContext } from './core/GameContext';
import { gameFeatures } from './features';
import { Api, ApiError, takeSignInProblem } from './net/Api';
import { OfflineConnection, OnlineConnection, type GameConnection } from './net/Connection';
import { BootScene } from './scenes/BootScene';
import { PlayScene } from './scenes/PlayScene';
import { Ui } from './ui/Ui';
import './ui/ui.css';

const app = document.getElementById('app')!;
const gate = document.getElementById('gate')!;
const api = new Api();

function show(html: HTMLElement | string) {
  gate.hidden = false;
  if (typeof html === 'string') gate.textContent = html;
  else gate.replaceChildren(html);
}

function field(label: string, type: string, name: string, value = ''): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { type, name, value, required: true, autocomplete: type === 'password' ? 'current-password' : 'off' });
  if (type === 'text') input.maxLength = 24;
  wrap.appendChild(input);
  return wrap;
}

/** Ask who is playing. Resolves once the API has issued a token. */
function signIn(message?: string): Promise<User> {
  // A draft preview belongs to an editor account, so it always asks for a full sign-in.
  const mode0 = config.preview != null ? 'login' : config.authMode;
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'qbl-card';
    const title = document.createElement('h1');
    title.textContent = 'Quest-Based Learning';
    const error = document.createElement('p');
    error.className = 'qbl-error';
    error.textContent = message ?? '';
    // In login mode a "play as guest" link swaps the form; the API decides whether guests are allowed.
    let mode: 'login' | 'guest' = mode0;
    const fields = document.createElement('div');
    fields.className = 'qbl-fields';
    const button = document.createElement('button');
    button.className = 'qbl-button primary';
    button.textContent = 'Continue';
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'qbl-link';
    const render = () => {
      fields.replaceChildren(
        ...(mode === 'login'
          ? [field('Email', 'email', 'email'), field('Password', 'password', 'password')]
          : [field('Your name', 'text', 'name', localStorage.getItem('qbl.name') ?? '')]),
      );
      swap.textContent = mode === 'login' ? 'Play as a guest instead' : 'Sign in with an account';
      swap.hidden = config.authMode !== 'login' || config.preview != null;
      (fields.querySelector('input') as HTMLInputElement).focus();
    };
    swap.addEventListener('click', () => {
      mode = mode === 'login' ? 'guest' : 'login';
      error.textContent = '';
      render();
    });
    // Offered when the server has Google sign-in set up. It leaves the page and comes back signed in.
    const google = document.createElement('button');
    google.type = 'button';
    google.className = 'qbl-button qbl-google';
    google.textContent = 'Sign in with Google';
    google.hidden = true;
    google.addEventListener('click', () => window.location.assign(api.googleUrl(window.location.pathname + window.location.search)));
    void api.providers().then((p) => (google.hidden = !p.google));
    form.append(title, fields, error, button, google, swap);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      button.disabled = true;
      try {
        if (mode === 'login') {
          resolve(await api.login(String(data.get('email')), String(data.get('password'))));
        } else {
          const name = String(data.get('name')).trim();
          localStorage.setItem('qbl.name', name);
          resolve(await api.guest(name));
        }
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : 'Could not sign in.';
        button.disabled = false;
      }
    });
    show(form);
    render();
  });
}

/** Let the player pick one of the scenario's avatars. Remembers the choice per scenario. */
function chooseAvatar(scenario: Scenario): Promise<Id | undefined> {
  const ids = scenario.avatar_media_ids ?? [];
  if (ids.length <= 1) return Promise.resolve(ids[0]);
  const storageKey = `qbl.avatar.${scenario.shortname}`;
  const remembered = Number(localStorage.getItem(storageKey));
  if (ids.includes(remembered)) return Promise.resolve(remembered);
  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.className = 'qbl-card';
    const title = document.createElement('h1');
    title.textContent = 'Choose your character';
    const grid = document.createElement('div');
    grid.className = 'qbl-avatars';
    for (const id of ids) {
      const media = (scenario.assets ?? []).find((m) => m.id === id);
      const url = media ? resolveMediaUrl(scenario, media) : null;
      if (!url) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Character ${ids.indexOf(id) + 1}`);
      if (media?.sheet) {
        // A sprite sheet: show its first frame, not the whole sheet.
        const frame = document.createElement('span');
        frame.className = 'qbl-avatar-frame';
        frame.style.backgroundImage = `url("${url}")`;
        frame.style.backgroundSize = `${media.sheet.columns * 100}% ${media.sheet.rows * 100}%`;
        b.appendChild(frame);
      } else {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        b.appendChild(img);
      }
      b.addEventListener('click', () => {
        localStorage.setItem(storageKey, String(id));
        resolve(id);
      });
      grid.appendChild(b);
    }
    card.append(title, grid);
    show(card);
  });
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
  let user = await api.me();
  let message: string | undefined;
  for (;;) {
    user ??= await signIn(message ?? takeSignInProblem());
    show('Loading…');
    try {
      if (config.preview != null) return { scenario: await loadDraft(config.preview), user };
      return { scenario: normalizeScenario(await api.play(config.scenario)), user };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
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
  const avatarId = await chooseAvatar(scenario);
  show('Joining…');

  const connection: GameConnection = config.offline
    ? new OfflineConnection(scenario, user, avatarId)
    : await OnlineConnection.join(config.serverUrl, {
        scenario: scenario.code ?? scenario.shortname,
        group: config.group,
        token: api.token ?? undefined,
        name: user.name,
        avatar_media_id: avatarId,
      });

  const ui = new Ui(app);
  const ctx = new GameContext(scenario, user, connection, ui, { debug: config.debug });
  // Stars, XP and the marketplace belong to an account. A preview gets a pretend account with
  // stars to try the shop with, so testing a draft never spends or earns anything real.
  const key = scenario.code ?? scenario.shortname ?? config.scenario;
  if (user.role !== 'guest') {
    await ctx.rewards.connect({ shop: () => api.shop(key), buy: (id) => api.buy(id, key), equip: (id, on) => api.equip(id, on) });
  }
  if (config.preview != null) ctx.rewards.pretend(500);
  // Signing out leaves the game and comes back to the sign-in screen. Not offered in a preview:
  // that window shares its sign-in with the editor it was opened from.
  if (config.preview == null) {
    ui.account({ name: user.name, guest: user.role === 'guest' }, () => {
      ctx.saveProgress(true);
      connection.leave();
      api.signOut();
      window.location.reload();
    });
  }
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

start().catch((err) => {
  console.error(err);
  show(err instanceof Error ? err.message : 'Something went wrong.');
});

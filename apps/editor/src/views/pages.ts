import { codeProblem, editsAllScenarios, mainLayerIndex, normalizeCode, SCENARIO_CODE_MAX, validateScenario } from '@qbl/shared';
import { session } from '../session';
import { issueItem } from './issues';
import { playUrl, previewUrl } from '../config';
import { mediaUrl, params, sceneLabel } from '../describe';
import { clear, confirmDelete, h, toast, help } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { SCENARIO_FIELDS, SCENARIO_SETTINGS_FIELDS } from '../schema';
import { icon } from '../icons';
import { sceneGroupControl, sceneGroupsCard } from './glossary';
import { chip, deleteIcon, groupTone, pick, tileTitle } from './kit';
import { sceneMap } from './sceneMap/sceneMap';
import { duplicateScene } from '../clipboard';
import { generateSceneButton } from './sceneGenerate';

/** The scenario's own pages: its scenes, its settings, and checking and publishing it. */

export function scenesPage(ctx: FormContext, open: (sceneId: number) => void): HTMLElement {
  const { store } = ctx;
  const scenes = [...store.rows('scenes')].sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);
  const start = store.scenario.start_scene_id;

  const add = async () => {
    const name = window.prompt('Short name for the new scene (for example: forest-path):')?.trim();
    if (name == null) return;
    const row = await store.add('scenes', { shortname: name || undefined });
    if (row) open(row.id);
  };
  const move = (index: number, by: number) => {
    const order = [...scenes];
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved!);
    order.forEach((s, i) => s.sequence !== i + 1 && void store.patch('scenes', s.id, { sequence: i + 1 }, true));
  };

  const groups = (store.settings.scene_groups as Array<{ id: number; name?: string }> | undefined) ?? [];
  const cards = scenes.map((scene, index) => {
    const layers = scene.background_media as Array<Record<string, unknown>> | null;
    const first = layers?.[mainLayerIndex(layers)];
    const url = first ? mediaUrl(store, store.byId('media', (first.media_id ?? first.id) as number | null)) : null;
    const events = store.where('events', 'scene_id', scene.id);
    const hotspots = events.filter((e) => e.kind === 'hotspot').length;
    const others = events.length - hotspots;
    const spawns = (params(scene, 'layout').spawn_points as unknown[] | undefined)?.length ?? 0;
    const isStart = scene.id === start;
    const group = groups.findIndex((g) => g.id === scene.group_id);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return h(
      'div',
      { class: `card tile scene-card${isStart ? ' start' : ''}`, 'data-scene': scene.id, style: group >= 0 ? `--tone: ${groupTone(group)}` : null },
      h('button', { type: 'button', class: 'thumb-button', onclick: () => open(scene.id), 'aria-label': `Edit ${sceneLabel(scene)}` },
        url ? h('img', { src: url, alt: '', loading: 'lazy' }) : h('span', { class: 'muted' }, 'No background yet'),
        isStart ? h('span', { class: 'start-flag' }, '🚩 Start scene') : null),
      tileTitle(sceneLabel(scene), null, h('span', { class: 'muted tile-id' }, `${index + 1} of ${scenes.length}`)),
      scene.subtitle ? h('p', { class: 'tile-text one-line', title: String(scene.subtitle) }, String(scene.subtitle)) : null,
      h('div', { class: 'chips' },
        chip(`${scene.width ?? '?'}×${scene.height ?? '?'}`, { title: 'Size in pixels' }),
        chip(plural(hotspots, 'hotspot'), { tone: 'var(--click)', icon: '🎯' }),
        others ? chip(plural(others, 'event'), { tone: 'var(--exit)', icon: '⚡', title: 'Events other than hotspots: on arrival, timers, and so on' }) : null,
        chip(plural(spawns, 'spawn point'), { tone: 'var(--warn)', icon: '📍' })),
      sceneGroupControl(ctx, scene),
      h(
        'div',
        { class: 'row-actions tile-actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => open(scene.id) }, '✏️ Edit'),
        h('a', { class: 'button', href: previewUrl(store.scenarioId, scene.id), target: 'qbl-preview' }, '▶ Test'),
        h('button', {
          type: 'button', class: 'icon', 'data-duplicate-scene': '', title: 'Duplicate: a copy of this scene and everything in it', 'aria-label': `Duplicate ${sceneLabel(scene)}`,
          onclick: async () => {
            const id = await duplicateScene(store, scene.id);
            if (id != null) toast(`Made “${sceneLabel(store.byId('scenes', id))}”, a copy of “${sceneLabel(scene)}”.`, 'info', { label: 'Open it', run: () => open(id) });
          },
        }, '📄'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon', disabled: index === 0, title: 'Move earlier', 'aria-label': 'Move earlier', onclick: () => move(index, -1) }, '←'),
        h('button', { type: 'button', class: 'icon', disabled: index === scenes.length - 1, title: 'Move later', 'aria-label': 'Move later', onclick: () => move(index, 1) }, '→'),
        isStart ? null : h('button', { type: 'button', class: 'icon make-start', title: 'Make this the start scene', 'aria-label': 'Make this the start scene', onclick: () => void store.patchScenario({ start_scene_id: scene.id }, true) }, '🚩'),
        scenes.length <= 1 ? null : deleteIcon(() => confirmDelete(`the scene “${sceneLabel(scene)}” and everything in it`) && void store.remove('scenes', scene.id), `Delete ${sceneLabel(scene)}`),
      ),
    );
  });

  const mapped = scenesLayout() === 'map';
  const choose = (layout: ScenesLayout) => {
    chosenLayout = layout;
    try {
      window.localStorage.setItem(SCENES_LAYOUT_KEY, layout);
    } catch {
      /* storage turned off: the choice lasts while the editor is open */
    }
    // The Scenes page is drawn again on any change; this is a change only to how it is shown.
    store.emit(false);
  };
  const switcher = h('div', { class: 'view-switch', role: 'group', 'aria-label': 'Show scenes as' },
    h('button', { type: 'button', 'data-layout': 'cards', 'aria-pressed': String(!mapped), onclick: () => choose('cards') }, icon('groups'), 'Cards'),
    h('button', { type: 'button', 'data-layout': 'map', 'aria-pressed': String(mapped), onclick: () => choose('map') }, icon('scenes'), 'Map'));

  return h(
    'div',
    { class: mapped ? 'page map-page' : 'page' },
    h(
      'div',
      { class: 'page-head' },
      h('div', null, h('h1', null, 'Scenes', h('span', { class: 'count' }, String(scenes.length)), help(mapped
        ? 'The places that make up the mission, and the ways between them. Each box is a scene and each arrow a jump: a hotspot or event that takes players to another scene. Drag boxes to lay the mission out, drag a box’s + onto another box to link them, and click ✏️ to edit a scene.'
        : 'The places that make up the mission. Players move between them through jump actions, usually on a hotspot along an edge.'))),
      h('div', { class: 'row-actions' }, switcher, mapped ? null : generateSceneButton(ctx), mapped ? null : h('button', { type: 'button', class: 'primary', onclick: add }, 'New scene')),
    ),
    ...(mapped
      ? [sceneMap(ctx, open)]
      : [sceneGroupsCard(ctx), h('div', { class: 'grid tiles scene-grid' }, ...cards)]),
  );
}

type ScenesLayout = 'cards' | 'map';
const SCENES_LAYOUT_KEY = 'qbl.editor.scenes-layout';
/** The choice made since the editor was opened. */
let chosenLayout: ScenesLayout | null = null;

/** Whether the Scenes page shows cards or the map. Each browser remembers its own choice. */
function scenesLayout(): ScenesLayout {
  if (chosenLayout) return chosenLayout;
  try {
    return window.localStorage.getItem(SCENES_LAYOUT_KEY) === 'map' ? 'map' : 'cards';
  } catch {
    return 'cards';
  }
}

export function settingsPage(ctx: FormContext, deleted: () => void): HTMLElement {
  const { store } = ctx;
  const column = (fields: string[]) => form(pick(SCENARIO_FIELDS, fields), store.scenario, (key, value) => void store.patchScenario({ [key]: value }, key.endsWith('_id')), ctx);
  const setting = (fields: string[]) => form(pick(SCENARIO_SETTINGS_FIELDS, fields), store.settings, (key, value, field) => void store.patchScenario({ settings: withValue(store.settings, key, value, field) }), ctx);
  const part = (title: string, tone: string, key: string, ...children: Array<HTMLElement | null>) =>
    h('section', { class: 'card settings-section', 'data-section': key, style: `--tone: ${tone}` }, h('h2', { class: 'section-head' }, title), ...children);
  return h(
    'div',
    { class: 'page settings-page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings', help('What the scenario is called and how it is played.')))),
    part('📝 About the mission', 'var(--tone-all)', 'about',
      column(['title', 'subtitle', 'description', 'shortname', 'default_language', 'intro_media_landscape_id', 'intro_media_portrait_id'])),
    part('🎮 Who plays, and how', 'var(--ok)', 'playing',
      setting(['visibility', 'wait_for_launch']),
      editsAllScenarios(session.role)
        ? setting(['tier'])
        : store.settings.tier === 'curricular' ? h('p', { class: 'muted', 'data-tier': 'curricular' }, '🔒 A curricular mission: teachers need a teacher plan to play and assign it.') : null,
      column(['start_scene_id', 'max_players', 'require_login', 'enable_save_session', 'allow_groups']),
      setting(['move_speed'])),
    part('💬 Talking and reading', 'var(--tone-character)', 'chat',
      setting(['chat_mode', 'private_messages', 'notebook', 'narration', 'narrator_voice'])),
    part('🔊 Music', 'var(--tone-audio)', 'music',
      setting(['music_media_id', 'music_volume'])),
    part('🧰 Advanced', 'var(--tone-other)', 'advanced',
      setting(['asset_base_url'])),
    h(
      'div',
      { class: 'card settings-section', 'data-card': 'backup', style: '--tone: var(--accent)' },
      h('h2', { class: 'section-head' }, '💾 Back up or copy', help('Export downloads the whole scenario as one ZIP file: its JSON and the files uploaded for it. Importing that file (on the Scenarios page) makes a new scenario from it. Duplicate makes a copy here, to change without touching this one.')),
      h('div', { class: 'row-actions' },
        h('button', {
          type: 'button',
          onclick: async () => {
            await store.settled();
            await store.api.exportZip(store.scenarioId).catch((err: Error) => toast(err.message, 'error'));
          },
        }, 'Export as a ZIP'),
        h('button', {
          type: 'button',
          onclick: async () => {
            await store.settled();
            await store.api.duplicate(store.scenarioId).then((made) => {
              toast('Copied. You are now editing the copy.');
              window.location.hash = `#/s/${made.id}`;
            }, (err: Error) => toast(err.message, 'error'));
          },
        }, 'Duplicate')),
    ),
    h(
      'div',
      { class: 'card settings-section danger-zone', style: '--tone: var(--danger)' },
      h('h2', { class: 'section-head' }, '⚠️ Delete this scenario'),
      h('p', { class: 'muted' }, 'Removes the scenario, its scenes and every player’s saved progress in it. Uploaded files are removed with it.'),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete(`the scenario “${store.scenario.title}”, its scenes and every player’s saved progress in it`)) return;
          await store.settled();
          await store.api.deleteScenario(store.scenarioId).then(deleted, (err: Error) => toast(err.message, 'error'));
        },
      }, 'Delete scenario'),
    ),
  );
}

/** Check the scenario with the same validator the game uses, and publish it. */
/**
 * Check the scenario with the validator the game uses and, if nothing stops it, publish.
 * Used by the Publish page and by the Publish button that is on every page.
 */
export async function checkAndPublish(store: FormContext['store']): Promise<{ published: boolean; errors: number; warnings: number; message?: string }> {
  await store.settled();
  let report;
  try {
    report = validateScenario(await store.api.preview(store.scenarioId));
  } catch (err) {
    return { published: false, errors: 1, warnings: 0, message: err instanceof Error ? err.message : 'Could not load the scenario.' };
  }
  const published = report.ok && (await store.publish());
  return { published, errors: report.errors.length, warnings: report.warnings.length };
}

export function publishPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const scenario = store.scenario;
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const publish = h('button', { type: 'button', class: 'primary', onclick: () => void run(true) }, 'Check and publish');

  async function run(thenPublish: boolean) {
    clear(results, h('p', { class: 'muted' }, 'Checking…'));
    await store.settled();
    let report;
    let doc: unknown;
    try {
      doc = await store.api.preview(store.scenarioId);
      report = validateScenario(doc);
    } catch (err) {
      return clear(results, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the scenario.'));
    }
    const { errors, warnings } = report;
    const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
    clear(
      results,
      report.ok
        ? h('p', { class: `issue ok result-banner ${warnings.length ? 'warning' : 'ok'}` }, warnings.length ? `✅ No errors. ${warnings.length === 1 ? 'The warning below is' : `The ${count(warnings.length, 'warning')} below are`} worth a look.` : '✅ No problems found.')
        : h('p', { class: 'issue error result-banner error' }, `❌ ${count(errors.length, 'error')} to fix before this can be published.`, warnings.length ? ` Also ${count(warnings.length, 'warning')}.` : null),
      errors.length || warnings.length
        ? h('ul', { class: 'issues' }, ...errors.map((i) => issueItem(ctx, doc, i)), ...warnings.map((i) => issueItem(ctx, doc, i)))
        : null,
      errors.length || warnings.length ? h('p', { class: 'muted small' }, '“Go there” opens the place to fix. Come back with the Publish tab: it checks again each time it opens.') : null,
    );
    if (thenPublish && report.ok && (await store.publish())) toast('Published. Players now get this version.');
  }

  const linkBox = playerLink(ctx);

  // Checked on opening, so coming back after a fix shows what is left.
  queueMicrotask(() => void run(false));

  const state = !scenario.published_at ? 'draft' : store.unpublished ? 'changed' : 'published';
  const status = state === 'draft'
    ? 'Not published yet. Players cannot open it.'
    : state === 'changed'
      ? `Published ${scenario.published_at} UTC. There are changes since then that players do not have.`
      : `Published ${scenario.published_at} UTC. Players have the latest version.`;
  const stateLabel = { draft: '📝 Draft', changed: '✏️ Unpublished changes', published: '✅ Published' }[state];

  return h(
    'div',
    { class: 'page narrow publish-page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Publish', help('Publishing generates the scenario’s JSON from what you have built and makes it what players get. Until you publish again, players keep the last published version.')))),
    h(
      'section',
      { class: 'card settings-section', 'data-section': 'status', style: `--tone: ${state === 'published' ? 'var(--ok)' : 'var(--warn)'}` },
      h('h2', { class: 'section-head' }, '🚀 Status', h('span', { class: 'state-pill', 'data-state': state }, stateLabel)),
      h('p', { 'data-status': state }, status),
      h('div', { class: 'row-actions' }, publish, h('button', { type: 'button', onclick: () => void run(false) }, 'Check only'), h('a', { class: 'button', href: previewUrl(store.scenarioId), target: 'qbl-preview' }, '▶ Test the draft')),
      results,
    ),
    h(
      'section',
      { class: 'card settings-section', 'data-section': 'link', style: '--tone: var(--accent)' },
      h('h2', { class: 'section-head' }, '🔗 Player link'),
      linkBox,
    ),
  );
}

/**
 * The "Player link" box: the code, the link, Copy, and Change code. Changing the code opens a
 * small form in place, checked as it is typed with the same rules the API uses.
 */
function playerLink(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const box = h('div', { 'data-player-link': '' });

  const show = () => {
    const code = String(store.scenario.code ?? '');
    const link = playUrl(code);
    clear(
      box,
      h('div', { class: 'link-box' },
        h('code', { class: 'code', 'data-code': '' }, code),
        h('a', { class: 'link-url', href: link, target: '_blank', rel: 'noopener' }, link),
        h('button', { type: 'button', onclick: () => void navigator.clipboard?.writeText(link).then(() => toast('Link copied.')) }, '📋 Copy link'),
        h('button', { type: 'button', 'data-action': 'change-code', onclick: edit }, '✏️ Change code')),
      h('p', { class: 'muted small' }, 'Players open the scenario at this address. You can change the code to something easier to type; the old link then stops working.'),
    );
  };

  const edit = () => {
    const old = String(store.scenario.code ?? '');
    const input = h('input', {
      type: 'text', value: old, maxlength: SCENARIO_CODE_MAX, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none',
      'aria-label': 'New code', 'data-field': 'code', oninput: () => update(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') void save();
        if (e.key === 'Escape') show();
      },
    });
    const preview = h('span', { class: 'link-url muted' });
    const message = h('p', { class: 'small', role: 'status', 'data-code-message': '' });
    const saveButton = h('button', { type: 'button', class: 'primary', onclick: () => void save() }, 'Save code');

    const update = (refused?: string) => {
      const code = normalizeCode(input.value);
      const problem = refused ?? (code === old ? null : codeProblem(code));
      preview.textContent = playUrl(code || '…');
      saveButton.disabled = code === old || problem !== null;
      message.className = `small ${problem ? 'issue error' : 'muted'}`;
      message.textContent = problem ?? (code === old ? 'Type the new code: 4 to 32 lowercase letters, digits and hyphens.' : `⚠️ /${old} will stop working. Anyone with the old link, including students in your classes, needs the new one.`);
    };

    async function save() {
      const code = normalizeCode(input.value);
      if (code === old || codeProblem(code)) return;
      saveButton.disabled = true;
      const refused = await store.changeCode(code);
      if (refused) return update(refused);
      toast(`Code changed. Players now open /${code}.`);
      show();
    }

    clear(
      box,
      h('div', { class: 'link-box code-edit' },
        h('label', { class: 'code-input' }, h('span', { class: 'muted' }, '/'), input),
        preview,
        saveButton,
        h('button', { type: 'button', onclick: show }, 'Cancel')),
      message,
    );
    update();
    input.focus();
    input.select();
  };

  show();
  return box;
}

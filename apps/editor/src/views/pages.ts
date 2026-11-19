import { validateScenario } from '@qbl/shared';
import { playUrl, previewUrl } from '../config';
import { mediaUrl, params, sceneLabel } from '../describe';
import { clear, confirmDelete, h, toast, help } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { SCENARIO_FIELDS, SCENARIO_SETTINGS_FIELDS } from '../schema';
import { icon } from '../icons';
import { sceneGroupControl, sceneGroupsCard } from './glossary';
import { sceneMap } from './sceneMap/sceneMap';

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

  const cards = scenes.map((scene, index) => {
    const first = (scene.background_media as Array<Record<string, unknown>> | null)?.[0];
    const url = first ? mediaUrl(store, store.byId('media', (first.media_id ?? first.id) as number | null)) : null;
    const events = store.where('events', 'scene_id', scene.id);
    const hotspots = events.filter((e) => e.kind === 'hotspot').length;
    const spawns = (params(scene, 'layout').spawn_points as unknown[] | undefined)?.length ?? 0;
    return h(
      'div',
      { class: 'card scene-card', 'data-scene': scene.id },
      h('button', { type: 'button', class: 'thumb-button', onclick: () => open(scene.id), 'aria-label': `Edit ${sceneLabel(scene)}` }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : h('span', { class: 'muted' }, 'No background yet')),
      h('div', { class: 'card-title' }, h('strong', null, sceneLabel(scene)), scene.id === start ? h('span', { class: 'badge' }, 'Start scene') : null),
      sceneGroupControl(ctx, scene),
      h('p', { class: 'muted' }, String(scene.subtitle ?? ''), h('br'), `${scene.width ?? '?'} × ${scene.height ?? '?'} px · ${hotspots} hotspot${hotspots === 1 ? '' : 's'} · ${events.length - hotspots} other event${events.length - hotspots === 1 ? '' : 's'} · ${spawns} spawn point${spawns === 1 ? '' : 's'}`),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => open(scene.id) }, 'Edit'),
        h('a', { class: 'button', href: previewUrl(store.scenarioId, scene.id), target: 'qbl-preview' }, '▶ Test'),
        h('button', { type: 'button', disabled: index === 0, title: 'Move earlier', onclick: () => move(index, -1) }, '←'),
        h('button', { type: 'button', disabled: index === scenes.length - 1, title: 'Move later', onclick: () => move(index, 1) }, '→'),
        scene.id === start ? null : h('button', { type: 'button', onclick: () => void store.patchScenario({ start_scene_id: scene.id }, true) }, 'Start here'),
        h('button', {
          type: 'button', class: 'danger', disabled: scenes.length <= 1,
          onclick: () => confirmDelete(`the scene “${sceneLabel(scene)}” and everything in it`) && void store.remove('scenes', scene.id),
        }, 'Delete'),
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
      h('div', null, h('h1', null, 'Scenes', help(mapped
        ? 'The places that make up the mission, and the ways between them. Each box is a scene and each arrow a jump: a hotspot or event that takes players to another scene. Drag boxes to lay the mission out, drag a box’s + onto another box to link them, and click ✏️ to edit a scene.'
        : 'The places that make up the mission. Players move between them through jump actions, usually on a hotspot along an edge.'))),
      h('div', { class: 'row-actions' }, switcher, mapped ? null : h('button', { type: 'button', class: 'primary', onclick: add }, 'New scene')),
    ),
    ...(mapped
      ? [sceneMap(ctx, open)]
      : [sceneGroupsCard(ctx), h('div', { class: 'grid' }, ...cards)]),
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
  return h(
    'div',
    { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings', help('What the scenario is called and how it is played.')))),
    h('div', { class: 'card' }, form(SCENARIO_FIELDS, store.scenario, (key, value) => void store.patchScenario({ [key]: value }, key.endsWith('_id')), ctx)),
    h('div', { class: 'card' }, form(SCENARIO_SETTINGS_FIELDS, store.settings, (key, value, field) => void store.patchScenario({ settings: withValue(store.settings, key, value, field) }), ctx)),
    h(
      'div',
      { class: 'card', 'data-card': 'backup' },
      h('h2', null, 'Back up or copy', help('Export downloads the whole scenario as one ZIP file: its JSON and the files uploaded for it. Importing that file (on the Scenarios page) makes a new scenario from it. Duplicate makes a copy here, to change without touching this one.')),
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
      { class: 'card danger-zone' },
      h('h2', null, 'Delete this scenario'),
      h('p', { class: 'muted' }, 'Removes the scenario, its scenes and every player’s saved progress in it. Uploaded files are removed with it.'),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (window.prompt(`Type the scenario’s title to delete it: ${store.scenario.title}`) !== store.scenario.title) return;
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
  const code = String(scenario.code ?? '');
  const link = playUrl(code);
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const publish = h('button', { type: 'button', class: 'primary', onclick: () => void run(true) }, 'Check and publish');

  async function run(thenPublish: boolean) {
    clear(results, h('p', { class: 'muted' }, 'Checking…'));
    await store.settled();
    let report;
    try {
      report = validateScenario(await store.api.preview(store.scenarioId));
    } catch (err) {
      return clear(results, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the scenario.'));
    }
    const issue = (level: string) => (i: { path: string; message: string }) => h('li', { class: `issue ${level}` }, h('code', null, i.path || 'scenario'), ' ', i.message);
    clear(
      results,
      report.ok
        ? h('p', { class: 'issue ok' }, report.warnings.length ? 'No errors. The warnings below are worth a look.' : 'No problems found.')
        : h('p', { class: 'issue error' }, `${report.errors.length} error${report.errors.length === 1 ? '' : 's'} to fix before this can be published.`),
      h('ul', null, ...report.errors.map(issue('error')), ...report.warnings.map(issue('warning'))),
    );
    if (thenPublish && report.ok && (await store.publish())) toast('Published. Players now get this version.');
  }

  const status = !scenario.published_at
    ? 'Not published yet. Players cannot open it.'
    : store.unpublished
      ? `Published ${scenario.published_at} UTC. There are changes since then that players do not have.`
      : `Published ${scenario.published_at} UTC. Players have the latest version.`;

  return h(
    'div',
    { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Publish'), h('p', { class: 'muted' }, 'Publishing generates the scenario’s JSON from what you have built and makes it what players get. Until you publish again, players keep the last published version.'))),
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'Player link'),
      h('p', { class: 'code-line' }, h('code', { class: 'code' }, code), h('button', { type: 'button', onclick: () => void navigator.clipboard?.writeText(link).then(() => toast('Link copied.')) }, 'Copy link')),
      h('p', null, h('a', { href: link, target: '_blank', rel: 'noopener' }, link)),
      h('p', { class: 'muted' }, 'The 16-letter code is this scenario’s permanent address. It never changes, so a link you have shared keeps working.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'Status'),
      h('p', { 'data-status': scenario.published_at ? (store.unpublished ? 'changed' : 'published') : 'draft' }, status),
      h('div', { class: 'row-actions' }, publish, h('button', { type: 'button', onclick: () => void run(false) }, 'Check only'), h('a', { class: 'button', href: previewUrl(store.scenarioId), target: 'qbl-preview' }, '▶ Test the draft')),
      results,
    ),
  );
}

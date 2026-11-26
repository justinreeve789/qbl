import { previewUrl } from '../config';
import { sceneLabel } from '../describe';
import { h, redraw, toast } from '../dom';
import type { FormContext } from '../fields';
import type { Store } from '../store';
import { charactersPage, itemsPage, mediaPage, movesPage, objectivesPage, shopPage, variablesPage } from './library';
import { checkAndPublish, publishPage, scenesPage, settingsPage } from './pages';
import { glossaryPage } from './glossary';
import { icon } from '../icons';
import { sceneEditor } from './scene/sceneEditor';
import { flushReveal } from './issues';
import { recordVoicesButton } from './voices';

/** The pages of a scenario: its address, its name, and its icon (see icons.ts). */
export const TABS = [
  ['scenes', 'Scenes', 'scenes'],
  ['media', 'Media', 'media'],
  ['variables', 'Variables', 'variables'],
  ['items', 'Items', 'items'],
  ['characters', 'Characters', 'characters'],
  ['objectives', 'Objectives', 'objectives'],
  ['glossary', 'Glossary', 'glossary'],
  ['moves', 'Moves', 'moves'],
  ['shop', 'Shop', 'shop'],
  ['settings', 'Settings', 'settings'],
  ['publish', 'Publish', 'publish'],
] as const;

export type Tab = (typeof TABS)[number][0];

export interface Place {
  tab: Tab;
  /** Set when a scene is open in the scene editor. */
  sceneId?: number;
}

/**
 * One scenario, open for editing: the tab bar and whichever page or scene is showing.
 * Returns the element and a function that stops it listening to the store.
 */
export function workspace(store: Store, place: Place, go: (hash: string) => void): { element: HTMLElement; dispose(): void } {
  const ctx: FormContext = { store };
  const base = `#/s/${store.scenarioId}`;
  const scene0 = () => (place.sceneId != null ? store.byId('scenes', place.sceneId) : undefined);
  const title = h('strong', { class: 'scenario-title' });
  const state = h('a', { class: 'publish-state', href: `${base}/publish` });
  const body = h('main', { class: 'workspace-body' });
  // Publishing is one click from anywhere in the scenario. If something has to be fixed first,
  // it goes to the Publish page, which lists what.
  const publish = h('button', {
    type: 'button', class: 'primary publish-now', title: 'Check the scenario and make this version the one players get',
    onclick: async () => {
      publish.disabled = true;
      publish.textContent = 'Publishing…';
      const result = await checkAndPublish(store);
      publish.disabled = false;
      publish.textContent = '🚀 Publish';
      if (result.published) return toast(result.warnings ? `Published. ${result.warnings} warning${result.warnings === 1 ? '' : 's'} worth a look on the Publish page.` : 'Published. Players now get this version.');
      toast(result.message ?? `Not published: ${result.errors} error${result.errors === 1 ? '' : 's'} to fix first.`, 'error');
      go(`${base}/publish`);
    },
  }, '🚀 Publish');
  // Test and Record voices sit beside Publish. The scene editor has its own test button, which starts in that scene.
  const test = scene0() ? null : h('a', { class: 'button test', href: previewUrl(store.scenarioId), target: 'qbl-preview' }, '▶ Test');
  const record = recordVoicesButton(ctx);
  let disposeScene: (() => void) | null = null;

  const drawHead = () => {
    title.textContent = String(store.scenario.title ?? '');
    const published = Boolean(store.scenario.published_at);
    state.textContent = !published ? 'Draft' : store.unpublished ? 'Unpublished changes' : 'Published';
    state.dataset.state = !published ? 'draft' : store.unpublished ? 'changed' : 'published';
    record.refresh();
  };

  const scene = scene0();

  const page = (): HTMLElement => {
    switch (place.tab) {
      case 'media':
        return mediaPage(ctx);
      case 'variables':
        return variablesPage(ctx);
      case 'items':
        return itemsPage(ctx);
      case 'characters':
        return charactersPage(ctx);
      case 'objectives':
        return objectivesPage(ctx);
      case 'glossary':
        return glossaryPage(ctx);
      case 'moves':
        return movesPage(ctx);
      case 'shop':
        return shopPage(ctx);
      case 'settings':
        return settingsPage(ctx, () => go('#/'));
      case 'publish':
        return publishPage(ctx);
      default:
        return scenesPage(ctx, (id) => go(`${base}/scene/${id}`));
    }
  };

  let stop: () => void;
  if (scene) {
    const editor = sceneEditor(store, scene.id, () => go(base), (id) => go(`${base}/scene/${id}`));
    body.classList.add('fill');
    body.append(editor.element);
    disposeScene = editor.dispose;
    stop = store.onChange(drawHead);
    flushReveal();
  } else {
    redraw(body, page());
    flushReveal();
    // Pages made of forms are rebuilt only when rows come or go; the scenes page shows no forms.
    stop = store.onChange((structural) => {
      drawHead();
      if (structural || place.tab === 'scenes') redraw(body, page());
    });
  }
  drawHead();

  const element = h(
    'div',
    { class: 'workspace' },
    h(
      'div',
      { class: 'workspace-head' },
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Scenarios'), ' › ', scene ? h('a', { href: base }, title) : title, scene ? ` › ${sceneLabel(scene)}` : null, state, h('span', { class: 'spacer' }), record.button, test, publish),
      h('nav', { class: 'tabs', 'aria-label': 'Scenario' },
        ...TABS.map(([key, label, name]) => h('a', { href: key === 'scenes' ? base : `${base}/${key}`, 'data-tab': key, class: !scene && place.tab === key ? 'current' : scene && key === 'scenes' ? 'parent' : null }, icon(name), label)),
      ),
    ),
    body,
  );

  return {
    element,
    dispose() {
      stop();
      disposeScene?.();
    },
  };
}

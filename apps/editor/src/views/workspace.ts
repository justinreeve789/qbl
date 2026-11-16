import { previewUrl } from '../config';
import { sceneLabel } from '../describe';
import { h, redraw } from '../dom';
import type { FormContext } from '../fields';
import type { Store } from '../store';
import { charactersPage, itemsPage, mediaPage, objectivesPage, variablesPage } from './library';
import { publishPage, scenesPage, settingsPage } from './pages';
import { sceneEditor } from './scene/sceneEditor';

export const TABS = [
  ['scenes', 'Scenes'],
  ['media', 'Media'],
  ['variables', 'Variables'],
  ['items', 'Items'],
  ['characters', 'Characters'],
  ['objectives', 'Objectives'],
  ['settings', 'Settings'],
  ['publish', 'Publish'],
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
  const title = h('strong', { class: 'scenario-title' });
  const state = h('a', { class: 'publish-state', href: `${base}/publish` });
  const body = h('main', { class: 'workspace-body' });
  let disposeScene: (() => void) | null = null;

  const drawHead = () => {
    title.textContent = String(store.scenario.title ?? '');
    const published = Boolean(store.scenario.published_at);
    state.textContent = !published ? 'Draft' : store.unpublished ? 'Unpublished changes' : 'Published';
    state.dataset.state = !published ? 'draft' : store.unpublished ? 'changed' : 'published';
  };

  const scene = place.sceneId != null ? store.byId('scenes', place.sceneId) : undefined;

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
    const editor = sceneEditor(store, scene.id, () => go(base));
    body.classList.add('fill');
    body.append(editor.element);
    disposeScene = editor.dispose;
    stop = store.onChange(drawHead);
  } else {
    redraw(body, page());
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
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Scenarios'), ' › ', scene ? h('a', { href: base }, title) : title, scene ? ` › ${sceneLabel(scene)}` : null, state),
      h('nav', { class: 'tabs', 'aria-label': 'Scenario' },
        ...TABS.map(([key, label]) => h('a', { href: key === 'scenes' ? base : `${base}/${key}`, class: !scene && place.tab === key ? 'current' : scene && key === 'scenes' ? 'parent' : null }, label)),
        // The scene editor has its own test button, which starts in that scene.
        scene ? null : h('a', { class: 'button test', href: previewUrl(store.scenarioId), target: 'qbl-preview' }, '▶ Test'),
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

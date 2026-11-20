import { sceneLabel } from '../../describe';
import { h } from '../../dom';
import { select, type SpotRequest } from '../../fields';
import { openPanel } from '../../panel';
import type { Store } from '../../store';
import { SceneCanvas } from './canvas';
import { SceneModel } from './model';

/**
 * Choose a spot by clicking a picture of a scene, in a pop-up: for forms that are not beside the
 * scene editor's canvas, such as the steps of a character's routine. It opens on the scene the
 * request names (else the first), and another scene can be chosen, since a routine's character
 * may be anywhere. Returns a function that closes it without a spot.
 */
export function pickSpotInPopup(store: Store, request: SpotRequest): () => void {
  const scenes = store.rows('scenes').slice().sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);
  let sceneId = request.sceneId != null && store.byId('scenes', request.sceneId) ? request.sceneId : scenes[0]?.id;
  let chosen = false;
  let switching = false;
  const coords = h('span', { class: 'coords muted' });
  const host = h('div', { class: 'spot-popup-canvas' });
  let canvas: SceneCanvas | null = null;

  const show = (id: number) => {
    sceneId = id;
    switching = true;
    canvas?.cancelPick();
    switching = false;
    canvas = new SceneCanvas(new SceneModel(store, id), {
      selection: () => ({ kind: 'scene' }),
      select: () => {},
      dragged: () => {},
      pointer: (at) => (coords.textContent = at ? `x ${at.x}, y ${at.y}` : ''),
    });
    host.replaceChildren(canvas.element);
    // The spot it has now is only drawn on the scene it was likely chosen in.
    canvas.pick({
      prompt: request.prompt,
      at: id === request.sceneId ? request.at : null,
      done: (at) => {
        chosen = true;
        request.done(at);
        panel.close();
      },
      cancelled: () => !switching && panel.close(),
    });
  };

  const sceneMenu = select(scenes.map((s) => [String(s.id), sceneLabel(s)] as const), String(sceneId ?? ''), (v) => v && show(Number(v)));
  sceneMenu.setAttribute('aria-label', 'Scene');
  const body = h(
    'div',
    { class: 'spot-popup' },
    h('div', { class: 'toolbar' }, h('label', { class: 'inline' }, 'Scene', sceneMenu), coords),
    host,
  );

  const panel = openPanel({
    key: 'pick-spot',
    kind: 'pick-spot',
    store,
    size: 'wide',
    title: () => `📍 ${request.prompt}`,
    // Drawn once: the canvas follows the store by itself, and a new body would lose the choice in progress.
    body: () => body,
    opened: () => {
      if (sceneId != null && !canvas) show(sceneId);
    },
  });
  panel.dialog.addEventListener('close', () => {
    if (chosen) return;
    chosen = true;
    request.cancelled?.();
  });
  if (sceneId == null) {
    body.append(h('p', { class: 'muted' }, 'Add a scene first.'));
  }
  return () => panel.close();
}

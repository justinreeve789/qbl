import { BUILD_LIMITS, BUILD_TOOLS, type BuildTool } from '@qbl/shared';
import { mediaLabel, params } from '../../describe';
import { h, help } from '../../dom';
import { form, type Field, type FormContext } from '../../fields';
import { chooseMedia, mediaPreview } from '../../mediaPicker';
import type { SceneModel } from './model';

type Bag = Record<string, unknown>;

/** The settings, as the form shows them: the tools as four ticks. */
const BUILDING_FIELDS: Field[] = [
  { key: 'enabled', label: 'Students can build here', kind: 'bool', wide: true, structural: true },
  { key: 'tool_place', label: 'Place pieces you choose', kind: 'bool', default: true, wide: true, when: (v) => v.enabled === true, structural: true },
  { key: 'tool_label', label: 'Add words (signs and labels)', kind: 'bool', default: true, wide: true, when: (v) => v.enabled === true },
  { key: 'tool_picture', label: 'Hang their own pictures', kind: 'bool', default: false, wide: true, when: (v) => v.enabled === true, hint: 'Pictures students upload: posters made in another app, or a photo of their work.' },
  { key: 'tool_hotspot', label: 'Add hotspots that open words or a picture', kind: 'bool', default: false, wide: true, when: (v) => v.enabled === true, structural: true, hint: 'Students choose what people click (words, a piece, their own picture, or an invisible spot) and what it opens.' },
  { key: 'prompt', label: 'What to make', kind: 'textarea', when: (v) => v.enabled === true, wide: true, placeholder: 'Build a habitat that keeps a desert fox cool.', hint: 'Shown to students when they start building.' },
  { key: 'max_pieces', label: 'Most things one student adds', kind: 'number', min: 1, max: BUILD_LIMITS.maxPieces, step: 1, placeholder: String(BUILD_LIMITS.defaultPieces), when: (v) => v.enabled === true },
  { key: 'share', label: 'Who sees a build', kind: 'select', options: [['instance', 'Everyone in the same game'], ['own', 'Only its maker and their teacher']], default: 'instance', when: (v) => v.enabled === true },
  { key: 'approve', label: 'The teacher approves a build before others see it', kind: 'bool', default: true, wide: true, when: (v) => v.enabled === true },
];

/**
 * Student building: the scene's `building` setting, kept in its params (see packages/shared builds.ts).
 * What students build is a layer of their own over the scene, never part of it, and teachers
 * approve it from the Classes page.
 */
export function buildingPanel(model: SceneModel, ctx: FormContext): HTMLElement {
  const { store } = model;
  const current = (): Bag => params(store.byId('scenes', model.sceneId)!);
  const building = (): Bag => ((current().building as Bag | undefined) ?? {});
  const save = (next: Bag | null, structural = true) => {
    const all = { ...current() };
    if (next) all.building = next;
    else delete all.building;
    void store.patch('scenes', model.sceneId, { params: all }, structural);
  };
  const b = building();
  const tools = (b.tools as BuildTool[] | undefined) ?? ['place', 'label'];
  const values: Bag = {
    enabled: b.enabled === true,
    tool_place: tools.includes('place'),
    tool_label: tools.includes('label'),
    tool_picture: tools.includes('picture'),
    tool_hotspot: tools.includes('hotspot'),
    prompt: b.prompt ?? '',
    max_pieces: b.max_pieces ?? null,
    share: b.share ?? 'instance',
    approve: b.approve !== false,
  };
  const commit = (key: string, value: unknown, field: Field) => {
    const next: Bag = { ...building() };
    if (key.startsWith('tool_')) {
      const tool = key.slice(5) as BuildTool;
      const now = new Set((next.tools as BuildTool[] | undefined) ?? ['place', 'label']);
      if (value === true) now.add(tool);
      else now.delete(tool);
      next.tools = BUILD_TOOLS.filter((t) => now.has(t));
    } else if (key === 'enabled') {
      next.enabled = value === true;
      if (next.enabled && next.tools == null) next.tools = ['place', 'label'];
    } else if (value === '' || value == null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    save(next, field.structural ?? false);
  };

  const pieces = ((b.pieces as Array<{ media_id: number }> | undefined) ?? []).filter((p) => p && p.media_id != null);
  const setPieces = (list: Array<{ media_id: number }>) => save({ ...building(), pieces: list });
  const pieceList = values.enabled && (values.tool_place || values.tool_hotspot)
    ? h(
        'div',
        { class: 'building-pieces', 'data-building-pieces': '' },
        h('div', { class: 'sub-head' }, h('span', null, 'Pieces to place'), help('The pictures students can add from the Build palette: plants, furniture, animals, signs. Any picture in the scenario can be a piece. A hotspot can look like a piece, or open one.')),
        pieces.length || !values.tool_place ? null : h('p', { class: 'muted' }, 'Choose at least one piece, or students will only be able to add words and pictures.'),
        h(
          'ul',
          { class: 'building-piece-list' },
          ...pieces.map((p, i) => {
            const row = store.byId('media', p.media_id);
            return h(
              'li',
              { class: 'building-piece' },
              mediaPreview(store, row, 'building-piece-thumb'),
              h('span', { class: 'building-piece-name' }, row ? mediaLabel(row) : `Missing picture ${p.media_id}`),
              h('button', { type: 'button', class: 'icon', title: 'Remove this piece', 'aria-label': `Remove ${row ? mediaLabel(row) : 'piece'}`, onclick: () => setPieces(pieces.filter((_, j) => j !== i)) }, '×'),
            );
          }),
        ),
        h('button', {
          type: 'button',
          onclick: async () => {
            const id = await chooseMedia(store, { types: ['image'], category: 'item', title: 'A piece students can place' });
            if (id != null && !pieces.some((p) => p.media_id === id)) setPieces([...pieces, { media_id: id }]);
          },
        }, '+ Add a piece'),
      )
    : null;

  return h(
    'section',
    { 'data-panel-section': 'building' },
    h('div', { class: 'sub-head' }, h('span', null, '🛠️ Student building', help('Let students add things of their own to this scene from a Build button in the game: pieces you choose, words, pictures they upload, and hotspots that open words or a picture when clicked. What they build sits on top of the scene as an extra layer: it never changes the scene, and its events cannot see it. Their teacher approves a build on the Classes page before others see it, unless you turn that off, and can change any of their students\' builds in the game. Starting a student\'s game again removes what they built.'))),
    form(BUILDING_FIELDS, values, commit, ctx),
    values.enabled ? h('p', { class: 'muted', 'data-building-publish': '' }, 'Students get these settings when you publish the scenario. Test this scene to try building yourself first.') : null,
    pieceList,
  );
}

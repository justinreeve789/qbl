import type { Row } from '../api';
import { EVENT_KINDS, params } from '../describe';
import { confirmDelete, h } from '../dom';
import { form, select, withValue, type Field, type FormContext } from '../fields';
import { EVENT_FIELDS, HOTSPOT_FIELDS, LABEL_FIELDS, LABEL_MEDIA, LABEL_SPRITEMAP, LABEL_TEXT } from '../schema';
import { actionList } from './actions';
import { rowConditions } from './conditions';

const LABEL_COLUMNS = new Set(['type', 'position_x', 'position_y', 'scale_x', 'scale_y', 'text', 'media_id']);

/**
 * Everything about one event: when it fires (its kind, and for hotspots where and how),
 * the conditions it needs, its labels, and the actions it runs.
 */
export function eventPanel(ctx: FormContext, event: Row, refresh: Array<() => void>, onDeleted: () => void): HTMLElement {
  const { store } = ctx;
  const id = event.id;
  const kind = event.kind as keyof typeof EVENT_KINDS;

  const commit = (key: string, value: unknown, field: Field) => {
    if (key === 'activate_by_trigger') value = value === 'true';
    void store.patch('events', id, { [key]: value }, field.structural === true);
  };
  const values = { ...event, activate_by_trigger: String(event.activate_by_trigger === true) };

  const kindSelect = select(Object.entries(EVENT_KINDS), kind, (next) => {
    const attrs: Record<string, unknown> = { kind: next };
    if (next === 'hotspot' && event.radius == null) Object.assign(attrs, { position_x: 200, position_y: 200, radius: 80, activate_by_trigger: true });
    void store.patch('events', id, attrs, true);
  });

  return h(
    'div',
    { class: 'panel event-panel' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', null, EVENT_KINDS[kind]),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete('this event and its actions')) return;
          onDeleted();
          await store.remove('events', id);
        },
      }, 'Delete'),
    ),
    h('p', { class: 'muted' }, KIND_HELP[kind]),
    h('div', { class: 'form' }, h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Kind'), kindSelect)),
    form(EVENT_FIELDS, values, commit, ctx),
    kind === 'hotspot' ? form(HOTSPOT_FIELDS, values, commit, ctx) : null,
    rowConditions(ctx, 'event_id', id, 'Runs only when', kind === 'hotspot' ? 'Always active.' : 'Always runs.'),
    kind === 'hotspot' ? labelList(ctx, event) : null,
    actionList(ctx, id, refresh),
  );
}

const KIND_HELP: Record<keyof typeof EVENT_KINDS, string> = {
  start: 'Runs when a player enters the scene. Background music and opening text go here.',
  end: 'Runs when a player leaves the scene.',
  hotspot: 'A place in the scene that runs its actions when a player clicks it or walks into it. A walk-in hotspot along an edge with a jump action is how players move between scenes.',
  indirect: 'Runs only when another event’s “Run event” action, or a click on a character, starts it.',
};

/** Labels mark a hotspot in the scene: a piece of text, an image, or an animated spritemap. */
function labelList(ctx: FormContext, event: Row): HTMLElement {
  const { store } = ctx;
  const labels = store.where('labels', 'event_id', event.id);

  const cards = labels.map((label) => {
    const id = label.id;
    const type = label.type as string;
    const commit = (key: string, value: unknown, field: Field) => {
      if (LABEL_COLUMNS.has(key)) void store.patch('labels', id, { [key]: value }, key === 'media_id' || field.structural === true);
      else void store.patch('labels', id, { params: withValue(params(store.byId('labels', id)!), key, value, field) });
    };
    const values = { ...params(label), ...label };
    return h(
      'div',
      { class: 'card flat' },
      form(LABEL_FIELDS, values, commit, ctx),
      type === 'text' ? form([LABEL_TEXT], values, commit, ctx) : form([LABEL_MEDIA], values, commit, ctx),
      type === 'spritemap' ? form(LABEL_SPRITEMAP, values, commit, ctx) : null,
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete('this label') && void store.remove('labels', id) }, 'Delete label')),
    );
  });

  const add = () =>
    void store.add('labels', {
      event_id: event.id, type: 'text', text: (event.shortname as string | null) || 'Label',
      position_x: event.position_x ?? 200, position_y: (Number(event.position_y ?? 200)) - Number(event.radius ?? 0) - 20, scale_x: 1, scale_y: 1,
    });

  return h(
    'section',
    { class: 'labels' },
    h('div', { class: 'sub-head' }, h('span', null, `Labels (${labels.length})`), h('button', { type: 'button', class: 'link', onclick: add }, '+ Add label')),
    cards.length ? h('div', null, ...cards) : h('p', { class: 'muted' }, 'No labels: players see nothing here until they find it.'),
  );
}

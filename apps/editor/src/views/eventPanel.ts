import type { Row } from '../api';
import { EVENT_KINDS, params } from '../describe';
import { confirmDelete, fold, h, help } from '../dom';
import { form, select, withValue, type Field, type FormContext } from '../fields';
import { EVENT_FIELDS, HOTSPOT_FIELDS, LABEL_FIELDS, LABEL_HINT, LABEL_MEDIA, LABEL_PULSE, LABEL_SOLID, LABEL_SPRITEMAP, LABEL_TEXT } from '../schema';
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
  // An event made before audiences existed is the player's own, as it always was.
  const values = { ...event, audience: event.audience ?? 'player', activate_by_trigger: String(event.activate_by_trigger === true) };

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
      h('h2', null, EVENT_KINDS[kind], help(KIND_HELP[kind])),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete('this event and its actions')) return;
          onDeleted();
          await store.remove('events', id);
        },
      }, 'Delete'),
    ),
    // Each part folds away, so a long event is easy to get around in. What is folded stays folded from event to event.
    fold('event-settings', '⚙️ Settings', true, h('div', { class: 'form' }, h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Kind'), kindSelect)), form(EVENT_FIELDS, values, commit, ctx)),
    kind === 'hotspot' ? fold('event-hotspot', '🎯 Where it is and how it fires', true, form(HOTSPOT_FIELDS, values, commit, ctx)) : null,
    fold('event-conditions', `🔀 Conditions (${store.where('conditions', 'event_id', id).length})`, true, rowConditions(ctx, 'event_id', id, 'Runs only when', kind === 'hotspot' ? 'Always active.' : 'Always runs.')),
    kind === 'hotspot' ? fold('event-labels', `🏷️ Labels (${store.where('labels', 'event_id', id).length})`, true, labelList(ctx, event)) : null,
    fold('event-actions', `🎬 Actions (${store.where('actions', 'event_id', id).length})`, true, actionList(ctx, id, refresh)),
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
      else void store.patch('labels', id, { params: withValue(params(store.byId('labels', id)!), key, value, field) }, field.structural === true);
    };
    const values = { ...params(label), ...label };
    return h(
      'div',
      { class: 'card flat' },
      form(LABEL_FIELDS, values, commit, ctx),
      type === 'text' ? form([LABEL_TEXT], values, commit, ctx) : form([LABEL_MEDIA], values, commit, ctx),
      type === 'spritemap' ? form(LABEL_SPRITEMAP, values, commit, ctx) : null,
      // A picture can be something players walk around.
      type === 'text' ? null : form(values.solid === true ? LABEL_SOLID : LABEL_SOLID.slice(0, 1), values, commit, ctx),
      form(type === 'text' ? [LABEL_HINT] : [LABEL_HINT, LABEL_PULSE], values, commit, ctx),
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
    h('div', { class: 'sub-head' }, h('span', null, 'Shown in the scene'), h('button', { type: 'button', class: 'link', onclick: add }, '+ Add label')),
    cards.length ? h('div', null, ...cards) : h('p', { class: 'muted' }, 'No labels: players see nothing here until they find it.'),
  );
}

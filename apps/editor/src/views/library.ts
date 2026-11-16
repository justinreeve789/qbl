import type { Row, Table } from '../api';
import { mediaLabel, mediaUrl, params } from '../describe';
import { confirmDelete, h, toast } from '../dom';
import { form, withValue, type Field, type FormContext } from '../fields';
import {
  CHARACTER_FIELDS, CHARACTER_SETTINGS_FIELDS, ITEM_FIELDS, ITEM_SETTINGS_FIELDS, MEDIA_FIELDS, OBJECTIVE_FIELDS, VARIABLE_FIELDS,
} from '../schema';
import { inlineConditions, rowConditions, type ConditionValue } from './conditions';

/** The scenario-wide lists: media, variables, items, characters and objectives. */

const page = (title: string, about: string, actions: Array<HTMLElement | null>, body: HTMLElement) =>
  h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), h('p', { class: 'muted' }, about)), h('div', { class: 'row-actions' }, ...actions)), body);

const none = (text: string) => h('p', { class: 'empty' }, text);

const removeButton = (ctx: FormContext, table: Table, row: Row, what: string) =>
  h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(what) && void ctx.store.remove(table, row.id) }, 'Delete');

// --------------------------------------------------------------------- media

export function mediaPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const avatars = () => (store.settings.avatar_media_ids as number[] | undefined) ?? [];

  const file = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/webp,image/gif,audio/*,video/mp4,video/webm' });
  file.addEventListener('change', async () => {
    for (const picked of [...(file.files ?? [])]) {
      try {
        store.bundle.media.push(await store.api.upload(store.scenarioId, picked));
      } catch (err) {
        toast(`${picked.name}: ${err instanceof Error ? err.message : 'upload failed'}`, 'error');
      }
    }
    file.value = '';
    store.emit();
  });

  const addByAddress = () => {
    const url = window.prompt('Address of the image, sound or video:')?.trim();
    if (!url) return;
    const ext = url.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? '';
    const type = ['mp3', 'wav', 'ogg', 'm4a'].includes(ext) ? 'audio' : ['mp4', 'webm'].includes(ext) ? 'video' : 'image';
    void store.add('media', { type, url, filename: url.split(/[?#]/)[0]!.split('/').pop() });
  };

  const cards = store.rows('media').map((media) => {
    const id = media.id;
    const url = mediaUrl(store, media);
    const preview =
      !url ? h('div', { class: 'preview none' }, 'No address')
      : media.type === 'image' ? h('img', { class: 'preview', src: url, alt: '', loading: 'lazy' })
      : media.type === 'audio' ? h('audio', { class: 'preview', src: url, controls: true, preload: 'none' })
      : h('video', { class: 'preview', src: url, controls: true, preload: 'none' });
    const avatar = h('input', {
      type: 'checkbox', checked: avatars().includes(id),
      onchange: () => void store.patchSettings({ avatar_media_ids: avatar.checked ? [...avatars(), id] : avatars().filter((a) => a !== id) }),
    });
    return h(
      'div',
      { class: 'card', 'data-media': id },
      h('div', { class: 'card-title' }, h('strong', null, mediaLabel(media)), h('span', { class: 'muted' }, `#${id} · ${media.type}`)),
      preview,
      form(MEDIA_FIELDS, media, (key, value, field) => void store.patch('media', id, { [key]: value }, key === 'url' || field.structural === true), ctx),
      media.type === 'image' ? h('label', { class: 'field check wide' }, avatar, h('span', null, 'Players can choose this as their avatar')) : null,
      h('div', { class: 'row-actions' }, removeButton(ctx, 'media', media, `“${mediaLabel(media)}”. Anything using it will be left without it`)),
    );
  });

  return page(
    'Media',
    'The images, sounds and videos the scenario uses. Upload files, or point at files already on the web.',
    [h('button', { type: 'button', class: 'primary', onclick: () => file.click() }, 'Upload files'), h('button', { type: 'button', onclick: addByAddress }, 'Add by address'), file],
    cards.length ? h('div', { class: 'grid' }, ...cards) : none('No media yet. Upload a background image to get started.'),
  );
}

// ----------------------------------------------------------------- variables

export function variablesPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const add = () => {
    const name = window.prompt('Name of the new variable (letters, digits and underscores):')?.trim();
    if (name) void store.add('variables', { variable_name: name, default_value: 0 });
  };
  const rows = store.rows('variables').map((variable) =>
    h(
      'div',
      { class: 'card row-card' },
      form(VARIABLE_FIELDS, variable, (key, value) => void store.patch('variables', variable.id, { [key]: value ?? (key === 'default_value' ? 0 : value) }), ctx),
      h('div', { class: 'row-actions' }, removeButton(ctx, 'variables', variable, `the variable “${variable.variable_name}”`)),
    ),
  );
  return page(
    'Variables',
    'What the scenario remembers: scores, what has been collected, which step of a quest a player is on. Conditions test them and “Variable” actions change them.',
    [h('button', { type: 'button', class: 'primary', onclick: add }, 'New variable')],
    rows.length ? h('div', { class: 'stack' }, ...rows) : none('No variables yet.'),
  );
}

// ------------------------------------------------------- items and characters

function thingsPage(ctx: FormContext, table: 'items' | 'characters', title: string, about: string, fields: Field[], settings: Field[], owner: 'item_id' | 'character_id'): HTMLElement {
  const { store } = ctx;
  const noun = table === 'items' ? 'item' : 'character';
  const cards = store.rows(table).map((thing) => {
    const id = thing.id;
    const url = mediaUrl(store, store.byId('media', thing.media_id as number | null));
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, h('strong', null, String(thing.name)), h('span', { class: 'muted' }, `#${id}`)),
      url ? h('img', { class: 'preview small', src: url, alt: '' }) : null,
      form(fields, thing, (key, value) => void store.patch(table, id, { [key]: value }, key === 'media_id'), ctx),
      form(settings, params(thing, 'settings'), (key, value, field) => void store.patch(table, id, { settings: withValue(params(store.byId(table, id)!, 'settings'), key, value, field) }), ctx),
      rowConditions(ctx, owner, id, 'Present only when', 'Always present.'),
      h('div', { class: 'row-actions' }, removeButton(ctx, table, thing, `the ${noun} “${thing.name}”`)),
    );
  });
  return page(
    title,
    about,
    [h('button', { type: 'button', class: 'primary', onclick: () => void store.add(table, { name: `New ${noun}` }) }, `New ${noun}`)],
    cards.length ? h('div', { class: 'grid' }, ...cards) : none(`No ${table} yet.`),
  );
}

export const itemsPage = (ctx: FormContext) =>
  thingsPage(ctx, 'items', 'Items', 'Things players can pick up, wear or ride. Define them here, then place them in scenes.', ITEM_FIELDS, ITEM_SETTINGS_FIELDS, 'item_id');

export const charactersPage = (ctx: FormContext) =>
  thingsPage(ctx, 'characters', 'Characters', 'People and creatures players meet. Define them here, then place them in scenes, where clicking one can run an event.', CHARACTER_FIELDS, CHARACTER_SETTINGS_FIELDS, 'character_id');

// ---------------------------------------------------------------- objectives

interface Objective {
  id: string | number;
  text?: string;
  optional?: boolean;
  show_when?: ConditionValue[];
  complete_when?: ConditionValue[];
}

/** The mission checklist players see. It is kept in the scenario's settings, in order. */
export function objectivesPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const read = () => (store.settings.objectives as Objective[] | undefined) ?? [];
  const write = (list: Objective[], structural: boolean) => void store.patchSettings({ objectives: list }, structural);
  const at = (index: number): Objective => read()[index] ?? { id: '' };
  const replace = (index: number, objective: Objective, structural = false) => write(read().map((o, i) => (i === index ? objective : o)), structural);

  const add = () => {
    const ids = new Set(read().map((o) => String(o.id)));
    let n = read().length + 1;
    while (ids.has(`objective-${n}`)) n++;
    write([...read(), { id: `objective-${n}`, text: 'New objective', complete_when: [] }], true);
  };
  const move = (index: number, by: number) => {
    const list = [...read()];
    const [moved] = list.splice(index, 1);
    list.splice(index + by, 0, moved!);
    write(list, true);
  };

  const cards = read().map((objective, index) =>
    h(
      'div',
      { class: 'card' },
      form(OBJECTIVE_FIELDS, objective as unknown as Record<string, unknown>, (key, value, field) => replace(index, withValue({ ...at(index) }, key, value, field) as unknown as Objective), ctx),
      inlineConditions(ctx, () => at(index).show_when, (list, structural) => replace(index, withValue({ ...at(index) }, 'show_when', list.length ? list : null) as unknown as Objective, structural), 'Listed only when', 'Always listed.'),
      inlineConditions(ctx, () => at(index).complete_when, (list, structural) => replace(index, { ...at(index), complete_when: list }, structural), 'Ticked off when', 'Add a condition, or it is never ticked off.'),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', disabled: index === 0, onclick: () => move(index, -1) }, '↑ Earlier'),
        h('button', { type: 'button', disabled: index === read().length - 1, onclick: () => move(index, 1) }, '↓ Later'),
        h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete('this objective') && write(read().filter((_, i) => i !== index), true) }, 'Delete'),
      ),
    ),
  );
  return page(
    'Objectives',
    'The checklist players see during the mission. Each line is ticked off by variables, so events move the mission along simply by changing them.',
    [h('button', { type: 'button', class: 'primary', onclick: add }, 'New objective')],
    cards.length ? h('div', { class: 'stack' }, ...cards) : none('No objectives: players see no checklist.'),
  );
}

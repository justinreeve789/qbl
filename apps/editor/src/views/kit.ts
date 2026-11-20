import type { Row, Table } from '../api';
import { confirmDelete, h, help } from '../dom';
import type { Field, FormContext } from '../fields';
import { emojiIcon } from '../icons';
import type { ConditionValue } from './conditions';
import { conditionText } from '../describe';

/**
 * The parts every list page of the editor is made of, so the pages look and work alike:
 * a heading with how many there are, cards with a picture, a name and chips that say what the
 * thing is, and a pop-up panel (panel.ts) for everything else about it.
 */

type Child = Node | string | null | false | undefined;

/** A page: its heading (with a count, when given), its help, its buttons, then its content. */
export function listPage(o: { title: string; about: string; count?: number; actions?: Array<HTMLElement | null>; className?: string }, ...body: Child[]): HTMLElement {
  return h('div', { class: `page${o.className ? ` ${o.className}` : ''}` },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, o.title, o.count != null ? h('span', { class: 'count' }, String(o.count)) : null, help(o.about))),
      h('div', { class: 'row-actions' }, ...(o.actions ?? []))),
    ...body);
}

/** What a page shows when it has nothing yet: a large icon, a line of text and, if given, a button to make the first one. */
export function emptyState(icon: string, text: string, button?: HTMLElement | null): HTMLElement {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, emojiIcon(icon)), h('p', null, text), button ?? null);
}

/** A small label. `tone` colours it; `kind` is 'warn', 'cond' or 'muted' for the fixed styles. */
export function chip(content: Child | Child[], o: { tone?: string; kind?: 'warn' | 'cond' | 'muted' | 'ok'; title?: string; icon?: string } = {}): HTMLElement {
  const parts = Array.isArray(content) ? content : [content];
  return h('span', {
    class: `chip${o.tone ? ' tone' : ''}${o.kind ? ` ${o.kind}` : ''}`,
    style: o.tone ? `--tone: ${o.tone}` : null,
    title: o.title ?? null,
  }, o.icon ? emojiIcon(o.icon) : null, ...parts);
}

/** A picture to click on a card, on a checkerboard so transparent pictures show their edges. */
export function thumbButton(url: string | null, label: string, onclick: () => void, empty = 'No picture yet'): HTMLElement {
  return h('button', { type: 'button', class: 'tile-thumb', title: `Edit ${label}`, 'aria-label': `Edit ${label}`, onclick },
    url ? h('img', { src: url, alt: '', loading: 'lazy' }) : h('span', { class: 'tile-thumb-none' }, empty));
}

/** The name on a card, cut short with an ellipsis, and its id. */
export function tileTitle(name: string, id?: string | number | null, ...extra: Child[]): HTMLElement {
  return h('div', { class: 'card-title' }, h('strong', { class: 'tile-name', title: name }, name), ...extra, id != null ? h('span', { class: 'muted tile-id' }, `#${id}`) : null);
}

/** The buttons along the bottom of a card: Edit first, then whatever else, then the bin on the right. */
export function tileActions(edit: () => void, editLabel: string, remove: (() => void) | null, ...middle: Child[]): HTMLElement {
  return h('div', { class: 'row-actions tile-actions' },
    h('button', { type: 'button', class: 'primary', 'data-open': 'edit', onclick: edit }, `✏️ ${editLabel}`),
    ...middle,
    h('span', { class: 'spacer' }),
    remove ? deleteIcon(remove) : null);
}

export function deleteIcon(remove: () => void, label = 'Delete'): HTMLElement {
  return h('button', { type: 'button', class: 'danger icon tile-delete', title: label, 'aria-label': label, onclick: remove }, '🗑');
}

/** Delete a row of a table, after asking. */
export const removeRow = (ctx: FormContext, table: Table, row: Row, what: string) => () => confirmDelete(what) && void ctx.store.remove(table, row.id);

/** One part of a pop-up panel: a coloured edge and a heading, then its content. */
export function section(title: string, tone: string, key: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'panel-section', 'data-section': key, style: `--tone: ${tone}` }, h('h3', { class: 'section-head' }, title), ...children);
}

/** Some of a list of fields, in the order the keys are given, with labels changed where a section heading already says it. */
export function pick(fields: readonly Field[], keys: string[], labels: Record<string, string> = {}): Field[] {
  return keys.flatMap((key) => {
    const field = fields.find((f) => f.key === key);
    return field ? [labels[key] ? { ...field, label: labels[key]! } : field] : [];
  });
}

/** Conditions as a chip: "samples >= 3 and lab_visited = 1". */
export function conditionChip(list: ConditionValue[] | null | undefined, lead: string, icon: string, empty?: { text: string; kind?: 'warn' | 'muted' }): HTMLElement | null {
  if (!list?.length) return empty ? chip(empty.text, { kind: empty.kind ?? 'muted', icon }) : null;
  const text = list.map((c) => conditionText(c as Record<string, unknown>)).join(' and ');
  return chip([h('span', { class: 'chip-lead' }, lead), h('code', null, text)], { kind: 'cond', icon, title: `${lead} ${text}` });
}

/** The scene groups' colours, in turn: a group is recognised by its colour on its scenes' cards. */
export const GROUP_TONES = ['#4c9aff', '#3ecf7c', '#ff9d3b', '#b18cff', '#ff7ac6', '#2fd0e0', '#f5c653', '#ff6b6b'];
export const groupTone = (index: number) => GROUP_TONES[index % GROUP_TONES.length]!;

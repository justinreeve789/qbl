import { BUILT_IN_MOVES } from '@qbl/shared';
import type { Row } from './api';
import { actionLabel, eventLabel, EVENT_KINDS, mediaLabel, mediaUrl, params, sceneLabel } from './describe';
import { h, help, toast } from './dom';
import type { Store } from './store';

/**
 * Forms are described as lists of fields and drawn by `form()`. Adding an attribute to an
 * action, a scene or anything else is one more entry in a list in schema.ts.
 */
export type FieldKind =
  | 'text' | 'textarea' | 'html' | 'number' | 'bool' | 'select' | 'color'
  /** A variable's value or a condition's operand: a number when it looks like one, otherwise text. */
  | 'value'
  /** A comma-separated list of whole numbers. */
  | 'numbers'
  | 'media' | 'scene' | 'spawn' | 'event' | 'action' | 'variable' | 'item' | 'character' | 'animation';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  /** Shown in an empty field: what leaving it empty means. */
  placeholder?: string;
  options?: ReadonlyArray<readonly [value: string, label: string]>;
  /** media: which type of file may be picked. */
  mediaType?: 'image' | 'audio' | 'video';
  /** spawn: the sibling field that holds the scene whose spawn points are listed. */
  sceneKey?: string;
  /** event: only list events of these kinds. */
  eventKinds?: string[];
  /** bool: the value when the attribute is absent. */
  default?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Changing this changes which other fields are shown, so the form is redrawn. */
  structural?: boolean;
  /** Take the full width of the form rather than half. */
  wide?: boolean;
}

export type Values = Record<string, unknown>;
export type Commit = (key: string, value: unknown, field: Field) => void;

export interface FormContext {
  store: Store;
  /** The scene being edited, for pickers that list things in it. */
  sceneId?: number;
}

const NEW = '__new__';

export function form(fields: readonly Field[], values: Values, commit: Commit, ctx: FormContext): HTMLElement {
  return h('div', { class: 'form' }, ...fields.map((f) => control(f, values, commit, ctx)));
}

function control(f: Field, values: Values, commit: Commit, ctx: FormContext): HTMLElement {
  const value = values[f.key];
  const set = (v: unknown) => commit(f.key, v, f);
  const wrap = (input: Node, extra?: Node | null) =>
    h('label', { class: `field${f.wide ? ' wide' : ''}`, 'data-field': f.key }, h('span', { class: 'field-label' }, f.label, help(f.hint)), input, extra);

  switch (f.kind) {
    case 'bool': {
      const input = h('input', { type: 'checkbox', checked: value == null ? f.default === true : value === true || value === 1, onchange: () => set(input.checked) });
      return h('label', { class: `field check${f.wide ? ' wide' : ''}`, 'data-field': f.key }, input, h('span', null, f.label), help(f.hint));
    }
    case 'number': {
      const input = h('input', {
        type: 'number', value: value ?? '', placeholder: f.placeholder, min: f.min, max: f.max, step: f.step ?? 'any',
        onchange: () => set(input.value.trim() === '' || Number.isNaN(Number(input.value)) ? null : Number(input.value)),
      });
      return wrap(input);
    }
    case 'animation': {
      // Any name can be typed; the list offers the ones this scenario's sprite sheets define and the built-in moves.
      const names = new Set<string>(Object.keys(BUILT_IN_MOVES));
      for (const m of ctx.store.rows('media')) for (const a of ((params(m).animations as Array<{ name: string }> | undefined) ?? [])) names.add(a.name);
      const id = `animations-${Math.random().toString(36).slice(2)}`;
      const input = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder ?? 'jump', list: id, onchange: () => set(input.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || null) });
      return wrap(input, h('datalist', { id }, ...[...names].sort().map((n) => h('option', { value: n }))));
    }
    case 'value': {
      const input = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder, onchange: () => set(parseValue(input.value)) });
      return wrap(input);
    }
    case 'numbers': {
      const input = h('input', {
        type: 'text', value: Array.isArray(value) ? value.join(', ') : '', placeholder: f.placeholder,
        onchange: () => {
          const list = input.value.split(/[\s,]+/).filter((s) => /^\d+$/.test(s)).map(Number);
          set(list.length ? list : null);
        },
      });
      return wrap(input);
    }
    case 'textarea':
    case 'html': {
      const input = h('textarea', { rows: f.kind === 'html' ? 6 : 3, placeholder: f.placeholder, spellcheck: 'true', onchange: () => set(input.value) });
      input.value = String(value ?? '');
      return wrap(input);
    }
    case 'color': {
      const input = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder ?? '#ffffff', onchange: () => set(input.value.trim() || null) });
      return wrap(input);
    }
    case 'select':
      return wrap(select(f.options ?? [], value == null ? '' : String(value), (v) => set(v === '' ? null : v), f.placeholder));
    case 'scene':
      return wrap(idSelect(ctx.store.rows('scenes').map((r) => [r.id, sceneLabel(r)]), value, set, f.placeholder ?? 'Choose a scene'));
    case 'item':
      return wrap(idSelect(ctx.store.rows('items').map((r) => [r.id, String(r.name)]), value, set, 'Choose an item'));
    case 'character':
      return wrap(idSelect(ctx.store.rows('characters').map((r) => [r.id, String(r.name)]), value, set, 'Choose a character'));
    case 'spawn': {
      const scene = ctx.store.byId('scenes', values[f.sceneKey ?? 'scene_id'] as number | null);
      const points = ((params(scene ?? ({} as Row), 'layout').spawn_points as Array<{ name: string }> | undefined) ?? []).map((p) => [p.name, p.name] as const);
      return wrap(select(points, value == null ? '' : String(value), (v) => set(v === '' ? null : v), 'The default spawn point'));
    }
    case 'event': {
      const events = ctx.store.rows('events').filter((e) => !f.eventKinds || f.eventKinds.includes(e.kind as string));
      const options = events.map((e) => {
        const sameScene = e.scene_id === ctx.sceneId;
        const scene = sameScene ? '' : `${sceneLabel(ctx.store.byId('scenes', e.scene_id as number))} › `;
        return [e.id, `${scene}${eventLabel(e)} (${EVENT_KINDS[e.kind as keyof typeof EVENT_KINDS].toLowerCase()})`] as [number, string];
      });
      return wrap(idSelect(options, value, set, f.placeholder ?? 'Choose an event'));
    }
    case 'action': {
      const eventIds = new Set(ctx.store.rows('events').filter((e) => ctx.sceneId == null || e.scene_id === ctx.sceneId).map((e) => e.id));
      const actions = ctx.store.rows('actions').filter((a) => eventIds.has(a.event_id as number));
      return wrap(idSelect(actions.map((a) => [a.id, `#${a.id} ${actionLabel(ctx.store, a)}`]), value, set, 'Choose an action'));
    }
    case 'variable': {
      const names = ctx.store.rows('variables').map((v) => String(v.variable_name));
      const shared = new Set(ctx.store.rows('variables').filter((v) => v.scope === 'room').map((v) => String(v.variable_name)));
      const current = value == null ? '' : String(value);
      // A shared variable is marked, so it is plain which actions change things for everyone.
      const options = names.map((n) => [n, shared.has(n) ? `${n}  (shared by everyone)` : n] as const).concat(current && !names.includes(current) ? [[current, `${current} (not defined)`]] : [], [[NEW, 'New variable…']]);
      const node = select(options, current, async (v) => {
        if (v !== NEW) return set(v === '' ? null : v);
        const name = window.prompt('Name of the new variable (letters, digits and underscores):')?.trim();
        node.value = current;
        if (!name) return;
        const row = await ctx.store.add('variables', { variable_name: name, default_value: 0 });
        if (row) set(row.variable_name);
      }, 'Choose a variable');
      return wrap(node);
    }
    case 'media': {
      const type = f.mediaType ?? 'image';
      const rows = ctx.store.rows('media').filter((m) => m.type === type);
      const file = h('input', { type: 'file', hidden: true, accept: `${type}/*` });
      const node = idSelect(rows.map((m) => [m.id, mediaLabel(m)]), value, (v) => set(v), `No ${type}`, [[NEW, `Upload ${type === 'audio' ? 'an' : 'a'} ${type} file…`]], () => file.click());
      file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        try {
          const row = await ctx.store.api.upload(ctx.store.scenarioId, picked);
          if (row.type !== type) toast(`That file is ${row.type}, not ${type}. It was added to the media library.`, 'error');
          ctx.store.bundle.media.push(row);
          if (row.type === type) set(row.id);
          ctx.store.emit(true);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Upload failed.', 'error');
        }
      });
      const chosen = ctx.store.byId('media', value as number | null);
      const url = type === 'image' ? mediaUrl(ctx.store, chosen) : null;
      return wrap(h('div', { class: 'media-pick' }, url ? h('img', { src: url, alt: '', class: 'thumb' }) : null, node, file));
    }
    default: {
      const input = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder, onchange: () => set(input.value) });
      return wrap(input);
    }
  }
}

/** Text typed for a variable value: numbers become numbers. */
export function parseValue(raw: string): string | number {
  const trimmed = raw.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : raw;
}

export function select(
  options: ReadonlyArray<readonly [string, string]>,
  value: string,
  onPick: (value: string) => void,
  emptyLabel?: string,
): HTMLSelectElement {
  const node = h('select', { onchange: () => onPick(node.value) });
  if (emptyLabel != null) node.append(h('option', { value: '' }, emptyLabel));
  for (const [v, label] of options) node.append(h('option', { value: v }, label));
  if (value !== '' && !options.some(([v]) => v === value)) node.append(h('option', { value }, `${value} (missing)`));
  node.value = value;
  return node;
}

/** A select over rows, whose value is a row id or null. `extra` options call `onExtra` instead of picking. */
function idSelect(
  options: Array<[id: number, label: string]>,
  value: unknown,
  onPick: (id: number | null) => void,
  emptyLabel: string,
  extra: Array<[string, string]> = [],
  onExtra?: () => void,
): HTMLSelectElement {
  const current = value == null ? '' : String(value);
  const node = select([...options.map(([id, label]) => [String(id), label] as const), ...extra], current, (v) => {
    if (extra.some(([key]) => key === v)) {
      node.value = current;
      onExtra?.();
    } else {
      onPick(v === '' ? null : Number(v));
    }
  }, emptyLabel);
  return node;
}

/**
 * Apply a committed field to a bag of optional attributes (an action's params, a layer, a label's
 * params): empty values and values equal to the default are removed rather than stored.
 */
export function withValue(bag: Values, key: string, value: unknown, field?: Field): Values {
  const next = { ...bag };
  const isDefault = field?.kind === 'bool' && value === (field.default ?? false);
  if (value == null || value === '' || isDefault) delete next[key];
  else next[key] = value;
  return next;
}

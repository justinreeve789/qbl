import { BUILT_IN_MOVES, isPose } from '@qbl/shared';
import type { Row } from './api';
import { characterOf } from './characters';
import { actionLabel, eventLabel, EVENT_KINDS, mediaLabel, mediaUrl, params, sceneLabel } from './describe';
import { h, help, toast } from './dom';
import type { Store } from './store';
import { richEditor } from './rich/editor';

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
  | 'media' | 'scene' | 'spawn' | 'event' | 'action' | 'variable' | 'item' | 'character' | 'animation'
  /** Yes, no, or left to something else to decide (the placeholder). `options` are the labels for yes and no. Stored as true, false or absent. */
  | 'tristate'
  /** One of the scenario's glossary entries, or one of its scene groups. */
  | 'glossary' | 'group';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  /** Shown in an empty field: what leaving it empty means. */
  placeholder?: string;
  options?: ReadonlyArray<readonly [value: string, label: string]>;
  /** media: which type of file may be picked. `visual`: a picture or a video. */
  mediaType?: 'image' | 'audio' | 'video' | 'visual';
  /**
   * spawn: the sibling field that holds the scene whose spawn points are listed. `here`: the scene
   * being edited, or, where there is none (a character's routine), every scene's.
   */
  sceneKey?: string;
  /** event: only list events of these kinds. */
  eventKinds?: string[];
  /** bool, select: the value when the attribute is absent. */
  default?: boolean | string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * number: also draw a slider beside the box, over this range. The box still takes any value
   * within `min` and `max`; one past the slider's end moves the end out to it.
   */
  slider?: Slider;
  /** Changing this changes which other fields are shown, so the form is redrawn. */
  structural?: boolean;
  /** Take the full width of the form rather than half. Fields with a slider do unless this is false. */
  wide?: boolean;
  /** Shown only when this says so, given the form's values: a field that only means something for some choices. */
  when?: (values: Values) => boolean;
  /**
   * number: the X of a spot in the scene, whose Y is the field named `y`. Where the form can pick
   * spots (`FormContext.pickSpot`), a button after the two lets the spot be chosen by clicking the
   * scene. `prompt` says what the click chooses ("Click where the walker should go").
   */
  spot?: { y: string; prompt: string };
}

/** A spot to be chosen by clicking a scene. */
export interface SpotRequest {
  /** What the click chooses, shown while choosing. */
  prompt: string;
  /** The spot as it is now, if it has one, drawn so it can be seen while choosing. */
  at: { x: number; y: number } | null;
  /** The scene to show, where the form is not about one scene (a character's routine). */
  sceneId?: number;
  /** Called with the spot clicked, in scene pixels. */
  done(at: { x: number; y: number }): void;
  /** Called when choosing stops without a spot: Escape, Cancel, another choice begun, or the returned function called. */
  cancelled?(): void;
}

export interface Slider {
  min: number;
  /** `scene`: the longer side of the scene being edited, for distances across it. */
  max: number | 'scene';
  /** The slider's step. Default: the field's step, else hundredths over a short range and whole numbers over a long one. */
  step?: number;
}

export type Values = Record<string, unknown>;
export type Commit = (key: string, value: unknown, field: Field) => void;

export interface FormContext {
  store: Store;
  /** The scene being edited, for pickers that list things in it. */
  sceneId?: number;
  /** Lets a spot be chosen by clicking the scene: the scene editor's canvas, or a pop-up of a scene. Without it there is no button. */
  pickSpot?: (request: SpotRequest) => () => void;
  /** Where there is no `sceneId`: the scene a spot is most likely in, shown first when picking one. */
  spotScene?: number;
  /** The character whose form this is (a routine step), for pickers that list its things. */
  characterId?: number;
}

const NEW = '__new__';

export function form(fields: readonly Field[], values: Values, commit: Commit, ctx: FormContext): HTMLElement {
  const shown = fields.filter((f) => !f.when || f.when(values));
  const nodes = new Map<Field, HTMLElement>(shown.map((f) => [f, control(f, values, commit, ctx)]));
  const children: HTMLElement[] = [];
  for (const f of shown) {
    children.push(nodes.get(f)!);
    // The button for a spot goes after its Y, so it sits under the pair.
    const x = ctx.pickSpot ? shown.find((other) => other.spot?.y === f.key) : undefined;
    if (x) children.push(spotButton(x, f, nodes.get(x)!, nodes.get(f)!, values, commit, ctx));
  }
  return h('div', { class: 'form' }, ...children);
}

/**
 * “Pick on the scene”: choose the spot an X and a Y field name by clicking the scene, rather than
 * typing the numbers. Both boxes show the spot clicked and both values are saved.
 */
function spotButton(xField: Field, yField: Field, xNode: HTMLElement, yNode: HTMLElement, values: Values, commit: Commit, ctx: FormContext): HTMLElement {
  const boxes = () => [xNode.querySelector<HTMLInputElement>('input[type=number]'), yNode.querySelector<HTMLInputElement>('input[type=number]')] as const;
  const read = (box: HTMLInputElement | null, key: string): number | null => {
    const raw = box ? box.value.trim() : String(values[key] ?? '');
    return raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw);
  };
  const idle = '📍 Pick on the scene';
  let cancel: (() => void) | null = null;
  const stop = () => {
    cancel = null;
    button.textContent = idle;
    button.classList.remove('picking');
    button.setAttribute('aria-pressed', 'false');
  };
  const button = h('button', {
    type: 'button', class: 'spot-pick', 'aria-pressed': 'false', title: 'Choose the spot by clicking the scene instead of typing X and Y',
    onclick: () => {
      if (cancel) return cancel();
      const [bx, by] = boxes();
      const x = read(bx, xField.key);
      const y = read(by, yField.key);
      button.textContent = 'Click the scene… (Esc to stop)';
      button.classList.add('picking');
      button.setAttribute('aria-pressed', 'true');
      cancel = ctx.pickSpot!({
        prompt: xField.spot!.prompt,
        at: x != null && y != null ? { x, y } : null,
        sceneId: ctx.sceneId ?? ctx.spotScene,
        done: (at) => {
          stop();
          const [bx2, by2] = boxes();
          if (bx2) bx2.value = String(at.x);
          if (by2) by2.value = String(at.y);
          // Sliders, if either has one, follow their box.
          for (const box of [bx2, by2]) box?.dispatchEvent(new Event('change'));
          if (!bx2) commit(xField.key, at.x, xField);
          if (!by2) commit(yField.key, at.y, yField);
        },
        cancelled: stop,
      });
    },
  }, idle);
  return h('div', { class: 'field wide spot-field', 'data-field': `${xField.key}-pick` }, button);
}

function control(f: Field, values: Values, commit: Commit, ctx: FormContext): HTMLElement {
  const value = values[f.key];
  const set = (v: unknown) => commit(f.key, v, f);
  const wide = f.wide ?? (f.kind === 'number' && f.slider != null);
  const wrap = (input: Node, extra?: Node | null) =>
    h('label', { class: `field${wide ? ' wide' : ''}`, 'data-field': f.key }, h('span', { class: 'field-label' }, f.label, help(f.hint)), input, extra);

  switch (f.kind) {
    case 'bool': {
      const input = h('input', { type: 'checkbox', checked: value == null ? f.default === true : value === true || value === 1, onchange: () => set(input.checked) });
      return h('label', { class: `field check${f.wide ? ' wide' : ''}`, 'data-field': f.key }, input, h('span', null, f.label), help(f.hint));
    }
    case 'number': {
      if (f.slider) return wrap(slider(f, f.slider, value, set, ctx));
      const input = h('input', {
        type: 'number', value: value ?? '', placeholder: f.placeholder, min: f.min, max: f.max, step: f.step ?? 'any',
        onchange: () => set(input.value.trim() === '' || Number.isNaN(Number(input.value)) ? null : Number(input.value)),
      });
      return wrap(input);
    }
    case 'animation':
      return wrap(animationPicker(f, value, values, set, ctx));
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
    case 'textarea': {
      const input = h('textarea', { rows: 3, placeholder: f.placeholder, spellcheck: 'true', onchange: () => set(input.value) });
      input.value = String(value ?? '');
      return wrap(input);
    }
    case 'html':
      // Not a <label>: a click in the editor's text must not press its first button.
      return h('div', { class: 'field wide rich-field', 'data-field': f.key }, h('span', { class: 'field-label' }, f.label, help(f.hint)), richEditor({ value: String(value ?? ''), set, ctx, values }));
    case 'color': {
      // A swatch to pick with, and the box for any CSS colour (a name, #rgb, rgb()).
      const input = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder ?? '#ffffff', onchange: () => {
        set(input.value.trim() || null);
        swatch.value = hex(input.value);
      } });
      const hex = (v: unknown) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v) : /^#[0-9a-f]{3}$/i.test(String(v ?? '')) ? `#${[...String(v).slice(1)].map((c) => c + c).join('')}` : '#2f8fd6');
      const swatch = h('input', { type: 'color', class: 'swatch', value: hex(value), 'aria-label': `${f.label}: pick a colour`, onchange: () => {
        input.value = swatch.value;
        set(swatch.value);
      } });
      const reset = h('button', { type: 'button', class: 'icon', title: 'Back to the default', 'aria-label': 'Back to the default', onclick: () => {
        input.value = '';
        swatch.value = hex(null);
        set(null);
      } }, '×');
      return wrap(h('div', { class: 'color-pick' }, swatch, input, reset));
    }
    case 'select': {
      const current = value == null || value === '' ? (typeof f.default === 'string' ? f.default : '') : String(value);
      return wrap(select(f.options ?? [], current, (v) => set(v === '' ? null : v), f.placeholder));
    }
    case 'tristate': {
      const [yes, no] = [f.options?.[0]?.[1] ?? 'Yes', f.options?.[1]?.[1] ?? 'No'];
      const current = value == null || value === '' ? '' : String(value === true || value === 'true' || value === 1);
      return wrap(select([['true', yes], ['false', no]], current, (v) => set(v === '' ? null : v === 'true'), f.placeholder));
    }
    case 'glossary': {
      const entries = (ctx.store.settings.glossary as Array<{ id: string | number; term?: string }> | undefined) ?? [];
      return wrap(select(entries.map((e) => [String(e.id), String(e.term ?? e.id)] as const), value == null ? '' : String(value), (v) => set(v === '' ? null : v), entries.length ? 'Choose a word' : 'Add words on the Glossary page first'));
    }
    case 'group': {
      const groups = (ctx.store.settings.scene_groups as Array<{ id: number; name?: string }> | undefined) ?? [];
      return wrap(idSelect(groups.map((g) => [g.id, String(g.name ?? `Group ${g.id}`)]), value, set, f.placeholder ?? 'None'));
    }
    case 'scene':
      return wrap(idSelect(ctx.store.rows('scenes').map((r) => [r.id, sceneLabel(r)]), value, set, f.placeholder ?? 'Choose a scene'));
    case 'item':
      return wrap(idSelect(ctx.store.rows('items').map((r) => [r.id, String(r.name)]), value, set, 'Choose an item'));
    case 'character':
      return wrap(idSelect(ctx.store.rows('characters').map((r) => [r.id, String(r.name)]), value, set, 'Choose a character'));
    case 'spawn': {
      const pointsOf = (scene: Row | undefined) => ((params(scene ?? ({} as Row), 'layout').spawn_points as Array<{ name: string }> | undefined) ?? []).map((p) => p.name);
      const names = f.sceneKey === 'here'
        ? (ctx.sceneId != null ? pointsOf(ctx.store.byId('scenes', ctx.sceneId)) : [...new Set(ctx.store.rows('scenes').flatMap(pointsOf))])
        : pointsOf(ctx.store.byId('scenes', values[f.sceneKey ?? 'scene_id'] as number | null));
      const current = value == null ? '' : String(value);
      const points = names.map((n) => [n, n] as const).concat(current && !names.includes(current) ? [[current, `${current} (not in this scene)`]] : []);
      return wrap(select(points, current, (v) => set(v === '' ? null : v), f.placeholder ?? 'The default spawn point'));
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
      // `visual`: a picture or a video.
      const types = type === 'visual' ? ['image', 'video'] : [type];
      const rows = ctx.store.rows('media').filter((m) => types.includes(String(m.type)));
      const file = h('input', { type: 'file', hidden: true, accept: types.map((t) => `${t}/*`).join(',') });
      const none = f.placeholder ?? (type === 'visual' ? 'None' : `No ${type}`);
      const node = idSelect(rows.map((m) => [m.id, type === 'visual' ? `${m.type === 'video' ? '🎬' : '🖼️'} ${mediaLabel(m)}` : mediaLabel(m)]), value, (v) => set(v), none, [[NEW, type === 'visual' ? 'Upload a picture or a video…' : `Upload ${type === 'audio' ? 'an' : 'a'} ${type} file…`]], () => file.click());
      file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        try {
          const row = await ctx.store.api.upload(ctx.store.scenarioId, picked);
          if (!types.includes(String(row.type))) toast(`That file is ${row.type}, not ${types.join(' or ')}. It was added to the media library.`, 'error');
          ctx.store.bundle.media.push(row);
          if (types.includes(String(row.type))) set(row.id);
          ctx.store.emit(true);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Upload failed.', 'error');
        }
      });
      const chosen = ctx.store.byId('media', value as number | null);
      const url = chosen?.type === 'image' ? mediaUrl(ctx.store, chosen) : null;
      return wrap(h('div', { class: 'media-pick' }, url ? h('img', { src: url, alt: '', class: 'thumb' }) : null, node, file));
    }
    default: {
      const input = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder, onchange: () => set(input.value) });
      return wrap(input);
    }
  }
}

/**
 * A slider and a number box showing the same value. Dragging saves as it goes (the store folds
 * the steps into one request at a time), so the canvas follows the slider. An empty value is
 * shown at the default the placeholder names, dimmed, and stays empty until something is chosen.
 */
function slider(f: Field, range: Slider, value: unknown, set: (v: unknown) => void, ctx: FormContext): HTMLElement {
  const end = range.max === 'scene' ? sceneSide(ctx) : range.max;
  const step = range.step ?? f.step ?? (end - range.min <= 5 ? 0.01 : 1);
  const fallback = f.placeholder != null && f.placeholder.trim() !== '' && Number.isFinite(Number(f.placeholder)) ? Number(f.placeholder) : null;
  const decimals = (String(step).split('.')[1] ?? '').length;
  const tidy = (n: number) => Number(n.toFixed(decimals));

  const bar = h('input', { type: 'range', min: range.min, max: end, step, class: 'slider-bar' });
  const box = h('input', { type: 'number', placeholder: f.placeholder, min: f.min, max: f.max, step: f.step ?? 'any', 'aria-label': f.label });
  // Wide enough for what the placeholder says leaving it empty means.
  box.style.width = `${Math.min(24, Math.max(7, (f.placeholder ?? '').length + 4))}ch`;
  let last: number | null = typeof value === 'number' ? value : null;
  let frame = 0;

  const show = (n: number | null) => {
    if (n != null && n > Number(bar.max)) bar.max = String(n);
    if (n != null && n < Number(bar.min)) bar.min = String(n);
    bar.value = String(n ?? fallback ?? range.min);
    bar.classList.toggle('unset', n == null);
    box.value = n == null ? '' : String(n);
  };
  const save = (n: number | null) => {
    cancelAnimationFrame(frame);
    if (n === last) return;
    last = n;
    set(n);
  };

  bar.addEventListener('input', () => {
    const n = tidy(Number(bar.value));
    box.value = String(n);
    bar.classList.remove('unset');
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => ctx.store.live(() => save(n)));
  });
  bar.addEventListener('change', () => save(tidy(Number(bar.value))));
  box.addEventListener('change', () => {
    const raw = box.value.trim();
    const n = raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw);
    show(n);
    save(n);
  });

  show(last);
  return h('div', { class: 'slider' }, bar, box);
}

/** The longer side of the scene being edited, for sliders over distances in it. */
function sceneSide(ctx: FormContext): number {
  const scene = ctx.store.byId('scenes', ctx.sceneId);
  const side = Math.max(Number(scene?.width) || 0, Number(scene?.height) || 0);
  return side > 0 ? Math.round(side) : 1000;
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

type Choice = readonly [value: string, label: string];
type ChoiceGroup = { label: string; choices: Choice[]; empty?: string };

const builtInChoices = (except: readonly string[] = []): Choice[] =>
  Object.entries(BUILT_IN_MOVES).filter(([n]) => !except.includes(n)).map(([n, m]) => [n, `${m.icon} ${m.label}`] as const);
const named = (names: Iterable<string>): Choice[] => [...new Set(names)].sort().map((n) => [n, n] as const);

/**
 * The animations an animation field offers, grouped. A character (the one an animate action names,
 * or the routine's own) offers only the animations defined for it on the Characters page, not its
 * poses; an item, its sprite sheet's and the built-in moves; anything else, every name the scenario
 * knows of. Null while an animate action is on a character but none is chosen yet.
 */
export function animationChoices(values: Values, ctx: FormContext): ChoiceGroup[] | null {
  const { store } = ctx;
  const onCharacter = ctx.characterId != null || values.target === 'character';
  if (onCharacter) {
    const characterId = ctx.characterId ?? (values.character_id as number | null | undefined);
    const character = characterId != null ? store.byId('characters', characterId) : undefined;
    if (!character) return null;
    const own = Object.keys(characterOf(store, character).animations ?? {}).filter((n) => !isPose(n));
    return [{ label: `${String(character.name || 'This character')}’s animations`, choices: named(own), empty: 'None yet: add some on the Characters page' }];
  }
  const item = values.target === 'item' && values.item_id != null ? store.byId('items', values.item_id as number) : undefined;
  if (item) {
    const media = store.byId('media', item.media_id as number | null);
    const own = ((media ? (params(media).animations as Array<{ name: string }> | undefined) : undefined) ?? []).map((a) => a.name);
    return [
      { label: `${String(item.name || 'This item')}’s sprite sheet`, choices: named(own) },
      { label: 'Built-in moves', choices: builtInChoices(own) },
    ].filter((g) => g.choices.length);
  }
  const sheets = store.rows('media').flatMap((m) => ((params(m).animations as Array<{ name: string }> | undefined) ?? []).map((a) => a.name));
  const characters = store.rows('characters').flatMap((c) => Object.keys(characterOf(store, c).animations ?? {}).filter((n) => !isPose(n)));
  return [
    { label: 'Built-in moves', choices: builtInChoices() },
    { label: 'Characters’ animations', choices: named(characters.filter((n) => !(n in BUILT_IN_MOVES))) },
    { label: 'From sprite sheets', choices: named(sheets.filter((n) => !(n in BUILT_IN_MOVES))) },
  ].filter((g) => g.choices.length);
}

/**
 * After an animate action's target, character or item changes: an animation the new one does not
 * have gives way to the first one it does (or none). Left alone while no character is chosen.
 */
export function tidyAnimate<T extends Values>(values: T, ctx: FormContext): T {
  const current = values.animation as string | null | undefined;
  const groups = animationChoices(values, ctx);
  if (!current || !groups) return values;
  const names = groups.flatMap((g) => g.choices.map(([v]) => v));
  if (names.includes(current)) return values;
  const next: Values = { ...values };
  if (names[0]) next.animation = names[0];
  else delete next.animation;
  return next as T;
}

/** A dropdown of the animations there are to play: for a character, only the ones defined for it. */
function animationPicker(f: Field, value: unknown, values: Values, set: (v: unknown) => void, ctx: FormContext): HTMLElement {
  const current = value == null ? '' : String(value);
  const groups = animationChoices(values, ctx);
  const node = h('select', { class: 'animation-choice', onchange: () => set(node.value || null) });
  if (!groups) {
    node.append(h('option', { value: '' }, 'Choose a character first'));
    node.disabled = true;
    return node;
  }
  node.append(h('option', { value: '' }, f.placeholder ?? 'Choose an animation'));
  for (const g of groups) {
    const group = h('optgroup', { label: g.label });
    for (const [v, label] of g.choices) group.append(h('option', { value: v }, label));
    if (!g.choices.length && g.empty) group.append(h('option', { value: '', disabled: true }, g.empty));
    node.append(group);
  }
  // A name saved earlier that is not on the list any more: kept, and said so, until another is chosen.
  if (current && !groups.some((g) => g.choices.some(([v]) => v === current))) node.append(h('option', { value: current }, `${current} (not defined)`));
  node.value = current;
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

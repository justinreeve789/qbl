import type { ActionType } from '@qbl/shared';
import { h } from './dom';
import { ACTION_GROUPS, ACTION_LOOK, ACTIONS } from './schema';

export type ActionPickerOptions = {
  /** A first, empty choice: the "+ Add action…" prompt, or "Just close the box". */
  empty?: string;
  /** Show each action's one-line description under its name. */
  about?: boolean;
  /** The name shown for a type, when it is not the action's own (a routine's "Walk somewhere"). */
  label?: (type: ActionType) => string;
  /** A prompt rather than a value: styled as an add button. */
  add?: boolean;
};

/**
 * A grouped `<select>` of action types: 🗣️ Talking and storytelling, 🧑 Characters and the player,
 * and so on, in the order of ACTION_GROUPS, keeping only `types`. Groups with nothing left are not
 * shown. It is a plain select, so keyboards, screen readers and tests use it as one; where the
 * browser supports `appearance: base-select` (editor.css), the list opens as a styled picker with
 * coloured group headings, icon tiles and the descriptions on a line of their own. Elsewhere it is
 * the browser's own list with its group labels, reading "💬 Dialogue: A speech bubble…".
 */
export function actionPicker(
  types: readonly ActionType[],
  value: string,
  onPick: (value: string) => void,
  options: ActionPickerOptions = {},
): HTMLSelectElement {
  const node = h('select', { class: options.add ? 'type-picker add' : 'type-picker', onchange: () => onPick(node.value) });
  if (options.empty != null) node.append(h('option', { value: '', class: 'type-empty' }, options.empty));

  const wanted = new Set(types);
  const label = options.label ?? ((t: ActionType) => ACTIONS[t].label);
  for (const group of ACTION_GROUPS) {
    const here = group.types.filter((t) => wanted.has(t));
    if (!here.length) continue;
    here.forEach((t) => wanted.delete(t));
    node.append(
      h(
        'optgroup',
        { label: `${group.icon} ${group.label}`, 'data-group': group.key, style: `--group:${group.tone}` },
        h('legend', null, h('span', { class: 'type-group-icon', 'aria-hidden': 'true' }, group.icon), group.label),
        ...here.map((t) => typeOption(t, label(t), options.about === true)),
      ),
    );
  }
  // A type no group lists yet still has to be choosable.
  for (const t of wanted) node.append(typeOption(t, label(t), options.about === true));

  if (value !== '' && !types.includes(value as ActionType)) node.append(h('option', { value }, `${value} (missing)`));
  node.value = value;
  return node;
}

/**
 * One action. The separators are real text so the browser's own list (which shows only the text)
 * reads well; the styled picker hides them and lays the parts out.
 */
function typeOption(type: ActionType, name: string, about: boolean): HTMLOptionElement {
  return h(
    'option',
    { value: type, 'data-type': type },
    h('span', { class: 'type-icon', 'aria-hidden': 'true' }, ACTION_LOOK[type][0]),
    h('span', { class: 'type-sep' }, ' '),
    h('span', { class: 'type-text' }, h('span', { class: 'type-name' }, name), about ? h('span', { class: 'type-sep' }, ': ') : null, about ? h('span', { class: 'type-about' }, ACTIONS[type].about) : null),
  );
}

import type { Table } from '../api';
import { confirmDelete, h, help } from '../dom';
import { form, type FormContext } from '../fields';
import { renameVariable } from '../rename';
import { VARIABLE_FIELDS } from '../schema';
import type { Store } from '../store';
import { emptyState, listPage } from './kit';

type Scope = 'all' | 'player' | 'room';
/** What the page is showing: kept outside it so a redraw leaves the filter as it was. */
let showing: Scope = 'all';
let search = '';

/** Show every variable: so one asked for from elsewhere (the Publish page's “Go there”) is not filtered out. */
export function showAllVariables() {
  showing = 'all';
  search = '';
}

const ABOUT = 'What the scenario remembers. Conditions test variables and “Variable” actions change them. Each one is either a player’s own or shared. A player’s own: every player has a separate value, so one player’s progress does not move another’s (how many animals this player has petted, which step of the quest they are on). Shared: one value for everyone playing together, so when one player changes it, it changes for all of them (the boulders have fallen and the path is blocked for everybody).';

/**
 * The Variables page: one line per variable, in a table with its headings once at the top, so a
 * mission's forty variables fit on a screen. A filter narrows it by name and by whose they are,
 * and each line says how many places use the variable.
 */
export function variablesPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const add = () => {
    const name = window.prompt('Name of the new variable (letters, digits and underscores):')?.trim();
    if (!name) return;
    // A new variable must be seen, whatever the filter was.
    search = '';
    showing = 'all';
    void store.add('variables', { variable_name: name, default_value: 0 });
  };
  const newButton = () => h('button', { type: 'button', class: 'primary', onclick: add }, 'New variable');
  const variables = store.rows('variables');
  if (!variables.length) return listPage({ title: 'Variables', count: 0, about: ABOUT, actions: [newButton()] }, emptyState('🔢', 'No variables yet. Conditions test them and “Variable” actions change them.', newButton()));

  const uses = variableUses(store);
  const scopeOf = (v: Record<string, unknown>): Exclude<Scope, 'all'> => (v.scope === 'room' ? 'room' : 'player');

  const rows = variables.map((variable) => {
    const name = String(variable.variable_name);
    const scope = scopeOf(variable);
    const used = uses.get(name) ?? 0;
    return h('div', { class: 'var-row', role: 'row', 'data-variable': name, 'data-scope': scope },
      form(VARIABLE_FIELDS, variable, (key, value, field) => {
        // A new name: everything that names the variable follows it.
        if (key === 'variable_name') return void renameVariable(store, variable, value);
        void store.patch('variables', variable.id, { [key]: value ?? (key === 'default_value' ? 0 : value) }, field.structural === true);
      }, ctx),
      h('span', { class: `chip var-uses${used ? '' : ' muted'}`, title: used ? `Used in ${used} place${used === 1 ? '' : 's'}: conditions, actions and text that shows it` : 'Nothing tests it, changes it or shows it yet' }, used ? `${used} use${used === 1 ? '' : 's'}` : 'Not used'),
      h('button', { type: 'button', class: 'danger icon tile-delete', title: 'Delete', 'aria-label': `Delete ${name}`, onclick: () => confirmDelete(`the variable “${name}”`) && void store.remove('variables', variable.id) }, '🗑'));
  });

  // Filtering hides rows without drawing the page again, so the search box keeps the cursor.
  const counts = { all: variables.length, player: variables.filter((v) => scopeOf(v) === 'player').length, room: variables.filter((v) => scopeOf(v) === 'room').length };
  const shownCount = h('span', { class: 'muted var-shown' });
  const filter = () => {
    const words = search.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const visible = (showing === 'all' || row.dataset.scope === showing) && (!words || row.dataset.variable!.toLowerCase().includes(words));
      row.hidden = !visible;
      if (visible) shown++;
    }
    shownCount.textContent = shown === rows.length ? '' : `${shown} of ${rows.length} shown`;
    for (const b of scopeButtons) b.setAttribute('aria-pressed', String(b.dataset.scope === showing));
  };
  const scopeButtons = ([['all', 'All', '🔢'], ['player', 'Each player’s own', '👤'], ['room', 'Shared', '🌐']] as const).map(([key, label, icon]) =>
    h('button', { type: 'button', class: 'scope-filter', 'data-scope': key, 'aria-pressed': String(showing === key), onclick: () => { showing = key; filter(); } },
      `${icon} ${label}`, h('small', null, String(counts[key]))));
  const searchBox = h('input', { type: 'search', class: 'var-search', placeholder: 'Find a variable…', value: search, 'aria-label': 'Find a variable', oninput: () => { search = searchBox.value; filter(); } });
  filter();

  return listPage(
    { title: 'Variables', count: variables.length, about: ABOUT, actions: [newButton()] },
    h('div', { class: 'filter-bar' }, searchBox, h('div', { class: 'scope-filters', role: 'group', 'aria-label': 'Whose variables to show' }, ...scopeButtons), shownCount),
    h('div', { class: 'var-table', role: 'table' },
      h('div', { class: 'var-row var-head', role: 'row' },
        h('span', null, 'Name', help(VARIABLE_FIELDS[0]!.hint)), h('span', null, 'Starting value'), h('span', null, 'Whose it is'), h('span', null, 'Kept between visits', help(VARIABLE_FIELDS[3]!.hint)), h('span', null, 'Used'), h('span')),
      ...rows),
  );
}

/**
 * How many places use each variable: conditions on anything, Variable actions, and text that
 * shows one as {{name}}, across the whole scenario. A count of none means nothing reads or
 * changes it, which is often a variable left over or misspelt somewhere.
 */
export function variableUses(store: Store): Map<string, number> {
  const names = new Set(store.rows('variables').map((v) => String(v.variable_name)));
  const counts = new Map<string, number>();
  const count = (name: unknown) => typeof name === 'string' && names.has(name) && counts.set(name, (counts.get(name) ?? 0) + 1);
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 12 || value == null) return;
    if (typeof value === 'string') {
      if (value.includes('{{')) for (const m of value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) count(m[1]);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v) => walk(v, depth + 1));
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      count(record.variable);
      for (const v of Object.values(record)) walk(v, depth + 1);
    }
  };
  const tables: Table[] = ['scenes', 'events', 'actions', 'conditions', 'labels', 'items', 'characters', 'shop_items'];
  for (const table of tables) for (const row of store.rows(table) ?? []) walk(row);
  // A Variable action names its variable as `name`.
  for (const action of store.rows('actions')) if (action.type === 'variable') count((action.params as { name?: unknown } | null)?.name);
  walk(store.scenario.settings);
  walk(store.scenario.description);
  return counts;
}

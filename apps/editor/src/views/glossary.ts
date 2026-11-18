import { sceneTeamOnly } from '@qbl/shared';
import { confirmDelete, h, help } from '../dom';
import { form, withValue, type Field, type FormContext } from '../fields';

/** Kept in the scenario's settings, as the objectives and moves are. */
interface Entry { id: string | number; term?: string; definition?: string; media_id?: number | null; initial?: boolean }
interface Group { id: number; name?: string; team_only?: boolean }

const ENTRY_FIELDS: Field[] = [
  { key: 'term', label: 'Word', kind: 'text' },
  { key: 'media_id', label: 'Picture', kind: 'media', mediaType: 'image', placeholder: 'None' },
  { key: 'definition', label: 'What it means', kind: 'textarea', wide: true, hint: 'In words the players will understand. Use {{variable_name}} to show a variable.' },
  { key: 'initial', label: 'In every player’s glossary from the start', kind: 'bool', wide: true, hint: 'Otherwise a player gets the word when an “Add a glossary word” action gives it to them: at the hotspot, conversation or experiment where it comes up.' },
];

const GROUP_FIELDS: Field[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'team_only', label: 'Players see only their own team in these scenes', kind: 'bool', hint: 'For when a teacher puts students into teams: a group limited to teams shows each player only their teammates. A scene can say otherwise for itself (in its own settings).' },
];

/**
 * The scenario's glossary: the words it teaches. Players see the ones they have in the game's
 * side panel. Each word is either there from the start or given by an action.
 */
export function glossaryPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const read = () => (store.settings.glossary as Entry[] | undefined) ?? [];
  const write = (list: Entry[], structural: boolean) => void store.patchSettings({ glossary: list.length ? list : null }, structural);
  const at = (index: number): Entry => read()[index] ?? { id: '' };
  const replace = (index: number, entry: Entry, structural = false) => write(read().map((e, i) => (i === index ? entry : e)), structural);

  const add = () => {
    const ids = new Set(read().map((e) => String(e.id)));
    let n = read().length + 1;
    while (ids.has(`word-${n}`)) n++;
    write([...read(), { id: `word-${n}`, term: 'New word', definition: 'What it means.' }], true);
  };
  // How many actions give each word, so an author can see a word nobody will ever get.
  const given = new Map<string, number>();
  for (const action of store.rows('actions')) {
    if (action.type !== 'glossary') continue;
    const id = String((action.params as { entry_id?: unknown } | null)?.entry_id ?? '');
    given.set(id, (given.get(id) ?? 0) + 1);
  }

  const cards = read().map((entry, index) => {
    const uses = given.get(String(entry.id)) ?? 0;
    return h(
      'div',
      { class: 'card', 'data-word': String(entry.id) },
      form(ENTRY_FIELDS, entry as unknown as Record<string, unknown>, (key, value, field) => replace(index, withValue({ ...at(index) }, key, value, field) as unknown as Entry, key === 'initial'), ctx),
      h('p', { class: 'muted' }, entry.initial ? 'Every player has it from the start.' : uses ? `Given by ${uses} action${uses === 1 ? '' : 's'}.` : 'No action gives this word yet: add an “Add a glossary word” action where players meet it.'),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(`the word “${entry.term ?? ''}”`) && write(read().filter((_, i) => i !== index), true) }, 'Delete')),
    );
  });

  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Glossary', help('The words this mission teaches, with what they mean. Players collect them as they play and can look them up at any time in the game’s side panel. Which words each student has collected is part of the teacher’s report.'))),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'primary', onclick: add }, 'New word'))),
    cards.length ? h('div', { class: 'grid' }, ...cards) : h('p', { class: 'empty' }, 'No words yet: players have no glossary.'),
  );
}

/**
 * Scene groups, on the Scenes page: scenes that belong together (a starship, a planet), with
 * one setting for the lot: whether players see everyone there or only their own team.
 */
export function sceneGroupsCard(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const read = () => (store.settings.scene_groups as Group[] | undefined) ?? [];
  const write = (list: Group[], structural: boolean) => void store.patchSettings({ scene_groups: list.length ? list : null }, structural);
  const at = (index: number): Group => read()[index] ?? { id: 0 };
  const add = () => write([...read(), { id: Math.max(0, ...read().map((g) => g.id)) + 1, name: 'New group' }], true);
  const remove = (group: Group) => {
    if (!confirmDelete(`the group “${group.name ?? ''}” (its scenes stay, in no group)`)) return;
    for (const scene of store.rows('scenes')) if (scene.group_id === group.id) void store.patch('scenes', scene.id, { group_id: null }, true);
    write(read().filter((g) => g.id !== group.id), true);
  };

  const rows = read().map((group, index) => {
    const scenes = store.rows('scenes').filter((s) => s.group_id === group.id).length;
    return h(
      'div',
      { class: 'card flat', 'data-group': group.id },
      form(GROUP_FIELDS, group as unknown as Record<string, unknown>, (key, value, field) => write(read().map((g, i) => (i === index ? (withValue({ ...at(index) }, key, value, field) as unknown as Group) : g)), key === 'team_only' || key === 'name'), ctx),
      h('div', { class: 'row-actions' }, h('span', { class: 'muted' }, `${scenes} scene${scenes === 1 ? '' : 's'}`), h('button', { type: 'button', class: 'danger', onclick: () => remove(group) }, 'Delete group')),
    );
  });
  return h(
    'div',
    { class: 'card', 'data-card': 'scene-groups' },
    h('div', { class: 'card-title' },
      h('h2', null, 'Scene groups', help('Put scenes that belong together into a group: the rooms of the starship, the places on one planet. A group can be limited to teams, so that players there see only their own team; an observation deck where everyone meets can stay open. Choose each scene’s group on its card below.')),
      h('button', { type: 'button', onclick: add }, 'New group')),
    rows.length ? h('div', { class: 'grid' }, ...rows) : h('p', { class: 'muted' }, 'No groups: in every scene players see everyone who is playing with them, unless the scene’s own settings say otherwise.'),
  );
}

/** What a scene's card says about who is seen there, and the control for its group. */
export function sceneGroupControl(ctx: FormContext, scene: { id: number; group_id?: unknown; params?: unknown }): HTMLElement {
  const { store } = ctx;
  const groups = (store.settings.scene_groups as Group[] | undefined) ?? [];
  const own = (scene.params as { team_only?: boolean | null } | null)?.team_only;
  const teamOnly = sceneTeamOnly({ scene_groups: groups.map((g) => ({ id: g.id, name: g.name ?? '', team_only: g.team_only })) }, { team_only: own, group_id: scene.group_id as number | undefined });
  const select = h('select', {
    'aria-label': 'Scene group',
    onchange: () => void store.patch('scenes', scene.id, { group_id: select.value === '' ? null : Number(select.value) }, true),
  }, h('option', { value: '' }, 'No group'), ...groups.map((g) => h('option', { value: String(g.id), selected: scene.group_id === g.id }, g.name ?? `Group ${g.id}`)));
  return h('div', { class: 'scene-group' },
    groups.length ? select : null,
    h('span', { class: `badge${teamOnly ? ' team' : ''}`, title: own != null ? 'Set on the scene itself' : 'From the scene’s group' }, teamOnly ? '🛡️ Own team only' : '👥 Everyone'));
}

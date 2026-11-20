import { sceneTeamOnly } from '@qbl/shared';
import { mediaUrl } from '../describe';
import { confirmDelete, h, help } from '../dom';
import { form, withValue, type Field, type FormContext } from '../fields';
import { emojiIcon } from '../icons';
import { closePanel, openPanel } from '../panel';
import { emptyState, groupTone, listPage, section, tileActions } from './kit';

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
  { key: 'team_only', label: '🛡️ Players see only their own team', kind: 'bool', hint: 'For when a teacher puts students into teams: a group limited to teams shows each player only their teammates. A scene can say otherwise for itself (in its own settings).' },
];

/**
 * The scenario's glossary: the words it teaches. Players see the ones they have in the game's
 * side panel. Each word is either there from the start or given by an action. The page shows
 * each word as players will read it; a word opens in a pop-up panel to change it.
 */
export function glossaryPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const list = readEntries(ctx);
  const add = () => {
    const ids = new Set(list.map((e) => String(e.id)));
    let n = list.length + 1;
    while (ids.has(`word-${n}`)) n++;
    const id = `word-${n}`;
    writeEntries(ctx, [...readEntries(ctx), { id, term: 'New word', definition: 'What it means.' }], true);
    openWord(ctx, id);
  };
  const newButton = () => h('button', { type: 'button', class: 'primary', onclick: add }, 'New word');
  const given = givenCounts(ctx);

  const cards = list.map((entry) => {
    const url = mediaUrl(store, store.byId('media', entry.media_id ?? null));
    const open = () => openWord(ctx, entry.id);
    const term = entry.term || 'Unnamed word';
    return h('div', { class: 'card tile word-card', 'data-word': String(entry.id), style: '--tone: var(--tone-word)' },
      h('button', { type: 'button', class: 'word-face', title: `Edit ${term}`, onclick: open },
        url ? h('img', { class: 'word-picture', src: url, alt: '' }) : h('span', { class: 'word-picture none', 'aria-hidden': 'true' }, term.slice(0, 1).toUpperCase()),
        h('span', { class: 'word-text' }, h('strong', { class: 'word-term' }, term), h('span', { class: 'word-definition' }, entry.definition || 'No meaning written yet.'))),
      h('div', { class: 'chips' }, wordStatus(entry, given.get(String(entry.id)) ?? 0)),
      tileActions(open, 'Edit', () => confirmDelete(`the word “${entry.term ?? ''}”`) && writeEntries(ctx, readEntries(ctx).filter((e) => e.id !== entry.id), true)));
  });

  return listPage(
    { title: 'Glossary', count: list.length, actions: [newButton()], about: 'The words this mission teaches, with what they mean. Players collect them as they play and can look them up at any time in the game’s side panel. Which words each student has collected is part of the teacher’s report. Click a word to change it.' },
    cards.length ? h('div', { class: 'grid tiles word-grid' }, ...cards) : emptyState('📖', 'No words yet: players have no glossary.', newButton()),
  );
}

const readEntries = (ctx: FormContext) => (ctx.store.settings.glossary as Entry[] | undefined) ?? [];
const writeEntries = (ctx: FormContext, list: Entry[], structural: boolean) => void ctx.store.patchSettings({ glossary: list.length ? list : null }, structural);

/** How many actions give each word, so an author can see a word nobody will ever get. */
function givenCounts(ctx: FormContext): Map<string, number> {
  const given = new Map<string, number>();
  for (const action of ctx.store.rows('actions')) {
    if (action.type !== 'glossary') continue;
    const id = String((action.params as { entry_id?: unknown } | null)?.entry_id ?? '');
    given.set(id, (given.get(id) ?? 0) + 1);
  }
  return given;
}

/** How players come to have the word, as a chip: from the start, from actions, or (a warning) from nothing. */
function wordStatus(entry: Entry, uses: number): HTMLElement {
  const [text, kind, icon] = entry.initial
    ? ['Every player has it from the start.', 'ok', '📘'] as const
    : uses ? [`Given by ${uses} action${uses === 1 ? '' : 's'}.`, 'ok', '🎁'] as const
    : ['No action gives this word yet: add an “Add a glossary word” action where players meet it.', 'warn', '⚠️'] as const;
  return h('span', { class: `chip ${kind} word-status`, title: text }, emojiIcon(icon), h('span', { class: 'chip-text' }, text));
}

/** One word in a pop-up: the word, its picture and meaning, and how players get it; beside it, how it looks to them. */
export function openWord(ctx: FormContext, id: string | number) {
  const { store } = ctx;
  const at = () => readEntries(ctx).find((e) => e.id === id);
  const replace = (entry: Entry, structural = false) => writeEntries(ctx, readEntries(ctx).map((e) => (e.id === id ? entry : e)), structural);
  openPanel({
    key: `word-${id}`,
    kind: 'word',
    store,
    size: 'medium',
    tone: 'var(--tone-word)',
    title: () => (at() ? h('span', null, at()!.term || 'Unnamed word') : null),
    body: () => {
      const entry = at();
      if (!entry) return null;
      const url = mediaUrl(store, store.byId('media', entry.media_id ?? null));
      const preview = h('div', { class: 'word-preview' },
        h('span', { class: 'word-preview-label' }, 'In the player’s glossary'),
        url ? h('img', { src: url, alt: '' }) : null,
        h('strong', null, entry.term || 'Unnamed word'),
        h('p', null, entry.definition || ''));
      return h('div', { class: 'two-panel word-panel' },
        section('📖 The word', 'var(--tone-word)', 'word',
          form(ENTRY_FIELDS, entry as unknown as Record<string, unknown>, (key, value, field) => replace(withValue({ ...at()! }, key, value, field) as unknown as Entry, true), ctx),
          h('div', { class: 'chips' }, wordStatus(entry, givenCounts(ctx).get(String(entry.id)) ?? 0)),
          h('div', { class: 'row-actions' }, h('button', {
            type: 'button', class: 'danger',
            onclick: () => {
              if (!confirmDelete(`the word “${entry.term ?? ''}”`)) return;
              closePanel(`word-${id}`);
              writeEntries(ctx, readEntries(ctx).filter((e) => e.id !== id), true);
            },
          }, 'Delete word'))),
        h('div', { class: 'panel-column' }, preview));
    },
  });
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
      { class: 'group-row', 'data-group': group.id, style: `--tone: ${groupTone(index)}` },
      h('span', { class: 'group-dot', 'aria-hidden': 'true' }),
      form(GROUP_FIELDS, group as unknown as Record<string, unknown>, (key, value, field) => write(read().map((g, i) => (i === index ? (withValue({ ...at(index) }, key, value, field) as unknown as Group) : g)), key === 'team_only' || key === 'name'), ctx),
      h('span', { class: 'chip' }, `${scenes} scene${scenes === 1 ? '' : 's'}`),
      h('button', { type: 'button', class: 'danger icon tile-delete', title: 'Delete group', 'aria-label': `Delete group ${group.name ?? ''}`, onclick: () => remove(group) }, '🗑'),
    );
  });
  return h(
    'div',
    { class: 'card groups-card', 'data-card': 'scene-groups' },
    h('div', { class: 'card-title' },
      h('h2', null, '🗂️ Scene groups', help('Put scenes that belong together into a group: the rooms of the starship, the places on one planet. A group can be limited to teams, so that players there see only their own team; an observation deck where everyone meets can stay open. Choose each scene’s group on its card below; a scene’s card takes its group’s colour.')),
      h('button', { type: 'button', onclick: add }, 'New group')),
    rows.length ? h('div', { class: 'group-rows' }, ...rows) : h('p', { class: 'muted small' }, 'No groups: in every scene players see everyone who is playing with them, unless the scene’s own settings say otherwise.'),
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
  const index = groups.findIndex((g) => g.id === scene.group_id);
  return h('div', { class: 'scene-group', style: index >= 0 ? `--tone: ${groupTone(index)}` : null },
    groups.length ? select : null,
    h('span', { class: `badge${teamOnly ? ' team' : ''}`, title: own != null ? 'Set on the scene itself' : 'From the scene’s group' }, teamOnly ? '🛡️ Own team only' : '👥 Everyone'));
}

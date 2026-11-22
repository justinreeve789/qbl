import { WANDER_PAUSE, WANDER_SPOTS } from '@qbl/shared';
import type { Row } from '../api';
import { CHARACTER_EVENT, eventLabel, params, sceneLabel } from '../describe';
import { fold, h, help, toast } from '../dom';
import { form, select, withValue, type Field, type FormContext, type Values } from '../fields';
import { openPanel } from '../panel';
import { eventPanel } from './eventPanel';
import { pickSpotInPopup } from './scene/spotPicker';

/**
 * A character lives in the world, not in a scene: it starts in one scene, at a spot, and goes
 * wherever walk actions send it (or wanders, if it walks around on its own). Everything players do
 * with it is in its own events, here on its panel: what clicking it runs, and events any scene's
 * "Run event" action can start (a treasure dug up elsewhere can have it say something about it).
 */

const SPEED_FIELD: Field = {
  key: 'walk_speed', label: 'Walking speed (pixels per second)', kind: 'number', min: 1, placeholder: 'As fast as players', slider: { min: 50, max: 1000, step: 10 },
  hint: 'How fast it walks, when a walk action does not say. Players walk at the scenario’s speed: 420 unless the Scenario page says otherwise.',
};

const ABOUT_WANDER = `It walks to ${WANDER_SPOTS.min} to ${WANDER_SPOTS.max} spots it can reach in the scene it is in, stopping ${WANDER_PAUSE.min / 1000} to ${WANDER_PAUSE.max / 1000} seconds between them, then leaves through a door with no conditions (a hotspot whose jump leads to another scene) and does the same there. A scene with no such door keeps it. Everyone playing together sees it in the same place. A walk action still sends it where the action says, and can stop it or set it off again. Things done to it from a scene’s events (a bubble line, an animation) may then find it gone: the checks point those out.`;

/** “Where it is”: the scene and spot it starts at, which way it faces, and whether it walks around on its own. */
export function whereItIs(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const settings = () => params(store.byId('characters', id) ?? row, 'settings');
  const write = (attrs: Values, structural = true) => {
    const next: Values = { ...settings(), ...attrs };
    for (const [k, v] of Object.entries(attrs)) if (v == null) delete next[k];
    return store.patch('characters', id, { settings: next }, structural);
  };
  const s = settings();
  const sceneId = typeof s.scene_id === 'number' ? s.scene_id : null;
  const scene = sceneId != null ? store.byId('scenes', sceneId) : undefined;
  const scenes = store.rows('scenes').slice().sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);

  /** A spot to stand on in a scene it has just been put in: the default spawn point, else low in the middle. */
  const firstSpot = (target: Row) => {
    const spawns = (params(target, 'layout').spawn_points as Array<{ name?: string; position_x: number; position_y: number }> | undefined) ?? [];
    const spawn = spawns.find((p) => p.name === 'default') ?? spawns[0];
    return spawn ? { x: spawn.position_x, y: spawn.position_y } : { x: Math.round(Number(target.width ?? 1920) / 2), y: Math.round(Number(target.height ?? 1080) * 0.8) };
  };
  const sceneMenu = select([['', 'No scene: nowhere to be seen'], ...scenes.map((sc) => [String(sc.id), sceneLabel(sc)] as const)], sceneId != null ? String(sceneId) : '', (v) => {
    if (!v) return void write({ scene_id: null, position_x: null, position_y: null });
    const target = store.byId('scenes', Number(v));
    if (!target) return;
    const at = firstSpot(target);
    void write({ scene_id: target.id, position_x: at.x, position_y: at.y });
  });
  sceneMenu.setAttribute('aria-label', 'Starts in scene');
  sceneMenu.dataset.start = String(id);

  const pick = h('button', {
    type: 'button', class: 'spot-pick', 'data-pick-start': id, disabled: scenes.length === 0,
    onclick: () => pickSpotInPopup(store, {
      prompt: `Click where ${row.name || 'the character'} stands at the start.`,
      at: typeof s.position_x === 'number' && typeof s.position_y === 'number' ? { x: s.position_x, y: s.position_y } : null,
      sceneId: sceneId ?? scenes[0]?.id,
      done: (at, chosen) => void write({ scene_id: chosen ?? sceneId ?? scenes[0]?.id ?? null, position_x: Math.round(at.x), position_y: Math.round(at.y) }),
    }),
  }, '📍 Pick the spot');
  const facing = select([['right', 'Facing right'], ['left', 'Facing left']], s.facing === 'left' ? 'left' : 'right', (v) => void write({ facing: v === 'left' ? 'left' : null }, false));
  facing.setAttribute('aria-label', 'Facing at the start');

  const roamsBox = h('input', { type: 'checkbox', checked: s.roams === true, onchange: () => void write({ roams: roamsBox.checked || null }) });
  const where = scene
    ? h('span', { class: 'coords muted' }, `at ${Math.round(Number(s.position_x ?? 0))}, ${Math.round(Number(s.position_y ?? 0))}`)
    : h('span', { class: 'muted' }, 'It is in no scene until one is chosen.');

  const title = `🗺️ Where it is: ${scene ? `starts in ${sceneLabel(scene)}` : 'in no scene'}${s.roams === true ? ', walks around on its own' : ''}`;
  return fold(`character-world-${id}`, title, true, h('div', { class: 'character-world', 'data-world': id },
    h('div', { class: 'form' },
      h('label', { class: 'field wide', 'data-field': 'scene_id' }, h('span', { class: 'field-label' }, 'Starts in', help('Characters live in the world, not in scenes: each is in one place at a time, the same for everyone playing together, and stays where walk actions take it (kept between visits too). This is where it is when a game starts. It is drawn there on the Scenes page, where it can be dragged.')), sceneMenu),
      h('div', { class: 'field wide start-row', 'data-field': 'position' }, pick, where, facing)),
    h('label', { class: 'field check wide', 'data-field': 'roams' }, roamsBox, h('span', null, 'Walks around on its own'), help(ABOUT_WANDER)),
    form([SPEED_FIELD], s, (key, value, field) => void write(withValue(settings(), key, value, field), false), ctx)));
}

/**
 * “Events”: the character's own events. Clicking the character runs the one chosen; any scene's
 * Run event action can start the others. They run in whichever scene the player is in.
 */
export function characterEvents(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const settings = () => params(store.byId('characters', id) ?? row, 'settings');
  const clickId = typeof settings().event_id === 'number' ? (settings().event_id as number) : null;
  const events = store.where('events', 'character_id', id).sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);
  const setClick = (eventId: number | null) => {
    const next = { ...settings() };
    if (eventId == null) delete next.event_id;
    else next.event_id = eventId;
    return store.patch('characters', id, { settings: next }, true);
  };

  // An event of a scene, from before characters had their own: still offered, marked as the scene's.
  const legacy = clickId != null && !events.some((e) => e.id === clickId) ? store.byId('events', clickId) : undefined;
  const clickMenu = select(
    [['', 'Nothing'], ...events.map((e) => [String(e.id), eventLabel(e)] as const), ...(legacy ? [[String(legacy.id), `${eventLabel(legacy)} (an event of ${sceneLabel(store.byId('scenes', legacy.scene_id as number))})`] as const] : [])],
    clickId != null ? String(clickId) : '',
    (v) => void setClick(v ? Number(v) : null),
  );
  clickMenu.setAttribute('aria-label', 'When clicked, run');

  const add = async () => {
    const row2 = await store.add('events', { character_id: id, kind: 'character', shortname: events.length ? `event-${events.length + 1}` : 'talk', audience: 'player' });
    if (!row2) return;
    if (clickId == null && events.length === 0) await setClick(row2.id);
    openCharacterEvent(ctx, id, row2.id);
  };

  const rows = events.map((e) => {
    const actions = store.where('actions', 'event_id', e.id).length;
    return h('div', { class: 'event-row', 'data-character-event': e.id },
      h('strong', null, eventLabel(e)),
      h('span', { class: 'muted' }, `${actions} action${actions === 1 ? '' : 's'}`, e.id === clickId ? h('span', { class: 'clicked' }, ' · 👆 runs when clicked') : null),
      h('button', { type: 'button', 'data-open': 'character-event', onclick: () => openCharacterEvent(ctx, id, e.id) }, '✏️ Edit'));
  });
  return fold(`character-events-${id}`, `💬 Events (${events.length})`, true, h('div', { class: 'character-events', 'data-events': id },
    h('label', { class: 'field wide', 'data-field': 'event_id' }, h('span', { class: 'field-label' }, 'When clicked, run', help('What happens when a player clicks the character: one of its events below. It runs wherever the character is.')), clickMenu),
    legacy ? h('p', { class: 'issue warning' }, `Clicking runs an event of the scene “${sceneLabel(store.byId('scenes', legacy.scene_id as number))}”, which runs only when the player is there. Make it one of the character’s own events if it can be clicked elsewhere.`) : null,
    rows.length ? h('div', null, ...rows) : h('p', { class: 'muted' }, 'No events yet. Add one for what happens when it is clicked, or for a scene to run with “Run event”.'),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'primary', 'data-add': 'character-event', onclick: () => void add() }, '+ New event'),
      help('A character’s own event runs in the player’s scene, wherever the character is. Start one from any scene with a “Run event” action: digging up a treasure can have the character say something. A line it says in a bubble is shown in a story box when the character is not in the player’s scene.'))));
}

/** One of a character's events, in a panel of its own over the character's: its settings, conditions and actions. */
export function openCharacterEvent(ctx: FormContext, characterId: number, eventId: number) {
  const { store } = ctx;
  const evCtx: FormContext = { store, characterId };
  // What the cards say about their actions (summaries, warnings) follows changes that do not redraw the panel.
  let refresh: Array<() => void> = [];
  const stop = store.onChange((structural) => {
    if (!structural) for (const update of refresh) update();
  });
  const panel = openPanel({
    key: `character-event-${eventId}`,
    kind: 'character-event',
    store,
    tone: 'var(--tone-character)',
    title: () => {
      const character = store.byId('characters', characterId);
      const event = store.byId('events', eventId);
      return character && event ? h('span', null, h('span', { class: 'muted' }, `${character.name} · `), eventLabel(event)) : null;
    },
    body: () => {
      const event = store.byId('events', eventId);
      refresh = [];
      return event ? eventPanel(evCtx, event, refresh, () => panel.close()) : null;
    },
  });
  panel.dialog.addEventListener('close', stop);
  if (!store.byId('events', eventId)) toast(`That ${CHARACTER_EVENT.toLowerCase()} is gone.`, 'error');
}

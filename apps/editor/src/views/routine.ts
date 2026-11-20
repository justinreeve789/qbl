import { emojiIcon } from '../icons';
import { characterRoams, normalizeRoutine, ROUTINE_STEP_TYPES, startPlacement, type Routine, type RoutineStep, type RoutineStepType, type Scenario } from '@qbl/shared';
import type { Row } from '../api';
import { actionSummary, params, sceneLabel, walkDestination } from '../describe';
import { fold, h, help } from '../dom';
import { form, select, tidyAnimate, withValue, type Field, type FormContext, type Values } from '../fields';
import { ACTION_LOOK, ACTIONS, tidyWalk, WALK_FIELDS } from '../schema';
import { inlineConditions, type ConditionValue } from './conditions';
import { pickSpotInPopup } from './scene/spotPicker';

/** Which routine steps are open, by character and step. Kept outside the view so a redraw does not close them. */
const open = new Set<string>();

const STEP_LABELS: Record<RoutineStepType, string> = {
  walk: 'Walk somewhere',
  wait: 'Wait',
  dialogue: 'Say something',
  animate: 'Play an animation',
  variable: 'Change a shared variable',
};

/** The fields of each kind of step: those of the action it is, less who does it (the character itself). */
const STEP_FIELDS: Record<RoutineStepType, Field[]> = {
  walk: WALK_FIELDS,
  wait: ACTIONS.wait.fields,
  dialogue: ACTIONS.dialogue.fields.filter((f) => !['style', 'speaker', 'character_id'].includes(f.key)),
  animate: ACTIONS.animate.fields.filter((f) => f.key === 'animation'),
  variable: ACTIONS.variable.fields,
};

const STEP_DEFAULTS: Record<RoutineStepType, Values> = {
  walk: { to: 'point', position_x: 400, position_y: 400 },
  wait: { duration: 2000 },
  dialogue: { text: 'Hello there!' },
  animate: { animation: 'wave' },
  variable: { operator: '+', operand: 1 },
};

const SPEED_FIELD: Field = {
  key: 'walk_speed', label: 'Walking speed (pixels per second)', kind: 'number', min: 1, placeholder: 'As fast as players', slider: { min: 50, max: 1000, step: 10 },
  hint: 'How fast it walks when a walk does not say. Players walk at the scenario’s speed: 420 unless the Scenario page says otherwise.',
};

/** One line saying what a step does. */
function stepSummary(ctx: FormContext, step: RoutineStep): string {
  const v = step as unknown as Values;
  switch (step.type) {
    case 'walk': return `Walk ${walkDestination(ctx.store, v)}`;
    case 'dialogue': return `Say: ${String(v.text ?? '').slice(0, 60) || '(nothing)'}`;
    case 'animate': return v.animation ? `Play ${String(v.animation)}` : 'Stop animating';
    default: return actionSummary(ctx.store, step.type, v);
  }
}

/** The character's routine as stored, or an empty one. */
function routineOf(row: Row | undefined): Routine {
  const raw = row ? params(row, 'settings').routine : undefined;
  const r = raw && typeof raw === 'object' ? (raw as Partial<Routine>) : {};
  return { steps: Array.isArray(r.steps) ? r.steps : [], loop: r.loop !== false, conditions: Array.isArray(r.conditions) ? r.conditions : [] };
}

/**
 * “Getting around”, on a character's card: whether it walks around the world on its own, how fast,
 * and its routine, the steps it repeats by itself. A character that roams lives in the world: the
 * game server keeps it, so every player sees it in the same place, walk actions can send it to
 * other scenes and it stays where it went.
 */
export function gettingAround(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const settings = () => params(store.byId('characters', id) ?? row, 'settings');
  const write = (attrs: Values, structural = true) => void store.patch('characters', id, { settings: { ...settings(), ...attrs } }, structural);
  const routine = routineOf(row);
  const writeRoutine = (next: Routine, structural = true) => {
    const kept = next.steps.length || next.conditions?.length || next.loop === false ? next : null;
    write({ routine: kept }, structural);
  };
  const steps = () => routineOf(store.byId('characters', id) ?? row).steps;
  const roams = characterRoams({ roams: settings().roams === true, routine: normalizeRoutine(routine) });

  const roamsBox = h('input', {
    type: 'checkbox', checked: roams, disabled: routine.steps.length > 0,
    onchange: () => write({ roams: roamsBox.checked || null }),
  });
  const parts: Array<Node | null> = [
    h('label', { class: 'field check wide', 'data-field': 'roams' }, roamsBox, h('span', null, 'Walks around on its own'),
      help('There is then one of this character for everyone playing together: the game server keeps it, so all players see it in the same place, walk actions can send it to other scenes, and it stays where it went (kept between visits too). It starts at its first placement, taking the scenes in order; placing it in other scenes says what clicking it does there. A character with a routine always walks around on its own.')),
  ];
  if (roams) {
    parts.push(form([SPEED_FIELD], settings(), (key, value, field) => write(withValue(settings(), key, value, field), false), ctx));
    parts.push(startsAt(ctx, id));
    parts.push(routineEditor(ctx, id, routine, steps, writeRoutine));
  } else {
    parts.push(h('p', { class: 'muted' }, 'It stands where it is placed in each scene. Walk actions can still walk it around a scene, on each player’s own screen.'));
  }
  const title = roams ? `🗺️ Getting around: ${routine.steps.length ? `a routine of ${routine.steps.length} step${routine.steps.length === 1 ? '' : 's'}` : 'walks on its own'}` : '🗺️ Getting around';
  return fold(`character-routine-${id}`, title, roams, h('div', { class: 'routine', 'data-routine': id }, ...parts));
}

/** The scene a roaming character starts in: that of its first placement, taking the scenes in order. */
function startScene(ctx: FormContext, characterId: number): number | undefined {
  const scenes = ctx.store.rows('scenes')
    .slice()
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id)
    .map((s) => ({ id: s.id, characters: (params(s, 'layout').characters as Array<{ character_id: number }> | undefined) ?? [] }));
  return startPlacement({ scenes } as unknown as Pick<Scenario, 'scenes'>, characterId)?.scene.id as number | undefined;
}

/** Where the character starts: its first placement. */
function startsAt(ctx: FormContext, characterId: number): HTMLElement {
  const start = startScene(ctx, characterId);
  if (start == null) return h('p', { class: 'issue warning' }, 'Place it in a scene (on the Scenes page) to give it somewhere to start.');
  return h('p', { class: 'muted' }, `Starts in ${sceneLabel(ctx.store.byId('scenes', start))}, where it is placed.`);
}

function routineEditor(ctx: FormContext, id: number, routine: Routine, steps: () => RoutineStep[], write: (next: Routine, structural?: boolean) => void): HTMLElement {
  const now = () => ({ ...routineOf(ctx.store.byId('characters', id)) });
  const setSteps = (list: RoutineStep[], structural = true) => write({ ...now(), steps: list }, structural);
  const replace = (index: number, step: RoutineStep, structural = false) => setSteps(steps().map((s, i) => (i === index ? step : s)), structural);
  const move = (index: number, by: number) => {
    const list = steps().slice();
    const [step] = list.splice(index, 1);
    if (!step) return;
    list.splice(Math.max(0, Math.min(list.length, index + by)), 0, step);
    open.clear();
    setSteps(list);
  };

  const add = select(ROUTINE_STEP_TYPES.map((t) => [t, `${ACTION_LOOK[t][0]} ${STEP_LABELS[t]}`] as const), '', (type) => {
    add.value = '';
    if (!type) return;
    const list = steps();
    open.add(`${id}:${list.length}`);
    // A new animation step starts with one of the character's own animations.
    const values = { type, ...STEP_DEFAULTS[type as RoutineStepType] };
    setSteps([...list, (type === 'animate' ? tidyAnimate(values, { ...ctx, characterId: id }) : values) as RoutineStep]);
  }, '+ Add step…');
  add.classList.add('add-action');

  // The scene each step most likely happens in: where it starts, then wherever a walk to another
  // scene took it. A spot picked for a walk is shown on that scene first.
  let scene = startScene(ctx, id);
  const sceneAt = routine.steps.map((step) => {
    const here = scene;
    const v = step as unknown as Values;
    if (step.type === 'walk' && v.to === 'scene' && typeof v.scene_id === 'number') scene = v.scene_id;
    return here;
  });

  const cards = routine.steps.map((step, index) => {
    const key = `${id}:${index}`;
    const type = step.type;
    const values = step as unknown as Values;
    const stepCtx: FormContext = { ...ctx, characterId: id, spotScene: sceneAt[index], pickSpot: (request) => pickSpotInPopup(ctx.store, request) };
    const commit = (k: string, value: unknown, field: Field) => {
      let bag = withValue({ ...(steps()[index] as unknown as Values) }, k, value, field);
      if (type === 'walk' && k === 'to') bag = tidyWalk(bag);
      const next = bag as unknown as RoutineStep;
      replace(index, { ...next, type } as RoutineStep, field.structural === true);
    };
    const body = h(
      'div',
      { class: 'card-body' },
      form(STEP_FIELDS[type] ?? [], values, commit, stepCtx),
      form([{ key: 'blocking', label: 'Wait for this to finish before the next step', kind: 'bool', default: true, wide: true }], values, commit, ctx),
      inlineConditions(
        ctx,
        () => (steps()[index]?.conditions as ConditionValue[] | undefined),
        (list, structural) => replace(index, withValue({ ...(steps()[index] as unknown as Values) }, 'conditions', list.length ? list : null) as unknown as RoutineStep, structural),
        'Only when',
        'Always.',
      ),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', disabled: index === 0, title: 'Move up', 'aria-label': 'Move step up', onclick: () => move(index, -1) }, '↑'),
        h('button', { type: 'button', disabled: index === routine.steps.length - 1, title: 'Move down', 'aria-label': 'Move step down', onclick: () => move(index, 1) }, '↓'),
        h('button', { type: 'button', class: 'danger', onclick: () => {
          open.clear();
          setSteps(steps().filter((_, i) => i !== index));
        } }, 'Remove step')),
    );
    const card = h('details', { class: 'card action routine-step', 'data-step': index, open: open.has(key), style: `--tone:${ACTION_LOOK[type][1]}` },
      h('summary', null, h('span', { class: 'step' }, index + 1), h('span', { class: 'tag' }, emojiIcon(ACTION_LOOK[type][0]), ` ${STEP_LABELS[type]}`), h('span', { class: 'summary-text' }, stepSummary(ctx, step))),
      body);
    card.addEventListener('toggle', () => (card.open ? open.add(key) : open.delete(key)));
    return card;
  });

  const loop = h('input', { type: 'checkbox', checked: routine.loop !== false, onchange: () => write({ ...now(), loop: loop.checked }, false) });
  return h(
    'section',
    { class: 'actions routine-steps' },
    h('div', { class: 'sub-head' }, h('span', null, 'Routine', help('What it does on its own, one step after another, for everyone at once, whether or not anyone is watching. A player’s walk action comes first: the routine waits for it, then carries on. Only shared variables (marked “shared by everyone”) mean anything here, in conditions and in changes, because the routine is nobody’s in particular.')), add),
    cards.length ? h('div', null, ...cards) : h('p', { class: 'muted' }, 'No routine: it stays where it is until a walk action sends it somewhere.'),
    cards.length ? h('label', { class: 'field check wide', 'data-field': 'loop' }, loop, h('span', null, 'Start again after the last step')) : null,
    cards.length
      ? inlineConditions(ctx, () => now().conditions as ConditionValue[] | undefined, (list, structural) => write({ ...now(), conditions: list as Routine['conditions'] }, structural), 'Keeps to its routine only when', 'Always. Stop it (to talk to it, say) with a condition on a shared variable.')
      : null,
  );
}


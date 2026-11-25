import { ApiError, type SceneGenerationForm } from '../api';
import { h, help, toast } from '../dom';
import type { FormContext } from '../fields';
import { tracker } from '../generations';
import { emojiIcon } from '../icons';

/**
 * "Generate a scene": the AI generator makes ONE scene for the scenario being edited, rather than a
 * whole mission (App\Qbl\Generation\Methods\SceneMethod on the server). The teacher describes the
 * place; it is planned, painted to match the scenario's own scenes, and looked over: the floor is
 * traced right up to whatever stops a person, the things standing on it are cut out of the picture
 * and put back exactly where they were (with their sort lines, so players walk behind them), and,
 * if asked for, things to click are described by the narrator, lights glow, the sky moves and
 * critters come and go. It takes a few minutes on the server's queue, like a mission, and the header's
 * ✨ chip follows it. When it is made, the workspace takes it in (Store.takeIn) as one step that
 * Ctrl+Z undoes.
 */

const PLACES: Array<[string, string]> = [['outdoor', 'Outdoors'], ['indoor', 'Indoors'], ['underground', 'Underground (a cave, a cellar)'], ['up_high', 'High up (a rooftop, a treetop)'], ['underwater', 'Underwater']];
const TIMES: Array<[string, string]> = [['dawn', 'Dawn'], ['morning', 'Morning'], ['midday', 'Midday'], ['afternoon', 'Afternoon'], ['golden', 'Golden hour'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night']];
const REPEATS: Array<[string, string]> = [['last', 'Step through them, then keep saying the last'], ['cycle', 'Go round them again']];

/** The button that opens the dialog, for the Scenes page and the scene map's toolbar. */
export function generateSceneButton(ctx: FormContext, compact = false): HTMLButtonElement {
  return h('button', {
    type: 'button', 'data-action': 'generate-scene',
    title: 'Describe a place and AI paints it, cuts out what stands in it so players walk around it, traces where they can walk, and adds things to click',
    onclick: () => void generateSceneDialog(ctx),
  }, emojiIcon('✨'), compact ? 'Generate' : 'Generate a scene');
}

const choose = (name: string, options: Array<[string, string]>, first = 'Choose for me') =>
  h('select', { name }, h('option', { value: '' }, first), ...options.map(([value, label]) => h('option', { value }, label)));

export async function generateSceneDialog(ctx: FormContext): Promise<void> {
  const { store } = ctx;
  const prompt = h('textarea', {
    name: 'prompt', rows: 4, required: true, maxlength: 2000,
    placeholder: 'A busy harbour at dawn: fishing boats, stacks of crates, a lighthouse, gulls. Something about how the tides work to discover.',
  });
  const place = choose('kind_of_place', PLACES);
  const time = choose('time', TIMES);
  const width = h('select', { name: 'width', title: 'Normal: a little wider than the screen. Wide: about one and a half screens, a long place the view follows the player along.' },
    h('option', { value: '' }, 'Normal'), h('option', { value: 'wide' }, 'Wide (the view follows)'));
  const hotspots = h('input', { type: 'checkbox', name: 'hotspots', checked: true });
  const repeat = choose('repeat', REPEATS, 'Choose for me, thing by thing');
  const animations = h('input', { type: 'checkbox', name: 'animations', checked: true });
  const critters = h('input', { type: 'checkbox', name: 'critters' });
  const grade = h('input', { type: 'text', name: 'grade', maxlength: 8, placeholder: 'e.g. 4 or 6-8', autocomplete: 'off' });
  const notes = h('textarea', { name: 'notes', rows: 2, maxlength: 1000, placeholder: 'Anything else: what to put in it, what to leave out, the facts the descriptions should teach.' });
  const cost = h('p', { class: 'muted', 'data-cost': '' }, 'Checking your credits…');
  const error = h('p', { class: 'issue error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'primary' }, '✨ Generate');
  const repeatField = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Clicked again',
    help('When something has several descriptions (a first look, a closer look, what it means), each click tells the next. Then it can keep telling the last one, or go round them again. A variable of the scene counts each player’s clicks.')), repeat);
  hotspots.addEventListener('change', () => {
    repeat.disabled = !hotspots.checked;
    repeatField.classList.toggle('disabled', !hotspots.checked);
  });

  const form = h('form', { method: 'dialog', class: 'gen-scene-form' },
    h('h2', null, '✨ Generate a scene'),
    h('p', { class: 'muted' }, 'Describe a place and AI paints it to match your other scenes. Things standing in it are cut out so players can walk behind and in front of them, the floor is traced so they walk only where they could, and it is added to your scenes. It takes a few minutes: you can carry on working.'),
    h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'What is the place?'), prompt),
    h('div', { class: 'gen-scene-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind of place'), place),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Time of day'), time),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), width)),
    h('fieldset', { class: 'gen-scene-extras' },
      h('legend', null, 'What to add'),
      h('label', { class: 'inline' }, hotspots, 'Things to click, described by the narrator',
        help('Things painted in the picture (a poster, an old map, tracks in the mud) and things standing in it get an invisible hotspot. Clicking one, the narrator says what is there, and a closer look on the next click.')),
      repeatField,
      h('label', { class: 'inline' }, animations, 'Lights and movement',
        help('Lamps, lanterns and campfires glow and flicker, a living sky with drifting clouds (outdoors), leaves or fireflies in the air, water that flows.')),
      h('label', { class: 'inline' }, critters, 'Critters that come and go',
        help('Now and then birds land and peck about, a squirrel runs up a tree, a rabbit hops between bushes or a deer walks by. They scatter when someone comes near. Each player sees their own.'))),
    h('div', { class: 'gen-scene-row' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Grade (optional)'), grade),
      h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Notes (optional)'), notes)),
    cost,
    error,
    h('div', { class: 'row-actions' }, submit, h('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel')),
  );
  const dialog = h('dialog', { class: 'modal', 'data-dialog': 'generate-scene' }, form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  prompt.focus();

  // What it costs, and whether it can be made now.
  let ready = false;
  try {
    const data = await ctx.store.api.generations();
    const price = data.costs?.scene ?? 0;
    const credits = data.plan.credits;
    if (!data.plan.generator) {
      cost.replaceChildren('The AI generator comes with Teacher Plus. ', h('a', { href: '#/plan' }, 'See your plan'), '.');
    } else if (tracker.active) {
      cost.textContent = 'The generator is busy making something else for you. Start this when it is done (the ✨ chip at the top shows how it is going).';
    } else if (credits?.enforced && credits.balance < price) {
      cost.textContent = `A scene costs ${price} credits and you have ${credits.balance}. More arrive with your plan’s next month.`;
    } else {
      ready = true;
      cost.textContent = credits?.enforced
        ? `Costs ${price} credit${price === 1 ? '' : 's'}: you have ${credits.balance}. If it cannot be made, or you stop it, they come back.`
        : 'If it cannot be made, you can stop it at any time from the ✨ chip at the top.';
    }
  } catch (err) {
    cost.textContent = err instanceof ApiError && (err.status === 401 || err.status === 403) ? 'The generator is for teachers.' : 'Could not reach the generator. Check your connection.';
  }
  submit.disabled = !ready;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ready) return;
    const text = prompt.value.trim();
    if (text.length < 8) {
      error.textContent = 'Say what the scene shows in a sentence or two.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    const body: SceneGenerationForm = {
      kind: 'scene', scenario_id: store.scenarioId, prompt: text,
      hotspots: hotspots.checked, animations: animations.checked, critters: critters.checked,
      ...(place.value ? { kind_of_place: place.value } : {}),
      ...(time.value ? { time: time.value } : {}),
      ...(width.value === 'wide' ? { width: 'wide' as const } : {}),
      ...(hotspots.checked && repeat.value ? { repeat: repeat.value as 'last' | 'cycle' } : {}),
      ...(grade.value.trim() ? { grade: grade.value.trim() } : {}),
      ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
    };
    try {
      const { generation, now } = await store.api.generate(body);
      tracker.kick(generation, now);
      dialog.close();
      toast('Generating the scene. It is added to your scenes when it is ready: carry on meanwhile.');
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Could not start it. Check your connection.';
      error.hidden = false;
      submit.disabled = false;
    }
  });
}


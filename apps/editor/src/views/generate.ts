import { ApiError, type Api, type CreditSummary, type Generation } from '../api';
import { config } from '../config';
import { clear, h, help, toast } from '../dom';

/** What a run is doing, for the teacher. */
export const STEPS: Record<string, string> = {
  queued: 'Waiting to start',
  aligning: 'Choosing the curriculum standards',
  designing: 'Designing the story, scenes and questions',
  drawing: 'Drawing the pictures (the longest part)',
  building: 'Building the scenes and events',
  done: 'Ready',
  failed: 'Could not be made',
};

/**
 * The AI mission generator: the teacher describes a mission, it is made on the server in a few
 * minutes (the page keeps asking how it is going), and lands as a private draft in their
 * scenarios. It costs credits, given back if it fails.
 */
export function generateView(api: Api, open: (scenarioId: number) => void): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  let timer = 0;
  let alive = true;

  const load = async () => {
    window.clearTimeout(timer);
    if (!alive) return;
    try {
      const { generations, cost, plan } = await api.generations();
      draw(generations, cost, plan);
      // While one is being made, look again every few seconds.
      if (generations.some((g) => g.busy)) timer = window.setTimeout(() => void load(), 5000);
    } catch (err) {
      clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the generator.'));
    }
  };

  const form = (cost: number, credits: CreditSummary | null, busy: boolean) => {
    const prompt = h('textarea', { rows: 4, maxlength: 2000, required: true, name: 'prompt', placeholder: 'A mystery in a rainforest research station where students work out how plants need light, water and air to grow. Grade 4, about 30 minutes.' });
    const grade = h('input', { type: 'text', name: 'grade', maxlength: 8, placeholder: 'e.g. 4 or 6-8' });
    const subject = h('input', { type: 'text', name: 'subject', maxlength: 60, placeholder: 'e.g. Science' });
    const min = h('input', { type: 'number', name: 'min_players', min: 1, max: 8, value: 2 });
    const max = h('input', { type: 'number', name: 'max_players', min: 1, max: 8, value: 4 });
    const minutes = h('input', { type: 'number', name: 'minutes', min: 5, max: 120, placeholder: '30' });
    const notes = h('input', { type: 'text', name: 'notes', maxlength: 1000, placeholder: 'Anything else: vocabulary to use, a twist, what to avoid' });
    const short = credits?.enforced && credits.balance < cost;
    const submit = h('button', { type: 'submit', class: 'primary', disabled: busy || short }, `✨ Generate (${cost} credits)`);
    const node = h('form', { class: 'card generate-form', 'data-form': 'generate' },
      h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'What is the mission about?', help('The topic, what students should learn, the setting. The generator aligns it to standards, writes the story and questions, and draws every scene and character.')), prompt),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Grade'), grade),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Subject'), subject),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fewest players'), min),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Most players'), max),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Minutes'), minutes)),
      h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Notes (optional)'), notes),
      h('div', { class: 'row-actions' }, submit,
        credits?.enforced ? h('span', { class: short ? 'issue error' : 'muted', 'data-credits': credits.balance }, `You have ${credits.balance} credits.`) : null,
        busy ? h('span', { class: 'muted' }, 'One mission at a time: this one starts when yours is done.') : null),
    );
    node.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await api.generate({
          prompt: prompt.value.trim(), grade: grade.value.trim() || undefined, subject: subject.value.trim() || undefined,
          min_players: Number(min.value) || undefined, max_players: Number(max.value) || undefined, minutes: Number(minutes.value) || undefined, notes: notes.value.trim() || undefined,
        });
        toast('Started. It takes a few minutes; you can leave this page and come back.');
        await load();
      } catch (err) {
        submit.disabled = false;
        toast(err instanceof ApiError || err instanceof Error ? err.message : 'Could not start.', 'error');
      }
    });
    return node;
  };

  const runCard = (g: Generation) => h('div', { class: `card generation ${g.status}`, 'data-generation': g.id, 'data-status': g.status },
    h('div', { class: 'card-title' }, h('strong', null, g.title ?? (g.prompt.length > 90 ? `${g.prompt.slice(0, 90)}…` : g.prompt)),
      h('span', { class: `badge ${g.status === 'failed' ? 'late' : ''}` }, STEPS[g.status] ?? g.status)),
    g.title ? h('p', { class: 'muted' }, g.prompt) : null,
    g.busy ? h('div', { class: 'progress', role: 'progressbar', 'aria-label': STEPS[g.status] ?? g.status }, h('span', { style: `width: ${progress(g.status)}%` })) : null,
    g.status === 'failed' ? h('p', { class: 'issue error' }, g.error ?? 'Something went wrong.', ' Your credits were given back.') : null,
    g.scenario_id ? h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'primary', onclick: () => open(g.scenario_id!) }, 'Open in the editor'),
      h('span', { class: 'muted' }, 'A private draft: look it over, then publish and assign it.')) : null,
  );

  const draw = (runs: Generation[], cost: number, plan: { generator: boolean; plan_name: string; credits: CreditSummary | null }) => {
    clear(
      body,
      plan.generator
        ? form(cost, plan.credits, runs.some((g) => g.busy))
        : h('div', { class: 'card', 'data-card': 'upsell' },
            h('h2', null, 'The generator comes with Teacher Plus'),
            h('p', null, `You are on ${plan.plan_name}. Teacher Plus adds the AI mission generator, with credits every month, to every curricular mission.`),
            h('div', { class: 'row-actions' }, h('a', { class: 'button primary', href: `${config.gameUrl}plans` }, 'See the plans'))),
      runs.length ? h('h2', null, 'Your generated missions') : null,
      ...runs.map(runCard),
    );
  };

  void load();
  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, '✨ Generate a mission'),
      h('p', { class: 'muted' }, 'Describe a mission and it is written, aligned to standards and drawn for you, as a draft to review.'))),
    body);
  // Stop asking once the page is gone.
  window.addEventListener('hashchange', () => {
    alive = false;
    window.clearTimeout(timer);
  }, { once: true });
  return page;
}

function progress(status: string): number {
  return { queued: 5, aligning: 15, designing: 35, drawing: 65, building: 90 }[status] ?? 100;
}

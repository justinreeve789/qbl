import { ApiError, type Api, type CreditSummary, type Generation, type GenerationOptions, type GeneratorPlan } from '../api';
import { config } from '../config';
import { clear, h, help, toast } from '../dom';
import { duration, progressBar, runName, STAGE_NAMES, stageSteps, timeLeft, tracker } from '../generations';
import { session } from '../session';

/** What a run is doing, for the teacher (kept for older callers; STAGE_NAMES has the rest). */
export const STEPS: Record<string, string> = Object.fromEntries(Object.entries(STAGE_NAMES).map(([k, v]) => [k, v.long]));

const EXAMPLES = [
  { label: 'Rainforest plant mystery', text: 'A mystery in a rainforest research station: students work out what plants need to grow (light, water, air). Grade 4.' },
  { label: 'The water cycle as a raindrop', text: 'A trip through the water cycle as a raindrop, from the ocean to a cloud and back down a mountain stream. Grade 5 science.' },
  { label: 'Ratios at a space market', text: 'Students run a space colony’s market and use ratios to trade fairly between three planets. Grade 6 math.' },
];

/** A description (and options) to start the page with, from the Scenarios page's "Generate it with AI". */
let prefill: ({ prompt: string } & GenerationOptions) | null = null;
export function prefillGenerator(prompt: string, options: GenerationOptions = {}) {
  prefill = { prompt, ...options };
}

const failMessage = (err: unknown, fallback: string) => (err instanceof ApiError || err instanceof Error ? err.message : fallback);

/**
 * The AI mission generator: the teacher describes a mission, it is made on the server's queue in
 * about ten minutes, and lands as a private draft in their scenarios. Who sees what:
 *
 *   - a teacher whose plan has the generator (Teacher Plus, a school license with it), an
 *     administrator, or anyone when billing is off: the form, and their runs;
 *   - a teacher without it: what the generator is and where to get it;
 *   - administrators also: everyone's runs, with what each spent on AI services.
 *
 * Each mission costs credits (taken when it starts, given back if it fails or is cancelled). While
 * one is being made its card shows the stages, a live progress bar and the time left; the teacher
 * can leave the page (the header's chip follows it) or cancel it.
 */
export function generateView(api: Api, open: (scenarioId: number) => void): HTMLElement {
  const admin = session.role === 'admin';
  const credit = h('div', { class: 'gen-credits', 'data-credits': '' });
  const live = h('div', { 'data-section': 'live' });
  const formHost = h('div', { 'data-section': 'form' }, h('p', { class: 'muted' }, 'Loading…'));
  const history = h('div', { 'data-section': 'history' });
  const everyone = h('div', { 'data-section': 'everyone' });

  let cost = 10;
  let plan: GeneratorPlan | null = null;
  let credits: CreditSummary | null = null;
  let form: ReturnType<typeof buildForm> | null = null;
  let liveCard: ReturnType<typeof liveRun> | null = null;

  const load = async () => {
    try {
      const data = await api.generations();
      cost = data.cost;
      plan = data.plan;
      credits = data.plan.credits;
      if (!form && plan.generator) {
        form = buildForm(start);
        clear(formHost, form.node);
      } else if (!plan.generator) {
        clear(formHost, upsell(plan));
      }
      drawCredits();
      drawHistory(data.generations.filter((g) => !g.busy));
      const busy = data.generations.find((g) => g.busy) ?? null;
      showLive(busy);
      // Follow it from here on, wherever the teacher goes.
      if (busy && tracker.active?.id !== busy.id) tracker.kick(busy, data.now);
      if (admin) void loadEveryone();
    } catch (err) {
      clear(formHost, h('p', { class: 'issue error' }, failMessage(err, 'Could not load the generator.')));
    }
  };

  const drawCredits = () => {
    const busy = !!tracker.active;
    if (!plan) return clear(credit);
    if (!plan.generator) return clear(credit, h('a', { class: 'gen-credit-pill muted', href: '#/plan' }, plan.plan_name));
    if (!credits?.enforced) {
      clear(credit, h('span', { class: 'gen-credit-pill', title: 'Generating costs no credits here' }, '♾️ ', plan.source === 'admin' ? 'No credits needed (administrator)' : 'No credits needed'));
    } else {
      clear(credit, h('a', { class: `gen-credit-pill${credits.balance < cost ? ' short' : ''}`, href: '#/plan', title: 'Your plan and credit history', 'data-balance': credits.balance },
        '🪙 ', h('strong', null, String(credits.balance)), ` credit${credits.balance === 1 ? '' : 's'}`),
      h('span', { class: 'muted gen-credit-note' }, `${cost} per mission`));
    }
    form?.update(cost, credits, busy);
  };

  const start = async (body: { prompt: string } & GenerationOptions) => {
    const { generation, credits: after, now } = await api.generate(body);
    credits = after;
    tracker.kick(generation, now);
    drawCredits();
    toast('Started. It takes about ten minutes: carry on working, and the ✨ at the top shows how it is going.');
  };

  const cancel = async (g: Generation) => {
    const back = credits?.enforced ? ` Your ${cost} credits are given back.` : '';
    if (!window.confirm(`Stop making “${runName(g, 60)}”?${back}`)) return;
    try {
      const { generation, credits: after, now } = await api.cancelGeneration(g.id);
      credits = after ?? credits;
      tracker.kick(generation, now);
      toast(generation.busy ? 'Stopping it before its next picture…' : 'Stopped.' + (credits?.enforced ? ' Your credits were given back.' : ''));
      if (!generation.busy) await load();
      else drawCredits();
    } catch (err) {
      toast(failMessage(err, 'Could not stop it.'), 'error');
    }
  };

  const showLive = (g: Generation | null) => {
    if (!g) {
      liveCard = null;
      clear(live);
    } else if (liveCard?.id === g.id) {
      liveCard.update(g);
    } else {
      liveCard = liveRun(g, () => tracker.skew, () => void cancel(g));
      clear(live, liveCard.node);
    }
    drawCredits();
  };

  const again = (g: Generation) => {
    form?.fill(g.prompt, g.options);
    form?.node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const drawHistory = (runs: Generation[]) =>
    clear(history, runs.length ? h('h2', { class: 'gen-section-title' }, 'Your generated missions') : null, ...runs.map((g) => pastRun(g, open, again)));

  const loadEveryone = async () => {
    try {
      const { generations } = await api.everyonesGenerations();
      const row = (g: Generation) => h('tr', { 'data-generation': g.id },
        h('td', null, g.user?.name ?? '—', h('div', { class: 'muted' }, g.user?.email ?? '')),
        h('td', null, runName(g, 70)),
        h('td', null, h('span', { class: `gen-status ${g.status}` }, (STAGE_NAMES[g.status]?.short ?? g.status) + (g.busy ? ` · ${Math.floor(g.progress.percent)}%` : ''))),
        h('td', null, g.usd != null ? `$${g.usd.toFixed(2)}` : '—'),
        h('td', null, new Date(g.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
      const table = h('table', { class: 'gen-table' },
        h('thead', null, h('tr', null, ...['Who', 'Mission', 'Status', 'Spent', 'Started'].map((t) => h('th', null, t)))),
        h('tbody', null, ...generations.map(row)));
      clear(everyone, h('details', { class: 'fold gen-everyone', 'data-fold': 'everyone' },
        h('summary', null, `Everyone’s generations (${generations.length})`, help('Administrators only: the latest 50 by anyone, with who asked and roughly what each spent on AI services (teachers see credits, not dollars).')),
        h('div', { class: 'fold-body' }, table)));
    } catch {
      clear(everyone);
    }
  };

  const unsubscribe = tracker.subscribe((g) => {
    // Only redraw what changed: the form keeps what is typed in it.
    if (g || liveCard) showLive(g);
  });
  const unfinished = tracker.onFinished(() => void load());
  void load();

  const page = h('div', { class: 'page generate-page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, '✨ Generate a mission'),
        h('p', { class: 'muted' }, 'Describe a mission. It is aligned to standards, written, drawn and voiced for you, and lands as a draft in your scenarios to look over before you publish it.')),
      credit),
    live, formHost, history, everyone);
  window.addEventListener('hashchange', () => {
    unsubscribe();
    unfinished();
  }, { once: true });
  return page;
}

/** The form: the description, the optional details, and the button with what it costs. */
function buildForm(start: (body: { prompt: string } & GenerationOptions) => Promise<void>) {
  const prompt = h('textarea', { rows: 5, maxlength: 2000, name: 'prompt', 'aria-describedby': 'gen-count', placeholder: `What is it about, what should students learn, and where does it happen? For example: ${EXAMPLES[0]!.text}` });
  const count = h('span', { class: 'muted gen-count', id: 'gen-count' });
  const input = (name: string, attrs: Record<string, unknown>) => h('input', { name, ...attrs });
  const grade = input('grade', { type: 'text', maxlength: 8, placeholder: 'e.g. 4 or 6-8' });
  const subject = input('subject', { type: 'text', maxlength: 60, placeholder: 'e.g. Science' });
  const min = input('min_players', { type: 'number', min: 1, max: 8, value: 2 });
  const max = input('max_players', { type: 'number', min: 1, max: 8, value: 4 });
  const minutes = input('minutes', { type: 'number', min: 5, max: 120, placeholder: '30' });
  const notes = input('notes', { type: 'text', maxlength: 1000, placeholder: 'Vocabulary to use, a twist, what to avoid…' });
  const format = h('select', { name: 'format' },
    h('option', { value: '' }, 'Decide from what I write'),
    h('option', { value: 'mission' }, '🎮 A mission students play'),
    h('option', { value: 'story' }, '📖 A story students watch'));
  const submit = h('button', { type: 'submit', class: 'primary gen-go', 'data-action': 'generate' }, '✨ Generate');
  const note = h('span', { class: 'gen-note muted', 'data-note': '' });
  const more = h('details', { class: 'fold gen-more', 'data-fold': 'generate-options' },
    h('summary', null, 'Grade, subject, players and length (optional)'),
    h('div', { class: 'fold-body' },
      h('div', { class: 'gen-fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Grade'), grade),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Subject'), subject),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fewest players', help('Missions are played together. With more than one player each can choose a crew role with a job of their own.')), min),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Most players'), max),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Minutes'), minutes)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Anything else'), notes)));
  const examples = h('div', { class: 'gen-examples' }, h('span', { class: 'muted' }, 'Try:'),
    ...EXAMPLES.map((e) => h('button', { type: 'button', class: 'chip gen-example', title: e.text, onclick: () => {
      prompt.value = e.text;
      counted();
      prompt.focus();
    } }, e.label)));
  const node = h('form', { class: 'card gen-form', 'data-form': 'generate', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field-label gen-ask' }, 'What is the mission about?',
      help('The topic, what students should learn, and the setting. The generator picks the standards, writes the story, the scenes, the characters and the questions, draws every picture in the house style and records the voices.')), prompt),
    h('div', { class: 'gen-under' }, examples, count),
    h('label', { class: 'field gen-format' }, h('span', { class: 'field-label' }, 'Make',
      help('A mission: students explore, solve puzzles and answer questions together. A story: it plays by itself like an animated picture book, scene after scene, with characters acting it out, a narrator, weather and sounds, and things to talk about at the end. “Tell the story of…” is read as a story.')), format),
    more,
    h('div', { class: 'row-actions gen-actions' }, submit, note));

  let busy = false;
  let short = false;
  const counted = () => {
    const n = prompt.value.trim().length;
    count.textContent = `${prompt.value.length} / 2000`;
    count.classList.toggle('short', n > 0 && n < 12);
    submit.disabled = busy || short || n < 12;
  };
  prompt.addEventListener('input', counted);

  node.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (prompt.value.trim().length < 12) {
      toast('Say what the mission is about in a sentence or two: the topic, and what students should learn.', 'error');
      return prompt.focus();
    }
    submit.disabled = true;
    submit.textContent = 'Starting…';
    try {
      const text = (el: HTMLInputElement) => el.value.trim() || undefined;
      await start({
        prompt: prompt.value.trim(), grade: text(grade), subject: text(subject),
        min_players: Number(min.value) || undefined, max_players: Number(max.value) || undefined, minutes: Number(minutes.value) || undefined, notes: text(notes),
        format: format.value === 'mission' || format.value === 'story' ? format.value : undefined,
      });
      prompt.value = '';
    } catch (err) {
      toast(failMessage(err, 'Could not start.'), 'error');
    } finally {
      submit.textContent = submit.dataset.label ?? '✨ Generate';
      counted();
    }
  });

  const fill = (text: string, options: GenerationOptions = {}) => {
    prompt.value = text;
    grade.value = options.grade ?? '';
    subject.value = options.subject ?? '';
    min.value = String(options.min_players ?? 2);
    max.value = String(options.max_players ?? 4);
    minutes.value = options.minutes ? String(options.minutes) : '';
    notes.value = options.notes ?? '';
    format.value = options.format ?? '';
    if (options.grade || options.subject || options.minutes || options.notes) more.open = true;
    counted();
    prompt.focus();
  };
  if (prefill) {
    const p = prefill;
    prefill = null;
    queueMicrotask(() => fill(p.prompt, p));
  }
  counted();

  /** What it costs, what is left, and whether one is already being made. */
  const update = (cost: number, credits: CreditSummary | null, nowBusy: boolean) => {
    busy = nowBusy;
    const enforced = !!credits?.enforced;
    short = enforced && credits!.balance < cost;
    submit.dataset.label = enforced ? `✨ Generate · ${cost} credits` : '✨ Generate';
    if (submit.textContent !== 'Starting…') submit.textContent = submit.dataset.label;
    note.classList.toggle('issue', short);
    note.classList.toggle('error', short);
    if (busy) {
      note.textContent = 'One mission at a time: start the next when this one is done. You can write it now.';
    } else if (short) {
      clear(note, `A mission costs ${cost} credits and you have ${credits!.balance}. `,
        credits!.monthly ? `${credits!.monthly} arrive with each month of your plan. ` : '', h('a', { href: '#/plan' }, 'See your plan'));
    } else if (enforced) {
      const left = credits!.balance - cost;
      note.textContent = `You will have ${left} credit${left === 1 ? '' : 's'} left. If it cannot be made, or you stop it, the credits come back.`;
    } else {
      note.textContent = 'It takes about ten minutes, on the server: you can leave this page.';
    }
    counted();
  };

  return { node, update, fill };
}

/** The run being made: its stages, a live bar, what it is doing now, the time left, and Cancel. */
function liveRun(first: Generation, skew: () => number, cancel: () => void) {
  const bar = progressBar(first, skew);
  const head = h('div', { class: 'gen-live-head' });
  const steps = h('div');
  const detail = h('p', { class: 'gen-detail', 'aria-live': 'polite' });
  const meta = h('p', { class: 'muted gen-meta' });
  const stop = h('button', { type: 'button', class: 'danger-outline', 'data-action': 'cancel', onclick: cancel }, 'Cancel');
  const node = h('div', { class: 'card gen-run live', 'data-generation': first.id },
    head, steps, bar, detail, meta,
    h('div', { class: 'row-actions' }, stop,
      h('span', { class: 'muted' }, 'You can leave this page: it carries on, and the ✨ chip at the top shows how it is going.')));
  let run = first;
  const paint = () => {
    const g = run;
    const now = Date.now() / 1000 + skew();
    node.dataset.status = g.status;
    clear(head,
      h('span', { class: 'gen-eyebrow' }, g.cancelling ? 'Stopping…' : g.status === 'queued' ? 'Waiting to start' : 'Being made'),
      h('strong', { class: 'gen-title' }, runName(g)),
      g.title ? h('p', { class: 'muted gen-prompt' }, g.prompt) : null);
    clear(steps, stageSteps(g));
    bar.update(g);
    const count = g.progress.total ? ` · ${g.progress.stage === 'voicing' ? 'line' : 'picture'} ${Math.min(g.progress.total, (g.progress.done ?? 0) + 1)} of ${g.progress.total}` : '';
    detail.textContent = (g.progress.detail ?? STAGE_NAMES[g.progress.stage]?.long ?? '') + (g.progress.stage === 'drawing' ? count : '');
    const started = Date.parse(g.progress.started_at ?? g.created_at) / 1000;
    const left = timeLeft(g, now);
    meta.textContent = [
      g.status === 'queued' ? `Asked for ${duration(now - Date.parse(g.created_at) / 1000)} ago` : `Started ${duration(now - started)} ago`,
      left != null ? `about ${duration(Math.max(60, left))} left` : 'usually about ten minutes in all',
      g.usd != null ? `$${g.usd.toFixed(2)} spent so far` : null,
    ].filter(Boolean).join(' · ');
    stop.disabled = g.cancelling;
    stop.textContent = g.cancelling ? 'Stopping…' : 'Cancel';
  };
  paint();
  // The "started … ago" and time left move on between reports.
  const timer = window.setInterval(() => (node.isConnected ? paint() : window.clearInterval(timer)), 5000);
  return { id: first.id, node, update: (g: Generation) => ((run = g), paint()) };
}

/** A finished run: open what it made, or see why not and use the description again. */
function pastRun(g: Generation, open: (id: number) => void, again: (g: Generation) => void): HTMLElement {
  const when = new Date(g.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const opts = [g.options.grade ? `Grade ${g.options.grade}` : null, g.options.subject, g.options.minutes ? `${g.options.minutes} min` : null].filter(Boolean).join(' · ');
  const status = STAGE_NAMES[g.status]?.short ?? g.status;
  return h('div', { class: `card gen-run ${g.status}`, 'data-generation': g.id, 'data-status': g.status },
    h('div', { class: 'card-title' }, h('strong', null, runName(g)), h('span', { class: `gen-status ${g.status}` }, g.status === 'done' ? '✅ Ready' : g.status === 'failed' ? '⚠️ Failed' : status)),
    g.title ? h('p', { class: 'muted gen-prompt' }, g.prompt) : null,
    h('p', { class: 'muted gen-meta' }, [when, opts, g.usd != null ? `$${g.usd.toFixed(2)} spent` : null].filter(Boolean).join(' · ')),
    g.status === 'failed' ? h('p', { class: 'issue error' }, g.error ?? 'Something went wrong.', ' Any credits it cost were given back.') : null,
    g.status === 'cancelled' ? h('p', { class: 'muted' }, 'You stopped it. Any credits it cost were given back.') : null,
    h('div', { class: 'row-actions' },
      g.scenario_id ? h('button', { type: 'button', class: 'primary', onclick: () => open(g.scenario_id!) }, 'Open in the editor') : null,
      g.scenario_id ? h('span', { class: 'muted' }, 'A private draft: look it over, then publish and assign it.') : null,
      h('button', { type: 'button', 'data-action': 'again', onclick: () => again(g) }, g.status === 'done' ? 'Make another like it' : 'Try again')));
}

/** For a teacher whose plan does not have the generator: what it is, and where to get it. */
function upsell(plan: GeneratorPlan): HTMLElement {
  if (plan.source === 'organization') {
    return h('div', { class: 'card gen-upsell', 'data-card': 'upsell' },
      h('h2', null, 'Your school’s license does not include the generator'),
      h('p', null, `You are on ${plan.plan_name}. Ask whoever runs QBL for your school or district about adding the AI mission generator.`));
  }
  return h('div', { class: 'card gen-upsell', 'data-card': 'upsell' },
    h('h2', null, 'The generator comes with Teacher Plus'),
    h('p', null, `You are on ${plan.plan_name}. Teacher Plus adds the AI mission generator, with credits every month, to every curricular mission and your class.`),
    h('ul', { class: 'gen-upsell-list' },
      h('li', null, 'Describe a mission in a sentence or two'),
      h('li', null, 'It is aligned to standards, written, drawn and voiced in about ten minutes'),
      h('li', null, 'It lands as a draft you can change like any other mission')),
    h('div', { class: 'row-actions' }, h('a', { class: 'button primary', href: `${config.gameUrl}plans` }, 'See the plans'), h('a', { class: 'button', href: '#/plan' }, 'Your plan')));
}

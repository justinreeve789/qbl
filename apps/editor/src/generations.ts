import { ApiError, type Api, type Generation } from './api';
import { h } from './dom';

/**
 * The AI generator's runs as the editor follows them: which one is being made, how far it has got,
 * and its progress bar. A run takes about ten minutes on the server's queue worker, so the teacher
 * can go on working anywhere in the editor: the header's chip (main.ts) and the Generate page both
 * listen to one tracker here, which asks the server every few seconds while a run is going and says
 * when it has finished.
 */

/** Each stage the teacher is shown, in order: a short name for the step list, and what it is. */
export const STAGE_NAMES: Record<string, { short: string; long: string }> = {
  queued: { short: 'Waiting', long: 'Waiting for the generator to start' },
  aligning: { short: 'Standards', long: 'Choosing the curriculum standards' },
  designing: { short: 'Story', long: 'Writing the story, scenes and questions' },
  drawing: { short: 'Pictures', long: 'Drawing the scenes, characters and props' },
  building: { short: 'Build', long: 'Building the scenes and events' },
  voicing: { short: 'Voices', long: 'Recording the characters’ voices' },
  importing: { short: 'Save', long: 'Saving it as your draft' },
  done: { short: 'Ready', long: 'Ready' },
  failed: { short: 'Failed', long: 'Could not be made' },
  cancelled: { short: 'Cancelled', long: 'Cancelled' },
};

/** Each stage's share of the bar: the same numbers as App\Qbl\Generation\GenerationProgress::STAGES. */
const SPANS: Record<string, [number, number]> = {
  queued: [0, 1], aligning: [1, 6], designing: [6, 26], drawing: [26, 88], building: [88, 91], voicing: [91, 98], importing: [98, 100],
};

/** How long each stage usually takes, in seconds: for moving the bar between reports, and the time left. */
const TYPICAL: Record<string, number> = { queued: 20, aligning: 25, designing: 150, drawing: 420, building: 10, voicing: 90, importing: 10 };
/** The same for one scene made for a scenario: one plan, one background, one survey. */
const TYPICAL_SCENE: Record<string, number> = { queued: 20, designing: 40, drawing: 150, building: 5, importing: 5 };
const typicalOf = (g: Generation) => (g.kind === 'scene' ? TYPICAL_SCENE : TYPICAL);

const seconds = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : NaN);

/**
 * What the bar shows now: the server's percent, crept forward through the stage it is in so that a
 * long step (writing the story is one call of a minute or two) does not look stuck. It never passes
 * the next thing the server will report, so it never has to go back.
 */
export function shownPercent(g: Generation, now: number): number {
  const p = g.progress;
  if (!g.busy) return g.status === 'done' ? 100 : p.percent;
  const span = SPANS[p.stage];
  if (!span) return p.percent;
  const since = Math.max(0, now - seconds(p.updated_at ?? p.stage_started_at));
  // The most it may reach before the next report: the next picture, or near the stage's end.
  let ceiling = span[0] + (span[1] - span[0]) * 0.92;
  let pace = typicalOf(g)[p.stage] ?? 60;
  if (p.total && p.done != null) {
    ceiling = span[0] + ((span[1] - span[0]) * Math.min(p.total, p.done + 1)) / p.total;
    const inStage = Math.max(1, now - seconds(p.stage_started_at) - since);
    pace = p.done > 0 ? inStage / p.done : 30;
  }
  if (ceiling <= p.percent || !Number.isFinite(since)) return p.percent;
  return p.percent + (ceiling - p.percent) * 0.9 * (1 - Math.exp(-since / pace));
}

/** "3 min", "45 s", "1 h 5 min". */
export function duration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Roughly how long is left, from how fast its pictures have gone; null until there is something to go on. */
export function timeLeft(g: Generation, now: number): number | null {
  const p = g.progress;
  if (!g.busy || p.stage === 'queued') return null;
  const typical = typicalOf(g);
  const later = (p.stages.length ? p.stages : Object.keys(typical)).slice(p.stages.indexOf(p.stage) + 1);
  const after = later.reduce((sum, s) => sum + (typical[s] ?? 0), 0);
  const inStage = Math.max(0, now - seconds(p.stage_started_at));
  if (p.stage === 'drawing' && p.total && p.done && p.done >= 2) {
    return (inStage / p.done) * (p.total - p.done) + after;
  }
  const usual = typical[p.stage] ?? 60;
  return Math.max(usual * 0.2, usual - inStage) + after;
}

/**
 * A run's progress bar, kept moving every second between the server's reports. `update` gives it a
 * newer report. `compact` is the header chip's thin one, without the words.
 */
export function progressBar(g: Generation, skew: () => number, compact = false): HTMLElement & { update(g: Generation): void } {
  let run = g;
  const fill = h('span', { class: 'gen-bar-fill' });
  const label = compact ? null : h('span', { class: 'gen-bar-percent' });
  const bar = h('div', { class: `gen-bar${compact ? ' compact' : ''}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'data-progress': '' }, fill, label) as unknown as HTMLElement & { update(g: Generation): void };
  const paint = () => {
    const pct = Math.min(100, shownPercent(run, Date.now() / 1000 + skew()));
    fill.style.width = `${pct.toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.setAttribute('aria-valuetext', `${Math.round(pct)}%: ${run.progress.detail ?? STAGE_NAMES[run.progress.stage]?.long ?? ''}`);
    bar.classList.toggle('stopping', run.cancelling);
    if (label) label.textContent = `${Math.floor(pct)}%`;
  };
  bar.update = (next) => {
    run = next;
    paint();
  };
  paint();
  // Stop once it is off the page (or if it never made it onto one).
  let seen = false;
  let idle = 0;
  const timer = window.setInterval(() => {
    if (bar.isConnected) {
      seen = true;
      paint();
    } else if (seen || ++idle > 5) window.clearInterval(timer);
  }, 1000);
  return bar;
}

/** The stages as a row of steps: done, the one going on, and those to come. */
export function stageSteps(g: Generation): HTMLElement {
  const p = g.progress;
  const stages = p.stages.length ? p.stages : ['aligning', 'designing', 'drawing', 'building', 'importing'];
  const at = g.status === 'done' ? stages.length : stages.indexOf(p.stage);
  return h('ol', { class: 'gen-steps', 'data-steps': '' },
    ...stages.map((s, i) => {
      const state = i < at ? 'done' : i === at ? (g.busy ? 'now' : 'stopped') : 'later';
      return h('li', { class: state, 'data-stage': s, title: STAGE_NAMES[s]?.long ?? s, 'aria-current': state === 'now' ? 'step' : null },
        h('span', { class: 'gen-step-dot', 'aria-hidden': 'true' }, state === 'done' ? '✓' : String(i + 1)), STAGE_NAMES[s]?.short ?? s);
    }));
}

type Listener = (active: Generation | null) => void;
type Finished = (run: Generation) => void;

/**
 * Follows the teacher's run being made. One per editor (see `tracker`): `start` once signed in,
 * `kick` after starting one. While a run is going it asks every 4 seconds (every 15 while the tab is
 * hidden); otherwise it does not ask at all.
 */
export class GenerationTracker {
  active: Generation | null = null;
  /** The server's clock minus this one's, in seconds, so times since are right. */
  skew = 0;
  private api: Api | null = null;
  private timer = 0;
  private listeners = new Set<Listener>();
  private finishers = new Set<Finished>();
  private enabled = false;

  /** Begin following (a teacher or administrator has signed in). */
  start(api: Api) {
    this.api = api;
    this.enabled = true;
    void this.poll();
  }

  /** Stop following (signed out). */
  stop() {
    this.enabled = false;
    window.clearTimeout(this.timer);
    this.set(null);
  }

  /** A run was just started (or stopped): look now, and keep looking while it goes. */
  kick(run?: Generation, now?: string) {
    if (now) this.clock(now);
    if (run) this.set(run.busy ? run : null);
    void this.poll();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.active);
    return () => this.listeners.delete(listener);
  }

  /** Be told when a run finishes (made, failed or cancelled) while the editor is open. */
  onFinished(listener: Finished): () => void {
    this.finishers.add(listener);
    return () => this.finishers.delete(listener);
  }

  private clock(now: string) {
    const server = seconds(now);
    if (Number.isFinite(server)) this.skew = server - Date.now() / 1000;
  }

  private set(next: Generation | null) {
    this.active = next;
    for (const l of this.listeners) l(next);
  }

  private async poll() {
    window.clearTimeout(this.timer);
    if (!this.enabled || !this.api) return;
    const was = this.active;
    try {
      const { generation, now } = await this.api.activeGeneration();
      this.clock(now);
      if (was && (!generation || generation.id !== was.id)) {
        // The one we were following has finished: say how.
        const { generation: done } = await this.api.generation(was.id);
        for (const f of this.finishers) f(done);
      }
      this.set(generation);
    } catch (err) {
      // Not for this account (a student, or signed out): stop asking.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return this.stop();
    }
    if (this.enabled && this.active) this.timer = window.setTimeout(() => void this.poll(), document.hidden ? 15000 : 4000);
  }
}

export const tracker = new GenerationTracker();

/** A run's description, shortened for a heading. */
export function runName(g: Generation, length = 90): string {
  return g.title ?? (g.prompt.length > length ? `${g.prompt.slice(0, length)}…` : g.prompt);
}

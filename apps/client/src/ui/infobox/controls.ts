import { answerValue, graphSpec, parseSeries, parseWhen, testWhen, wheelOptions } from '@qbl/shared';
import { formulasNow, loadFormulas, loadGraphs } from '../science/load';
import type { GraphHandle } from '../science/graph';

/**
 * The hands-on parts of an infobox (see packages/shared/src/infobox.ts): sliders, switches and
 * wheels of chance the player sets, and what shows their effect at once: values, meters and
 * `when` blocks. The box keeps their values until a button is chosen; then they are saved in
 * their variables, as typed answers are.
 */
export interface Controls {
  /** Each control's value now, by its variable, as text (as typed answers are). */
  values(): Record<string, string>;
  /** A value as the box has it now: a control's, or a variable of the game. */
  get(name: string): unknown;
  /** Settles when what the box works out (formulas, graphs) is ready to be read. */
  ready: Promise<void>;
  destroy(): void;
}

export interface ControlEnv {
  /** A variable of the game, for what shows or tests one that is not a control here. */
  get?: (name: string) => unknown;
  motion: boolean;
}

/** Colours for a wheel's slices, in turn. */
const SLICE = ['#ffb703', '#8ecae6', '#fb8500', '#90be6d', '#cdb4db', '#f28482', '#43aa8b', '#ffd166'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : fallback;
};

export function buildControls(root: ParentNode, env: ControlEnv): Controls {
  const values = new Map<string, string>();
  const refreshers: Array<() => void> = [];
  const timers: number[] = [];
  const get = (name: string) => (values.has(name) ? values.get(name) : env.get?.(name));
  // What is worked out from the controls comes first: values and meters may show it.
  const workings: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const waits: Array<Promise<unknown>> = [];
  let gone = false;
  const changed = () => {
    for (const w of workings) w();
    for (const r of refreshers) r();
  };

  for (const panel of root.querySelectorAll<HTMLElement>('div[data-qbl="panel"]')) panel.classList.add('qbl-panel');

  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-qbl="slider"]')) {
    const name = input.dataset.var;
    const min = num(input.dataset.min, 0);
    const max = Math.max(min + 1e-9, num(input.dataset.max, 10));
    const step = num(input.dataset.step, 1) || 1;
    const start = Math.min(max, Math.max(min, num(input.dataset.value, min)));
    const unit = input.dataset.unit ?? '';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(start);
    input.classList.add('qbl-slider-input');
    const wrap = el('label', 'qbl-control qbl-slider');
    const head = el('span', 'qbl-control-head');
    const label = el('span', 'qbl-control-label', input.dataset.label ?? '');
    const shown = el('output', 'qbl-control-value');
    head.append(label, shown);
    const ends = el('span', 'qbl-slider-ends');
    ends.append(el('span', '', `${min}${unit}`), el('span', '', `${max}${unit}`));
    input.replaceWith(wrap);
    wrap.append(head, input, ends);
    if (!input.getAttribute('aria-label') && input.dataset.label) input.setAttribute('aria-label', input.dataset.label);
    const update = () => {
      shown.textContent = `${input.value}${unit}`;
      input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
      if (name) values.set(name, input.value);
      changed();
    };
    input.addEventListener('input', update);
    update();
  }

  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-qbl="switch"]')) {
    const name = input.dataset.var;
    input.checked = num(input.dataset.value, 0) > 0;
    input.classList.add('qbl-switch-input');
    input.setAttribute('role', 'switch');
    const wrap = el('label', 'qbl-control qbl-switch');
    const knob = el('span', 'qbl-switch-track');
    knob.append(el('span', 'qbl-switch-knob'));
    input.replaceWith(wrap);
    wrap.append(input, knob, el('span', 'qbl-control-label', input.dataset.label ?? ''));
    if (!input.getAttribute('aria-label') && input.dataset.label) input.setAttribute('aria-label', input.dataset.label);
    const update = () => {
      wrap.classList.toggle('on', input.checked);
      if (name) values.set(name, input.checked ? '1' : '0');
      changed();
    };
    input.addEventListener('change', update);
    update();
  }

  for (const wheel of root.querySelectorAll<HTMLElement>('div[data-qbl="wheel"]')) {
    const name = wheel.dataset.var;
    const options = wheelOptions(wheel.dataset.options);
    if (options.length < 2) continue;
    const spinsAllowed = Math.max(0, Math.floor(num(wheel.dataset.spins, 0)));
    let spins = 0;
    let turned = 0;
    let busy = false;
    wheel.classList.add('qbl-control', 'qbl-wheel');
    wheel.replaceChildren();
    const label = el('span', 'qbl-control-label', wheel.dataset.label ?? '');
    const face = el('div', 'qbl-wheel-face');
    face.append(wheelSvg(options));
    const pointer = el('span', 'qbl-wheel-pointer');
    pointer.setAttribute('aria-hidden', 'true');
    const holder = el('div', 'qbl-wheel-holder');
    holder.append(face, pointer);
    const spin = el('button', 'qbl-button qbl-wheel-spin', 'Spin');
    spin.type = 'button';
    const result = el('output', 'qbl-control-value');
    result.setAttribute('aria-live', 'polite');
    wheel.append(label, holder, spin, result);
    const slice = 360 / options.length;
    // Where it landed last time, when the box is shown again: shown, and kept unless spun again.
    const before = wheel.dataset.value ?? '';
    const at = before !== '' ? options.indexOf(before) : -1;
    if (at >= 0) {
      turned = 360 - (at * slice + slice / 2);
      face.style.transform = `rotate(${turned}deg)`;
      result.textContent = before;
      if (name) values.set(name, before);
    }
    spin.addEventListener('click', () => {
      if (busy || (spinsAllowed > 0 && spins >= spinsAllowed)) return;
      busy = true;
      spins++;
      spin.disabled = true;
      const pick = Math.floor(Math.random() * options.length);
      // Land the chosen slice under the pointer at the top, somewhere inside it, after a few turns.
      const inside = (0.2 + Math.random() * 0.6) * slice;
      const target = 360 - (pick * slice + inside);
      turned += 360 * 4 + ((target - (turned % 360)) + 360) % 360;
      const ms = env.motion ? 2400 : 0;
      face.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.15, 0.9, 0.25, 1)` : 'none';
      face.style.transform = `rotate(${turned}deg)`;
      result.textContent = '…';
      timers.push(window.setTimeout(() => {
        const landed = options[pick]!;
        result.textContent = landed;
        wheel.classList.remove('landed');
        void wheel.offsetWidth;
        wheel.classList.add('landed');
        if (name) values.set(name, landed);
        busy = false;
        spin.disabled = spinsAllowed > 0 && spins >= spinsAllowed;
        if (spin.disabled) spin.textContent = 'Spun';
        changed();
      }, ms));
    });
  }

  for (const span of root.querySelectorAll<HTMLElement>('span[data-qbl="value"]')) {
    span.classList.add('qbl-live-value');
    const name = span.dataset.var;
    if (!name) continue;
    refreshers.push(() => {
      const v = get(name);
      span.textContent = v == null || v === '' ? '–' : String(v);
    });
  }

  for (const meter of root.querySelectorAll<HTMLElement>('div[data-qbl="meter"]')) {
    const name = meter.dataset.var;
    const min = num(meter.dataset.min, 0);
    const max = Math.max(min + 1e-9, num(meter.dataset.max, 10));
    const unit = meter.dataset.unit ?? '';
    meter.classList.add('qbl-control', 'qbl-meter');
    meter.replaceChildren();
    const head = el('span', 'qbl-control-head');
    const shown = el('span', 'qbl-control-value');
    head.append(el('span', 'qbl-control-label', meter.dataset.label ?? ''), shown);
    const bar = el('span', 'qbl-meter-bar');
    const fill = el('span', 'qbl-meter-fill');
    bar.append(fill);
    meter.append(head, bar);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-valuemin', String(min));
    meter.setAttribute('aria-valuemax', String(max));
    if (!name) continue;
    refreshers.push(() => {
      const v = Number(answerValue(String(get(name) ?? '')));
      const n = Number.isFinite(v) ? v : min;
      fill.style.width = `${Math.max(0, Math.min(1, (n - min) / (max - min))) * 100}%`;
      shown.textContent = `${Number.isFinite(v) ? v : '–'}${unit}`;
      meter.setAttribute('aria-valuenow', String(n));
    });
  }

  for (const when of root.querySelectorAll<HTMLElement>('div[data-qbl="when"]')) {
    when.classList.add('qbl-when');
    const conditions = parseWhen(when.dataset.when ?? '');
    refreshers.push(() => {
      const on = testWhen(conditions, get);
      if (on === !when.hidden) return;
      when.hidden = !on;
      // Hidden, it is not read aloud either.
      if (on) {
        delete when.dataset.unread;
        when.classList.remove('appear');
        void when.offsetWidth;
        if (env.motion) when.classList.add('appear');
      } else when.dataset.unread = '';
    });
    when.hidden = !testWhen(conditions, get);
    if (when.hidden) when.dataset.unread = '';
  }

  // A formula's value, from the controls as they are now and from variables.
  const calcs = [...root.querySelectorAll<HTMLElement>('span[data-qbl="calc"]')];
  for (const span of calcs) {
    span.classList.add('qbl-live-value', 'qbl-calc');
    const source = span.dataset.formula ?? '';
    const name = span.dataset.var;
    const unit = span.dataset.unit ?? '';
    const digits = num(span.dataset.digits, 2);
    span.textContent = '…';
    workings.push(() => {
      const f = formulasNow();
      if (!f) return;
      const n = f.evaluateNumber(source, get);
      span.textContent = n == null ? '–' : `${f.formatNumber(n, digits)}${unit ? ` ${unit}` : ''}`;
      if (!name) return;
      if (n == null) values.delete(name);
      else values.set(name, f.formatNumber(n, Math.max(digits, 6)));
    });
  }

  // Graphs: curves that follow the controls, points to drag, recorded data.
  const graphs = [...root.querySelectorAll<HTMLElement>('div[data-qbl="graph"]')];
  for (const holder of graphs) {
    const spec = graphSpec((n) => holder.getAttribute(n));
    holder.classList.add('qbl-graph');
    holder.dataset.unread = '';
    const wait = el('div', 'qbl-graph-wait', 'Drawing the graph…');
    holder.replaceChildren(wait);
    const places = spec.points.map((p) => {
      // Shown again, a point is where it was left.
      const x = Number(answerValue(String(env.get?.(p.xVar) ?? '')));
      const y = Number(answerValue(String(env.get?.(p.yVar) ?? '')));
      const kept = env.get?.(p.xVar) != null && env.get?.(p.xVar) !== '' && Number.isFinite(x) && Number.isFinite(y);
      const at = kept ? { ...p, x, y } : p;
      values.set(p.xVar, String(at.x));
      values.set(p.yVar, String(at.y));
      return at;
    });
    let handle: GraphHandle | null = null;
    refreshers.push(() => handle?.refresh());
    cleanups.push(() => handle?.destroy());
    const needs: Array<Promise<unknown>> = [loadGraphs()];
    if (spec.functions.length) needs.push(loadFormulas());
    waits.push(Promise.all(needs).then(async () => {
      if (gone) return;
      const { drawGraph } = await loadGraphs();
      const f = formulasNow();
      handle = drawGraph(holder, {
        spec: { ...spec, points: places },
        curve: (source) => f?.formulaFunction(source, get) ?? null,
        series: spec.series ? () => parseSeries(get(spec.series!)) : undefined,
        moved(index, x, y) {
          const p = spec.points[index];
          if (!p) return;
          const round = (v: number) => String(Math.round(v * 1000) / 1000);
          values.set(p.xVar, round(x));
          values.set(p.yVar, round(y));
          changed();
        },
      });
    }).catch(() => {
      wait.textContent = 'The graph could not be drawn.';
    }));
  }
  if (calcs.length) waits.push(loadFormulas());

  changed();
  const ready = Promise.all(waits).then(() => {
    if (!gone) changed();
  }, () => {});
  return {
    values: () => Object.fromEntries(values),
    get,
    ready,
    destroy() {
      gone = true;
      for (const t of timers) clearTimeout(t);
      for (const c of cleanups) c();
    },
  };
}

/** A wheel of chance as a picture: one slice per option, the first starting at the top. */
function wheelSvg(options: string[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.setAttribute('aria-hidden', 'true');
  const n = options.length;
  const at = (deg: number, r: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
  options.forEach((label, i) => {
    const a0 = (i * 360) / n;
    const a1 = ((i + 1) * 360) / n;
    const [x0, y0] = at(a0, 96);
    const [x1, y1] = at(a1, 96);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M0 0 L${x0} ${y0} A96 96 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1} Z`);
    path.setAttribute('fill', SLICE[i % SLICE.length]!);
    path.setAttribute('stroke', '#fff');
    path.setAttribute('stroke-width', '2');
    svg.append(path);
    const mid = (a0 + a1) / 2;
    const [tx, ty] = at(mid, 62);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', String(tx));
    text.setAttribute('y', String(ty));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('transform', `rotate(${mid} ${tx} ${ty})`);
    text.setAttribute('font-size', String(n > 8 ? 10 : 13));
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', '#1d2340');
    text.textContent = label.length > 12 ? `${label.slice(0, 11)}…` : label;
    svg.append(text);
  });
  const hub = document.createElementNS(NS, 'circle');
  hub.setAttribute('r', '10');
  hub.setAttribute('fill', '#1d2340');
  svg.append(hub);
  return svg;
}

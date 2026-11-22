import { emojiIcon } from './icons';
import { loadGraphs } from './science/load';
import type { GraphHandle } from './science/graph';
import type { BenchPanelActions, BenchPanelHandle, BenchPanelSpec, BenchPanelView } from './UiPort';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label: string, emoji: string | null, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el('button', 'qbl-bench-button');
  b.type = 'button';
  if (emoji) b.append(emojiIcon(emoji, { size: 20 }));
  b.append(el('span', '', label));
  if (title) b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  // A press on a control must not also reach the game beneath it.
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

/** Set text only when it changes: update() runs every frame. */
function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * What stands beside a close-up bench, over the game: what is measured (top left, with the graph
 * under it when the bench has one), and along the bottom what is in the player's hand and the
 * buttons: put it down, record a point, start again.
 */
export function benchPanel(root: HTMLElement, spec: BenchPanelSpec, on: BenchPanelActions): BenchPanelHandle {
  const box = el('div', 'qbl-bench');
  const side = el('div', 'qbl-bench-side');
  const readings = el('dl', 'qbl-bench-readings');
  const values = new Map<string, HTMLElement>();
  for (const r of spec.readouts) {
    const row = el('div', 'qbl-bench-reading');
    const value = el('dd', '', '—');
    row.append(el('dt', '', r.label), value);
    row.dataset.readout = r.id;
    readings.append(row);
    values.set(r.id, value);
  }
  readings.hidden = spec.readouts.length === 0;
  side.append(readings);

  let graph: GraphHandle | null = null;
  let points: Array<[number, number]> = [];
  let plotted = '';
  let closed = false;
  const count = el('span', 'qbl-bench-count');
  if (spec.graph) {
    const card = el('div', 'qbl-bench-graph');
    const holder = el('div');
    const foot = el('div', 'qbl-bench-graph-foot');
    const clear = button('Clear', '🧹', () => on.clearGraph(), 'Take every point off the graph');
    clear.dataset.control = 'clear-graph';
    foot.append(count, clear);
    card.append(holder, foot);
    side.append(card);
    for (const stop of ['pointerdown', 'click', 'wheel'] as const) card.addEventListener(stop, (e) => e.stopPropagation());
    const g = spec.graph;
    void loadGraphs().then(({ drawGraph }) => {
      if (closed) return;
      graph = drawGraph(holder, {
        spec: { functions: [], x: [0, 10], y: [0, 10], points: [], join: 'none', series: null, snap: 0, xLabel: g.xLabel, yLabel: g.yLabel, label: g.title },
        curve: () => null,
        series: () => points,
        follow: true,
      });
      plotted = '';
    }).catch(() => {
      holder.textContent = 'The graph could not be drawn.';
    });
  }

  const bar = el('div', 'qbl-bench-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Bench controls');
  const hand = el('div', 'qbl-bench-hand');
  hand.setAttribute('aria-live', 'polite');
  const handText = el('span');
  const down = button('Put down', '✋', () => on.putDown());
  down.dataset.control = 'put-down';
  hand.append(handText, down);
  hand.hidden = true;
  const group = el('div', 'qbl-bench-group');
  if (spec.graph?.button) {
    const record = button('Record', '📍', () => on.record(), 'Put a point on the graph for how things are now');
    record.dataset.control = 'record';
    record.classList.add('primary');
    group.append(record);
  }
  if (spec.reset) {
    const reset = button('Start again', '🔄', () => on.reset(), 'Put everything back as it started');
    reset.dataset.control = 'reset';
    group.append(reset);
  }
  bar.append(hand, group);
  box.append(side, bar);
  root.append(box);

  return {
    update(view: BenchPanelView) {
      for (const [id, node] of values) setText(node, view.readings[id] ?? '—');
      hand.hidden = view.holding == null;
      if (view.holding != null) setText(handText, view.holding);
      points = view.points;
      if (spec.graph) setText(count, points.length === 1 ? '1 point' : `${points.length} points`);
      // Drawn again when a point is added, or the last one has moved on (a flat stretch of a live graph).
      const stamp = `${points.length}:${points.at(-1)?.[0] ?? ''}`;
      if (graph && plotted !== stamp) {
        plotted = stamp;
        graph.refresh();
      }
    },
    close() {
      closed = true;
      graph?.destroy();
      box.remove();
    },
  };
}

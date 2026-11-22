import JXG from 'jsxgraph';
import type { GraphSpec } from '@qbl/shared';
import './graph.css';

/** What a graph is drawn from, beside its settings. */
export interface GraphSource {
  spec: GraphSpec;
  /** A curve's formula as a function of x, or null when it cannot be read. */
  curve(source: string): ((x: number) => number) | null;
  /** The recorded data to plot, read each time the graph is refreshed. */
  series?(): Array<[number, number]>;
  /** A point was dragged to here. */
  moved?(index: number, x: number, y: number): void;
  /** Stretch the axes to take in all the recorded data (a bench's live graph). */
  follow?: boolean;
}

export interface GraphHandle {
  /** Something a curve reads has changed, or more data was recorded: draw again. */
  refresh(): void;
  destroy(): void;
}

const CURVES = ['#2f6fed', '#d1495b', '#2a9d5c', '#b8860b', '#8e5bd6', '#0f7a9d'];
const POINTS = ['#e4572e', '#2f6fed', '#2a9d5c', '#8e5bd6', '#b8860b', '#0f7a9d'];
let serial = 0;

/**
 * Draw a graph in `holder` with JSXGraph: axes, a curve for each formula, points to drag (joined
 * if asked), and recorded data as a line with a dot at each point.
 */
export function drawGraph(holder: HTMLElement, source: GraphSource): GraphHandle {
  const { spec } = source;
  holder.classList.add('qbl-graph');
  holder.replaceChildren();
  if (spec.label) {
    const title = document.createElement('div');
    title.className = 'qbl-graph-title';
    title.textContent = spec.label;
    holder.append(title);
  }
  const box = document.createElement('div');
  box.className = 'qbl-graph-board jxgbox';
  box.id = `qbl-graph-${++serial}`;
  holder.append(box);

  const bounds = (x: [number, number], y: [number, number]): [number, number, number, number] => {
    // A little room round the edges, so the ends of the axes are inside; and more beside an axis
    // that runs along the edge, where its numbers are written.
    const w = x[1] - x[0];
    const h = y[1] - y[0];
    return [x[0] - w * (x[0] >= 0 ? 0.14 : 0.06), y[1] + h * 0.1, x[1] + w * 0.06, y[0] - h * (y[0] >= 0 ? 0.16 : 0.08)];
  };
  const board = JXG.JSXGraph.initBoard(box, {
    boundingbox: bounds(spec.x, spec.y), axis: true, showCopyright: false, showNavigation: false, keepaspectratio: false,
    pan: { enabled: false }, zoom: { enabled: false }, renderer: 'svg',
    defaultAxes: {
      x: { name: spec.xLabel, withLabel: spec.xLabel !== '', label: { position: 'rt', offset: [-8, 14], anchorX: 'right' } },
      y: { name: spec.yLabel, withLabel: spec.yLabel !== '', label: { position: 'rt', offset: [10, -4], anchorX: 'left' } },
    },
  } as Record<string, unknown>);

  spec.functions.forEach((formula, i) => {
    const f = source.curve(formula);
    if (!f) return;
    board.create('functiongraph', [f, spec.x[0], spec.x[1]], { strokeColor: CURVES[i % CURVES.length], strokeWidth: 2.5, highlight: false, fixed: true });
  });

  const points = spec.points.map((p, i) => {
    const point = board.create('point', [p.x, p.y], {
      name: '', size: 6, fillColor: POINTS[i % POINTS.length], strokeColor: '#ffffff', strokeWidth: 2,
      snapToGrid: spec.snap > 0, snapSizeX: spec.snap || 1, snapSizeY: spec.snap || 1, showInfobox: false,
    });
    point.on('drag', () => source.moved?.(i, point.X(), point.Y()));
    return point;
  });
  const lineLook = { strokeColor: '#1d2340', strokeWidth: 2, highlight: false, fixed: true };
  if (spec.join === 'line' && points.length >= 2) board.create('line', [points[0], points[1]], lineLook);
  else if (spec.join === 'segment') for (let i = 1; i < points.length; i++) board.create('segment', [points[i - 1], points[i]], lineLook);
  else if (spec.join === 'polygon' && points.length >= 3) {
    board.create('polygon', points, { fillColor: '#2f6fed', fillOpacity: 0.15, hasInnerPoints: false, highlight: false, borders: lineLook, vertices: { visible: true } });
  }

  // Recorded data: a line through the points in the order they were recorded, and a dot at each.
  const data = source.series
    ? board.create('curve', [[], []], { strokeColor: '#d1495b', strokeWidth: 2, highlight: false, fixed: true })
    : null;
  let marks: unknown[] = [];

  const plot = () => {
    if (!data || !source.series) return;
    const series = source.series();
    data.dataX = series.map((p) => p[0]);
    data.dataY = series.map((p) => p[1]);
    for (const m of marks) board.removeObject(m as never);
    // A dot for each of the last few dozen points: more would only smear the line.
    marks = series.slice(-60).map(([x, y]) => board.create('point', [x, y], { name: '', size: 3, fixed: true, fillColor: '#d1495b', strokeColor: '#ffffff', strokeWidth: 1, highlight: false, showInfobox: false }));
    if (source.follow && series.length) {
      // The axes take in what was recorded and a little more, and always show where nothing is.
      const span = (values: number[]): [number, number] => {
        const lo = Math.min(0, ...values);
        const hi = Math.max(...values);
        const room = Math.max((hi - lo) * 0.12, 1e-9);
        return hi - lo < 1e-9 ? [lo - 1, hi + 1] : [lo < 0 ? lo - room : lo, hi + room];
      };
      board.setBoundingBox(bounds(span(series.map((p) => p[0])), span(series.map((p) => p[1]))), false);
    }
  };
  plot();
  board.update();

  return {
    refresh() {
      plot();
      board.update();
    },
    destroy() {
      try {
        JXG.JSXGraph.freeBoard(board);
      } catch {
        // The box may already be off the page.
      }
    },
  };
}

import { findSortLine, sortLineOf, type SortLine } from '@qbl/shared';
import type { Row } from '../api';
import { framesOf } from '../characters';
import { mediaUrl, params } from '../describe';
import { h, help, s, toast } from '../dom';
import type { FormContext } from '../fields';

/**
 * "Where it meets the floor", for an item that stands in the scene: its picture with a line along
 * its base. Players in front of the line are drawn in front of the item, those behind it behind,
 * wherever they stand across it, so a counter or bench that runs into the room at an angle sorts
 * properly. The line's points are dragged on the picture; clicking the picture adds one, and
 * double-clicking a point takes it away. It is kept as `sort_line` in the item's settings.
 */
export function sortLineEditor(ctx: FormContext, item: Row): HTMLElement {
  const { store } = ctx;
  const media = store.byId('media', item.media_id as number | null);
  const url = mediaUrl(store, media);
  const box = h('div', { class: 'sort-line', 'data-sort-line': item.id });
  if (!media || !url) return box;

  const saved = () => sortLineOf(params(store.byId('items', item.id) ?? item, 'settings') as { sort_line?: SortLine });
  let line: SortLine | null = saved();
  const save = (next: SortLine | null) => {
    line = next;
    const settings = { ...params(store.byId('items', item.id) ?? item, 'settings') };
    if (next) settings.sort_line = next;
    else delete settings.sort_line;
    void store.patch('items', item.id, { settings }, false);
    draw();
  };

  // The picture: its first frame, if it is a sheet or an animated PNG.
  let size = { w: 0, h: 0 };
  let sheet = { url, columns: 1, rows: 1 };
  const svg = s('svg', { class: 'sort-line-picture checker', preserveAspectRatio: 'xMidYMid meet' }) as SVGSVGElement;
  const status = h('p', { class: 'muted sort-line-status' });
  const clearButton = h('button', { type: 'button', 'data-action': 'sort-line-clear', onclick: () => save(null) }, 'Use the bottom edge');
  const findButton = h('button', { type: 'button', 'data-action': 'sort-line-find', onclick: () => void find() }, '✨ Find it from the picture');

  /** Where a pointer is, in the picture's pixels. */
  const at = (e: PointerEvent | MouseEvent) => {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(size.w, Math.max(0, p.x)), y: Math.min(size.h, Math.max(0, p.y)) };
  };
  const toFraction = (p: { x: number; y: number }): [number, number] => [round(p.x / size.w), round(p.y / size.h)];

  function draw() {
    if (!size.w) return;
    const u = Math.max(size.w, size.h) / 300;
    // A margin, so points on the picture's edges can be seen and grabbed.
    const m = 10 * u;
    svg.setAttribute('viewBox', `${-m} ${-m} ${size.w + 2 * m} ${size.h + 2 * m}`);
    const points = (line ?? [[0, 1], [1, 1]]).map(([fx, fy]) => ({ x: fx * size.w, y: fy * size.h }));
    const handles = line
      ? points.map((p, i) => s('circle', {
          class: 'sort-line-point', cx: p.x, cy: p.y, r: 6 * u, 'data-point': i,
          onpointerdown: (e: PointerEvent) => drag(e, i),
        }))
      : [];
    svg.replaceChildren(
      s('svg', { x: 0, y: 0, width: size.w, height: size.h, viewBox: `0 0 ${size.w} ${size.h}`, overflow: 'hidden' },
        s('image', { href: sheet.url, x: 0, y: 0, width: size.w * sheet.columns, height: size.h * sheet.rows, preserveAspectRatio: 'none' })),
      // In front of the line: shaded, so it is plain which side counts as "in front".
      ...(line ? [s('path', { class: 'sort-line-front', d: `M 0 ${size.h} L ${points[0]!.x === 0 ? '' : `0 ${points[0]!.y} L `}${points.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${size.w} ${points.at(-1)!.y} L ${size.w} ${size.h} Z` })] : []),
      s('polyline', { class: `sort-line-line${line ? '' : ' unset'}`, points: points.map((p) => `${p.x},${p.y}`).join(' ') }),
      ...handles,
    );
    status.textContent = line
      ? `${line.length} points. Players below the line are drawn in front of it. Drag a point; click the picture to add one; double-click a point to take it away.`
      : 'Now the bottom edge of the picture is the line, which suits most things. Find the line from the picture, or click the picture to start one, for something that runs into the room at an angle.';
    clearButton.disabled = !line;
  }

  function drag(e: PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as SVGCircleElement;
    target.setPointerCapture(e.pointerId);
    const points = [...(line ?? [])];
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const p = at(ev);
      points[index] = toFraction(p);
      target.setAttribute('cx', String(p.x));
      target.setAttribute('cy', String(p.y));
      line = points;
      const poly = svg.querySelector('.sort-line-line');
      poly?.setAttribute('points', points.map(([fx, fy]) => `${fx * size.w},${fy * size.h}`).join(' '));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      // A press without a move (the first half of a double-click) changes nothing.
      if (moved) save(sortLineOf({ sort_line: points }));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  // Double-clicking a point takes it away, as long as two are left.
  svg.addEventListener('dblclick', (e) => {
    const point = (e.target as Element).closest('.sort-line-point');
    const i = Number(point?.getAttribute('data-point'));
    if (point && line && line.length > 2 && Number.isInteger(i)) save(line.filter((_, k) => k !== i));
  });

  // A click on the picture adds a point there; the first click starts from the bottom edge.
  svg.addEventListener('click', (e) => {
    if ((e.target as Element).classList.contains('sort-line-point')) return;
    const p = toFraction(at(e));
    save(sortLineOf({ sort_line: [...(line ?? [[0, 1], [1, 1]]), p] }));
  });

  async function find() {
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = sheet.url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(image, 0, 0, size.w, size.h, 0, 0, size.w, size.h);
      const found = findSortLine(g.getImageData(0, 0, size.w, size.h).data, size.w, size.h);
      if (!found) return toast('The picture has nothing solid in it to find a line from.', 'error');
      save(found);
    } catch {
      toast('This picture cannot be read here (it is on a site that does not allow it): click on it to draw the line instead.', 'error');
    }
  }

  void (async () => {
    const frames = await framesOf(store, media).catch(() => null);
    if (frames) sheet = { url: frames.url, columns: frames.columns, rows: frames.rows };
    const image = new Image();
    image.src = sheet.url;
    try {
      await image.decode();
    } catch {
      return;
    }
    size = { w: Math.floor(image.naturalWidth / sheet.columns), h: Math.floor(image.naturalHeight / sheet.rows) };
    draw();
  })();

  box.append(
    h('div', { class: 'field-label' }, 'Where it meets the floor', help('For something that runs into the room at an angle, such as a counter or a bench seen from the side: draw the line along its base. Players in front of the line are drawn in front of it, and characters behind it (someone serving at the counter) behind, wherever they stand across it.')),
    svg, status, h('div', { class: 'row-actions' }, findButton, clearButton),
  );
  draw();
  return box;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

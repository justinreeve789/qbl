import { AUTOMATIC_ANIMATIONS, BUILT_IN_MOVES } from '@qbl/shared';
import type { Row } from '../api';
import { mediaUrl, params } from '../describe';
import { confirmDelete, h } from '../dom';
import type { FormContext } from '../fields';

interface Sheet { columns: number; rows: number; count?: number }
interface Animation { name: string; frames: number[]; duration?: number; repeat?: boolean }

/** Which animation of each sheet frames are being picked for. Kept outside the view so a redraw does not lose it. */
const editing = new Map<number, number>();
const SUGGESTED = [...AUTOMATIC_ANIMATIONS, ...Object.keys(BUILT_IN_MOVES)];

/**
 * A picture as a sprite sheet: how many frames across and down, and the animations made of
 * those frames. The sheet is shown with its grid; clicking frames puts them, in order, into
 * the animation being edited, and they light up with their place in it. A small preview plays it.
 */
export function sheetEditor(ctx: FormContext, media: Row): HTMLElement {
  const { store } = ctx;
  const id = media.id;
  const url = mediaUrl(store, media) ?? '';
  const current = () => params(store.byId('media', id) ?? media);
  const sheet = current().sheet as Sheet | undefined;
  const animations = () => ((current().animations as Animation[] | undefined) ?? []).map((a) => ({ ...a, frames: [...(a.frames ?? [])] }));
  const save = (next: { sheet?: Sheet | null; animations?: Animation[] }, structural = true) => {
    const p = { ...current(), ...next } as Record<string, unknown>;
    if (!p.sheet) {
      delete p.sheet;
      delete p.animations;
    }
    return store.patch('media', id, { params: p }, structural);
  };

  const number = (value: number | undefined, label: string, key: 'columns' | 'rows') => {
    const input = h('input', {
      type: 'number', min: 1, max: 64, step: 1, value: value ?? '', placeholder: '1',
      onchange: () => {
        const n = Math.max(1, Math.min(64, Math.round(Number(input.value) || 1)));
        const next = { columns: sheet?.columns ?? 1, rows: sheet?.rows ?? 1, [key]: n };
        // One frame across and one down is an ordinary picture again.
        void save({ sheet: next.columns * next.rows > 1 ? next : null });
      },
    });
    return h('label', { class: 'field', 'data-field': key }, h('span', { class: 'field-label' }, label), input);
  };
  const grid = h('div', { class: 'form' }, number(sheet?.columns, 'Frames across', 'columns'), number(sheet?.rows, 'Frames down', 'rows'));
  if (!sheet) return h('div', { class: 'sheet-editor' }, grid, h('p', { class: 'muted' }, 'A sprite sheet is one picture holding the frames of its animations in a grid. Say how many frames it has across and down to define animations on it. An animated PNG is laid out as a sheet when you upload it.'));

  const list = animations();
  const count = sheet.count ?? sheet.columns * sheet.rows;
  const chosen = Math.min(editing.get(id) ?? 0, Math.max(0, list.length - 1));
  const active = list[chosen];

  // ---- the sheet, with a button over every frame
  const cells = Array.from({ length: sheet.columns * sheet.rows }, (_, frame) => {
    const places = active ? active.frames.flatMap((f, i) => (f === frame ? [i + 1] : [])) : [];
    return h('button', {
      type: 'button', class: `sheet-cell${places.length ? ' in' : ''}`, disabled: frame >= count || !active, 'data-frame': frame,
      title: active ? `Frame ${frame}: click to ${places.length ? 'take it out of' : 'add it to'} “${active.name}”. Shift-click adds every frame up to it.` : `Frame ${frame}`,
      onclick: (e: MouseEvent) => {
        if (!active) return;
        const frames = [...active.frames];
        if (e.shiftKey && frames.length) {
          // Every frame from the last one picked to this one, in order.
          const from = frames[frames.length - 1]!;
          for (let f = from + Math.sign(frame - from); f !== frame + Math.sign(frame - from) && f !== from; f += Math.sign(frame - from)) frames.push(f);
        } else if (places.length) {
          for (let i = frames.length - 1; i >= 0; i--) if (frames[i] === frame) frames.splice(i, 1);
        } else {
          frames.push(frame);
        }
        void save({ animations: list.map((a, i) => (i === chosen ? { ...a, frames } : a)) });
      },
    }, h('span', { class: 'sheet-number' }, String(frame)), places.length ? h('span', { class: 'sheet-place' }, places.join(',')) : null);
  });
  const picture = h('div', { class: 'sheet-picture' }, h('img', { src: url, alt: '' }), h('div', { class: 'sheet-cells', style: `grid-template-columns:repeat(${sheet.columns},1fr);grid-template-rows:repeat(${sheet.rows},1fr)` }, ...cells));

  // ---- a preview of the animation being edited, at its own speed
  const preview = h('div', { class: 'sheet-preview', title: 'How it plays' });
  if (active?.frames.length) {
    preview.style.backgroundImage = `url("${url}")`;
    preview.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    const probe = new Image();
    probe.onload = () => (preview.style.aspectRatio = `${probe.naturalWidth / sheet.columns} / ${probe.naturalHeight / sheet.rows}`);
    probe.src = url;
    let step = 0;
    const show = () => {
      const frame = active.frames[step % active.frames.length]!;
      const col = frame % sheet.columns;
      const row = Math.floor(frame / sheet.columns);
      preview.style.backgroundPosition = `${sheet.columns > 1 ? (col / (sheet.columns - 1)) * 100 : 0}% ${sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0}%`;
      preview.dataset.frame = String(frame);
      step++;
    };
    show();
    const timer = window.setInterval(() => (preview.isConnected ? show() : window.clearInterval(timer)), Math.max(30, (active.duration ?? active.frames.length * 100) / active.frames.length));
  }

  // ---- the animations
  const options = h('datalist', { id: `sheet-names-${id}` }, ...SUGGESTED.map((n) => h('option', { value: n })));
  const rows = list.map((animation, index) => {
    const change = (attrs: Partial<Animation>, structural = false) => void save({ animations: animations().map((a, i) => (i === index ? { ...a, ...attrs } : a)) }, structural);
    const name = h('input', {
      type: 'text', value: animation.name, list: `sheet-names-${id}`, 'aria-label': 'Animation name',
      onchange: () => change({ name: name.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '') || animation.name }, true),
    });
    const duration = h('input', {
      type: 'number', min: 30, step: 10, value: animation.duration ?? '', placeholder: String(Math.max(1, animation.frames.length) * 100), 'aria-label': 'Milliseconds for one pass',
      onchange: () => change({ duration: Number(duration.value) > 0 ? Number(duration.value) : undefined }, true),
    });
    const repeat = h('select', { 'aria-label': 'Repeats', onchange: () => change({ repeat: repeat.value === '' ? undefined : repeat.value === 'yes' }) },
      h('option', { value: '' }, 'By its name'), h('option', { value: 'yes' }, 'Loops'), h('option', { value: 'no' }, 'Plays once'));
    repeat.value = animation.repeat == null ? '' : animation.repeat ? 'yes' : 'no';
    return h(
      'div',
      { class: `sheet-animation${index === chosen ? ' editing' : ''}`, 'data-animation': animation.name },
      h('button', { type: 'button', class: index === chosen ? 'primary' : null, title: 'Pick this animation’s frames on the sheet', onclick: () => { editing.set(id, index); store.emit(); } }, index === chosen ? '✏️ Picking frames' : 'Pick frames'),
      name, duration, repeat,
      h('span', { class: 'muted sheet-frames' }, animation.frames.length ? animation.frames.join(' ') : 'no frames yet'),
      h('button', { type: 'button', class: 'danger icon', title: 'Delete this animation', onclick: () => confirmDelete(`the animation “${animation.name}”`) && void save({ animations: animations().filter((_, i) => i !== index) }) }, '×'),
    );
  });
  const add = h('button', {
    type: 'button',
    onclick: () => {
      const name = SUGGESTED.find((n) => !list.some((a) => a.name === n)) ?? `animation_${list.length + 1}`;
      editing.set(id, list.length);
      void save({ animations: [...list, { name, frames: [] }] });
    },
  }, '+ Add animation');

  return h(
    'div',
    { class: 'sheet-editor' },
    grid,
    h('div', { class: 'sheet-stage' }, picture, preview),
    h('p', { class: 'muted' }, active ? `Click frames to put them into “${active.name}”, in the order they should play. “idle” plays while a figure stands and “walk” while it moves (mirrored for the other direction, unless you also define walk_left and walk_right). Any other name is played by a “Play an animation” action or a move.` : 'Add an animation, then click the frames that make it up.'),
    options,
    h('div', { class: 'sheet-animations' }, h('div', { class: 'sheet-animation head' }, h('span', null), h('span', null, 'Name'), h('span', null, 'One pass (ms)'), h('span', null, 'Repeats'), h('span', null, 'Frames'), h('span', null)), ...rows),
    add,
  );
}

import { AUTOMATIC_ANIMATIONS, BUILT_IN_MOVES, POSE_LABELS, isPose, type MediaAnimation } from '@qbl/shared';
import type { Row } from '../api';
import { framesOf, parseFrames, pictureAnimations, playersOf, syncPictureAnimations } from '../characters';
import { mediaUrl, params } from '../describe';
import { confirmDelete, h } from '../dom';
import type { FormContext } from '../fields';

interface Sheet { columns: number; rows: number; count?: number }
type Animation = MediaAnimation;

/** Which animation of each picture frames are being picked for, by name. Kept outside the view so a redraw does not lose it. */
const editing = new Map<number, string>();
const SUGGESTED = [...new Set([...AUTOMATIC_ANIMATIONS, 'stand', ...Object.keys(BUILT_IN_MOVES), 'talk', 'point', 'nod', 'cheer', 'sit', 'dig', 'portrait'])];

/** Open a picture's animation for its frames to be picked: call before opening the picture's panel. */
export function editSheetAnimation(mediaId: number, name: string) {
  editing.set(mediaId, name);
}

/** A name as an animation name: lowercase letters, digits and underscores, starting with a letter. */
const cleanName = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 32);

/**
 * The animations of a picture: where every animation is defined, for characters, items, vehicles
 * and pictures in scenes alike. A sprite sheet says how many frames it has across and down; an
 * animated PNG has its frames already. Each animation is a name and frames in the order they play,
 * typed ("0 1 2", "0-3", a frame more than once) or clicked on the picture, with its speed and
 * whether it loops. A character plays one of them by name (on the Characters page), and takes any
 * change made here.
 */
export function sheetEditor(ctx: FormContext, media: Row): HTMLElement {
  const { store } = ctx;
  const id = media.id;
  const url = mediaUrl(store, media) ?? '';
  const current = () => params(store.byId('media', id) ?? media);
  const sheet = current().sheet as Sheet | undefined;
  const apng = current().apng as { frames: number; duration: number } | undefined;
  const animations = (): Animation[] => pictureAnimations(store.byId('media', id) ?? media).map((a) => ({ ...a, frames: [...(a.frames ?? [])] }));
  const save = async (next: { sheet?: Sheet | null; animations?: Animation[] }, structural = true, renames: Record<string, string> = {}) => {
    const p = { ...current(), ...next } as Record<string, unknown>;
    if (!p.sheet) delete p.sheet;
    if (!p.sheet && !p.apng) delete p.animations;
    if (Array.isArray(p.animations) && !p.animations.length) delete p.animations;
    const saved = store.patch('media', id, { params: p }, structural);
    // The characters playing these animations take the change, in the same step.
    syncPictureAnimations(store, id, renames);
    await saved;
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
  const grid = apng ? null : h('div', { class: 'form' }, number(sheet?.columns, 'Frames across', 'columns'), number(sheet?.rows, 'Frames down', 'rows'));
  if (!sheet && !apng) {
    return h('div', { class: 'sheet-editor' }, grid, h('p', { class: 'muted' }, 'A sprite sheet is one picture holding frames in a grid. Say how many frames it has across and down, then make its animations here: a character’s walk and moves, an item’s idle. Characters play them by name on the Characters page.'));
  }

  const list = animations();
  const count = sheet ? sheet.count ?? sheet.columns * sheet.rows : apng!.frames;
  const wanted = editing.get(id);
  const chosen = Math.max(0, list.findIndex((a) => a.name === wanted));
  const active = list[chosen];
  const players = playersOf(store, id);
  const commitFrames = (frames: number[]) => void save({ animations: list.map((a, i) => (i === chosen ? { ...a, frames } : a)) });

  // ---- the frames, with a button over every one; and a preview of the animation being edited, at its own speed
  const stage = h('div', { class: 'sheet-stage' });
  const draw = (frames: { url: string; columns: number; rows: number }) => {
    const cells = Array.from({ length: frames.columns * frames.rows }, (_, frame) => {
      const places = active ? active.frames.flatMap((f, i) => (f === frame ? [i + 1] : [])) : [];
      return h('button', {
        type: 'button', class: `sheet-cell${places.length ? ' in' : ''}`, disabled: frame >= count || !active, 'data-frame': frame,
        title: active ? `Frame ${frame}: click to ${places.length ? 'take it out of' : 'add it to'} “${active.name}”. Shift-click adds every frame up to it.` : `Frame ${frame}`,
        onclick: (e: MouseEvent) => {
          if (!active) return;
          const picked = [...active.frames];
          if (e.shiftKey && picked.length) {
            // Every frame from the last one picked to this one, in order.
            const from = picked[picked.length - 1]!;
            const step = Math.sign(frame - from);
            for (let f = from + step; step !== 0 && f !== frame + step; f += step) picked.push(f);
          } else if (places.length) {
            for (let i = picked.length - 1; i >= 0; i--) if (picked[i] === frame) picked.splice(i, 1);
          } else {
            picked.push(frame);
          }
          commitFrames(picked);
        },
      }, h('span', { class: 'sheet-number' }, String(frame)), places.length ? h('span', { class: 'sheet-place' }, places.join(',')) : null);
    });
    const picture = h('div', { class: 'sheet-picture', style: apng ? `max-width:${Math.max(240, frames.columns * 120)}px` : null },
      h('img', { src: frames.url, alt: '' }),
      h('div', { class: 'sheet-cells', style: `grid-template-columns:repeat(${frames.columns},1fr);grid-template-rows:repeat(${frames.rows},1fr)` }, ...cells));

    const preview = h('div', { class: 'sheet-preview', title: 'How it plays' });
    if (active?.frames.length) {
      preview.style.backgroundImage = `url("${frames.url}")`;
      preview.style.backgroundSize = `${frames.columns * 100}% ${frames.rows * 100}%`;
      const probe = new Image();
      probe.onload = () => (preview.style.aspectRatio = `${probe.naturalWidth / frames.columns} / ${probe.naturalHeight / frames.rows}`);
      probe.src = frames.url;
      let step = 0;
      const show = () => {
        const frame = active.frames[step % active.frames.length]!;
        const col = frame % frames.columns;
        const row = Math.floor(frame / frames.columns);
        preview.style.backgroundPosition = `${frames.columns > 1 ? (col / (frames.columns - 1)) * 100 : 0}% ${frames.rows > 1 ? (row / (frames.rows - 1)) * 100 : 0}%`;
        preview.dataset.frame = String(frame);
        step++;
      };
      show();
      const timer = window.setInterval(() => (preview.isConnected ? show() : window.clearInterval(timer)), Math.max(30, (active.duration ?? active.frames.length * 100) / active.frames.length));
    }
    stage.replaceChildren(picture, preview);
  };
  // A sheet's frames are its grid, at once; an animated PNG's are cut from it in the browser.
  if (sheet) draw({ url, columns: sheet.columns, rows: sheet.rows });
  else void framesOf(store, store.byId('media', id) ?? media).then((frames) => frames && draw(frames));

  // ---- the animations
  const options = h('datalist', { id: `sheet-names-${id}` }, ...SUGGESTED.filter((n) => !list.some((a) => a.name === n)).map((n) => h('option', { value: n })));
  const rows = list.map((animation, index) => {
    const change = (attrs: Partial<Animation>, structural = false, renames: Record<string, string> = {}) =>
      void save({ animations: animations().map((a, i) => (i === index ? { ...a, ...attrs } : a)) }, structural, renames);
    const name = h('input', {
      type: 'text', value: animation.name, list: `sheet-names-${id}`, 'aria-label': 'Animation name', class: 'sheet-name',
      onchange: () => {
        const next = cleanName(name.value) || animation.name;
        if (next !== animation.name && list.some((a) => a.name === next)) {
          name.value = animation.name;
          return;
        }
        if (editing.get(id) === animation.name) editing.set(id, next);
        change({ name: next }, true, next === animation.name ? {} : { [animation.name]: next });
      },
    });
    const frames = h('input', {
      type: 'text', value: animation.frames.join(' '), placeholder: '0 1 2 or 0-3', 'aria-label': 'Frames, in order', class: 'sheet-frames',
      title: 'The frames in the order they play: “0 1 2”, “0-3”, or a frame more than once, “0 1 1 2”. Or click them on the picture.',
      onchange: () => change({ frames: parseFrames(frames.value).filter((f) => f < count) }, true),
    });
    const duration = h('input', {
      type: 'number', min: 30, step: 10, value: animation.duration ?? '', placeholder: String(Math.max(1, animation.frames.length) * 100), 'aria-label': 'Milliseconds for one pass',
      onchange: () => change({ duration: Number(duration.value) > 0 ? Number(duration.value) : undefined }, true),
    });
    const repeat = h('select', { 'aria-label': 'Repeats', onchange: () => change({ repeat: repeat.value === '' ? undefined : repeat.value === 'yes' }, true) },
      h('option', { value: '' }, 'Usual'), h('option', { value: 'yes' }, 'Loops'), h('option', { value: 'no' }, 'Plays once'));
    repeat.value = animation.repeat == null ? '' : animation.repeat ? 'yes' : 'no';
    const users = players.get(animation.name) ?? [];
    return h(
      'div',
      { class: `sheet-animation${index === chosen ? ' editing' : ''}`, 'data-animation': animation.name },
      h('button', { type: 'button', class: index === chosen ? 'primary' : null, title: 'Pick this animation’s frames on the picture', onclick: () => { editing.set(id, animation.name); store.emit(); } }, index === chosen ? '✏️ Picking' : 'Pick frames'),
      name, frames, duration, repeat,
      h('button', {
        type: 'button', class: 'danger icon', title: 'Delete this animation',
        onclick: () => confirmDelete(`the animation “${animation.name}”${users.length ? `. ${usedBy(users)} play${users.length === 1 ? 's' : ''} it and will keep the frames it has until you choose another` : ''}`)
          && void save({ animations: animations().filter((_, i) => i !== index) }),
      }, '×'),
      users.length ? h('span', { class: 'sheet-users muted small' }, `🎭 ${usedBy(users)}`) : null,
    );
  });
  const add = h('button', {
    type: 'button',
    onclick: () => {
      const name = SUGGESTED.find((n) => !list.some((a) => a.name === n)) ?? `animation_${list.length + 1}`;
      editing.set(id, name);
      void save({ animations: [...list, { name, frames: [] }] });
    },
  }, '+ Add animation');

  return h(
    'div',
    { class: 'sheet-editor' },
    grid,
    apng ? h('p', { class: 'media-apng' }, `Animated PNG: ${apng.frames} frames, ${apng.duration} ms. Shown anywhere else, it plays by itself, whole. Its animations here are runs of its frames for characters to play.`) : null,
    stage,
    h('p', { class: 'muted' }, active
      ? `Click frames to put them into “${active.name}”, in the order they play, or type their numbers. A character plays any of these by name, chosen on the Characters page. For an item or vehicle, “idle” plays while it stands and “walk” while it is ridden (mirrored for the other direction, unless you also define walk_left and walk_right); any other name is played by a “Play an animation” action.`
      : 'Add an animation, then click the frames that make it up, or type their numbers.'),
    options,
    h('div', { class: 'sheet-animations' }, h('div', { class: 'sheet-animation head' }, h('span', null), h('span', null, 'Name'), h('span', null, 'Frames'), h('span', null, 'One pass (ms)'), h('span', null, 'Repeats'), h('span', null)), ...rows),
    add,
  );
}

/** "Old Toad (Walking right), Fox (hop)" */
function usedBy(users: Array<{ row: Row; name: string }>): string {
  return users.map(({ row, name }) => `${String(row.name)} (${isPose(name) ? POSE_LABELS[name] : name})`).join(', ');
}

import {
  animationDuration, animationFrames, BUILT_IN_MOVES, CHARACTER_POSES, characterAnimationRepeats, isPose, POSE_LABELS, resolvePortrait, resolvePose,
  type CharacterAnimation, type CharacterPose,
} from '@qbl/shared';
import type { Row } from '../api';
import { animationPreview, characterOf, framePosition, framesOf, mediaOf, parseFrames, storedAnimations } from '../characters';
import { mediaLabel, mediaUrl, params } from '../describe';
import { confirmDelete, fold, h, help, toast } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { CHARACTER_FIELDS, CHARACTER_SETTINGS_FIELDS } from '../schema';
import { rowConditions } from './conditions';

type Animations = Record<string, CharacterAnimation>;

/** Which animation of each character frames are being picked for. Kept outside the view so a redraw does not lose it. */
const picking = new Map<number, string>();

/** Names offered for a new animation: the built-in moves (frames drawn for one replace the built-in version) and a few more. */
const SUGGESTED = [...Object.keys(BUILT_IN_MOVES), 'talk', 'point', 'nod', 'cheer', 'sit', 'dig'];

/**
 * The Characters page: the people and creatures players meet. Each is drawn from its animations:
 * the five poses the game shows by itself (standing and walking each way, and the close-up in a
 * story box) and any others an action or a move plays by name. Each animation is a picture of the
 * scenario's, a still image, an animated PNG or a sprite sheet, and the frames of it to play. One
 * sheet can serve several characters, each taking its own frames.
 */
export function charactersPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const cards = store.rows('characters').map((row) => characterCard(ctx, row));
  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Characters', help('People and creatures players meet. Define them here, then place them in scenes, where clicking one can run an event. A character is drawn from its animations: give it a picture standing facing right and it can already stand, walk and turn (mirrored); add walking frames, the other side, a close-up and moves as you have them.'))),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'primary', onclick: () => void store.add('characters', { name: 'New character' }) }, 'New character'))),
    cards.length ? h('div', { class: 'grid characters' }, ...cards) : h('p', { class: 'empty' }, 'No characters yet.'),
  );
}

function characterCard(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const animations: Animations = character.animations ?? {};
  const legacy = !storedAnimations(row) && Object.keys(animations).length > 0;
  const stand = resolvePose(character, false, 'right');
  const close = resolvePortrait(character);

  return h(
    'div',
    { class: 'card character-card', 'data-thing': `characters-${id}` },
    h('div', { class: 'card-title' }, h('strong', null, String(row.name)), h('span', { class: 'muted' }, `#${id}`)),
    h('div', { class: 'character-stage' },
      h('figure', null, animationPreview(store, stand?.animation, 'anim-preview large', stand ? stand.flip !== (stand.animation.flip === true) : false), h('figcaption', null, 'Standing')),
      h('figure', { class: 'portrait-figure' }, animationPreview(store, close?.animation, 'anim-preview portrait', close ? close.flip !== (close.animation.flip === true) : false), h('figcaption', null, 'Portrait'))),
    form(CHARACTER_FIELDS, row, (key, value) => void store.patch('characters', id, { [key]: value }), ctx),
    fold(`character-animations-${id}`, `🎞️ Animations (${Object.keys(animations).length})`, true,
      animationsTable(ctx, row, animations),
      legacy ? h('p', { class: 'muted' }, 'Read from the character’s picture and close-up. Changing anything here saves them as animations.') : null),
    form(CHARACTER_SETTINGS_FIELDS, params(row, 'settings'), (key, value, field) => void store.patch('characters', id, { settings: withValue(params(store.byId('characters', id)!, 'settings'), key, value, field) }, field.structural === true), ctx),
    rowConditions(ctx, 'character_id', id, 'Present only when', 'Always present.'),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(`the character “${row.name}”`) && void store.remove('characters', id) }, 'Delete')),
  );
}

/** Save a character's animations. A row of the older shape becomes animations only: its picture and close-up are now in them. */
async function save(ctx: FormContext, id: number, next: Animations, structural = true) {
  const { store } = ctx;
  const row = store.byId('characters', id);
  if (!row) return;
  const settings = { ...params(row, 'settings') };
  delete settings.portrait_media_id;
  if (Object.keys(next).length) settings.animations = next;
  else delete settings.animations;
  const hadPortrait = !!current(ctx, row).portrait;
  await store.patch('characters', id, { media_id: null, settings }, structural);
  // A character given its first standing picture gets a close-up cut from the top of it, unless it has one.
  const standing = next.stand_right ?? next.stand_left;
  if (!hadPortrait && !next.portrait && standing) void makePortrait(ctx, id, standing);
}

function current(ctx: FormContext, row: Row): Animations {
  return { ...(characterOf(ctx.store, row).animations ?? {}) };
}

function animationsTable(ctx: FormContext, row: Row, animations: Animations): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const images = store.rows('media').filter((m) => m.type === 'image');
  const change = (name: string, next: CharacterAnimation | null, structural = true) => {
    const all = current(ctx, store.byId('characters', id) ?? row);
    if (next) all[name] = next;
    else delete all[name];
    void save(ctx, id, all, structural);
  };
  const names = [...CHARACTER_POSES, ...Object.keys(animations).filter((n) => !isPose(n))];
  const pickingName = picking.get(id);

  const rows = names.map((name) => {
    const animation = animations[name];
    const pose = isPose(name) ? (name as CharacterPose) : null;
    const label = pose ? h('span', { class: 'anim-name' }, POSE_LABELS[pose], h('code', null, name)) : h('span', { class: 'anim-name' }, h('code', null, name));
    const picture = h('select', {
      'aria-label': `Picture for ${name}`, class: 'anim-picture',
      onchange: () => {
        const mediaId = Number(picture.value);
        if (!picture.value) return change(name, null);
        // A new picture starts with all its frames; the rest of the animation's settings stay.
        change(name, { ...(animation ?? {}), media_id: mediaId, frames: undefined });
      },
    },
    h('option', { value: '' }, pose ? (animation ? '(none)' : 'Choose a picture…') : '(remove)'),
    ...images.map((m) => h('option', { value: m.id, selected: animation?.media_id === m.id }, `${mediaLabel(m)}${params(m).sheet ? ' (sheet)' : params(m).apng ? ' (animated)' : ''}`)));

    if (!animation) {
      // A pose left out is filled in from another, as the game does.
      const facing = name.endsWith('_left') ? 'left' : 'right';
      const fallback = name === 'portrait' ? resolvePortrait(character) : resolvePose(character, name.startsWith('walk'), facing);
      return h('div', { class: 'anim-row empty', 'data-animation': name },
        animationPreview(store, fallback?.animation, 'anim-preview', fallback ? fallback.flip !== (fallback.animation.flip === true) : false),
        label, picture,
        h('span', { class: 'muted anim-uses' }, fallback ? `Uses ${POSE_LABELS[fallback.name as CharacterPose] ?? fallback.name}${fallback.flip !== (fallback.animation.flip === true) ? ', mirrored' : ''}` : 'Nothing to show yet'));
    }

    const mediaRow = store.byId('media', animation.media_id);
    const media = mediaRow ? mediaOf(mediaRow) : undefined;
    const frames = animationFrames(animation, media);
    const framesInput = h('input', {
      type: 'text', value: animation.frames?.join(' ') ?? '', placeholder: frames ? `Frames: all ${frames.length}` : '', 'aria-label': 'Frames, in order: 0 1 2 or 0-3', title: 'Frames, in order: “0 1 2” or “0-3”', class: 'anim-frames',
      onchange: () => {
        const list = parseFrames(framesInput.value);
        change(name, { ...animation, frames: list.length ? list : undefined }, false);
      },
    });
    const duration = h('input', {
      type: 'number', min: 30, step: 10, value: animation.duration ?? '', 'aria-label': 'Milliseconds for one pass', title: 'Milliseconds one pass takes', class: 'anim-duration',
      placeholder: frames ? `${animationDuration({ ...animation, duration: undefined }, media)} ms` : '',
      onchange: () => change(name, { ...animation, duration: Number(duration.value) > 0 ? Number(duration.value) : undefined }, false),
    });
    const repeat = h('select', { 'aria-label': 'Repeats', onchange: () => change(name, { ...animation, repeat: repeat.value === '' ? undefined : repeat.value === 'yes' }, false) },
      h('option', { value: '' }, characterAnimationRepeats(name, {}) ? 'Loops (usual)' : 'Once (usual)'), h('option', { value: 'yes' }, 'Loops'), h('option', { value: 'no' }, 'Plays once'));
    repeat.value = animation.repeat == null ? '' : animation.repeat ? 'yes' : 'no';
    const mirror = h('input', { type: 'checkbox', checked: animation.flip === true, onchange: () => change(name, { ...animation, flip: mirror.checked || undefined }) });
    return h('div', { class: `anim-row${pickingName === name ? ' picking' : ''}`, 'data-animation': name },
      animationPreview(store, animation),
      label, picture,
      frames ? h('span', { class: 'anim-timing' }, framesInput, duration, repeat) : h('span', { class: 'muted anim-still' }, 'A still picture'),
      h('label', { class: 'check anim-mirror', title: 'Draw it mirrored, so art facing one way serves the other' }, mirror, h('span', null, 'Mirror')),
      frames ? h('button', { type: 'button', class: `anim-pick${pickingName === name ? ' primary' : ''}`, onclick: () => { picking.set(id, pickingName === name ? '' : name); store.emit(); } }, pickingName === name ? '✏️ Picking frames' : 'Pick frames') : null,
      pose ? null : h('button', { type: 'button', class: 'danger icon anim-delete', title: 'Delete this animation', onclick: () => confirmDelete(`the animation “${name}”`) && change(name, null) }, '×'),
    );
  });

  // A new animation: a name, and the standing picture to start from.
  const options = h('datalist', { id: `character-names-${id}` }, ...SUGGESTED.filter((n) => !animations[n]).map((n) => h('option', { value: n })));
  const newName = h('input', { type: 'text', list: `character-names-${id}`, placeholder: 'wave, dig, talk…', 'aria-label': 'Name of a new animation' });
  const add = h('button', {
    type: 'button',
    onclick: () => {
      const name = newName.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '');
      if (!name) return toast('Give the animation a name: lowercase letters, digits and underscores.', 'error');
      if (isPose(name) || animations[name]) return toast(`“${name}” is already one of this character’s animations.`, 'error');
      const from = animations.stand_right ?? animations.stand_left ?? Object.values(animations)[0];
      if (!from) return toast('Choose a picture for one of the poses first.', 'error');
      picking.set(id, name);
      change(name, { media_id: from.media_id, ...(from.frames ? { frames: [...from.frames] } : {}) });
    },
  }, '+ Add animation');

  const active = pickingName ? animations[pickingName] : undefined;
  return h('div', { class: 'anim-table' },
    ...rows,
    active ? frameGrid(ctx, id, pickingName!, active, (frames) => change(pickingName!, { ...active, frames: frames.length ? frames : undefined })) : null,
    h('div', { class: 'anim-add' }, newName, add, options),
    h('p', { class: 'muted' }, 'Standing and walking are shown by themselves, facing the way the character goes; a pose left out uses another, mirrored. The portrait is shown in story boxes. Any other animation is played by a “Play an animation” action, or by a move: one named like a built-in move (jump, wave, dance…) replaces it with your frames.'),
  );
}

/** The frames of the picture being edited, each a button: click to add it to the animation or take it out; shift-click adds every frame up to it. */
function frameGrid(ctx: FormContext, characterId: number, name: string, animation: CharacterAnimation, commit: (frames: number[]) => void): HTMLElement {
  const { store } = ctx;
  const mediaRow = store.byId('media', animation.media_id);
  const box = h('div', { class: 'frame-grid', 'data-picking': name }, h('p', { class: 'muted' }, `Click frames to put them into “${name}”, in the order they play.`));
  void framesOf(store, mediaRow).then((sheet) => {
    if (!sheet) return;
    const chosen = animation.frames ?? [];
    const cells = Array.from({ length: sheet.columns * sheet.rows }, (_, frame) => {
      const places = chosen.flatMap((f, i) => (f === frame ? [i + 1] : []));
      const cell = h('button', {
        type: 'button', class: `sheet-cell${places.length ? ' in' : ''}`, disabled: frame >= sheet.count, 'data-frame': frame,
        title: `Frame ${frame}`,
        onclick: (e: MouseEvent) => {
          const frames = [...(animation.frames ?? [])];
          if (e.shiftKey && frames.length) {
            const from = frames[frames.length - 1]!;
            const step = Math.sign(frame - from);
            for (let f = from + step; step !== 0 && f !== frame + step; f += step) frames.push(f);
          } else if (places.length) {
            for (let i = frames.length - 1; i >= 0; i--) if (frames[i] === frame) frames.splice(i, 1);
          } else frames.push(frame);
          commit(frames);
        },
      }, h('span', { class: 'sheet-number' }, String(frame)), places.length ? h('span', { class: 'sheet-place' }, places.join(',')) : null);
      return cell;
    });
    box.append(h('div', { class: 'sheet-picture' }, h('img', { src: sheet.url, alt: '' }), h('div', { class: 'sheet-cells', style: `grid-template-columns:repeat(${sheet.columns},1fr);grid-template-rows:repeat(${sheet.rows},1fr)` }, ...cells)));
  });
  box.dataset.character = String(characterId);
  return box;
}

// ----------------------------------------------------------------- portraits

/**
 * Make a close-up from a standing animation: the top third of its first frame, where the face
 * usually is, saved as a new image in the scenario's media and made the portrait. Nothing
 * happens when the picture cannot be read (one on another site that does not allow it): the
 * character standing then stands in for the portrait.
 */
async function makePortrait(ctx: FormContext, characterId: number, standing: CharacterAnimation): Promise<void> {
  const { store } = ctx;
  const media = store.byId('media', standing.media_id);
  const url = media ? mediaUrl(store, media) : null;
  if (!media || !url || media.type !== 'image') return;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();
    const m = mediaOf(media);
    const columns = m.sheet?.columns ?? 1;
    const rows = m.sheet?.rows ?? 1;
    const width = Math.floor(image.naturalWidth / columns);
    const frameHeight = Math.floor(image.naturalHeight / rows);
    const frame = (m.sheet ? animationFrames(standing, m)?.[0] : 0) ?? 0;
    const height = Math.max(1, Math.round(frameHeight / 3));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, (frame % columns) * width, Math.floor(frame / columns) * frameHeight, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const row = await store.api.upload(store.scenarioId, new File([blob], `${mediaLabel(media).replace(/\.[a-z0-9]+$/i, '')}-portrait.png`, { type: 'image/png' }));
    store.bundle.media.push(row);
    await store.patch('media', row.id, { params: { ...params(row), category: 'character' } });
    const character = store.byId('characters', characterId);
    if (!character) return;
    const all = { ...(characterOf(store, character).animations ?? {}) };
    if (all.portrait) return; // one was chosen meanwhile
    all.portrait = { media_id: row.id };
    await store.patch('characters', characterId, { settings: { ...params(character, 'settings'), animations: all } }, true);
    toast('A close-up portrait was made from the top of the picture. You can choose another.');
  } catch {
    /* the standing picture stands in */
  }
}

/** Where a frame of a sheet is: exported for the scene editor's drawing of a character. */
export { framePosition };

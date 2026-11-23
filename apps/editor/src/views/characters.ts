import {
  animationDuration, animationFrames, BUILT_IN_MOVES, CHARACTER_POSES, characterAnimationRepeats, isPose, POSE_LABELS, resolvePortrait, resolvePose,
  type CharacterAnimation, type CharacterPose,
} from '@qbl/shared';
import type { Row } from '../api';
import { animationPreview, characterOf, framePosition, framesOf, mediaOf, parseFrames, storedAnimations } from '../characters';
import { checkFeet, mirror, sheetOf, walkCycle, WALK_DURATION, WALK_FRAMES, type Bitmap } from '@qbl/shared';
import { mediaLabel, mediaUrl, params } from '../describe';
import { confirmDelete, h, help, toast } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { openPanel } from '../panel';
import { CHARACTER_FIELDS, CHARACTER_SETTINGS_FIELDS } from '../schema';
import { rowConditions } from './conditions';
import { keepInLibraryButton, openQuestLab } from './questlab';
import { gettingAround } from './routine';
import { recordAllButton, voiceSection } from './voices';

type Animations = Record<string, CharacterAnimation>;

/** Names offered for a new animation: the built-in moves (frames drawn for one replace the built-in version) and a few more. */
const SUGGESTED = [...Object.keys(BUILT_IN_MOVES), 'talk', 'point', 'nod', 'cheer', 'sit', 'dig'];

/** Each kind of animation has a colour, the same on the card, in the list and on its own panel. */
type Tone = 'stand' | 'walk' | 'portrait' | 'move';
const toneOf = (name: string): Tone => (name.startsWith('stand') ? 'stand' : name.startsWith('walk') ? 'walk' : name === 'portrait' ? 'portrait' : 'move');
const SHORT: Record<CharacterPose, string> = { stand_right: 'Stand →', stand_left: '← Stand', walk_right: 'Walk →', walk_left: '← Walk', portrait: 'Portrait' };
const labelOf = (name: string) => (isPose(name) ? POSE_LABELS[name] : name);

const ABOUT_ANIMATIONS = 'Standing and walking are shown by themselves, facing the way the character goes; a pose left out uses another, mirrored. The portrait is shown in story boxes. Any other animation is played by a “Play an animation” action, or by a move: one named like a built-in move (jump, wave, dance…) replaces it with your frames.';

/**
 * The Characters page: the people and creatures players meet. Each is drawn from its animations:
 * the five poses the game shows by itself (standing and walking each way, and the close-up in a
 * story box) and any others an action or a move plays by name. Each animation is a picture of the
 * scenario's, a still image, an animated PNG or a sprite sheet, and the frames of it to play. One
 * sheet can serve several characters, each taking its own frames.
 *
 * The page shows each character as a card; everything about one opens in a pop-up panel, and
 * each of its animations in a panel of its own over that, so frames are picked with room to see them.
 */
export function charactersPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const cards = store.rows('characters').map((row) => characterCard(ctx, row));
  const add = async () => {
    const row = await store.add('characters', { name: 'New character' });
    if (row) openCharacter(ctx, row.id);
  };
  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Characters', h('span', { class: 'count' }, String(cards.length)), help('People and creatures players meet. Define them here, then place them in scenes, where clicking one can run an event. A character is drawn from its animations: give it a picture standing facing right and it can already stand, walk and turn (mirrored); add walking frames, the other side, a close-up and moves as you have them. Click a character to edit it.'))),
      h('div', { class: 'row-actions' }, cards.length ? recordAllButton(ctx) : null, questLabButton(ctx), h('button', { type: 'button', class: 'primary', onclick: () => void add() }, 'New character'))),
    cards.length
      ? h('div', { class: 'grid characters' }, ...cards)
      : h('div', { class: 'empty' }, h('p', null, 'No characters yet. Make your own, or start from a ready-made one.'), questLabButton(ctx)),
  );
}

/** Opens the QuestLab asset library: ready-made animals to add to the scenario. */
function questLabButton(ctx: FormContext): HTMLElement {
  return h('button', { type: 'button', class: 'questlab-open', 'data-open': 'questlab', title: 'Ready-made characters, with their pictures and animations', onclick: () => openQuestLab(ctx, { kinds: ['character'], open: (row) => openCharacter(ctx, row.id) }) }, '🐾 Add QuestLab Assets');
}

function characterCard(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const animations: Animations = character.animations ?? {};
  const stand = resolvePose(character, false, 'right');
  const close = resolvePortrait(character);
  const others = Object.keys(animations).filter((n) => !isPose(n));
  const conditions = store.where('conditions', 'character_id', id).length;
  const settings = params(row, 'settings');
  const steps = ((settings.routine as { steps?: unknown[] } | undefined)?.steps ?? []).length;
  const open = () => openCharacter(ctx, id);

  return h(
    'div',
    { class: 'card character-card', 'data-thing': `characters-${id}` },
    h('button', { type: 'button', class: 'character-stage', title: `Edit ${row.name}`, 'aria-label': `Edit ${row.name}`, onclick: open },
      h('figure', null, animationPreview(store, stand?.animation, 'anim-preview large', stand ? stand.flip !== (stand.animation.flip === true) : false), h('figcaption', null, 'Standing')),
      h('figure', { class: 'portrait-figure' }, animationPreview(store, close?.animation, 'anim-preview portrait', close ? close.flip !== (close.animation.flip === true) : false), h('figcaption', null, 'Portrait'))),
    h('div', { class: 'card-title' }, h('strong', null, String(row.name)), h('span', { class: 'muted' }, `#${id}`)),
    h('div', { class: 'chips poses' },
      ...CHARACTER_POSES.map((pose) => h('span', {
        class: `chip pose${animations[pose] ? ' set' : ''}`, 'data-tone': toneOf(pose), 'data-pose': pose,
        title: animations[pose] ? `${POSE_LABELS[pose]}: drawn` : `${POSE_LABELS[pose]}: not drawn, another pose stands in`,
      }, animations[pose] ? '✓ ' : '', SHORT[pose])),
      others.length ? h('span', { class: 'chip pose set', 'data-tone': 'move', title: others.join(', ') }, `✨ ${others.length} more`) : null,
      conditions ? h('span', { class: 'chip cond', title: 'Only in the scene while its conditions hold' }, `🔒 ${conditions} condition${conditions === 1 ? '' : 's'}`) : null,
      settings.roams === true || steps ? h('span', { class: 'chip roams', title: 'Walks around on its own, the same for everyone' }, steps ? `🗺️ Routine of ${steps}` : '🗺️ Walks around') : null),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'primary', 'data-open': 'character', onclick: open }, '✏️ Edit character'),
      stand ? makeWalkButton(ctx, id, '🚶 Make walk') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(`the character “${row.name}”`) && void store.remove('characters', id) }, 'Delete')),
  );
}

// ---------------------------------------------------------- character panel

/** Everything about one character, in a pop-up: who it is on one side, its animations on the other. */
export function openCharacter(ctx: FormContext, id: number) {
  const { store } = ctx;
  openPanel({
    key: `character-${id}`,
    kind: 'character',
    store,
    tone: 'var(--tone-character)',
    title: () => {
      const row = store.byId('characters', id);
      return row ? h('span', null, String(row.name || 'Unnamed character'), h('small', { class: 'muted' }, ` #${id}`)) : null;
    },
    body: () => {
      const row = store.byId('characters', id);
      return row ? characterBody(ctx, row) : null;
    },
  });
}

function characterBody(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const animations: Animations = character.animations ?? {};
  const legacy = !storedAnimations(row) && Object.keys(animations).length > 0;
  const stand = resolvePose(character, false, 'right');
  const walk = resolvePose(character, true, 'right');
  const close = resolvePortrait(character);
  const mirrored = (r: ReturnType<typeof resolvePose>) => (r ? r.flip !== (r.animation.flip === true) : false);

  const side = h('section', { class: 'panel-section character-side', style: '--tone: var(--tone-character)' },
    h('h3', { class: 'section-head' }, '🪪 Character'),
    h('div', { class: 'character-stage big' },
      h('figure', null, animationPreview(store, stand?.animation, 'anim-preview large', mirrored(stand)), h('figcaption', null, 'Standing')),
      h('figure', null, animationPreview(store, walk?.animation, 'anim-preview large', mirrored(walk)), h('figcaption', null, 'Walking')),
      h('figure', { class: 'portrait-figure' }, animationPreview(store, close?.animation, 'anim-preview portrait', mirrored(close)), h('figcaption', null, 'Portrait'))),
    form(CHARACTER_FIELDS, row, (key, value) => void store.patch('characters', id, { [key]: value }), ctx),
    voiceSection(ctx, row),
    form(CHARACTER_SETTINGS_FIELDS, params(row, 'settings'), (key, value, field) => void store.patch('characters', id, { settings: withValue(params(store.byId('characters', id)!, 'settings'), key, value, field) }, field.structural === true), ctx),
    rowConditions(ctx, 'character_id', id, 'Present only when', 'Always present.'),
    gettingAround(ctx, row),
    h('div', { class: 'row-actions' }, keepInLibraryButton(ctx, 'characters', row), h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(`the character “${row.name}”`) && void store.remove('characters', id) }, 'Delete character')));

  const others = Object.keys(animations).filter((n) => !isPose(n));
  const group = (title: string, tone: Tone, names: string[], ...extra: Array<HTMLElement | null>) =>
    h('div', { class: 'anim-group', 'data-tone': tone }, h('h4', null, title), ...names.map((name) => animationRow(ctx, row, name)), ...extra);

  const list = h('section', { class: 'panel-section character-animations', style: '--tone: var(--tone-move)' },
    h('h3', { class: 'section-head' }, '🎬 Animations', help(ABOUT_ANIMATIONS)),
    legacy ? h('p', { class: 'notice' }, 'Read from the character’s picture and close-up. Changing anything here saves them as animations.') : null,
    group('🧍 Standing', 'stand', ['stand_right', 'stand_left']),
    group('🚶 Walking', 'walk', ['walk_right', 'walk_left'], stand ? h('div', { class: 'anim-make-walk' },
      makeWalkButton(ctx, id, '✨ Make a walk from the standing picture'),
      h('small', { class: 'muted' }, `${WALK_FRAMES} frames, feet first: a full step apart as each heel lands, side by side as they pass, always on the ground.`)) : null),
    group('🖼️ Close-up for story boxes', 'portrait', ['portrait']),
    group('✨ Moves and other animations', 'move', others, others.length ? null : h('p', { class: 'muted small' }, 'None yet. Add one to play with a “Play an animation” action, or to replace a built-in move.'), addAnimation(ctx, id, animations)));

  return h('div', { class: 'character-panel' }, side, list);
}

/** One animation in the character's list: what it looks like, its picture, a summary, and a button to open it. */
function animationRow(ctx: FormContext, row: Row, name: string): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const animation = character.animations?.[name];
  const pose = isPose(name) ? name : null;
  const label = h('span', { class: 'anim-name' }, pose ? POSE_LABELS[pose] : name, h('code', null, name));
  const picture = pictureSelect(ctx, id, name, animation);
  const open = () => openAnimation(ctx, id, name);

  if (!animation) {
    // A pose left out is filled in from another, as the game does.
    const facing = name.endsWith('_left') ? 'left' : 'right';
    const fallback = name === 'portrait' ? resolvePortrait(character) : resolvePose(character, name.startsWith('walk'), facing);
    const flipped = fallback ? fallback.flip !== (fallback.animation.flip === true) : false;
    return h('div', { class: 'anim-row empty', 'data-animation': name, 'data-tone': toneOf(name) },
      animationPreview(store, fallback?.animation, 'anim-preview', flipped),
      label, picture,
      h('span', { class: 'anim-summary anim-uses' }, fallback ? `Uses ${labelOf(fallback.name)}${flipped ? ', mirrored' : ''}` : 'Nothing to show yet'));
  }

  const media = store.byId('media', animation.media_id);
  const frames = animationFrames(animation, media ? mediaOf(media) : undefined);
  const summary = frames
    ? [
        `${animation.frames?.length ?? frames.length} frame${frames.length === 1 ? '' : 's'}${animation.frames ? '' : ' (all)'}`,
        `${animationDuration(animation, media ? mediaOf(media) : undefined)} ms`,
        (animation.repeat ?? characterAnimationRepeats(name, {})) ? 'loops' : 'plays once',
      ]
    : ['still picture'];
  if (animation.flip) summary.push('mirrored');
  return h('div', { class: 'anim-row', 'data-animation': name, 'data-tone': toneOf(name) },
    h('button', { type: 'button', class: 'anim-open-preview', title: `Configure ${labelOf(name)}`, onclick: open }, animationPreview(store, animation)),
    label, picture,
    h('span', { class: 'anim-summary' }, ...summary.map((s) => h('span', { class: 'chip' }, s))),
    h('span', { class: 'anim-buttons' },
      h('button', { type: 'button', class: 'anim-configure', 'data-open': 'animation', title: frames ? 'Pick frames, speed, repeats and mirroring' : 'Mirroring and picture', onclick: open }, frames ? '⚙️ Frames & timing' : '⚙️ Configure'),
      pose ? null : h('button', { type: 'button', class: 'danger icon anim-delete', title: 'Delete this animation', onclick: () => confirmDelete(`the animation “${name}”`) && changeAnimation(ctx, id, name, null) }, '×')));
}

/** The picture an animation is drawn from, chosen from the scenario's images. */
function pictureSelect(ctx: FormContext, id: number, name: string, animation: CharacterAnimation | undefined): HTMLSelectElement {
  const { store } = ctx;
  const pose = isPose(name);
  const images = store.rows('media').filter((m) => m.type === 'image');
  const picture = h('select', {
    'aria-label': `Picture for ${name}`, class: 'anim-picture',
    onchange: () => {
      if (!picture.value) return changeAnimation(ctx, id, name, null);
      // A new picture starts with all its frames; the rest of the animation's settings stay.
      changeAnimation(ctx, id, name, { ...(animation ?? {}), media_id: Number(picture.value), frames: undefined });
    },
  },
  h('option', { value: '' }, pose ? (animation ? '(none)' : 'Choose a picture…') : '(remove)'),
  ...images.map((m) => h('option', { value: m.id, selected: animation?.media_id === m.id }, `${mediaLabel(m)}${params(m).sheet ? ' (sheet)' : params(m).apng ? ' (animated)' : ''}`)));
  return picture;
}

/** A new animation: a name, and the standing picture to start from. It opens straight away for its frames to be picked. */
function addAnimation(ctx: FormContext, id: number, animations: Animations): HTMLElement {
  const options = h('datalist', { id: `character-names-${id}` }, ...SUGGESTED.filter((n) => !animations[n]).map((n) => h('option', { value: n })));
  const newName = h('input', { type: 'text', list: `character-names-${id}`, placeholder: 'wave, dig, talk…', 'aria-label': 'Name of a new animation' });
  const add = () => {
    const name = newName.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '');
    if (!name) return toast('Give the animation a name: lowercase letters, digits and underscores.', 'error');
    if (isPose(name) || animations[name]) return toast(`“${name}” is already one of this character’s animations.`, 'error');
    const from = animations.stand_right ?? animations.stand_left ?? Object.values(animations)[0];
    if (!from) return toast('Choose a picture for one of the poses first.', 'error');
    changeAnimation(ctx, id, name, { media_id: from.media_id, ...(from.frames ? { frames: [...from.frames] } : {}) });
    openAnimation(ctx, id, name);
  };
  newName.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add()));
  return h('div', { class: 'anim-add' }, newName, h('button', { type: 'button', onclick: add }, '+ Add animation'), options);
}

// ---------------------------------------------------------- animation panel

/** One animation in a panel of its own, over the character's: a large preview, its settings, and its frames to pick. */
export function openAnimation(ctx: FormContext, id: number, name: string) {
  const { store } = ctx;
  openPanel({
    key: `animation-${id}-${name}`,
    kind: 'animation',
    store,
    size: 'medium',
    tone: `var(--tone-${toneOf(name)})`,
    title: () => {
      const row = store.byId('characters', id);
      if (!row || (!isPose(name) && !characterOf(store, row).animations?.[name])) return null;
      return h('span', null, h('span', { class: 'muted' }, `${row.name} · `), labelOf(name), h('code', { class: 'title-code' }, name));
    },
    body: () => {
      const row = store.byId('characters', id);
      return row ? animationBody(ctx, row, name) : null;
    },
  });
}

function animationBody(ctx: FormContext, row: Row, name: string): HTMLElement | null {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const animation = character.animations?.[name];
  const field = (label: string, control: HTMLElement, hint?: string, wide = false) =>
    h('label', { class: `field${wide ? ' wide' : ''}` }, h('span', { class: 'field-label' }, label), control, hint ? h('small', null, hint) : null);

  if (!animation) {
    if (!isPose(name)) return null;
    const facing = name.endsWith('_left') ? 'left' : 'right';
    const fallback = name === 'portrait' ? resolvePortrait(character) : resolvePose(character, name.startsWith('walk'), facing);
    return h('div', { class: 'animation-panel' },
      h('div', { class: 'anim-stage' }, animationPreview(store, fallback?.animation, 'anim-preview xl', fallback ? fallback.flip !== (fallback.animation.flip === true) : false)),
      h('div', null,
        h('p', { class: 'notice' }, fallback ? `Not drawn yet: the game uses ${labelOf(fallback.name)}${fallback.flip ? ', mirrored' : ''}.` : 'Not drawn yet.'),
        h('div', { class: 'form' }, field('Picture', pictureSelect(ctx, id, name, undefined), 'An image, an animated PNG or a sprite sheet from Media.', true))));
  }

  const change = (next: CharacterAnimation | null) => changeAnimation(ctx, id, name, next);
  const mediaRow = store.byId('media', animation.media_id);
  const media = mediaRow ? mediaOf(mediaRow) : undefined;
  const frames = animationFrames(animation, media);

  const controls: HTMLElement[] = [field('Picture', pictureSelect(ctx, id, name, animation), mediaRow ? (media?.sheet ? `A sprite sheet, ${media.sheet.columns} × ${media.sheet.rows}.` : media?.apng ? `An animated PNG, ${media.apng.frames} frames.` : 'A still picture.') : undefined, true)];
  if (frames) {
    const framesInput = h('input', {
      type: 'text', value: animation.frames?.join(' ') ?? '', placeholder: `All ${frames.length}`, 'aria-label': 'Frames, in order: 0 1 2 or 0-3', class: 'anim-frames',
      onchange: () => {
        const list = parseFrames(framesInput.value);
        change({ ...animation, frames: list.length ? list : undefined });
      },
    });
    const duration = h('input', {
      type: 'number', min: 30, step: 10, value: animation.duration ?? '', 'aria-label': 'Milliseconds for one pass', class: 'anim-duration',
      placeholder: `${animationDuration({ ...animation, duration: undefined }, media)}`,
      onchange: () => change({ ...animation, duration: Number(duration.value) > 0 ? Number(duration.value) : undefined }),
    });
    const repeat = h('select', { 'aria-label': 'Repeats', class: 'anim-repeat', onchange: () => change({ ...animation, repeat: repeat.value === '' ? undefined : repeat.value === 'yes' }) },
      h('option', { value: '' }, characterAnimationRepeats(name, {}) ? 'Loops (usual)' : 'Once (usual)'), h('option', { value: 'yes' }, 'Loops'), h('option', { value: 'no' }, 'Plays once'));
    repeat.value = animation.repeat == null ? '' : animation.repeat ? 'yes' : 'no';
    controls.push(
      field('Frames, in order', framesInput, '“0 1 2” or “0-3”, or click them below. Empty plays every frame.', true),
      field('One pass (ms)', duration),
      field('Repeats', repeat));
  }
  const mirror = h('input', { type: 'checkbox', checked: animation.flip === true, onchange: () => change({ ...animation, flip: mirror.checked || undefined }) });
  controls.push(h('label', { class: 'field check wide anim-mirror' }, mirror, h('span', { class: 'field-label' }, 'Mirror'), h('small', null, 'Draw it mirrored, so art facing one way serves the other.')));

  const order = frames && animation.frames?.length ? h('p', { class: 'anim-order' }, 'Plays ', ...animation.frames.flatMap((f, i) => [i ? ' → ' : '', h('b', null, String(f))])) : null;
  return h('div', { class: 'animation-panel' },
    h('div', { class: 'anim-stage' }, animationPreview(store, animation, 'anim-preview xl'), order),
    h('div', null,
      h('div', { class: 'form' }, ...controls),
      frames ? frameGrid(ctx, id, name, animation, (list) => change({ ...animation, frames: list.length ? list : undefined })) : null,
      isPose(name) ? null : h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(`the animation “${name}”`) && change(null) }, 'Delete animation'))));
}

/** Save one animation of a character, or take it away. */
function changeAnimation(ctx: FormContext, id: number, name: string, next: CharacterAnimation | null) {
  const row = ctx.store.byId('characters', id);
  if (!row) return;
  const all = current(ctx, row);
  if (next) all[name] = next;
  else delete all[name];
  void save(ctx, id, all);
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

/** The frames of the picture being edited, each a button: click to add it to the animation or take it out; shift-click adds every frame up to it. */
function frameGrid(ctx: FormContext, characterId: number, name: string, animation: CharacterAnimation, commit: (frames: number[]) => void): HTMLElement {
  const { store } = ctx;
  const mediaRow = store.byId('media', animation.media_id);
  const box = h('div', { class: 'frame-grid', 'data-picking': name },
    h('div', { class: 'frame-grid-head' },
      h('span', null, h('strong', null, 'Pick frames'), h('span', { class: 'muted' }, ` · click to add or take out, in the order they play; shift-click adds every frame up to it`)),
      h('button', { type: 'button', class: 'link', disabled: !animation.frames, onclick: () => commit([]) }, 'Use every frame')));
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
    // Frames at a size to pick from, not stretched across the panel.
    box.append(h('div', { class: 'sheet-picture', style: `max-width:${Math.max(240, sheet.columns * 120)}px` }, h('img', { src: sheet.url, alt: '' }), h('div', { class: 'sheet-cells', style: `grid-template-columns:repeat(${sheet.columns},1fr);grid-template-rows:repeat(${sheet.rows},1fr)` }, ...cells)));
  });
  box.dataset.character = String(characterId);
  return box;
}

// ------------------------------------------------------------- making a walk


/** What the walk does with the arms, for the message after making it. */
function armsSay(arms: number): string {
  if (arms === 2) return 'Both arms swing.';
  if (arms === 1) return 'One arm swings; the other stays as drawn (against the body).';
  return 'The arms stay as drawn: they are not apart from the body (on the hips, folded or against it).';
}

function makeWalkButton(ctx: FormContext, id: number, label: string): HTMLButtonElement {
  const button = h('button', {
    type: 'button', class: 'make-walk', 'data-make-walk': id,
    title: 'Make a six-frame walking sprite sheet from the standing picture: the legs are cut out and stepped, feet first',
    onclick: async () => {
      button.disabled = true;
      button.textContent = '⏳ Making the walk…';
      try {
        await makeWalk(ctx, id);
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    },
  }, label) as HTMLButtonElement;
  return button;
}

/**
 * Makes a character's walk from its standing picture (see walkCycle.ts): six frames on one sprite
 * sheet, saved in the scenario's media at the standing picture's scale and made its "walk right"
 * (walking left is that, mirrored, unless drawn). The frames are as tall as the standing picture and
 * centred on it, so the character keeps its size and place when it starts and stops walking.
 */
async function makeWalk(ctx: FormContext, id: number): Promise<void> {
  const { store } = ctx;
  const row = store.byId('characters', id);
  if (!row) return;
  const character = characterOf(store, row);
  const stand = resolvePose(character, false, 'right');
  const media = stand ? store.byId('media', stand.animation.media_id) : undefined;
  if (!stand || !media || media.type !== 'image') return void toast('Choose a standing picture first: the walk is made from it.', 'error');
  if (character.animations?.walk_right && !confirm(`${row.name} already walks right with “${mediaLabel(store.byId('media', character.animations.walk_right.media_id) ?? media)}”. Replace that with a walk made from the standing picture?`)) return;

  let picture: Bitmap;
  try {
    picture = await standingBitmap(store, media, stand.animation);
  } catch {
    return void toast('The standing picture could not be read here (is it on another site?). Upload it to Media and try again.', 'error');
  }
  // Made facing right: a standing picture that faces left (or is shown mirrored) is turned first.
  if (stand.flip !== (stand.animation.flip === true)) picture = mirror(picture);

  const cycle = walkCycle(picture);
  const feet = checkFeet(cycle);
  const sheet = sheetOf(cycle);
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(sheet.data), sheet.width, sheet.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return void toast('The walk could not be saved as a picture.', 'error');
  const base = String(row.name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  let added: Row;
  try {
    added = await store.api.upload(store.scenarioId, new File([blob], `${base}-walk.png`, { type: 'image/png' }));
  } catch (e) {
    return void toast(`The walk could not be uploaded: ${(e as Error).message}`, 'error');
  }
  store.bundle.media.push(added);
  await store.patch('media', added.id, {
    scale_x: media.scale_x ?? 1, scale_y: media.scale_y ?? 1,
    params: { ...params(added), category: 'character', sheet: { columns: WALK_FRAMES, rows: 1 }, made_from: { media_id: media.id, as: cycle.mode === 'legs' ? 'walk' : 'bob' } },
  });
  changeAnimation(ctx, id, 'walk_right', { media_id: added.id, duration: WALK_DURATION });

  if (cycle.mode === 'bob') {
    toast(`No legs could be found to step with (${(cycle.why ?? '').replace(/\.$/, '').toLowerCase()}), so ${row.name} bobs along instead. Draw walking frames for real steps.`);
  } else {
    const share = Math.round(feet.stepShare * 100);
    const frames = (list: number[]) => list.map((f) => f + 1).join(' and ');
    toast(feet.ok
      ? `Made a ${WALK_FRAMES}-frame walk. The feet land a step apart (${share}% of ${row.name}’s height) in frames ${frames(feet.apart)} and pass side by side in frames ${frames(feet.together)}. ${armsSay(cycle.rig?.arms.length ?? 0)}`
      : `Made a ${WALK_FRAMES}-frame walk, but have a look at it: ${feet.problems[0]}`, feet.ok ? undefined : 'error');
  }
  openAnimation(ctx, id, 'walk_right');
}

/** The first frame of a standing animation, as pixels: the whole frame, so the walk lines up with it. */
async function standingBitmap(store: FormContext['store'], media: Row, animation: CharacterAnimation): Promise<Bitmap> {
  const sheet = await framesOf(store, media);
  const url = sheet?.url ?? mediaUrl(store, media);
  if (!url) throw new Error('no picture');
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  const columns = sheet?.columns ?? 1;
  const rows = sheet?.rows ?? 1;
  const frame = sheet ? (animationFrames(animation, mediaOf(media))?.[0] ?? 0) : 0;
  const width = Math.floor(image.naturalWidth / columns);
  const height = Math.floor(image.naturalHeight / rows);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, (frame % columns) * width, Math.floor(frame / columns) * height, width, height, 0, 0, width, height);
  const data = g.getImageData(0, 0, width, height); // throws for a picture from a site that does not allow it
  return { width, height, data: data.data };
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

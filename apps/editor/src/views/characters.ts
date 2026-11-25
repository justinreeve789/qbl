import {
  animationDuration, animationFrames, BUILT_IN_MOVES, CHARACTER_POSES, characterAnimationRepeats, isPose, POSE_LABELS, resolvePortrait, resolvePose,
  type CharacterAnimation, type CharacterPose, type MediaAnimation,
} from '@qbl/shared';
import type { Row } from '../api';
import {
  animationPreview, characterOf, framePosition, framesOf, freeAnimationName, hasFrames, matchingAnimation, mediaOf, pictureAnimations, playing, storedAnimations,
} from '../characters';
import { checkFeet, mirror, sheetOf, walkCycle, WALK_DURATION, WALK_FRAMES, type Bitmap } from '@qbl/shared';
import { mediaLabel, mediaUrl, params } from '../describe';
import { confirmDelete, h, help, toast } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { openPanel } from '../panel';
import { CHARACTER_FIELDS, CHARACTER_SETTINGS_FIELDS } from '../schema';
import { rowConditions } from './conditions';
import { keepInLibraryButton, openQuestLab } from './questlab';
import { openMedia } from './library';
import { gettingAround } from './routine';
import { editSheetAnimation } from './sheet';
import { recordAllButton, voiceSection } from './voices';

type Animations = Record<string, CharacterAnimation>;

/** Names offered for a new animation: the built-in moves (frames drawn for one replace the built-in version) and a few more. */
const SUGGESTED = [...Object.keys(BUILT_IN_MOVES), 'talk', 'point', 'nod', 'cheer', 'sit', 'dig'];

/** Each kind of animation has a colour, the same on the card, in the list and on its own panel. */
type Tone = 'stand' | 'walk' | 'portrait' | 'move';
const toneOf = (name: string): Tone => (name.startsWith('stand') ? 'stand' : name.startsWith('walk') ? 'walk' : name === 'portrait' ? 'portrait' : 'move');
const SHORT: Record<CharacterPose, string> = { stand_right: 'Stand →', stand_left: '← Stand', walk_right: 'Walk →', walk_left: '← Walk', portrait: 'Portrait' };
const labelOf = (name: string) => (isPose(name) ? POSE_LABELS[name] : name);

const ABOUT_ANIMATIONS = 'Standing and walking are shown by themselves, facing the way the character goes; a pose left out uses another, mirrored. The portrait is shown in story boxes. Any other animation is played by a “Play an animation” action, or by a move: one named like a built-in move (jump, wave, dance…) replaces it with your frames. Each one plays a picture and one of the picture’s animations: their frames, speed and repeats are made on the Media page, so one sheet’s walk can serve several characters.';

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
    framesHere(animations, store).length ? h('div', { class: 'notice anim-own-frames' },
      h('span', null, `${framesHere(animations, store).map(labelOf).join(', ')} ${framesHere(animations, store).length === 1 ? 'has its' : 'have their'} frames set on the character, from before animations were made on the Media page.`),
      h('button', { type: 'button', 'data-move-frames': '', onclick: () => moveFramesToPictures(ctx, id) }, '🎞️ Move them to the Media page')) : null,
    group('🧍 Standing', 'stand', ['stand_right', 'stand_left']),
    group('🚶 Walking', 'walk', ['walk_right', 'walk_left'], stand ? h('div', { class: 'anim-make-walk' },
      makeWalkButton(ctx, id, '✨ Make a walk from the standing picture'),
      h('small', { class: 'muted' }, `${WALK_FRAMES} frames, feet first: a full step apart as each heel lands, side by side as they pass, always on the ground.`)) : null),
    group('🖼️ Close-up for story boxes', 'portrait', ['portrait']),
    group('✨ Moves and other animations', 'move', others, others.length ? null : h('p', { class: 'muted small' }, 'None yet. Add one to play with a “Play an animation” action, or to replace a built-in move.'), addAnimation(ctx, id, animations)));

  return h('div', { class: 'character-panel' }, side, list);
}

/** One animation in the character's list: what it looks like, its picture and which of the picture's animations it plays, and a button to open it. */
function animationRow(ctx: FormContext, row: Row, name: string): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const character = characterOf(store, row);
  const animation = character.animations?.[name];
  const pose = isPose(name) ? name : null;
  const label = h('span', { class: 'anim-name' }, pose ? POSE_LABELS[pose] : name, h('code', null, name));
  const open = () => openAnimation(ctx, id, name);

  if (!animation) {
    // A pose left out is filled in from another, as the game does.
    const facing = name.endsWith('_left') ? 'left' : 'right';
    const fallback = name === 'portrait' ? resolvePortrait(character) : resolvePose(character, name.startsWith('walk'), facing);
    const flipped = fallback ? fallback.flip !== (fallback.animation.flip === true) : false;
    return h('div', { class: 'anim-row empty', 'data-animation': name, 'data-tone': toneOf(name) },
      animationPreview(store, fallback?.animation, 'anim-preview', flipped),
      label, h('div', { class: 'anim-picture' }, pictureSelect(ctx, id, name, undefined)),
      h('span', { class: 'anim-summary anim-uses' }, fallback ? `Uses ${labelOf(fallback.name)}${flipped ? ', mirrored' : ''}` : 'Nothing to show yet'));
  }

  const mediaRow = store.byId('media', animation.media_id);
  const media = mediaRow ? mediaOf(mediaRow) : undefined;
  const frames = animationFrames(animation, media);
  const summary = frames
    ? [
        `${frames.length} frame${frames.length === 1 ? '' : 's'}${animation.frames ? '' : ' (all)'}`,
        `${animationDuration(animation, media)} ms`,
        (animation.repeat ?? characterAnimationRepeats(name, {})) ? 'loops' : 'plays once',
      ]
    : ['still picture'];
  if (animation.flip) summary.push('mirrored');
  return h('div', { class: 'anim-row', 'data-animation': name, 'data-tone': toneOf(name) },
    h('button', { type: 'button', class: 'anim-open-preview', title: `Configure ${labelOf(name)}`, onclick: open }, animationPreview(store, animation)),
    label,
    h('div', { class: 'anim-picture' }, pictureSelect(ctx, id, name, animation), hasFrames(mediaRow) ? playsSelect(ctx, id, name, animation) : null),
    h('span', { class: 'anim-summary' }, ...summary.map((s) => h('span', { class: 'chip' }, s)), playsNote(store, animation)),
    h('span', { class: 'anim-buttons' },
      h('button', { type: 'button', class: 'anim-configure', 'data-open': 'animation', title: 'Its picture, which of the picture’s animations it plays, and mirroring', onclick: open }, '⚙️ Configure'),
      pose ? null : h('button', { type: 'button', class: 'danger icon anim-delete', title: 'Delete this animation', onclick: () => confirmDelete(`the animation “${name}”`) && changeAnimation(ctx, id, name, null) }, '×')));
}

/** The picture an animation is drawn from, chosen from the scenario's images. */
function pictureSelect(ctx: FormContext, id: number, name: string, animation: CharacterAnimation | undefined): HTMLSelectElement {
  const { store } = ctx;
  const pose = isPose(name);
  const images = store.rows('media').filter((m) => m.type === 'image');
  const picture = h('select', {
    'aria-label': `Picture for ${name}`, class: 'anim-picture-choice',
    onchange: () => {
      if (!picture.value) return changeAnimation(ctx, id, name, null);
      // A new picture plays its animation named for this one, if it has one; else every frame. Mirroring stays.
      const mediaRow = store.byId('media', Number(picture.value));
      const start = { media_id: Number(picture.value), ...(animation?.flip ? { flip: true } : {}) };
      const match = hasFrames(mediaRow) ? matchingAnimation(mediaRow, name) : undefined;
      changeAnimation(ctx, id, name, match ? playing(start, match) : start);
    },
  },
  h('option', { value: '' }, pose ? (animation ? '(none)' : 'Choose a picture…') : '(remove)'),
  ...images.map((m) => h('option', { value: m.id, selected: animation?.media_id === m.id }, `${mediaLabel(m)}${params(m).sheet ? ' (sheet)' : params(m).apng ? ' (animated)' : ''}`)));
  return picture;
}

/**
 * Which of its picture's animations a character's plays, from those made on the Media page, or
 * every frame of the picture. The last choice makes a new one on the picture and opens it there.
 */
function playsSelect(ctx: FormContext, id: number, name: string, animation: CharacterAnimation): HTMLSelectElement {
  const { store } = ctx;
  const mediaRow = store.byId('media', animation.media_id);
  const list = pictureAnimations(mediaRow);
  const linked = animation.sheet_animation;
  const own = !linked && !!animation.frames?.length;
  const node = h('select', {
    'aria-label': `Animation of the picture for ${name}`, class: 'anim-plays',
    onchange: () => {
      const value = node.value;
      if (value === '__new') return void newOnPicture(ctx, id, name);
      if (value === '__own') return;
      const from = list.find((a) => a.name === value);
      changeAnimation(ctx, id, name, from ? playing(animation, from) : { media_id: animation.media_id, ...(animation.flip ? { flip: true } : {}) });
    },
  },
  h('option', { value: '' }, 'Every frame'),
  ...list.map((a) => h('option', { value: a.name }, `🎞️ ${a.name} · ${a.frames?.length ?? 0} frame${a.frames?.length === 1 ? '' : 's'}`)),
  linked && !list.some((a) => a.name === linked) ? h('option', { value: linked }, `⚠️ ${linked} (gone from the picture)`) : null,
  own ? h('option', { value: '__own' }, `Frames set here: ${animation.frames!.join(' ')}`) : null,
  h('option', { value: '__new' }, '+ New animation on the picture…'));
  node.value = linked ?? (own ? '__own' : '');
  return node;
}

/** A word on where the animation's frames come from, when it is not simply one of the picture's. */
function playsNote(store: FormContext['store'], animation: CharacterAnimation): HTMLElement | null {
  const mediaRow = store.byId('media', animation.media_id);
  if (!hasFrames(mediaRow)) return null;
  const linked = animation.sheet_animation;
  if (linked && !pictureAnimations(mediaRow).some((a) => a.name === linked)) return h('span', { class: 'chip warn' }, `⚠️ “${linked}” is gone from the picture`);
  if (!linked && animation.frames?.length) return h('span', { class: 'chip warn', title: 'Move them to the Media page to change them' }, 'Frames set on the character');
  return null;
}

/** The character's animations that set their own frames on a picture with frames, as before animations were made on the Media page. */
function framesHere(animations: Animations, store: FormContext['store']): string[] {
  return Object.entries(animations).filter(([, a]) => !a.sheet_animation && a.frames?.length && hasFrames(store.byId('media', a.media_id))).map(([n]) => n);
}

/**
 * Put an animation's frames on its picture, as one of the picture's animations, and play that:
 * one of the picture's with the same frames, speed and repeat is used again, else one is added,
 * named for it. Returns the name on the picture.
 */
function frameAnimationOnPicture(ctx: FormContext, id: number, name: string, animation: CharacterAnimation, reuse: boolean): string | null {
  const { store } = ctx;
  const mediaRow = store.byId('media', animation.media_id);
  if (!mediaRow || !hasFrames(mediaRow)) return null;
  const list = pictureAnimations(mediaRow);
  const same = (a: MediaAnimation) => JSON.stringify(a.frames ?? []) === JSON.stringify(animation.frames ?? []) && (a.duration ?? null) === (animation.duration ?? null) && (a.repeat ?? null) === (animation.repeat ?? null);
  let from = reuse ? list.find(same) : undefined;
  if (!from) {
    from = { name: freeAnimationName(mediaRow, name), frames: [...(animation.frames ?? [])] };
    if (animation.duration) from.duration = animation.duration;
    if (animation.repeat != null) from.repeat = animation.repeat;
    void store.patch('media', mediaRow.id, { params: { ...params(mediaRow), animations: [...list, from] } }, true);
  }
  changeAnimation(ctx, id, name, playing(animation, from));
  return from.name;
}

/** A new animation on the picture for this one to play, opened on the Media page for its frames to be picked. */
function newOnPicture(ctx: FormContext, id: number, name: string) {
  const row = ctx.store.byId('characters', id);
  const animation = row ? characterOf(ctx.store, row).animations?.[name] : undefined;
  if (!animation) return;
  const made = frameAnimationOnPicture(ctx, id, name, { ...animation, sheet_animation: undefined }, false);
  if (!made) return;
  editSheetAnimation(animation.media_id, made);
  openMedia(ctx, animation.media_id, 'sheet');
}

/** Every animation of the character with frames of its own: onto its picture, as the picture's animations. */
function moveFramesToPictures(ctx: FormContext, id: number) {
  const row = ctx.store.byId('characters', id);
  if (!row) return;
  const animations = characterOf(ctx.store, row).animations ?? {};
  const moved = framesHere(animations, ctx.store);
  for (const name of moved) {
    const latest = characterOf(ctx.store, ctx.store.byId('characters', id)!).animations?.[name];
    if (latest) frameAnimationOnPicture(ctx, id, name, latest, true);
  }
  toast(`Moved ${moved.map(labelOf).join(', ')} to ${moved.length === 1 ? 'its picture' : 'their pictures'} on the Media page.`);
}

/** A new animation: a name, and the standing picture to start from. It opens straight away for its picture's animation to be chosen. */
function addAnimation(ctx: FormContext, id: number, animations: Animations): HTMLElement {
  const options = h('datalist', { id: `character-names-${id}` }, ...SUGGESTED.filter((n) => !animations[n]).map((n) => h('option', { value: n })));
  const newName = h('input', { type: 'text', list: `character-names-${id}`, placeholder: 'wave, dig, talk…', 'aria-label': 'Name of a new animation' });
  const add = () => {
    const name = newName.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '');
    if (!name) return toast('Give the animation a name: lowercase letters, digits and underscores.', 'error');
    if (isPose(name) || animations[name]) return toast(`“${name}” is already one of this character’s animations.`, 'error');
    const from = animations.stand_right ?? animations.stand_left ?? Object.values(animations)[0];
    if (!from) return toast('Choose a picture for one of the poses first.', 'error');
    // The standing picture, playing its animation of this name if it has one.
    const mediaRow = ctx.store.byId('media', from.media_id);
    const match = hasFrames(mediaRow) ? matchingAnimation(mediaRow, name) : undefined;
    changeAnimation(ctx, id, name, match ? playing({ media_id: from.media_id }, match) : { media_id: from.media_id });
    openAnimation(ctx, id, name);
  };
  newName.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), add()));
  return h('div', { class: 'anim-add' }, newName, h('button', { type: 'button', onclick: add }, '+ Add animation'), options);
}

// ---------------------------------------------------------- animation panel

/** One animation in a panel of its own, over the character's: a large preview, its picture, which of the picture's animations it plays, and mirroring. */
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
  const linked = animation.sheet_animation && pictureAnimations(mediaRow).some((a) => a.name === animation.sheet_animation) ? animation.sheet_animation : null;
  const own = !animation.sheet_animation && !!animation.frames?.length;

  const controls: HTMLElement[] = [field('Picture', pictureSelect(ctx, id, name, animation), mediaRow ? (media?.sheet ? `A sprite sheet, ${media.sheet.columns} × ${media.sheet.rows}.` : media?.apng ? `An animated PNG, ${media.apng.frames} frames.` : 'A still picture.') : undefined, true)];
  if (hasFrames(mediaRow)) {
    controls.push(field('Plays the picture’s animation', playsSelect(ctx, id, name, animation), 'Its frames, speed and repeats are made on the Media page, where every character playing it takes any change.', true));
    const toMedia = (focus?: string) => {
      if (focus) editSheetAnimation(animation.media_id, focus);
      openMedia(ctx, animation.media_id, 'sheet');
    };
    controls.push(h('div', { class: 'row-actions wide anim-media-buttons' },
      linked ? h('button', { type: 'button', class: 'primary', 'data-edit-on-media': linked, onclick: () => toMedia(linked) }, `✏️ Edit “${linked}” on the Media page`) : null,
      own ? h('button', { type: 'button', class: 'primary', 'data-move-frames': name, onclick: () => {
        const made = frameAnimationOnPicture(ctx, id, name, animation, true);
        if (made) toMedia(made);
      } }, '🎞️ Move these frames to the Media page') : null,
      h('button', { type: 'button', 'data-new-on-media': '', onclick: () => newOnPicture(ctx, id, name) }, '+ New animation on the picture')));
  }
  const mirror = h('input', { type: 'checkbox', checked: animation.flip === true, onchange: () => change({ ...animation, flip: mirror.checked || undefined }) });
  controls.push(h('label', { class: 'field check wide anim-mirror' }, mirror, h('span', { class: 'field-label' }, 'Mirror'), h('small', null, 'Draw it mirrored, so art facing one way serves the other.')));

  const order = frames && animation.frames?.length ? h('p', { class: 'anim-order' }, 'Plays ', ...animation.frames.flatMap((f, i) => [i ? ' → ' : '', h('b', null, String(f))])) : null;
  const timing = frames ? h('p', { class: 'muted small anim-timing' }, `${animationDuration(animation, media)} ms a pass, ${(animation.repeat ?? characterAnimationRepeats(name, {})) ? 'looping' : 'played once'}${own ? '. Frames set on the character: move them to the Media page to change them.' : ''}`) : null;
  return h('div', { class: 'animation-panel' },
    h('div', { class: 'anim-stage' }, animationPreview(store, animation, 'anim-preview xl'), order, timing),
    h('div', null,
      h('div', { class: 'form' }, ...controls),
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
  // The walk is the new sheet's own animation, on the Media page, and the character plays it.
  const walk: MediaAnimation = { name: 'walk', frames: Array.from({ length: WALK_FRAMES }, (_, i) => i), duration: WALK_DURATION };
  await store.patch('media', added.id, {
    scale_x: media.scale_x ?? 1, scale_y: media.scale_y ?? 1,
    params: { ...params(added), category: 'character', sheet: { columns: WALK_FRAMES, rows: 1 }, animations: [walk], made_from: { media_id: media.id, as: cycle.mode === 'legs' ? 'walk' : 'bob' } },
  });
  changeAnimation(ctx, id, 'walk_right', playing({ media_id: added.id }, walk));

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

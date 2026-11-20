/**
 * Characters: the avatars players walk around as and the characters (NPCs) scenarios place.
 * Both are a `Character` with animations; see the types in types.ts. These functions say which
 * animation shows when, what frames it plays and for how long, and turn documents written before
 * characters had animations into the new shape.
 */
import {
  BUILT_IN_MOVES, frameCount,
  type AvatarCharacter, type Character, type CharacterAnimation, type Id, type Media, type MediaAnimation, type Npc, type Scenario,
} from './types.js';

/** The animations every character has a meaning for. Any other name is played when asked for. */
export const CHARACTER_POSES = ['stand_right', 'stand_left', 'walk_right', 'walk_left', 'portrait'] as const;
export type CharacterPose = (typeof CHARACTER_POSES)[number];

export const POSE_LABELS: Record<CharacterPose, string> = {
  stand_right: 'Standing, facing right',
  stand_left: 'Standing, facing left',
  walk_right: 'Walking right',
  walk_left: 'Walking left',
  portrait: 'Close-up portrait',
};

export function isPose(name: string): name is CharacterPose {
  return (CHARACTER_POSES as readonly string[]).includes(name);
}

type MediaLookup = (id: Id) => Pick<Media, 'id' | 'sheet' | 'apng' | 'animations' | 'scale_y' | 'filename'> | undefined;

/** An animation picked for a moment, with whether to draw it mirrored. */
export interface ChosenAnimation {
  name: string;
  animation: CharacterAnimation;
  flip: boolean;
}

/**
 * What a character shows while standing or walking the way it faces. A pose that is missing is
 * filled in from another one, so the fewest pictures still make a whole character:
 *   walking: walk_<facing>, else the other walk mirrored, else standing;
 *   standing: stand_<facing>, else the other stand mirrored, else the portrait.
 * Null when the character has no pictures at all.
 */
export function resolvePose(character: Pick<Character, 'animations'> | null | undefined, moving: boolean, facing: 'left' | 'right'): ChosenAnimation | null {
  const other = facing === 'left' ? 'right' : 'left';
  if (moving) {
    const walk = pick(character, `walk_${facing}`, false) ?? pick(character, `walk_${other}`, true);
    if (walk) return walk;
  }
  return pick(character, `stand_${facing}`, false) ?? pick(character, `stand_${other}`, true) ?? pick(character, 'portrait', false);
}

/** The close-up for a story box: the portrait, else the character standing facing right. */
export function resolvePortrait(character: Pick<Character, 'animations'> | null | undefined): ChosenAnimation | null {
  return pick(character, 'portrait', false) ?? pick(character, 'stand_right', false) ?? pick(character, 'stand_left', true);
}

function pick(character: Pick<Character, 'animations'> | null | undefined, name: string, mirrored: boolean): ChosenAnimation | null {
  const animation = character?.animations?.[name];
  if (!animation || animation.media_id == null) return null;
  return { name, animation, flip: (animation.flip === true) !== mirrored };
}

/**
 * The frames an animation shows, in order, or null for a still picture. Frames outside the
 * picture are left out; with none left, the first frame is shown.
 */
export function animationFrames(animation: Pick<CharacterAnimation, 'frames'>, media: Pick<Media, 'sheet' | 'apng'> | null | undefined): number[] | null {
  if (!media?.sheet && !media?.apng) return null;
  const count = frameCount(media);
  const frames = (animation.frames?.length ? animation.frames : Array.from({ length: count }, (_, i) => i)).filter((f) => Number.isInteger(f) && f >= 0 && f < count);
  return frames.length ? frames : [0];
}

/**
 * Milliseconds one pass takes: as the animation says, else an animated PNG's own speed (for the
 * whole file, or in proportion for some of its frames), else 100 per frame. 0 for a still picture.
 */
export function animationDuration(animation: Pick<CharacterAnimation, 'frames' | 'duration'>, media: Pick<Media, 'sheet' | 'apng'> | null | undefined): number {
  const frames = animationFrames(animation, media);
  if (!frames) return animation.duration && animation.duration > 0 ? animation.duration : 0;
  if (animation.duration && animation.duration > 0) return animation.duration;
  if (media?.apng && media.apng.duration > 0) return Math.max(1, Math.round((media.apng.duration * frames.length) / Math.max(1, media.apng.frames)));
  return frames.length * 100;
}

/** Whether an animation of this name loops: as it says, else the poses and looping moves do. */
export function characterAnimationRepeats(name: string, animation: Pick<CharacterAnimation, 'repeat'>): boolean {
  return animation.repeat ?? (isPose(name) || BUILT_IN_MOVES[name]?.repeat === true);
}

/** Every media id a character's animations use. */
export function characterMediaIds(character: Pick<Character, 'animations'> | null | undefined): Id[] {
  const ids = new Set<Id>();
  for (const a of Object.values(character?.animations ?? {})) if (a?.media_id != null) ids.add(a.media_id);
  return [...ids];
}

/** The names a character can be asked to play besides the poses: its own, then the built-in moves. */
export function characterMoves(character: Pick<Character, 'animations'> | null | undefined): string[] {
  const own = Object.keys(character?.animations ?? {}).filter((n) => !isPose(n));
  return [...own, ...Object.keys(BUILT_IN_MOVES).filter((n) => !own.includes(n))];
}

// ------------------------------------------------------------ older documents

/**
 * A character's animations as they were written before characters had any: one picture (a still
 * image, or a sprite sheet whose own `idle` and walks were the poses) and a separate close-up.
 * Art was drawn facing right; the other way is the same art mirrored.
 */
export function animationsFromPicture(
  media: Pick<Media, 'id' | 'sheet' | 'animations'> | null | undefined, portraitId?: Id | null,
): Record<string, CharacterAnimation> {
  const out: Record<string, CharacterAnimation> = {};
  if (media) {
    const sheetAnimations: MediaAnimation[] = media.sheet ? media.animations ?? [] : [];
    const find = (name: string) => sheetAnimations.find((a) => a.name === name);
    const from = (a: MediaAnimation, flip = false): CharacterAnimation => strip({ media_id: media.id, frames: [...a.frames], duration: a.duration, repeat: a.repeat, flip: flip || undefined });
    const idle = find('idle');
    // A sheet without an idle stood still on its first frame.
    out.stand_right = idle ? from(idle) : media.sheet ? { media_id: media.id, frames: [0] } : { media_id: media.id };
    const walk = find('walk');
    const right = find('walk_right') ?? walk;
    const left = find('walk_left');
    if (right) out.walk_right = from(right);
    if (left) out.walk_left = from(left);
    else if (walk && right !== walk) out.walk_left = from(walk, true);
    for (const a of sheetAnimations) {
      if (!['idle', 'walk', 'walk_left', 'walk_right'].includes(a.name) && !isPose(a.name)) out[a.name] = from(a);
    }
  }
  if (portraitId != null) out.portrait = { media_id: portraitId };
  return out;
}

/** A scenario's character with its animations filled in from the older fields when it has none. */
export function normalizeNpc(character: Npc, media: MediaLookup): Npc {
  if (character.animations && Object.keys(character.animations).length) return character;
  const picture = character.media_id != null ? media(character.media_id) : undefined;
  const animations = animationsFromPicture(picture ?? (character.media_id != null ? { id: character.media_id } : undefined), character.portrait_media_id);
  return Object.keys(animations).length ? { ...character, animations } : character;
}

/**
 * The avatars of a document: as it lists them, or else made from the older `avatar_media_ids`
 * (each picture an avatar whose id is the picture's id, so players' choices still match) and
 * `avatar_portraits`.
 */
export function scenarioAvatars(scenario: Pick<Scenario, 'avatars' | 'avatar_media_ids' | 'avatar_portraits'>, media: MediaLookup): AvatarCharacter[] {
  if (scenario.avatars) return scenario.avatars;
  return (scenario.avatar_media_ids ?? []).map((id, i) => {
    const picture = media(id);
    return strip({
      id,
      name: picture?.filename?.replace(/\.[a-z0-9]+$/i, '') || `Avatar ${i + 1}`,
      scale: picture?.scale_y != null && picture.scale_y !== 1 ? picture.scale_y : undefined,
      animations: animationsFromPicture(picture ?? { id }, scenario.avatar_portraits?.[String(id)] ?? null),
    }) as AvatarCharacter;
  });
}

function strip<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ----------------------------------------------------------------- pictures

/**
 * One still of a character, for a page rather than a scene: the avatar chooser, a profile, a
 * story box. `frame` is the frame of a sheet to show; an animated PNG plays by itself in a page.
 */
export interface CharacterPicture {
  url: string | null;
  sheet?: { columns: number; rows: number } | null;
  frame?: number;
  flip?: boolean;
}

/** How a character looks standing (facing right) or in close-up, as a picture for a page. */
export function characterPicture(
  character: Pick<Character, 'animations'> | null | undefined, which: 'stand' | 'portrait',
  media: (id: Id) => Media | undefined, url: (media: Media) => string | null,
): CharacterPicture | null {
  const chosen = which === 'portrait' ? resolvePortrait(character) : resolvePose(character, false, 'right');
  const picture = chosen ? media(chosen.animation.media_id) : undefined;
  if (!chosen || !picture) return null;
  const frames = picture.sheet ? animationFrames(chosen.animation, picture) : null;
  return strip({
    url: url(picture),
    sheet: picture.sheet ? { columns: picture.sheet.columns, rows: picture.sheet.rows } : undefined,
    frame: frames ? frames[0] : undefined,
    flip: chosen.flip || undefined,
  });
}

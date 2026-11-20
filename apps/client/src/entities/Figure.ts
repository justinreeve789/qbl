import type * as Phaser from 'phaser';
import {
  animationRepeats, automaticAnimation, BUILT_IN_MOVES, findAnimation, type Media,
} from '@qbl/shared';
import { characterAnimation, mediaAnimation, mediaSheet, whenApngReady } from '../core/assets';

/** How a built-in move bends a picture at one moment: lift and lean, and stretch across and up. */
export interface Pose { lift: number; lean: number; scaleX: number; scaleY: number }
export const NEUTRAL: Pose = { lift: 0, lean: 0, scaleX: 1, scaleY: 1 };

/** How a built-in move bends a picture `t` milliseconds into it. */
export function bend(name: string, t: number, duration: number): Pose {
  const p = Math.min(1, t / duration);
  switch (name) {
    case 'jump':
      return { ...NEUTRAL, lift: Math.sin(Math.PI * p) * 0.38, scaleY: 1 + Math.sin(Math.PI * p) * 0.06 };
    case 'spin':
      return { ...NEUTRAL, scaleX: Math.cos(2 * Math.PI * p) };
    case 'crouch':
      return { ...NEUTRAL, scaleY: 1 - Math.sin(Math.PI * p) * 0.32, scaleX: 1 + Math.sin(Math.PI * p) * 0.08 };
    case 'wave':
      return { ...NEUTRAL, lean: Math.sin(p * 6 * Math.PI) * 0.12 };
    case 'dance':
      return { ...NEUTRAL, lift: Math.abs(Math.sin(t / 180)) * 0.07, lean: Math.sin(t / 240) * 0.11 };
    default:
      return NEUTRAL;
  }
}

/**
 * One picture in the scene that can be animated: a vehicle, an item, or an image an action is
 * showing. Avatars and characters are drawn by CharacterFigure, from their own animations.
 *
 * If its media is a sprite sheet, the animations defined on the sheet are played by name:
 * `idle` and the walks by themselves, anything else when asked. If it is a single picture, or
 * the sheet has no animation of the name asked for, the built-in moves still work, by moving
 * the picture itself. So "jump" always does something, and looks best where frames were drawn.
 */
export class Figure {
  readonly object: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  /** The sheet animation showing now, by its Phaser key. */
  private showing = '';
  private act: { name: string; started: number; duration: number; repeat: boolean; frames: boolean } | null = null;
  private clock = 0;

  constructor(private scene: Phaser.Scene, readonly media: Media | undefined, texture: string, x: number, y: number) {
    const sheet = media ? mediaSheet(scene, media) : null;
    if (media?.apng && !sheet) {
      // An animated PNG plays all of itself, over and over, once its frames are cut out.
      const sprite = scene.add.sprite(x, y, texture);
      this.object = sprite;
      const loop = () => {
        const drawn = characterAnimation(scene, media, 'stand_right', { media_id: media.id });
        if (drawn.anim && sprite.active) sprite.play(drawn.anim);
      };
      if (whenApngReady(scene, media, loop)) loop();
      return;
    }
    this.object = sheet ? scene.add.sprite(x, y, sheet, findAnimation(media, 'idle')?.frames[0] ?? 0) : scene.add.image(x, y, texture);
  }

  /** The move being made right now, or ''. */
  get acting(): string {
    return this.act?.name ?? '';
  }

  /**
   * Standing or walking: show the sheet's idle or walk, unless a move is being made. Returns
   * whether the picture should be mirrored to face `facing`, given which way the art looks.
   */
  auto(moving: boolean, facing: 'left' | 'right', faces: 'left' | 'right' = 'right'): boolean {
    const want = automaticAnimation(this.media, moving, facing, faces);
    if (!this.act?.frames) this.show(want.name);
    return want.flip;
  }

  /**
   * Make a move by name; an empty name ends the one being made. Returns how long it lasts in
   * milliseconds, or 0 when it loops until stopped or the name means nothing here.
   */
  play(name: string): number {
    this.act = null;
    if (!name) return 0;
    const drawn = findAnimation(this.media, name);
    const builtIn = BUILT_IN_MOVES[name];
    if (!drawn && !builtIn) return 0;
    const repeat = drawn ? animationRepeats(drawn) : builtIn!.repeat;
    const duration = drawn ? Math.max(1, drawn.duration ?? drawn.frames.length * 100) : builtIn!.duration;
    this.act = { name, started: this.clock, duration, repeat, frames: !!drawn };
    if (drawn) {
      this.showing = '';
      this.show(name);
    }
    return repeat ? 0 : duration;
  }

  /** Advance time. A move that does not loop ends by itself. */
  tick(delta: number) {
    this.clock += delta;
    if (this.act && !this.act.repeat && this.clock - this.act.started >= this.act.duration) this.act = null;
  }

  /** How the current move bends the picture. Frames drawn for a move need no bending. */
  pose(): Pose {
    const act = this.act;
    if (!act || act.frames) return NEUTRAL;
    return bend(act.name, this.clock - act.started, act.duration);
  }

  private show(name: string | null) {
    const sprite = this.object as Phaser.GameObjects.Sprite;
    if (typeof sprite.play !== 'function' || !this.media) return;
    const key = name ? mediaAnimation(this.scene, this.media, name) : null;
    if ((key ?? '') === this.showing) return;
    this.showing = key ?? '';
    if (key) sprite.play(key);
    else sprite.stop?.();
  }

  destroy() {
    this.object.destroy();
  }
}

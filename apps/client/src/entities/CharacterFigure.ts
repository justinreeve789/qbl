import type * as Phaser from 'phaser';
import {
  animationDuration, BUILT_IN_MOVES, characterAnimationRepeats, isPose, resolvePose,
  type Character, type CharacterAnimation, type ChosenAnimation, type Id, type Media,
} from '@qbl/shared';
import { characterAnimation, ensureDefaultAvatar, mediaKey, whenApngReady } from '../core/assets';
import { bend, NEUTRAL, type Pose } from './Figure';

/**
 * Someone who walks around a scene, drawn from their animations: the base of a player's Avatar
 * and of a scenario's characters (Npc).
 *
 * Standing and walking show the character's poses for the way it faces (see `resolvePose`: a
 * missing pose is another one, mirrored). Any other of its animations is played by name when
 * asked; a name it has no frames for but that is a built-in move (jump, spin...) bends the
 * picture instead, so every character can make every move. A character with no pictures at all
 * is drawn as a plain stand-in figure.
 *
 * The pictures can be different files: a sheet for walking, an animated PNG for standing, a
 * still for the portrait. One sprite shows whichever is wanted.
 */
export class CharacterFigure {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** What the sprite shows now: `<texture>:<frame>` or an animation key. */
  private showing = '';
  private act: { name: string; started: number; duration: number; repeat: boolean; drawn: CharacterAnimation | null } | null = null;
  private moveClock = 0;
  private poseFacing: 'left' | 'right' = 'right';
  private poseMoving = false;
  /** Animated PNGs this figure is waiting for. */
  private waiting = new Set<Id>();

  constructor(
    protected scene: Phaser.Scene,
    private mediaOf: (id: Id) => Media | undefined,
    readonly character: Character | undefined,
    x: number,
    y: number,
  ) {
    this.sprite = scene.add.sprite(x, y, ensureDefaultAvatar(scene));
    this.sprite.setOrigin(0.5, 1);
    this.auto(false, 'right');
  }

  /** The character's own size. */
  get scale(): number {
    return this.character?.scale ?? 1;
  }

  /** The move being made right now, or ''. */
  get acting(): string {
    return this.act?.name ?? '';
  }

  /**
   * Standing or walking, facing one way: show that pose, unless a move with frames of its own is
   * being made. Returns whether the sprite should be mirrored (the caller sets it, as it may
   * also be bending the picture).
   */
  auto(moving: boolean, facing: 'left' | 'right'): boolean {
    this.poseMoving = moving;
    this.poseFacing = facing;
    if (this.act?.drawn) {
      // Moves are drawn facing right, like the poses: facing left mirrors them.
      return (this.act.drawn.flip === true) !== (facing === 'left');
    }
    const pose = resolvePose(this.character, moving, facing);
    if (!pose) {
      this.showTexture(ensureDefaultAvatar(this.scene));
      return facing === 'left';
    }
    this.show(pose);
    return pose.flip;
  }

  /**
   * Make a move by name; an empty name ends the one being made. Returns how long it lasts in
   * milliseconds, or 0 when it loops until stopped or the name means nothing here.
   */
  play(name: string): number {
    this.act = null;
    if (!name) {
      this.refresh();
      return 0;
    }
    const drawn = this.drawn(name);
    const builtIn = BUILT_IN_MOVES[name];
    if (!drawn && !builtIn) {
      this.refresh();
      return 0;
    }
    const duration = drawn ? Math.max(1, animationDuration(drawn, this.mediaOf(drawn.media_id)) || 600) : builtIn!.duration;
    const repeat = drawn ? characterAnimationRepeats(name, drawn) : builtIn!.repeat;
    this.act = { name, started: this.moveClock, duration, repeat, drawn };
    if (drawn) {
      this.showing = '';
      this.show({ name, animation: drawn, flip: drawn.flip === true });
    }
    return repeat ? 0 : duration;
  }

  /** How long a move would last on this character, in milliseconds; 0 if it loops or means nothing here. */
  moveDuration(name: string): number {
    const drawn = this.drawn(name);
    if (drawn) return characterAnimationRepeats(name, drawn) ? 0 : Math.max(1, animationDuration(drawn, this.mediaOf(drawn.media_id)) || 600);
    const builtIn = BUILT_IN_MOVES[name];
    return builtIn && !builtIn.repeat ? builtIn.duration : 0;
  }

  /** Whether a move loops until stopped on this character. */
  moveLoops(name: string): boolean {
    const drawn = this.drawn(name);
    return drawn ? characterAnimationRepeats(name, drawn) : BUILT_IN_MOVES[name]?.repeat === true;
  }

  /** Advance time. A move that does not loop ends by itself, and the pose comes back. */
  tick(delta: number) {
    this.moveClock += delta;
    if (this.act && !this.act.repeat && this.moveClock - this.act.started >= this.act.duration) {
      this.act = null;
      this.refresh();
    }
  }

  /** How the current move bends the picture. Frames drawn for a move need no bending. */
  bend(): Pose {
    const act = this.act;
    if (!act || act.drawn) return NEUTRAL;
    return bend(act.name, this.moveClock - act.started, act.duration);
  }

  destroy() {
    this.sprite.destroy();
  }

  /** The character's own animation of that name, if it is one to play (not a pose). */
  private drawn(name: string): CharacterAnimation | null {
    if (isPose(name)) return null;
    const a = this.character?.animations?.[name];
    return a && this.mediaOf(a.media_id) && this.scene.textures.exists(mediaKey(a.media_id)) ? a : null;
  }

  private refresh() {
    this.showing = '';
    this.auto(this.poseMoving, this.poseFacing);
  }

  private show(chosen: ChosenAnimation) {
    const media = this.mediaOf(chosen.animation.media_id);
    if (!media || !this.scene.textures.exists(mediaKey(media.id))) {
      this.showTexture(ensureDefaultAvatar(this.scene));
      return;
    }
    const drawn = characterAnimation(this.scene, media, chosen.name, chosen.animation);
    // An animated PNG still being cut into frames: its first frame now, the animation when it is ready.
    if (!drawn.anim && media.apng && !this.waiting.has(media.id)) {
      const ready = whenApngReady(this.scene, media, () => {
        this.waiting.delete(media.id);
        if (this.sprite.active) this.refresh();
      });
      if (!ready) this.waiting.add(media.id);
    }
    if (drawn.anim) {
      if (this.showing === drawn.anim) return;
      this.showing = drawn.anim;
      // From another picture's texture, perhaps: the sheet's first, then its animation.
      if (this.sprite.texture?.key !== drawn.texture) this.sprite.setTexture(drawn.texture);
      this.sprite.play(drawn.anim);
    } else {
      this.showTexture(drawn.texture, drawn.frame);
    }
  }

  private showTexture(texture: string, frame?: number) {
    const key = `${texture}:${frame ?? ''}`;
    if (this.showing === key) return;
    this.showing = key;
    this.sprite.stop();
    this.sprite.setTexture(texture, frame);
  }
}

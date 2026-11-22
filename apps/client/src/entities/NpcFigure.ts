import type * as Phaser from 'phaser';
import { shadeTint, type Id, type Media, type Npc } from '@qbl/shared';
import { CharacterFigure } from './CharacterFigure';

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif',
  fontSize: '16px',
  color: '#ffe9a8',
  stroke: '#000000',
  strokeThickness: 4,
};

/** How the scene draws someone standing at a point: their display scale there, and how shaded they are. */
export interface Surroundings {
  size(x: number, y: number): number;
  shade(x: number, y: number): number;
}

/**
 * A character of the scenario in a scene, with its name over its head. It stands where it was
 * put, facing the way it was told, and walks where the room says it is walking:
 * the walking pose plays, it turns the way it goes, and it grows and shrinks and darkens with the
 * scene's scale areas and shadow spots, as players do. It plays what an `animate` action asks.
 */
export class NpcFigure extends CharacterFigure {
  readonly label: Phaser.GameObjects.Text;
  facing: 'left' | 'right';
  readonly feet: { x: number; y: number };
  private moving = false;
  private alpha = 1;

  constructor(
    scene: Phaser.Scene, mediaOf: (id: Id) => Media | undefined, readonly npc: Npc,
    at: { x: number; y: number; facing?: string }, private around: Surroundings,
  ) {
    super(scene, mediaOf, npc, at.x, at.y);
    this.facing = at.facing === 'left' ? 'left' : 'right';
    this.feet = { x: at.x, y: at.y };
    this.label = scene.add.text(this.feet.x, this.feet.y, npc.name, NAME_STYLE).setOrigin(0.5, 1);
    this.layout();
  }

  get name(): string {
    return this.npc.name;
  }

  /** Put its feet here, turning the way it went. */
  setFeet(x: number, y: number) {
    if (Math.abs(x - this.feet.x) > 0.01) this.facing = x < this.feet.x ? 'left' : 'right';
    this.feet.x = x;
    this.feet.y = y;
  }

  setFacing(facing: 'left' | 'right') {
    this.facing = facing;
  }

  setMoving(moving: boolean) {
    this.moving = moving;
  }

  /**
   * Glide toward where the room says it is. The room sends a new position many times a second;
   * this smooths the steps in between, as for other players.
   */
  approach(x: number, y: number, delta: number) {
    const d = Math.hypot(x - this.feet.x, y - this.feet.y);
    if (d > 400) {
      this.feet.x = x;
      this.feet.y = y;
      return;
    }
    const k = 1 - Math.exp(-delta / 80);
    this.feet.x += (x - this.feet.x) * k;
    this.feet.y += (y - this.feet.y) * k;
  }

  /** Fade in (1) or out (0). */
  fadeTo(alpha: number, ms: number, done?: () => void) {
    this.alpha = alpha;
    this.scene.tweens.add({ targets: [this.sprite, this.label], alpha, duration: ms, onComplete: () => done?.() });
  }

  /** Whether it can be seen and clicked: not faded out. */
  get present(): boolean {
    return this.alpha > 0;
  }

  /** Advance its animation, and draw it where it stands. */
  update(delta: number) {
    this.tick(delta);
    this.layout();
  }

  private layout() {
    const { x, y } = this.feet;
    const size = this.around.size(x, y);
    const bend = this.bend();
    this.sprite.setFlipX(this.auto(this.moving, this.facing));
    // After `auto`: the picture it now shows may be stretched on its media (Scale X / Y).
    const { x: sx, y: sy } = this.stretch;
    this.sprite.setScale(size * sx * bend.scaleX, size * sy * bend.scaleY).setRotation(bend.lean);
    this.sprite.setPosition(x, y - bend.lift * (this.sprite.displayHeight || 0)).setDepth(y);
    this.sprite.setTint(shadeTint(this.around.shade(x, y)));
    this.label.setPosition(x, y - Math.abs(this.sprite.displayHeight) - 6).setDepth(y + 1);
  }

  override destroy() {
    this.scene.tweens.killTweensOf([this.sprite, this.label]);
    this.label.destroy();
    super.destroy();
  }
}

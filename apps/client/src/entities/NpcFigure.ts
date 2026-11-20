import type * as Phaser from 'phaser';
import type { CharacterPlacement, Id, Media, Npc } from '@qbl/shared';
import { CharacterFigure } from './CharacterFigure';

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif',
  fontSize: '16px',
  color: '#ffe9a8',
  stroke: '#000000',
  strokeThickness: 4,
};

/**
 * A character the scenario placed in a scene: it stands where it was put, facing the way it was
 * told, with its name over its head, and plays what an `animate` action asks of it.
 */
export class NpcFigure extends CharacterFigure {
  readonly label: Phaser.GameObjects.Text;
  readonly facing: 'left' | 'right';
  readonly feet: { x: number; y: number };

  /** `size` is the display scale where it stands: its own, the scene's zoom and the scene's depth there. */
  constructor(scene: Phaser.Scene, mediaOf: (id: Id) => Media | undefined, readonly npc: Npc, placement: CharacterPlacement, private size: number) {
    super(scene, mediaOf, npc, placement.position_x, placement.position_y);
    this.facing = placement.facing === 'left' ? 'left' : 'right';
    this.feet = { x: placement.position_x, y: placement.position_y };
    this.sprite.setScale(size).setDepth(placement.position_y);
    this.sprite.setFlipX(this.auto(false, this.facing));
    this.label = scene.add.text(this.feet.x, this.feet.y, npc.name, NAME_STYLE).setOrigin(0.5, 1).setDepth(placement.position_y + 1);
    this.layout();
  }

  get name(): string {
    return this.npc.name;
  }

  /** Advance its animation and bend it as a built-in move asks. */
  update(delta: number) {
    const was = this.acting;
    this.tick(delta);
    if (!was && !this.acting) return;
    this.layout();
  }

  private layout() {
    const bend = this.bend();
    this.sprite.setFlipX(this.auto(false, this.facing));
    // After `auto`: the picture it now shows may be stretched on its media (Scale X / Y).
    const { x: sx, y: sy } = this.stretch;
    this.sprite.setScale(this.size * sx * bend.scaleX, this.size * sy * bend.scaleY).setRotation(bend.lean);
    this.sprite.setPosition(this.feet.x, this.feet.y - bend.lift * (this.sprite.displayHeight || 0));
    this.label.setPosition(this.feet.x, this.feet.y - Math.abs(this.sprite.displayHeight) - 6);
  }

  override destroy() {
    this.label.destroy();
    super.destroy();
  }
}

import * as Phaser from 'phaser';
import { parseIds, type Id, type PlayerRec } from '@qbl/shared';
import { ensureDefaultAvatar, mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import type { GameContext } from '../core/GameContext';

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif',
  fontSize: '18px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 5,
};
const BUBBLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif',
  fontSize: '22px',
  color: '#1c172e',
  backgroundColor: '#ffffff',
  padding: { x: 14, y: 10 },
  wordWrap: { width: 360 },
  align: 'center',
};

/**
 * One player's figure: sprite, name, speech bubble and whatever they are
 * wearing or riding. `x`/`y` is the position of the feet.
 */
export class Avatar {
  x: number;
  y: number;
  private sprite: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private bubble: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private attached = new Map<Id, Phaser.GameObjects.Image>();
  private attachedKey = '';
  private baseScale: number;
  private facing: 'left' | 'right' = 'right';
  private hidden = false;

  constructor(private scene: Phaser.Scene, private ctx: GameContext, rec: PlayerRec, private zoom: number, readonly isLocal: boolean) {
    this.x = rec.x;
    this.y = rec.y;
    const media = ctx.index.media.get(rec.avatar);
    const key = media && scene.textures.exists(mediaKey(media.id)) ? mediaKey(media.id) : ensureDefaultAvatar(scene);
    this.baseScale = (media?.scale_y ?? 1) * zoom;
    this.sprite = scene.add.image(this.x, this.y, key).setOrigin(0.5, 1).setScale(this.baseScale);
    this.label = scene.add.text(this.x, this.y, rec.name, NAME_STYLE).setOrigin(0.5, 1).setDepth(Depth.name);
    this.bubble = scene.add.text(this.x, this.y, '', BUBBLE_STYLE).setOrigin(0.5, 1).setDepth(Depth.bubble).setVisible(false);
    this.setFacing(rec.facing === 'left' ? 'left' : 'right');
    this.setAttachments(rec.attachments);
    this.setConnected(rec.connected);
    this.layout();
  }

  get height(): number {
    return this.sprite.displayHeight;
  }

  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.layout();
  }

  /** Move a remote avatar smoothly toward its latest known position. */
  approach(x: number, y: number, delta: number) {
    const dist = Math.hypot(x - this.x, y - this.y);
    if (dist > 400) return this.setPosition(x, y); // scene change or correction: do not glide
    const k = 1 - Math.exp(-delta / 80);
    this.setPosition(this.x + (x - this.x) * k, this.y + (y - this.y) * k);
  }

  setFacing(facing: 'left' | 'right') {
    if (facing === this.facing && this.sprite.flipX === (facing === 'left')) return;
    this.facing = facing;
    // Avatar art faces right by default.
    this.sprite.setFlipX(facing === 'left');
    this.layout();
  }

  /** Hide the figure in scenes with show_avatars off; it still has a position for the camera and hotspots. */
  setVisible(visible: boolean) {
    this.hidden = !visible;
    this.sprite.setVisible(visible);
    this.label.setVisible(visible);
    if (!visible) this.bubble.setVisible(false);
    for (const img of this.attached.values()) img.setVisible(visible);
  }

  setConnected(connected: boolean) {
    this.sprite.setAlpha(connected ? 1 : 0.45);
  }

  setAttachments(csv: string) {
    if (csv === this.attachedKey) return;
    this.attachedKey = csv;
    const ids = parseIds(csv);
    for (const [id, img] of this.attached) {
      if (!ids.includes(id)) {
        img.destroy();
        this.attached.delete(id);
      }
    }
    for (const id of ids) {
      if (this.attached.has(id)) continue;
      const item = this.ctx.index.items.get(id);
      if (!item || item.media_id == null || !this.scene.textures.exists(mediaKey(item.media_id))) continue;
      const img = this.scene.add.image(this.x, this.y, mediaKey(item.media_id)).setOrigin(0.5, 1).setScale((item.scale ?? 1) * this.zoom);
      this.attached.set(id, img.setVisible(!this.hidden));
    }
    this.layout();
  }

  say(text: string) {
    if (this.hidden) return;
    this.bubble.setText(text).setVisible(true);
    this.bubbleTimer?.remove();
    const ms = Math.min(3500 + text.length * 125, 15_000);
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => this.bubble.setVisible(false));
    this.layout();
  }

  private layout() {
    this.sprite.setPosition(this.x, this.y).setDepth(this.y);
    const dir = this.facing === 'left' ? -1 : 1;
    for (const [id, img] of this.attached) {
      const item = this.ctx.index.items.get(id)!;
      img.setPosition(this.x + (item.attach_offset_x ?? 0) * dir * this.zoom, this.y + (item.attach_offset_y ?? 0) * this.zoom);
      img.setFlipX((this.facing === 'left') !== (item.art_faces === 'left'));
      img.setDepth(this.y + (item.attach_layer === 'behind' ? -0.5 : 0.5));
    }
    const top = this.y - this.sprite.displayHeight;
    this.label.setPosition(this.x, top - 6);
    this.bubble.setPosition(this.x, top - 40);
  }

  destroy() {
    this.bubbleTimer?.remove();
    this.sprite.destroy();
    this.label.destroy();
    this.bubble.destroy();
    for (const img of this.attached.values()) img.destroy();
    this.attached.clear();
  }
}

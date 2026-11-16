import * as Phaser from 'phaser';
import { parseIds, type Id, type PlayerRec, type ShopItem } from '@qbl/shared';
import { ensureDefaultAvatar, mediaKey, shopTexture } from '../core/assets';
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
  /** The scene does not show avatars at all (`show_avatars` off). */
  private hidden = false;
  /** 1 when shown, 0 when an avatar action has hidden it; in between while fading. */
  private fade = 1;
  private fadeTarget = 1;
  private fadeMs = 0;
  private connected = true;
  /** What the avatar wears and the pet that follows it, from the marketplace. */
  private worn = new Map<Id, { item: ShopItem; image: Phaser.GameObjects.Image }>();
  private lookKey = '';
  private move: ShopItem['animation'] | null = null;
  private clock = 0;
  private petAt: { x: number; y: number } | null = null;

  /**
   * `depth` gives the size factor for something standing at a point, from the scene's scale areas.
   * It applies to the figure and to everything it wears or rides.
   */
  constructor(
    private scene: Phaser.Scene, private ctx: GameContext, rec: PlayerRec, private zoom: number, readonly isLocal: boolean,
    private depth: (x: number, y: number) => number = () => 1,
  ) {
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
    // Someone already hidden when they come into view starts hidden, without a fade.
    if (rec.hidden) this.fade = this.fadeTarget = 0;
    this.applyVisibility();
    this.layout();
  }

  /**
   * What the avatar wears: ids of marketplace items, comma-separated, as the room state carries
   * them. Wearables sit on the figure by slot, a pet follows it, an animation makes it move on
   * the spot. Abilities are not drawn.
   */
  setLook(csv: string) {
    if (csv === this.lookKey) return;
    this.lookKey = csv;
    for (const w of this.worn.values()) w.image.destroy();
    this.worn.clear();
    this.move = null;
    this.petAt = null;
    for (const id of parseIds(csv)) {
      const item = this.ctx.rewards.items.get(id);
      if (!item) continue;
      if (item.kind === 'animation') this.move = item.animation ?? null;
      if (item.kind !== 'wearable' && item.kind !== 'pet') continue;
      const key = shopTexture(item);
      if (!key || !this.scene.textures.exists(key)) continue;
      this.worn.set(id, { item, image: this.scene.add.image(this.x, this.y, key).setOrigin(0.5, item.kind === 'pet' ? 1 : 0.5) });
    }
    this.applyVisibility();
    this.layout();
  }

  /** True when the figure cannot be seen: the scene hides avatars, or an avatar action has hidden this one. */
  get invisible(): boolean {
    return this.hidden || this.fade <= 0;
  }

  /** Show or hide the figure (an avatar action), fading over `duration` ms. Call tick() each frame. */
  setShown(shown: boolean, duration = 250) {
    this.fadeTarget = shown ? 1 : 0;
    this.fadeMs = duration;
    if (duration <= 0) {
      this.fade = this.fadeTarget;
      this.applyVisibility();
    }
  }

  /** Advance a fade in progress. */
  tick(delta: number) {
    // An animation or a pet keeps moving while the figure stands still.
    if (this.move || this.petAt || [...this.worn.values()].some((w) => w.item.kind === 'pet')) {
      this.clock += delta;
      this.layout(delta);
    }
    if (this.fade === this.fadeTarget) return;
    const step = this.fadeMs > 0 ? delta / this.fadeMs : 1;
    this.fade = this.fadeTarget > this.fade ? Math.min(1, this.fade + step) : Math.max(0, this.fade - step);
    this.applyVisibility();
  }

  private applyVisibility() {
    const visible = !this.invisible;
    const alpha = this.fade * (this.connected ? 1 : 0.45);
    this.sprite.setVisible(visible).setAlpha(alpha);
    this.label.setVisible(visible).setAlpha(this.fade);
    if (!visible) this.bubble.setVisible(false);
    for (const img of this.attached.values()) img.setVisible(visible).setAlpha(this.fade);
    for (const w of this.worn.values()) w.image.setVisible(visible).setAlpha(this.fade);
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
    this.applyVisibility();
  }

  setConnected(connected: boolean) {
    if (connected === this.connected) return;
    this.connected = connected;
    this.applyVisibility();
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
      this.attached.set(id, img);
    }
    this.applyVisibility();
    this.layout();
  }

  say(text: string) {
    if (this.invisible) return;
    this.bubble.setText(text).setVisible(true);
    this.bubbleTimer?.remove();
    const ms = Math.min(3500 + text.length * 125, 15_000);
    this.bubbleTimer = this.scene.time.delayedCall(ms, () => this.bubble.setVisible(false));
    this.layout();
  }

  private layout(delta = 0) {
    // Depth: the figure and what it carries shrink or grow together with where it stands.
    const k = this.depth(this.x, this.y);
    this.sprite.setScale(this.baseScale * k);
    const h = this.sprite.displayHeight || 160 * k;
    // A bought animation: the figure moves on the spot, and what it wears moves with it.
    const t = this.clock;
    const lift = this.move === 'bounce' ? Math.abs(Math.sin(t / 260)) * 0.07 * h : this.move === 'float' ? (0.06 + Math.sin(t / 700) * 0.03) * h : 0;
    const lean = this.move === 'sway' ? Math.sin(t / 500) * 0.07 : 0;
    if (this.move === 'pulse') this.sprite.setScale(this.baseScale * k * (1 + Math.sin(t / 400) * 0.04));
    this.sprite.setPosition(this.x, this.y - lift).setDepth(this.y).setRotation(lean);
    this.layoutWorn(h, lift, delta);
    const dir = this.facing === 'left' ? -1 : 1;
    for (const [id, img] of this.attached) {
      const item = this.ctx.index.items.get(id)!;
      img.setScale((item.scale ?? 1) * this.zoom * k);
      img.setPosition(this.x + (item.attach_offset_x ?? 0) * dir * this.zoom * k, this.y + (item.attach_offset_y ?? 0) * this.zoom * k);
      img.setFlipX((this.facing === 'left') !== (item.art_faces === 'left'));
      img.setDepth(this.y + (item.attach_layer === 'behind' ? -0.5 : 0.5));
    }
    const top = this.y - this.sprite.displayHeight;
    this.label.setPosition(this.x, top - 6);
    this.bubble.setPosition(this.x, top - 40);
  }

  /** Where each slot is on the figure: across (towards where it faces) and up, as fractions of its height. */
  private static readonly SLOTS: Record<string, { x: number; y: number; size: number; behind?: boolean }> = {
    head: { x: 0, y: 1, size: 0.28 }, body: { x: 0, y: 0.5, size: 0.34 }, back: { x: -0.2, y: 0.56, size: 0.4, behind: true }, hand: { x: 0.3, y: 0.42, size: 0.24 },
  };

  private layoutWorn(h: number, lift: number, delta: number) {
    const dir = this.facing === 'left' ? -1 : 1;
    for (const { item, image } of this.worn.values()) {
      const size = (item.scale ?? (item.kind === 'pet' ? 0.3 : Avatar.SLOTS[item.slot ?? 'body']!.size)) * h;
      image.setScale(size / (image.height || 100));
      if (item.kind === 'pet') {
        // A pet trails a little behind and catches up when the figure stops.
        const home = { x: this.x - dir * 0.62 * h, y: this.y + (item.offset_y ?? 0) * h + Math.sin(this.clock / 300) * 0.015 * h };
        const k = this.petAt && delta > 0 ? 1 - Math.exp(-delta / 220) : 1;
        const far = this.petAt && Math.hypot(home.x - this.petAt.x, home.y - this.petAt.y) > 6 * h;
        this.petAt = !this.petAt || far ? home : { x: this.petAt.x + (home.x - this.petAt.x) * k, y: this.petAt.y + (home.y - this.petAt.y) * k };
        image.setPosition(this.petAt.x, this.petAt.y).setDepth(this.petAt.y).setFlipX(this.petAt.x > this.x);
        continue;
      }
      const slot = Avatar.SLOTS[item.slot ?? 'body']!;
      image.setPosition(this.x + (slot.x + (item.offset_x ?? 0)) * h * dir, this.y - lift - (slot.y - (item.offset_y ?? 0)) * h);
      image.setFlipX(dir < 0).setDepth(this.y + (slot.behind ? -0.6 : 0.6));
    }
  }

  destroy() {
    for (const w of this.worn.values()) w.image.destroy();
    this.worn.clear();
    this.bubbleTimer?.remove();
    this.sprite.destroy();
    this.label.destroy();
    this.bubble.destroy();
    for (const img of this.attached.values()) img.destroy();
    this.attached.clear();
  }
}

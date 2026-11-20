import * as Phaser from 'phaser';
import { parseIds, shadeTint, type Id, type PlayerRec, type ShopItem } from '@qbl/shared';
import { mediaKey, shopTexture } from '../core/assets';
import { Depth } from '../core/depth';
import type { GameContext } from '../core/GameContext';
import { CharacterFigure } from './CharacterFigure';
import { Figure } from './Figure';

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
 * Draw only the part of a picture above the line `y` (scene coordinates), so whatever an avatar
 * rides hides its legs. `Infinity` draws the whole picture. The crop is in the picture's own
 * pixels and follows the frame as an animation plays; a lean of a few degrees is ignored.
 */
export function cutBelow(o: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, y: number) {
  const height = o.frame?.height ?? 0;
  const scale = Math.abs(o.scaleY);
  const shown = Number.isFinite(y) && height > 0 && scale > 0 ? (y - (o.y - o.originY * height * scale)) / scale : Infinity;
  if (shown >= height) {
    if (o.isCropped) o.setCrop();
    return;
  }
  o.setCrop(0, 0, o.frame.width, Math.max(0, shown));
}

/**
 * One player's figure: the avatar character they chose, with their name, speech bubble and
 * whatever they are wearing or riding. `x`/`y` is the position of the feet.
 */
export class Avatar extends CharacterFigure {
  x: number;
  y: number;
  /** Walking right now: the sheet's walk plays, and whatever is ridden moves too. */
  private moving = false;
  /** The last animation request seen for this player (`name:count` from the room state). */
  private animToken = '';
  private label: Phaser.GameObjects.Text;
  private bubble: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private attached = new Map<Id, Figure>();
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
    scene: Phaser.Scene, private ctx: GameContext, private rec: PlayerRec, private zoom: number, readonly isLocal: boolean,
    private depth: (x: number, y: number) => number = () => 1,
    /** How shaded a figure standing at a point is, 0 to 1, from the scene's shadow spots. */
    private shade: (x: number, y: number) => number = () => 0,
  ) {
    // The room carries the id of the avatar the player chose.
    super(scene, (id) => ctx.index.media.get(id), ctx.index.avatars.get(rec.avatar), rec.x, rec.y);
    this.x = rec.x;
    this.y = rec.y;
    this.baseScale = this.scale * zoom;
    this.sprite.setScale(this.baseScale);
    this.label = scene.add.text(this.x, this.y, rec.name, NAME_STYLE).setOrigin(0.5, 1).setDepth(Depth.name);
    this.bubble = scene.add.text(this.x, this.y, '', BUBBLE_STYLE).setOrigin(0.5, 1).setDepth(Depth.bubble).setVisible(false);
    this.setFacing(rec.facing === 'left' ? 'left' : 'right');
    this.setAttachments(rec.attachments);
    this.setConnected(rec.connected);
    // A dance already going on when they come into view carries on; a finished jump is not replayed.
    this.animToken = rec.anim ?? '';
    const going = this.animToken.split(':')[0] ?? '';
    if (going && this.play(going) > 0) this.play('');
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
    this.retint();
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

  /** Whether the figure is walking. Walking ends a dance or any other move that would loop. */
  setMoving(moving: boolean) {
    if (moving === this.moving) return;
    this.moving = moving;
    if (moving && this.acting) this.play('');
    this.layout();
  }

  /**
   * The animation this player was asked to play, as the room state carries it (`name:count`).
   * A new value plays the move; an empty one ends it.
   */
  setAnimation(token: string) {
    if (token === this.animToken) return;
    this.animToken = token;
    this.play(token.split(':')[0] ?? '');
    this.layout();
  }

  /** Play an animation on something this player is wearing or riding. False if they have no such item. */
  animateAttached(itemId: Id, name: string): number | null {
    const figure = this.attached.get(itemId);
    return figure ? figure.play(name) : null;
  }

  /** Advance moves, what is worn and ridden, and a fade in progress. */
  override tick(delta: number) {
    // A move that ends on this tick still needs one more layout, to put the figure back as it was.
    const acting = this.acting !== '' || [...this.attached.values()].some((f) => f.acting !== '');
    super.tick(delta);
    for (const f of this.attached.values()) f.tick(delta);
    // An animation, a move or a pet keeps things moving while the figure stands still.
    if (this.move || acting || this.petAt || [...this.worn.values()].some((w) => w.item.kind === 'pet')) {
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
    for (const f of this.attached.values()) f.object.setVisible(visible).setAlpha(this.fade);
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
    // Still some way from where the room says they are: they are walking.
    this.setMoving(dist > 3 && dist <= 400);
    if (dist > 400) return this.setPosition(x, y); // scene change or correction: do not glide
    const k = 1 - Math.exp(-delta / 80);
    this.setPosition(this.x + (x - this.x) * k, this.y + (y - this.y) * k);
  }

  setFacing(facing: 'left' | 'right') {
    if (facing === this.facing) return;
    this.facing = facing;
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
    for (const [id, figure] of this.attached) {
      if (!ids.includes(id)) {
        figure.destroy();
        this.attached.delete(id);
      }
    }
    for (const id of ids) {
      if (this.attached.has(id)) continue;
      const item = this.ctx.index.items.get(id);
      if (!item || item.media_id == null || !this.scene.textures.exists(mediaKey(item.media_id))) continue;
      const figure = new Figure(this.scene, this.ctx.index.media.get(item.media_id), mediaKey(item.media_id), this.x, this.y);
      figure.object.setOrigin(0.5, 1).setScale((item.scale ?? 1) * this.zoom);
      this.attached.set(id, figure);
    }
    this.retint();
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
    // The avatar's standing or walking pose for the way it faces.
    this.sprite.setFlipX(this.auto(this.moving, this.facing));
    // After `auto`: the picture it now shows may be stretched on its media (Scale X / Y).
    const { x: sx, y: sy } = this.stretch;
    this.sprite.setScale(this.baseScale * k * sx, this.baseScale * k * sy);
    const h = this.sprite.displayHeight || 160 * k;
    // A bought animation: the figure moves on the spot while it stands, and what it wears moves with it.
    const t = this.clock;
    const style = this.acting ? null : this.move;
    const pose = this.bend();
    const lift = pose.lift * h + (style === 'bounce' ? Math.abs(Math.sin(t / 260)) * 0.07 * h : style === 'float' ? (0.06 + Math.sin(t / 700) * 0.03) * h : 0);
    const lean = pose.lean + (style === 'sway' ? Math.sin(t / 500) * 0.07 : 0);
    const pulse = style === 'pulse' ? 1 + Math.sin(t / 400) * 0.04 : 1;
    // A built-in move (a hop, a turn, a duck) bends the picture itself.
    this.sprite.setScale(this.baseScale * k * sx * pulse * pose.scaleX, this.baseScale * k * sy * pulse * pose.scaleY);
    this.sprite.setPosition(this.x, this.y - lift).setDepth(this.y).setRotation(lean);
    this.layoutWorn(h, lift, delta);
    const dir = this.facing === 'left' ? -1 : 1;
    // The highest line, in scene coordinates, below which something ridden or worn hides the avatar.
    let cut = Infinity;
    for (const [id, figure] of this.attached) {
      const item = this.ctx.index.items.get(id)!;
      const img = figure.object;
      const bend = figure.pose();
      const size = (item.scale ?? 1) * this.zoom * k;
      // What is ridden walks when the rider does, if its sheet has a walk.
      img.setFlipX(figure.auto(this.moving, this.facing, item.art_faces ?? 'right'));
      img.setScale(size * bend.scaleX, size * bend.scaleY);
      img.setPosition(this.x + (item.attach_offset_x ?? 0) * dir * this.zoom * k, this.y + (item.attach_offset_y ?? 0) * this.zoom * k - bend.lift * img.displayHeight);
      img.setRotation(bend.lean).setDepth(this.y + (item.attach_layer === 'behind' ? -0.5 : 0.5));
      const below = item.hide_rider_below;
      if (typeof below === 'number' && Number.isFinite(below)) {
        const top = img.y - img.originY * img.displayHeight;
        cut = Math.min(cut, top + Math.min(1, Math.max(0, below)) * img.displayHeight);
      }
    }
    // Sitting in a UFO or a car: the legs, and whatever is worn down there, are not drawn.
    cutBelow(this.sprite, cut);
    for (const w of this.worn.values()) cutBelow(w.image, w.item.kind === 'pet' ? Infinity : cut);
    this.applyShade();
    const top = this.y - this.sprite.displayHeight;
    this.label.setPosition(this.x, top - 6);
    this.bubble.setPosition(this.x, top - 40);
  }

  private tint = 0xffffff;

  /** Walking through a patch of shade darkens the figure and all it wears, carries and rides. The name stays readable. */
  private applyShade() {
    const tint = shadeTint(this.shade(this.x, this.y));
    if (tint === this.tint) return;
    this.tint = tint;
    this.retint();
  }

  private retint() {
    const paint = (o: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite) => (this.tint === 0xffffff ? o.clearTint() : o.setTint(this.tint));
    paint(this.sprite);
    for (const f of this.attached.values()) paint(f.object);
    for (const w of this.worn.values()) paint(w.image);
  }

  /** The player this figure is. */
  get userId(): string {
    return this.rec.user_id;
  }

  /** Call `onClick` when the figure is clicked, and `onHover` as the pointer comes and goes. */
  onPointer(onClick: () => void, onHover: (over: boolean) => void) {
    this.sprite.setInteractive({ useHandCursor: true });
    this.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => onHover(true));
    this.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => onHover(false));
    this.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
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

  override destroy() {
    for (const w of this.worn.values()) w.image.destroy();
    this.worn.clear();
    this.bubbleTimer?.remove();
    super.destroy();
    this.label.destroy();
    this.bubble.destroy();
    for (const figure of this.attached.values()) figure.destroy();
    this.attached.clear();
  }
}

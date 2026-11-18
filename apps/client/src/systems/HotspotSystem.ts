import * as Phaser from 'phaser';
import { inHotspot, labelMediaId, labelPlacement, revealAmount, type Circle, type Hotspot, type Label } from '@qbl/shared';
import { ensureAnimation, ensureSpritesheet, mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

type LabelObject = Phaser.GameObjects.Text | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

interface Entry {
  hotspot: Hotspot;
  labels: Array<{ object: LabelObject; animation?: string; text?: string; solid?: number }>;
  /** Walk-in hotspots fire on entry; this remembers whether the avatar is already inside. */
  inside: boolean;
  available: boolean;
  /** 0 to 1: how visible the hotspot is from where the avatar stands (always 1 without a reveal radius). */
  reveal: number;
}

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif',
  fontSize: '20px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 5,
};

/** How often labels are re-checked against conditions that depend on time or other players. */
const REFRESH_MS = 500;

/**
 * Draws hotspot labels and decides when hotspots fire: click hotspots
 * (activate_by_trigger) on a click or tap inside the radius, walk-in
 * hotspots when the avatar enters the radius. Scene edges are walk-in
 * hotspots whose action is a jump.
 */
export class HotspotSystem implements SceneSystem {
  private entries: Entry[] = [];

  constructor(private rt: SceneRuntime) {}

  create() {
    for (const hotspot of this.rt.def.hotspots ?? []) {
      const labels = (hotspot.labels ?? []).map((l) => this.createLabel(l, hotspot)).filter((l) => l != null);
      this.entries.push({ hotspot, labels, inside: false, available: false, reveal: hotspot.reveal_radius ? 0 : 1 });
    }
    this.variablesChanged();
    this.rt.scene.time.addEvent({ delay: REFRESH_MS, loop: true, callback: () => this.variablesChanged() });
  }

  private createLabel(label: Label, hotspot: Hotspot): Entry['labels'][number] | null {
    const { scene, ctx } = this.rt;
    const sx = label.scale_x ?? 1;
    const sy = label.scale_y ?? 1;
    if (label.type === 'text') {
      const text = label.text ?? '';
      const object = scene.add.text(label.position_x, label.position_y, ctx.text(text), LABEL_STYLE).setOrigin(0.5).setScale(sx, sy);
      return { object: this.stand(object, label), text };
    }
    const id = labelMediaId(label);
    if (id == null || !scene.textures.exists(mediaKey(id))) return null;
    const media = ctx.index.media.get(id);
    if (label.type === 'spritemap') {
      const sheet = ensureSpritesheet(scene, id, label);
      if (!sheet) return null;
      const object = scene.add.sprite(label.position_x, label.position_y, sheet, label.spritemap_tile_sequence?.[0] ?? 0).setScale(sx, sy);
      const animation = ensureAnimation(scene, sheet, label);
      if (label.spritemap_show_first_as_fixed === false) object.play(animation);
      return { object: this.stand(object, label), animation, solid: this.solidRadius(object, label) };
    }
    const object = scene.add
      .image(label.position_x, label.position_y, mediaKey(id))
      .setScale(sx * (media?.scale_x ?? 1), sy * (media?.scale_y ?? 1));
    this.stand(object, label);
    const solid = this.solidRadius(object, label);
    // Something players walk around holds still; a pulse would make its edge move under their feet.
    if (hotspot.activate_by_trigger && solid == null) {
      // A gentle pulse marks things that can be clicked.
      scene.tweens.add({ targets: object, scaleX: object.scaleX * 1.12, scaleY: object.scaleY * 1.12, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    return { object, solid };
  }

  /**
   * Give a label its place among the players. An object stands on its bottom edge: whoever is
   * lower on the screen is drawn in front of it, whoever is higher behind it. A background label
   * is part of the floor, under everyone's feet. A front label floats over the whole scene.
   */
  private stand<T extends LabelObject>(object: T, label: Label): T {
    const placement = label.solid && label.type !== 'text' ? 'object' : labelPlacement(label);
    if (placement === 'front') object.setDepth(Depth.label);
    else if (placement === 'background') object.setDepth(Depth.floor + 20);
    else object.setDepth(label.position_y + object.displayHeight / 2);
    return object;
  }

  /** How wide the obstacle of a solid label is, or undefined when players walk through it. */
  private solidRadius(object: LabelObject, label: Label): number | undefined {
    if (!label.solid) return undefined;
    return label.solid_radius != null && label.solid_radius > 0 ? label.solid_radius : object.displayWidth * 0.35;
  }

  /**
   * Round obstacles for solid labels that are there right now: a rock that has been cleared
   * away (its hotspot's conditions no longer hold) no longer blocks. The circle sits at the
   * picture's base, a little up from its bottom edge, so a player can stand just in front.
   */
  obstacles(): Circle[] {
    const out: Circle[] = [];
    for (const e of this.entries) {
      if (!e.available) continue;
      for (const l of e.labels) {
        if (l.solid == null) continue;
        const base = l.object.y + l.object.displayHeight / 2;
        out.push({ x: l.object.x, y: base - l.solid * 0.6, radius: l.solid });
      }
    }
    return out;
  }

  /** Re-evaluate conditions. Hotspots whose conditions fail show nothing and cannot fire. */
  variablesChanged() {
    for (const e of this.entries) {
      e.available = this.rt.engine.hotspotAvailable(e.hotspot);
      for (const l of e.labels) {
        l.object.setVisible(e.available && e.reveal > 0);
        // Text labels may contain {{variable}} placeholders.
        if (l.text?.includes('{{')) (l.object as Phaser.GameObjects.Text).setText(this.rt.ctx.text(l.text));
      }
    }
  }

  /** Is there a clickable hotspot under this world point? Used for the pointer cursor. */
  clickableAt(x: number, y: number): boolean {
    return this.entries.some((e) => e.available && e.reveal > 0 && e.hotspot.activate_by_trigger && this.hit(e, x, y));
  }

  /** Fire every click hotspot under the point. Returns true if any fired. */
  click(x: number, y: number): boolean {
    let fired = false;
    for (const e of this.entries) {
      // A hotspot that has not been revealed yet is not there to click.
      if (!e.hotspot.activate_by_trigger || e.reveal <= 0 || !this.hit(e, x, y)) continue;
      if (this.fire(e)) fired = true;
    }
    return fired;
  }

  update() {
    if (this.rt.leaving) return;
    const { x, y } = this.rt.system(LocalPlayerSystem).position;
    for (const e of this.entries) {
      if (e.hotspot.reveal_radius) this.reveal(e, revealAmount(e.hotspot, x, y));
      if (e.hotspot.activate_by_trigger) continue;
      const inside = inHotspot(e.hotspot, x, y);
      // Fires once on entering. If it could not fire yet (hotspots blocked, conditions unmet) it keeps
      // trying while the avatar stays inside, so a scene edge still works once a blocking event ends.
      if (!inside) e.inside = false;
      else if (!e.inside && (this.rt.engine.isRunning(e.hotspot.id) || this.fire(e))) e.inside = true;
    }
  }

  /** Hotspots with a reveal radius fade in as the avatar comes near and out as it leaves. */
  private reveal(e: Entry, amount: number) {
    if (amount === e.reveal) return;
    e.reveal = amount;
    for (const l of e.labels) l.object.setAlpha(amount).setVisible(e.available && amount > 0);
  }

  private hit(e: Entry, x: number, y: number): boolean {
    if (inHotspot(e.hotspot, x, y)) return true;
    // Clicking the label itself also counts, even if it is drawn outside the radius.
    return e.labels.some((l) => l.object.visible && l.object.getBounds().contains(x, y));
  }

  private fire(e: Entry): boolean {
    const { ctx, engine } = this.rt;
    if (!engine.triggerHotspot(e.hotspot)) return false;
    for (const l of e.labels) {
      if (l.animation && l.object instanceof Phaser.GameObjects.Sprite && !l.object.anims.isPlaying) l.object.play(l.animation);
    }
    if (e.hotspot.once) {
      ctx.flags.add(`hotspot:${e.hotspot.id}`);
      ctx.markDirty();
      this.variablesChanged();
    }
    return true;
  }

  destroy() {
    for (const e of this.entries) for (const l of e.labels) l.object.destroy();
    this.entries = [];
  }
}

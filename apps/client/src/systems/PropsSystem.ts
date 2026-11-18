import * as Phaser from 'phaser';
import {
  blockingRadius, parseIds, scaleAt, shadeAt, shadeTint, testConditions,
  type CharacterPlacement, type Circle, type Id, type Item,
} from '@qbl/shared';
import { mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import { Figure } from '../entities/Figure';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

interface PlacedItem {
  item: Item;
  figure: Figure;
  image: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  /** The size it is drawn at where it lies, and the y of its feet, before a move bends or lifts it. */
  size: number;
  feet: number;
  /** Where the scenario placed it. Unique items move; see update(). */
  home: { x: number; y: number };
  exists: boolean;
}

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Montserrat, system-ui, sans-serif',
  fontSize: '16px',
  color: '#ffe9a8',
  stroke: '#000000',
  strokeThickness: 4,
};

/**
 * Items and characters (NPCs) placed in the scene.
 *
 * Non-unique items are per-player: you see your own copy, and it disappears
 * from the floor while you are using it. Unique items exist once per room;
 * their position and holder come from the synchronized state.
 */
export class PropsSystem implements SceneSystem {
  private items = new Map<Id, PlacedItem>();
  private objects: Phaser.GameObjects.GameObject[] = [];
  private pointerOver = 0;

  private characters = new Map<Id, { figure: Figure; image: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite; name: string; size: number; facing: 'left' | 'right'; y: number }>();

  constructor(private rt: SceneRuntime) {}

  /** Where a placed character stands (feet) and how tall it is drawn, for speech bubbles. */
  characterAt(characterId: Id): { x: number; y: number; height: number; name: string } | null {
    const c = this.characters.get(characterId);
    return c ? { x: c.image.x, y: c.image.y, height: c.image.displayHeight, name: c.name } : null;
  }

  create() {
    const { ctx, def } = this.rt;
    for (const placement of def.items ?? []) {
      const item = ctx.index.items.get(placement.item_id);
      if (item) this.place(item, placement.position_x, placement.position_y, true);
    }
    // Unique items that were left in this scene but are placed in another one.
    ctx.connection.state.items.forEach((rec) => {
      const item = ctx.index.items.get(rec.item_id);
      if (item) this.place(item, rec.x, rec.y, false);
    });
    for (const placement of def.characters ?? []) this.character(placement);
    this.variablesChanged();
    this.update();
  }

  private place(item: Item, x: number, y: number, visible: boolean) {
    const { scene, zoom, def } = this.rt;
    if (this.items.has(item.id) || item.media_id == null || !scene.textures.exists(mediaKey(item.media_id))) return;
    // A Figure, so that a sheet's idle plays where the item lies and an animate action can reach it.
    const figure = new Figure(scene, this.rt.ctx.index.media.get(item.media_id), mediaKey(item.media_id), x, y);
    const size = (item.scale ?? 1) * zoom * scaleAt(def, x, y);
    const image = figure.object.setOrigin(0.5, 1).setScale(size).setDepth(this.depthOf(item, y)).setVisible(visible);
    image.setTint(shadeTint(shadeAt(def, x, y)));
    image.setFlipX(figure.auto(false, item.art_faces ?? 'right', item.art_faces ?? 'right'));
    if (item.vehicle || item.wearable) {
      this.interactive(image, () => this.rt.system(LocalPlayerSystem).useItem(item, { x: image.x, y: image.y }));
    }
    this.items.set(item.id, { item, figure, image, size, feet: y, home: { x, y }, exists: true });
  }

  /** An item lying on the floor as part of the background is under everyone's feet; otherwise it stands among the players. */
  private depthOf(item: Item, y: number): number {
    return item.placement === 'background' ? Depth.floor + 30 : y;
  }

  /** True while the pointer is over something clickable; a click is then left to that object. */
  get hovering(): boolean {
    return this.pointerOver > 0;
  }

  private interactive(object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, onClick: () => void) {
    object.setInteractive({ useHandCursor: true });
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.pointerOver++);
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => (this.pointerOver = Math.max(0, this.pointerOver - 1)));
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
  }

  private character(placement: CharacterPlacement) {
    const { ctx, scene, zoom, engine, def } = this.rt;
    const character = ctx.scenario.characters?.find((c) => c.id === placement.character_id);
    if (!character || character.media_id == null || !scene.textures.exists(mediaKey(character.media_id))) return;
    if (!testConditions(character.conditions, ctx.vars.get)) return;
    const figure = new Figure(scene, ctx.index.media.get(character.media_id), mediaKey(character.media_id), placement.position_x, placement.position_y);
    const size = (character.scale ?? 1) * zoom * scaleAt(def, placement.position_x, placement.position_y);
    const facing = placement.facing === 'left' ? 'left' : 'right';
    const image = figure.object.setOrigin(0.5, 1).setScale(size).setDepth(placement.position_y);
    // A character standing in the shade is as dark as a player would be there.
    image.setTint(shadeTint(shadeAt(def, placement.position_x, placement.position_y)));
    image.setFlipX(figure.auto(false, facing));
    this.characters.set(character.id, { figure, image, name: character.name, size, facing, y: placement.position_y });
    const name = scene.add
      .text(placement.position_x, placement.position_y - image.displayHeight - 6, character.name, NAME_STYLE)
      .setOrigin(0.5, 1)
      .setDepth(placement.position_y + 1);
    if (placement.event_id != null) {
      const eventId = placement.event_id;
      this.interactive(image, () => {
        if (!ctx.ui.capturesInput && !this.rt.leaving) void engine.triggerById(eventId);
      });
    }
    this.objects.push(image, name);
  }

  /** Re-check each item's "exists" conditions. */
  variablesChanged() {
    for (const p of this.items.values()) p.exists = testConditions(p.item.conditions, this.rt.ctx.vars.get);
  }

  /**
   * Play an animation on a placed item or character. Returns how long it lasts (0: it loops, or
   * the name means nothing to it), or null when there is no such thing on the floor here.
   */
  animate(what: 'item' | 'character', id: Id, name: string): number | null {
    const target = what === 'item' ? this.items.get(id) : this.characters.get(id);
    if (!target || !target.image.visible) return null;
    return target.figure.play(name);
  }

  /** Bring item sprites in line with the room state. `delta` advances their animations. */
  update(_time = 0, delta = 0) {
    for (const p of this.items.values()) this.pose(p.figure, p.image, p.size, p.feet, delta);
    for (const c of this.characters.values()) this.pose(c.figure, c.image, c.size, c.y, delta);
    const { state, me } = this.rt.ctx.connection;
    const mine = parseIds(me?.attachments ?? '');
    for (const p of this.items.values()) {
      let visible = p.exists;
      if (p.item.unique) {
        const rec = state.items.get(String(p.item.id));
        visible &&= !!rec && rec.holder === '' && rec.scene_id === this.rt.def.id;
        // A unique item lies where it was last put down, at the size that place gives it.
        if (rec && visible) {
          p.size = (p.item.scale ?? 1) * this.rt.zoom * scaleAt(this.rt.def, rec.x, rec.y);
          p.feet = rec.y;
          if (!p.figure.acting) p.image.setPosition(rec.x, rec.y).setDepth(this.depthOf(p.item, rec.y)).setScale(p.size).setTint(shadeTint(shadeAt(this.rt.def, rec.x, rec.y)));
        }
      } else {
        visible &&= !mine.includes(p.item.id);
      }
      if (p.image.visible !== visible) {
        p.image.setVisible(visible);
        if (p.image.input) p.image.input.enabled = visible;
        if (!visible) this.pointerOver = 0;
      }
    }
  }

  /** Advance a figure's animation and bend it as a built-in move asks. `feet` is where it stands. */
  private pose(figure: Figure, image: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, size: number, feet: number, delta: number) {
    const was = figure.acting;
    figure.tick(delta);
    if (!was && !figure.acting) return;
    const bend = figure.pose();
    image.setScale(size * bend.scaleX, size * bend.scaleY).setRotation(bend.lean);
    image.y = feet - bend.lift * (image.displayHeight || 0);
    // Back to its idle once a move has ended. Which way it faces does not change.
    if (!figure.acting) figure.auto(false, 'right');
  }

  /** Round obstacles for items that block movement. */
  obstacles(): Circle[] {
    const out: Circle[] = [];
    for (const p of this.items.values()) {
      if (!p.item.blocking || !p.exists) continue;
      // A unique item only blocks while it is on the floor here; a per-player item always blocks at its placement.
      if (p.item.unique && !p.image.visible) continue;
      const at = p.item.unique ? p.image : p.home;
      out.push({ x: at.x, y: at.y, radius: blockingRadius(p.item) });
    }
    return out;
  }

  destroy() {
    for (const p of this.items.values()) p.image.destroy();
    for (const o of this.objects) o.destroy();
    this.items.clear();
    this.objects = [];
  }
}

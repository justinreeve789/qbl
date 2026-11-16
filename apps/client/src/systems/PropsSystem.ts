import * as Phaser from 'phaser';
import {
  blockingRadius, parseIds, testConditions,
  type CharacterPlacement, type Circle, type Id, type Item,
} from '@qbl/shared';
import { mediaKey } from '../core/assets';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

interface PlacedItem {
  item: Item;
  image: Phaser.GameObjects.Image;
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

  constructor(private rt: SceneRuntime) {}

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
    const { scene, zoom } = this.rt;
    if (this.items.has(item.id) || item.media_id == null || !scene.textures.exists(mediaKey(item.media_id))) return;
    const image = scene.add
      .image(x, y, mediaKey(item.media_id))
      .setOrigin(0.5, 1)
      .setScale((item.scale ?? 1) * zoom)
      .setDepth(y)
      .setVisible(visible);
    if (item.vehicle || item.wearable) {
      this.interactive(image, () => this.rt.system(LocalPlayerSystem).useItem(item, { x: image.x, y: image.y }));
    }
    this.items.set(item.id, { item, image, home: { x, y }, exists: true });
  }

  /** True while the pointer is over something clickable; a click is then left to that object. */
  get hovering(): boolean {
    return this.pointerOver > 0;
  }

  private interactive(object: Phaser.GameObjects.Image, onClick: () => void) {
    object.setInteractive({ useHandCursor: true });
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.pointerOver++);
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => (this.pointerOver = Math.max(0, this.pointerOver - 1)));
    object.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
  }

  private character(placement: CharacterPlacement) {
    const { ctx, scene, zoom, engine } = this.rt;
    const character = ctx.scenario.characters?.find((c) => c.id === placement.character_id);
    if (!character || character.media_id == null || !scene.textures.exists(mediaKey(character.media_id))) return;
    if (!testConditions(character.conditions, ctx.vars.get)) return;
    const image = scene.add
      .image(placement.position_x, placement.position_y, mediaKey(character.media_id))
      .setOrigin(0.5, 1)
      .setScale((character.scale ?? 1) * zoom)
      .setFlipX(placement.facing === 'left')
      .setDepth(placement.position_y);
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

  /** Bring item sprites in line with the room state. */
  update() {
    const { state, me } = this.rt.ctx.connection;
    const mine = parseIds(me?.attachments ?? '');
    for (const p of this.items.values()) {
      let visible = p.exists;
      if (p.item.unique) {
        const rec = state.items.get(String(p.item.id));
        visible &&= !!rec && rec.holder === '' && rec.scene_id === this.rt.def.id;
        if (rec && visible) p.image.setPosition(rec.x, rec.y).setDepth(rec.y);
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

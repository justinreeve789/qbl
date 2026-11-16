import * as Phaser from 'phaser';
import { nearestWalkable, parseIds, resolveMove, scaleAt, speedFactorAt, stepToward, type Item, type PlayerRec, type Point } from '@qbl/shared';
import { Avatar } from '../entities/Avatar';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { HotspotSystem } from './HotspotSystem';
import { PropsSystem } from './PropsSystem';

/** Milliseconds between position reports while moving. */
const SEND_INTERVAL = 66;
/** How close the avatar must be to use an item. Slightly inside the server's limit. */
const REACH = 240;
/** How long the room may disagree about which scene we are in before we follow it. */
const SCENE_MISMATCH_MS = 1500;

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd';

/**
 * The player's own avatar: keyboard and pointer input, movement inside the
 * walkable area, reporting position to the room, and accepting the room's
 * corrections.
 */
export class LocalPlayerSystem implements SceneSystem {
  avatar!: Avatar;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private walkTarget: Point | null = null;
  private facing: 'left' | 'right' = 'right';
  private lastSent = { x: 0, y: 0, facing: 'right', at: 0 };
  private mismatchSince = 0;
  private off: Array<() => void> = [];

  constructor(private rt: SceneRuntime) {}

  create() {
    const { ctx, scene, def, zoom } = this.rt;
    // The room state already holds our position for this scene.
    const rec = ctx.connection.me!;
    const start = this.rt.startPosition ?? { x: rec.x, y: rec.y };
    const safe = nearestWalkable(this.rt.walk(), start) ?? start;
    this.avatar = new Avatar(scene, ctx, { ...plain(rec), x: safe.x, y: safe.y, hidden: false }, zoom, true, (x, y) => scaleAt(def, x, y));
    this.facing = rec.facing === 'left' ? 'left' : 'right';
    this.lastSent = { x: safe.x, y: safe.y, facing: this.facing, at: 0 };
    if (def.show_avatars === false) this.avatar.setVisible(false);

    // Keys are not captured, so typing in the chat box still works.
    const kb = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP, false), down: kb.addKey(K.DOWN, false), left: kb.addKey(K.LEFT, false), right: kb.addKey(K.RIGHT, false),
      w: kb.addKey(K.W, false), a: kb.addKey(K.A, false), s: kb.addKey(K.S, false), d: kb.addKey(K.D, false),
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);

    this.off.push(
      ctx.connection.on('snap', (m) => {
        // A correction for another scene is stale, or will be handled by reconcileScene().
        if (m.scene_id !== def.id || this.rt.leaving) return;
        this.walkTarget = null;
        this.avatar.setPosition(m.x, m.y);
        this.lastSent = { ...this.lastSent, x: m.x, y: m.y };
      }),
    );
  }

  get position(): Point {
    return { x: this.avatar.x, y: this.avatar.y };
  }

  /** Walk toward a point (the nearest walkable spot to it). */
  walkTo(point: Point) {
    if (this.frozen) return;
    this.walkTarget = nearestWalkable(this.rt.walk(), point, 200, 10) ?? null;
  }

  /** Put on or climb into an item, walking closer first if it is out of reach. */
  useItem(item: Item, at: Point) {
    const { ctx } = this.rt;
    if (ctx.ui.capturesInput || this.rt.leaving) return;
    if (Math.hypot(at.x - this.avatar.x, at.y - this.avatar.y) > REACH) {
      ctx.ui.toast(`Walk closer to the ${item.name}.`);
      this.walkTo(at);
      return;
    }
    this.walkTarget = null;
    ctx.connection.item({ item_id: item.id, action: 'attach' });
  }

  // --------------------------------------------------------------- input

  private worldPoint(pointer: Phaser.Input.Pointer): Point {
    const p = this.rt.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    const p = this.worldPoint(pointer);
    const clickable = !this.rt.engine.hotspotsBlocked && this.rt.system(HotspotSystem).clickableAt(p.x, p.y);
    this.rt.scene.input.setDefaultCursor(clickable ? 'pointer' : 'default');
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.rt.ctx.ui.capturesInput || this.rt.leaving || this.rt.system(PropsSystem).hovering) return;
    const p = this.worldPoint(pointer);
    if (this.rt.system(HotspotSystem).click(p.x, p.y)) return;
    // Otherwise walk there, Club Penguin style.
    this.walkTo(p);
  }

  // -------------------------------------------------------------- update

  /**
   * An avatar action: show or hide the player's own figure. The game server is told, so everyone
   * else in the scene sees the same. The player can still walk and use hotspots while hidden.
   */
  /** True while a freeze action holds the player in place. */
  frozen = false;

  /** A freeze action: the player cannot walk until released. Hotspots can still be clicked. */
  setFrozen(frozen: boolean) {
    this.frozen = frozen;
    if (frozen) this.walkTarget = null;
  }

  setAvatarVisible(visible: boolean, duration: number) {
    this.avatar.setShown(visible, duration);
    this.rt.ctx.connection.avatarVisible(visible);
  }

  update(time: number, delta: number) {
    this.avatar.tick(delta);
    if (this.rt.leaving) return;
    const rec = this.rt.ctx.connection.me;
    if (rec) {
      this.avatar.setAttachments(rec.attachments);
      this.avatar.setConnected(rec.connected);
      this.avatar.setLook(rec.look ?? '');
      // A move asked for from the screen or by an animate action comes back through the room, as it does for everyone else.
      this.avatar.setAnimation(rec.anim ?? '');
      if (this.reconcileScene(rec, time)) return;
    }
    this.move(time, delta);
  }

  /**
   * The room decides which scene we are in. If it disagrees with what we are
   * showing for more than a moment (a refused jump, say), follow the room.
   */
  private reconcileScene(rec: PlayerRec, time: number): boolean {
    if (rec.scene_id === this.rt.def.id) {
      this.mismatchSince = 0;
      return false;
    }
    if (this.mismatchSince === 0) this.mismatchSince = time;
    if (time - this.mismatchSince < SCENE_MISMATCH_MS) return false;
    this.rt.restart({ sceneId: rec.scene_id, position: { x: rec.x, y: rec.y } });
    return true;
  }

  private speed(): number {
    const { ctx } = this.rt;
    let multiplier = 1;
    for (const id of parseIds(ctx.connection.me?.attachments ?? '')) {
      const item = ctx.index.items.get(id);
      if (item?.vehicle) multiplier = Math.max(multiplier, item.speed_multiplier ?? 1.5);
    }
    // In a scale area, figures drawn smaller also walk slower, by as much as the area's speed effect says.
    const depth = speedFactorAt(this.rt.def, this.avatar.x, this.avatar.y);
    return (ctx.scenario.move_speed ?? 420) * multiplier * depth;
  }

  private move(time: number, delta: number) {
    const me = this.avatar;
    const from = { x: me.x, y: me.y };
    const step = (this.speed() * Math.min(delta, 100)) / 1000;
    let to: Point | null = null;

    if (!this.rt.ctx.ui.capturesInput && !this.frozen) {
      const k = this.keys;
      const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
      const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        this.walkTarget = null;
        const len = Math.hypot(dx, dy);
        to = { x: from.x + (dx / len) * step, y: from.y + (dy / len) * step };
      }
    }
    if (!to && this.walkTarget) {
      to = stepToward(from, this.walkTarget, step);
      if (to.x === this.walkTarget.x && to.y === this.walkTarget.y) this.walkTarget = null;
    }

    if (to) {
      const next = resolveMove(this.rt.walk(), from, to);
      if (next.x === from.x && next.y === from.y) this.walkTarget = null; // walked into something
      if (Math.abs(next.x - from.x) > 0.01) this.facing = next.x < from.x ? 'left' : 'right';
      me.setFacing(this.facing);
      me.setPosition(next.x, next.y);
    }
    // Walking plays the sheet's walk, on the figure and on what it rides.
    me.setMoving(me.x !== from.x || me.y !== from.y);

    // Report at a steady rate while moving, and once more on stopping so everyone agrees on the final spot.
    const s = this.lastSent;
    const changed = s.x !== me.x || s.y !== me.y || s.facing !== this.facing;
    if (changed && time - s.at >= SEND_INTERVAL) {
      this.lastSent = { x: me.x, y: me.y, facing: this.facing, at: time };
      this.rt.ctx.connection.move({ x: me.x, y: me.y, facing: this.facing });
    }
  }

  destroy() {
    for (const off of this.off) off();
    this.off = [];
    this.rt.scene.input.setDefaultCursor('default');
    this.avatar.destroy();
  }
}

/** Copy the synced fields of a player record into a plain object. */
function plain(rec: PlayerRec): PlayerRec {
  return {
    user_id: rec.user_id, name: rec.name, role: rec.role, avatar: rec.avatar, scene_id: rec.scene_id,
    x: rec.x, y: rec.y, facing: rec.facing, attachments: rec.attachments, connected: rec.connected, hidden: rec.hidden, look: rec.look,
  };
}

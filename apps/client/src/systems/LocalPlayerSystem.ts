import * as Phaser from 'phaser';
import {
  doorPoint, doorsOf, nearestWalkable, parseIds, resolveMove, scaleAt, shadeAt, speedFactorAt, stepToward, testConditions,
  type ActionHandle, type Door, type Item, type PlayerRec, type Point, type WalkAction,
} from '@qbl/shared';
import { deferred } from '../actions/Presenter';
import { Pathfinder, walkSignature } from '../core/Pathfinder';
import { Avatar } from '../entities/Avatar';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { HotspotSystem } from './HotspotSystem';
import { PropsSystem } from './PropsSystem';
import { RemotePlayersSystem } from './RemotePlayersSystem';

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
  /** The corners still to pass on the way to where the player clicked. `walkTarget` is the next one. */
  private route: Point[] = [];
  private finder: { signature: string; pathfinder: Pathfinder } | null = null;
  private facing: 'left' | 'right' = 'right';
  private lastSent = { x: 0, y: 0, facing: 'right', at: 0 };
  /** A walk action walking the avatar: where it ends, and what to do on getting there. */
  private scripted: { end: Point; facing?: 'left' | 'right'; door: Door | null; speed?: number; finish(): void } | null = null;
  private mismatchSince = 0;
  private off: Array<() => void> = [];

  constructor(private rt: SceneRuntime) {}

  create() {
    const { ctx, scene, def, zoom } = this.rt;
    // The room state already holds our position for this scene.
    const rec = ctx.connection.me!;
    const start = this.rt.startPosition ?? { x: rec.x, y: rec.y };
    const safe = nearestWalkable(this.rt.walk(), start) ?? start;
    this.avatar = new Avatar(scene, ctx, { ...plain(rec), x: safe.x, y: safe.y, hidden: false }, zoom, true, (x, y) => scaleAt(def, x, y), (x, y) => shadeAt(def, x, y));
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
        this.stop();
        this.avatar.setPosition(m.x, m.y);
        this.lastSent = { ...this.lastSent, x: m.x, y: m.y };
      }),
    );
  }

  get position(): Point {
    return { x: this.avatar.x, y: this.avatar.y };
  }

  /**
   * Walk to a point (the nearest walkable spot to it), around whatever is in the way: the route
   * comes from the navigation mesh, and the avatar walks it corner by corner. Where the mesh
   * knows no way, the avatar heads straight for the spot and stops at the first thing it meets.
   */
  walkTo(point: Point) {
    if (this.frozen) return;
    const walk = this.rt.walk();
    const target = nearestWalkable(walk, point, 200, 10);
    this.stop();
    if (!target) return;
    const route = this.pathfinder(walk).find(this.position, target) ?? [target];
    this.walkTarget = route[0] ?? null;
    this.route = route.slice(1);
  }

  /**
   * A walk action aimed at the player: walk the avatar there, as if the player had clicked the
   * spot, even while frozen (a freeze and a walk make a cutscene). To another scene, it walks to
   * the door that leads there and goes through it. The handle finishes on arriving, or when the
   * player walks off somewhere else.
   */
  walkScripted(action: WalkAction): ActionHandle | null {
    const { def, ctx } = this.rt;
    const walk = this.rt.walk();
    const to = action.to ?? 'point';
    let goal: Point | null = null;
    let door: Door | null = null;
    let facing = action.facing;
    if (to === 'point' && action.position_x != null && action.position_y != null) goal = { x: action.position_x, y: action.position_y };
    else if (to === 'spawn') {
      const spawn = (def.spawn_points ?? []).find((p) => p.name === action.spawn_point);
      if (spawn) goal = { x: spawn.position_x, y: spawn.position_y };
      facing ??= spawn?.facing;
    } else if (to === 'scene') {
      door = doorsOf(def).find((d) => d.to === action.scene_id && testConditions(d.conditions, ctx.vars.get)) ?? null;
      if (door) goal = doorPoint(walk, door.hotspot, this.position);
    }
    const target = goal && nearestWalkable(walk, goal, 200, 10);
    if (!target) return null;
    this.scripted?.finish();
    this.stop();
    const route = this.pathfinder(walk).find(this.position, target) ?? [target];
    this.walkTarget = route[0] ?? null;
    this.route = route.slice(1);
    const d = deferred();
    const mine = {
      end: target, facing, door, speed: action.speed,
      finish: () => {
        if (this.scripted === mine) this.scripted = null;
        d.resolve();
      },
    };
    this.scripted = mine;
    return { done: d.done, cancel: () => {
      if (this.scripted === mine) this.stop();
      mine.finish();
    } };
  }

  /** A scripted walk has ended: arrived (turn, or go through the door) or was walked away from. */
  private endScripted() {
    const s = this.scripted;
    if (!s) return;
    const arrived = Math.hypot(this.avatar.x - s.end.x, this.avatar.y - s.end.y) < 4;
    if (arrived && s.facing) {
      this.facing = s.facing;
      this.avatar.setFacing(s.facing);
    }
    s.finish();
    // Through the door: its own actions if it can be used now, or else straight through.
    if (arrived && s.door && !this.rt.leaving) {
      const { engine } = this.rt;
      if (!engine.triggerHotspot(s.door.hotspot)) void engine.leave(s.door.to, s.door.spawn_point);
    }
  }

  /** Where the avatar is walking to by itself, if anywhere: the corners ahead, ending at the destination. */
  get path(): Point[] {
    return this.walkTarget ? [this.walkTarget, ...this.route] : [];
  }

  private stop() {
    this.walkTarget = null;
    this.route = [];
  }

  /** The mesh for the scene as it is now. It is built again when an obstacle comes, goes or moves. */
  private pathfinder(walk = this.rt.walk()): Pathfinder {
    const signature = walkSignature(walk);
    if (this.finder?.signature !== signature) this.finder = { signature, pathfinder: new Pathfinder(walk) };
    return this.finder.pathfinder;
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
    this.stop();
    ctx.connection.item({ item_id: item.id, action: 'attach' });
  }

  // --------------------------------------------------------------- input

  private worldPoint(pointer: Phaser.Input.Pointer): Point {
    const p = this.rt.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    const p = this.worldPoint(pointer);
    const hotspots = this.rt.system(HotspotSystem);
    hotspots.pointerAt(p.x, p.y);
    const clickable = !this.rt.engine.hotspotsBlocked && hotspots.clickableAt(p.x, p.y);
    this.rt.scene.input.setDefaultCursor(clickable ? 'pointer' : 'default');
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.rt.ctx.ui.capturesInput || this.rt.leaving || this.rt.system(PropsSystem).hovering || this.rt.system(RemotePlayersSystem).hovering) return;
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
    if (frozen) this.stop();
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
    // A walk action may say how fast; never faster than the server lets a player go.
    const base = ctx.scenario.move_speed ?? 420;
    const own = this.scripted?.speed && this.scripted.speed > 0 ? Math.min(this.scripted.speed, base) : base;
    return own * multiplier * depth;
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
        this.stop();
        const len = Math.hypot(dx, dy);
        to = { x: from.x + (dx / len) * step, y: from.y + (dy / len) * step };
      }
    }
    if (!to && this.walkTarget) {
      to = stepToward(from, this.walkTarget, step);
      // A corner reached: on to the next one.
      if (to.x === this.walkTarget.x && to.y === this.walkTarget.y) this.walkTarget = this.route.shift() ?? null;
    }

    if (to) {
      const next = resolveMove(this.rt.walk(), from, to);
      if (next.x === from.x && next.y === from.y) this.stop(); // walked into something
      if (Math.abs(next.x - from.x) > 0.01) this.facing = next.x < from.x ? 'left' : 'right';
      me.setFacing(this.facing);
      me.setPosition(next.x, next.y);
    }
    // Walking plays the sheet's walk, on the figure and on what it rides.
    me.setMoving(me.x !== from.x || me.y !== from.y);
    // A walk action's walk is over once there is nowhere left to walk to.
    if (this.scripted && !this.walkTarget) this.endScripted();

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
    anim: rec.anim, team: rec.team,
  };
}

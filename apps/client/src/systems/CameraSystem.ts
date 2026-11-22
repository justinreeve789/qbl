import * as Phaser from 'phaser';
import type { ActionHandle, CameraAction, Id, Point } from '@qbl/shared';
import { deferred } from '../actions/Presenter';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';
import { PropsSystem } from './PropsSystem';

/** World pixels of height the camera tries to show. */
const VIEW_HEIGHT = 1000;

/** How quickly the view catches up with what it follows (ms for most of the way). */
const FOLLOW_MS = 450;

type Mode =
  | { kind: 'player' }
  | { kind: 'character'; id: Id }
  | { kind: 'point'; at: Point }
  | { kind: 'auto' };

/**
 * Keeps the scene covering the window and points the view: at the local player, normally, inside the
 * scene's bounds. A story scene's view follows whoever is acting (the last character to speak, walk or
 * move, while they are on the stage; otherwise the middle of those who are). A camera action can
 * follow a character, glide to a spot, or go back to either.
 */
export class CameraSystem implements SceneSystem {
  private mode: Mode = { kind: 'player' };
  /** Where the view's centre is, while the camera is not following the player itself. */
  private focus: Point | null = null;
  /** A glide to a spot under way. */
  private glide: { from: Point; to: Point; ms: number; t: number; done: () => void } | null = null;
  /** The last character who acted, for a story scene's view. */
  private actor: Id | null = null;

  constructor(private rt: SceneRuntime) {}

  create() {
    const { scene, size, def } = this.rt;
    const player = this.rt.system(LocalPlayerSystem).avatar;
    const cam = scene.cameras.main;
    cam.setBounds(0, 0, size.width, size.height);
    cam.fadeIn(350, 0, 0, 0);
    this.fit();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.fit, this);
    if (def.story) {
      this.mode = { kind: 'auto' };
      this.focus = this.autoTarget() ?? { x: player.x, y: player.y };
      cam.centerOn(this.focus.x, this.focus.y);
    } else {
      cam.centerOn(player.x, player.y);
      cam.startFollow(player, true, 0.12, 0.12);
    }
  }

  /** A character spoke, walked or moved: in a story scene the view goes to them. */
  acting(characterId: Id) {
    this.actor = characterId;
  }

  /** A camera action. */
  point(action: CameraAction): ActionHandle | null {
    const cam = this.rt.scene.cameras.main;
    const target = action.target ?? (action.character_id != null ? 'character' : action.position_x != null ? 'point' : 'player');
    const ms = Math.max(0, action.duration ?? 1200);
    const from = this.centre();
    this.glide?.done();
    this.glide = null;
    switch (target) {
      case 'player': {
        const player = this.rt.system(LocalPlayerSystem).avatar;
        this.mode = { kind: 'player' };
        this.focus = null;
        cam.startFollow(player, true, 0.12, 0.12);
        return this.after(ms);
      }
      case 'character':
        if (action.character_id == null || !this.rt.system(PropsSystem).characterAt(action.character_id)) return null;
        this.leaveFollow(from);
        this.mode = { kind: 'character', id: action.character_id };
        return this.after(ms);
      case 'point': {
        if (action.position_x == null || action.position_y == null) return null;
        this.leaveFollow(from);
        const to = { x: action.position_x, y: action.position_y };
        this.mode = { kind: 'point', at: to };
        const d = deferred();
        this.glide = { from, to, ms: Math.max(1, ms), t: 0, done: d.resolve };
        return { done: d.done, cancel: d.resolve };
      }
      case 'auto':
        this.leaveFollow(from);
        this.mode = { kind: 'auto' };
        return this.after(ms);
      default:
        return null;
    }
  }

  update(_time: number, delta: number) {
    if (this.mode.kind === 'player' || !this.focus) return;
    const cam = this.rt.scene.cameras.main;
    const dt = Math.min(delta, 100);
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / g.ms);
      const k = g.t < 0.5 ? 2 * g.t * g.t : 1 - (-2 * g.t + 2) ** 2 / 2;
      this.focus = { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k };
      if (g.t >= 1) {
        this.glide = null;
        g.done();
      }
    } else {
      const target = this.target();
      if (target) {
        const k = 1 - Math.exp(-dt / (FOLLOW_MS / 3));
        this.focus = { x: this.focus.x + (target.x - this.focus.x) * k, y: this.focus.y + (target.y - this.focus.y) * k };
      }
    }
    cam.centerOn(this.focus.x, this.focus.y);
  }

  destroy() {
    this.glide?.done();
    this.glide = null;
    this.rt.scene.scale.off(Phaser.Scale.Events.RESIZE, this.fit, this);
  }

  /** What the view follows now (its centre), when it is not the player. */
  private target(): Point | null {
    switch (this.mode.kind) {
      case 'character': {
        const at = this.rt.system(PropsSystem).characterAt(this.mode.id);
        return at ? { x: at.x, y: at.y - at.height / 2 } : null;
      }
      case 'point':
        return this.mode.at;
      case 'auto':
        return this.autoTarget();
      default:
        return null;
    }
  }

  /** Whoever acted last, while on stage; else the middle of everyone on stage. */
  private autoTarget(): Point | null {
    const cast = this.rt.system(PropsSystem).onStage();
    const actor = cast.find((c) => c.id === this.actor);
    if (actor) return { x: actor.x, y: actor.y - actor.height / 2 };
    if (!cast.length) return null;
    const x = cast.reduce((n, c) => n + c.x, 0) / cast.length;
    const y = cast.reduce((n, c) => n + c.y - c.height / 2, 0) / cast.length;
    return { x, y };
  }

  /** Where the view's centre is now. */
  private centre(): Point {
    if (this.focus) return this.focus;
    const v = this.rt.scene.cameras.main.worldView;
    return { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  }

  /** Stop following the player, keeping the view where it is. */
  private leaveFollow(from: Point) {
    const cam = this.rt.scene.cameras.main as Phaser.Cameras.Scene2D.Camera & { stopFollow?: () => void };
    cam.stopFollow?.();
    this.focus = from;
  }

  /** A handle that finishes once the view has had time to get there. */
  private after(ms: number): ActionHandle {
    const d = deferred();
    const timer = this.rt.scene.time.delayedCall(ms, d.resolve);
    return { done: d.done, cancel: () => (timer.remove(), d.resolve()) };
  }

  private fit() {
    const { scene, size } = this.rt;
    const { width, height } = scene.scale.gameSize;
    const cover = Math.max(width / size.width, height / size.height);
    scene.cameras.main.setZoom(Math.max(cover, height / VIEW_HEIGHT));
  }
}

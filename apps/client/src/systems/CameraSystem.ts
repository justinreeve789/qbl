import * as Phaser from 'phaser';
import { sceneBench, shakeAmount, type ActionHandle, type CameraAction, type Id, type Point, type ShakeAction } from '@qbl/shared';
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
 *
 * In a scene that hides avatars (`show_avatars` off) the view does not follow the player: it starts
 * where they arrive and stays there until a camera action moves it.
 *
 * A close-up bench without avatars is shown whole instead, in the middle of the window: nothing of
 * it may be cut off, and there is nobody to follow, so camera actions leave it where it is.
 */
export class CameraSystem implements SceneSystem {
  private whole = false;
  /** False in a scene that hides avatars: there is no figure to follow. */
  private followsPlayer = true;
  private mode: Mode = { kind: 'player' };
  /** Where the view's centre is, while the camera is not following the player itself. */
  private focus: Point | null = null;
  /** A glide to a spot under way. */
  private glide: { from: Point; to: Point; ms: number; t: number; done: () => void } | null = null;
  /** The last character who acted, for a story scene's view. */
  private actor: Id | null = null;
  /** How close the view is (CameraAction.zoom): 1 is the scene's usual view. */
  private closeness = 1;
  /** A change of closeness under way. */
  private zooming: { from: number; to: number; ms: number; t: number } | null = null;
  /** The zoom that fills the window with the scene, and the usual view's zoom. */
  private cover = 1;
  private base = 1;
  /**
   * How far (world pixels) the view's centre sits above what it follows. A window wider than the
   * usual view (an ultrawide monitor) has to zoom in to fill its width, so less height fits; the
   * view is raised by half the height lost, so its top edge stays where the usual view's would be
   * and the cut comes off the bottom instead.
   */
  private lift = 0;

  constructor(private rt: SceneRuntime) {}

  create() {
    const { scene, size, def } = this.rt;
    const player = this.rt.system(LocalPlayerSystem).avatar;
    const cam = scene.cameras.main;
    this.whole = sceneBench(def) != null && def.show_avatars === false;
    this.followsPlayer = def.show_avatars !== false;
    if (this.whole) {
      cam.fadeIn(350, 0, 0, 0);
      this.fit();
      scene.scale.on(Phaser.Scale.Events.RESIZE, this.fit, this);
      return;
    }
    cam.setBounds(0, 0, size.width, size.height);
    cam.fadeIn(350, 0, 0, 0);
    this.fit();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.fit, this);
    if (def.story) {
      this.mode = { kind: 'auto' };
      this.focus = this.autoTarget() ?? { x: player.x, y: player.y };
      cam.centerOn(this.focus.x, this.focus.y - this.lift);
    } else if (!this.followsPlayer) {
      // Nobody to follow: the view stays on the spot the player arrived at.
      this.focus = { x: player.x, y: player.y };
      this.mode = { kind: 'point', at: this.focus };
      cam.centerOn(this.focus.x, this.focus.y - this.lift);
    } else {
      cam.centerOn(player.x, player.y - this.lift);
      this.followPlayer();
    }
  }

  /** A character spoke, walked or moved: in a story scene the view goes to them. */
  acting(characterId: Id) {
    this.actor = characterId;
  }

  /** A camera action. */
  point(action: CameraAction): ActionHandle | null {
    if (this.whole) return null;
    const target = action.target ?? (action.character_id != null ? 'character' : action.position_x != null ? 'point' : 'player');
    const ms = Math.max(0, action.duration ?? 1200);
    const from = this.centre();
    if (typeof action.zoom === 'number' && Number.isFinite(action.zoom)) {
      const to = Math.min(3, Math.max(0.5, action.zoom));
      if (ms <= 0) this.setCloseness(to);
      else this.zooming = { from: this.closeness, to, ms, t: 0 };
    }
    this.glide?.done();
    this.glide = null;
    switch (target) {
      case 'player': {
        if (!this.followsPlayer) {
          // The player is hidden here: glide to where they are, and stay there.
          const avatar = this.rt.system(LocalPlayerSystem).avatar;
          return this.glideTo(from, { x: avatar.x, y: avatar.y }, ms);
        }
        this.mode = { kind: 'player' };
        this.focus = null;
        this.followPlayer();
        return this.after(ms);
      }
      case 'character':
        if (action.character_id == null || !this.rt.system(PropsSystem).characterAt(action.character_id)) return null;
        this.leaveFollow(from);
        this.mode = { kind: 'character', id: action.character_id };
        return this.after(ms);
      case 'point': {
        if (action.position_x == null || action.position_y == null) return null;
        return this.glideTo(from, { x: action.position_x, y: action.position_y }, ms);
      }
      case 'auto':
        this.leaveFollow(from);
        this.mode = { kind: 'auto' };
        return this.after(ms);
      default:
        return null;
    }
  }

  /**
   * A shake action: the view jolts about where it is, then settles. A player whose system asks for
   * reduced motion is not shaken, but the handle still lasts as long, so the event keeps its timing.
   */
  shake(action: ShakeAction): ActionHandle {
    const ms = Math.max(0, action.duration ?? 500);
    const cam = this.rt.scene.cameras.main as Phaser.Cameras.Scene2D.Camera;
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // force: a shake already under way gives way to this one.
    if (ms > 0 && !still) cam.shake?.(ms, shakeAmount(action.intensity), true);
    const handle = this.after(ms);
    return { done: handle.done, cancel: () => (cam.shakeEffect?.reset(), handle.cancel()) };
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 100);
    if (this.zooming) {
      const z = this.zooming;
      z.t = Math.min(1, z.t + dt / z.ms);
      const k = z.t < 0.5 ? 2 * z.t * z.t : 1 - (-2 * z.t + 2) ** 2 / 2;
      this.setCloseness(z.from + (z.to - z.from) * k);
      if (z.t >= 1) this.zooming = null;
    }
    if (this.mode.kind === 'player' || !this.focus) return;
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
    this.rt.scene.cameras.main.centerOn(this.focus.x, this.focus.y - this.lift);
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
    return { x: v.x + v.width / 2, y: v.y + v.height / 2 + this.lift };
  }

  /** Follow the local player, with the view raised by `lift`. */
  private followPlayer() {
    const cam = this.rt.scene.cameras.main;
    cam.startFollow(this.rt.system(LocalPlayerSystem).avatar, true, 0.12, 0.12, 0, this.lift);
  }

  /** Stop following the player, keeping the view where it is. */
  private leaveFollow(from: Point) {
    const cam = this.rt.scene.cameras.main as Phaser.Cameras.Scene2D.Camera & { stopFollow?: () => void };
    cam.stopFollow?.();
    this.focus = from;
  }

  /** Glide the view from one spot to another and hold it there. */
  private glideTo(from: Point, to: Point, ms: number): ActionHandle {
    this.leaveFollow(from);
    this.mode = { kind: 'point', at: to };
    const d = deferred();
    this.glide = { from, to, ms: Math.max(1, ms), t: 0, done: d.resolve };
    return { done: d.done, cancel: d.resolve };
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
    if (this.whole) {
      const cam = scene.cameras.main;
      cam.setZoom(Math.min(width / size.width, height / size.height));
      cam.centerOn(size.width / 2, size.height / 2);
      return;
    }
    this.cover = Math.max(width / size.width, height / size.height);
    this.base = Math.max(this.cover, height / VIEW_HEIGHT);
    this.applyZoom();
  }

  /** How close the view is now (1: the usual view). */
  get zoom(): number {
    return this.closeness;
  }

  private setCloseness(closeness: number) {
    this.closeness = closeness;
    this.applyZoom();
  }

  /** The usual view times how close it is, never so far out that the scene stops filling the window. */
  private applyZoom() {
    if (this.whole) return;
    const cam = this.rt.scene.cameras.main;
    const zoom = Math.max(this.cover, this.base * this.closeness);
    cam.setZoom(zoom);
    // The height the usual view would show at this closeness, against what fits in this window.
    const usual = Math.min(this.rt.size.height, VIEW_HEIGHT) / this.closeness;
    const shown = this.rt.scene.scale.gameSize.height / zoom;
    this.lift = Math.max(0, (usual - shown) / 2);
    if (this.mode.kind === 'player') cam.setFollowOffset(0, this.lift);
  }
}

import * as Phaser from 'phaser';
import {
  layerMediaId, SceneEngine, sceneMusic, sceneSize, walkContext,
  type Id, type Point, type Scene, type WalkContext,
} from '@qbl/shared';
import { ActionHost } from '../actions/ActionHost';
import { playSceneMusic } from '../actions/presenters/audio';
import { mediaKey, queueScene, reportLoadErrors } from '../core/assets';
import { getContext, type GameContext } from '../core/GameContext';
import type { PlaySceneData, SceneRuntime, SceneSystem, SceneSystemClass } from '../core/SceneRuntime';
import { sceneSystems } from '../systems';
import { BenchSystem } from '../systems/BenchSystem';
import { HotspotSystem } from '../systems/HotspotSystem';
import { LocalPlayerSystem } from '../systems/LocalPlayerSystem';
import { PropsSystem } from '../systems/PropsSystem';
import { RemotePlayersSystem } from '../systems/RemotePlayersSystem';
import { CameraSystem } from '../systems/CameraSystem';
import { WeatherSystem } from '../systems/WeatherSystem';

export type { PlaySceneData };

const DEFAULT_SIZE = { width: 1920, height: 1080 };

/**
 * The one Phaser scene that plays every QBL scene. It is restarted with a
 * different scene id on each jump.
 *
 * PlayScene itself does very little: it sets up the event engine, creates the
 * registered systems (systems/index.ts), forwards update and variable changes
 * to them, and handles the jump to the next scene. Everything visible or
 * interactive is a system.
 */
export class PlayScene extends Phaser.Scene {
  ctx!: GameContext;
  def!: Scene;
  size = DEFAULT_SIZE;
  zoom = 1;
  engine!: SceneEngine;
  startPosition: Point | null = null;
  leaving = false;
  /** A restart has been asked for (it may be waiting for the next scene to load): asking again does nothing. */
  private restarting = false;

  private host!: ActionHost;
  private systems: SceneSystem[] = [];
  private byClass = new Map<SceneSystemClass, SceneSystem>();
  private stopWatching: () => void = () => {};

  constructor(private systemClasses: SceneSystemClass[] = sceneSystems) {
    super('play');
  }

  // Phaser.Scene already has a `scene` property (its scene plugin), so systems are handed
  // this small facade, whose `scene` is the Phaser scene itself, rather than `this`.
  private runtime!: SceneRuntime;

  init() {
    this.leaving = false;
    this.restarting = false;
    this.systems = [];
    this.byClass = new Map();
  }

  create(data: PlaySceneData) {
    const ctx = (this.ctx = getContext(this));
    // Pictures loaded on the way to another scene: say if one cannot be.
    reportLoadErrors(this, ctx);
    this.def = ctx.index.scene(data.sceneId) ?? ctx.index.startScene();
    this.zoom = this.def.zoom ?? 1;
    this.size = sceneSize(ctx.scenario, this.def) ?? this.sizeFromTexture() ?? DEFAULT_SIZE;
    this.startPosition = data.position ?? null;

    // The event engine for this visit to the scene.
    this.host = new ActionHost(this, ctx, (sceneId, spawn) => this.jump(sceneId, spawn));
    this.host.locateControl = (who) => {
      if (who.character_id != null) return this.runtime.system(PropsSystem).characterAt(who.character_id);
      // "The player" in another player's event is that player.
      if (who.actor && who.actor !== ctx.connection.sessionId) {
        const other = this.runtime.system(RemotePlayersSystem).get(who.actor);
        return other ? { x: other.x, y: other.y, height: other.height } : null;
      }
      const me = this.runtime.system(LocalPlayerSystem).avatar;
      return { x: me.x, y: me.y, height: me.height };
    };
    this.host.animateControl = (action, actor) => {
      const props = this.runtime.system(PropsSystem);
      const mine = this.runtime.system(LocalPlayerSystem).avatar;
      if (action.target === 'character') return action.character_id != null ? props.animate('character', action.character_id, action.animation) : null;
      if (action.target === 'item') {
        if (action.item_id == null) return null;
        // On the floor here, or else being worn or ridden: by the player whose event this is, or by anyone in the scene.
        const worn = (avatar: { animateAttached(id: Id, name: string): number | null } | undefined) => avatar?.animateAttached(action.item_id!, action.animation) ?? null;
        return props.animate('item', action.item_id, action.animation)
          ?? worn(actor && actor !== ctx.connection.sessionId ? this.runtime.system(RemotePlayersSystem).get(actor) : mine)
          ?? worn(mine);
      }
      // The player's own avatar: through the room, so everyone sees it. (Another player's reaches us the same way, not here.)
      if (actor && actor !== ctx.connection.sessionId) return 0;
      ctx.connection.animate(action.animation);
      return mine.moveDuration(action.animation);
    };
    this.host.walkControl = (action, actor) => {
      if (action.target !== 'player') return this.runtime.system(PropsSystem).walkCharacter(action, actor);
      // Another player walked by their own event: their position reaches us through the room.
      if (actor && actor !== ctx.connection.sessionId) return null;
      return this.runtime.system(LocalPlayerSystem).walkScripted(action);
    };
    this.host.weatherControl = (action) => this.byClass.has(WeatherSystem) ? this.runtime.system(WeatherSystem).change(action) : null;
    this.host.cameraControl = (action) => this.byClass.has(CameraSystem) ? this.runtime.system(CameraSystem).point(action) : null;
    this.host.shakeControl = (action) => this.byClass.has(CameraSystem) ? this.runtime.system(CameraSystem).shake(action) : null;
    this.host.actingControl = (id) => (this.byClass.get(CameraSystem) as CameraSystem | undefined)?.acting(id);
    this.host.freezeControl = (frozen) => this.runtime.system(LocalPlayerSystem).setFrozen(frozen);
    this.host.avatarControl = (visible, duration) => this.runtime.system(LocalPlayerSystem).setAvatarVisible(visible, duration);
    this.host.benchControl = (action) => this.runtime.system(BenchSystem).run(action);
    this.engine = new SceneEngine(this.def, ctx.index, ctx.vars, this.host, ctx.flags);
    const def = this.def;
    const engine = this.engine;
    ctx.vars.provide('QL_SceneId', () => def.id);
    ctx.vars.provide('QL_HotspotCoordinates', () => engine.hotspotCoordinates);
    // A scene with a physics experiment (Scene.physics, from the physics experiments work).
    const physics = (def as { physics?: unknown }).physics ? 1 : 0;
    ctx.vars.provide('QL_PhysicsEnabled', () => physics);
    // Two things from the bag put together: what that does happens in the scene being played.
    ctx.bag.run = (actions) => engine.runActions(actions);
    // So does a teacher's launch: the jump to the departure scene, or the travel straight there.
    ctx.inScene = (actions) => engine.runActions(actions);
    ctx.sceneId = Number(def.id);

    const self = this;
    this.runtime = {
      scene: this,
      ctx,
      def,
      size: this.size,
      zoom: this.zoom,
      engine,
      startPosition: this.startPosition,
      get leaving() {
        return self.leaving;
      },
      system: (type) => this.system(type),
      walk: () => this.walk(),
      restart: (d) => this.restart(d),
    };

    for (const SystemClass of this.systemClasses) {
      const system = new SystemClass(this.runtime);
      this.systems.push(system);
      this.byClass.set(SystemClass, system);
    }
    for (const system of this.systems) system.create?.();

    const stopVars = ctx.vars.onChange(() => {
      for (const system of this.systems) system.variablesChanged?.();
    });
    // What other players' events show to the whole scene.
    const stopShows = ctx.connection.on('show', (m) => engine.watch(m.event_id, m.action_id, m.session_id));
    this.stopWatching = () => {
      stopVars();
      stopShows();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    // The scene's own music, or else the scenario's. Start events may then change it.
    const music = sceneMusic(ctx.scenario, this.def);
    if (music) playSceneMusic(this, ctx, music.media_id, music.volume);

    // Start events run once everything is on screen.
    this.engine.start();
  }

  update(time: number, delta: number) {
    // Offline, the characters that roam are moved here; online the game server moves them.
    this.ctx.connection.tick();
    this.ctx.syncRoomVariables();
    for (const system of this.systems) system.update?.(time, delta);
    this.forgetDeparted();
  }

  /**
   * A shake with no duration that another player set going here ends when they leave the scene
   * (or stop being seen): nothing else would stop it on this screen.
   */
  private forgetDeparted() {
    const actors = this.engine.endlessActors;
    if (actors.length === 0) return;
    const { state } = this.ctx.connection;
    for (const id of actors) {
      const rec = state.players.get(id);
      if (!rec || rec.scene_id !== this.def.id || !this.ctx.sees(rec)) this.engine.forget(id);
    }
  }

  // ------------------------------------------------------- SceneRuntime

  system<T extends SceneSystem>(type: SceneSystemClass<T>): T {
    const found = this.byClass.get(type);
    if (!found) throw new Error(`Scene system ${type.name} is not registered`);
    return found as T;
  }

  walk(): WalkContext {
    const props = this.byClass.get(PropsSystem) as PropsSystem | undefined;
    const hotspots = this.byClass.get(HotspotSystem) as HotspotSystem | undefined;
    return walkContext(this.def, this.size, [...(props?.obstacles() ?? []), ...(hotspots?.obstacles() ?? [])]);
  }

  /**
   * Leave for a scene (or this one again), once everything it needs is loaded. Every way into a
   * scene comes here: a jump, and the room moving the player (a teacher's launch to a launcher
   * scene, a refused jump). Without the wait, a scene reached the second way, such as a launcher
   * scene no door leads to, started before its sounds and pictures had arrived, and its audio
   * actions found nothing to play.
   */
  restart(data: PlaySceneData) {
    if (this.restarting) return;
    this.leaving = true;
    this.restarting = true;
    const target = this.ctx.index.scene(data.sceneId);
    if (target && (queueScene(this, this.ctx, target) > 0 || this.load.isLoading())) {
      this.ctx.ui.status('Loading…');
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.ctx.ui.status(null);
        this.scene.restart(data);
      });
      if (!this.load.isLoading()) this.load.start();
      return;
    }
    this.scene.restart(data);
  }

  // ---------------------------------------------------------------- jump

  private sizeFromTexture(): { width: number; height: number } | null {
    const layer = this.def.background_media?.[0];
    if (!layer) return null;
    const key = mediaKey(layerMediaId(layer));
    if (!this.textures.exists(key)) return null;
    const image = this.textures.get(key).getSourceImage();
    return { width: image.width, height: image.height };
  }

  /** Called by the engine once the scene's end events have finished. */
  private jump(sceneId: Id, spawnPoint?: string) {
    const target = this.ctx.index.scene(sceneId);
    if (!target || this.leaving) return;
    this.leaving = true;
    this.ctx.saveProgress(true);
    this.ctx.connection.changeScene({ scene_id: sceneId, spawn_point: spawnPoint });

    // Where the server will put us; used directly so there is no wait for the state patch.
    const spawn = this.ctx.index.spawn(target, spawnPoint);
    const position = spawn ? { x: spawn.position_x, y: spawn.position_y } : undefined;

    const cam = this.cameras.main;
    // Usually everything is already preloaded; otherwise restart finishes loading before switching.
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.restart({ sceneId, position }));
    cam.fadeOut(300, 0, 0, 0);
  }

  private shutdown() {
    this.ctx.inScene = null;
    this.ctx.sceneId = null;
    this.stopWatching();
    this.engine.stop();
    this.host.teardown();
    // Destroy in reverse order, so a system can still reach those it depends on.
    for (const system of [...this.systems].reverse()) system.destroy?.();
    this.systems = [];
    this.byClass.clear();
  }
}

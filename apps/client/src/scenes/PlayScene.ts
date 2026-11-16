import * as Phaser from 'phaser';
import {
  layerMediaId, SceneEngine, sceneSize, walkContext,
  type Id, type Point, type Scene, type WalkContext,
} from '@qbl/shared';
import { ActionHost } from '../actions/ActionHost';
import { mediaKey, queueScene } from '../core/assets';
import { getContext, type GameContext } from '../core/GameContext';
import type { PlaySceneData, SceneRuntime, SceneSystem, SceneSystemClass } from '../core/SceneRuntime';
import { sceneSystems } from '../systems';
import { PropsSystem } from '../systems/PropsSystem';

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
    this.systems = [];
    this.byClass = new Map();
  }

  create(data: PlaySceneData) {
    const ctx = (this.ctx = getContext(this));
    this.def = ctx.index.scene(data.sceneId) ?? ctx.index.startScene();
    this.zoom = this.def.zoom ?? 1;
    this.size = sceneSize(ctx.scenario, this.def) ?? this.sizeFromTexture() ?? DEFAULT_SIZE;
    this.startPosition = data.position ?? null;

    // The event engine for this visit to the scene.
    this.host = new ActionHost(this, ctx, (sceneId, spawn) => this.jump(sceneId, spawn));
    this.engine = new SceneEngine(this.def, ctx.index, ctx.vars, this.host, ctx.flags);
    const def = this.def;
    const engine = this.engine;
    ctx.vars.provide('QBLSceneId', () => def.id);
    ctx.vars.provide('QBLHotspotCoordinates', () => engine.hotspotCoordinates);

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

    this.stopWatching = ctx.vars.onChange(() => {
      for (const system of this.systems) system.variablesChanged?.();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    // Start events run once everything is on screen.
    this.engine.start();
  }

  update(time: number, delta: number) {
    this.ctx.syncRoomVariables();
    for (const system of this.systems) system.update?.(time, delta);
  }

  // ------------------------------------------------------- SceneRuntime

  system<T extends SceneSystem>(type: SceneSystemClass<T>): T {
    const found = this.byClass.get(type);
    if (!found) throw new Error(`Scene system ${type.name} is not registered`);
    return found as T;
  }

  walk(): WalkContext {
    const props = this.byClass.get(PropsSystem) as PropsSystem | undefined;
    return walkContext(this.def, this.size, props?.obstacles() ?? []);
  }

  restart(data: PlaySceneData) {
    this.leaving = true;
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
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      // Usually everything is already preloaded; otherwise finish loading before switching.
      if (queueScene(this, this.ctx, target) > 0 || this.load.isLoading()) {
        this.ctx.ui.status('Loading…');
        this.load.once(Phaser.Loader.Events.COMPLETE, () => {
          this.ctx.ui.status(null);
          this.restart({ sceneId, position });
        });
        if (!this.load.isLoading()) this.load.start();
      } else {
        this.restart({ sceneId, position });
      }
    });
    cam.fadeOut(300, 0, 0, 0);
  }

  private shutdown() {
    this.stopWatching();
    this.engine.stop();
    this.host.teardown();
    // Destroy in reverse order, so a system can still reach those it depends on.
    for (const system of [...this.systems].reverse()) system.destroy?.();
    this.systems = [];
    this.byClass.clear();
  }
}

import type * as Phaser from 'phaser';
import type { Id, Point, Scene, SceneEngine, WalkContext } from '@qbl/shared';
import type { GameContext } from './GameContext';

/**
 * A scene system is one self-contained piece of what happens in a scene:
 * drawing the layers, moving the local player, showing other players,
 * running hotspots, and so on. PlayScene creates every registered system
 * when a scene starts and destroys them when it ends.
 *
 * To add a feature that lives inside a scene, write a class that implements
 * this interface and add it to the list in systems/index.ts. All hooks are
 * optional.
 */
export interface SceneSystem {
  /** Build display objects and subscribe to things. Called once, in registration order. */
  create?(): void;
  /** Called every frame, in registration order. */
  update?(time: number, delta: number): void;
  /** A variable changed: the player's own or one shared by the room. */
  variablesChanged?(): void;
  /** Remove everything create() made. Timers and input listeners owned by the Phaser scene go away by themselves. */
  destroy?(): void;
}

export type SceneSystemClass<T extends SceneSystem = SceneSystem> = new (rt: SceneRuntime) => T;

export interface PlaySceneData {
  sceneId: Id;
  /** Start here instead of the position in the room state (used after a jump and after corrections). */
  position?: Point;
}

/** What a system can see and do. Implemented by PlayScene. */
export interface SceneRuntime {
  readonly scene: Phaser.Scene;
  readonly ctx: GameContext;
  /** The QBL scene being played. */
  readonly def: Scene;
  /** World size in pixels. */
  readonly size: { width: number; height: number };
  /** The scene's `zoom`: a scale applied to avatars and objects. */
  readonly zoom: number;
  readonly engine: SceneEngine;
  /** Where the local player starts in this scene. */
  readonly startPosition: Point | null;
  /** True once a jump has begun. Systems stop reacting to input but keep drawing through the fade. */
  readonly leaving: boolean;
  /** Another system, by class. Throws if it is not registered. */
  system<T extends SceneSystem>(type: SceneSystemClass<T>): T;
  /** Where feet may be right now, including obstacles from blocking items. */
  walk(): WalkContext;
  /** Switch to another scene immediately, without end events (used for server corrections). */
  restart(data: PlaySceneData): void;
}

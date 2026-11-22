import type * as Phaser from 'phaser';
import type { ActionHandle, Id, PresentedAction, SceneEngine } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { OverlayHandle } from '../ui/UiPort';
import type { Figure } from '../entities/Figure';
import type { Voice } from '../audio/synth';

/** Something a running action put on screen, kept so a translate action can animate it. */
export type Target =
  | { kind: 'world'; object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite; figure?: Figure }
  | { kind: 'overlay'; overlay: OverlayHandle };

/** What a presenter can use. Implemented by ActionHost. */
export interface PresenterContext {
  readonly scene: Phaser.Scene;
  readonly ctx: GameContext;
  readonly engine: SceneEngine;
  /** Remember what an action is showing until its handle settles. */
  track(actionId: Id, target: Target, handle: ActionHandle): void;
  /** Sounds registered here are stopped when the scene ends. */
  readonly sounds: Set<Phaser.Sound.BaseSound>;
  /** The game's own sounds (AudioAction.sound) playing: stopped when the scene ends too. */
  readonly voices: Set<Voice>;
  /** Report media that is missing or not loaded; returns a handle that is already finished. */
  missing(action: PresentedAction): ActionHandle;
  /**
   * Where a speaker stands, in scene pixels: a character placed in the scene, or a player (this
   * one, unless `actor` names another player's session). `y` is their feet.
   */
  locate(who: { character_id?: Id; actor?: string }): { x: number; y: number; height: number; name?: string } | null;
  warn(message: string): void;
}

/**
 * A presenter shows or plays one type of action and returns a handle whose
 * `done` settles when the action ends and whose `cancel` ends it early.
 *
 * To support a new action type: add it to the shared Action types, write a
 * presenter in presenters/, and register it in presenters/index.ts.
 */
export type Presenter<T extends PresentedAction['type']> = (
  action: Extract<PresentedAction, { type: T }>,
  pc: PresenterContext,
  /** Set when the action is being shown from another player's event: that player's session id. */
  actor?: string,
) => ActionHandle;

export type PresenterMap = { [T in PresentedAction['type']]: Presenter<T> };

export function deferred(): { done: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  return { done, resolve };
}

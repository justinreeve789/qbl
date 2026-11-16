import type * as Phaser from 'phaser';
import {
  resolvedHandle,
  type ActionHandle, type EngineHost, type Id, type PresentedAction, type SceneEngine, type TranslateAction,
} from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import { deferred, type Presenter, type PresenterContext, type PresenterMap, type Target } from './Presenter';
import { stopMusic } from './presenters/audio';
import { presenters as defaultPresenters } from './presenters';

/**
 * The scene engine's window onto Phaser and the UI. It hands each action to
 * the presenter registered for its type, and looks after what presenters
 * leave on screen: translate targets, sounds, and clean-up when the scene ends.
 */
export class ActionHost implements EngineHost, PresenterContext {
  engine!: SceneEngine;
  readonly sounds = new Set<Phaser.Sound.BaseSound>();
  private targets = new Map<Id, Target>();

  constructor(
    readonly scene: Phaser.Scene,
    readonly ctx: GameContext,
    private onJump: (sceneId: Id, spawnPoint?: string) => void,
    private presenters: PresenterMap = defaultPresenters,
  ) {}

  // ------------------------------------------------------------ EngineHost

  present(action: PresentedAction, engine: SceneEngine): ActionHandle {
    this.engine = engine;
    const presenter = this.presenters[action.type] as Presenter<typeof action.type> | undefined;
    if (!presenter) {
      this.warn(`no presenter for action type "${action.type}"`);
      return resolvedHandle();
    }
    return presenter(action as never, this);
  }

  translate(action: TranslateAction): ActionHandle | null {
    const target = this.targets.get(action.target_id);
    if (!target) return null;
    const duration = Math.max(action.duration ?? 0, 0);

    if (target.kind === 'overlay') {
      target.overlay.transition({ alpha: action.alpha, scaleX: action.scale_x, scaleY: action.scale_y }, duration);
      return this.delay(duration);
    }

    const props: Record<string, number> = {};
    if (action.position_x != null) props.x = action.position_x;
    if (action.position_y != null) props.y = action.position_y;
    if (action.scale_x != null) props.scaleX = action.scale_x;
    if (action.scale_y != null) props.scaleY = action.scale_y;
    if (action.alpha != null) props.alpha = action.alpha;
    const d = deferred();
    const tween = this.scene.tweens.add({ targets: target.object, ...props, duration, onComplete: d.resolve });
    return {
      done: d.done,
      cancel: () => {
        tween.stop();
        d.resolve();
      },
    };
  }

  delay(ms: number): ActionHandle {
    const d = deferred();
    const timer = this.scene.time.delayedCall(Math.max(ms, 0), d.resolve);
    return {
      done: d.done,
      cancel: () => {
        timer.remove();
        d.resolve();
      },
    };
  }

  jump(sceneId: Id, spawnPoint?: string) {
    this.onJump(sceneId, spawnPoint);
  }

  /** A cancel action named something this scene did not start: the background music from an earlier scene. */
  cancelPersistent(actionId: Id) {
    if (this.ctx.music?.actionIds.has(actionId)) stopMusic(this.ctx);
  }

  warn(message: string) {
    console.warn(`[qbl] ${message}`);
  }

  // ------------------------------------------------------ PresenterContext

  track(actionId: Id, target: Target, handle: ActionHandle) {
    this.targets.set(actionId, target);
    void handle.done.then(() => {
      if (this.targets.get(actionId) === target) this.targets.delete(actionId);
    });
  }

  missing(action: PresentedAction): ActionHandle {
    this.warn(`action ${action.id}: media ${String(action.media_id)} is not available`);
    return resolvedHandle();
  }

  // -------------------------------------------------------------- lifetime

  /** Stop everything this scene started, except the background music. */
  teardown() {
    for (const sound of this.sounds) {
      sound.stop();
      sound.destroy();
    }
    this.sounds.clear();
    this.targets.clear();
    this.ctx.ui.clearOverlays();
  }
}

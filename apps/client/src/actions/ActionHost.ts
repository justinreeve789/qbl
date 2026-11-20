import type * as Phaser from 'phaser';
import {
  resolvedHandle,
  type Action, type ActionHandle, type ChoiceHandle, type ConversationAction, type ConversationChoice, type ConversationLine, type EngineHost, type GameEvent, type Id, type PresentedAction, type SceneEngine, type TranslateAction, type WalkAction,
} from '@qbl/shared';
import type { AnimateAction, AwardAction, GlossaryAction } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import { deferred, type Presenter, type PresenterContext, type PresenterMap, type Target } from './Presenter';
import { stopMusic } from './presenters/audio';
import { conversationLine } from './presenters/conversation';
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

  present(action: PresentedAction, engine: SceneEngine, actor?: string): ActionHandle {
    this.engine = engine;
    const presenter = this.presenters[action.type] as Presenter<typeof action.type> | undefined;
    if (!presenter) {
      this.warn(`no presenter for action type "${action.type}"`);
      return resolvedHandle();
    }
    return presenter(action as never, this, actor);
  }

  /** One line of a conversation, and the player's answer to it. */
  converse(action: ConversationAction, line: ConversationLine, choices: ConversationChoice[], engine: SceneEngine): ChoiceHandle {
    this.engine = engine;
    return conversationLine(action, line, choices, this);
  }

  /** An event for the whole scene reached an action: the other players there are shown it too. */
  share(event: GameEvent, action: Action) {
    this.ctx.connection.share(event.id, action.id);
  }

  /** An award action: the server grants it. Offline there is no server, so the preview shows what it would give. */
  award(action: AwardAction) {
    if (this.ctx.connection.online) this.ctx.connection.award(action.id);
    else this.ctx.previewAward?.(action);
  }

  /** A glossary action: the player has a new word. Told once; a word they already have is not announced again. */
  glossary(action: GlossaryAction) {
    const entry = this.ctx.learn(action.entry_id);
    if (entry && action.quiet !== true) this.ctx.ui.toast(`New word in your glossary: ${entry.term}`, 4000);
  }

  /** A hotspot fired: a line for the activity log, so a report can say what the player tried. */
  started(event: GameEvent, hotspot: boolean) {
    if (hotspot) this.ctx.track({ type: 'hotspot', ref: String(event.id), label: event.shortname });
  }

  /** Set by the scene: finds the player's avatar or a placed character. */
  locateControl: ((who: { character_id?: Id; actor?: string }) => { x: number; y: number; height: number; name?: string } | null) | null = null;

  locate(who: { character_id?: Id; actor?: string }) {
    return this.locateControl?.(who) ?? null;
  }

  /**
   * Set by the scene: plays an animation on the player's avatar, a placed item or a character.
   * Returns how long it lasts in milliseconds (0: it loops, or nothing to wait for), or null if the target is not there.
   */
  animateControl: ((action: AnimateAction, actor?: string) => number | null) | null = null;

  animate(action: AnimateAction, actor?: string): ActionHandle | null {
    const ms = action.target === 'action'
      ? (action.target_id != null ? (this.targets.get(action.target_id) as { figure?: { play(name: string): number } } | undefined)?.figure?.play(action.animation) : undefined) ?? null
      : (this.animateControl?.(action, actor) ?? null);
    if (ms == null) this.warn(`animate ${action.id}: nothing to animate`);
    return ms != null && ms > 0 ? this.delay(ms) : null;
  }

  /** Set by the scene: walks a character, or the player's avatar. */
  walkControl: ((action: WalkAction, actor?: string) => ActionHandle | null) | null = null;

  walk(action: WalkAction, actor?: string): ActionHandle | null {
    const handle = this.walkControl?.(action, actor) ?? null;
    if (!handle && !actor) this.warn(`walk ${action.id}: nobody to walk, or nowhere to go`);
    return handle;
  }

  /** Set by the scene: stops the local player from walking, or lets them walk again. */
  freezeControl: ((frozen: boolean) => void) | null = null;

  freeze(frozen: boolean) {
    this.freezeControl?.(frozen);
  }

  /** Set by the scene: shows or hides the local player's avatar. */
  avatarControl: ((visible: boolean, duration: number) => void) | null = null;

  avatar(visible: boolean, duration: number): ActionHandle | null {
    if (!this.avatarControl) return null;
    this.avatarControl(visible, duration);
    return duration > 0 ? this.delay(duration) : null;
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

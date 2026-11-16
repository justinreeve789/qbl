import { ScenarioIndex } from './scenario.js';
import { SHOWN_TO_SCENE, type Action, type AnimateAction, type AwardAction, type GameEvent, type Hotspot, type Id, type Scene, type TranslateAction } from './types.js';
import { testConditions, VariableStore } from './variables.js';

/** A running action. `done` settles when it ends on its own or is cancelled. */
export interface ActionHandle {
  done: Promise<void>;
  cancel(): void;
}

export type PresentedAction = Extract<
  Action,
  { type: 'audio' | 'dialogue' | 'shop' | 'image_fixed' | 'image_overlay' | 'infobox' | 'spritemap' | 'text_overlay' | 'video' }
>;

/**
 * Everything the engine needs from its surroundings. The Phaser client
 * implements this; tests use a fake. The engine itself never touches the
 * renderer, the network or real timers.
 */
export interface EngineHost {
  /**
   * Show or play a media action. `actor` is set when the action comes from another player's
   * event (audience: scene): their session id, so "the player" in it means them.
   */
  present(action: PresentedAction, engine: SceneEngine, actor?: string): ActionHandle;
  /** An event shown to the whole scene reached this action: tell the other players. */
  share?(event: GameEvent, action: Action): void;
  /** Tween a running action's display object. Return null if the target is gone. */
  translate(action: TranslateAction): ActionHandle | null;
  /** Show or hide the player's avatar, fading over `duration` ms. The handle finishes when the fade does. */
  avatar?(visible: boolean, duration: number): ActionHandle | null;
  /**
   * Play an animation on the action's target. The handle finishes when a one-pass animation
   * does; null when there is nothing to wait for. `actor` as for present().
   */
  animate?(action: AnimateAction, actor?: string): ActionHandle | null;
  /** Stop the player from walking (true) or let them walk again (false). */
  freeze?(frozen: boolean): void;
  /** Ask the game server to grant an award action's stars and XP. */
  award?(action: AwardAction): void;
  delay(ms: number): ActionHandle;
  /** Leave the current scene. Called after end events have finished. */
  jump(sceneId: Id, spawnPoint?: string): void;
  /** A cancel action named something this scene's engine did not start (persistent audio from an earlier scene). */
  cancelPersistent?(actionId: Id): void;
  warn?(message: string): void;
}

/** Actions that stay up until a jump or cancel removes them never hold up the sequence. */
export function isIndefinite(action: Action): boolean {
  switch (action.type) {
    case 'image_fixed':
    case 'image_overlay':
    case 'text_overlay':
      return !action.duration || action.duration <= 0;
    case 'audio':
      return action.repeat === true;
    case 'spritemap':
      return action.spritemap_repeat !== false;
    default:
      return false;
  }
}

export function isShownToScene(action: Action): boolean {
  // An animation on a player's own avatar reaches everyone through the room state already.
  if (action.type === 'animate' && (action.target ?? 'player') === 'player') return false;
  return (SHOWN_TO_SCENE as readonly string[]).includes(action.type);
}

/** A repeat with no wait in its loop is paced at roughly one pass per frame. */
const REPEAT_YIELD_MS = 16;

interface Run {
  event: GameEvent;
  cancelled: boolean;
  handles: Set<ActionHandle>;
  finished: Promise<void>;
  wake: () => void;
  woken: Promise<void>;
}

export function resolvedHandle(): ActionHandle {
  return { done: Promise.resolve(), cancel() {} };
}

/**
 * Runs the events of one scene for one player: start events, hotspots,
 * indirect events and end events, honouring conditions, blocking,
 * overridable and block_hotspots.
 */
export class SceneEngine {
  private runs = new Map<Id, Run>();
  private actions = new Map<Id, ActionHandle>();
  private leaving = false;
  private stopped = false;
  private adHocId = -1;
  /** One-shot markers such as `hotspot:12`, carried in the save data. */
  readonly flags: Set<string>;
  /** Coordinates of the hotspot whose event started most recently. */
  hotspotCoordinates = '';

  constructor(
    readonly scene: Scene,
    readonly index: ScenarioIndex,
    readonly vars: VariableStore,
    readonly host: EngineHost,
    flags: Iterable<string> = [],
  ) {
    this.flags = new Set(flags);
  }

  /** Fire the scene's start events. */
  start(): void {
    for (const e of this.scene.start_events ?? []) void this.trigger(e);
  }

  get hotspotsBlocked(): boolean {
    for (const run of this.runs.values()) if (run.event.block_hotspots) return true;
    return false;
  }

  isRunning(eventId: Id): boolean {
    return this.runs.has(eventId);
  }

  /** Whether a hotspot would fire right now. Drives label visibility and hover feedback. */
  hotspotAvailable(h: Hotspot): boolean {
    if (this.stopped || this.leaving) return false;
    if (h.once && this.flags.has(`hotspot:${h.id}`)) return false;
    return testConditions(h.conditions, this.vars.get);
  }

  triggerHotspot(h: Hotspot): boolean {
    if (this.hotspotsBlocked || !this.hotspotAvailable(h) || this.runs.has(h.id)) return false;
    if (h.once) this.flags.add(`hotspot:${h.id}`);
    this.hotspotCoordinates = `${h.position_x ?? ''},${h.position_y ?? ''}`;
    void this.trigger(h);
    return true;
  }

  /** Start an event by id (must belong to this scene). */
  triggerById(eventId: Id): Promise<void> {
    const found = this.index.events.get(eventId);
    if (!found || found.scene.id !== this.scene.id) {
      this.host.warn?.(`run_event: event ${eventId} is not in scene ${this.scene.id}`);
      return Promise.resolve();
    }
    return this.trigger(found.event);
  }

  /**
   * Start an event. Resolves when its action sequence has finished or been
   * cut short. Events whose conditions fail are bypassed.
   */
  trigger(event: GameEvent): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const existing = this.runs.get(event.id);
    if (existing) return existing.finished;
    if (!testConditions(event.conditions, this.vars.get)) return Promise.resolve();

    // A newly started event interrupts every running overridable one.
    for (const other of [...this.runs.values()]) {
      if (other.event.overridable) this.cancelRun(other);
    }

    let wake!: () => void;
    const woken = new Promise<void>((r) => (wake = r));
    const run: Run = { event, cancelled: false, handles: new Set(), finished: Promise.resolve(), wake, woken };
    this.runs.set(event.id, run);
    run.finished = this.execute(run)
      .catch((err) => this.host.warn?.(`event ${event.id} failed: ${String(err)}`))
      .finally(() => {
        if (this.runs.get(event.id) === run) this.runs.delete(event.id);
        // A freeze never outlives the event that asked for it, so nobody is left unable to move.
        if (this.frozenBy.delete(event.id) && this.frozenBy.size === 0) this.host.freeze?.(false);
      });
    return run.finished;
  }

  /** Run a single action outside any event, e.g. an infobox button. */
  runAction(action: Omit<Action, 'id'> & { id?: Id }): Promise<void> {
    const id = action.id ?? this.adHocId--;
    const event: GameEvent = { id: this.adHocId--, actions: [{ ...action, id, blocking: true } as Action] };
    return this.trigger(event);
  }

  /**
   * Another player's event (audience: scene) reached this action: show it here too. Only what is
   * seen and heard is taken; nothing here changes this player's variables, position or progress.
   */
  watch(eventId: Id, actionId: Id, actor: string): void {
    if (this.stopped || this.leaving) return;
    const found = this.index.events.get(eventId);
    if (!found || found.scene.id !== this.scene.id || found.event.audience !== 'scene') return;
    const action = found.event.actions.find((a) => a.id === actionId);
    if (!action || !isShownToScene(action)) return;
    if (action.type === 'cancel') {
      this.cancelAction(action.action_id);
      return;
    }
    let handle: ActionHandle | null;
    if (action.type === 'translate') handle = this.actions.has(action.target_id) ? this.host.translate(action) : null;
    else if (action.type === 'animate') handle = this.host.animate?.(action, actor) ?? null;
    else handle = this.host.present(action as PresentedAction, this, actor);
    if (!handle) return;
    this.actions.get(action.id)?.cancel();
    this.actions.set(action.id, handle);
    const h = handle;
    void h.done.finally(() => {
      if (this.actions.get(action.id) === h) this.actions.delete(action.id);
    });
  }

  /** Events that have frozen the player and are still running. */
  private frozenBy = new Set<Id>();

  cancelAction(actionId: Id): void {
    this.actions.get(actionId)?.cancel();
    this.actions.delete(actionId);
    this.host.cancelPersistent?.(actionId);
  }

  /** Run end events, then ask the host to change scene. */
  async leave(sceneId: Id, spawnPoint?: string): Promise<void> {
    if (this.leaving || this.stopped) return;
    this.leaving = true;
    await Promise.all((this.scene.end_events ?? []).map((e) => this.trigger(e)));
    this.stop();
    this.host.jump(sceneId, spawnPoint);
  }

  /** Cancel everything. The host decides what survives (persistent audio). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const run of [...this.runs.values()]) this.cancelRun(run);
    for (const h of [...this.actions.values()]) h.cancel();
    this.actions.clear();
    this.runs.clear();
  }

  private cancelRun(run: Run): void {
    run.cancelled = true;
    for (const h of [...run.handles]) h.cancel();
    run.handles.clear();
    run.wake();
  }

  private track(run: Run, action: Action, handle: ActionHandle): void {
    this.actions.get(action.id)?.cancel();
    this.actions.set(action.id, handle);
    run.handles.add(handle);
    void handle.done.finally(() => {
      run.handles.delete(handle);
      if (this.actions.get(action.id) === handle) this.actions.delete(action.id);
    });
  }

  private async wait(run: Run, handle: ActionHandle): Promise<void> {
    await Promise.race([handle.done, run.woken]);
  }

  private async execute(run: Run): Promise<void> {
    const actions = run.event.actions;
    let i = 0;
    while (i < actions.length && !run.cancelled && !this.stopped) {
      const action = actions[i]!;
      i++;
      if (!testConditions(action.conditions, this.vars.get)) continue;
      if (run.event.audience === 'scene' && isShownToScene(action)) this.host.share?.(run.event, action);

      switch (action.type) {
        case 'repeat': {
          i = 0;
          await this.wait(run, this.host.delay(REPEAT_YIELD_MS));
          break;
        }
        case 'jump': {
          // End events of this scene run inside leave(); this sequence ends here.
          void this.leave(action.scene_id, action.spawn_point);
          return;
        }
        case 'run_event': {
          const target = action.target_event_id ?? action.event_id;
          if (target == null || target === run.event.id) break;
          const p = this.triggerById(target);
          if (action.blocking !== false) await Promise.race([p, run.woken]);
          break;
        }
        case 'cancel': {
          this.cancelAction(action.action_id);
          break;
        }
        case 'variable': {
          this.vars.apply(action.name, action.operator, action.operand);
          break;
        }
        case 'wait': {
          if (action.duration > 0) {
            const h = this.host.delay(action.duration);
            this.track(run, action, h);
            if (action.blocking !== false) await this.wait(run, h);
          }
          break;
        }
        case 'award': {
          this.host.award?.(action);
          break;
        }
        case 'animate': {
          const h = this.host.animate?.(action) ?? null;
          if (h) {
            this.track(run, action, h);
            if (action.blocking !== false) await this.wait(run, h);
          }
          break;
        }
        case 'freeze': {
          if (action.frozen !== false) this.frozenBy.add(run.event.id);
          else this.frozenBy.clear();
          this.host.freeze?.(action.frozen !== false);
          break;
        }
        case 'avatar': {
          const h = this.host.avatar?.(action.visible !== false, Math.max(0, Number(action.duration ?? 0)));
          if (h) {
            this.track(run, action, h);
            if (action.blocking !== false) await this.wait(run, h);
          }
          break;
        }
        case 'translate': {
          if (!this.actions.has(action.target_id)) break;
          const h = this.host.translate(action);
          if (h) {
            this.track(run, action, h);
            if (action.blocking !== false) await this.wait(run, h);
          }
          break;
        }
        default: {
          const h = this.host.present(action, this);
          this.track(run, action, h);
          if (action.blocking !== false && !isIndefinite(action)) await this.wait(run, h);
        }
      }
    }
  }
}

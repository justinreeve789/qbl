import { Rewards } from './Rewards';
import type * as Phaser from 'phaser';
import {
  escapeHtml, interpolate, resolveMediaUrl, ScenarioIndex, VariableStore,
  type Id, type Scenario, type User, type VarValue,
} from '@qbl/shared';
import type { AwardAction } from '@qbl/shared';
import type { GameConnection } from '../net/Connection';
import type { UiPort } from '../ui/UiPort';

export interface GameOptions {
  /** Draw walkable areas, spawn points and hotspot areas over the art. */
  debug: boolean;
}

/**
 * Everything that outlives a single scene: the scenario, the player's
 * variables and progress, the connection and the UI. Stored in the Phaser
 * registry under "ctx" and handed to every system, presenter and feature.
 */
export class GameContext {
  readonly index: ScenarioIndex;
  readonly vars: VariableStore;
  /** One-shot markers (e.g. hotspots that fire once), saved with progress. */
  readonly flags: Set<string>;
  /** The background music: the one audio action flagged `persist` that is playing, if any. */
  music: { sound: Phaser.Sound.BaseSound; mediaId: Id; actionIds: Set<Id> } | null = null;
  private startedAt = performance.now();
  private baseElapsed: number;
  private dirty = false;

  /** Offline only: what to do with an award when there is no server to grant it. Set by the rewards feature. */
  previewAward: ((action: AwardAction) => void) | null = null;

  /** Stars, XP, rank, belongings and the marketplace. */
  readonly rewards: Rewards;

  constructor(
    readonly scenario: Scenario,
    readonly user: User,
    readonly connection: GameConnection,
    readonly ui: UiPort,
    readonly options: GameOptions = { debug: false },
  ) {
    this.index = new ScenarioIndex(scenario);
    this.rewards = new Rewards(scenario.shop_items);
    const session = connection.welcome.session;
    this.vars = new VariableStore(scenario.global_variables, session.variables ?? {});
    this.flags = new Set(session.flags ?? []);
    this.baseElapsed = session.time_elapsed ?? 0;

    // Room-scoped variables are owned by the room; forward changes instead of applying them.
    this.vars.remote = (name, operator, operand) => connection.variable({ name, operator, operand });
    this.vars.onChange(() => (this.dirty = true));

    this.vars.provide('QBLTimeElapsed', () => this.timeElapsed);
    this.vars.provide('QBLScenarioLanguage', () => (scenario.default_language ?? 'en-us').slice(0, 2));
    this.vars.provide('QBLPlayerName', () => user.name);
    this.vars.provide('QBLPlayerCount', () => {
      let n = 0;
      connection.state.players.forEach(() => n++);
      return n;
    });
    this.vars.provide('QBLVideoPlaying', () => (ui.videoPlaying ? 1 : 0));
    this.vars.provide('QBLVideoTimeIndex', () => ui.videoTime);
  }

  get timeElapsed(): number {
    return Math.floor(this.baseElapsed + (performance.now() - this.startedAt) / 1000);
  }

  /** URL of a media asset, or null if the scenario does not define it. */
  mediaUrl = (id: Id): string | null => {
    const media = this.index.media.get(id);
    return media ? resolveMediaUrl(this.scenario, media) : null;
  };

  /** Fill {{variable}} placeholders in plain text. */
  text(template: string): string {
    return interpolate(template, this.vars.get, { mediaUrl: this.mediaUrl });
  }

  /** Fill placeholders in HTML. Variable values are escaped; {{media:ID}} becomes the media's URL. */
  html(template: string): string {
    return interpolate(template, this.vars.get, { mediaUrl: this.mediaUrl, escape: escapeHtml });
  }

  /** Copy room-scoped values from the synchronized state into the variable store. */
  syncRoomVariables(): void {
    this.connection.state.vars.forEach((raw, name) => {
      let value: VarValue;
      try {
        value = JSON.parse(raw) as VarValue;
      } catch {
        return;
      }
      if (this.vars.get(name) !== value) this.vars.setFromRemote(name, value);
    });
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Send player-scoped progress to the server so it can be saved. */
  saveProgress(force = false): void {
    if (!this.dirty && !force) return;
    this.dirty = false;
    this.connection.progress({
      variables: this.vars.snapshot('player'),
      flags: [...this.flags],
      time_elapsed: this.timeElapsed,
    });
  }
}

export function getContext(scene: Phaser.Scene): GameContext {
  return scene.registry.get('ctx') as GameContext;
}

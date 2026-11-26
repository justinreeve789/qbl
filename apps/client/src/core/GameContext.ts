import { Bag } from './Bag';
import { Rewards } from './Rewards';
import type * as Phaser from 'phaser';
import {
  canSee, escapeHtml, launchPath, isStaff, glossaryFlag, glossaryOf, interpolate, resolveMediaUrl, sceneTeamOnly, ScenarioIndex, VariableStore,
  type GlossaryEntry, type Id, type LaunchBroadcast, type PlayerRec, type PlayerProfile, type Scenario, type TrackMessage, type User, type VarValue,
} from '@qbl/shared';
import type { Action, AwardAction } from '@qbl/shared';
import type { GameConnection } from '../net/Connection';

/** A team a teacher can follow: its instance key (`t7`, or `a12` for students in no team) and name. */
export interface TeamChoice { group: string; name: string }

/** An action of any type with no id of its own, to run outside the scene's events. */
export type LooseAction = Action extends infer A ? (A extends Action ? Omit<A, 'id'> : never) : never;

/** One of a teacher's assignments they could launch from here, as the API lists it. */
export interface LaunchableAssignment {
  id: number;
  scenario: { id: number; title: string } | null;
  due_at: string | null;
  /** The mission waits for its teacher, and has not been launched yet. */
  waiting?: boolean;
  students: Array<{ id: number }>;
}
import type { UiPort } from '../ui/UiPort';

export interface GameOptions {
  /** Draw walkable areas, spawn points and hotspot areas over the art. */
  debug: boolean;
  /** A draft being tried from the editor: problems with the scenario are shown on screen too. */
  preview?: boolean;
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

  /** What the player carries, and the thing they have picked to use. */
  readonly bag: Bag;

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

    // The system's variables (SYSTEM_VARIABLES). QL_HotspotCoordinates and QL_PhysicsEnabled
    // belong to the scene being played: PlayScene supplies them.
    this.vars.provide('QL_TimeElapsed', () => this.timeElapsed);
    this.vars.provide('QL_ScenarioLanguage', () => (scenario.default_language ?? 'en-us').slice(0, 2));
    this.vars.provide('QL_VideoPlaying', () => (ui.videoPlaying ? 1 : 0));
    this.vars.provide('QL_VideoTimeIndex', () => ui.videoTime);
    this.vars.provide('QL_PlayerName', () => user.name);
    // A teacher is the one who assigned this game to the player's class. Teachers and admins
    // have none of their own, even in a game they look in on.
    const teacher = isStaff(user.role) ? '' : (scenario.instance?.teacher_name ?? '');
    this.vars.provide('QL_TeacherName', () => teacher);
    this.vars.provide('QL_HasTeacher', () => (teacher ? 1 : 0));
    this.vars.provide('QL_IsTeacher', () => (isStaff(user.role) ? 1 : 0));
    // "Everyone playing together" is the player's own instance: their team, when the room holds several.
    this.vars.provide('QL_PlayerCount', () => {
      let n = 0;
      const mine = connection.me?.team ?? '';
      connection.state.players.forEach((p) => {
        if ((p.team ?? '') === mine) n++;
      });
      return n;
    });

    // A teacher's launch: whether one is waiting for this player to go, and where to.
    this.vars.provide('QL_NextMission', () => this.launched?.title ?? '');
    this.vars.provide('QL_SCENARIO_LAUNCH_URL', () => this.launchUrl);

    this.bag = new Bag(scenario, this.vars.get);
    this.bag.say = (text) => ui.toast(text, 2600);
    this.vars.provide('QL_Holding', () => this.bag.holding);
  }

  // ------------------------------------------------------------- other players

  /** The team this player is in, and its name when it has one. */
  get team(): { key: string; name?: string } {
    return this.connection.welcome.team ?? { key: '' };
  }

  /**
   * Whether another player is shown to this one: they are in the same scene, and, where the
   * scene is limited to teams (by itself or by its group), in the same team.
   */
  sees(other: Pick<PlayerRec, 'scene_id' | 'team'>): boolean {
    const me = this.connection.me;
    const scene = me ? this.index.scene(me.scene_id) : undefined;
    return !!me && !!scene && canSee(me, other, sceneTeamOnly(this.scenario, scene));
  }

  /** A teacher or admin: they follow one team at a time and can switch to another (see TeamsFeature). */
  get staff(): boolean {
    return isStaff(this.connection.me?.role);
  }

  /**
   * Set at start-up when there is an API to ask: the teams a teacher can follow in this game
   * (their assignment's teams). Null: none to offer.
   */
  fetchTeams: (() => Promise<TeamChoice[]>) | null = null;

  /** Set at start-up: leave this game and join the same scenario as a member of another team. */
  followTeam: ((group: string, sceneId?: Id) => void) | null = null;

  // ------------------------------------------------------------------- launches

  /**
   * The mission a teacher has just launched for this player (LaunchFeature), until they go to it:
   * where a travel action takes them.
   */
  launched: LaunchBroadcast | null = null;

  /** Set at start-up when there is somewhere to go: leave this game for the launched mission. */
  goToMission: ((launch: LaunchBroadcast) => void) | null = null;

  /** The launch this player has left for, once they have. */
  departed: LaunchBroadcast | null = null;

  /**
   * QL_SCENARIO_LAUNCH_URL: the full address of the player's own instance of the scenario their
   * teacher launched, until they go to it; empty otherwise.
   */
  get launchUrl(): string {
    const launch = this.launched;
    if (!launch || this.departed) return '';
    const path = launch.url ?? launchPath(launch.code, launch.group);
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    return new URL(path, base).href;
  }

  /**
   * Set at start-up when the game may be left for another page (not in a preview): save, leave
   * the game server, and go there.
   */
  leavePage: ((href: string) => void) | null = null;

  /** Go to a launched mission, once. */
  leaveFor(launch: LaunchBroadcast): void {
    if (this.departed) return;
    this.departed = launch;
    this.goToMission?.(launch);
  }

  /**
   * Set by the scene being played: run actions there, in order, as an event of its own would (a
   * launch's jump to the departure scene, or its travel). Null between scenes.
   */
  inScene: ((actions: LooseAction[]) => Promise<void>) | null = null;

  /** The scene being played, set by it while it runs. Null between scenes. */
  sceneId: number | null = null;

  /** Set at start-up for a teacher when there is an API to ask: their assignments, to launch one from here. */
  fetchLaunchable: (() => Promise<LaunchableAssignment[]>) | null = null;

  /** Set by the players feature: open the profile of the player with this session id. */
  showProfile: ((sessionId: string) => void) | null = null;

  /** Set at start-up when there is an API to ask: another player's profile by their user id. Null: not available. */
  fetchProfile: ((userId: string) => Promise<PlayerProfile | null>) | null = null;

  // ------------------------------------------------------------------ glossary

  private glossaryListeners = new Set<() => void>();

  /** The words this player has, in alphabetical order. */
  get glossary(): GlossaryEntry[] {
    return glossaryOf(this.scenario, this.flags);
  }

  /** Give the player a word. Returns the entry when it is new to them, and null otherwise. */
  learn(entryId: Id | string): GlossaryEntry | null {
    const entry = (this.scenario.glossary ?? []).find((e) => String(e.id) === String(entryId));
    if (!entry || entry.initial === true || this.flags.has(glossaryFlag(entry.id))) return null;
    this.flags.add(glossaryFlag(entry.id));
    this.markDirty();
    this.track({ type: 'glossary', ref: String(entry.id), label: entry.term });
    for (const l of [...this.glossaryListeners]) l();
    return entry;
  }

  onGlossary(listener: () => void): () => void {
    this.glossaryListeners.add(listener);
    return () => this.glossaryListeners.delete(listener);
  }

  // ------------------------------------------------------------------ activity

  /** Note something the player did, for the teacher's reports. Sent to the game server, which keeps the log. */
  track(msg: TrackMessage): void {
    this.connection.track({ ...msg, ref: msg.ref?.slice(0, 64), label: msg.label?.slice(0, 200) });
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

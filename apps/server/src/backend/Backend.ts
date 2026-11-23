import type { ActivityEntry, Id, InstanceData, LaunchPlan, MessageEntry, RewardMessage, Scenario, Session, User } from '@qbl/shared';

export type { InstanceData, LaunchPlan, User };

/**
 * Where scenarios, identities and save data come from. The room code only
 * talks to this interface, so the file-based development backend and the
 * Laravel API are interchangeable.
 */
export interface Backend {
  getScenario(shortname: string): Promise<Scenario>;
  /** Resolve a bearer token to a user, or null if it is not valid. */
  verifyToken(token: string): Promise<User | null>;
  /**
   * May this player join this instance of the scenario? An instance is named by its group:
   * "public", an assignment's ("a12") or a team's ("t7"). Teams are for their members.
   */
  mayJoin(scenarioId: Id, user: User, group: string, party?: string): Promise<Access>;
  /** A player's save belongs to one instance: their team's game is not their public one. */
  loadSession(scenarioId: Id, userId: string, group: string): Promise<Session | null>;
  /**
   * Throws ProgressResetError when a teacher reset the player's progress after this save was
   * loaded: the save is stale and must not be written.
   */
  saveSession(scenarioId: Id, userId: string, group: string, session: Session): Promise<void>;
  loadInstance(scenarioId: Id, group: string): Promise<InstanceData | null>;
  saveInstance(scenarioId: Id, group: string, data: InstanceData): Promise<void>;
  /**
   * Grant an award action's stars and XP to a player. The backend decides: it checks the action
   * against the published scenario and grants a once-only award once. Null: nothing was granted
   * (a guest, an unknown action, the backend refusing).
   */
  award(scenarioId: Id, userId: string, actionId: Id): Promise<RewardMessage | null>;
  /** What the player's avatar wears now: equipped shop item ids, comma-separated. */
  look(userId: string): Promise<string>;
  /** Keep what players did, for the teacher's reports. */
  logActivity(scenarioId: Id, entries: ActivityEntry[]): Promise<void>;
  /** Keep every message sent, in a scene or privately, so it can be audited later. */
  logMessages(scenarioId: Id, entries: MessageEntry[]): Promise<void>;
  /**
   * A teacher launches one of their assignments from the game: it is open to its students from
   * now on, and the answer says where each of them plays it. Refused (with the reason, for the
   * teacher) when it is not theirs, or not published, or this backend has no classes.
   */
  launch(teacherId: string, assignmentId: number): Promise<{ ok: true; plan: LaunchPlan } | { ok: false; message: string }>;
}

/** A save refused because a teacher reset the player's progress in that instance since it was loaded. */
export class ProgressResetError extends Error {
  constructor() {
    super('The player\'s progress was reset since the save was loaded.');
    this.name = 'ProgressResetError';
  }
}

/** The answer to "may this player join this instance?". */
export interface Access {
  allowed: boolean;
  /**
   * The room the instance belongs to: the teams of one assignment share a room (its `a12`), so
   * they can meet in scenes that are not limited to a team. Anything else is a room of its own.
   */
  party: string;
  /** What the instance is called, when it has a name: the team's. */
  team_name?: string;
}

/** Wraps a backend so scenario documents are fetched at most once per TTL. */
export function withScenarioCache(backend: Backend, ttlSeconds: number): Backend {
  const cache = new Map<string, { at: number; value: Promise<Scenario> }>();
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop !== 'getScenario') return Reflect.get(target, prop, receiver);
      return (shortname: string) => {
        const hit = cache.get(shortname);
        if (hit && Date.now() - hit.at < ttlSeconds * 1000) return hit.value;
        const value = target.getScenario(shortname);
        cache.set(shortname, { at: Date.now(), value });
        value.catch(() => cache.delete(shortname));
        return value;
      };
    },
  });
}

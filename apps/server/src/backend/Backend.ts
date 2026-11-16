import type { Id, InstanceData, Scenario, Session, User } from '@qbl/shared';

export type { InstanceData, User };

/**
 * Where scenarios, identities and save data come from. The room code only
 * talks to this interface, so the file-based development backend and the
 * Laravel API are interchangeable.
 */
export interface Backend {
  getScenario(shortname: string): Promise<Scenario>;
  /** Resolve a bearer token to a user, or null if it is not valid. */
  verifyToken(token: string): Promise<User | null>;
  loadSession(scenarioId: Id, userId: string): Promise<Session | null>;
  saveSession(scenarioId: Id, userId: string, session: Session): Promise<void>;
  loadInstance(scenarioId: Id, group: string): Promise<InstanceData | null>;
  saveInstance(scenarioId: Id, group: string, data: InstanceData): Promise<void>;
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

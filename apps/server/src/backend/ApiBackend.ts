import type { Id, Scenario, Session, RewardMessage } from '@qbl/shared';
import type { Backend, InstanceData, User } from './Backend.js';

/**
 * Talks to the QBL Laravel API's internal endpoints. Every request carries
 * the shared service key; see docs/docs/api.md for the contract.
 */
export class ApiBackend implements Backend {
  constructor(private baseUrl: string, private serviceKey: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}/api/internal${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-QBL-Service-Key': this.serviceKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 401) return null;
    if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status}`);
    if (res.status === 204) return null;
    return (await res.json()) as T;
  }

  async getScenario(shortname: string): Promise<Scenario> {
    const data = await this.call<{ scenario: Scenario }>('GET', `/scenarios/${encodeURIComponent(shortname)}`);
    if (!data) throw new Error(`Scenario "${shortname}" not found`);
    return data.scenario;
  }

  async verifyToken(token: string): Promise<User | null> {
    const data = await this.call<{ user: { id: number | string; name: string; role: User['role']; avatar_media_id?: Id } }>(
      'POST', '/auth/verify', { token },
    );
    if (!data) return null;
    return { ...data.user, id: String(data.user.id) };
  }

  async mayJoin(scenarioId: Id, user: User, group: string): Promise<boolean> {
    const data = await this.call<{ allowed: boolean }>('GET', `/scenarios/${scenarioId}/access/${encodeURIComponent(user.id)}?group=${encodeURIComponent(group)}`);
    return data?.allowed === true;
  }

  async loadSession(scenarioId: Id, userId: string, group: string): Promise<Session | null> {
    const data = await this.call<{ session: Session | null }>('GET', `/scenarios/${scenarioId}/sessions/${encodeURIComponent(userId)}?group=${encodeURIComponent(group)}`);
    return data?.session ?? null;
  }

  async saveSession(scenarioId: Id, userId: string, group: string, session: Session): Promise<void> {
    await this.call('PUT', `/scenarios/${scenarioId}/sessions/${encodeURIComponent(userId)}?group=${encodeURIComponent(group)}`, { session });
  }

  async loadInstance(scenarioId: Id, group: string): Promise<InstanceData | null> {
    const data = await this.call<{ instance: InstanceData | null }>('GET', `/scenarios/${scenarioId}/instances/${encodeURIComponent(group)}`);
    return data?.instance ?? null;
  }

  async saveInstance(scenarioId: Id, group: string, data: InstanceData): Promise<void> {
    await this.call('PUT', `/scenarios/${scenarioId}/instances/${encodeURIComponent(group)}`, { instance: data });
  }

  async award(scenarioId: Id, userId: string, actionId: Id): Promise<RewardMessage | null> {
    // Refusals (a guest, an action that is not an award) are answers, not failures.
    const data = await this.call<{ progress: RewardMessage }>('POST', `/scenarios/${scenarioId}/awards`, { user_id: Number(userId), action_id: actionId }).catch(() => null);
    return data?.progress ?? null;
  }

  async look(userId: string): Promise<string> {
    const data = await this.call<{ look: string }>('GET', `/users/${encodeURIComponent(userId)}/look`).catch(() => null);
    return data?.look ?? '';
  }
}

import type { Id, Scenario, Session } from '@qbl/shared';
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

  async loadSession(scenarioId: Id, userId: string): Promise<Session | null> {
    const data = await this.call<{ session: Session | null }>('GET', `/scenarios/${scenarioId}/sessions/${encodeURIComponent(userId)}`);
    return data?.session ?? null;
  }

  async saveSession(scenarioId: Id, userId: string, session: Session): Promise<void> {
    await this.call('PUT', `/scenarios/${scenarioId}/sessions/${encodeURIComponent(userId)}`, { session });
  }

  async loadInstance(scenarioId: Id, group: string): Promise<InstanceData | null> {
    const data = await this.call<{ instance: InstanceData | null }>('GET', `/scenarios/${scenarioId}/instances/${encodeURIComponent(group)}`);
    return data?.instance ?? null;
  }

  async saveInstance(scenarioId: Id, group: string, data: InstanceData): Promise<void> {
    await this.call('PUT', `/scenarios/${scenarioId}/instances/${encodeURIComponent(group)}`, { instance: data });
  }
}

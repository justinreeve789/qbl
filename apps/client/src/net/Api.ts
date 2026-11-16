import type { Scenario, User } from '@qbl/shared';
import { config } from '../config';

const TOKEN_KEY = 'qbl.token';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The handful of QBL API calls the player needs. See docs/docs/api.md. */
export class Api {
  token: string | null = null;

  constructor() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  private remember(token: string | null) {
    this.token = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${config.apiUrl}/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
    }
    return (await res.json()) as T;
  }

  async guest(name: string): Promise<User> {
    const data = await this.call<{ token: string; user: User }>('POST', '/auth/guest', { name });
    this.remember(data.token);
    return data.user;
  }

  async login(email: string, password: string): Promise<User> {
    const data = await this.call<{ token: string; user: User }>('POST', '/auth/login', { email, password });
    this.remember(data.token);
    return data.user;
  }

  /** The signed-in user, or null if there is no valid token. */
  async me(): Promise<User | null> {
    if (!this.token) return null;
    try {
      return (await this.call<{ user: User }>('GET', '/me')).user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.remember(null);
        return null;
      }
      throw err;
    }
  }

  signOut() {
    this.remember(null);
  }

  /** The scenario JSON generated from an unpublished draft. Only its editors may fetch it. */
  async preview(scenarioId: number): Promise<Scenario> {
    return (await this.call<{ scenario: Scenario }>('GET', `/editor/scenarios/${scenarioId}/preview`)).scenario;
  }

  /** The scenario document, with this player's save data in `session`. */
  async play(shortname: string): Promise<Scenario> {
    return (await this.call<{ scenario: Scenario }>('GET', `/scenarios/${encodeURIComponent(shortname)}/play`)).scenario;
  }
}

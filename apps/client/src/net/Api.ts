import type { Progress, Scenario, ShopItem, User } from '@qbl/shared';
import { config } from '../config';

const TOKEN_KEY = 'qbl.token';

/** Why a Google sign-in came back without signing anyone in (`#signin=...` on the page it returns to). */
export const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  domain: 'That Google account is not from an organisation this site accepts.',
  unverified: 'Google has not verified that email address yet.',
  expired: 'That sign-in took too long. Please try again.',
  failed: 'Google sign-in did not work. Please try again.',
};

/** Read and clear a `#signin=problem` left by a failed Google sign-in. */
export function takeSignInProblem(): string | undefined {
  const match = /^#signin=([a-z]+)$/.exec(window.location.hash);
  if (!match) return undefined;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return SIGN_IN_PROBLEMS[match[1]!] ?? SIGN_IN_PROBLEMS.failed;
}

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

  /** Which ways of signing in the server offers. An older server, or one that is down, offers none of the optional ones. */
  async providers(): Promise<{ google: boolean }> {
    try {
      return await this.call<{ google: boolean }>('GET', '/auth/providers');
    } catch {
      return { google: false };
    }
  }

  /** Where to send the browser to sign in with Google. It comes back to `returnTo` with a token already stored. */
  googleUrl(returnTo: string): string {
    return `${config.apiUrl}/api/auth/google/redirect?return=${encodeURIComponent(returnTo)}`;
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

  /** Forget who is signed in. The server is told too, so the token stops working everywhere. */
  signOut() {
    if (this.token) void this.call('POST', '/auth/logout').catch(() => undefined);
    this.remember(null);
  }

  /** The scenario JSON generated from an unpublished draft. Only its editors may fetch it. */
  async preview(scenarioId: number): Promise<Scenario> {
    return (await this.call<{ scenario: Scenario }>('GET', `/editor/scenarios/${scenarioId}/preview`)).scenario;
  }

  /** The marketplace: what is for sale in a scenario, and the player's stars, XP and belongings. */
  async shop(scenarioKey: string): Promise<{ items: ShopItem[]; progress: Progress | null }> {
    return this.call('GET', `/shop?scenario=${encodeURIComponent(scenarioKey)}`);
  }

  async buy(itemId: number, scenarioKey: string): Promise<Progress> {
    return (await this.call<{ progress: Progress }>('POST', `/shop/${itemId}/buy`, { scenario: scenarioKey })).progress;
  }

  async equip(itemId: number, equipped: boolean): Promise<Progress> {
    return (await this.call<{ progress: Progress }>('POST', `/shop/${itemId}/equip`, { equipped })).progress;
  }

  /** The scenario document, with this player's save data in `session`. */
  async play(shortname: string): Promise<Scenario> {
    return (await this.call<{ scenario: Scenario }>('GET', `/scenarios/${encodeURIComponent(shortname)}/play`)).scenario;
  }
}

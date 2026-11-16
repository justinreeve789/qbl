import type { Scenario } from '@qbl/shared';

/** A row of one of the scenario tables, as the editor API returns it. */
export interface Row {
  id: number;
  [column: string]: unknown;
}

export type Table = 'shop_items' | 'media' | 'variables' | 'items' | 'characters' | 'scenes' | 'events' | 'actions' | 'conditions' | 'labels';

export interface Bundle extends Record<Table, Row[]> {
  scenario: Row;
}

export interface User {
  id: number;
  name: string;
  role: string;
}

export interface ScenarioSummary {
  id: number;
  code: string;
  title: string;
  subtitle: string | null;
  user_id: number | null;
  published_at: string | null;
  updated_at: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// The game and the editor are served from the same origin, so they share one sign-in.
const TOKEN_KEY = 'qbl.token';

/** The editor's calls to the backend. The routes are documented in App\Qbl\EditorApi. */
export class Api {
  token: string | null = localStorage.getItem(TOKEN_KEY);
  /** Called when a request starts and when all requests have finished, for the "Saving…" indicator. */
  onBusy: (busy: boolean) => void = () => {};
  private pending = 0;

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const form = body instanceof FormData;
    this.onBusy(++this.pending > 0);
    try {
      const res = await fetch(`/api${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body && !form ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: form ? body : body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 204) return undefined as T;
      const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
      if (!res.ok) throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
      return data as T;
    } finally {
      this.onBusy(--this.pending > 0);
    }
  }

  /** Whether the server offers Google sign-in. */
  async providers(): Promise<{ google: boolean }> {
    try {
      const res = await fetch('/api/auth/providers', { headers: { Accept: 'application/json' } });
      return res.ok ? ((await res.json()) as { google: boolean }) : { google: false };
    } catch {
      return { google: false };
    }
  }

  async login(email: string, password: string): Promise<User> {
    const data = await this.call<{ token: string; user: User }>('POST', '/auth/login', { email, password });
    this.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    return data.user;
  }

  async me(): Promise<User | null> {
    if (!this.token) return null;
    try {
      return (await this.call<{ user: User }>('GET', '/me')).user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  signOut() {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  list = async () => (await this.call<{ scenarios: ScenarioSummary[] }>('GET', '/editor/scenarios')).scenarios;
  create = async (title: string) => (await this.call<{ scenario: Row }>('POST', '/editor/scenarios', { title })).scenario;
  bundle = (id: number) => this.call<Bundle>('GET', `/editor/scenarios/${id}`);
  patchScenario = async (id: number, attrs: object) => (await this.call<{ scenario: Row }>('PATCH', `/editor/scenarios/${id}`, attrs)).scenario;
  deleteScenario = (id: number) => this.call<void>('DELETE', `/editor/scenarios/${id}`);
  createRow = async (id: number, table: Table, attrs: object) => (await this.call<{ row: Row }>('POST', `/editor/scenarios/${id}/rows/${table}`, attrs)).row;
  updateRow = async (id: number, table: Table, rowId: number, attrs: object) =>
    (await this.call<{ row: Row }>('PATCH', `/editor/scenarios/${id}/rows/${table}/${rowId}`, attrs)).row;
  deleteRow = (id: number, table: Table, rowId: number) => this.call<void>('DELETE', `/editor/scenarios/${id}/rows/${table}/${rowId}`);
  preview = async (id: number) => (await this.call<{ scenario: Scenario }>('GET', `/editor/scenarios/${id}/preview`)).scenario;
  publish = async (id: number) => (await this.call<{ scenario: Row }>('POST', `/editor/scenarios/${id}/publish`)).scenario;

  async upload(id: number, file: File): Promise<Row> {
    const form = new FormData();
    form.append('file', file);
    return (await this.call<{ row: Row }>('POST', `/editor/scenarios/${id}/media/upload`, form)).row;
  }
}

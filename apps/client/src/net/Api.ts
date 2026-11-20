import type { PlayerProfile, Progress, Scenario, ShopItem, User } from '@qbl/shared';
import { config } from '../config';
import type { AvatarChoice, Mission } from '../home';
import type { TeachAssignment, TeachScenario, TeacherDesk } from '../teach';

const TOKEN_KEY = 'qbl.token';

/** Why a Google sign-in came back without signing anyone in (`#signin=...` on the page it returns to). */
export const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  domain: 'That Google account is not from an organisation this site accepts.',
  unverified: 'Google has not verified that email address yet.',
  expired: 'That sign-in took too long. Please try again.',
  failed: 'Google sign-in did not work. Please try again.',
  // Signing in through a school's or district's own system (SAML, Clever, a claimed Google domain).
  sso: 'Signing in through your school did not work. Please try again, or ask your teacher.',
  noaccount: 'Your school has not added you to QuestLab yet. Ask your teacher.',
  inactive: 'Your school has turned this account off. Ask your teacher about it.',
};

/** The plans page's view of plans and the account's own (App\Qbl\Billing\BillingApi). */
export interface PlanCard {
  key: string;
  name: string;
  price: number;
  summary: string;
  curricular: boolean;
  generator: boolean;
  students: number | null;
  monthly_credits: number;
  credit_carryover: number;
  trial_credits?: number;
}
export interface Billing {
  enabled: boolean;
  payments: boolean;
  trial_days: number;
  plans: PlanCard[];
  costs: { generation: number };
  /** A number to call about a school or district quote, when the site gives one. */
  sales_phone?: string | null;
  entitlements?: { plan: string; plan_name: string; source: string; trial: boolean; curricular: boolean; generator: boolean; students: number | null; organization: { name: string } | null };
  subscription?: { plan: string | null; status: string | null; trial_ends_at: string | null; current_period_end: string | null; cancel_at_period_end: boolean; trial_used: boolean; manageable: boolean } | null;
  credits?: { balance: number; monthly: number } | null;
}
export interface QuoteRequest { name: string; email: string; organization: string; role?: string; phone?: string; students?: number; message?: string }

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

/** The handful of QBL API calls the player needs. See docs/src/content/docs/developers/api.md. */
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
    return (res.status === 204 ? null : await res.json()) as T;
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

  /** Create a (student's) account with a password, and sign in with it. */
  async register(account: { name: string; email: string; password: string; password_confirmation: string }): Promise<User> {
    const data = await this.call<{ token: string; user: User }>('POST', '/auth/register', account);
    this.remember(data.token);
    return data.user;
  }

  /** Which ways of signing in the server offers. An older server, or one that is down, offers none of the optional ones. */
  async providers(): Promise<{ google: boolean; register: boolean }> {
    try {
      const p = await this.call<{ google?: boolean; register?: boolean }>('GET', '/auth/providers');
      return { google: !!p.google, register: !!p.register };
    } catch {
      return { google: false, register: false };
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

  /** Change the name over the player's character (the profile page). */
  async rename(name: string): Promise<User> {
    return (await this.call<{ user: User }>('PATCH', '/me', { name })).user;
  }

  /** Change the password, given the current one. The account's other sign-ins end; this one stays. */
  async changePassword(change: { current_password: string; password: string; password_confirmation: string }): Promise<{ signed_out_elsewhere?: number }> {
    return this.call('PUT', '/me/password', change);
  }

  /** "Forgot your password?": email a link for choosing a new one. Resolves to what to tell the person. */
  async forgotPassword(email: string): Promise<string> {
    return (await this.call<{ message?: string }>('POST', '/auth/forgot-password', { email })).message ?? 'Check your email for a link.';
  }

  /** Choose a new password with the emailed link's token, and sign in with it. */
  async resetPassword(reset: { token: string; email: string; password: string; password_confirmation: string }): Promise<User> {
    const data = await this.call<{ token: string; user: User }>('POST', '/auth/reset-password', reset);
    this.remember(data.token);
    return data.user;
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

  /** The scenario document, with this player's save data for that instance (group) of it in `session`. */
  async play(shortname: string, group = 'public', party?: string | null): Promise<Scenario> {
    const query = group === 'public' && !party ? '' : `?group=${encodeURIComponent(group)}${party ? `&party=${encodeURIComponent(party)}` : ''}`;
    return (await this.call<{ scenario: Scenario }>('GET', `/scenarios/${encodeURIComponent(shortname)}/play${query}`)).scenario;
  }

  /** What others may see of a player: avatar, look, rank, stars, XP and badges. Null where there are no profiles, or none for them. */
  async profile(userId: string): Promise<PlayerProfile | null> {
    if (!/^\d+$/.test(userId)) return null;
    try {
      return (await this.call<{ profile: PlayerProfile }>('GET', `/players/${userId}/profile`)).profile;
    } catch {
      return null;
    }
  }

  /**
   * For a teacher: the teams they can follow in the game whose instance is `group` (the teams of
   * that assignment, and "No team" when some students are in none). Empty when the assignment has
   * no teams, the game is not one of their assignments, or there is no API to ask.
   */
  async teamsToFollow(group: string): Promise<Array<{ group: string; name: string }>> {
    type Listed = { group: string; students: Array<{ team_id: number | null }>; teams: Array<{ name: string; group?: string }> };
    try {
      const list = (await this.call<{ assignments: Listed[] }>('GET', '/teach/assignments')).assignments;
      const a = list.find((x) => x.group === group || x.teams.some((t) => t.group === group));
      if (!a || !a.teams.length) return [];
      const out = a.teams.filter((t) => t.group).map((t) => ({ group: t.group!, name: t.name }));
      if (a.students.some((s) => s.team_id == null)) out.push({ group: a.group, name: 'No team' });
      return out;
    } catch {
      return [];
    }
  }

  /**
   * What a teacher's missions page shows: their assignments, the scenarios they can edit and how
   * many students they have. Each part is null when it cannot be read, so one failure does not
   * hide the rest.
   */
  async teacherDesk(): Promise<TeacherDesk> {
    const read = <T,>(path: string, pick: (body: any) => T): Promise<T | null> =>
      this.call<unknown>('GET', path).then(pick, () => null);
    const [assignments, scenarios, students] = await Promise.all([
      read('/teach/assignments', (b) => b.assignments as TeachAssignment[]),
      read('/editor/scenarios', (b) => b.scenarios as TeachScenario[]),
      read('/teach/students', (b) => (Array.isArray(b.students) ? b.students.length : null) as number | null),
    ]);
    return { assignments, scenarios, students };
  }

  /** What the player can play: public missions and those assigned to them. Null where the backend has no such list. */
  // Plans and billing.
  billing = () => this.call<Billing>('GET', '/billing');
  checkout = async (plan: string, promotionCode?: string) => (await this.call<{ url: string }>('POST', '/billing/checkout', { plan, ...(promotionCode ? { promotion_code: promotionCode } : {}) })).url;
  changePlan = (plan: string) => this.call<Billing>('POST', '/billing/change', { plan });
  billingPortal = async () => (await this.call<{ url: string }>('POST', '/billing/portal')).url;
  promotion = async (code: string) => (await this.call<{ promotion: { code: string; description: string } }>('POST', '/billing/promotion', { code })).promotion;
  quote = async (request: QuoteRequest) => (await this.call<{ message: string }>('POST', '/billing/quote', request)).message;

  async missions(): Promise<Mission[] | null> {
    try {
      return (await this.call<{ missions: Mission[] }>('GET', '/missions')).missions;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
      throw err;
    }
  }

  /** The platform's avatars and which one the player has chosen. Empty where there are none. */
  async avatars(): Promise<{ avatars: AvatarChoice[]; avatar_media_id: number | null }> {
    try {
      return await this.call('GET', '/avatars');
    } catch {
      return { avatars: [], avatar_media_id: null };
    }
  }

  /** Remember the player's avatar on their account, so it is theirs in every scenario. */
  async setAvatar(mediaId: number): Promise<void> {
    await this.call('PUT', '/me/avatar', { avatar_media_id: mediaId });
  }
}

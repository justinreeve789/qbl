import type { Scenario } from '@qbl/shared';

/** A row of one of the scenario tables, as the editor API returns it. */
export interface Row {
  id: number;
  [column: string]: unknown;
}

/** One file of a library asset: its sheet, close-up, picture, sound or card preview. */
export interface LibraryFile {
  id: number;
  role: string;
  type: 'image' | 'audio' | 'video';
  url: string;
  width: number | null;
  height: number | null;
  bytes?: number | null;
  params: { sheet?: { columns: number; rows: number; count?: number }; animations?: { name: string; frames: number[]; duration?: number; repeat?: boolean }[] };
}

/** A ready-made asset of the library (see App\Qbl\Library\AssetLibrary). */
export interface LibraryAsset {
  id: number;
  slug: string;
  kind: 'character' | 'vehicle' | 'item' | 'picture' | 'sound';
  name: string;
  category: string | null;
  description: string | null;
  tags: string[];
  style: string | null;
  definition: {
    file?: string;
    animations?: Record<string, { file: string; frames?: number[]; duration?: number; repeat?: boolean }>;
    item?: { settings?: Record<string, unknown> } & Record<string, unknown>;
  };
  credit: { title?: string; author?: string; license?: string; url?: string; note?: string } | null;
  files: LibraryFile[];
  file_urls: Record<string, string>;
}

/** An asset as content admins see it in the library's admin screen. */
export interface ManagedAsset extends LibraryAsset {
  organization_id: number | null;
  source: 'pack' | 'upload' | 'scenario' | string;
  active: boolean;
  sequence: number;
  /** In how many scenarios it is used. */
  used_in?: number;
  updated_at?: string;
}

/** What the admin screen can change on an asset. */
export type AssetChanges = Partial<Pick<ManagedAsset, 'slug' | 'kind' | 'name' | 'category' | 'description' | 'tags' | 'style' | 'definition' | 'credit' | 'organization_id' | 'active' | 'sequence'>>;

export interface ContentAdmin {
  id: number;
  name: string;
  email: string;
}

export interface LibraryList {
  assets: LibraryAsset[];
  categories: { name: string; count: number }[];
  kinds: string[];
}

/** What adding an asset made: the row (a character or an item), and the media it uses (`copied`: those new). */
export interface LibraryAdded {
  asset: LibraryAsset;
  created: { table: Table; row: Row } | null;
  media: Row[];
  copied: number[];
}

export type Table = 'shop_items' | 'media' | 'variables' | 'items' | 'characters' | 'scenes' | 'events' | 'actions' | 'conditions' | 'labels';

export interface Bundle extends Record<Table, Row[]> {
  scenario: Row;
}

export interface User {
  id: number;
  name: string;
  role: string;
  /** The account's address, as the API tells an account about itself. Guests have none. */
  email?: string;
  /** What the profile page may change (see packages/shared/browser/profile.ts). */
  has_password?: boolean;
  uses_google?: boolean;
  name_locked?: boolean;
  /** The organizations this person runs in the district admin panel (QBL administrators run them all). */
  admin_of?: Array<{ id: number; name: string }>;
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

/** A voice characters' lines can be recorded in (resources/speech/voices.json on the server). */
export interface VoiceChoice {
  key: string;
  name: string;
  gender: 'female' | 'male' | 'neutral';
  age: 'child' | 'young' | 'adult' | 'elder';
  lang: string;
  accent: string | null;
  traits: string[];
  description: string;
  /** "Heart: woman, American". */
  label: string;
}

export interface VoiceStatus {
  /** The service that records ("kokoro"), or null when recording is switched off. */
  engine: string | null;
  voices: VoiceChoice[];
  /** The default narrator's voice for the scenario's language: who narrates when the scenario chooses no one. */
  narrator?: string | null;
  /** Lines said by characters with a voice: how many have an up-to-date recording. */
  lines: { total: number; recorded: number; to_record: number } | null;
}

/** What one call to record voices did (App\Qbl\Speech\ScenarioVoicer::record). */
export interface VoiceRecording {
  lines: number;
  recorded: number;
  kept: number;
  removed: number;
  remaining: number;
  /** `line`: the line of a conversation, by its place in the action's lines. */
  skipped: Array<{ action_id: number; line?: number | null; why: string }>;
}

export interface Student {
  id: number;
  name: string;
  email: string;
}

/** A published scenario a teacher can assign. */
export interface MissionSummary {
  id: number;
  code: string;
  title: string;
  subtitle?: string | null;
  visibility: 'public' | 'private';
  /** free: anyone may play it. curricular: it comes with a teacher plan. */
  tier?: 'free' | 'curricular';
  /** The teacher's plan does not include it (a curricular mission without a plan). */
  locked?: boolean;
}

export interface Team {
  id?: number;
  name: string;
  /** The team's instance of the scenario, as the address players open carries it (?group=). */
  group?: string;
  student_ids: number[];
}

export interface Assignment {
  id: number;
  scenario: MissionSummary | null;
  /** UTC, "2026-12-01 15:00:00", or null for no due date. */
  due_at: string | null;
  note: string | null;
  group: string;
  students: Array<Student & { team_id: number | null }>;
  teams: Team[];
}

/** How one student did in a mission, as the report gives it (App\Qbl\ActivityStore::report). */
export interface StudentReport {
  id: number;
  name: string;
  group: string;
  team: string | null;
  started: boolean;
  finished: boolean;
  /** Seconds. */
  time_spent: number;
  visits: number;
  first_seen: string | null;
  last_seen: string | null;
  scene: string | null;
  scenes_visited: string[];
  objectives_done: number;
  objectives_total: number;
  objectives: Array<{ id: string | number; complete: boolean; listed: boolean }>;
  hotspots_used: number;
  answers: number;
  questions: Array<{ action_id: string; attempts: number; first_answer: string | null; last_answer: string | null }>;
  words_learned: number;
  words_total: number;
  stars_earned: number;
  xp_earned: number;
  badges: string[];
  messages: number;
  learning: Array<{ id: string | number; evidence: Array<{ interaction: string | null; type: string | null; values: Record<string, string | number> }> }>;
}
export interface Report {
  summary: {
    students: number; started: number; finished: number; average_time_spent: number; average_objectives_done: number; objectives_total: number;
    questions_answered: number; answered_in_one_try: number; average_words_learned: number; words_total: number;
  };
  objectives: Array<{ id: string | number; text: string; optional: boolean; completed_by: number }>;
  learning_objectives: Array<{ id: string | number; text: string; standards: string[] }>;
  students: StudentReport[];
}
export interface ActivityLine { user_id: number; name?: string; group: string; scene_id?: number; type: string; ref?: string; label?: string; value?: number; at: string }
export interface MessageLine { user_id: number; name?: string; group: string; scene_id?: number; kind: 'chat' | 'emote' | 'private'; to_user_id?: number; to_name?: string; text: string; at: string }

export interface AssignmentDraft {
  student_ids: number[];
  due_at: string | null;
  note: string | null;
  teams: Team[];
}

// ------------------------------------------------------------------ plans and credits

export interface PlanInfo {
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
export interface Entitlements {
  plan: string;
  plan_name: string;
  source: 'none' | 'subscription' | 'organization' | 'admin' | 'billing_off';
  curricular: boolean;
  generator: boolean;
  students: number | null;
  students_used?: number;
  credits_enforced: boolean;
  monthly_credits: number;
  credit_carryover: number;
  trial: boolean;
  organization: { id: number; name: string } | null;
}
export interface CreditSummary { enforced: boolean; balance: number; monthly: number; carryover: number; trial: boolean }
export interface BillingStatus {
  enabled: boolean;
  payments: boolean;
  trial_days: number;
  plans: PlanInfo[];
  costs: { generation: number };
  entitlements: Entitlements;
  subscription: { plan: string | null; status: string | null; trial_ends_at: string | null; current_period_end: string | null; cancel_at_period_end: boolean; trial_used: boolean; manageable: boolean } | null;
  credits: CreditSummary | null;
}
export interface LedgerLine { delta: number; balance_after: number; reason: 'grant' | 'expire' | 'spend' | 'refund' | 'adjust'; ref: string | null; note: string | null; at: string }

/** How far a generation has got (App\Qbl\Generation\GenerationProgress). Times are UTC ISO. */
export interface GenerationProgress {
  stage: string;
  stages: string[];
  percent: number;
  detail: string | null;
  /** Pictures drawn (drawing) or lines recorded (voicing), of `total`. */
  done: number | null;
  total: number | null;
  started_at: string | null;
  stage_started_at: string | null;
  updated_at?: string | null;
}
export interface GenerationOptions {
  grade?: string; subject?: string; min_players?: number; max_players?: number; minutes?: number; notes?: string;
  /** A mission students play, or a story they watch play out; absent: as the description reads. */
  format?: 'mission' | 'story';
}
export interface Generation {
  id: number;
  prompt: string;
  /** queued, aligning, designing, drawing, building, voicing, importing; then done, failed or cancelled. */
  status: string;
  busy: boolean;
  /** Asked to stop; the worker stops before its next picture. */
  cancelling: boolean;
  title: string | null;
  scenario_id: number | null;
  options: GenerationOptions;
  error: string | null;
  progress: GenerationProgress;
  created_at: string;
  updated_at: string;
  /** Administrators only: what it has spent on AI services, in US dollars. */
  usd?: number | null;
  /** In the administrators' list of everyone's. */
  user?: { name: string | null; email: string | null };
}
export interface GeneratorPlan { generator: boolean; plan_name: string; source: string; billing: boolean; credits: CreditSummary | null }

// ------------------------------------------------------------- district admin panel

export type IntegrationKind = 'saml' | 'clever' | 'google';
export interface Integration {
  kind: IntegrationKind;
  enabled: boolean;
  configured: boolean;
  config: Record<string, unknown>;
  /** Whether each secret is set (never the secret). */
  secrets: Record<string, boolean>;
  last_sync_at: string | null;
}
export interface SyncRun {
  id: number;
  kind: 'clever' | 'google' | 'upload';
  status: 'queued' | 'running' | 'done' | 'failed';
  summary: null | {
    schools: { created: number; updated: number };
    teachers: { created: number; updated: number; failed: number };
    students: { created: number; updated: number; failed: number };
    deactivated: number;
    enrollments: number;
    problems: string[];
    warnings: string[];
  };
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface ApiClientInfo { client_id: string; name: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }
export interface License { active?: boolean; plan_name?: string | null; curricular?: boolean; generator?: boolean; students?: number | null; monthly_credits?: number; credit_carryover?: number; expires_at?: string | null }
export interface OrgSummary { id: number; name: string; kind: string; integrations_enabled: boolean; teachers: number; students: number; license: License | null }
export interface OrgOverview {
  organization: { id: number; name: string; kind: string; external_id: string | null; data_retention_days: number | null; integrations_enabled: boolean; integrations_enabled_at: string | null; license: License | null; created_at: string };
  counts: { schools: number; teachers: number; students: number; inactive: number };
  admins: Array<{ id: number; name: string; email: string }>;
  platform_admin: boolean;
  integrations?: Integration[];
  addresses?: Record<string, string | boolean | string[]>;
  clients?: ApiClientInfo[];
  scopes?: Record<string, string>;
  runs?: SyncRun[];
  roster_columns?: string[];
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

  /** Wait before sending a change. It counts as saving, so "Saved" is not shown while a change is still to be sent. */
  async pause(ms: number): Promise<void> {
    this.onBusy(++this.pending > 0);
    try {
      await new Promise((done) => setTimeout(done, ms));
    } finally {
      this.onBusy(--this.pending > 0);
    }
  }

  /** `quiet`: not shown as saving (for asking how something is going). */
  private async call<T>(method: string, path: string, body?: unknown, quiet = false): Promise<T> {
    const form = body instanceof FormData;
    if (!quiet) this.onBusy(++this.pending > 0);
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
      if (!quiet) this.onBusy(--this.pending > 0);
    }
  }

  /** Whether the server offers Google sign-in, and lets people create their own account. */
  async providers(): Promise<{ google: boolean; register: boolean }> {
    try {
      const res = await fetch('/api/auth/providers', { headers: { Accept: 'application/json' } });
      const p = res.ok ? ((await res.json()) as { google?: boolean; register?: boolean }) : {};
      return { google: !!p.google, register: !!p.register };
    } catch {
      return { google: false, register: false };
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

  /** The profile page: the name over the person's character in missions. */
  async rename(name: string): Promise<User> {
    return (await this.call<{ user: User }>('PATCH', '/me', { name })).user;
  }

  /** Change the password, given the current one. Other sign-ins of the account end; this one stays. */
  changePassword = (change: { current_password: string; password: string; password_confirmation: string }) =>
    this.call<{ signed_out_elsewhere?: number }>('PUT', '/me/password', change);

  /** Email a link for choosing a new password. Resolves to what to tell the person. */
  async forgotPassword(email: string): Promise<string> {
    return (await this.call<{ message?: string }>('POST', '/auth/forgot-password', { email })).message ?? 'Check your email for a link.';
  }

  /** Forget who is signed in, here and on the server, so the token stops working everywhere. */
  signOut() {
    if (this.token) void fetch('/api/auth/logout', { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` } }).catch(() => undefined);
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  list = async () => (await this.call<{ scenarios: ScenarioSummary[] }>('GET', '/editor/scenarios')).scenarios;
  /** `template: 'starship'` starts the scenario as a copy of the starship hub instead of one empty scene. */
  create = async (title: string, template?: 'starship') => (await this.call<{ scenario: Row }>('POST', '/editor/scenarios', { title, ...(template ? { template } : {}) })).scenario;
  /** A copy of a scenario (one's own, or anyone's public published one) as a new draft of one's own. */
  duplicate = async (id: number, title?: string) => (await this.call<{ scenario: Row }>('POST', `/editor/scenarios/${id}/duplicate`, title ? { title } : {})).scenario;

  /** A new scenario from a ZIP made by "Export", or put together by hand in the same shape. */
  async importZip(file: File): Promise<Row> {
    const form = new FormData();
    form.append('file', file);
    return (await this.call<{ scenario: Row }>('POST', '/editor/scenarios/import', form)).scenario;
  }

  /** Download the whole scenario as a ZIP file: its JSON and the files uploaded for it. */
  async exportZip(id: number): Promise<void> {
    this.onBusy(++this.pending > 0);
    try {
      const res = await fetch(`/api/editor/scenarios/${id}/export`, { headers: { Accept: 'application/zip, application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
      }
      const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `scenario-${id}.zip`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(await res.blob());
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } finally {
      this.onBusy(--this.pending > 0);
    }
  }
  bundle = (id: number) => this.call<Bundle>('GET', `/editor/scenarios/${id}`);
  patchScenario = async (id: number, attrs: object) => (await this.call<{ scenario: Row }>('PATCH', `/editor/scenarios/${id}`, attrs)).scenario;
  deleteScenario = (id: number) => this.call<void>('DELETE', `/editor/scenarios/${id}`);
  createRow = async (id: number, table: Table, attrs: object) => (await this.call<{ row: Row }>('POST', `/editor/scenarios/${id}/rows/${table}`, attrs)).row;
  updateRow = async (id: number, table: Table, rowId: number, attrs: object) =>
    (await this.call<{ row: Row }>('PATCH', `/editor/scenarios/${id}/rows/${table}/${rowId}`, attrs)).row;
  deleteRow = (id: number, table: Table, rowId: number) => this.call<void>('DELETE', `/editor/scenarios/${id}/rows/${table}/${rowId}`);
  preview = async (id: number) => (await this.call<{ scenario: Scenario }>('GET', `/editor/scenarios/${id}/preview`)).scenario;
  /** Give the scenario a new player code; the old one stops working. Refused with a message when the code is not allowed or is taken. */
  changeCode = async (id: number, code: string) => (await this.call<{ scenario: Row }>('PUT', `/editor/scenarios/${id}/code`, { code })).scenario;
  publish = async (id: number) => (await this.call<{ scenario: Row }>('POST', `/editor/scenarios/${id}/publish`)).scenario;

  // Classes: a teacher's students and the missions given to them. The routes are documented in App\Qbl\ClassApi.
  students = async () => (await this.call<{ students: Student[] }>('GET', '/teach/students')).students;
  addStudent = async (email: string) => (await this.call<{ student: Student }>('POST', '/teach/students', { email })).student;
  removeStudent = (id: number) => this.call<void>('DELETE', `/teach/students/${id}`);
  assignable = async () => (await this.call<{ scenarios: MissionSummary[] }>('GET', '/teach/scenarios')).scenarios;
  assignments = async () => (await this.call<{ assignments: Assignment[] }>('GET', '/teach/assignments')).assignments;
  assign = async (attrs: AssignmentDraft & { scenario_id: number }) => (await this.call<{ assignment: Assignment }>('POST', '/teach/assignments', attrs)).assignment;
  updateAssignment = async (id: number, attrs: Partial<AssignmentDraft>) => (await this.call<{ assignment: Assignment }>('PUT', `/teach/assignments/${id}`, attrs)).assignment;
  unassign = (id: number) => this.call<void>('DELETE', `/teach/assignments/${id}`);
  // Reports: how students did, what they did, and what they wrote to each other.
  report = async (id: number) => (await this.call<{ report: Report }>('GET', `/teach/assignments/${id}/report`)).report;
  activity = async (id: number, studentId?: number) => (await this.call<{ activity: ActivityLine[] }>('GET', `/teach/assignments/${id}/activity${studentId != null ? `/${studentId}` : ''}`)).activity;
  messageLog = async (id: number) => (await this.call<{ messages: MessageLine[] }>('GET', `/teach/assignments/${id}/messages`)).messages;

  // Plans, billing and credits (App\Qbl\Billing\BillingApi).
  billing = () => this.call<BillingStatus>('GET', '/billing');
  credits = () => this.call<{ credits: CreditSummary; ledger: LedgerLine[] }>('GET', '/billing/credits');
  billingPortal = async () => (await this.call<{ url: string }>('POST', '/billing/portal')).url;
  changePlan = (plan: string) => this.call<BillingStatus>('POST', '/billing/change', { plan });

  // The AI mission generator (App\Qbl\Generation\GenerationApi).
  // Asked every few seconds while one is being made: quietly, so the header does not flash "Saving…".
  generations = () => this.call<{ generations: Generation[]; cost: number; plan: GeneratorPlan; now: string }>('GET', '/editor/generations', undefined, true);
  generation = (id: number) => this.call<{ generation: Generation; now: string }>('GET', `/editor/generations/${id}`, undefined, true);
  activeGeneration = () => this.call<{ generation: Generation | null; now: string }>('GET', '/editor/generations/active', undefined, true);
  everyonesGenerations = () => this.call<{ generations: Generation[]; now: string }>('GET', '/editor/generations/all', undefined, true);
  generate = (form: { prompt: string } & GenerationOptions) => this.call<{ generation: Generation; credits: CreditSummary | null; now: string }>('POST', '/editor/generations', form);
  cancelGeneration = (id: number) => this.call<{ generation: Generation; credits: CreditSummary | null; now: string }>('POST', `/editor/generations/${id}/cancel`);

  // The district admin panel (App\Qbl\District\DistrictApi).
  orgs = () => this.call<{ organizations: OrgSummary[]; platform_admin: boolean }>('GET', '/district/orgs');
  createOrg = async (name: string, kind: string) => (await this.call<{ organization: OrgSummary }>('POST', '/district/orgs', { name, kind })).organization;
  org = (id: number) => this.call<OrgOverview>('GET', `/district/orgs/${id}`);
  updateOrg = (id: number, attrs: Record<string, unknown>) => this.call<OrgOverview>('PATCH', `/district/orgs/${id}`, attrs);
  addOrgAdmin = (id: number, email: string) => this.call<{ admin: { id: number; name: string; email: string }; warning?: string }>('POST', `/district/orgs/${id}/admins`, { email });
  removeOrgAdmin = (id: number, userId: number) => this.call<void>('DELETE', `/district/orgs/${id}/admins/${userId}`);
  saveIntegration = async (id: number, kind: IntegrationKind, body: { enabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string>; idp_metadata_xml?: string }) =>
    (await this.call<{ integration: Integration }>('PUT', `/district/orgs/${id}/integrations/${kind}`, body)).integration;
  removeIntegration = (id: number, kind: IntegrationKind) => this.call<void>('DELETE', `/district/orgs/${id}/integrations/${kind}`);
  testIntegration = async (id: number, kind: IntegrationKind) => (await this.call<{ check: { ok: boolean; message: string } }>('POST', `/district/orgs/${id}/integrations/${kind}/test`)).check;
  syncIntegration = async (id: number, kind: IntegrationKind) => (await this.call<{ run: SyncRun }>('POST', `/district/orgs/${id}/integrations/${kind}/sync`)).run;
  syncRuns = async (id: number) => (await this.call<{ runs: SyncRun[] }>('GET', `/district/orgs/${id}/runs`)).runs;
  async uploadRoster(id: number, file: File): Promise<SyncRun> {
    const form = new FormData();
    form.append('file', file);
    return (await this.call<{ run: SyncRun }>('POST', `/district/orgs/${id}/roster`, form)).run;
  }
  createClient = async (id: number, name: string, scopes: string[]) => (await this.call<{ client: { client_id: string; client_secret: string } }>('POST', `/district/orgs/${id}/clients`, { name, scopes })).client;
  rotateClient = async (id: number, clientId: string) => (await this.call<{ client: { client_id: string; client_secret: string } }>('POST', `/district/orgs/${id}/clients/${clientId}/rotate`)).client;
  revokeClient = (id: number, clientId: string) => this.call<void>('DELETE', `/district/orgs/${id}/clients/${clientId}`);

  // Characters' voices: recorded by the server's text-to-speech service, with word timings.
  voices = (id: number) => this.call<VoiceStatus>('GET', `/editor/scenarios/${id}/voices`);
  recordVoices = (id: number, attrs: { limit?: number; force?: boolean; character_id?: number } = {}) => this.call<VoiceRecording>('POST', `/editor/scenarios/${id}/voices/record`, attrs);
  assignVoices = async (id: number, all = false) => (await this.call<{ voices: Record<string, string> }>('POST', `/editor/scenarios/${id}/voices/assign`, { all })).voices;

  /** A voice saying a sample line, as an address an <audio> can play (revoke it when done). */
  async voiceSample(id: number, key: string): Promise<string> {
    this.onBusy(++this.pending > 0);
    try {
      const res = await fetch(`/api/editor/scenarios/${id}/voices/${encodeURIComponent(key)}/sample`, { headers: { Accept: 'audio/mpeg, application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
      }
      return URL.createObjectURL(await res.blob());
    } finally {
      this.onBusy(--this.pending > 0);
    }
  }

  /** The asset library: `kind` one or several (character, vehicle, item, picture, sound), comma-separated. */
  library = async (query: { kind?: string; category?: string; q?: string } = {}) => {
    const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
    return this.call<LibraryList>('GET', `/editor/library${search ? `?${search}` : ''}`, undefined, true);
  };
  // The library's admin screen (content admins and administrators).
  libraryAll = async () => (await this.call<{ assets: ManagedAsset[]; categories: { name: string; count: number }[] }>('GET', '/editor/library?inactive=1', undefined, true));
  createAsset = async (attrs: AssetChanges) => (await this.call<{ asset: ManagedAsset }>('POST', '/editor/library', attrs)).asset;
  updateAsset = async (id: number, attrs: AssetChanges) => (await this.call<{ asset: ManagedAsset }>('PATCH', `/editor/library/${id}`, attrs)).asset;
  deleteAsset = async (id: number) => this.call<void>('DELETE', `/editor/library/${id}`);
  async uploadAssetFile(id: number, role: string, file: File, params: object = {}): Promise<ManagedAsset> {
    const form = new FormData();
    form.append('file', file);
    form.append('role', role);
    form.append('params', JSON.stringify(params));
    return (await this.call<{ asset: ManagedAsset }>('POST', `/editor/library/${id}/files`, form)).asset;
  }
  updateAssetFile = async (id: number, role: string, params: object) => (await this.call<{ asset: ManagedAsset }>('PATCH', `/editor/library/${id}/files/${role}`, { params })).asset;
  removeAssetFile = async (id: number, role: string) => (await this.call<{ asset: ManagedAsset }>('DELETE', `/editor/library/${id}/files/${role}`)).asset;
  /** Keep a scenario's character, item or media row in the library. */
  captureAsset = async (attrs: { scenario_id: number; table: 'characters' | 'items' | 'media'; row_id: number; name?: string; slug?: string; category?: string; tags?: string; description?: string; active?: boolean }) =>
    (await this.call<{ asset: ManagedAsset }>('POST', '/editor/library/capture', attrs)).asset;
  contentAdmins = async () => (await this.call<{ managers: ContentAdmin[] }>('GET', '/editor/library/managers', undefined, true)).managers;
  addContentAdmin = async (email: string) => (await this.call<{ managers: ContentAdmin[] }>('POST', '/editor/library/managers', { email })).managers;
  removeContentAdmin = async (id: number) => (await this.call<{ managers: ContentAdmin[] }>('DELETE', `/editor/library/managers/${id}`)).managers;

  addLibraryAsset = async (asset: number | string, scenarioId: number, name?: string) =>
    this.call<LibraryAdded>('POST', `/editor/library/${asset}/add`, { scenario_id: scenarioId, ...(name ? { name } : {}) });

  async upload(id: number, file: File): Promise<Row> {
    const form = new FormData();
    form.append('file', file);
    return (await this.call<{ row: Row }>('POST', `/editor/scenarios/${id}/media/upload`, form)).row;
  }
}

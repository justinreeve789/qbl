import { ApiError, type Api, type Integration, type IntegrationKind, type License, type OrgOverview, type SyncRun } from '../api';
import { clear, h, help, toast } from '../dom';
import { day } from './plan';

const fail = (err: unknown, fallback: string) => toast(err instanceof ApiError || err instanceof Error ? err.message : fallback, 'error');

type FieldKind = 'text' | 'textarea' | 'bool' | 'list' | 'secret' | 'secret-area';
interface Field { key: string; label: string; kind: FieldKind; hint?: string; placeholder?: string; secret?: boolean }

/** What each integration asks for. Secrets are write-only: the panel only learns whether one is set. */
const FIELDS: Record<IntegrationKind, Field[]> = {
  saml: [
    { key: 'idp_entity_id', label: 'Identity provider entity ID', kind: 'text', placeholder: 'https://sts.windows.net/…/ or http://www.okta.com/…' },
    { key: 'idp_sso_url', label: 'Sign-in (SSO) URL', kind: 'text', placeholder: 'https://login.example.org/saml2/sso' },
    { key: 'idp_x509_cert', label: 'Signing certificate', kind: 'textarea', placeholder: '-----BEGIN CERTIFICATE-----', hint: 'The identity provider’s public signing certificate (PEM or base64). Answers not signed with it are refused.' },
    { key: 'id_attribute', label: 'Attribute with your id for each person (optional)', kind: 'text', placeholder: 'e.g. employeeNumber', hint: 'Set this to match people to accounts you upload with the API or a roster file (the same external_id). Empty: the NameID, which QBL keeps only as a one-way hash, never as an email address.' },
    { key: 'role_attribute', label: 'Attribute that says who is staff (optional)', kind: 'text', placeholder: 'e.g. eduPersonAffiliation', hint: 'Without it, everyone signing in is a student until a roster says otherwise.' },
    { key: 'teacher_values', label: 'Values that mean a teacher', kind: 'list', placeholder: 'faculty, staff, teacher' },
    { key: 'create_users', label: 'Make an account the first time someone signs in', kind: 'bool' },
    { key: 'allow_idp_initiated', label: 'Allow sign-ins started from your portal (IdP-initiated)', kind: 'bool' },
  ],
  clever: [
    { key: 'district_id', label: 'Clever district ID', kind: 'text', placeholder: '24 characters, from your Clever dashboard' },
    { key: 'district_token', label: 'District token (optional)', kind: 'secret', secret: true, hint: 'Only if QBL support asks for it: normally QBL gets your district’s token from Clever once you add QBL’s application.' },
    { key: 'create_users', label: 'Make an account the first time someone signs in (before a sync)', kind: 'bool' },
    { key: 'deactivate_missing', label: 'Deactivate people who are no longer in Clever', kind: 'bool', hint: 'They are signed out and cannot sign in; their work is kept.' },
  ],
  google: [
    { key: 'domains', label: 'Your Google Workspace domains', kind: 'list', placeholder: 'riverside.k12.ca.us, students.riverside.k12.ca.us', hint: 'Anyone signing in with Google from these domains gets your district’s account, made the first time if allowed.' },
    { key: 'admin_email', label: 'Workspace administrator to act as (for Classroom)', kind: 'text', placeholder: 'admin@riverside.k12.ca.us' },
    { key: 'service_account_json', label: 'Service account key (JSON, for Classroom)', kind: 'secret-area', secret: true, hint: 'A service account with domain-wide delegation for the two read-only Classroom scopes below. Paste the whole key file.' },
    { key: 'create_users', label: 'Make an account the first time someone signs in', kind: 'bool' },
    { key: 'deactivate_missing', label: 'Deactivate people who are no longer in any active course', kind: 'bool' },
  ],
};

const TITLES: Record<IntegrationKind, [string, string]> = {
  saml: ['🔑 SAML single sign-on', 'Sign-in through your identity provider: Microsoft Entra ID (Azure AD), ADFS, Okta, ClassLink, Google as a SAML IdP…'],
  clever: ['🟦 Clever', 'Instant Login from the Clever portal, and your schools, teachers, students and sections synced from Clever.'],
  google: ['🟩 Google', 'Google Workspace sign-in for your domains, and teachers, students and classes synced from Google Classroom.'],
};

/**
 * The district admin panel, for the people who run a school's or district's account (and for QBL
 * administrators, who see every organization and turn the advanced part on):
 *
 *   #/district          the organizations this person runs (one: straight to it)
 *   #/district/{id}     one organization: people, admins, integrations, API clients, roster files, sync history
 */
export function districtView(api: Api, orgId: number | null, go: (hash: string) => void): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const head = h('div', { class: 'page-head' }, h('div', null, h('h1', null, '🏛️ District'), h('p', { class: 'muted' }, 'Accounts and classes for a whole school or district.')));
  let timer = 0;
  window.addEventListener('hashchange', () => window.clearTimeout(timer), { once: true });

  // ------------------------------------------------------------ the list
  const list = async () => {
    try {
      const { organizations, platform_admin } = await api.orgs();
      if (organizations.length === 1 && !platform_admin) return go(`#/district/${organizations[0]!.id}`);
      const name = h('input', { type: 'text', required: true, maxlength: 120, placeholder: 'Riverside Unified School District', 'aria-label': 'Name' });
      const kind = h('select', { 'aria-label': 'Kind' }, ...['district', 'school', 'business', 'other'].map((k) => h('option', { value: k }, k)));
      const create = h('form', { class: 'inline-form', 'data-form': 'new-org' }, name, kind, h('button', { type: 'submit', class: 'primary' }, 'Add an organization'));
      create.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const org = await api.createOrg(name.value.trim(), kind.value);
          go(`#/district/${org.id}`);
        } catch (err) {
          fail(err, 'Could not add it.');
        }
      });
      clear(body,
        platform_admin ? h('div', { class: 'card' }, h('h2', null, 'New organization', help('Organizations are made here or with php artisan qbl:org create. Integrations stay off until you turn them on for a customer who asks.')), create) : null,
        organizations.length
          ? h('div', { class: 'grid' }, ...organizations.map((o) => h('a', { class: 'card org-card', href: `#/district/${o.id}`, 'data-org': o.id },
              h('div', { class: 'card-title' }, h('strong', null, o.name), h('span', { class: 'badge' }, o.integrations_enabled ? 'Integrations on' : 'Integrations off')),
              h('p', { class: 'muted' }, `${o.kind} · ${o.teachers} teachers · ${o.students} students${o.license ? ' · licensed' : ''}`))))
          : h('p', { class: 'empty' }, 'No organizations yet.'));
    } catch (err) {
      clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load.'));
    }
  };

  // ---------------------------------------------------------- one org
  const load = async () => {
    window.clearTimeout(timer);
    try {
      draw(await api.org(orgId!));
    } catch (err) {
      clear(body, h('p', { class: 'issue error' }, err instanceof Error ? err.message : 'Could not load the organization.'));
    }
  };

  const copyable = (label: string, value: string) => h('div', { class: 'copy-row' }, h('span', { class: 'field-label' }, label),
    h('code', null, value), h('button', { type: 'button', class: 'link', onclick: () => void navigator.clipboard?.writeText(value).then(() => toast('Copied.')) }, 'Copy'));

  const draw = (o: OrgOverview) => {
    const org = o.organization;
    clear(head, h('div', null, h('h1', null, `🏛️ ${org.name}`), h('p', { class: 'muted' }, `${org.kind}${org.external_id ? ` · ${org.external_id}` : ''} · `,
      h('a', { href: '#/district' }, 'All organizations'))));
    const busy = (o.runs ?? []).some((r) => r.status === 'queued' || r.status === 'running');
    if (busy) timer = window.setTimeout(() => void load(), 4000);
    clear(
      body,
      h('div', { class: 'tiles-row' },
        tile('Schools', o.counts.schools), tile('Teachers', o.counts.teachers), tile('Students', o.counts.students), tile('Deactivated', o.counts.inactive)),
      o.platform_admin ? qblCard(o) : null,
      h('div', { class: 'grid' }, adminsCard(o), settingsCard(o)),
      org.integrations_enabled
        ? h('div', null,
            h('h2', { class: 'section-title' }, 'Sign-in and rosters'),
            h('div', { class: 'grid integrations' }, ...(o.integrations ?? []).map((i) => integrationCard(o, i))),
            h('h2', { class: 'section-title' }, 'Custom uploads'),
            h('div', { class: 'grid' }, rosterCard(o), clientsCard(o)),
            runsCard(o.runs ?? []))
        : h('div', { class: 'card', 'data-card': 'off' },
            h('h2', null, 'Integrations are off'),
            h('p', null, 'Signing in through SAML, Clever or Google, syncing rosters, roster files and API clients are an advanced feature, turned on for each school or district that asks.'),
            h('p', { class: 'muted' }, o.platform_admin ? 'Turn them on above when the customer has asked.' : 'Contact QBL support to have them turned on.')),
    );
  };

  const tile = (label: string, n: number) => h('div', { class: 'stat' }, h('strong', null, String(n)), h('span', null, label));

  /** QBL's own controls: the integrations switch and the organization's license. */
  const qblCard = (o: OrgOverview) => {
    const lic: License = o.organization.license ?? {};
    const on = h('input', { type: 'checkbox', checked: o.organization.integrations_enabled, 'data-field': 'integrations_enabled' });
    on.addEventListener('change', async () => {
      if (!on.checked && !window.confirm('Turn integrations off? Every SAML, Clever and Google sign-in and sync for this organization stops.')) return void (on.checked = true);
      await api.updateOrg(o.organization.id, { integrations_enabled: on.checked }).then(() => load(), (err) => fail(err, 'Could not change it.'));
    });
    const f = {
      has: h('input', { type: 'checkbox', checked: !!o.organization.license }),
      name: h('input', { type: 'text', value: lic.plan_name ?? '', placeholder: `${o.organization.name} license` }),
      curricular: h('input', { type: 'checkbox', checked: lic.curricular ?? true }),
      generator: h('input', { type: 'checkbox', checked: lic.generator ?? false }),
      students: h('input', { type: 'number', min: 0, value: lic.students ?? '', placeholder: 'No limit' }),
      credits: h('input', { type: 'number', min: 0, value: lic.monthly_credits ?? 0 }),
      carryover: h('input', { type: 'number', min: 0, value: lic.credit_carryover ?? '' }),
      expires: h('input', { type: 'date', value: lic.expires_at ?? '' }),
    };
    const form = h('form', { class: 'license-form', 'data-form': 'license' },
      h('label', { class: 'check' }, f.has, ' This organization has a license (a plan agreed by quote)'),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Called'), f.name),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Students per teacher'), f.students),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ends'), f.expires)),
      h('div', { class: 'field-row' },
        h('label', { class: 'check' }, f.curricular, ' Curricular missions'),
        h('label', { class: 'check' }, f.generator, ' AI generator'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Credits a month (each teacher)'), f.credits),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Carry-over limit'), f.carryover)),
      h('div', { class: 'row-actions' }, h('button', { type: 'submit' }, 'Save the license')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const license = f.has.checked ? {
        plan_name: f.name.value.trim() || null, curricular: f.curricular.checked, generator: f.generator.checked,
        students: f.students.value === '' ? null : Number(f.students.value), monthly_credits: Number(f.credits.value) || 0,
        credit_carryover: f.carryover.value === '' ? undefined : Number(f.carryover.value), expires_at: f.expires.value || null,
      } : null;
      await api.updateOrg(o.organization.id, { license }).then(() => {
        toast('License saved.');
        return load();
      }, (err) => fail(err, 'Could not save the license.'));
    });
    return h('div', { class: 'card qbl-only', 'data-card': 'qbl' },
      h('h2', null, 'For QBL administrators', help('Only QBL administrators see this card. Integrations are off until a customer asks; the license is what its teachers get instead of buying their own plan.')),
      h('label', { class: 'check' }, on, ' Integrations are on for this organization'),
      form);
  };

  const adminsCard = (o: OrgOverview) => {
    const email = h('input', { type: 'email', required: true, placeholder: 'it-lead@district.org', 'aria-label': 'Email address' });
    const form = h('form', { class: 'inline-form', 'data-form': 'add-admin' }, email, h('button', { type: 'submit' }, 'Add'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const added = await api.addOrgAdmin(o.organization.id, email.value.trim());
        if (added.warning) toast(added.warning, 'error');
        await load();
      } catch (err) {
        fail(err, 'Could not add them.');
      }
    });
    return h('div', { class: 'card', 'data-card': 'admins' },
      h('h2', null, 'Admins', help('The people who run this organization’s account. They see this page; it does not change what else their account can do. They need an account first.')),
      h('ul', { class: 'people' }, ...o.admins.map((a) => h('li', { 'data-admin': a.id }, h('span', null, h('strong', null, a.name), ' ', h('span', { class: 'muted' }, a.email)),
        h('button', { type: 'button', class: 'link danger', onclick: async () => {
          if (!window.confirm(`Remove ${a.name} as an admin?`)) return;
          await api.removeOrgAdmin(o.organization.id, a.id).then(() => load(), (err) => fail(err, 'Could not remove them.'));
        } }, 'Remove')))),
      form);
  };

  const settingsCard = (o: OrgOverview) => {
    const days = h('input', { type: 'number', min: 30, max: 3650, value: o.organization.data_retention_days ?? '', placeholder: 'Keep until deleted' });
    const form = h('form', { class: 'inline-form', 'data-form': 'retention' }, days, h('button', { type: 'submit' }, 'Save'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await api.updateOrg(o.organization.id, { data_retention_days: days.value === '' ? null : Number(days.value) }).then(() => toast('Saved.'), (err) => fail(err, 'Could not save.'));
    });
    const lic = o.organization.license;
    return h('div', { class: 'card', 'data-card': 'settings' },
      h('h2', null, 'Privacy'),
      h('p', { class: 'muted' }, 'QBL keeps no names, email addresses or birth dates of the people your systems send: each has your id for them and a pseudonym to play under.'),
      h('span', { class: 'field-label' }, 'Delete activity and chat after this many days', help('Needs the nightly php artisan qbl:privacy-purge on the server. Saved games and rewards stay until a student is deleted.')),
      form,
      lic ? h('p', null, h('strong', null, lic.plan_name ?? 'License'), `: ${[lic.curricular !== false ? 'curricular missions' : '', lic.generator ? `AI generator (${lic.monthly_credits ?? 0} credits a month)` : '', lic.students == null ? 'any number of students' : `${lic.students} students per teacher`].filter(Boolean).join(', ')}${lic.expires_at ? `, until ${lic.expires_at}` : ''}.`) : null);
  };

  // ------------------------------------------------------- integrations
  const integrationCard = (o: OrgOverview, i: Integration) => {
    const id = o.organization.id;
    const a = o.addresses ?? {};
    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
    const fieldNode = (f: Field) => {
      const value = i.config[f.key];
      let input: HTMLInputElement | HTMLTextAreaElement;
      if (f.kind === 'bool') input = h('input', { type: 'checkbox', checked: Boolean(value) });
      else if (f.kind === 'textarea' || f.kind === 'secret-area') input = h('textarea', { rows: 3, placeholder: f.secret ? (i.secrets[f.key] ? 'Set. Paste a new one to replace it.' : 'Not set') : f.placeholder ?? '' }, f.secret ? '' : String(value ?? ''));
      else input = h('input', { type: f.kind === 'secret' ? 'password' : 'text', autocomplete: 'off', value: f.secret ? '' : Array.isArray(value) ? value.join(', ') : String(value ?? ''), placeholder: f.secret ? (i.secrets[f.key] ? 'Set. Type a new one to replace it.' : 'Not set') : f.placeholder ?? '' });
      input.dataset.field = f.key;
      inputs.set(f.key, input);
      return f.kind === 'bool'
        ? h('label', { class: 'check wide' }, input, ' ', f.label, help(f.hint))
        : h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, f.label, help(f.hint)), input);
    };
    const metadata = i.kind === 'saml' ? h('textarea', { rows: 3, placeholder: 'Or paste the identity provider’s metadata XML here, and the three fields above are filled in from it.', 'data-field': 'idp_metadata_xml' }) : null;
    const enabled = h('input', { type: 'checkbox', checked: i.enabled, 'data-field': 'enabled' });
    const collect = () => {
      const config: Record<string, unknown> = {};
      const secrets: Record<string, string> = {};
      for (const f of FIELDS[i.kind]) {
        const input = inputs.get(f.key)!;
        if (f.secret) {
          if (input.value.trim() !== '') secrets[f.key] = input.value.trim();
        } else if (f.kind === 'bool') config[f.key] = (input as HTMLInputElement).checked;
        else config[f.key] = input.value.trim();
      }
      return { config, secrets, enabled: enabled.checked, ...(metadata && metadata.value.trim() ? { idp_metadata_xml: metadata.value.trim() } : {}) };
    };
    const save = async () => {
      try {
        await api.saveIntegration(id, i.kind, collect());
        toast('Saved.');
        await load();
      } catch (err) {
        fail(err, 'Could not save.');
      }
    };
    const [title, about] = TITLES[i.kind];
    const share =
      i.kind === 'saml' ? [copyable('Entity ID (audience)', String(a.saml_entity_id)), copyable('ACS (reply) URL', String(a.saml_acs_url)), copyable('Metadata URL', String(a.saml_metadata_url)), copyable('Sign-in link for your portal', String(a.saml_login_url))]
      : i.kind === 'clever' ? [copyable('Sign-in link', String(a.clever_login_url)), a.clever_ready ? null : h('p', { class: 'issue error' }, 'Clever is not set up on this QBL site yet (its administrator sets CLEVER_CLIENT_ID).')]
      : [copyable('Classroom scopes for domain-wide delegation', (a.google_scopes as string[] | undefined)?.join(',') ?? ''), copyable('Students sign in at', String(a.google_login_url))];
    const removeSecret = (key: string) => i.secrets[key] ? h('button', { type: 'button', class: 'link danger', onclick: async () => {
      await api.saveIntegration(id, i.kind, { secrets: { [key]: '' } }).then(() => load(), (err) => fail(err, 'Could not remove it.'));
    } }, 'Remove the saved secret') : null;
    return h('div', { class: `card integration ${i.enabled ? 'on' : ''}`, 'data-integration': i.kind },
      h('div', { class: 'card-title' }, h('h2', null, title), h('span', { class: 'badge' }, i.enabled ? 'On' : i.configured ? 'Off' : 'Not set up')),
      h('p', { class: 'muted' }, about),
      h('details', { class: 'fold', open: !i.configured }, h('summary', null, 'What to give your system'), h('div', { class: 'fold-body' }, ...share)),
      ...FIELDS[i.kind].map(fieldNode),
      metadata,
      ...FIELDS[i.kind].filter((f) => f.secret).map((f) => removeSecret(f.key)),
      h('label', { class: 'check wide' }, enabled, h('strong', null, ' On')),
      i.last_sync_at ? h('p', { class: 'muted' }, `Last synced ${day(i.last_sync_at)}.`) : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'primary', 'data-action': 'save', onclick: save }, 'Save'),
        i.configured ? h('button', { type: 'button', 'data-action': 'test', onclick: async () => {
          try {
            const check = await api.testIntegration(id, i.kind);
            toast(check.message, check.ok ? 'info' : 'error');
          } catch (err) {
            fail(err, 'Could not check it.');
          }
        } }, 'Check the connection') : null,
        i.enabled && i.kind !== 'saml' ? h('button', { type: 'button', 'data-action': 'sync', onclick: async () => {
          try {
            await api.syncIntegration(id, i.kind);
            toast('Sync started. It shows in the history below.');
            await load();
          } catch (err) {
            fail(err, 'Could not start the sync.');
          }
        } }, '🔄 Sync now') : null,
        i.configured ? h('button', { type: 'button', class: 'link danger', onclick: async () => {
          if (!window.confirm('Remove this integration and its settings? Accounts it made stay.')) return;
          await api.removeIntegration(id, i.kind).then(() => load(), (err) => fail(err, 'Could not remove it.'));
        } }, 'Remove') : null),
    );
  };

  const rosterCard = (o: OrgOverview) => {
    const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Roster file' });
    const form = h('form', { class: 'inline-form', 'data-form': 'roster' }, file, h('button', { type: 'submit' }, '📤 Upload'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const chosen = file.files?.[0];
      if (!chosen) return toast('Choose a CSV file first.', 'error');
      try {
        const run = await api.uploadRoster(o.organization.id, chosen);
        toast(run.status === 'done' ? `Done: ${summaryLine(run)}` : run.error ?? 'It did not work.', run.status === 'done' ? 'info' : 'error');
        await load();
      } catch (err) {
        fail(err, 'Could not read the file.');
      }
    });
    const sample = 'role,external_id,school_id,school_name,grade_level,teacher_ids,status\nteacher,T-1001,LIN,Lincoln Elementary,,,\nstudent,S-2001,LIN,Lincoln Elementary,4,T-1001,active\n';
    return h('div', { class: 'card', 'data-card': 'roster' },
      h('h2', null, 'Roster file', help('Without a program to call the API, upload a CSV. People are matched by external_id, your opaque id for them (not an email address). teacher_ids lists a student’s teachers, separated by ";". A column with names, emails or birth dates is refused.')),
      h('p', { class: 'muted' }, 'Columns: ', h('code', null, (o.roster_columns ?? []).join(', ')), '. Only role and external_id are needed.'),
      form,
      h('a', { href: `data:text/csv;charset=utf-8,${encodeURIComponent(sample)}`, download: 'qbl-roster-example.csv' }, 'Download an example file'));
  };

  const clientsCard = (o: OrgOverview) => {
    const id = o.organization.id;
    const name = h('input', { type: 'text', required: true, maxlength: 120, placeholder: 'e.g. PowerSchool nightly sync', 'aria-label': 'Name' });
    const scopes = Object.entries(o.scopes ?? {}).map(([scope, what]) => {
      const box = h('input', { type: 'checkbox', value: scope, checked: scope.startsWith('roster') });
      return [box, h('label', { class: 'check', title: what }, box, ' ', h('code', null, scope))] as const;
    });
    const secret = h('div', { class: 'secret-box', hidden: true });
    const show = (made: { client_id: string; client_secret: string }) => {
      secret.hidden = false;
      clear(secret, h('p', null, h('strong', null, 'Copy the secret now: it is not shown again.')), copyable('Client ID', made.client_id), copyable('Client secret', made.client_secret));
    };
    const form = h('form', { class: 'client-form', 'data-form': 'new-client' }, name, h('div', { class: 'scopes' }, ...scopes.map(([, label]) => label)), h('button', { type: 'submit', class: 'primary' }, 'Make an API client'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        show(await api.createClient(id, name.value.trim(), scopes.filter(([box]) => box.checked).map(([box]) => box.value)));
        name.value = '';
        const fresh = await api.org(id);
        clear(list, ...clientRows(fresh));
      } catch (err) {
        fail(err, 'Could not make it.');
      }
    });
    const clientRows = (ov: OrgOverview) => (ov.clients ?? []).map((c) => h('li', { 'data-client': c.client_id, class: c.revoked_at ? 'revoked' : '' },
      h('span', null, h('strong', null, c.name), ' ', h('code', null, c.client_id), h('br'), h('span', { class: 'muted small' }, c.scopes.join(' '), c.revoked_at ? ` · revoked ${day(c.revoked_at)}` : c.last_used_at ? ` · last used ${day(c.last_used_at)}` : ' · never used')),
      c.revoked_at ? null : h('span', null,
        h('button', { type: 'button', class: 'link', onclick: async () => {
          if (!window.confirm('Make a new secret? The old one stops working at once.')) return;
          await api.rotateClient(id, c.client_id).then(show, (err) => fail(err, 'Could not make a new secret.'));
        } }, 'New secret'), ' ',
        h('button', { type: 'button', class: 'link danger', onclick: async () => {
          if (!window.confirm(`Revoke ${c.name}? It stops working at once.`)) return;
          await api.revokeClient(id, c.client_id).then(() => load(), (err) => fail(err, 'Could not revoke it.'));
        } }, 'Revoke'))));
    const list = h('ul', { class: 'people' }, ...clientRows(o));
    return h('div', { class: 'card', 'data-card': 'clients' },
      h('h2', null, 'API clients', help('For your SIS, LMS or data warehouse to manage rosters, assignments and avatars, and read reports, through the public API (OAuth 2 client credentials).')),
      h('p', { class: 'muted' }, 'API: ', h('code', null, String(o.addresses?.api_base_url ?? '')), ' · ', h('a', { href: String(o.addresses?.api_docs_url ?? '/docs/'), target: '_blank', rel: 'noopener' }, 'Documentation')),
      list, secret, form);
  };

  const runsCard = (runs: SyncRun[]) => h('div', { class: 'card', 'data-card': 'runs' },
    h('h2', null, 'Sync history'),
    runs.length
      ? h('ul', { class: 'runs' }, ...runs.map((r) => h('li', { 'data-run': r.id, 'data-status': r.status },
          h('span', { class: `badge ${r.status === 'failed' ? 'late' : ''}` }, r.status),
          ' ', h('strong', null, { clever: 'Clever', google: 'Google Classroom', upload: 'Roster file' }[r.kind]), ' ', h('span', { class: 'muted' }, day(r.created_at)),
          r.summary ? h('div', null, summaryLine(r)) : null,
          r.error ? h('div', { class: 'issue error' }, r.error) : null,
          r.summary && (r.summary.problems.length || r.summary.warnings.length)
            ? h('details', null, h('summary', null, `${r.summary.problems.length + r.summary.warnings.length} notes`), h('ul', null, ...[...r.summary.warnings, ...r.summary.problems].map((p) => h('li', null, p))))
            : null)))
      : h('p', { class: 'empty' }, 'Nothing synced or uploaded yet.'));

  if (orgId === null) void list();
  else void load();
  return h('div', { class: 'page district' }, head, body);
}

/** "12 teachers and 340 students added, 5 updated, 2 deactivated". */
export function summaryLine(run: SyncRun): string {
  const s = run.summary;
  if (!s) return '';
  const made = s.teachers.created + s.students.created;
  const parts = [
    `${s.teachers.created} teachers and ${s.students.created} students added`,
    s.teachers.updated + s.students.updated ? `${s.teachers.updated + s.students.updated} updated` : '',
    s.schools.created ? `${s.schools.created} schools added` : '',
    s.deactivated ? `${s.deactivated} deactivated` : '',
    s.teachers.failed + s.students.failed ? `${s.teachers.failed + s.students.failed} could not be saved` : '',
  ].filter(Boolean);
  return made || parts.length > 1 ? `${parts.join(', ')}.` : 'Nothing changed.';
}

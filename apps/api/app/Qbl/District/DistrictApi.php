<?php

namespace App\Qbl\District;

use App\Qbl\Api\ApiError;
use App\Qbl\Api\Clients;
use App\Qbl\Api\Sql;
use App\Qbl\Billing\Entitlements;
use App\Qbl\StoreError;
use PDO;

/**
 * The district admin panel's API, under /api/district, for an organization's technical staff (its
 * "organization admins") and for QBL's own administrators. Framework-free like EditorApi.
 *
 * Integrations are an advanced feature, off for every organization until QBL turns them on for a
 * customer who asks (`php artisan qbl:org enable`, or a QBL administrator here). Until then the
 * panel shows the organization and says how to ask.
 *
 *   QBL administrators only:
 *   GET    orgs                                  every root organization (organization admins: their own)
 *   POST   orgs                                  {name, kind}
 *   PATCH  orgs/{id}                             also {integrations_enabled, license}
 *
 *   QBL administrators and the organization's admins:
 *   GET    orgs/{id}                             the organization: counts, admins, sign-in addresses, and (when on) integrations, API clients, sync history
 *   PATCH  orgs/{id}                             {name, data_retention_days}
 *   POST   orgs/{id}/admins                      {email}: someone with an account becomes an admin of it
 *   DELETE orgs/{id}/admins/{userId}
 *   PUT    orgs/{id}/integrations/{kind}         {enabled?, config?, secrets?, idp_metadata_xml?}   kind: saml, clever, google
 *   DELETE orgs/{id}/integrations/{kind}
 *   POST   orgs/{id}/integrations/{kind}/test    check the connection
 *   POST   orgs/{id}/integrations/{kind}/sync    queue a roster sync (clever, google)
 *   GET    orgs/{id}/runs                        roster syncs and uploads
 *   POST   orgs/{id}/roster                      multipart `file`: a roster CSV (see RosterFile)
 *   POST   orgs/{id}/clients                     {name, scopes}: an API client for /api/v1; the secret is in the answer only
 *   POST   orgs/{id}/clients/{clientId}/rotate   a new secret
 *   DELETE orgs/{id}/clients/{clientId}          revoke
 */
class DistrictApi
{
    use Sql;

    private Clients $clients;

    /**
     * @param  callable(int): void  $enqueueSync  start a queued roster sync run
     */
    public function __construct(
        PDO $pdo,
        private Integrations $integrations,
        private RosterSync $sync,
        private CleverClient $clever,
        private GoogleClassroomClient $google,
        private string $appUrl,
        private $enqueueSync,
    ) {
        $this->pdo = $pdo;
        $this->clients = new Clients($pdo);
    }

    /**
     * @param  array|null  $user  id, name, role, email
     * @param  array  $files  ['file' => ['tmp_name' => …, 'name' => …]]
     * @return array{0: int, 1: array|null}
     */
    public function handle(string $method, string $path, array $body, ?array $user, array $files = []): array
    {
        try {
            return $this->route(strtoupper($method), array_values(array_filter(explode('/', trim($path, '/')), 'strlen')), $body, $user, $files);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        } catch (ApiError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    /** The organizations this account administers, for the editor's menu. @return list<array{id: int, name: string}> */
    public function adminOf(int $userId, string $role): array
    {
        $rows = $role === 'admin'
            ? $this->all('SELECT id, name FROM organizations WHERE parent_id IS NULL ORDER BY name, id')
            : $this->all('SELECT o.id, o.name FROM organization_admins a JOIN organizations o ON o.id = a.organization_id WHERE a.user_id = ? ORDER BY o.name, o.id', [$userId]);

        return array_map(fn ($r) => ['id' => (int) $r['id'], 'name' => $r['name']], $rows);
    }

    private function route(string $method, array $parts, array $body, ?array $user, array $files): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        $me = (int) $user['id'];
        $admin = ($user['role'] ?? '') === 'admin';
        if (($parts[0] ?? '') !== 'orgs') {
            throw new StoreError(404, 'Not found.');
        }

        if (count($parts) === 1) {
            if ($method === 'GET') {
                $ids = array_column($this->adminOf($me, $user['role'] ?? ''), 'id');
                if (! $ids && ! $admin) {
                    throw new StoreError(403, 'This is for the people who run a school\'s or district\'s account.');
                }

                return [200, ['organizations' => array_map(fn ($id) => $this->summary($id), $ids), 'platform_admin' => $admin]];
            }
            if ($method === 'POST') {
                $this->platformAdmin($admin);
                $org = $this->clients->createOrganization((string) ($body['name'] ?? ''), (string) ($body['kind'] ?? 'district'));

                return [201, ['organization' => $this->summary($org['id'])]];
            }
            throw new StoreError(405, 'Method not allowed.');
        }

        $orgId = ctype_digit($parts[1]) ? (int) $parts[1] : 0;
        $org = $orgId ? $this->clients->organization($orgId) : null;
        // The same answer whether it does not exist or is someone else's.
        if (! $org || $org['parent_id'] !== null || (! $admin && ! $this->one('SELECT id FROM organization_admins WHERE organization_id = ? AND user_id = ?', [$orgId, $me]))) {
            throw new StoreError(404, 'No such organization.');
        }
        $rest = array_slice($parts, 2);

        if ($rest === []) {
            return match ($method) {
                'GET' => [200, $this->overview($orgId, $admin)],
                'PATCH', 'PUT' => [200, $this->update($orgId, $body, $admin)],
                'DELETE' => $this->deleteOrg($orgId, $admin),
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }
        if ($rest[0] === 'admins') {
            if (count($rest) === 1 && $method === 'POST') {
                return [201, $this->addAdmin($orgId, (string) ($body['email'] ?? ''))];
            }
            if (count($rest) === 2 && ctype_digit($rest[1]) && $method === 'DELETE') {
                return $this->removeAdmin($orgId, (int) $rest[1], $admin);
            }
            throw new StoreError(404, 'Not found.');
        }

        // Everything below is the advanced part, turned on per organization.
        if (! $this->enabled($orgId)) {
            throw new StoreError(403, 'Integrations are not turned on for '.$org['name'].'. They are an advanced feature: contact QBL support to have them turned on.');
        }

        if ($rest[0] === 'integrations' && isset($rest[1])) {
            $kind = $rest[1];
            if (! in_array($kind, Integrations::KINDS, true)) {
                throw new StoreError(404, 'There is no such integration.');
            }
            $action = $rest[2] ?? null;

            return match (true) {
                $action === null && in_array($method, ['PUT', 'PATCH'], true) => [200, ['integration' => $this->integrations->save($orgId, $kind, $body)]],
                $action === null && $method === 'DELETE' => $this->done(fn () => $this->integrations->delete($orgId, $kind)),
                $action === 'test' && $method === 'POST' => [200, ['check' => $this->test($orgId, $kind)]],
                $action === 'sync' && $method === 'POST' => [202, ['run' => $this->startSync($orgId, $kind, $me)]],
                default => throw new StoreError(404, 'Not found.'),
            };
        }
        if ($rest === ['runs'] && $method === 'GET') {
            return [200, ['runs' => $this->sync->runs($orgId, 30)]];
        }
        if ($rest === ['roster'] && $method === 'POST') {
            return [201, ['run' => $this->upload($orgId, $files['file'] ?? null, $me)]];
        }
        if ($rest[0] === 'clients') {
            if (count($rest) === 1 && $method === 'POST') {
                $made = $this->clients->createClient($orgId, (string) ($body['name'] ?? ''), (array) ($body['scopes'] ?? []));

                return [201, ['client' => $made + ['note' => 'Copy the secret now: it is not shown again.']]];
            }
            $clientId = (string) ($rest[1] ?? '');
            if (! in_array($clientId, array_column($this->clients->clients($orgId), 'client_id'), true)) {
                throw new StoreError(404, 'No such API client.');
            }
            if (count($rest) === 3 && $rest[2] === 'rotate' && $method === 'POST') {
                return [200, ['client' => ['client_id' => $clientId, 'client_secret' => $this->clients->rotateSecret($clientId), 'note' => 'Copy the secret now: it is not shown again. The old one has stopped working.']]];
            }
            if (count($rest) === 2 && $method === 'DELETE') {
                return $this->done(fn () => $this->clients->revokeClient($clientId));
            }
        }

        throw new StoreError(404, 'Not found.');
    }

    // --------------------------------------------------------------- the pages

    private function summary(int $orgId): array
    {
        $org = $this->clients->organization($orgId);

        return [
            'id' => $orgId, 'name' => $org['name'], 'kind' => $org['kind'], 'integrations_enabled' => $this->enabled($orgId),
            'teachers' => $this->count($orgId, 'teacher'), 'students' => $this->count($orgId, 'student'),
            'license' => Entitlements::liveLicense(self::json($this->one('SELECT license FROM organizations WHERE id = ?', [$orgId])['license'] ?? null)),
        ];
    }

    private function overview(int $orgId, bool $admin): array
    {
        $org = $this->clients->organization($orgId);
        $row = $this->one('SELECT integrations_enabled_at, license FROM organizations WHERE id = ?', [$orgId]);
        $enabled = $row['integrations_enabled_at'] !== null;
        $base = rtrim($this->appUrl, '/');
        $out = [
            'organization' => [
                'id' => $orgId, 'name' => $org['name'], 'kind' => $org['kind'], 'external_id' => $org['external_id'],
                'data_retention_days' => $org['settings']['data_retention_days'] ?? null,
                'integrations_enabled' => $enabled, 'integrations_enabled_at' => self::iso($row['integrations_enabled_at']),
                'license' => self::json($row['license']) ?: null, 'created_at' => $org['created_at'],
            ],
            'counts' => [
                'schools' => (int) $this->one('SELECT COUNT(*) AS n FROM organizations WHERE parent_id = ?', [$orgId])['n'],
                'teachers' => $this->count($orgId, 'teacher'), 'students' => $this->count($orgId, 'student'),
                'inactive' => (int) $this->one('SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND deactivated_at IS NOT NULL', [$orgId])['n'],
            ],
            'admins' => array_map(fn ($a) => ['id' => (int) $a['id'], 'name' => $a['name'], 'email' => $a['email']],
                $this->all('SELECT u.id, u.name, u.email FROM organization_admins a JOIN users u ON u.id = a.user_id WHERE a.organization_id = ? ORDER BY u.name, u.id', [$orgId])),
            'platform_admin' => $admin,
        ];
        if (! $enabled) {
            return $out;
        }

        return $out + [
            'integrations' => $this->integrations->list($orgId),
            // What to give the identity provider, Clever and Google, and the links people sign in with.
            'addresses' => [
                'saml_entity_id' => "$base/api/sso/$orgId/saml/metadata",
                'saml_metadata_url' => "$base/api/sso/$orgId/saml/metadata",
                'saml_acs_url' => "$base/api/sso/$orgId/saml/acs",
                'saml_login_url' => "$base/api/sso/$orgId/saml/login",
                'clever_redirect_uri' => "$base/api/sso/clever/callback",
                'clever_login_url' => "$base/api/sso/clever/login",
                'clever_ready' => $this->clever->configured(),
                'google_login_url' => "$base/missions",
                'google_scopes' => GoogleClassroomClient::SCOPES,
                'api_base_url' => "$base/api/v1",
                'api_docs_url' => "$base/docs/developers/api-v1/",
            ],
            'clients' => $this->clients->clients($orgId),
            'scopes' => Clients::SCOPES,
            'runs' => $this->sync->runs($orgId, 10),
            'roster_columns' => RosterFile::COLUMNS,
        ];
    }

    private function update(int $orgId, array $body, bool $admin): array
    {
        $attrs = array_intersect_key($body, ['name' => 1, 'data_retention_days' => 1]);
        if (array_key_exists('data_retention_days', $attrs) && $attrs['data_retention_days'] !== null) {
            $attrs['data_retention_days'] = is_numeric($attrs['data_retention_days']) ? (int) $attrs['data_retention_days'] : $attrs['data_retention_days'];
        }
        if ($attrs) {
            $this->clients->updateOrganization($orgId, $attrs);
        }
        if (array_key_exists('kind', $body)) {
            $this->platformAdmin($admin);
            if (! in_array($body['kind'], Clients::KINDS, true)) {
                throw new StoreError(422, 'kind is one of '.implode(', ', Clients::KINDS).'.');
            }
            $this->run('UPDATE organizations SET kind = ?, updated_at = ? WHERE id = ?', [$body['kind'], self::now(), $orgId]);
        }
        if (array_key_exists('integrations_enabled', $body)) {
            $this->platformAdmin($admin);
            $this->setEnabled($orgId, (bool) $body['integrations_enabled']);
        }
        if (array_key_exists('license', $body)) {
            $this->platformAdmin($admin);
            $this->setLicense($orgId, $body['license']);
        }

        return $this->overview($orgId, $admin);
    }

    private function deleteOrg(int $orgId, bool $admin): array
    {
        $this->platformAdmin($admin);
        if ($this->count($orgId, 'teacher') + $this->count($orgId, 'student') > 0) {
            throw new StoreError(409, 'This organization still has people in it. Delete them through the API (privacy) first.');
        }
        $this->clients->deleteOrganization($orgId);

        return [204, null];
    }

    /** Turn the advanced features on or off. Off keeps their settings, but turns every integration off. */
    public function setEnabled(int $orgId, bool $on): void
    {
        $this->run('UPDATE organizations SET integrations_enabled_at = '.($on ? 'COALESCE(integrations_enabled_at, ?)' : 'NULL').', updated_at = ? WHERE id = ?', $on ? [self::now(), self::now(), $orgId] : [self::now(), $orgId]);
        if (! $on) {
            $this->run('UPDATE org_integrations SET enabled = 0, updated_at = ? WHERE organization_id = ?', [self::now(), $orgId]);
        }
    }

    /**
     * A custom plan agreed with the school or district (a quote): what its teachers get. Null removes it.
     * {plan_name?, curricular?, generator?, students?: null|int, monthly_credits?, credit_carryover?, expires_at?: YYYY-MM-DD, active?}
     */
    public function setLicense(int $orgId, mixed $license): void
    {
        if ($license !== null && ! is_array($license)) {
            throw new StoreError(422, 'A license is an object, or null to remove it.');
        }
        $clean = null;
        if (is_array($license)) {
            $num = fn ($k, $max) => isset($license[$k]) && $license[$k] !== '' && $license[$k] !== null ? max(0, min($max, (int) $license[$k])) : null;
            $expires = trim((string) ($license['expires_at'] ?? ''));
            if ($expires !== '' && ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $expires)) {
                throw new StoreError(422, 'expires_at is a date, YYYY-MM-DD.');
            }
            $clean = [
                'active' => (bool) ($license['active'] ?? true),
                'plan_name' => mb_substr(trim((string) ($license['plan_name'] ?? '')), 0, 80) ?: null,
                'curricular' => (bool) ($license['curricular'] ?? true),
                'generator' => (bool) ($license['generator'] ?? false),
                'students' => $num('students', 1_000_000),
                'monthly_credits' => $num('monthly_credits', 1_000_000) ?? 0,
                'credit_carryover' => $num('credit_carryover', 1_000_000) ?? ($num('monthly_credits', 1_000_000) ?? 0),
                'expires_at' => $expires ?: null,
            ];
        }
        $this->run('UPDATE organizations SET license = ?, updated_at = ? WHERE id = ?', [$clean === null ? null : json_encode($clean), self::now(), $orgId]);
    }

    // ----------------------------------------------------------------- admins

    /** @return array{admin: array, warning?: string} */
    public function addAdmin(int $orgId, string $email): array
    {
        $email = strtolower(trim($email));
        $user = $email === '' ? null : $this->one('SELECT id, name, email, role, organization_id, self_registered_at, email_verified_at, google_id FROM users WHERE LOWER(email) = ?', [$email]);
        if (! $user || $user['role'] === 'guest' || str_ends_with((string) $user['email'], '.invalid')) {
            throw new StoreError(404, 'Nobody has an account with that address yet. Ask them to create one (or sign in once), then add them.');
        }
        if (! $this->one('SELECT id FROM organization_admins WHERE organization_id = ? AND user_id = ?', [$orgId, $user['id']])) {
            $this->run('INSERT INTO organization_admins (organization_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [$orgId, $user['id'], self::now(), self::now()]);
        }
        $out = ['admin' => ['id' => (int) $user['id'], 'name' => $user['name'], 'email' => $user['email']]];
        if ($user['self_registered_at'] !== null && $user['email_verified_at'] === null && $user['google_id'] === null) {
            $out['warning'] = "Nobody has checked that $email belongs to whoever made that account. Make sure it is the person you mean.";
        }

        return $out;
    }

    private function removeAdmin(int $orgId, int $userId, bool $admin): array
    {
        $count = (int) $this->one('SELECT COUNT(*) AS n FROM organization_admins WHERE organization_id = ?', [$orgId])['n'];
        if (! $admin && $count <= 1) {
            throw new StoreError(409, 'An organization needs at least one admin. Add someone else first.');
        }
        $this->run('DELETE FROM organization_admins WHERE organization_id = ? AND user_id = ?', [$orgId, $userId]);

        return [204, null];
    }

    // ----------------------------------------------------------- integrations

    private function test(int $orgId, string $kind): array
    {
        $integration = $this->integrations->get($orgId, $kind) ?? throw new StoreError(404, 'Set it up first.');
        $config = $integration['config'];
        $secrets = $this->integrations->secrets($orgId, $kind);
        if ($missing = Integrations::missing($kind, $config, $secrets)) {
            return ['ok' => false, 'message' => 'Still needed: '.implode(', ', $missing).'.'];
        }

        try {
            return $this->check($kind, $config, $secrets);
        } catch (StoreError $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        }
    }

    private function check(string $kind, array $config, array $secrets): array
    {
        return match ($kind) {
            'saml' => ['ok' => true, 'message' => 'The identity provider\'s settings are complete. Sign in with the SAML sign-in link to try it.'],
            'clever' => ['ok' => true, 'message' => 'Connected to Clever: '.$this->clever->check($this->clever->districtToken($config['district_id'], $secrets['district_token'] ?? null))['schools'].' schools visible.'],
            'google' => $this->testGoogle($config, $secrets),
        };
    }

    private function testGoogle(array $config, array $secrets): array
    {
        if (empty($secrets['service_account_json']) || $config['admin_email'] === '') {
            return ['ok' => true, 'message' => 'Google sign-in is ready for '.implode(', ', $config['domains']).'. For Classroom rosters, add a service account key and an administrator\'s address.'];
        }
        $check = $this->google->check($this->google->token(json_decode($secrets['service_account_json'], true), $config['admin_email']));

        return ['ok' => true, 'message' => 'Connected to Google Classroom'.($check['courses_visible'] ? '.' : ', but no active courses are visible.')];
    }

    private function startSync(int $orgId, string $kind, int $me): array
    {
        if (! in_array($kind, ['clever', 'google'], true)) {
            throw new StoreError(422, 'Only Clever and Google Classroom have rosters to sync. SAML accounts are made when people sign in.');
        }
        $integration = $this->integrations->live($orgId, $kind) ?? throw new StoreError(409, 'Turn the integration on first.');
        if ($kind === 'google' && (empty($this->integrations->secrets($orgId, 'google')['service_account_json']) || $integration['config']['admin_email'] === '')) {
            throw new StoreError(422, 'A Classroom sync needs a service account key and an administrator\'s address.');
        }
        foreach ($this->sync->runs($orgId, 5) as $run) {
            if ($run['kind'] === $kind && in_array($run['status'], ['queued', 'running'], true)) {
                throw new StoreError(409, 'A sync is already running.');
            }
        }
        $id = $this->sync->startRun($orgId, $kind, $me);
        ($this->enqueueSync)($id);

        return $this->sync->getRun($id);
    }

    /**
     * The work of a queued sync (App\Jobs\SyncRoster): read the source and apply it.
     */
    public function performSync(int $runId): array
    {
        return $this->sync->perform($runId, function () use ($runId) {
            $run = $this->one('SELECT organization_id, kind FROM integration_runs WHERE id = ?', [$runId]);
            $orgId = (int) $run['organization_id'];
            $kind = $run['kind'];
            $integration = $this->integrations->live($orgId, $kind) ?? throw new StoreError(409, 'The integration has been turned off.');
            $secrets = $this->integrations->secrets($orgId, $kind);
            $config = $integration['config'];
            $data = $kind === 'clever'
                ? $this->clever->roster($this->clever->districtToken($config['district_id'], $secrets['district_token'] ?? null))
                : $this->google->roster($this->google->token(json_decode($secrets['service_account_json'] ?? '{}', true) ?: [], $config['admin_email']));
            $this->integrations->synced($orgId, $kind);

            return [$data, $kind === 'clever' ? CleverClient::PREFIX : GoogleClassroomClient::PREFIX, (bool) $config['deactivate_missing']];
        });
    }

    private function upload(int $orgId, ?array $file, int $me): array
    {
        if (! $file || empty($file['tmp_name'])) {
            throw new StoreError(422, 'No file was uploaded.');
        }
        $data = RosterFile::read($file['tmp_name']);
        $id = $this->sync->startRun($orgId, 'upload', $me);

        // A file is applied now, as it is: no one is deactivated for being left out of it.
        return $this->sync->perform($id, fn () => [$data, null, false]);
    }

    // ----------------------------------------------------------------- helpers

    private function enabled(int $orgId): bool
    {
        return ($this->one('SELECT integrations_enabled_at FROM organizations WHERE id = ?', [$orgId])['integrations_enabled_at'] ?? null) !== null;
    }

    private function count(int $orgId, string $role): int
    {
        return (int) $this->one('SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = ? AND deactivated_at IS NULL', [$orgId, $role])['n'];
    }

    private function platformAdmin(bool $admin): void
    {
        if (! $admin) {
            throw new StoreError(403, 'Only QBL administrators can change that.');
        }
    }

    private function done(callable $work): array
    {
        $work();

        return [204, null];
    }
}

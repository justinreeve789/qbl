<?php

namespace App\Qbl\Api;

use PDO;

/**
 * Organizations, the API clients they connect with, the access tokens those clients are issued,
 * and the record of what each request did.
 *
 *  - An **organization** is a district, school, business or other body. A root organization may
 *    have schools under it (one level). Everything a client does is limited to its own
 *    organization and that organization's schools.
 *  - An **API client** belongs to a root organization and has scopes. It signs in with OAuth 2
 *    client credentials and gets an access token good for an hour.
 *
 * Plain PHP over PDO, like the stores, so it is tested without a framework.
 */
class Clients
{
    use Sql;

    /** What a client may be allowed to do. */
    public const SCOPES = [
        'roster:read' => 'Read schools, teachers, students and enrollments.',
        'roster:write' => 'Create, change and deactivate schools, teachers, students and enrollments.',
        'assignments:read' => 'Read the mission catalogue, assignments and teams.',
        'assignments:write' => 'Create, change and remove assignments and teams.',
        'avatars:read' => 'Read the avatars players can choose.',
        'avatars:write' => 'Import, change and remove the organization\'s own avatars.',
        'reports:read' => 'Read progress, grades, engagement and learning reports, and the activity feed.',
        'messages:read' => 'Read the chat messages students sent in assigned missions (for safety review).',
        'launch' => 'Make one-time sign-in links for teachers and students.',
        'privacy' => 'Export everything kept about a student, and delete a student and all their data.',
        'audit:read' => 'Read the record of requests made with the organization\'s clients.',
    ];

    public const KINDS = ['district', 'school', 'business', 'other'];

    public const TOKEN_SECONDS = 3600;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    // ------------------------------------------------------------- organizations

    public function createOrganization(string $name, string $kind = 'district', ?int $parentId = null, ?string $externalId = null, array $settings = []): array
    {
        $name = trim($name);
        if ($name === '' || mb_strlen($name) > 120) {
            throw ApiError::invalid('name', 'An organization needs a name of at most 120 characters.');
        }
        if (! in_array($kind, self::KINDS, true)) {
            throw ApiError::invalid('kind', 'kind must be one of '.implode(', ', self::KINDS).'.');
        }
        if ($parentId !== null) {
            $parent = $this->organization($parentId);
            if (! $parent || $parent['parent_id'] !== null) {
                throw ApiError::invalid('parent_id', 'Schools sit directly under a root organization.');
            }
        }
        if ($externalId !== null && $this->one('SELECT id FROM organizations WHERE '.($parentId === null ? 'parent_id IS NULL' : 'parent_id = '.(int) $parentId).' AND external_id = ?', [$externalId])) {
            throw new ApiError(409, 'conflict', 'There is already an organization with that external_id here.');
        }
        $id = $this->insert('INSERT INTO organizations (parent_id, name, kind, external_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$parentId, $name, $kind, $externalId, json_encode((object) $settings), self::now(), self::now()]);

        return $this->organization($id);
    }

    public function organization(int $id): ?array
    {
        $row = $this->one('SELECT * FROM organizations WHERE id = ?', [$id]);

        return $row ? self::org($row) : null;
    }

    /** The root organization and its schools: everything one client may reach. @return int[] */
    public function family(int $rootId): array
    {
        return array_merge([$rootId], array_map('intval', array_column($this->all('SELECT id FROM organizations WHERE parent_id = ?', [$rootId]), 'id')));
    }

    public function updateOrganization(int $id, array $attrs): array
    {
        $org = $this->organization($id) ?? throw ApiError::notFound('The organization');
        $name = array_key_exists('name', $attrs) ? trim((string) $attrs['name']) : $org['name'];
        if ($name === '' || mb_strlen($name) > 120) {
            throw ApiError::invalid('name', 'An organization needs a name of at most 120 characters.');
        }
        $settings = $org['settings'];
        if (array_key_exists('data_retention_days', $attrs)) {
            $days = $attrs['data_retention_days'];
            if ($days !== null && (! is_int($days) || $days < 30 || $days > 3650)) {
                throw ApiError::invalid('data_retention_days', 'data_retention_days must be null (keep until deleted) or 30 to 3650.');
            }
            $settings['data_retention_days'] = $days;
        }
        $externalId = array_key_exists('external_id', $attrs) ? ($attrs['external_id'] === null ? null : Privacy::externalId($attrs['external_id'])) : $org['external_id'];
        $this->run('UPDATE organizations SET name = ?, external_id = ?, settings = ?, updated_at = ? WHERE id = ?', [$name, $externalId, json_encode((object) $settings), self::now(), $id]);

        return $this->organization($id);
    }

    public function deleteOrganization(int $id): void
    {
        $this->run('DELETE FROM organizations WHERE id = ?', [$id]);
    }

    // ------------------------------------------------------------------ clients

    /** Make a client. The secret is in the answer and nowhere else: only its hash is kept. */
    public function createClient(int $organizationId, string $name, array $scopes): array
    {
        $org = $this->organization($organizationId);
        if (! $org || $org['parent_id'] !== null) {
            throw ApiError::invalid('organization_id', 'API clients belong to a root organization.');
        }
        $scopes = self::checkScopes($scopes);
        $clientId = 'qbl_'.bin2hex(random_bytes(12));
        $secret = 'qbls_'.bin2hex(random_bytes(24));
        $this->insert('INSERT INTO api_clients (organization_id, name, client_id, secret_hash, scopes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$organizationId, mb_substr(trim($name) ?: 'API client', 0, 120), $clientId, password_hash($secret, PASSWORD_DEFAULT), json_encode($scopes), self::now(), self::now()]);

        return ['client_id' => $clientId, 'client_secret' => $secret, 'organization_id' => $organizationId, 'scopes' => $scopes];
    }

    /** A new secret for a client; the old one stops working, and so do the tokens issued with it. */
    public function rotateSecret(string $clientId): string
    {
        $client = $this->one('SELECT * FROM api_clients WHERE client_id = ?', [$clientId]) ?? throw ApiError::notFound('The client');
        $secret = 'qbls_'.bin2hex(random_bytes(24));
        $this->run('UPDATE api_clients SET secret_hash = ?, updated_at = ? WHERE id = ?', [password_hash($secret, PASSWORD_DEFAULT), self::now(), $client['id']]);
        $this->run('DELETE FROM api_tokens WHERE api_client_id = ?', [$client['id']]);

        return $secret;
    }

    public function revokeClient(string $clientId): void
    {
        $client = $this->one('SELECT id FROM api_clients WHERE client_id = ?', [$clientId]) ?? throw ApiError::notFound('The client');
        $this->run('UPDATE api_clients SET revoked_at = ?, updated_at = ? WHERE id = ?', [self::now(), self::now(), $client['id']]);
        $this->run('DELETE FROM api_tokens WHERE api_client_id = ?', [$client['id']]);
    }

    /** @return list<array> an organization's clients, without secrets */
    public function clients(?int $organizationId = null): array
    {
        $rows = $organizationId === null ? $this->all('SELECT * FROM api_clients ORDER BY id') : $this->all('SELECT * FROM api_clients WHERE organization_id = ? ORDER BY id', [$organizationId]);

        return array_map(fn ($c) => [
            'client_id' => $c['client_id'], 'name' => $c['name'], 'organization_id' => (int) $c['organization_id'], 'scopes' => self::json($c['scopes']),
            'last_used_at' => self::iso($c['last_used_at']), 'revoked_at' => self::iso($c['revoked_at']), 'created_at' => self::iso($c['created_at']),
        ], $rows);
    }

    /**
     * OAuth 2 client credentials: a client id and secret in, an access token out. A client may ask
     * for fewer scopes than it has, never more.
     */
    public function issueToken(string $clientId, string $secret, ?string $scope = null): array
    {
        $client = $this->one('SELECT * FROM api_clients WHERE client_id = ?', [$clientId]);
        // Always check a hash, so a wrong client id takes as long as a wrong secret.
        static $dummy = null;
        $ok = password_verify($secret, $client['secret_hash'] ?? ($dummy ??= password_hash(random_bytes(16), PASSWORD_DEFAULT)));
        if (! $client || ! $ok || $client['revoked_at'] !== null) {
            throw new ApiError(401, 'invalid_client', 'The client id or secret is wrong, or the client has been revoked.');
        }
        $granted = self::json($client['scopes']);
        $scopes = $granted;
        if ($scope !== null && trim($scope) !== '') {
            $asked = array_values(array_unique(preg_split('/\s+/', trim($scope))));
            if (array_diff($asked, $granted)) {
                throw new ApiError(400, 'invalid_scope', 'This client may not have: '.implode(' ', array_diff($asked, $granted)).'.');
            }
            $scopes = $asked;
        }
        $token = 'qbla_'.bin2hex(random_bytes(24));
        $this->run('DELETE FROM api_tokens WHERE expires_at < ?', [self::now()]);
        $this->insert('INSERT INTO api_tokens (api_client_id, token_hash, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
            [$client['id'], hash('sha256', $token), json_encode($scopes), gmdate('Y-m-d H:i:s', time() + self::TOKEN_SECONDS), self::now()]);
        $this->run('UPDATE api_clients SET last_used_at = ? WHERE id = ?', [self::now(), $client['id']]);

        return ['access_token' => $token, 'token_type' => 'Bearer', 'expires_in' => self::TOKEN_SECONDS, 'scope' => implode(' ', $scopes)];
    }

    /**
     * Who a request's bearer token belongs to.
     *
     * @return array{client_id: int, client: string, organization: array, scopes: string[]}
     */
    public function authenticate(?string $token): array
    {
        if (! $token || ! str_starts_with($token, 'qbla_')) {
            throw new ApiError(401, 'unauthenticated', 'Send an access token: Authorization: Bearer <token>, from POST /api/v1/oauth/token.');
        }
        $row = $this->one('SELECT t.scopes, t.expires_at, c.id AS client_id, c.client_id AS client, c.organization_id, c.revoked_at FROM api_tokens t JOIN api_clients c ON c.id = t.api_client_id WHERE t.token_hash = ?', [hash('sha256', $token)]);
        if (! $row || $row['revoked_at'] !== null || strtotime($row['expires_at'].' UTC') < time()) {
            throw new ApiError(401, 'invalid_token', 'The access token is unknown or has expired. Get a new one from POST /api/v1/oauth/token.');
        }
        $org = $this->organization((int) $row['organization_id']) ?? throw new ApiError(401, 'invalid_token', 'The organization no longer exists.');

        return ['client_id' => (int) $row['client_id'], 'client' => $row['client'], 'organization' => $org, 'scopes' => self::json($row['scopes'])];
    }

    // -------------------------------------------------------------------- audit

    public function audit(?int $organizationId, ?int $clientId, string $method, string $path, int $status, array $studentIds = []): void
    {
        $this->run('INSERT INTO api_audit_log (organization_id, api_client_id, method, path, status, student_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
            $organizationId, $clientId, substr($method, 0, 8), mb_substr($path, 0, 255), $status,
            $studentIds ? json_encode(array_values(array_unique(array_map('intval', $studentIds)))) : null, self::now(),
        ]);
    }

    /** An organization's audit log, newest first. */
    public function auditLog(int $organizationId, int $limit = 100, ?int $before = null, ?int $studentId = null): array
    {
        $rows = $this->all(
            'SELECT a.*, c.client_id AS client FROM api_audit_log a LEFT JOIN api_clients c ON c.id = a.api_client_id WHERE a.organization_id = ?'
            .($before ? ' AND a.id < ?' : '').' ORDER BY a.id DESC LIMIT '.max(1, min(1000, $limit + ($studentId ? 2000 : 0))),
            array_merge([$organizationId], $before ? [$before] : []),
        );
        $out = [];
        foreach ($rows as $r) {
            $students = self::json($r['student_ids']);
            if ($studentId !== null && ! in_array($studentId, $students, true)) {
                continue;
            }
            $out[] = ['id' => (int) $r['id'], 'client_id' => $r['client'], 'method' => $r['method'], 'path' => $r['path'], 'status' => (int) $r['status'], 'student_ids' => $students, 'at' => self::iso($r['created_at'])];
            if (count($out) >= $limit) {
                break;
            }
        }

        return $out;
    }

    // ------------------------------------------------------------------ helpers

    public static function checkScopes(array $scopes): array
    {
        $scopes = array_values(array_unique(array_map('strval', $scopes)));
        if ($scopes === ['*']) {
            return array_keys(self::SCOPES);
        }
        $unknown = array_diff($scopes, array_keys(self::SCOPES));
        if ($unknown || ! $scopes) {
            throw ApiError::invalid('scopes', 'Unknown scopes: '.implode(', ', $unknown ?: ['(none given)']).'. Known: '.implode(', ', array_keys(self::SCOPES)).'.');
        }

        return $scopes;
    }

    private static function org(array $row): array
    {
        return [
            'id' => (int) $row['id'], 'parent_id' => $row['parent_id'] === null ? null : (int) $row['parent_id'], 'name' => $row['name'], 'kind' => $row['kind'],
            'external_id' => $row['external_id'], 'settings' => self::json($row['settings']), 'created_at' => self::iso($row['created_at']), 'updated_at' => self::iso($row['updated_at']),
        ];
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `organizations` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `parent_id` INTEGER, `name`, `kind`, `external_id`, `settings`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `api_clients` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `organization_id` INTEGER, `name`, `client_id` UNIQUE, `secret_hash`, `scopes`, `last_used_at`, `revoked_at`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `api_tokens` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `api_client_id` INTEGER, `token_hash` UNIQUE, `scopes`, `expires_at`, `created_at`)',
            'CREATE TABLE IF NOT EXISTS `launch_tokens` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER, `api_client_id` INTEGER, `token_hash` UNIQUE, `return_path`, `expires_at`, `used_at`, `created_at`)',
            'CREATE TABLE IF NOT EXISTS `api_audit_log` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `organization_id` INTEGER, `api_client_id` INTEGER, `method`, `path`, `status` INTEGER, `student_ids`, `created_at`)',
            'CREATE TABLE IF NOT EXISTS `personal_access_tokens` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `tokenable_type`, `tokenable_id` INTEGER, `name`, `token` UNIQUE, `abilities`, `last_used_at`, `expires_at`, `created_at`, `updated_at`)',
        ];
    }
}

<?php

namespace App\Qbl\District;

use App\Qbl\Api\Sql;
use App\Qbl\StoreError;
use DOMDocument;
use DOMXPath;
use PDO;

/**
 * An organization's integrations: how its accounts and enrollments reach QBL.
 *
 *   saml    sign-in through the district's identity provider (ADFS, Azure AD / Entra, Okta,
 *           ClassLink, Google as a SAML IdP...). Accounts are made on first sign-in.
 *   clever  Clever Instant Login, and a roster sync of schools, teachers, students and sections.
 *   google  Google Workspace sign-in for the district's domains, and a roster sync from Google
 *           Classroom (a service account with domain-wide delegation).
 *
 * Custom uploads go through the public API (/api/v1, with an API client) or a roster file.
 *
 * `config` is shown in the panel. `secrets` (a Clever district token, a Google service account
 * key) are encrypted with the application key and never leave the server again: the panel only
 * learns whether each one is set.
 */
class Integrations
{
    use Sql;

    public const KINDS = ['saml', 'clever', 'google'];

    /** What each kind keeps, and which of it is secret. */
    public const FIELDS = [
        'saml' => [
            'config' => ['idp_entity_id', 'idp_sso_url', 'idp_x509_cert', 'id_attribute', 'role_attribute', 'teacher_values', 'create_users', 'allow_idp_initiated'],
            'secrets' => [],
        ],
        'clever' => [
            'config' => ['district_id', 'create_users', 'deactivate_missing'],
            'secrets' => ['district_token'],
        ],
        'google' => [
            'config' => ['domains', 'admin_email', 'create_users', 'deactivate_missing'],
            'secrets' => ['service_account_json'],
        ],
    ];

    /** @var callable(string): string */
    private $encrypt;

    /** @var callable(string): string */
    private $decrypt;

    public function __construct(PDO $pdo, callable $encrypt, callable $decrypt)
    {
        $this->pdo = $pdo;
        $this->encrypt = $encrypt;
        $this->decrypt = $decrypt;
    }

    /** Every kind, set up or not, as the panel shows them. */
    public function list(int $orgId): array
    {
        return array_map(fn ($kind) => $this->get($orgId, $kind) ?? ['kind' => $kind, 'enabled' => false, 'configured' => false, 'config' => self::defaults($kind), 'secrets' => array_fill_keys(self::FIELDS[$kind]['secrets'], false), 'last_sync_at' => null], self::KINDS);
    }

    public function get(int $orgId, string $kind): ?array
    {
        $row = $this->row($orgId, $kind);
        if (! $row) {
            return null;
        }
        $secrets = $this->secrets($orgId, $kind);

        return [
            'kind' => $kind, 'enabled' => (bool) $row['enabled'], 'configured' => true,
            'config' => self::json($row['config']) + self::defaults($kind),
            // Whether each secret is set; never the secret.
            'secrets' => array_map(fn ($name) => isset($secrets[$name]) && $secrets[$name] !== '', array_combine(self::FIELDS[$kind]['secrets'], self::FIELDS[$kind]['secrets']) ?: []),
            'last_sync_at' => self::iso($row['last_sync_at']),
        ];
    }

    /** The enabled integration of this kind, with its config, or null. */
    public function live(int $orgId, string $kind): ?array
    {
        $row = $this->row($orgId, $kind);

        return $row && $row['enabled'] ? ['organization_id' => $orgId, 'config' => self::json($row['config']) + self::defaults($kind)] : null;
    }

    /** @return array<string, string> the decrypted secrets */
    public function secrets(int $orgId, string $kind): array
    {
        $row = $this->row($orgId, $kind);
        if (! $row || ! $row['secrets']) {
            return [];
        }
        try {
            return json_decode(($this->decrypt)((string) $row['secrets']), true) ?: [];
        } catch (\Throwable) {
            // Made with another application key: as good as not set.
            return [];
        }
    }

    /**
     * Change an integration. Only what is given changes. A secret given as "" is removed; one not
     * given stays. Turning one on checks that it has what it needs.
     *
     * @param  array{enabled?: bool, config?: array, secrets?: array, idp_metadata_xml?: string}  $body
     */
    public function save(int $orgId, string $kind, array $body): array
    {
        if (! in_array($kind, self::KINDS, true)) {
            throw new StoreError(404, 'There is no such integration.');
        }
        $row = $this->row($orgId, $kind);
        $config = ($row ? self::json($row['config']) : []) + self::defaults($kind);
        $given = is_array($body['config'] ?? null) ? $body['config'] : [];
        if ($kind === 'saml' && trim((string) ($body['idp_metadata_xml'] ?? '')) !== '') {
            $given = self::parseIdpMetadata((string) $body['idp_metadata_xml']) + $given;
        }
        foreach ($given as $key => $value) {
            if (! in_array($key, self::FIELDS[$kind]['config'], true)) {
                throw new StoreError(422, "\"$key\" is not a setting of the $kind integration.");
            }
            $config[$key] = $this->clean($orgId, $kind, $key, $value);
        }
        $secrets = $row ? $this->secrets($orgId, $kind) : [];
        foreach ((is_array($body['secrets'] ?? null) ? $body['secrets'] : []) as $key => $value) {
            if (! in_array($key, self::FIELDS[$kind]['secrets'], true)) {
                throw new StoreError(422, "\"$key\" is not a secret of the $kind integration.");
            }
            $value = trim((string) $value);
            if ($value === '') {
                unset($secrets[$key]);
            } else {
                $secrets[$key] = self::cleanSecret($key, $value);
            }
        }
        $enabled = array_key_exists('enabled', $body) ? (bool) $body['enabled'] : (bool) ($row['enabled'] ?? false);
        if ($enabled && ($missing = self::missing($kind, $config, $secrets))) {
            throw new StoreError(422, 'To turn it on, fill in: '.implode(', ', $missing).'.');
        }
        $fields = [
            'enabled' => $enabled ? 1 : 0,
            'config' => json_encode((object) $config, JSON_UNESCAPED_SLASHES),
            'secrets' => $secrets ? ($this->encrypt)(json_encode($secrets, JSON_UNESCAPED_SLASHES)) : null,
            'updated_at' => self::now(),
        ];
        if ($row) {
            $this->run('UPDATE org_integrations SET enabled = ?, config = ?, secrets = ?, updated_at = ? WHERE id = ?', [...array_values($fields), $row['id']]);
        } else {
            $this->run('INSERT INTO org_integrations (enabled, config, secrets, updated_at, organization_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [...array_values($fields), $orgId, $kind, self::now()]);
        }

        return $this->get($orgId, $kind);
    }

    public function delete(int $orgId, string $kind): void
    {
        $this->run('DELETE FROM org_integrations WHERE organization_id = ? AND kind = ?', [$orgId, $kind]);
    }

    public function synced(int $orgId, string $kind): void
    {
        $this->run('UPDATE org_integrations SET last_sync_at = ? WHERE organization_id = ? AND kind = ?', [self::now(), $orgId, $kind]);
    }

    /** The organization whose enabled Clever integration is for this Clever district. */
    public function cleverDistrict(string $districtId): ?array
    {
        foreach ($this->all("SELECT organization_id, config FROM org_integrations WHERE kind = 'clever' AND enabled = 1") as $row) {
            if ((self::json($row['config'])['district_id'] ?? null) === $districtId) {
                return $this->live((int) $row['organization_id'], 'clever');
            }
        }

        return null;
    }

    /** The organization whose enabled Google integration claims this email domain. */
    public function googleDomain(string $domain): ?array
    {
        $domain = strtolower($domain);
        foreach ($this->all("SELECT organization_id, config FROM org_integrations WHERE kind = 'google' AND enabled = 1") as $row) {
            if (in_array($domain, (array) (self::json($row['config'])['domains'] ?? []), true)) {
                return $this->live((int) $row['organization_id'], 'google');
            }
        }

        return null;
    }

    // ------------------------------------------------------------------ checks

    public static function defaults(string $kind): array
    {
        return match ($kind) {
            'saml' => ['idp_entity_id' => '', 'idp_sso_url' => '', 'idp_x509_cert' => '', 'id_attribute' => '', 'role_attribute' => '', 'teacher_values' => ['teacher', 'faculty', 'staff', 'employee'], 'create_users' => true, 'allow_idp_initiated' => true],
            'clever' => ['district_id' => '', 'create_users' => true, 'deactivate_missing' => true],
            'google' => ['domains' => [], 'admin_email' => '', 'create_users' => true, 'deactivate_missing' => true],
            default => [],
        };
    }

    /** @return string[] what a kind needs before it can be turned on */
    public static function missing(string $kind, array $config, array $secrets): array
    {
        $need = match ($kind) {
            'saml' => ['idp_entity_id' => 'the identity provider\'s entity ID', 'idp_sso_url' => 'its sign-in (SSO) URL', 'idp_x509_cert' => 'its signing certificate'],
            'clever' => ['district_id' => 'the Clever district ID'],
            'google' => ['domains' => 'at least one domain'],
            default => [],
        };

        return array_values(array_filter($need, fn ($label, $key) => empty($config[$key]), ARRAY_FILTER_USE_BOTH));
    }

    private function clean(int $orgId, string $kind, string $key, mixed $value): mixed
    {
        $text = fn () => trim(is_scalar($value) ? (string) $value : '');
        switch ($key) {
            case 'create_users':
            case 'deactivate_missing':
            case 'allow_idp_initiated':
                return (bool) $value;
            case 'idp_entity_id':
                $v = $text();
                if (mb_strlen($v) > 255) {
                    throw new StoreError(422, 'The entity ID is at most 255 characters.');
                }

                return $v;
            case 'idp_sso_url':
                $v = $text();
                if ($v !== '' && (! filter_var($v, FILTER_VALIDATE_URL) || ! preg_match('#^https://#i', $v))) {
                    throw new StoreError(422, 'The sign-in URL is the identity provider\'s https:// address for SAML sign-in.');
                }

                return $v;
            case 'idp_x509_cert':
                return self::cleanCertificate($text());
            case 'id_attribute':
            case 'role_attribute':
                $v = $text();
                if (strlen($v) > 200) {
                    throw new StoreError(422, 'An attribute name is at most 200 characters.');
                }

                return $v;
            case 'teacher_values':
                $list = is_array($value) ? $value : preg_split('/[\s,;]+/', (string) $value);

                return array_values(array_unique(array_filter(array_map(fn ($v) => strtolower(trim((string) $v)), $list), 'strlen')));
            case 'district_id':
                $v = $text();
                if ($v !== '' && ! preg_match('/^[A-Za-z0-9]{6,64}$/', $v)) {
                    throw new StoreError(422, 'A Clever district ID is letters and digits, as Clever shows it (24 characters).');
                }
                foreach ($this->all("SELECT organization_id, config FROM org_integrations WHERE kind = 'clever' AND organization_id <> ?", [$orgId]) as $row) {
                    if ($v !== '' && (self::json($row['config'])['district_id'] ?? null) === $v) {
                        throw new StoreError(409, 'That Clever district is already connected to another organization.');
                    }
                }

                return $v;
            case 'domains':
                $list = is_array($value) ? $value : preg_split('/[\s,;]+/', (string) $value);
                $domains = array_values(array_unique(array_filter(array_map(fn ($d) => strtolower(trim((string) $d, " \t.@")), $list), 'strlen')));
                foreach ($domains as $d) {
                    if (! preg_match('/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $d)) {
                        throw new StoreError(422, "\"$d\" is not a domain name, such as riverside.k12.ca.us.");
                    }
                    if (in_array($d, ['gmail.com', 'googlemail.com'], true)) {
                        throw new StoreError(422, 'Only a school\'s or district\'s own Google Workspace domains can be claimed.');
                    }
                    foreach ($this->all("SELECT organization_id, config FROM org_integrations WHERE kind = 'google' AND organization_id <> ?", [$orgId]) as $row) {
                        if (in_array($d, (array) (self::json($row['config'])['domains'] ?? []), true)) {
                            throw new StoreError(409, "$d is already claimed by another organization.");
                        }
                    }
                }

                return $domains;
            case 'admin_email':
                $v = strtolower($text());
                if ($v !== '' && ! filter_var($v, FILTER_VALIDATE_EMAIL)) {
                    throw new StoreError(422, 'The administrator is a Google Workspace user\'s email address.');
                }

                return $v;
        }

        return $value;
    }

    private static function cleanSecret(string $key, string $value): string
    {
        if ($key === 'service_account_json') {
            $json = json_decode($value, true);
            if (! is_array($json) || empty($json['client_email']) || empty($json['private_key']) || ($json['type'] ?? '') !== 'service_account') {
                throw new StoreError(422, 'Paste the whole JSON key file of a Google service account.');
            }
            if (! openssl_pkey_get_private((string) $json['private_key'])) {
                throw new StoreError(422, 'The service account key\'s private_key cannot be read.');
            }

            return json_encode(array_intersect_key($json, array_flip(['type', 'client_email', 'private_key', 'private_key_id', 'token_uri', 'client_id'])), JSON_UNESCAPED_SLASHES);
        }
        if (strlen($value) > 4000) {
            throw new StoreError(422, 'That is too long to be a token.');
        }

        return $value;
    }

    /** A certificate as OneLogin wants it: the base64 body, checked to be a certificate. */
    public static function cleanCertificate(string $cert): string
    {
        $body = preg_replace('/-----(BEGIN|END) CERTIFICATE-----|\s+/', '', $cert);
        if ($body === '') {
            return '';
        }
        $pem = "-----BEGIN CERTIFICATE-----\n".chunk_split($body, 64, "\n")."-----END CERTIFICATE-----\n";
        if (! @openssl_x509_read($pem)) {
            throw new StoreError(422, 'That is not an X.509 certificate. Paste the identity provider\'s signing certificate (PEM or base64).');
        }

        return $body;
    }

    /**
     * The three things QBL needs from an identity provider's SAML metadata XML: its entity ID, its
     * sign-in address (HTTP-Redirect binding, else HTTP-POST) and its signing certificate.
     *
     * @return array{idp_entity_id: string, idp_sso_url: string, idp_x509_cert: string}
     */
    public static function parseIdpMetadata(string $xml): array
    {
        $doc = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        // No network, no entities: the metadata is text someone pasted.
        $ok = strlen($xml) < 500_000 && $doc->loadXML($xml, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (! $ok || $doc->doctype !== null) {
            throw new StoreError(422, 'That is not SAML metadata XML.');
        }
        $x = new DOMXPath($doc);
        $x->registerNamespace('md', 'urn:oasis:names:tc:SAML:2.0:metadata');
        $x->registerNamespace('ds', 'http://www.w3.org/2000/09/xmldsig#');
        $entity = $x->query('//md:EntityDescriptor[md:IDPSSODescriptor]')->item(0);
        if (! $entity) {
            throw new StoreError(422, 'The metadata has no identity provider (IDPSSODescriptor) in it.');
        }
        $url = '';
        foreach (['urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'] as $binding) {
            $node = $x->query(".//md:IDPSSODescriptor/md:SingleSignOnService[@Binding='$binding']", $entity)->item(0);
            if ($node) {
                $url = $node->getAttribute('Location');
                break;
            }
        }
        $cert = $x->query(".//md:IDPSSODescriptor/md:KeyDescriptor[not(@use) or @use='signing']//ds:X509Certificate", $entity)->item(0);

        return [
            'idp_entity_id' => $entity->getAttribute('entityID'),
            'idp_sso_url' => $url,
            'idp_x509_cert' => $cert ? self::cleanCertificate($cert->textContent) : '',
        ];
    }

    private function row(int $orgId, string $kind): ?array
    {
        return $this->one('SELECT * FROM org_integrations WHERE organization_id = ? AND kind = ?', [$orgId, $kind]);
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `org_integrations` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `organization_id` INTEGER, `kind`, `enabled` INTEGER DEFAULT 0, `config`, `secrets`, `last_sync_at`, `created_at`, `updated_at`, UNIQUE (`organization_id`, `kind`))',
            'CREATE TABLE IF NOT EXISTS `integration_runs` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `organization_id` INTEGER, `kind`, `status` DEFAULT \'queued\', `user_id` INTEGER, `summary`, `error`, `started_at`, `finished_at`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `organization_admins` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `organization_id` INTEGER, `user_id` INTEGER, `created_at`, `updated_at`, UNIQUE (`organization_id`, `user_id`))',
        ];
    }
}

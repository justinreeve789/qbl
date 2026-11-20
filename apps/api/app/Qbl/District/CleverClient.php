<?php

namespace App\Qbl\District;

use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\StoreError;
use Throwable;

/**
 * Clever, for one QBL Clever application (CLEVER_CLIENT_ID / CLEVER_CLIENT_SECRET) that districts
 * connect to in their Clever dashboard:
 *
 *   - Instant Login: OAuth 2 (authorize -> code -> token -> /v3.0/me: who, which district, what kind)
 *   - Secure Sync: the district's schools, teachers, students and sections, read with the
 *     district's token, as rosters (names and emails are never asked for or kept)
 */
class CleverClient
{
    public const PREFIX = 'clever:';

    public function __construct(
        private HttpClient $http,
        private string $clientId,
        private string $clientSecret,
        private string $apiBase = 'https://api.clever.com',
        private string $authBase = 'https://clever.com',
    ) {}

    public function configured(): bool
    {
        return $this->clientId !== '' && $this->clientSecret !== '';
    }

    public function authorizeUrl(string $redirectUri, string $state, ?string $districtId = null): string
    {
        return rtrim($this->authBase, '/').'/oauth/authorize?'.http_build_query(array_filter([
            'response_type' => 'code', 'client_id' => $this->clientId, 'redirect_uri' => $redirectUri, 'state' => $state, 'district_id' => $districtId,
        ]));
    }

    /** The code Clever sent back, for a token good for /me. */
    public function exchange(string $code, string $redirectUri): string
    {
        $data = $this->call('POST', rtrim($this->authBase, '/').'/oauth/tokens', ['Authorization' => $this->basic()], ['code' => $code, 'grant_type' => 'authorization_code', 'redirect_uri' => $redirectUri]);

        return (string) ($data['access_token'] ?? throw new StoreError(502, 'Clever did not give a token.'));
    }

    /** @return array{id: string, district: string, type: string} who signed in */
    public function me(string $token): array
    {
        $data = $this->call('GET', rtrim($this->apiBase, '/').'/v3.0/me', ['Authorization' => "Bearer $token"]);
        $me = $data['data'] ?? [];

        return ['id' => (string) ($me['id'] ?? ''), 'district' => (string) ($me['district'] ?? ''), 'type' => (string) ($me['type'] ?? '')];
    }

    /** The district's token for its rosters: the one given in the panel, else the one Clever issued to QBL's app. */
    public function districtToken(string $districtId, ?string $given = null): string
    {
        if ($given !== null && $given !== '') {
            return $given;
        }
        if (! $this->configured()) {
            throw new StoreError(503, 'Clever is not set up on this site (CLEVER_CLIENT_ID and CLEVER_CLIENT_SECRET), and no district token was given.');
        }
        $data = $this->call('GET', rtrim($this->authBase, '/').'/oauth/tokens?'.http_build_query(['owner_type' => 'district', 'district' => $districtId]), ['Authorization' => $this->basic()]);
        foreach ($data['data'] ?? [] as $t) {
            if (($t['owner']['id'] ?? $districtId) === $districtId && ! empty($t['access_token'])) {
                return (string) $t['access_token'];
            }
        }
        throw new StoreError(404, 'Clever has no token for that district: has the district added QBL\'s application in its Clever dashboard?');
    }

    /** The district's rosters, in RosterSync's shape. */
    public function roster(string $token): array
    {
        $schools = [];
        foreach ($this->pages($token, '/v3.0/schools?limit=1000') as $s) {
            $schools[] = ['external_id' => self::PREFIX.$s['id'], 'name' => (string) ($s['name'] ?? '')];
        }
        $teachers = [];
        foreach ($this->pages($token, '/v3.0/users?role=teacher&limit=1000') as $u) {
            $school = $u['roles']['teacher']['school'] ?? ($u['roles']['teacher']['schools'][0] ?? null);
            $teachers[$u['id']] = ['external_id' => self::PREFIX.$u['id'], 'school' => $school ? self::PREFIX.$school : null];
        }
        $students = [];
        foreach ($this->pages($token, '/v3.0/users?role=student&limit=1000') as $u) {
            $role = $u['roles']['student'] ?? [];
            $school = $role['school'] ?? ($role['schools'][0] ?? null);
            $students[$u['id']] = ['external_id' => self::PREFIX.$u['id'], 'school' => $school ? self::PREFIX.$school : null, 'grade_level' => self::grade($role['grade'] ?? null), 'teachers' => []];
        }
        // A section is a class: its teachers teach its students.
        foreach ($this->pages($token, '/v3.0/sections?limit=1000') as $section) {
            $ts = array_unique(array_filter([...($section['teachers'] ?? []), $section['teacher'] ?? null]));
            foreach ($section['students'] ?? [] as $sid) {
                if (isset($students[$sid])) {
                    foreach ($ts as $tid) {
                        if (isset($teachers[$tid])) {
                            $students[$sid]['teachers'][] = self::PREFIX.$tid;
                        }
                    }
                }
            }
        }

        return ['schools' => $schools, 'teachers' => array_values($teachers), 'students' => array_values($students)];
    }

    /** A quick check that the token reads the district: how many schools it sees. */
    public function check(string $token): array
    {
        $count = 0;
        foreach ($this->pages($token, '/v3.0/schools?limit=100') as $_) {
            $count++;
        }

        return ['schools' => $count];
    }

    /** Clever's grade names as QBL's grade levels. */
    public static function grade(mixed $grade): ?string
    {
        $grade = trim((string) $grade);

        return match (true) {
            $grade === '' => null,
            ctype_digit($grade) && (int) $grade >= 1 && (int) $grade <= 12 => (string) (int) $grade,
            $grade === 'Kindergarten' => 'K',
            $grade === 'PreKindergarten', $grade === 'Preschool', $grade === 'InfantToddler' => 'PK',
            $grade === 'TransitionalKindergarten' => 'TK',
            $grade === 'Ungraded' => 'UG',
            $grade === 'PostGraduate' => 'PS',
            default => null,
        };
    }

    /** Every item of a list, following Clever's "next" links. @return \Generator<array> */
    private function pages(string $token, string $path): \Generator
    {
        $next = $path;
        for ($page = 0; $next !== null && $page < 1000; $page++) {
            $data = $this->call('GET', preg_match('#^https://#', $next) ? $next : rtrim($this->apiBase, '/').$next, ['Authorization' => "Bearer $token"]);
            foreach ($data['data'] ?? [] as $item) {
                if (isset($item['data']['id'])) {
                    yield $item['data'];
                }
            }
            $next = null;
            foreach ($data['links'] ?? [] as $link) {
                if (($link['rel'] ?? '') === 'next' && ! empty($link['uri'])) {
                    $next = (string) $link['uri'];
                }
            }
        }
    }

    private function call(string $method, string $url, array $headers, ?array $json = null): array
    {
        try {
            $response = $this->http->send($method, $url, $headers + ['Accept' => 'application/json'], $json, false, 60);
        } catch (Throwable) {
            throw new StoreError(502, 'Could not reach Clever.');
        }
        $data = json_decode($response->body, true);
        if (! $response->ok()) {
            $message = is_array($data) ? ($data['error_description'] ?? $data['message'] ?? $data['error'] ?? null) : null;
            throw new StoreError($response->status === 401 ? 401 : 502, 'Clever answered '.$response->status.($message ? ": $message" : '.'));
        }

        return is_array($data) ? $data : [];
    }

    private function basic(): string
    {
        return 'Basic '.base64_encode($this->clientId.':'.$this->clientSecret);
    }
}

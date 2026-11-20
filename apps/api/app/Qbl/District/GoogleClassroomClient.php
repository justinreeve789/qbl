<?php

namespace App\Qbl\District;

use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\StoreError;
use Throwable;

/**
 * Google Classroom rosters, read with a district's service account that has domain-wide
 * delegation for the two read-only scopes below, acting as one of its Workspace administrators.
 * A course's teachers teach its students. People are known by their Google account id (the same
 * id Google sign-in gives), so "google:<id>"; their names and addresses are not read.
 */
class GoogleClassroomClient
{
    public const PREFIX = 'google:';

    public const SCOPES = [
        'https://www.googleapis.com/auth/classroom.courses.readonly',
        'https://www.googleapis.com/auth/classroom.rosters.readonly',
    ];

    public function __construct(private HttpClient $http, private string $apiBase = 'https://classroom.googleapis.com', private ?\Closure $now = null) {}

    /** An access token for the service account, acting as `$subject` (a Workspace administrator). */
    public function token(array $serviceAccount, string $subject): string
    {
        if ($subject === '') {
            throw new StoreError(422, 'Give the email address of a Google Workspace administrator for the service account to act as.');
        }
        $now = $this->now ? ($this->now)() : time();
        $tokenUri = (string) ($serviceAccount['token_uri'] ?? 'https://oauth2.googleapis.com/token');
        $b64 = fn (string $s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $unsigned = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])).'.'.$b64(json_encode([
            'iss' => $serviceAccount['client_email'] ?? '', 'sub' => $subject, 'scope' => implode(' ', self::SCOPES),
            'aud' => $tokenUri, 'iat' => $now, 'exp' => $now + 3600,
        ], JSON_UNESCAPED_SLASHES));
        $key = openssl_pkey_get_private((string) ($serviceAccount['private_key'] ?? ''));
        if (! $key || ! openssl_sign($unsigned, $signature, $key, OPENSSL_ALGO_SHA256)) {
            throw new StoreError(422, 'The service account key cannot sign.');
        }
        $body = http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $unsigned.'.'.$b64($signature)]);
        $data = $this->call('POST', $tokenUri, ['Content-Type' => 'application/x-www-form-urlencoded'], $body);

        return (string) ($data['access_token'] ?? throw new StoreError(502, 'Google did not give a token.'));
    }

    /** Active courses' teachers and students, in RosterSync's shape. */
    public function roster(string $token): array
    {
        $teachers = [];
        $students = [];
        foreach ($this->pages($token, '/v1/courses?courseStates=ACTIVE&pageSize=100', 'courses') as $course) {
            $id = rawurlencode((string) $course['id']);
            $courseTeachers = [];
            foreach ($this->pages($token, "/v1/courses/$id/teachers?pageSize=100", 'teachers') as $t) {
                $courseTeachers[] = self::PREFIX.$t['userId'];
            }
            if (! empty($course['ownerId'])) {
                $courseTeachers[] = self::PREFIX.$course['ownerId'];
            }
            foreach (array_unique($courseTeachers) as $ext) {
                $teachers[$ext] = ['external_id' => $ext];
            }
            foreach ($this->pages($token, "/v1/courses/$id/students?pageSize=100", 'students') as $s) {
                $ext = self::PREFIX.$s['userId'];
                $students[$ext] ??= ['external_id' => $ext, 'teachers' => []];
                $students[$ext]['teachers'] = array_values(array_unique([...$students[$ext]['teachers'], ...$courseTeachers]));
            }
        }
        // Someone who teaches one course and takes another is a teacher here.
        $students = array_diff_key($students, $teachers);

        return ['schools' => [], 'teachers' => array_values($teachers), 'students' => array_values($students)];
    }

    public function check(string $token): array
    {
        $data = $this->call('GET', rtrim($this->apiBase, '/').'/v1/courses?courseStates=ACTIVE&pageSize=1', ['Authorization' => "Bearer $token"]);

        return ['courses_visible' => count($data['courses'] ?? []) > 0];
    }

    /** @return \Generator<array> */
    private function pages(string $token, string $path, string $key): \Generator
    {
        $pageToken = null;
        for ($page = 0; $page < 2000; $page++) {
            $url = rtrim($this->apiBase, '/').$path.($pageToken ? '&pageToken='.rawurlencode($pageToken) : '');
            $data = $this->call('GET', $url, ['Authorization' => "Bearer $token"]);
            foreach ($data[$key] ?? [] as $item) {
                yield $item;
            }
            $pageToken = $data['nextPageToken'] ?? null;
            if (! $pageToken) {
                return;
            }
        }
    }

    private function call(string $method, string $url, array $headers, ?string $body = null): array
    {
        try {
            $response = $this->http->send($method, $url, $headers + ['Accept' => 'application/json'], $body, false, 60);
        } catch (Throwable) {
            throw new StoreError(502, 'Could not reach Google.');
        }
        $data = json_decode($response->body, true);
        if (! $response->ok()) {
            $message = is_array($data) ? ($data['error_description'] ?? $data['error']['message'] ?? (is_string($data['error'] ?? null) ? $data['error'] : null)) : null;
            throw new StoreError($response->status === 401 || $response->status === 403 ? 403 : 502, 'Google answered '.$response->status.($message ? ": $message" : '.'));
        }

        return is_array($data) ? $data : [];
    }
}

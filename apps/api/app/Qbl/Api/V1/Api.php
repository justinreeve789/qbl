<?php

namespace App\Qbl\Api\V1;

use App\Qbl\ActivityStore;
use App\Qbl\Api\ApiError;
use App\Qbl\Api\Clients;
use App\Qbl\Api\Launches;
use App\Qbl\Api\OrgAvatars;
use App\Qbl\Api\Privacy;
use App\Qbl\Api\Reports;
use App\Qbl\Api\Roster;
use App\Qbl\ClassStore;
use App\Qbl\StoreError;
use PDO;

/**
 * The public API, version 1: everything under /api/v1, for schools, districts and businesses.
 * Without a framework, like EditorApi and ClassApi: Laravel's controller only translates.
 * The reference is docs/src/content/docs/developers/api-v1.md; keep the two together.
 *
 * Version 1 is a promise: fields are only ever added to its answers, never renamed or removed,
 * and its rules only loosen. Anything else is version 2, at /api/v2, served beside this one.
 *
 *   POST   oauth/token                         client credentials → access token
 *   GET    launch/{code}  POST launch/{code}   a one-time sign-in link (browser)
 *
 *   GET    /                                    which version this is, and its scopes
 *   GET    organization     PATCH organization
 *   GET    schools          POST schools        GET|PATCH|DELETE schools/{id}
 *   GET    teachers         POST teachers       POST teachers/batch     GET|PATCH|DELETE teachers/{id}    POST teachers/{id}/launch
 *   GET    students         POST students       POST students/batch     GET|PATCH|DELETE students/{id}    POST students/{id}/launch
 *   GET    students/{id}/export                 GET students/{id}/report
 *   GET    enrollments      POST enrollments    DELETE enrollments?teacher_id=&student_id=
 *   GET    scenarios        GET scenarios/{id}
 *   GET    assignments      POST assignments    GET|PATCH|DELETE assignments/{id}
 *   GET    assignments/{id}/teams   POST assignments/{id}/teams   PATCH|DELETE teams/{id}
 *   GET    assignments/{id}/report  /grades  /activity  /messages
 *   GET    avatars          POST avatars        GET|PATCH|DELETE avatars/{id}
 *   GET    reports/summary  reports/engagement  reports/learning  reports/standards
 *   GET    activity                             the activity feed, for a warehouse
 *   GET    audit-log
 *
 * A person in a path may be given by QBL id or as `ext:` and the organization's external_id.
 */
class Api
{
    public const VERSION = '1';

    private Clients $clients;

    private Roster $roster;

    private Reports $reports;

    private ClassStore $classes;

    /** Students whose records the current request reached, for the audit log. */
    private array $touched = [];

    public function __construct(private PDO $pdo, private ?string $mediaDir = null, private string $mediaUrl = '/media', private string $publicUrl = '', private ?array $ranks = null)
    {
        $this->clients = new Clients($pdo);
        $this->roster = new Roster($pdo, $this->clients);
        $this->reports = new Reports($pdo, $ranks);
        $this->classes = new ClassStore($pdo);
    }

    public function clients(): Clients
    {
        return $this->clients;
    }

    /**
     * @param  array  $files  uploaded files by field: ['image' => ['tmp_name' => ...]]
     * @param  array  $auth  ['bearer' => ?string, 'basic' => ?[id, secret]]
     * @return array{0: int, 1: mixed, 2?: array} status, body (null for none; ['csv' => ..] or ['html' => ..] for those), headers
     */
    public function handle(string $method, string $path, array $query, array $body, array $files = [], array $auth = []): array
    {
        $method = strtoupper($method);
        $parts = array_values(array_filter(explode('/', trim($path, '/')), 'strlen'));
        $this->touched = [];
        $who = null;
        $status = 500;
        try {
            // The two doors that need no access token.
            if ($parts === ['oauth', 'token'] && $method === 'POST') {
                return [$status = 200, $this->token($body, $auth), ['Cache-Control' => 'no-store']];
            }
            if (count($parts) === 2 && $parts[0] === 'launch') {
                return $this->launch($method, $parts[1], $status);
            }

            $who = $this->clients->authenticate($auth['bearer'] ?? null);
            [$status, $out] = $this->route($method, $parts, $query, $body, $files, $who);

            return [$status, $out];
        } catch (ApiError $e) {
            $status = $e->status;

            return [$e->status, ['error' => array_filter(['code' => $e->errorCode, 'message' => $e->getMessage(), 'fields' => $e->fields ?: null])]];
        } catch (StoreError $e) {
            $status = $e->status;

            return [$e->status, ['error' => ['code' => match ($e->status) {
                404 => 'not_found', 403 => 'forbidden', 409 => 'conflict', 401 => 'unauthenticated', default => 'invalid_request'
            }, 'message' => $e->getMessage()]]];
        } finally {
            if ($who) {
                $this->clients->audit($who['organization']['id'], $who['client_id'], $method, '/api/v1/'.implode('/', $parts).($query ? '?'.http_build_query($query) : ''), $status, $this->touched);
            }
        }
    }

    private function route(string $method, array $p, array $q, array $b, array $files, array $who): array
    {
        $root = $who['organization']['id'];
        $need = function (string $scope) use ($who) {
            if (! in_array($scope, $who['scopes'], true)) {
                throw new ApiError(403, 'insufficient_scope', "This needs the $scope scope.");
            }
        };
        $n = count($p);
        $first = $p[0] ?? '';
        $route = $method.' '.implode('/', array_map(fn ($s, $i) => $i > 0 && $this->isId($s) ? '{id}' : $s, $p, array_keys($p)));
        $id = fn (int $i, string $role = 'student') => $this->personId($root, $role, $p[$i]);
        $num = fn (int $i) => ctype_digit($p[$i]) ? (int) $p[$i] : throw ApiError::notFound();

        switch ($route) {
            case 'GET ':
                return [200, ['data' => ['api' => 'QBL', 'version' => 'v'.self::VERSION, 'organization_id' => $root, 'scopes' => $who['scopes'], 'documentation' => rtrim($this->publicUrl, '/').'/docs/developers/api-v1/']]];

                // ---------------------------------------------------------- organization
            case 'GET organization':
                return [200, ['data' => $who['organization']]];
            case 'PATCH organization':
                $need('roster:write');

                return [200, ['data' => $this->clients->updateOrganization($root, array_intersect_key($b, ['name' => 1, 'external_id' => 1, 'data_retention_days' => 1]))]];

                // --------------------------------------------------------------- schools
            case 'GET schools':
                $need('roster:read');

                return [200, ['data' => $this->roster->schools($root)]];
            case 'POST schools':
                $need('roster:write');

                return [201, ['data' => $this->roster->createSchool($root, $b)]];
            case 'GET schools/{id}':
                $need('roster:read');

                return [200, ['data' => $this->roster->school($root, $num(1))]];
            case 'PATCH schools/{id}':
                $need('roster:write');

                return [200, ['data' => $this->roster->updateSchool($root, $num(1), $b)]];
            case 'DELETE schools/{id}':
                $need('roster:write');
                $this->roster->deleteSchool($root, $num(1));

                return [204, null];

                // ----------------------------------------------------- teachers, students
            case 'GET teachers': case 'GET students':
                $need('roster:read');
                $role = rtrim($first, 's');
                [$people, $next] = $this->roster->people($root, $role, array_intersect_key($q, array_flip(['school_id', 'status', 'external_id', 'teacher_id', 'updated_since'])), (int) ($q['limit'] ?? 100), $q['cursor'] ?? null);

                return [200, ['data' => $people, 'meta' => ['next_cursor' => $next]]];
            case 'POST teachers': case 'POST students':
                $need('roster:write');
                $person = $this->roster->create($root, rtrim($first, 's'), $b);
                $this->touch($person);

                return [201, ['data' => $person]];
            case 'POST teachers/batch': case 'POST students/batch':
                $need('roster:write');
                $results = $this->roster->upsert($root, rtrim($first, 's'), $b[$first] ?? $b['data'] ?? []);
                if ($first === 'students') {
                    $this->touched = array_filter(array_column($results, 'id'));
                }

                return [200, ['data' => $results, 'meta' => [
                    'created' => count(array_filter($results, fn ($r) => $r['result'] === 'created')),
                    'updated' => count(array_filter($results, fn ($r) => $r['result'] === 'updated')),
                    'errors' => count(array_filter($results, fn ($r) => $r['result'] === 'error')),
                ]]];
            case 'GET teachers/{id}': case 'GET students/{id}':
                $need('roster:read');
                $person = $this->roster->person($root, rtrim($first, 's'), $id(1, rtrim($first, 's')));
                $this->touch($person);

                return [200, ['data' => $person]];
            case 'PATCH teachers/{id}': case 'PATCH students/{id}':
                $need('roster:write');
                $person = $this->roster->update($root, rtrim($first, 's'), $id(1, rtrim($first, 's')), $b);
                $this->touch($person);

                return [200, ['data' => $person]];
            case 'DELETE teachers/{id}': case 'DELETE students/{id}':
                $need('privacy');
                $role = rtrim($first, 's');
                $who2 = $id(1, $role);
                $role === 'student' && $this->touched = [$who2];
                $transfer = isset($q['transfer_to']) ? $this->personId($root, 'teacher', (string) $q['transfer_to']) : null;

                return [200, ['data' => ['id' => $who2] + $this->roster->delete($root, $role, $who2, $transfer)]];
            case 'GET students/{id}/export':
                $need('privacy');
                $this->touched = [$sid = $id(1)];

                return [200, ['data' => $this->roster->export($root, $sid)]];
            case 'GET students/{id}/report':
                $need('reports:read');
                $this->touched = [$sid = $id(1)];

                return [200, ['data' => $this->reports->student($root, $sid, array_intersect_key($q, ['from' => 1, 'to' => 1, 'timezone' => 1]))]];
            case 'POST teachers/{id}/launch': case 'POST students/{id}/launch':
                $need('launch');
                $role = rtrim($first, 's');
                $row = $this->roster->row($root, $role, $id(1, $role));
                $role === 'student' && $this->touched = [(int) $row['id']];

                return [201, ['data' => (new Launches($this->pdo, $this->publicUrl))->create($row, $who['client_id'], array_intersect_key($b, ['to' => 1, 'assignment_id' => 1]))]];

                // ----------------------------------------------------------- enrollments
            case 'GET enrollments':
                $need('roster:read');

                return [200, ['data' => $this->roster->enrollments($root, isset($q['teacher_id']) ? $this->personId($root, 'teacher', (string) $q['teacher_id']) : null, isset($q['student_id']) ? $this->personId($root, 'student', (string) $q['student_id']) : null)]];
            case 'POST enrollments':
                $need('roster:write');
                $teacher = $this->personId($root, 'teacher', (string) ($b['teacher_id'] ?? (isset($b['teacher_external_id']) ? 'ext:'.$b['teacher_external_id'] : '')));
                $students = $this->people($root, 'student', $b);
                $added = $this->roster->enroll($root, $teacher, $students);

                return [200, ['data' => $this->roster->enrollments($root, $teacher), 'meta' => ['added' => $added]]];
            case 'DELETE enrollments':
                $need('roster:write');
                $this->roster->unenroll($root, $this->personId($root, 'teacher', (string) ($q['teacher_id'] ?? '')), $this->personId($root, 'student', (string) ($q['student_id'] ?? '')));

                return [204, null];

                // ------------------------------------------------------------- scenarios
            case 'GET scenarios':
                $need('assignments:read');

                return [200, ['data' => $this->catalogue($root)]];
            case 'GET scenarios/{id}':
                $need('assignments:read');
                $one = array_values(array_filter($this->catalogue($root, true), fn ($s) => $s['id'] === $num(1)))[0] ?? throw ApiError::notFound('The scenario');

                return [200, ['data' => $one]];

                // ----------------------------------------------------------- assignments
            case 'GET assignments':
                $need('assignments:read');

                return [200, ['data' => $this->assignments($root, $q)]];
            case 'POST assignments':
                $need('assignments:write');

                return [201, ['data' => $this->assign($root, $b)]];
            case 'GET assignments/{id}':
                $need('assignments:read');

                return [200, ['data' => $this->assignment($root, $num(1))]];
            case 'PATCH assignments/{id}':
                $need('assignments:write');

                return [200, ['data' => $this->updateAssignment($root, $num(1), $b)]];
            case 'DELETE assignments/{id}':
                $need('assignments:write');
                $a = $this->reports->assignmentRow($root, $num(1));
                $this->classes->unassign((int) $a['teacher_id'], (int) $a['id']);

                return [204, null];
            case 'GET assignments/{id}/teams':
                $need('assignments:read');

                return [200, ['data' => $this->assignment($root, $num(1))['teams']]];
            case 'POST assignments/{id}/teams':
                $need('assignments:write');
                $a = $this->assignment($root, $num(1));
                $members = $this->people($root, 'student', $b);
                $teams = array_map(fn ($t) => ['id' => $t['id'], 'name' => $t['name'], 'student_ids' => array_values(array_diff($t['student_ids'], $members))], $a['teams']);
                $teams[] = ['name' => Privacy::text($b['name'] ?? null, 'name', 64) ?? 'Team '.(count($teams) + 1), 'student_ids' => $members];
                $after = $this->updateAssignment($root, $a['id'], ['teams' => $teams, 'student_ids' => array_values(array_unique(array_merge($a['student_ids'], $members)))]);

                return [201, ['data' => end($after['teams'])]];
            case 'PATCH teams/{id}': case 'DELETE teams/{id}':
                $need('assignments:write');
                $teamId = $num(1);
                $assignmentId = (int) ($this->one('SELECT assignment_id FROM teams WHERE id = ?', [$teamId])['assignment_id'] ?? 0);
                $a = $this->assignment($root, $assignmentId ?: throw ApiError::notFound('The team'));
                $members = $method === 'PATCH' && (isset($b['student_ids']) || isset($b['student_external_ids'])) ? $this->people($root, 'student', $b) : null;
                $teams = [];
                foreach ($a['teams'] as $t) {
                    if ($t['id'] === $teamId) {
                        if ($method === 'DELETE') {
                            continue;
                        }
                        $t = ['id' => $t['id'], 'name' => array_key_exists('name', $b) ? (Privacy::text($b['name'], 'name', 64) ?? $t['name']) : $t['name'], 'student_ids' => $members ?? $t['student_ids']];
                    } elseif ($members) {
                        $t['student_ids'] = array_values(array_diff($t['student_ids'], $members));
                    }
                    $teams[] = ['id' => $t['id'], 'name' => $t['name'], 'student_ids' => $t['student_ids']];
                }
                $after = $this->updateAssignment($root, $a['id'], ['teams' => $teams, 'student_ids' => array_values(array_unique(array_merge($a['student_ids'], $members ?? [])))]);
                if ($method === 'DELETE') {
                    return [204, null];
                }

                return [200, ['data' => array_values(array_filter($after['teams'], fn ($t) => $t['id'] === $teamId))[0]]];

                // --------------------------------------------------------------- reports
            case 'GET assignments/{id}/report':
                $need('reports:read');
                $report = $this->reports->assignment($root, $num(1));
                $this->touched = array_column($report['students'], 'student_id');

                return [200, ['data' => $report]];
            case 'GET assignments/{id}/grades':
                $need('reports:read');
                $grades = $this->reports->grades($root, $num(1));
                $this->touched = array_column($grades, 'student_id');
                if (($q['format'] ?? '') === 'csv') {
                    return [200, ['csv' => self::csv($grades), 'filename' => 'assignment-'.$num(1).'-grades.csv']];
                }

                return [200, ['data' => $grades]];
            case 'GET assignments/{id}/activity':
                $need('reports:read');
                $student = isset($q['student_id']) ? $this->personId($root, 'student', (string) $q['student_id']) : null;
                $rows = $this->reports->assignmentActivity($root, $num(1), $student, (int) ($q['limit'] ?? 500));
                $this->touched = array_column($rows, 'student_id');

                return [200, ['data' => $rows]];
            case 'GET assignments/{id}/messages':
                $need('messages:read');
                $rows = $this->reports->assignmentMessages($root, $num(1), (int) ($q['limit'] ?? 1000));
                $this->touched = array_column($rows, 'from_id');

                return [200, ['data' => $rows]];
            case 'GET reports/summary':
                $need('reports:read');

                return [200, ['data' => $this->reports->summary($root, $this->filter($root, $q))]];
            case 'GET reports/engagement':
                $need('reports:read');
                $report = $this->reports->engagement($root, $this->filter($root, $q) + array_intersect_key($q, array_flip(['from', 'to', 'timezone', 'interval', 'group_by'])) + ['include_students' => ($q['include'] ?? '') === 'students' || ($q['format'] ?? '') === 'csv']);
                if (($q['format'] ?? '') === 'csv') {
                    return [200, ['csv' => self::csv($report['students']), 'filename' => 'engagement.csv']];
                }

                return [200, ['data' => $report]];
            case 'GET reports/learning':
                $need('reports:read');

                return [200, ['data' => $this->reports->learning($root, $this->filter($root, $q) + array_intersect_key($q, ['from' => 1, 'to' => 1, 'scenario_id' => 1]))]];
            case 'GET reports/standards':
                $need('reports:read');

                return [200, ['data' => $this->reports->learning($root, $this->filter($root, $q) + array_intersect_key($q, ['from' => 1, 'to' => 1]))['standards']]];
            case 'GET activity':
                $need('reports:read');
                [$rows, $next] = $this->reports->feed($root, $q['cursor'] ?? null, (int) ($q['limit'] ?? 1000), array_intersect_key($q, ['since' => 1, 'types' => 1]));

                return [200, ['data' => $rows, 'meta' => ['next_cursor' => $next]]];
            case 'GET audit-log':
                $need('audit:read');
                $rows = $this->clients->auditLog($root, max(1, min(1000, (int) ($q['limit'] ?? 100))), isset($q['cursor']) ? Roster::cursor((string) $q['cursor']) : null, isset($q['student_id']) ? (int) $q['student_id'] : null);

                return [200, ['data' => $rows, 'meta' => ['next_cursor' => count($rows) ? (string) end($rows)['id'] : null]]];

                // --------------------------------------------------------------- avatars
            case 'GET avatars':
                $need('avatars:read');

                return [200, ['data' => (new OrgAvatars($this->pdo, $this->mediaDir, $this->mediaUrl))->list($root, ($q['include'] ?? '') === 'inactive')]];
            case 'POST avatars':
                $need('avatars:write');

                return [201, ['data' => (new OrgAvatars($this->pdo, $this->mediaDir, $this->mediaUrl))->create($root, self::typed($b), $files)]];
            case 'GET avatars/{id}':
                $need('avatars:read');

                return [200, ['data' => (new OrgAvatars($this->pdo, $this->mediaDir, $this->mediaUrl))->get($root, $num(1))]];
            case 'PATCH avatars/{id}':
                $need('avatars:write');

                return [200, ['data' => (new OrgAvatars($this->pdo, $this->mediaDir, $this->mediaUrl))->update($root, $num(1), self::typed($b), $files)]];
            case 'DELETE avatars/{id}':
                $need('avatars:write');
                (new OrgAvatars($this->pdo, $this->mediaDir, $this->mediaUrl))->retire($root, $num(1));

                return [204, null];
        }

        throw new ApiError(404, 'not_found', "There is no $method /api/v1/".implode('/', $p).'.');
    }

    // ------------------------------------------------------------------ helpers

    private function token(array $body, array $auth): array
    {
        if (($body['grant_type'] ?? 'client_credentials') !== 'client_credentials') {
            throw new ApiError(400, 'unsupported_grant_type', 'Only grant_type=client_credentials is supported.');
        }
        [$id, $secret] = $auth['basic'] ?? [$body['client_id'] ?? '', $body['client_secret'] ?? ''];

        return $this->clients->issueToken((string) $id, (string) $secret, isset($body['scope']) ? (string) $body['scope'] : null);
    }

    private function launch(string $method, string $code, int &$status): array
    {
        if ($method === 'GET') {
            return [$status = 200, ['html' => Launches::page()], ['Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer', 'X-Robots-Tag' => 'noindex']];
        }
        if ($method === 'POST') {
            return [$status = 200, ['data' => (new Launches($this->pdo, $this->publicUrl))->redeem($code)], ['Cache-Control' => 'no-store']];
        }
        throw new ApiError(405, 'method_not_allowed', 'Open the link in a browser.');
    }

    private function isId(string $segment): bool
    {
        return ctype_digit($segment) || str_starts_with($segment, 'ext:');
    }

    /** A person named in a path or a field: a QBL id, or `ext:` and the organization's external_id. */
    private function personId(int $root, string $role, string $ref): int
    {
        $ref = rawurldecode($ref);
        if (str_starts_with($ref, 'ext:')) {
            return $this->roster->idOf($root, $role, substr($ref, 4));
        }
        if (! ctype_digit($ref)) {
            throw ApiError::invalid("{$role}_id", "{$role}_id must be a QBL id, or ext: followed by your external_id.");
        }

        return (int) $this->roster->row($root, $role, (int) $ref)['id'];
    }

    /** The students a body lists, as student_ids and/or student_external_ids (or a single student_id). */
    private function people(int $root, string $role, array $b): array
    {
        $ids = [];
        foreach (array_merge((array) ($b["{$role}_ids"] ?? []), isset($b["{$role}_id"]) ? [$b["{$role}_id"]] : []) as $ref) {
            $ids[] = $this->personId($root, $role, (string) $ref);
        }
        foreach ((array) ($b["{$role}_external_ids"] ?? []) as $ext) {
            $ids[] = $this->roster->idOf($root, $role, (string) $ext);
        }

        return array_values(array_unique($ids));
    }

    private function touch(array $person): void
    {
        if ($person['type'] === 'student') {
            $this->touched[] = $person['id'];
        }
    }

    /** school_id, teacher_id and grade_level from a query, checked to be the organization's. */
    private function filter(int $root, array $q): array
    {
        $out = [];
        if (isset($q['school_id'])) {
            $out['school_id'] = $this->roster->school($root, (int) $q['school_id'])['id'];
        }
        if (isset($q['teacher_id'])) {
            $out['teacher_id'] = $this->personId($root, 'teacher', (string) $q['teacher_id']);
        }
        if (isset($q['grade_level'])) {
            $out['grade_level'] = Privacy::gradeLevel($q['grade_level']);
        }

        return $out;
    }

    /** The missions the organization's teachers can assign: public published ones, and their own. */
    private function catalogue(int $root, bool $withDetail = false): array
    {
        $teachers = array_map('intval', array_column($this->all("SELECT id FROM users WHERE organization_id = ? AND role = 'teacher'", [$root]), 'id'));
        $out = [];
        foreach ($this->all('SELECT id, code, title, subtitle, description, user_id, settings, document, max_players, published_at FROM scenarios WHERE published_at IS NOT NULL ORDER BY title, id') as $s) {
            $settings = json_decode((string) ($s['settings'] ?? ''), true) ?: [];
            $visibility = ($settings['visibility'] ?? 'public') === 'private' ? 'private' : 'public';
            $owner = $s['user_id'] === null ? null : (int) $s['user_id'];
            if ($visibility === 'private' && ! in_array($owner, $teachers, true)) {
                continue;
            }
            $doc = json_decode((string) $s['document'], true) ?: [];
            $standards = [];
            try {
                $standards = $this->all('SELECT c.code, c.framework, c.description, ss.alignment FROM scenario_standards ss JOIN curriculum_standards c ON c.id = ss.curriculum_standard_id WHERE ss.scenario_id = ? ORDER BY c.code', [$s['id']]);
            } catch (\PDOException) {
                // a development database without the standards tables
            }
            $entry = [
                'id' => (int) $s['id'], 'code' => $s['code'], 'title' => $s['title'], 'subtitle' => $s['subtitle'], 'description' => $s['description'],
                'visibility' => $visibility, 'owner_teacher_id' => in_array($owner, $teachers, true) ? $owner : null,
                'max_players' => $s['max_players'] === null ? null : (int) $s['max_players'],
                'play_url' => rtrim($this->publicUrl, '/').'/'.$s['code'],
                'standards' => $standards,
                'objectives' => count($doc['objectives'] ?? []), 'glossary_terms' => count($doc['glossary'] ?? []),
                'published_at' => $s['published_at'] ? gmdate('Y-m-d\TH:i:s\Z', strtotime($s['published_at'].' UTC')) : null,
            ];
            if ($withDetail) {
                $entry['learning_objectives'] = array_map(fn ($lo) => ['id' => $lo['id'] ?? null, 'text' => $lo['text'] ?? null, 'standards' => $lo['standards'] ?? []], $doc['curriculum']['learning_objectives'] ?? []);
                $entry['objective_list'] = array_map(fn ($o) => ['id' => $o['id'] ?? null, 'text' => ActivityStore::plain((string) ($o['text'] ?? '')), 'optional' => ! empty($o['optional'])], $doc['objectives'] ?? []);
                $entry['glossary'] = array_map(fn ($g) => ['term' => $g['term'] ?? null, 'definition' => $g['definition'] ?? null], $doc['glossary'] ?? []);
            }
            $out[] = $entry;
        }

        return $out;
    }

    private function assignments(int $root, array $q): array
    {
        $where = ['t.organization_id = ?'];
        $params = [$root];
        if (isset($q['teacher_id'])) {
            $where[] = 'a.teacher_id = ?';
            $params[] = $this->personId($root, 'teacher', (string) $q['teacher_id']);
        }
        if (isset($q['student_id'])) {
            $where[] = 'a.id IN (SELECT assignment_id FROM assignment_student WHERE student_id = ?)';
            $params[] = $this->personId($root, 'student', (string) $q['student_id']);
        }
        if (isset($q['external_id'])) {
            $where[] = 'a.external_id = ?';
            $params[] = (string) $q['external_id'];
        }
        if (isset($q['scenario_id'])) {
            $where[] = 'a.scenario_id = ?';
            $params[] = (int) $q['scenario_id'];
        }

        return array_map(fn ($a) => $this->assignment($root, (int) $a['id']), $this->all('SELECT a.id FROM assignments a JOIN users t ON t.id = a.teacher_id WHERE '.implode(' AND ', $where).' ORDER BY a.id', $params));
    }

    private function assignment(int $root, int $id): array
    {
        $a = $this->reports->assignmentRow($root, $id);
        $students = $this->all('SELECT s.student_id, s.team_id, u.external_id FROM assignment_student s JOIN users u ON u.id = s.student_id WHERE s.assignment_id = ? ORDER BY s.student_id', [$id]);
        $teams = array_map(fn ($t) => [
            'id' => (int) $t['id'], 'name' => $t['name'],
            'student_ids' => array_values(array_map(fn ($s) => (int) $s['student_id'], array_filter($students, fn ($s) => (int) $s['team_id'] === (int) $t['id']))),
        ], $this->all('SELECT id, name FROM teams WHERE assignment_id = ? ORDER BY id', [$id]));
        $code = $this->one('SELECT code, title FROM scenarios WHERE id = ?', [$a['scenario_id']]);

        return [
            'id' => (int) $a['id'], 'external_id' => $a['external_id'] ?? null, 'teacher_id' => (int) $a['teacher_id'],
            'scenario_id' => (int) $a['scenario_id'], 'scenario_title' => $code['title'] ?? null,
            'due_at' => $a['due_at'] ? gmdate('Y-m-d\TH:i:s\Z', strtotime($a['due_at'].' UTC')) : null, 'note' => $a['note'],
            'student_ids' => array_map(fn ($s) => (int) $s['student_id'], $students),
            'teams' => $teams,
            'play_url' => $code ? rtrim($this->publicUrl, '/').'/'.$code['code'].'?group=a'.$a['id'] : null,
            'created_at' => $a['created_at'] ? gmdate('Y-m-d\TH:i:s\Z', strtotime($a['created_at'].' UTC')) : null,
        ];
    }

    private function assign(int $root, array $b): array
    {
        Privacy::refusePii(array_diff_key($b, ['name' => 1]));
        $teacher = $this->personId($root, 'teacher', (string) ($b['teacher_id'] ?? (isset($b['teacher_external_id']) ? 'ext:'.$b['teacher_external_id'] : '')));
        $students = $this->people($root, 'student', $b);
        $scenario = (int) ($b['scenario_id'] ?? 0);
        $externalId = isset($b['external_id']) ? Privacy::externalId($b['external_id']) : null;
        if ($externalId !== null && $this->one('SELECT a.id FROM assignments a JOIN users t ON t.id = a.teacher_id WHERE t.organization_id = ? AND a.external_id = ?', [$root, $externalId])) {
            throw new ApiError(409, 'conflict', "There is already an assignment with external_id $externalId.");
        }
        $teams = $this->teams($root, $b['teams'] ?? []);
        $students = array_values(array_unique(array_merge($students, ...array_column($teams, 'student_ids'))));
        // Assigning to a student of the organization puts them in the teacher's class, as the editor would ask the teacher to.
        $this->roster->enroll($root, $teacher, $students);
        $made = $this->classes->assign($teacher, $scenario, $students, $b['due_at'] ?? null, Privacy::text($b['note'] ?? null, 'note', 255), $teams);
        if ($externalId !== null) {
            $this->run('UPDATE assignments SET external_id = ? WHERE id = ?', [$externalId, $made['id']]);
        }

        return $this->assignment($root, $made['id']);
    }

    private function updateAssignment(int $root, int $id, array $b): array
    {
        $a = $this->reports->assignmentRow($root, $id);
        $attrs = array_intersect_key($b, ['due_at' => 1, 'note' => 1]);
        if (array_key_exists('note', $attrs)) {
            $attrs['note'] = Privacy::text($attrs['note'], 'note', 255);
        }
        if (isset($b['student_ids']) || isset($b['student_external_ids'])) {
            $attrs['student_ids'] = $this->people($root, 'student', $b);
        }
        if (array_key_exists('teams', $b)) {
            $attrs['teams'] = $this->teams($root, (array) $b['teams']);
            $attrs['student_ids'] = array_values(array_unique(array_merge($attrs['student_ids'] ?? array_map('intval', array_column($this->all('SELECT student_id FROM assignment_student WHERE assignment_id = ?', [$id]), 'student_id')), ...array_column($attrs['teams'], 'student_ids'))));
        }
        if (isset($attrs['student_ids'])) {
            $this->roster->enroll($root, (int) $a['teacher_id'], $attrs['student_ids']);
        }
        if (array_key_exists('external_id', $b)) {
            $this->run('UPDATE assignments SET external_id = ? WHERE id = ?', [$b['external_id'] === null ? null : Privacy::externalId($b['external_id']), $id]);
        }
        $this->classes->update((int) $a['teacher_id'], $id, $attrs);

        return $this->assignment($root, $id);
    }

    /** Teams as ClassStore takes them, with their students resolved. */
    private function teams(int $root, mixed $teams): array
    {
        if (! is_array($teams) || ! array_is_list($teams)) {
            throw ApiError::invalid('teams', 'teams is a list of {"name", "student_ids"}.');
        }

        return array_map(fn ($t, $i) => array_filter([
            'id' => isset($t['id']) ? (int) $t['id'] : null,
            'name' => Privacy::text($t['name'] ?? null, "teams.$i.name", 64) ?? 'Team '.($i + 1),
            'student_ids' => $this->people($root, 'student', (array) $t),
        ], fn ($v) => $v !== null), $teams, array_keys($teams));
    }

    /** Multipart fields arrive as strings; turn the structured ones back into what JSON would have given. */
    private static function typed(array $b): array
    {
        foreach (['sheet', 'animations'] as $k) {
            if (isset($b[$k]) && is_string($b[$k])) {
                $b[$k] = json_decode($b[$k], true);
            }
        }
        if (isset($b['active']) && is_string($b['active'])) {
            $b['active'] = ! in_array(strtolower($b['active']), ['0', 'false', 'no', ''], true);
        }

        return $b;
    }

    /** Rows as CSV, with nested values flattened (score_parts.objectives) or joined. */
    public static function csv(array $rows): string
    {
        $flat = array_map(function ($row) {
            $out = [];
            foreach ($row as $k => $v) {
                if (is_array($v) && ! array_is_list($v)) {
                    foreach ($v as $k2 => $v2) {
                        $out["$k.$k2"] = is_scalar($v2) || $v2 === null ? $v2 : json_encode($v2);
                    }
                } else {
                    $out[$k] = is_bool($v) ? ($v ? 'true' : 'false') : (is_array($v) ? implode(';', array_map(fn ($x) => is_scalar($x) ? $x : json_encode($x), $v)) : $v);
                }
            }

            return $out;
        }, $rows);
        $columns = [];
        foreach ($flat as $r) {
            $columns += array_flip(array_keys($r));
        }
        $columns = array_keys($columns);
        $fh = fopen('php://temp', 'w+');
        fputcsv($fh, $columns, ',', '"', '');
        foreach ($flat as $r) {
            // A leading = + - @ would be read as a formula by spreadsheets; a quote stops that.
            fputcsv($fh, array_map(fn ($c) => is_string($r[$c] ?? null) && preg_match('/^[=+\-@\t\r]/', $r[$c]) ? "'".$r[$c] : ($r[$c] ?? ''), $columns), ',', '"', '');
        }
        rewind($fh);

        return stream_get_contents($fh);
    }

    private function run(string $sql, array $params = []): void
    {
        $this->pdo->prepare($sql)->execute($params);
    }

    private function all(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    private function one(string $sql, array $params = []): ?array
    {
        return $this->all($sql, $params)[0] ?? null;
    }
}

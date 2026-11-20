<?php

namespace App\Qbl\District;

use App\Qbl\Api\ApiError;
use App\Qbl\Api\Clients;
use App\Qbl\Api\Privacy;
use App\Qbl\Api\Roster;
use App\Qbl\Api\Sql;
use PDO;
use Throwable;

/**
 * Bring an organization's schools, teachers, students and enrollments in line with a source: a
 * Clever district, Google Classroom, or a roster file. It goes through the public API's Roster,
 * so the same rules hold: people are known by an opaque external_id ("clever:<id>",
 * "google:<id>", or the district's own in a file), play under a pseudonym, and no name or email
 * address is kept.
 *
 * A source gives:
 *   schools   [{external_id, name}]
 *   teachers  [{external_id, school?, status?}]                     school: a school's external_id
 *   students  [{external_id, school?, grade_level?, status?, teachers: [external_id, ...]}]
 *
 * With `$prefix` and `$deactivate`, people that source made earlier (their external_id starts with
 * the prefix) who are no longer in it are deactivated: signed out, and unable to sign in, but kept
 * with their work, as a district expects of someone who has left.
 *
 * Each run is recorded in integration_runs, for the panel's history.
 */
class RosterSync
{
    use Sql;

    private Roster $roster;

    private Clients $clients;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->clients = new Clients($pdo);
        $this->roster = new Roster($pdo, $this->clients);
    }

    /** @return array summary of what changed */
    public function apply(int $orgId, array $data, ?string $prefix = null, bool $deactivate = false): array
    {
        $summary = ['schools' => ['created' => 0, 'updated' => 0], 'teachers' => ['created' => 0, 'updated' => 0, 'failed' => 0], 'students' => ['created' => 0, 'updated' => 0, 'failed' => 0], 'deactivated' => 0, 'enrollments' => 0, 'problems' => [], 'warnings' => []];

        // Schools first, so people can be put in them.
        $schoolIds = [];
        foreach ($data['schools'] ?? [] as $school) {
            $ext = (string) $school['external_id'];
            $name = mb_substr(trim((string) ($school['name'] ?? '')), 0, 120) ?: $ext;
            $existing = $this->one('SELECT id, name FROM organizations WHERE parent_id = ? AND external_id = ?', [$orgId, $ext]);
            try {
                if ($existing) {
                    if ($existing['name'] !== $name) {
                        $this->clients->updateOrganization((int) $existing['id'], ['name' => $name]);
                        $summary['schools']['updated']++;
                    }
                    $schoolIds[$ext] = (int) $existing['id'];
                } else {
                    $schoolIds[$ext] = $this->clients->createOrganization($name, 'school', $orgId, Privacy::externalId($ext))['id'];
                    $summary['schools']['created']++;
                }
            } catch (ApiError $e) {
                $this->problem($summary, "School $ext: ".$e->getMessage());
            }
        }
        $schoolOf = function (array $person) use (&$schoolIds, $orgId) {
            $ext = $person['school'] ?? null;
            if ($ext === null || $ext === '') {
                return null;
            }
            if (! array_key_exists($ext, $schoolIds)) {
                $row = $this->one('SELECT id FROM organizations WHERE parent_id = ? AND external_id = ?', [$orgId, (string) $ext]);
                $schoolIds[$ext] = $row ? (int) $row['id'] : null;
            }

            return $schoolIds[$ext];
        };

        $teachers = [];
        foreach ($data['teachers'] ?? [] as $t) {
            $person = ['external_id' => (string) $t['external_id'], 'status' => ($t['status'] ?? 'active') === 'inactive' ? 'inactive' : 'active'];
            if (array_key_exists('school', $t)) {
                $person['school_id'] = $schoolOf($t);
            }
            $teachers[(string) $t['external_id']] = $person;
        }
        $this->upsert($orgId, 'teacher', array_values($teachers), $summary);

        $students = [];
        foreach ($data['students'] ?? [] as $s) {
            $known = array_values(array_filter(array_unique(array_map('strval', (array) ($s['teachers'] ?? []))), fn ($ext) => isset($teachers[$ext]) || $this->exists($orgId, 'teacher', $ext)));
            $summary['enrollments'] += count($known);
            $person = ['external_id' => (string) $s['external_id'], 'status' => ($s['status'] ?? 'active') === 'inactive' ? 'inactive' : 'active', 'teacher_external_ids' => $known];
            if (array_key_exists('school', $s)) {
                $person['school_id'] = $schoolOf($s);
            }
            if (array_key_exists('grade_level', $s)) {
                try {
                    $person['grade_level'] = Privacy::gradeLevel($s['grade_level']);
                } catch (ApiError) {
                    $person['grade_level'] = null;
                }
            }
            $students[(string) $s['external_id']] = $person;
        }
        $this->upsert($orgId, 'student', array_values($students), $summary);

        if ($prefix !== null && $deactivate) {
            if (! $teachers && ! $students) {
                $summary['warnings'][] = 'The source listed nobody, so nobody was deactivated. Check that QBL has been given access to the rosters.';
            } else {
                $seen = array_flip([...array_keys($teachers), ...array_keys($students)]);
                foreach ($this->all('SELECT id, role, external_id FROM users WHERE organization_id = ? AND external_id LIKE ? AND deactivated_at IS NULL', [$orgId, $prefix.'%']) as $u) {
                    if (! isset($seen[$u['external_id']]) && in_array($u['role'], Roster::ROLES, true)) {
                        $this->roster->update($orgId, $u['role'], (int) $u['id'], ['status' => 'inactive']);
                        $summary['deactivated']++;
                    }
                }
            }
        }

        return $summary;
    }

    private function upsert(int $orgId, string $role, array $people, array &$summary): void
    {
        // Someone whose account was made when they first signed in (as a student, before the source
        // said otherwise) takes the role the source gives them.
        foreach ($people as $p) {
            $this->run("UPDATE users SET role = ?, updated_at = ? WHERE organization_id = ? AND external_id = ? AND role IN ('student', 'teacher') AND role <> ?",
                [$role, self::now(), $orgId, $p['external_id'], $role]);
        }
        foreach (array_chunk($people, Roster::MAX_BATCH) as $chunk) {
            foreach ($this->roster->upsert($orgId, $role, $chunk) as $result) {
                if ($result['result'] === 'error') {
                    $summary[$role.'s']['failed']++;
                    $this->problem($summary, ucfirst($role)." {$result['external_id']}: {$result['error']['message']}");
                } else {
                    $summary[$role.'s'][$result['result']]++;
                }
            }
        }
    }

    private function exists(int $orgId, string $role, string $externalId): bool
    {
        return (bool) $this->one('SELECT id FROM users WHERE organization_id = ? AND role = ? AND external_id = ?', [$orgId, $role, $externalId]);
    }

    private function problem(array &$summary, string $message): void
    {
        if (count($summary['problems']) < 25) {
            $summary['problems'][] = $message;
        }
    }

    // --------------------------------------------------------------------- runs

    public function startRun(int $orgId, string $kind, ?int $userId): int
    {
        return $this->insert('INSERT INTO integration_runs (organization_id, kind, status, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [$orgId, $kind, 'queued', $userId, self::now(), self::now()]);
    }

    public function getRun(int $runId): ?array
    {
        $row = $this->one('SELECT * FROM integration_runs WHERE id = ?', [$runId]);

        return $row ? self::present($row) : null;
    }

    /**
     * Do a run: fetch from the source and apply it, recording how it went. A run that is not
     * queued any more (delivered twice) is left alone.
     *
     * @param  callable(): array{0: array, 1: ?string, 2: bool}  $fetch  the data, the prefix, and whether to deactivate the missing
     */
    public function perform(int $runId, callable $fetch): array
    {
        $run = $this->one('SELECT * FROM integration_runs WHERE id = ?', [$runId]);
        if (! $run || $run['status'] !== 'queued') {
            return $run ? self::present($run) : [];
        }
        $this->run('UPDATE integration_runs SET status = ?, started_at = ?, updated_at = ? WHERE id = ?', ['running', self::now(), self::now(), $runId]);
        try {
            [$data, $prefix, $deactivate] = $fetch();
            $summary = $this->apply((int) $run['organization_id'], $data, $prefix, $deactivate);
            $summary['source'] = ['schools' => count($data['schools'] ?? []), 'teachers' => count($data['teachers'] ?? []), 'students' => count($data['students'] ?? [])];
            $this->run('UPDATE integration_runs SET status = ?, summary = ?, finished_at = ?, updated_at = ? WHERE id = ?', ['done', json_encode($summary, JSON_UNESCAPED_SLASHES), self::now(), self::now(), $runId]);
        } catch (Throwable $e) {
            $this->run('UPDATE integration_runs SET status = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?', ['failed', mb_substr($e->getMessage(), 0, 2000), self::now(), self::now(), $runId]);
        }

        return $this->getRun($runId);
    }

    public function runs(int $orgId, int $limit = 20): array
    {
        return array_map(fn ($r) => self::present($r), $this->all('SELECT * FROM integration_runs WHERE organization_id = ? ORDER BY id DESC LIMIT '.max(1, min(100, $limit)), [$orgId]));
    }

    private static function present(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'kind' => $r['kind'], 'status' => $r['status'], 'summary' => $r['summary'] ? self::json($r['summary']) : null, 'error' => $r['error'],
            'created_at' => self::iso($r['created_at']), 'started_at' => self::iso($r['started_at']), 'finished_at' => self::iso($r['finished_at']),
        ];
    }
}

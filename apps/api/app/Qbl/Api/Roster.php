<?php

namespace App\Qbl\Api;

use App\Qbl\ClassStore;
use PDO;

/**
 * Schools, teachers, students and enrollments, as an organization manages them through the API.
 *
 * Every account made here belongs to the client's root organization (`users.organization_id`)
 * and maybe one of its schools (`users.school_id`), and is known by the organization's own
 * `external_id`, unique within the organization. QBL gives it a pseudonym to play under and a
 * placeholder address; see Privacy. An enrollment is a teacher–student link (`teacher_student`),
 * the same one the editor's Classes page makes: it lets the teacher assign missions to the student.
 */
class Roster
{
    use Sql;

    public const ROLES = ['student', 'teacher'];

    public const MAX_BATCH = 1000;

    private ClassStore $classes;

    public function __construct(PDO $pdo, private Clients $clients)
    {
        $this->pdo = $pdo;
        $this->classes = new ClassStore($pdo);
    }

    // ------------------------------------------------------------------ schools

    public function schools(int $rootId): array
    {
        return array_map(fn ($o) => $this->clients->organization((int) $o['id']), $this->all('SELECT id FROM organizations WHERE parent_id = ? ORDER BY name, id', [$rootId]));
    }

    public function school(int $rootId, int $schoolId): array
    {
        $school = $this->clients->organization($schoolId);
        if (! $school || $school['parent_id'] !== $rootId) {
            throw ApiError::notFound('The school');
        }

        return $school;
    }

    public function createSchool(int $rootId, array $attrs): array
    {
        Privacy::refusePii(array_diff_key($attrs, ['name' => 1]));

        return $this->clients->createOrganization((string) ($attrs['name'] ?? ''), 'school', $rootId, isset($attrs['external_id']) ? Privacy::externalId($attrs['external_id']) : null);
    }

    public function updateSchool(int $rootId, int $schoolId, array $attrs): array
    {
        $this->school($rootId, $schoolId);

        return $this->clients->updateOrganization($schoolId, array_intersect_key($attrs, ['name' => 1, 'external_id' => 1]));
    }

    /** Remove a school. Its people stay in the organization, in no school. */
    public function deleteSchool(int $rootId, int $schoolId): void
    {
        $this->school($rootId, $schoolId);
        $this->run('UPDATE users SET school_id = NULL WHERE organization_id = ? AND school_id = ?', [$rootId, $schoolId]);
        $this->clients->deleteOrganization($schoolId);
    }

    // ------------------------------------------------------------------- people

    /**
     * One page of an organization's teachers or students, in id order.
     *
     * @param  array  $filter  school_id, status (active|inactive), external_id, teacher_id (students), updated_since
     * @return array{0: list<array>, 1: ?string} the people, and the cursor for the next page
     */
    public function people(int $rootId, string $role, array $filter = [], int $limit = 100, ?string $cursor = null): array
    {
        $where = ['u.organization_id = ?', 'u.role = ?'];
        $params = [$rootId, $role];
        if (isset($filter['school_id'])) {
            $where[] = 'u.school_id = ?';
            $params[] = (int) $filter['school_id'];
        }
        if (($filter['status'] ?? null) === 'active' || ($filter['status'] ?? null) === 'inactive') {
            $where[] = $filter['status'] === 'active' ? 'u.deactivated_at IS NULL' : 'u.deactivated_at IS NOT NULL';
        }
        if (isset($filter['external_id'])) {
            $where[] = 'u.external_id = ?';
            $params[] = (string) $filter['external_id'];
        }
        if (isset($filter['updated_since'])) {
            $where[] = 'u.updated_at >= ?';
            $params[] = self::when($filter['updated_since'], 'updated_since');
        }
        if (isset($filter['teacher_id']) && $role === 'student') {
            $where[] = 'u.id IN (SELECT student_id FROM teacher_student WHERE teacher_id = ?)';
            $params[] = (int) $filter['teacher_id'];
        }
        if ($cursor !== null && $cursor !== '') {
            $where[] = 'u.id > ?';
            $params[] = self::cursor($cursor);
        }
        $limit = max(1, min(500, $limit));
        $rows = $this->all('SELECT u.* FROM users u WHERE '.implode(' AND ', $where).' ORDER BY u.id LIMIT '.($limit + 1), $params);
        $more = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);

        return [array_map(fn ($r) => $this->present($r), $rows), $more ? (string) end($rows)['id'] : null];
    }

    public function person(int $rootId, string $role, int $id): array
    {
        return $this->present($this->row($rootId, $role, $id));
    }

    /** Make a teacher or student. A second one with the same external_id is a conflict (use the batch upsert to update). */
    public function create(int $rootId, string $role, array $attrs): array
    {
        Privacy::refusePii($attrs);
        $externalId = Privacy::externalId($attrs['external_id'] ?? null);
        if ($existing = $this->one('SELECT id FROM users WHERE organization_id = ? AND external_id = ?', [$rootId, $externalId])) {
            throw new ApiError(409, 'conflict', "There is already someone with external_id $externalId (id {$existing['id']}).", ['external_id' => 'Already used.']);
        }
        $schoolId = $this->schoolId($rootId, $attrs['school_id'] ?? null);
        $name = $role === 'teacher' ? (Privacy::text($attrs['display_name'] ?? null, 'display_name', 40) ?? Privacy::pseudonym()) : $this->refuseStudentName($attrs) ?? Privacy::pseudonym();
        $id = $this->insert(
            'INSERT INTO users (name, email, password, role, organization_id, school_id, external_id, grade_level, avatar_media_id, stars, xp, deactivated_at, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, ?)',
            [$name, Privacy::placeholderEmail(), $role, $rootId, $schoolId, $externalId, $role === 'student' ? Privacy::gradeLevel($attrs['grade_level'] ?? null) : null,
                ($attrs['status'] ?? 'active') === 'inactive' ? self::now() : null, self::now(), self::now()],
        );
        $this->links($rootId, $role, $id, $attrs);

        return $this->person($rootId, $role, $id);
    }

    /** Change what is given: school_id, grade_level, status, display_name (teachers), regenerate_display_name, teacher_ids / student_ids. */
    public function update(int $rootId, string $role, int $id, array $attrs): array
    {
        Privacy::refusePii($attrs);
        $row = $this->row($rootId, $role, $id);
        $set = [];
        if (array_key_exists('external_id', $attrs)) {
            $externalId = Privacy::externalId($attrs['external_id']);
            if ($externalId !== $row['external_id'] && $this->one('SELECT id FROM users WHERE organization_id = ? AND external_id = ?', [$rootId, $externalId])) {
                throw new ApiError(409, 'conflict', "There is already someone with external_id $externalId.", ['external_id' => 'Already used.']);
            }
            $set['external_id'] = $externalId;
        }
        if (array_key_exists('school_id', $attrs)) {
            $set['school_id'] = $this->schoolId($rootId, $attrs['school_id']);
        }
        if ($role === 'student' && array_key_exists('grade_level', $attrs)) {
            $set['grade_level'] = Privacy::gradeLevel($attrs['grade_level']);
        }
        if ($role === 'teacher' && array_key_exists('display_name', $attrs)) {
            $set['name'] = Privacy::text($attrs['display_name'], 'display_name', 40) ?? Privacy::pseudonym();
        }
        if ($role === 'student') {
            $this->refuseStudentName($attrs);
        }
        if (! empty($attrs['regenerate_display_name'])) {
            $set['name'] = Privacy::pseudonym();
        }
        if (array_key_exists('status', $attrs)) {
            if (! in_array($attrs['status'], ['active', 'inactive'], true)) {
                throw ApiError::invalid('status', 'status must be active or inactive.');
            }
            $set['deactivated_at'] = $attrs['status'] === 'inactive' ? ($row['deactivated_at'] ?? self::now()) : null;
            if ($attrs['status'] === 'inactive') {
                $this->signOut($id); // a deactivated account is signed out everywhere at once
            }
        }
        if ($set) {
            $set['updated_at'] = self::now();
            $this->run('UPDATE users SET '.implode(', ', array_map(fn ($k) => "$k = ?", array_keys($set))).' WHERE id = ?', [...array_values($set), $id]);
        }
        $this->links($rootId, $role, $id, $attrs);

        return $this->person($rootId, $role, $id);
    }

    /**
     * Create or update many people at once, matched by external_id: what a nightly roster sync
     * sends. One bad entry does not stop the others; each says what happened to it.
     */
    public function upsert(int $rootId, string $role, array $people): array
    {
        if (! array_is_list($people) || count($people) > self::MAX_BATCH) {
            throw ApiError::invalid($role.'s', 'Send a list of at most '.self::MAX_BATCH." {$role}s.");
        }
        $results = [];
        foreach ($people as $i => $attrs) {
            $externalId = is_array($attrs) ? ($attrs['external_id'] ?? null) : null;
            try {
                if (! is_array($attrs)) {
                    throw ApiError::invalid('external_id', 'Each entry is an object.');
                }
                $existing = is_scalar($externalId) ? $this->one('SELECT id, role FROM users WHERE organization_id = ? AND external_id = ?', [$rootId, (string) $externalId]) : null;
                if ($existing && $existing['role'] !== $role) {
                    throw new ApiError(409, 'conflict', "external_id $externalId belongs to a {$existing['role']}.");
                }
                $person = $existing ? $this->update($rootId, $role, (int) $existing['id'], $attrs) : $this->create($rootId, $role, $attrs);
                $results[] = ['index' => $i, 'external_id' => $externalId, 'result' => $existing ? 'updated' : 'created', 'id' => $person['id']];
            } catch (ApiError $e) {
                $results[] = ['index' => $i, 'external_id' => $externalId, 'result' => 'error', 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage(), 'fields' => (object) $e->fields]];
            }
        }

        return $results;
    }

    /**
     * Delete a person and everything kept about them, for good: what a parent's or a school's
     * deletion request under FERPA or COPPA asks for. A teacher's assignments go with them,
     * unless `$transferTo` names another teacher of the organization to take them over.
     *
     * @return array{deleted: array<string,int>} how many rows went from each table
     */
    public function delete(int $rootId, string $role, int $id, ?int $transferTo = null): array
    {
        $this->row($rootId, $role, $id);
        $counts = [];
        $gone = function (string $table, string $sql, array $params) use (&$counts) {
            $counts[$table] = ($counts[$table] ?? 0) + $this->run($sql, $params);
        };
        if ($role === 'teacher') {
            if ($transferTo !== null) {
                $this->row($rootId, 'teacher', $transferTo);
                foreach ($this->all('SELECT student_id FROM teacher_student WHERE teacher_id = ?', [$id]) as $link) {
                    $this->enroll($rootId, $transferTo, [(int) $link['student_id']]);
                }
                $this->run('UPDATE assignments SET teacher_id = ?, updated_at = ? WHERE teacher_id = ?', [$transferTo, self::now(), $id]);
            }
            foreach ($this->all('SELECT id FROM assignments WHERE teacher_id = ?', [$id]) as $a) {
                $gone('assignment_student', 'DELETE FROM assignment_student WHERE assignment_id = ?', [$a['id']]);
                $gone('teams', 'DELETE FROM teams WHERE assignment_id = ?', [$a['id']]);
            }
            $gone('assignments', 'DELETE FROM assignments WHERE teacher_id = ?', [$id]);
            $gone('teacher_student', 'DELETE FROM teacher_student WHERE teacher_id = ?', [$id]);
            // Missions the teacher wrote stay, with no owner, so other classes' games are not broken.
            $this->run('UPDATE scenarios SET user_id = NULL WHERE user_id = ?', [$id]);
        }
        $gone('teacher_student', 'DELETE FROM teacher_student WHERE student_id = ?', [$id]);
        $gone('assignment_student', 'DELETE FROM assignment_student WHERE student_id = ?', [$id]);
        foreach (['activity_log', 'chat_messages', 'user_badges', 'progress_ledger', 'user_items', 'scenario_sessions', 'launch_tokens', 'scene_builds', 'build_uploads', 'build_voices'] as $table) {
            $gone($table, "DELETE FROM `$table` WHERE user_id = ?", [$id]);
        }
        // Messages others sent them stay (they are the senders' records), without naming them.
        $this->run('UPDATE chat_messages SET to_user_id = NULL, to_name = NULL WHERE to_user_id = ?', [$id]);
        $this->signOut($id);
        $gone('users', 'DELETE FROM users WHERE id = ?', [$id]);

        return ['deleted' => array_filter($counts)];
    }

    /** Everything QBL keeps about a student, for a records request: account, classes, saves, activity, messages, rewards. */
    public function export(int $rootId, int $id): array
    {
        $person = $this->person($rootId, 'student', $id);
        $decode = fn (array $rows, string ...$keys) => array_map(function ($r) use ($keys) {
            foreach ($keys as $k) {
                $r[$k] = self::json($r[$k] ?? null);
            }

            return $r;
        }, $rows);

        return [
            'student' => $person,
            'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
            'enrollments' => $this->all('SELECT teacher_id, created_at FROM teacher_student WHERE student_id = ? ORDER BY id', [$id]),
            'assignments' => $this->all('SELECT s.assignment_id, s.team_id, a.scenario_id, a.teacher_id, a.due_at, a.external_id FROM assignment_student s JOIN assignments a ON a.id = s.assignment_id WHERE s.student_id = ? ORDER BY s.id', [$id]),
            'saved_games' => $decode($this->all('SELECT scenario_id, group_key, data, created_at, updated_at FROM scenario_sessions WHERE user_id = ? ORDER BY id', [$id]), 'data'),
            'activity' => $this->all('SELECT scenario_id, group_key, scene_id, type, ref, label, value, created_at FROM activity_log WHERE user_id = ? ORDER BY id', [$id]),
            'messages_sent' => $this->all('SELECT scenario_id, group_key, scene_id, kind, to_user_id, text, created_at FROM chat_messages WHERE user_id = ? ORDER BY id', [$id]),
            'badges' => $this->all('SELECT scenario_id, name, description, image_url, scenario_title, created_at FROM user_badges WHERE user_id = ? ORDER BY id', [$id]),
            'rewards_ledger' => $this->all('SELECT scenario_id, stars, xp, note, created_at FROM progress_ledger WHERE user_id = ? ORDER BY id', [$id]),
            'items' => $this->all('SELECT shop_item_id, equipped, created_at FROM user_items WHERE user_id = ? ORDER BY id', [$id]),
            // What they built in scenes, and the pictures they uploaded for it (listed by size; the pictures themselves are in the game).
            'builds' => $decode($this->all('SELECT scenario_id, scene_id, group_key, status, pieces, created_at, updated_at FROM scene_builds WHERE user_id = ? ORDER BY id', [$id]), 'pieces'),
            'build_pictures' => $this->all('SELECT id, scenario_id, group_key, mime, width, height, created_at FROM build_uploads WHERE user_id = ? ORDER BY id', [$id]),
            'disclosures' => $this->clients->auditLog($rootId, 1000, null, $id),
        ];
    }

    // -------------------------------------------------------------- enrollments

    /** Teacher–student links, filtered by either. */
    public function enrollments(int $rootId, ?int $teacherId = null, ?int $studentId = null): array
    {
        $rows = $this->all(
            'SELECT ts.teacher_id, ts.student_id, ts.created_at FROM teacher_student ts JOIN users t ON t.id = ts.teacher_id JOIN users s ON s.id = ts.student_id
             WHERE t.organization_id = ? AND s.organization_id = ?'.($teacherId ? ' AND ts.teacher_id = ?' : '').($studentId ? ' AND ts.student_id = ?' : '').' ORDER BY ts.teacher_id, ts.student_id',
            array_merge([$rootId, $rootId], $teacherId ? [$teacherId] : [], $studentId ? [$studentId] : []),
        );

        return array_map(fn ($r) => ['teacher_id' => (int) $r['teacher_id'], 'student_id' => (int) $r['student_id'], 'created_at' => self::iso($r['created_at'])], $rows);
    }

    /** Put students in a teacher's class. Already there is fine. @return int[] the students newly enrolled */
    public function enroll(int $rootId, int $teacherId, array $studentIds): array
    {
        $this->row($rootId, 'teacher', $teacherId);
        $added = [];
        foreach (array_values(array_unique(array_map('intval', $studentIds))) as $studentId) {
            $this->row($rootId, 'student', $studentId);
            if (! $this->one('SELECT id FROM teacher_student WHERE teacher_id = ? AND student_id = ?', [$teacherId, $studentId])) {
                $this->run('INSERT INTO teacher_student (teacher_id, student_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [$teacherId, $studentId, self::now(), self::now()]);
                $added[] = $studentId;
            }
        }

        return $added;
    }

    /** Take a student out of a teacher's class, and out of that teacher's assignments. */
    public function unenroll(int $rootId, int $teacherId, int $studentId): void
    {
        $this->row($rootId, 'teacher', $teacherId);
        $this->row($rootId, 'student', $studentId);
        if (! $this->one('SELECT id FROM teacher_student WHERE teacher_id = ? AND student_id = ?', [$teacherId, $studentId])) {
            throw ApiError::notFound('That enrollment');
        }
        $this->classes->removeStudent($teacherId, $studentId);
    }

    /**
     * Delete activity and messages older than each organization's data_retention_days, for its
     * students. Saved games, grades' inputs and rewards stay until the student is deleted.
     *
     * @return array<int, array{activity_log: int, chat_messages: int}> by organization
     */
    public static function purgeExpired(PDO $pdo): array
    {
        $out = [];
        foreach ($pdo->query('SELECT id, settings FROM organizations WHERE parent_id IS NULL')->fetchAll(PDO::FETCH_ASSOC) as $org) {
            $days = (json_decode((string) $org['settings'], true) ?: [])['data_retention_days'] ?? null;
            if (! is_int($days) || $days < 1) {
                continue;
            }
            $before = gmdate('Y-m-d H:i:s', time() - $days * 86400);
            $counts = [];
            foreach (['activity_log', 'chat_messages'] as $table) {
                $st = $pdo->prepare("DELETE FROM `$table` WHERE created_at < ? AND user_id IN (SELECT id FROM users WHERE organization_id = ?)");
                $st->execute([$before, $org['id']]);
                $counts[$table] = $st->rowCount();
            }
            $out[(int) $org['id']] = $counts;
        }

        return $out;
    }

    // ------------------------------------------------------------------ helpers

    /** A person's row, if they belong to this organization and have this role. */
    public function row(int $rootId, string $role, int $id): array
    {
        $row = $this->one('SELECT * FROM users WHERE id = ? AND organization_id = ? AND role = ?', [$id, $rootId, $role]);

        return $row ?? throw ApiError::notFound("The $role");
    }

    /** Look someone up by the organization's id for them. */
    public function idOf(int $rootId, string $role, string $externalId): int
    {
        $row = $this->one('SELECT id FROM users WHERE organization_id = ? AND role = ? AND external_id = ?', [$rootId, $role, $externalId]);

        return $row ? (int) $row['id'] : throw ApiError::notFound("The $role with external_id $externalId");
    }

    private function present(array $r): array
    {
        $out = [
            'id' => (int) $r['id'], 'type' => $r['role'], 'external_id' => $r['external_id'], 'display_name' => $r['name'],
            'school_id' => $r['school_id'] === null ? null : (int) $r['school_id'],
        ];
        if ($r['role'] === 'student') {
            $out['grade_level'] = $r['grade_level'];
            $out['teacher_ids'] = array_map('intval', array_column($this->all('SELECT teacher_id FROM teacher_student WHERE student_id = ? ORDER BY teacher_id', [$r['id']]), 'teacher_id'));
        } else {
            $out['student_count'] = (int) $this->one('SELECT COUNT(*) AS n FROM teacher_student WHERE teacher_id = ?', [$r['id']])['n'];
        }

        return $out + [
            'avatar_media_id' => $r['avatar_media_id'] === null ? null : (int) $r['avatar_media_id'],
            'status' => $r['deactivated_at'] === null ? 'active' : 'inactive',
            'created_at' => self::iso($r['created_at'] ?? null), 'updated_at' => self::iso($r['updated_at'] ?? null),
        ];
    }

    /** Set a student's teachers, or a teacher's students, when the request lists them (by QBL id or by external_id). */
    private function links(int $rootId, string $role, int $id, array $attrs): void
    {
        $other = $role === 'student' ? 'teacher' : 'student';
        if (! array_key_exists("{$other}_ids", $attrs) && ! array_key_exists("{$other}_external_ids", $attrs)) {
            return;
        }
        $ids = array_map('intval', (array) ($attrs["{$other}_ids"] ?? []));
        foreach ((array) ($attrs["{$other}_external_ids"] ?? []) as $externalId) {
            $ids[] = $this->idOf($rootId, $other, (string) $externalId);
        }
        $ids = array_values(array_unique($ids));
        foreach ($ids as $otherId) {
            $this->row($rootId, $other, $otherId);
        }
        $column = $role === 'student' ? 'student_id' : 'teacher_id';
        $otherColumn = $role === 'student' ? 'teacher_id' : 'student_id';
        $now = array_map('intval', array_column($this->all("SELECT $otherColumn FROM teacher_student WHERE $column = ?", [$id]), $otherColumn));
        foreach (array_diff($now, $ids) as $gone) {
            $role === 'student' ? $this->classes->removeStudent($gone, $id) : $this->classes->removeStudent($id, $gone);
        }
        foreach (array_diff($ids, $now) as $new) {
            $role === 'student' ? $this->enroll($rootId, $new, [$id]) : $this->enroll($rootId, $id, [$new]);
        }
    }

    private function refuseStudentName(array $attrs): ?string
    {
        if (isset($attrs['display_name'])) {
            throw new ApiError(422, 'pii_not_accepted', 'Students play under a pseudonym QBL makes up. To give one a new pseudonym, send regenerate_display_name: true.', ['display_name' => 'Not accepted for students.']);
        }

        return null;
    }

    private function schoolId(int $rootId, mixed $schoolId): ?int
    {
        if ($schoolId === null || $schoolId === '') {
            return null;
        }
        if (! is_numeric($schoolId)) {
            throw ApiError::invalid('school_id', 'school_id is the id of one of your schools, or null.');
        }
        try {
            return $this->school($rootId, (int) $schoolId)['id'];
        } catch (ApiError) {
            throw ApiError::invalid('school_id', "School $schoolId is not one of your schools.");
        }
    }

    private function signOut(int $userId): void
    {
        $this->run("DELETE FROM personal_access_tokens WHERE tokenable_id = ? AND tokenable_type LIKE '%User'", [$userId]);
    }

    public static function cursor(string $cursor): int
    {
        if (! ctype_digit($cursor)) {
            throw ApiError::invalid('cursor', 'cursor is the next_cursor of the previous page.');
        }

        return (int) $cursor;
    }

    public static function when(mixed $value, string $field): string
    {
        $t = is_string($value) ? strtotime($value) : false;
        if ($t === false) {
            throw ApiError::invalid($field, "$field must be a date or time, such as 2026-09-01 or 2026-09-01T08:00:00Z.");
        }

        return gmdate('Y-m-d H:i:s', $t);
    }
}

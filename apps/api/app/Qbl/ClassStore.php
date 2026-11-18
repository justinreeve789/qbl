<?php

namespace App\Qbl;

use PDO;

/**
 * Teachers, their students, and the missions they give them.
 *
 *   - A teacher has students (and a student may have several teachers).
 *   - A teacher assigns a published scenario to some of their students, with an optional due date.
 *   - An assignment may put its students into teams. Each team plays in its own instance of the
 *     scenario; without teams, the assigned students share one instance.
 *   - A player's missions are the public scenarios plus everything assigned to them.
 *
 * An instance is named by a group key, which is what the game server's rooms and the save tables
 * are keyed by: "public", "a12" (assignment 12, no teams) or "t7" (team 7).
 *
 * Plain PHP over PDO, like the other stores, so it is tested without a framework.
 */
class ClassStore
{
    public function __construct(private PDO $pdo) {}

    // ------------------------------------------------------------------ students

    /** @return list<array{id:int,name:string,email:string}> */
    public function students(int $teacherId): array
    {
        return $this->all('SELECT u.id, u.name, u.email FROM teacher_student ts JOIN users u ON u.id = ts.student_id WHERE ts.teacher_id = ? ORDER BY u.name, u.id', [$teacherId]);
    }

    /** Add someone to a teacher's students by the address they sign in with. */
    public function addStudent(int $teacherId, string $email): array
    {
        $user = $this->one('SELECT id, name, email, role FROM users WHERE LOWER(email) = ?', [strtolower(trim($email))]);
        if (! $user || $user['role'] === 'guest') {
            throw new StoreError(404, 'Nobody has signed in with that address yet. Ask the student to sign in once, then add them.');
        }
        if ((int) $user['id'] === $teacherId) {
            throw new StoreError(422, 'That is your own account.');
        }
        if (! $this->one('SELECT id FROM teacher_student WHERE teacher_id = ? AND student_id = ?', [$teacherId, $user['id']])) {
            $this->run('INSERT INTO teacher_student (teacher_id, student_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [$teacherId, $user['id'], $this->now(), $this->now()]);
        }

        return ['id' => (int) $user['id'], 'name' => $user['name'], 'email' => $user['email']];
    }

    /** Stop teaching a student. They also leave this teacher's assignments. */
    public function removeStudent(int $teacherId, int $studentId): void
    {
        $this->run('DELETE FROM assignment_student WHERE student_id = ? AND assignment_id IN (SELECT id FROM assignments WHERE teacher_id = ?)', [$studentId, $teacherId]);
        $this->run('DELETE FROM teacher_student WHERE teacher_id = ? AND student_id = ?', [$teacherId, $studentId]);
    }

    // --------------------------------------------------------------- assignments

    /** The published scenarios a teacher can assign: public ones, and their own. Admins can assign any. */
    public function assignable(int $teacherId, bool $admin = false): array
    {
        $out = [];
        foreach ($this->all('SELECT id, code, title, subtitle, description, user_id, settings, document FROM scenarios WHERE published_at IS NOT NULL ORDER BY title, id') as $s) {
            if ($admin || self::visibility($s) === 'public' || (int) $s['user_id'] === $teacherId) {
                $out[] = self::card($s);
            }
        }

        return $out;
    }

    /** A teacher's assignments, newest first, each with its students and teams. */
    public function assignments(int $teacherId): array
    {
        return array_map(fn ($a) => $this->assignment($a), $this->all('SELECT * FROM assignments WHERE teacher_id = ? ORDER BY id DESC', [$teacherId]));
    }

    /**
     * Give a scenario to students. `$teams` is a list of ['name' => ..., 'student_ids' => [...]];
     * students in no team play together in the assignment's own instance.
     */
    public function assign(int $teacherId, int $scenarioId, array $studentIds, ?string $dueAt = null, ?string $note = null, array $teams = [], bool $admin = false): array
    {
        if (! in_array($scenarioId, array_column($this->assignable($teacherId, $admin), 'id'), true)) {
            throw new StoreError(422, 'That scenario is not published, or is not yours to assign.');
        }
        $this->mine($teacherId, $studentIds);
        $this->run('INSERT INTO assignments (teacher_id, scenario_id, due_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [$teacherId, $scenarioId, self::date($dueAt), self::text($note), $this->now(), $this->now()]);
        $id = (int) $this->pdo->lastInsertId();
        $this->place($teacherId, $id, $studentIds, $teams);

        return $this->assignment($this->one('SELECT * FROM assignments WHERE id = ?', [$id]));
    }

    /** Change an assignment's due date, note, students or teams. Only what is given changes. */
    public function update(int $teacherId, int $assignmentId, array $attrs): array
    {
        $a = $this->owned($teacherId, $assignmentId);
        if (array_key_exists('due_at', $attrs) || array_key_exists('note', $attrs)) {
            $this->run('UPDATE assignments SET due_at = ?, note = ?, updated_at = ? WHERE id = ?', [
                array_key_exists('due_at', $attrs) ? self::date($attrs['due_at']) : $a['due_at'],
                array_key_exists('note', $attrs) ? self::text($attrs['note']) : $a['note'],
                $this->now(), $assignmentId,
            ]);
        }
        if (array_key_exists('student_ids', $attrs) || array_key_exists('teams', $attrs)) {
            $current = $this->assignment($a);
            $this->place($teacherId, $assignmentId, $attrs['student_ids'] ?? array_column($current['students'], 'id'), $attrs['teams'] ?? array_map(
                fn ($t) => ['id' => $t['id'], 'name' => $t['name'], 'student_ids' => $t['student_ids']], $current['teams'],
            ));
        }

        return $this->assignment($this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]));
    }

    public function unassign(int $teacherId, int $assignmentId): void
    {
        $this->owned($teacherId, $assignmentId);
        $this->run('DELETE FROM assignment_student WHERE assignment_id = ?', [$assignmentId]);
        $this->run('DELETE FROM teams WHERE assignment_id = ?', [$assignmentId]);
        $this->run('DELETE FROM assignments WHERE id = ?', [$assignmentId]);
    }

    // ------------------------------------------------------------------ missions

    /**
     * What a player can play: every public scenario, and everything assigned to them. An
     * assigned mission says who gave it, when it is due, and which team the player is in.
     * A scenario assigned by two teachers is listed twice: they are two different games.
     */
    public function missions(int $userId): array
    {
        $out = [];
        $started = [];
        foreach ($this->all('SELECT scenario_id, group_key, updated_at FROM scenario_sessions WHERE user_id = ?', [$userId]) as $s) {
            $started[$s['scenario_id'].'/'.$s['group_key']] = $s['updated_at'];
        }
        $rows = $this->all(
            'SELECT a.id AS assignment_id, a.due_at, a.note, a.scenario_id, t.name AS teacher, s.team_id, tm.name AS team
             FROM assignment_student s JOIN assignments a ON a.id = s.assignment_id JOIN users t ON t.id = a.teacher_id LEFT JOIN teams tm ON tm.id = s.team_id
             WHERE s.student_id = ? ORDER BY CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at, a.id', [$userId],
        );
        $scenarios = [];
        foreach ($this->all('SELECT id, code, title, subtitle, description, user_id, settings, document FROM scenarios WHERE published_at IS NOT NULL ORDER BY title, id') as $s) {
            $scenarios[(int) $s['id']] = $s;
        }
        foreach ($rows as $r) {
            $scenario = $scenarios[(int) $r['scenario_id']] ?? null;
            if (! $scenario) {
                continue; // unpublished or deleted since it was assigned
            }
            $group = $r['team_id'] ? 't'.$r['team_id'] : 'a'.$r['assignment_id'];
            $out[] = self::card($scenario) + [
                'kind' => 'assigned', 'group' => $group, 'assignment_id' => (int) $r['assignment_id'], 'teacher' => $r['teacher'],
                'due_at' => $r['due_at'], 'note' => $r['note'], 'team' => $r['team'], 'started_at' => $started[$scenario['id'].'/'.$group] ?? null,
            ];
        }
        foreach ($scenarios as $scenario) {
            if (self::visibility($scenario) === 'public') {
                $out[] = self::card($scenario) + ['kind' => 'public', 'group' => 'public', 'started_at' => $started[$scenario['id'].'/public'] ?? null];
            }
        }

        return $out;
    }

    /**
     * May this player join this instance of the scenario? The public instance of a public
     * scenario is open; an assignment's or a team's is for its members and its teacher.
     * Teachers and admins may look in on anything they could assign.
     */
    public function mayJoin(int $userId, string $role, int $scenarioId, string $group): bool
    {
        $scenario = $this->one('SELECT id, user_id, settings FROM scenarios WHERE id = ?', [$scenarioId]);
        if (! $scenario) {
            return false;
        }
        if ($role === 'admin' || (int) $scenario['user_id'] === $userId) {
            return true;
        }
        if (preg_match('/^([at])(\d+)$/', $group, $m)) {
            $assignment = $m[1] === 't'
                ? $this->one('SELECT a.* FROM teams t JOIN assignments a ON a.id = t.assignment_id WHERE t.id = ?', [(int) $m[2]])
                : $this->one('SELECT * FROM assignments WHERE id = ?', [(int) $m[2]]);
            if (! $assignment || (int) $assignment['scenario_id'] !== $scenarioId) {
                return false;
            }
            if ((int) $assignment['teacher_id'] === $userId) {
                return true;
            }
            $place = $this->one('SELECT team_id FROM assignment_student WHERE assignment_id = ? AND student_id = ?', [$assignment['id'], $userId]);

            // In the assignment, and in exactly this instance of it: a team's, or the one for those in no team.
            return $place !== null && ($m[1] === 't' ? (int) $place['team_id'] === (int) $m[2] : $place['team_id'] === null);
        }

        // Any other name is an open group of a public scenario, as before.
        return self::visibility($scenario) === 'public';
    }

    /**
     * The game server's question in full: may this player join this instance, which room does the
     * instance belong to, and what is it called. The teams of one assignment share a room (the
     * assignment's, `a12`), so they can meet in scenes that are not limited to a team; any other
     * instance is a room of its own.
     *
     * @return array{allowed: bool, party: string, team_name?: string}
     */
    public function access(int $userId, string $role, int $scenarioId, string $group): array
    {
        $out = ['allowed' => $this->mayJoin($userId, $role, $scenarioId, $group), 'party' => $group];
        if (preg_match('/^t(\d+)$/', $group, $m)) {
            $team = $this->one('SELECT t.name, t.assignment_id, a.scenario_id FROM teams t JOIN assignments a ON a.id = t.assignment_id WHERE t.id = ?', [(int) $m[1]]);
            if ($team && (int) $team['scenario_id'] === $scenarioId) {
                $out['party'] = 'a'.$team['assignment_id'];
                $out['team_name'] = (string) $team['name'];
            }
        }

        return $out;
    }

    /**
     * Who a report on an assignment is about: its students, each with the instance they play in
     * (their team's, or the assignment's own for those in no team). For the assignment's teacher, or an admin.
     *
     * @return array{assignment: array, scenario_id: int, students: array, groups: string[]}
     */
    public function reportOn(int $teacherId, int $assignmentId, bool $admin = false): array
    {
        $a = $admin ? $this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]) : $this->owned($teacherId, $assignmentId);
        if (! $a) {
            throw new StoreError(404, 'No such assignment.');
        }
        $assignment = $this->assignment($a);
        $teams = array_column($assignment['teams'], 'name', 'id');
        $students = array_map(fn ($s) => [
            'id' => $s['id'], 'name' => $s['name'],
            'group' => $s['team_id'] === null ? 'a'.$a['id'] : 't'.$s['team_id'],
            'team' => $s['team_id'] === null ? null : ($teams[$s['team_id']] ?? null),
        ], $assignment['students']);

        return ['assignment' => $assignment, 'scenario_id' => (int) $a['scenario_id'], 'students' => $students, 'groups' => array_values(array_unique(array_merge(['a'.$a['id']], array_map(fn ($t) => 't'.$t['id'], $assignment['teams']))))];
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `teacher_student` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `teacher_id` INTEGER, `student_id` INTEGER, `created_at`, `updated_at`, UNIQUE (`teacher_id`, `student_id`))',
            'CREATE TABLE IF NOT EXISTS `assignments` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `teacher_id` INTEGER, `scenario_id` INTEGER, `due_at`, `note`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `teams` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `assignment_id` INTEGER, `name`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `assignment_student` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `assignment_id` INTEGER, `student_id` INTEGER, `team_id` INTEGER, `created_at`, `updated_at`, UNIQUE (`assignment_id`, `student_id`))',
        ];
    }

    // ------------------------------------------------------------------- helpers

    /** Put students into an assignment and its teams, replacing how they were placed before. */
    private function place(int $teacherId, int $assignmentId, array $studentIds, array $teams): void
    {
        $studentIds = $this->mine($teacherId, $studentIds);
        // Teams are matched by id where one is given, so a team keeps its instance when it is renamed or its members change.
        $keep = [];
        $teamOf = [];
        foreach ($teams as $team) {
            $name = self::text($team['name'] ?? null) ?? 'Team';
            $id = isset($team['id']) && $this->one('SELECT id FROM teams WHERE id = ? AND assignment_id = ?', [(int) $team['id'], $assignmentId]) ? (int) $team['id'] : null;
            if ($id) {
                $this->run('UPDATE teams SET name = ?, updated_at = ? WHERE id = ?', [$name, $this->now(), $id]);
            } else {
                $this->run('INSERT INTO teams (assignment_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [$assignmentId, $name, $this->now(), $this->now()]);
                $id = (int) $this->pdo->lastInsertId();
            }
            $keep[] = $id;
            foreach ($team['student_ids'] ?? [] as $studentId) {
                $teamOf[(int) $studentId] = $id;
            }
        }
        foreach ($this->all('SELECT id FROM teams WHERE assignment_id = ?', [$assignmentId]) as $t) {
            if (! in_array((int) $t['id'], $keep, true)) {
                $this->run('DELETE FROM teams WHERE id = ?', [$t['id']]);
            }
        }
        $this->run('DELETE FROM assignment_student WHERE assignment_id = ?', [$assignmentId]);
        foreach ($studentIds as $studentId) {
            $this->run('INSERT INTO assignment_student (assignment_id, student_id, team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [$assignmentId, $studentId, $teamOf[$studentId] ?? null, $this->now(), $this->now()]);
        }
    }

    /** The ids given, once each, having checked that every one is a student of this teacher. */
    private function mine(int $teacherId, array $studentIds): array
    {
        $studentIds = array_values(array_unique(array_map('intval', $studentIds)));
        if (array_diff($studentIds, array_map('intval', array_column($this->students($teacherId), 'id')))) {
            throw new StoreError(422, 'You can only assign missions to your own students.');
        }

        return $studentIds;
    }

    private function owned(int $teacherId, int $assignmentId): array
    {
        $a = $this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]);
        if (! $a || (int) $a['teacher_id'] !== $teacherId) {
            throw new StoreError(404, 'No such assignment.');
        }

        return $a;
    }

    private function assignment(array $a): array
    {
        $students = $this->all('SELECT u.id, u.name, u.email, s.team_id FROM assignment_student s JOIN users u ON u.id = s.student_id WHERE s.assignment_id = ? ORDER BY u.name, u.id', [$a['id']]);
        $teams = [];
        foreach ($this->all('SELECT id, name FROM teams WHERE assignment_id = ? ORDER BY id', [$a['id']]) as $t) {
            $teams[] = ['id' => (int) $t['id'], 'name' => $t['name'], 'group' => 't'.$t['id'], 'student_ids' => array_values(array_map('intval', array_column(array_filter($students, fn ($s) => (int) $s['team_id'] === (int) $t['id']), 'id')))];
        }
        $scenario = $this->one('SELECT id, code, title, subtitle, description, user_id, settings, document FROM scenarios WHERE id = ?', [$a['scenario_id']]);

        return [
            'id' => (int) $a['id'], 'scenario' => $scenario ? self::card($scenario) : null, 'due_at' => $a['due_at'], 'note' => $a['note'], 'group' => 'a'.$a['id'],
            'students' => array_map(fn ($s) => ['id' => (int) $s['id'], 'name' => $s['name'], 'email' => $s['email'], 'team_id' => $s['team_id'] === null ? null : (int) $s['team_id']], $students),
            'teams' => $teams,
        ];
    }

    private static function visibility(array $scenario): string
    {
        $settings = is_string($scenario['settings'] ?? null) ? (json_decode($scenario['settings'], true) ?: []) : ($scenario['settings'] ?? []);

        return ($settings['visibility'] ?? 'public') === 'private' ? 'private' : 'public';
    }

    /** What a mission looks like in a list: its name, what it is about, and a picture (its first scene's background). */
    private static function card(array $s): array
    {
        $doc = is_string($s['document'] ?? null) ? (json_decode($s['document'], true) ?: []) : ($s['document'] ?? []);
        $image = null;
        foreach ($doc['scenes'] ?? [] as $scene) {
            if (($scene['id'] ?? null) == ($doc['start_scene_id'] ?? null) || $image === null) {
                $mediaId = $scene['background_media'][0]['media_id'] ?? null;
                foreach ($doc['assets'] ?? [] as $m) {
                    if (($m['id'] ?? null) == $mediaId && ! empty($m['url'])) {
                        $image = preg_match('#^(https?:)?//|^/|^data:#', $m['url']) ? $m['url'] : rtrim((string) ($doc['asset_base_url'] ?? ''), '/').'/'.ltrim($m['url'], '/');
                    }
                }
                if (($scene['id'] ?? null) == ($doc['start_scene_id'] ?? null)) {
                    break;
                }
            }
        }

        return ['id' => (int) $s['id'], 'code' => $s['code'], 'title' => $s['title'], 'subtitle' => $s['subtitle'] ?? null, 'description' => $s['description'] ?? null, 'image' => $image, 'visibility' => self::visibility($s)];
    }

    private static function date(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $time = strtotime((string) $value);
        if ($time === false) {
            throw new StoreError(422, 'The due date is not a date.');
        }

        return gmdate('Y-m-d H:i:s', $time);
    }

    private static function text(mixed $value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value === '' ? null : mb_substr($value, 0, 255);
    }

    private function now(): string
    {
        return gmdate('Y-m-d H:i:s');
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

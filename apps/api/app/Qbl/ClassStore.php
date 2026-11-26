<?php

namespace App\Qbl;

use App\Qbl\Billing\Entitlements;
use PDO;

/**
 * Teachers, their students, and the missions they give them.
 *
 *   - A teacher has students (and a student may have several teachers).
 *   - A teacher assigns a published scenario to some of their students, with an optional due date.
 *   - An assignment may put its students into teams. Each team plays in its own instance of the
 *     scenario; without teams, the assigned students share one instance.
 *   - A player's missions are the public scenarios plus everything assigned to them.
 *   - A mission can wait for its teacher (`settings.wait_for_launch`): students do not see it, and
 *     cannot join it, until the teacher launches the assignment from the game they are playing
 *     together, or shows it to them from the Classes page (`assignments.launched_at`).
 *
 * An instance is named by a group key, which is what the game server's rooms and the save tables
 * are keyed by: "public", "a12" (assignment 12, no teams) or "t7" (team 7).
 *
 * With billing on (an Entitlements is given), plans apply: curricular missions (settings.tier)
 * are for accounts whose plan includes them, and their students through their assignments; and a
 * teacher may have as many students as their plan allows. Without one, everything is open.
 *
 * Plain PHP over PDO, like the other stores, so it is tested without a framework.
 */
class ClassStore
{
    public function __construct(private PDO $pdo, private ?Entitlements $entitlements = null) {}

    // ------------------------------------------------------------------ students

    /** @return list<array{id:int,name:string,email:string}> */
    public function students(int $teacherId): array
    {
        return array_map(fn ($s) => ['id' => $s['id'], 'name' => $s['name'], 'email' => self::shownEmail($s['email'])],
            $this->all('SELECT u.id, u.name, u.email FROM teacher_student ts JOIN users u ON u.id = ts.student_id WHERE ts.teacher_id = ? ORDER BY u.name, u.id', [$teacherId]));
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
            $this->entitlements?->checkStudentLimit($teacherId);
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

    /**
     * The published scenarios a teacher can assign: public ones, and their own. Admins can assign any.
     * Curricular missions are listed for everyone, `locked` when the teacher's plan does not include them.
     */
    public function assignable(int $teacherId, bool $admin = false): array
    {
        $out = [];
        $curricular = $admin || $this->curricular($teacherId);
        foreach ($this->all('SELECT id, code, title, subtitle, description, user_id, settings, document FROM scenarios WHERE published_at IS NOT NULL ORDER BY title, id') as $s) {
            if ($admin || self::visibility($s) === 'public' || (int) $s['user_id'] === $teacherId) {
                $out[] = self::card($s) + ['locked' => ! $curricular && self::isCurricular($s)];
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
        $this->checkAssignable($teacherId, $scenarioId, $admin);
        $this->mine($teacherId, $studentIds);
        $this->run('INSERT INTO assignments (teacher_id, scenario_id, due_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [$teacherId, $scenarioId, self::date($dueAt), self::text($note), $this->now(), $this->now()]);
        $id = (int) $this->pdo->lastInsertId();
        $this->place($teacherId, $id, $studentIds, $teams);

        return $this->assignment($this->one('SELECT * FROM assignments WHERE id = ?', [$id]));
    }

    private function checkAssignable(int $teacherId, int $scenarioId, bool $admin): void
    {
        $card = array_values(array_filter($this->assignable($teacherId, $admin), fn ($c) => $c['id'] === $scenarioId))[0] ?? null;
        if (! $card) {
            throw new StoreError(422, 'That scenario is not published, or is not yours to assign.');
        }
        if ($card['locked']) {
            throw new StoreError(402, 'That is one of the curricular missions, which come with a Teacher plan. See Plans to start a free trial.');
        }
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
            'SELECT a.id AS assignment_id, a.due_at, a.note, a.scenario_id, a.launched_at, t.name AS teacher, s.team_id, tm.name AS team
             FROM assignment_student s JOIN assignments a ON a.id = s.assignment_id JOIN users t ON t.id = a.teacher_id LEFT JOIN teams tm ON tm.id = s.team_id
             WHERE s.student_id = ? ORDER BY CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at, a.id', [$userId],
        );
        $scenarios = [];
        foreach ($this->all('SELECT id, code, title, subtitle, description, user_id, settings, document FROM scenarios WHERE published_at IS NOT NULL ORDER BY title, id') as $s) {
            $scenarios[(int) $s['id']] = $s;
        }
        $mine = $this->curricular($userId);
        $teachers = [];
        foreach ($rows as $r) {
            $scenario = $scenarios[(int) $r['scenario_id']] ?? null;
            if (! $scenario) {
                continue; // unpublished or deleted since it was assigned
            }
            if (self::waitsForLaunch($scenario) && $r['launched_at'] === null) {
                continue; // the teacher has not launched it yet
            }
            $group = $r['team_id'] ? 't'.$r['team_id'] : 'a'.$r['assignment_id'];
            // An assigned curricular mission is open while the teacher's plan includes it.
            $teacherId = (int) $this->one('SELECT teacher_id FROM assignments WHERE id = ?', [$r['assignment_id']])['teacher_id'];
            $locked = self::isCurricular($scenario) && ! ($teachers[$teacherId] ??= $this->curricular($teacherId));
            $out[] = self::card($scenario) + ['locked' => $locked] + [
                'kind' => 'assigned', 'group' => $group, 'assignment_id' => (int) $r['assignment_id'], 'teacher' => $r['teacher'],
                'due_at' => $r['due_at'], 'note' => $r['note'], 'team' => $r['team'], 'started_at' => $started[$scenario['id'].'/'.$group] ?? null,
            ];
        }
        // Public curricular missions: playable with a plan that includes them; shown locked to
        // teachers without one (so they know what a plan gives), and not shown to anyone else.
        $staff = Roles::isStaff($this->one('SELECT role FROM users WHERE id = ?', [$userId])['role'] ?? null);
        foreach ($scenarios as $scenario) {
            if (self::visibility($scenario) !== 'public') {
                continue;
            }
            // A mission that waits for a teacher reaches students only through a launched assignment.
            if (self::waitsForLaunch($scenario) && ! $staff) {
                continue;
            }
            $locked = ! $mine && self::isCurricular($scenario);
            if ($locked && ! $staff) {
                continue;
            }
            $out[] = self::card($scenario) + ['locked' => $locked, 'kind' => 'public', 'group' => 'public', 'started_at' => $started[$scenario['id'].'/public'] ?? null];
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
        if ($role === 'admin') {
            return true;
        }
        // Before the author's own pass: a copy of a curricular mission is curricular too. Content
        // admins look after the curricular missions, so they need no plan for them.
        if ($this->needsPlan($scenarioId, $userId, $group) && ! Roles::editsAllScenarios($role)) {
            return false;
        }
        if ((int) $scenario['user_id'] === $userId) {
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
            // Its students wait until their teacher launches it (or shows it to them).
            if (self::waitsForLaunch($scenario) && ($assignment['launched_at'] ?? null) === null) {
                return false;
            }
            $place = $this->one('SELECT team_id FROM assignment_student WHERE assignment_id = ? AND student_id = ?', [$assignment['id'], $userId]);

            // In the assignment, and in exactly this instance of it: a team's, or the one for those in no team.
            return $place !== null && ($m[1] === 't' ? (int) $place['team_id'] === (int) $m[2] : $place['team_id'] === null);
        }

        // Any other name is an open group of a public scenario, as before. One that waits for a
        // teacher is open to teachers (to try it out) but not to students: they come through an assignment.
        return self::visibility($scenario) === 'public' && (! self::waitsForLaunch($scenario) || Roles::isStaff($role));
    }

    /**
     * Whether what keeps this player out of this instance is that the mission waits for its teacher:
     * a student, in a mission marked to wait, whose assignment has not been launched (or in its public
     * instance, which such a mission does not open to students). For the message the game shows.
     */
    public function waitingForLaunch(string $role, int $scenarioId, string $group): bool
    {
        $scenario = $this->one('SELECT id, settings FROM scenarios WHERE id = ?', [$scenarioId]);
        if (! $scenario || ! self::waitsForLaunch($scenario) || Roles::isStaff($role)) {
            return false;
        }
        $assignment = $this->assignmentOf($group);

        return $assignment === null ? ! preg_match('/^[at]\d+$/', $group) : (int) $assignment['scenario_id'] === $scenarioId && $assignment['launched_at'] === null;
    }

    // ------------------------------------------------------------------ launches

    /**
     * Launch an assignment: its students see it on their missions page from now on, and may join it.
     * The game server calls this when a teacher launches the scenario from a game, and then sends
     * every student of the teacher who is playing anywhere into it: hence what it returns, the
     * scenario's address and, for each of the teacher's students (the assignment's and the rest of
     * the roster), the instance (group) they play in. Launching again is allowed (it sends whoever is
     * playing now) and keeps the first time. For the assignment's teacher, or an admin.
     *
     * @return array{assignment_id: int, scenario_id: int, code: string, title: string, launched_at: string, party: string, students: list<array{id: int, group: string}>}
     */
    public function launch(int $teacherId, int $assignmentId, bool $admin = false): array
    {
        $a = $admin ? $this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]) : $this->owned($teacherId, $assignmentId);
        if (! $a) {
            throw new StoreError(404, 'No such assignment.');
        }
        $scenario = $this->one('SELECT id, code, title FROM scenarios WHERE id = ? AND published_at IS NOT NULL', [$a['scenario_id']]);
        if (! $scenario) {
            throw new StoreError(422, 'That mission is not published any more, so it cannot be launched.');
        }
        if ($a['launched_at'] === null) {
            $this->run('UPDATE assignments SET launched_at = ?, updated_at = ? WHERE id = ?', [$this->now(), $this->now(), $assignmentId]);
        }
        $launchedAt = $this->one('SELECT launched_at FROM assignments WHERE id = ?', [$assignmentId])['launched_at'];
        // Every student of the teacher goes, not only those the assignment lists: those in it to their
        // team's instance (or the assignment's), everyone else to the assignment's. Whether each may
        // play it is checked when they arrive, as for anyone; a launch holds nobody back for it.
        $groups = [];
        foreach ($this->all('SELECT student_id, team_id FROM assignment_student WHERE assignment_id = ?', [$assignmentId]) as $s) {
            $groups[(int) $s['student_id']] = $s['team_id'] === null ? 'a'.$assignmentId : 't'.$s['team_id'];
        }
        foreach ($this->all('SELECT student_id FROM teacher_student WHERE teacher_id = ?', [(int) $a['teacher_id']]) as $s) {
            $groups[(int) $s['student_id']] ??= 'a'.$assignmentId;
        }
        ksort($groups);
        $students = [];
        foreach ($groups as $id => $group) {
            $students[] = ['id' => $id, 'group' => $group];
        }

        return [
            'assignment_id' => $assignmentId, 'scenario_id' => (int) $scenario['id'], 'code' => (string) $scenario['code'], 'title' => (string) $scenario['title'],
            'launched_at' => $launchedAt, 'party' => 'a'.$assignmentId, 'students' => $students,
        ];
    }

    /**
     * Take back a launch: a mission that waits for its teacher leaves the students' missions page
     * again (for one launched by mistake). Students already playing it are not sent away, but cannot
     * come back to it until it is launched again. For the assignment's teacher, or an admin.
     */
    public function unlaunch(int $teacherId, int $assignmentId, bool $admin = false): array
    {
        $a = $admin ? $this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]) : $this->owned($teacherId, $assignmentId);
        if (! $a) {
            throw new StoreError(404, 'No such assignment.');
        }
        $this->run('UPDATE assignments SET launched_at = NULL, updated_at = ? WHERE id = ?', [$this->now(), $assignmentId]);

        return $this->assignment($this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]));
    }

    /** An assignment as the teacher's list shows it, by its id. Null when there is none. */
    public function shown(int $assignmentId): ?array
    {
        $a = $this->one('SELECT * FROM assignments WHERE id = ?', [$assignmentId]);

        return $a ? $this->assignment($a) : null;
    }

    /** The assignment an instance belongs to: a team's (`t7`) or an assignment's own (`a12`). Null for any other group. */
    private function assignmentOf(string $group): ?array
    {
        if (! preg_match('/^([at])(\d+)$/', $group, $m)) {
            return null;
        }

        return $m[1] === 't'
            ? $this->one('SELECT a.* FROM teams t JOIN assignments a ON a.id = t.assignment_id WHERE t.id = ?', [(int) $m[2]])
            : $this->one('SELECT * FROM assignments WHERE id = ?', [(int) $m[2]]);
    }

    /**
     * Whether a plan stands between this player and this instance of a curricular mission: in an
     * assignment's or a team's instance the teacher's plan counts, anywhere else the player's own.
     * Always false for free missions and with billing off. (Even a mission's author needs the plan:
     * a teacher's copy of a curricular mission is curricular, and only administrators set the tier.)
     */
    public function needsPlan(int $scenarioId, ?int $userId, string $group): bool
    {
        if (! $this->entitlements || ! $this->entitlements->plans()->enabled()) {
            return false;
        }
        $scenario = $this->one('SELECT id, user_id, settings FROM scenarios WHERE id = ?', [$scenarioId]);
        if (! $scenario || ! self::isCurricular($scenario)) {
            return false;
        }
        if ($userId !== null && preg_match('/^([at])(\d+)$/', $group, $m)) {
            $assignment = $m[1] === 't'
                ? $this->one('SELECT a.teacher_id FROM teams t JOIN assignments a ON a.id = t.assignment_id WHERE t.id = ?', [(int) $m[2]])
                : $this->one('SELECT teacher_id FROM assignments WHERE id = ?', [(int) $m[2]]);
            if ($assignment) {
                return ! $this->curricular((int) $assignment['teacher_id']);
            }
        }

        return ! $this->curricular($userId);
    }

    private function curricular(?int $userId): bool
    {
        return ! $this->entitlements || $this->entitlements->curricular($userId);
    }

    /**
     * The game server's question in full: may this player join this instance, which room does the
     * instance belong to, and what is it called. The teams of one assignment share a room (the
     * assignment's, `a12`), so they can meet in scenes that are not limited to a team; any other
     * instance is a room of its own.
     *
     * In an assigned game (a team's or an assignment's instance) it also names the teacher who
     * assigned it: the game's `QL_TeacherName`.
     *
     * @return array{allowed: bool, party: string, team_name?: string, teacher_name?: string}
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
        if (preg_match('/^([at])(\d+)$/', $group, $m)) {
            $teacher = $m[1] === 't'
                ? $this->one('SELECT u.name, a.scenario_id FROM teams t JOIN assignments a ON a.id = t.assignment_id JOIN users u ON u.id = a.teacher_id WHERE t.id = ?', [(int) $m[2]])
                : $this->one('SELECT u.name, a.scenario_id FROM assignments a JOIN users u ON u.id = a.teacher_id WHERE a.id = ?', [(int) $m[2]]);
            if ($teacher && (int) $teacher['scenario_id'] === $scenarioId && trim((string) $teacher['name']) !== '') {
                $out['teacher_name'] = (string) $teacher['name'];
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

    /**
     * Start a student's game in an assignment again: their save in the instance they play in
     * (their team's, or the assignment's) is deleted, so the next visit begins at the start.
     * For the assignment's teacher, or an admin.
     *
     * What is kept: the activity and message logs (a `reset` line marks the moment, and the
     * report counts from it), stars, XP and badges (awards already given are not given again),
     * and what the student's team shares (the team's world is everyone's, not one student's).
     *
     * A game server that loaded the old save cannot write it back: the `reset` line's id is the
     * token it must present when saving (see ActivityStore::resetToken).
     *
     * @return array{student_id: int, group: string, reset_at: string, reset_by: string}
     */
    public function resetProgress(int $teacherId, int $assignmentId, int $studentId, bool $admin = false): array
    {
        $on = $this->reportOn($teacherId, $assignmentId, $admin);
        $student = null;
        foreach ($on['students'] as $s) {
            if ((int) $s['id'] === $studentId) {
                $student = $s;
            }
        }
        if (! $student) {
            throw new StoreError(404, 'That student is not in this assignment.');
        }
        $done = $this->reset($on['scenario_id'], $studentId, $student['group'], $teacherId);

        return ['student_id' => $studentId] + $done;
    }

    /**
     * A teacher or admin starts their own game in a mission again: their save in that instance
     * (`public`, an assignment's or a team's, one they may join) is deleted, as resetProgress does
     * for a student. Students cannot: what they saved is what their teacher's report reads.
     *
     * @return array{group: string, reset_at: string, reset_by: string}
     */
    public function resetOwnProgress(int $userId, string $role, int $scenarioId, string $group): array
    {
        if (! Roles::isStaff($role)) {
            throw new StoreError(403, 'Only teachers can start a mission again. Ask your teacher.');
        }
        $group = substr(trim($group), 0, 64) ?: 'public';
        if (! $this->one('SELECT id FROM scenarios WHERE id = ?', [$scenarioId])) {
            throw new StoreError(404, 'No such mission.');
        }
        if (! $this->mayJoin($userId, $role, $scenarioId, $group)) {
            throw new StoreError(403, 'You do not play in that game.');
        }

        return $this->reset($scenarioId, $userId, $group, $userId);
    }

    /** Delete one player's save in one instance and leave a reset line in the activity log (see ActivityStore::RESET). */
    private function reset(int $scenarioId, int $userId, string $group, int $byId): array
    {
        $by = (string) ($this->one('SELECT name FROM users WHERE id = ?', [$byId])['name'] ?? '');
        $at = $this->now();
        $own = ! $this->pdo->inTransaction();
        if ($own) {
            $this->pdo->beginTransaction();
        }
        try {
            $this->run('DELETE FROM scenario_sessions WHERE scenario_id = ? AND user_id = ? AND group_key = ?', [$scenarioId, $userId, $group]);
            $this->run(
                'INSERT INTO activity_log (scenario_id, user_id, group_key, scene_id, type, ref, label, value, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?)',
                [$scenarioId, $userId, $group, ActivityStore::RESET, (string) $byId, mb_substr($by, 0, 200) ?: null, $at],
            );
            if ($own) {
                $this->pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($own) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return ['group' => $group, 'reset_at' => gmdate('Y-m-d\TH:i:sP', strtotime($at.' UTC')), 'reset_by' => $by];
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `teacher_student` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `teacher_id` INTEGER, `student_id` INTEGER, `created_at`, `updated_at`, UNIQUE (`teacher_id`, `student_id`))',
            'CREATE TABLE IF NOT EXISTS `assignments` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `teacher_id` INTEGER, `scenario_id` INTEGER, `due_at`, `note`, `external_id`, `launched_at`, `created_at`, `updated_at`)',
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

        $card = $scenario ? self::card($scenario) : null;

        return [
            'id' => (int) $a['id'], 'scenario' => $card, 'due_at' => $a['due_at'], 'note' => $a['note'], 'group' => 'a'.$a['id'],
            // A mission that waits for its teacher: when it was launched, and whether its students are still waiting.
            'launched_at' => $a['launched_at'] ?? null, 'waiting' => ($card['waits_for_launch'] ?? false) && ($a['launched_at'] ?? null) === null,
            'students' => array_map(fn ($s) => ['id' => (int) $s['id'], 'name' => $s['name'], 'email' => self::shownEmail($s['email']), 'team_id' => $s['team_id'] === null ? null : (int) $s['team_id']], $students),
            'teams' => $teams,
        ];
    }

    /**
     * Accounts a school rosters through /api/v1 have a placeholder address (….invalid) that
     * nobody should see or type; they are shown without one.
     */
    private static function shownEmail(?string $email): string
    {
        return $email === null || str_ends_with($email, '.invalid') ? '' : $email;
    }

    /** Whether a scenario is one of the curricular missions (settings.tier "curricular"), which need a plan. */
    public static function isCurricular(array $scenario): bool
    {
        $settings = is_string($scenario['settings'] ?? null) ? (json_decode($scenario['settings'], true) ?: []) : ($scenario['settings'] ?? []);

        return ($settings['tier'] ?? 'free') === 'curricular';
    }

    /**
     * Whether a mission waits for its teacher (settings.wait_for_launch): students see it, and can
     * join it, only through an assignment the teacher has launched.
     */
    public static function waitsForLaunch(array $scenario): bool
    {
        $settings = is_string($scenario['settings'] ?? null) ? (json_decode($scenario['settings'], true) ?: []) : ($scenario['settings'] ?? []);

        return ($settings['wait_for_launch'] ?? false) === true;
    }

    private static function visibility(array $scenario): string
    {
        $settings = is_string($scenario['settings'] ?? null) ? (json_decode($scenario['settings'], true) ?: []) : ($scenario['settings'] ?? []);

        return ($settings['visibility'] ?? 'public') === 'private' ? 'private' : 'public';
    }

    /** A scene's main picture: the background layer marked `main`, else its first (mainLayerIndex in packages/shared). */
    private static function mainLayer(array $scene): ?array
    {
        $layers = array_values(is_array($scene['background_media'] ?? null) ? $scene['background_media'] : []);
        foreach ($layers as $layer) {
            if (is_array($layer) && ($layer['main'] ?? false) === true) {
                return $layer;
            }
        }

        return is_array($layers[0] ?? null) ? $layers[0] : null;
    }

    /** What a mission looks like in a list: its name, what it is about, and a picture (its start scene's main background). */
    private static function card(array $s): array
    {
        $doc = is_string($s['document'] ?? null) ? (json_decode($s['document'], true) ?: []) : ($s['document'] ?? []);
        $image = null;
        foreach ($doc['scenes'] ?? [] as $scene) {
            if (($scene['id'] ?? null) == ($doc['start_scene_id'] ?? null) || $image === null) {
                $main = self::mainLayer($scene);
                $mediaId = $main['media_id'] ?? $main['id'] ?? null;
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

        return ['id' => (int) $s['id'], 'code' => $s['code'], 'title' => $s['title'], 'subtitle' => $s['subtitle'] ?? null, 'description' => $s['description'] ?? null, 'image' => $image, 'visibility' => self::visibility($s), 'tier' => self::isCurricular($s) ? 'curricular' : 'free', 'waits_for_launch' => self::waitsForLaunch($s)];
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

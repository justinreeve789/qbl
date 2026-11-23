<?php

namespace App\Qbl;

use App\Qbl\Billing\Entitlements;
use PDO;

/**
 * The HTTP face of classes, missions and avatars, without a framework, so the dev server and
 * Laravel answer alike (as EditorApi does for the editor).
 *
 *   GET    missions                      what the signed-in player can play: public missions and those assigned to them
 *   GET    avatars                       the platform's avatars, and which one is the player's
 *   PUT    me/avatar                     {avatar_media_id}: choose an avatar, kept for every scenario
 *   POST   me/progress/reset             {scenario_id, group?}: for teachers and admins, start their own game
 *                                        in that instance again (ClassStore::resetOwnProgress)
 *
 *   For teachers and admins:
 *   GET    teach/students                my students
 *   POST   teach/students                {email}: add a student who has signed in before
 *   DELETE teach/students/{id}
 *   GET    teach/scenarios               published scenarios I can assign
 *   GET    teach/assignments             my assignments, with students and teams
 *   POST   teach/assignments             {scenario_id, student_ids, due_at?, note?, teams?: [{name, student_ids}]}
 *   PUT    teach/assignments/{id}        any of due_at, note, student_ids, teams
 *   DELETE teach/assignments/{id}
 *   GET    teach/assignments/{id}/report              how each student did: time, objectives, answers, words, evidence
 *   GET    teach/assignments/{id}/activity            what they did, newest first
 *   GET    teach/assignments/{id}/activity/{student}  ... one student
 *   GET    teach/assignments/{id}/messages            every message sent in the assignment's instances, for auditing
 *   POST   teach/assignments/{id}/students/{student}/reset
 *                                        start the student's game in the assignment again (ClassStore::resetProgress)
 *
 *   For any signed-in player:
 *   GET    players/{id}/profile          what others may see of a player: avatar, look, rank, stars, XP, badges
 */
class ClassApi
{
    private ClassStore $classes;

    /** `$ranks`: the platform's ranks, for profiles. Default: ProgressStore's. `$entitlements`: plans, when billing is on. */
    public function __construct(private PDO $pdo, private ?array $ranks = null, ?Entitlements $entitlements = null)
    {
        $this->classes = new ClassStore($pdo, $entitlements);
    }

    /** @return array{0: int, 1: array|null} HTTP status and JSON body */
    public function handle(string $method, string $path, array $body, ?array $user): array
    {
        try {
            return $this->route(strtoupper($method), array_values(array_filter(explode('/', trim($path, '/')), 'strlen')), $body, $user);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        $me = (int) $user['id'];
        $role = (string) ($user['role'] ?? '');

        if ($parts === ['missions'] && $method === 'GET') {
            return [200, ['missions' => $this->classes->missions($me)]];
        }
        if ($parts === ['avatars'] && $method === 'GET') {
            return [200, ['avatars' => array_map(fn ($a) => Avatars::present($a), Avatars::forUser($this->pdo, $me)), 'avatar_media_id' => $this->avatarOf($me)]];
        }
        if ($parts === ['me', 'avatar'] && $method === 'PUT') {
            $id = (int) ($body['avatar_media_id'] ?? 0);
            if (! in_array($id, array_column(Avatars::forUser($this->pdo, $me), 'media_id'), true)) {
                throw new StoreError(422, 'That is not one of the avatars.');
            }
            $this->pdo->prepare('UPDATE users SET avatar_media_id = ? WHERE id = ?')->execute([$id, $me]);

            return [200, ['avatar_media_id' => $id]];
        }

        if ($parts === ['me', 'progress', 'reset'] && $method === 'POST') {
            return [200, ['reset' => $this->classes->resetOwnProgress($me, $role, (int) ($body['scenario_id'] ?? 0), (string) ($body['group'] ?? 'public'))]];
        }

        if (count($parts) === 3 && $parts[0] === 'players' && ctype_digit($parts[1]) && $parts[2] === 'profile' && $method === 'GET') {
            return [200, ['profile' => (new ActivityStore($this->pdo))->profile((int) $parts[1], new ProgressStore($this->pdo, $this->ranks ?? ProgressStore::DEFAULT_RANKS))]];
        }

        if (($parts[0] ?? '') !== 'teach') {
            throw new StoreError(404, 'Not found.');
        }
        if (! Roles::isStaff($role)) {
            throw new StoreError(403, 'This is for teachers.');
        }
        $admin = $role === 'admin';
        $what = $parts[1] ?? '';
        $id = isset($parts[2]) && ctype_digit($parts[2]) ? (int) $parts[2] : null;
        if ($what === 'assignments' && $id !== null && count($parts) === 6 && $parts[3] === 'students' && ctype_digit($parts[4]) && $parts[5] === 'reset' && $method === 'POST') {
            return [200, ['reset' => $this->classes->resetProgress($me, $id, (int) $parts[4], $admin)]];
        }
        if ($what === 'assignments' && $id !== null && isset($parts[3]) && $method === 'GET') {
            return $this->report($me, $admin, $id, $parts[3], $parts[4] ?? null, count($parts));
        }
        if (count($parts) > 3 || (isset($parts[2]) && $id === null)) {
            throw new StoreError(404, 'Not found.');
        }

        return match (true) {
            $what === 'students' && $id === null && $method === 'GET' => [200, ['students' => $this->classes->students($me)]],
            $what === 'students' && $id === null && $method === 'POST' => [201, ['student' => $this->classes->addStudent($me, (string) ($body['email'] ?? ''))]],
            $what === 'students' && $id !== null && $method === 'DELETE' => $this->done(fn () => $this->classes->removeStudent($me, $id)),
            $what === 'scenarios' && $id === null && $method === 'GET' => [200, ['scenarios' => $this->classes->assignable($me, $admin)]],
            $what === 'assignments' && $id === null && $method === 'GET' => [200, ['assignments' => $this->classes->assignments($me)]],
            $what === 'assignments' && $id === null && $method === 'POST' => [201, ['assignment' => $this->classes->assign(
                $me, (int) ($body['scenario_id'] ?? 0), (array) ($body['student_ids'] ?? []), $body['due_at'] ?? null, $body['note'] ?? null, (array) ($body['teams'] ?? []), $admin,
            )]],
            $what === 'assignments' && $id !== null && $method === 'PUT' => [200, ['assignment' => $this->classes->update($me, $id, $body)]],
            $what === 'assignments' && $id !== null && $method === 'DELETE' => $this->done(fn () => $this->classes->unassign($me, $id)),
            default => throw new StoreError(404, 'Not found.'),
        };
    }

    /** The reports on one assignment: the summary, the activity log, or the message log. */
    private function report(int $me, bool $admin, int $assignmentId, string $which, ?string $student, int $depth): array
    {
        $on = $this->classes->reportOn($me, $assignmentId, $admin);
        $activity = new ActivityStore($this->pdo);
        if ($which === 'report' && $depth === 4) {
            $st = $this->pdo->prepare('SELECT document FROM scenarios WHERE id = ?');
            $st->execute([$on['scenario_id']]);
            $document = json_decode((string) $st->fetchColumn(), true) ?: [];

            return [200, ['assignment' => $on['assignment'], 'report' => $activity->report($on['scenario_id'], $on['students'], $document)]];
        }
        if ($which === 'activity' && ($depth === 4 || ($depth === 5 && ctype_digit((string) $student)))) {
            return [200, ['activity' => $activity->activity($on['scenario_id'], $on['groups'], $student === null ? null : (int) $student)]];
        }
        if ($which === 'messages' && $depth === 4) {
            return [200, ['messages' => $activity->messages($on['scenario_id'], $on['groups'])]];
        }
        throw new StoreError(404, 'Not found.');
    }

    private function avatarOf(int $userId): ?int
    {
        $st = $this->pdo->prepare('SELECT avatar_media_id FROM users WHERE id = ?');
        $st->execute([$userId]);
        $id = $st->fetchColumn();

        return $id && Avatars::has($this->pdo, (int) $id) ? (int) $id : null;
    }

    private function done(callable $work): array
    {
        $work();

        return [204, null];
    }
}

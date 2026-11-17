<?php

namespace App\Qbl;

use PDO;

/**
 * The HTTP face of classes, missions and avatars, without a framework, so the dev server and
 * Laravel answer alike (as EditorApi does for the editor).
 *
 *   GET    missions                      what the signed-in player can play: public missions and those assigned to them
 *   GET    avatars                       the platform's avatars, and which one is the player's
 *   PUT    me/avatar                     {avatar_media_id}: choose an avatar, kept for every scenario
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
 */
class ClassApi
{
    private ClassStore $classes;

    public function __construct(private PDO $pdo)
    {
        $this->classes = new ClassStore($pdo);
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
            return [200, ['avatars' => array_map(fn ($a) => ['media_id' => $a['media_id'], 'name' => $a['name'], 'image_url' => $a['image_url'], 'portrait_url' => $a['portrait_url'], 'sheet' => $a['settings']['sheet'] ?? null], Avatars::all($this->pdo)), 'avatar_media_id' => $this->avatarOf($me)]];
        }
        if ($parts === ['me', 'avatar'] && $method === 'PUT') {
            $id = (int) ($body['avatar_media_id'] ?? 0);
            if (! Avatars::has($this->pdo, $id)) {
                throw new StoreError(422, 'That is not one of the avatars.');
            }
            $this->pdo->prepare('UPDATE users SET avatar_media_id = ? WHERE id = ?')->execute([$id, $me]);

            return [200, ['avatar_media_id' => $id]];
        }

        if (($parts[0] ?? '') !== 'teach') {
            throw new StoreError(404, 'Not found.');
        }
        if (! in_array($role, ['teacher', 'admin'], true)) {
            throw new StoreError(403, 'This is for teachers.');
        }
        $admin = $role === 'admin';
        $what = $parts[1] ?? '';
        $id = isset($parts[2]) && ctype_digit($parts[2]) ? (int) $parts[2] : null;
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

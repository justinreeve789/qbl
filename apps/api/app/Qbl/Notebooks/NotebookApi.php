<?php

namespace App\Qbl\Notebooks;

use App\Qbl\StoreError;

/**
 * The HTTP face of players' notebooks (NotebookStore), without a framework, so the dev server and
 * Laravel answer alike. Under /api/notebooks:
 *
 *   For players (signed in; guests too):
 *   GET  {scenario}?group=   {notebook: {pages}, updated_at}: my notebook in that instance
 *   PUT  {scenario}?group=   {notebook: {pages}}: keep my whole notebook (no pages deletes it)
 *
 *   For teachers (the assignment's, or an admin), to read:
 *   GET  teach/{assignment}             {assignment, students: [{id, name, team, pages, cards, updated_at}]}
 *   GET  teach/{assignment}/{student}   {student, notebook: {pages}, updated_at}
 */
class NotebookApi
{
    public function __construct(private NotebookStore $notebooks) {}

    /** @return array{0: int, 1: array|null} HTTP status and JSON body */
    public function handle(string $method, string $path, array $body, ?array $user, array $query = []): array
    {
        try {
            if (! $user) {
                throw new StoreError(401, 'Unauthenticated.');
            }
            $parts = array_values(array_filter(explode('/', trim($path, '/')), 'strlen'));
            if (($parts[0] ?? '') === 'teach') {
                return $this->teach(strtoupper($method), $parts, $user);
            }
            $key = $parts[0] ?? '';
            if (count($parts) !== 1 || ! preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/', $key)) {
                throw new StoreError(404, 'Not found.');
            }
            $group = substr(trim((string) ($query['group'] ?? 'public')), 0, 64) ?: 'public';

            return match (strtoupper($method)) {
                'GET' => [200, $this->notebooks->forPlayer($user, $key, $group)],
                'PUT' => [200, $this->notebooks->save($user, $key, $group, $body['notebook'] ?? null)],
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function teach(string $method, array $parts, array $user): array
    {
        $ids = array_slice($parts, 1);
        if (! $ids || count($ids) > 2 || array_filter($ids, fn ($id) => ! ctype_digit($id))) {
            throw new StoreError(404, 'Not found.');
        }
        if ($method !== 'GET') {
            throw new StoreError(405, 'Method not allowed.');
        }

        return [200, count($ids) === 1
            ? $this->notebooks->forAssignment($user, (int) $ids[0])
            : $this->notebooks->studentNotebook($user, (int) $ids[0], (int) $ids[1])];
    }
}

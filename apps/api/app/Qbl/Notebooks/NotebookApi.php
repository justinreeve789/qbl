<?php

namespace App\Qbl\Notebooks;

use App\Qbl\StoreError;

/**
 * The HTTP face of players' notebooks (NotebookStore), without a framework, so the dev server and
 * Laravel answer alike. Under /api/notebooks, for anyone signed in (guests too):
 *
 *   GET  {scenario}?group=   {notebook: {pages}, updated_at}: my notebook in that instance
 *   PUT  {scenario}?group=   {notebook: {pages}}: keep my whole notebook (no pages deletes it)
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
}

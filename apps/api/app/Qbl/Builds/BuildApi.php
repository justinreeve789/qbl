<?php

namespace App\Qbl\Builds;

use App\Qbl\StoreError;

/**
 * The HTTP face of student building (BuildStore), without a framework, so the dev server and
 * Laravel answer alike. Under /api/builds:
 *
 *   For players (signed in; guests can look but not build):
 *   GET    {scenario}?group=                  the builds shown to me in that instance, my uploads, and the pictures shown
 *   PUT    {scenario}/scenes/{id}?group=      {pieces}: keep my build in that scene (an empty list removes it)
 *   POST   {scenario}/uploads?group=          a picture (multipart `file`) for my builds there
 *   DELETE uploads/{id}                       remove one of my pictures, and what showed it
 *
 *   For teachers:
 *   GET    teach?status=pending|approved|hidden|all   the builds I review, with what is needed to see them
 *   PUT    teach/{id}                         {status: approved|hidden|pending}
 *   PUT    teach/{id}/pieces                  {pieces}: change a student's build (an empty list deletes it)
 *   DELETE teach/{id}
 *
 *   For anyone: GET files/{key}, an uploaded picture (served by the controller, not here).
 */
class BuildApi
{
    public function __construct(private BuildStore $builds) {}

    /**
     * @param  array<string, array{tmp_name?: string}>  $files  uploaded files, as $_FILES has them
     * @return array{0: int, 1: array|null} HTTP status and JSON body
     */
    public function handle(string $method, string $path, array $body, ?array $user, array $query = [], array $files = []): array
    {
        try {
            return $this->route(strtoupper($method), array_values(array_filter(explode('/', trim($path, '/')), 'strlen')), $body, $user, $query, $files);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user, array $query, array $files): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        $group = substr(trim((string) ($query['group'] ?? 'public')), 0, 64) ?: 'public';
        $first = $parts[0] ?? '';
        $id = isset($parts[1]) && ctype_digit($parts[1]) ? (int) $parts[1] : null;

        if ($first === 'teach') {
            return match (true) {
                count($parts) === 1 && $method === 'GET' => [200, ['builds' => $this->builds->queue($user, (string) ($query['status'] ?? 'pending'))]],
                count($parts) === 2 && $id !== null && $method === 'PUT' => [200, ['build' => $this->builds->review($user, $id, (string) ($body['status'] ?? ''))]],
                count($parts) === 2 && $id !== null && $method === 'DELETE' => $this->done(fn () => $this->builds->remove($user, $id)),
                count($parts) === 3 && $id !== null && $parts[2] === 'pieces' && $method === 'PUT' => [200, ['build' => $this->builds->edit($user, $id, $body['pieces'] ?? null)]],
                default => throw new StoreError(404, 'Not found.'),
            };
        }
        if ($first === 'uploads' && count($parts) === 2 && $id !== null && $method === 'DELETE') {
            return $this->done(fn () => $this->builds->removeUpload($user, $id));
        }
        if ($first === '' || in_array($first, ['teach', 'uploads', 'files'], true) || ! preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/', $first)) {
            throw new StoreError(404, 'Not found.');
        }
        if (count($parts) === 1 && $method === 'GET') {
            return [200, $this->builds->forPlayer($user, $first, $group)];
        }
        if (count($parts) === 3 && $parts[1] === 'scenes' && ctype_digit($parts[2]) && $method === 'PUT') {
            return [200, ['build' => $this->builds->save($user, $first, $group, (int) $parts[2], $body['pieces'] ?? null)]];
        }
        if (count($parts) === 2 && $parts[1] === 'uploads' && $method === 'POST') {
            $file = $files['file']['tmp_name'] ?? null;
            if (! is_string($file) || $file === '') {
                throw new StoreError(422, 'Choose a picture to upload.');
            }

            return [201, ['upload' => $this->builds->upload($user, $first, $group, $file)]];
        }

        throw new StoreError(404, 'Not found.');
    }

    private function done(callable $work): array
    {
        $work();

        return [204, null];
    }
}

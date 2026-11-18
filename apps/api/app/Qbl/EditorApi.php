<?php

namespace App\Qbl;

/**
 * The editor's HTTP API, as a function from a request to a response.
 *
 * It has no framework calls: Laravel's EditorController and the dev server
 * both hand it the method, path, JSON body and signed-in user, and send back
 * what it returns. All routes live under /api/editor.
 *
 *   GET    scenarios                              scenarios the user may edit
 *   POST   scenarios                              create one (with a first scene and a new 16-letter code)
 *   GET    scenarios/{id}                         every row of the scenario, typed, for the editor
 *   PATCH  scenarios/{id}                         change scenario attributes
 *   DELETE scenarios/{id}
 *   POST   scenarios/{id}/rows/{table}            add a row: media, variables, items, characters, scenes, events, actions, conditions, labels
 *   PATCH  scenarios/{id}/rows/{table}/{rowId}
 *   DELETE scenarios/{id}/rows/{table}/{rowId}
 *   POST   scenarios/{id}/media/upload            multipart "file"
 *   POST   scenarios/import                       multipart `file`: a ZIP with scenario.json and assets/; creates a new scenario
 *   POST   scenarios/{id}/duplicate               {title?}: a copy of the scenario as a new draft of the caller's
 *   GET    scenarios/{id}/export                  the scenario as a ZIP file (scenario.json and the uploaded files)
 *   GET    scenarios/{id}/preview                 the scenario JSON generated from the tables as they are now
 *   POST   scenarios/{id}/publish                 generate the JSON and make it what players get
 */
class EditorApi
{
    public function __construct(private ScenarioStore $store) {}

    /**
     * @param  array|null  $user   ['id' => int, 'name' => string, 'role' => string], or null if not signed in
     * @param  array  $files  uploaded files: ['file' => ['tmp_name' => ..., 'name' => ...]]
     * @return array{0: int, 1: array|null}  HTTP status and JSON body
     */
    public function handle(string $method, string $path, array $body, ?array $user, array $files = []): array
    {
        try {
            return $this->route(strtoupper($method), array_values(array_filter(explode('/', trim($path, '/')), 'strlen')), $body, $user, $files);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user, array $files): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        if (! in_array($user['role'] ?? '', ['teacher', 'admin'], true)) {
            throw new StoreError(403, 'The editor is for teachers and content creators.');
        }
        if (($parts[0] ?? '') !== 'scenarios') {
            throw new StoreError(404, 'Not found.');
        }

        // A scenario from a ZIP made by "Export", or put together by hand in the same shape.
        if ($parts === ['scenarios', 'import'] && $method === 'POST') {
            $file = $files['file'] ?? null;
            if (! $file || empty($file['tmp_name'])) {
                throw new StoreError(422, 'No file was uploaded.');
            }
            $id = (new ScenarioArchive($this->store))->import($file['tmp_name'], (int) $user['id'], $body['title'] ?? null);

            return [201, ['scenario' => $this->store->scenario($id)]];
        }

        if (count($parts) === 1) {
            return match ($method) {
                'GET' => [200, ['scenarios' => $this->store->listFor($user)]],
                'POST' => [201, ['scenario' => $this->store->createScenario($body, (int) $user['id'])]],
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }

        $id = $this->id($parts[1]);
        $scenario = $this->store->scenario($id);
        // A copy to make one's own: of a scenario one can edit as it is now, or of anyone's public mission as it was published.
        if ($scenario && array_slice($parts, 2) === ['duplicate'] && $method === 'POST') {
            if ($this->store->canEdit($scenario, $user)) {
                $rows = $this->store->bundle($id);
            } elseif ($scenario['published_at'] !== null && ($scenario['settings']['visibility'] ?? 'public') !== 'private') {
                $rows = ScenarioDecompiler::rows($this->store->findPublished($scenario['code']));
            } else {
                throw new StoreError(404, 'Scenario not found.');
            }

            return [201, ['scenario' => $this->store->duplicate($rows, (int) $user['id'], $body['title'] ?? null)]];
        }
        if (! $scenario || ! $this->store->canEdit($scenario, $user)) {
            // The same answer whether it does not exist or belongs to someone else.
            throw new StoreError(404, 'Scenario not found.');
        }
        $rest = array_slice($parts, 2);

        if ($rest === []) {
            return match ($method) {
                'GET' => [200, $this->store->bundle($id)],
                'PATCH', 'PUT' => [200, ['scenario' => $this->store->updateScenario($id, $body)]],
                'DELETE' => $this->deleted(fn () => $this->store->deleteScenario($id)),
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }

        if ($rest === ['preview'] && $method === 'GET') {
            // As players will get it: with the platform's avatars.
            return [200, ['scenario' => Avatars::inject($this->store->pdo(), $this->store->compile($id))]];
        }
        // The whole scenario as one ZIP file. The caller sends the file named in `download` and then deletes it.
        if ($rest === ['export'] && $method === 'GET') {
            [$path, $name] = (new ScenarioArchive($this->store))->export($id);

            return [200, ['download' => ['path' => $path, 'name' => $name, 'type' => 'application/zip']]];
        }
        if ($rest === ['publish'] && $method === 'POST') {
            $this->store->publish($id);

            return [200, ['scenario' => $this->store->scenario($id)]];
        }
        if ($rest === ['media', 'upload'] && $method === 'POST') {
            $file = $files['file'] ?? null;
            if (! $file || empty($file['tmp_name'])) {
                throw new StoreError(422, 'No file was uploaded.');
            }

            return [201, ['row' => $this->store->addMediaFile($id, $file['tmp_name'], (string) ($file['name'] ?? 'upload'))]];
        }

        if (($rest[0] ?? '') === 'rows' && isset($rest[1])) {
            $table = $rest[1];
            if (count($rest) === 2 && $method === 'POST') {
                return [201, ['row' => $this->store->createRow($id, $table, $body)]];
            }
            if (count($rest) === 3) {
                $rowId = $this->id($rest[2]);

                return match ($method) {
                    'PATCH', 'PUT' => [200, ['row' => $this->store->updateRow($id, $table, $rowId, $body)]],
                    'DELETE' => $this->deleted(fn () => $this->store->deleteRow($id, $table, $rowId)),
                    default => throw new StoreError(405, 'Method not allowed.'),
                };
            }
        }

        throw new StoreError(404, 'Not found.');
    }

    private function id(string $part): int
    {
        if (! ctype_digit($part)) {
            throw new StoreError(404, 'Not found.');
        }

        return (int) $part;
    }

    private function deleted(callable $fn): array
    {
        $fn();

        return [204, null];
    }
}

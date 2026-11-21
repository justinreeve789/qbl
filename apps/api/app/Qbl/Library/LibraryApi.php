<?php

namespace App\Qbl\Library;

use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;

/**
 * The asset library's HTTP API, under /api/editor/library, as a function from a request to a
 * response (like EditorApi: Laravel's LibraryController and the dev server both call it).
 *
 * Teachers and administrators:
 *
 *   GET    library                       ?kind=vehicle (or kind=character,vehicle)&category=&q=&tag=
 *                                        {assets, categories, kinds}
 *   GET    library/{asset}               {asset}                          {asset}: an id or a slug
 *   POST   library/{asset}/add           {scenario_id, name?}: add it to a scenario they can edit
 *                                        {asset, created: {table, row}, media: [rows used], copied: [ids of new media]}
 *
 * Administrators (the platform's library):
 *
 *   POST   library                       {kind, name, slug?, category?, description?, tags?, style?, definition?, credit?, organization_id?, active?, sequence?}
 *   PATCH  library/{asset}               the same, any of them
 *   DELETE library/{asset}
 *   POST   library/{asset}/files         multipart: file, role (sheet, portrait, image, sound, preview...), params (JSON: sheet, animations)
 *   DELETE library/{asset}/files/{role}
 *   POST   library/capture               {scenario_id, table: characters|items|media, row_id, name?, slug?, category?, description?, tags?, credit?}
 *                                        keep something made in a scenario as a library asset
 */
class LibraryApi
{
    public function __construct(private AssetLibrary $library, private ScenarioStore $store) {}

    /**
     * @param  string  $path  what follows /api/editor/library
     * @return array{0: int, 1: array|null}
     */
    public function handle(string $method, string $path, array $body, ?array $user, array $files = [], array $query = []): array
    {
        try {
            return $this->route(strtoupper($method), array_values(array_filter(explode('/', trim($path, '/')), 'strlen')), $body, $user, $files, $query);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user, array $files, array $query): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        $role = $user['role'] ?? '';
        if (! in_array($role, ['teacher', 'admin'], true)) {
            throw new StoreError(403, 'The asset library is for teachers and content creators.');
        }
        $admin = $role === 'admin';

        if ($parts === []) {
            if ($method === 'GET') {
                $filter = [
                    'kind' => isset($query['kind']) ? explode(',', (string) $query['kind']) : null,
                    'category' => $query['category'] ?? null,
                    'q' => $query['q'] ?? null,
                    'tag' => $query['tag'] ?? null,
                    'inactive' => $admin && filter_var($query['inactive'] ?? false, FILTER_VALIDATE_BOOL),
                ];

                return [200, [
                    'assets' => $this->library->all($filter, $user),
                    'categories' => $this->library->categories($filter, $user),
                    'kinds' => array_keys(AssetLibrary::KINDS),
                ]];
            }
            if ($method === 'POST') {
                $this->mustBeAdmin($admin);

                return [201, ['asset' => $this->library->save(['created_by' => $user['id']] + array_diff_key($body, ['id' => 1, 'source' => 1]))]];
            }
            throw new StoreError(405, 'Method not allowed.');
        }

        if ($parts === ['capture'] && $method === 'POST') {
            $this->mustBeAdmin($admin);
            $scenarioId = $this->editable((int) ($body['scenario_id'] ?? 0), $user);
            $attrs = array_intersect_key($body, array_flip(['name', 'slug', 'category', 'description', 'tags', 'style', 'credit', 'organization_id', 'sequence']));

            return [201, ['asset' => $this->library->capture($this->store, $scenarioId, (string) ($body['table'] ?? ''), (int) ($body['row_id'] ?? 0), $attrs + ['created_by' => $user['id']])]];
        }

        $asset = $this->library->get($parts[0], $user);
        $rest = array_slice($parts, 1);

        if ($rest === []) {
            return match ($method) {
                'GET' => [200, ['asset' => $asset]],
                'PATCH' => $this->mustBeAdmin($admin) ?? [200, ['asset' => $this->library->save(['id' => $asset['id']] + array_diff_key($body, ['id' => 1, 'created_by' => 1]))]],
                'DELETE' => $this->mustBeAdmin($admin) ?? $this->deleted($asset['id']),
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }
        if ($rest === ['add'] && $method === 'POST') {
            $scenarioId = $this->editable((int) ($body['scenario_id'] ?? 0), $user);

            return [201, $this->library->addToScenario($this->store, $scenarioId, $asset['id'], array_intersect_key($body, ['name' => 1]))];
        }
        if (($rest[0] ?? '') === 'files') {
            $this->mustBeAdmin($admin);
            if (count($rest) === 1 && $method === 'POST') {
                $file = $files['file'] ?? null;
                if (! $file || empty($file['tmp_name'])) {
                    throw new StoreError(422, 'No file was uploaded.');
                }
                $params = is_string($body['params'] ?? null) ? json_decode($body['params'], true) : ($body['params'] ?? []);

                return [201, ['asset' => $this->library->putFile($asset['id'], (string) ($body['role'] ?? ''), $file['tmp_name'], is_array($params) ? $params : [], $file['name'] ?? null)]];
            }
            if (count($rest) === 2 && $method === 'DELETE') {
                return [200, ['asset' => $this->library->removeFile($asset['id'], $rest[1])]];
            }
        }
        throw new StoreError(404, 'Not found.');
    }

    private function deleted(int $id): array
    {
        $this->library->remove($id);

        return [204, null];
    }

    /** The scenario's id, when the user may edit it; otherwise the same 404 as for one that does not exist. */
    private function editable(int $scenarioId, array $user): int
    {
        $scenario = $this->store->scenario($scenarioId);
        if (! $scenario || ! $this->store->canEdit($scenario, $user)) {
            throw new StoreError(404, 'Scenario not found.');
        }

        return $scenarioId;
    }

    private function mustBeAdmin(bool $admin): null
    {
        if (! $admin) {
            throw new StoreError(403, 'Only administrators can change the library.');
        }

        return null;
    }
}
